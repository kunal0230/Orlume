/**
 * ImageDevelopment - Professional Image Development Pipeline
 * Orlume Vision Labs
 * 
 * Pipeline Order (color-science correct):
 * 
 *   sRGB → Linear (Float32)
 *   → White Balance (True Bradford: RGB→LMS→scale→RGB)
 *   → Exposure (EV gain)
 *   → Contrast (True sigmoid: Y' = (Y-0.18)/(1+|Y-0.18|*k)+0.18)
 *   → Tone Curve (before H/S/W/B!)
 *   → Highlights / Shadows / Whites / Blacks (Y'/Y)
 *   → Dehaze (Y'/Y)
 *   → Texture / Clarity (separable Gaussian, Y'/Y)
 *   → Profile (B&W, HDR)
 *   → Vibrance (OKLab, adaptive chroma limits per hue)
 *   → Saturation (OKLab chroma scaling)
 *   → Linear → sRGB (single pass)
 * 
 * Key principles:
 * - All processing in Float32 linear space until final output
 * - Luminance-ratio scaling (Y'/Y) for color-preserving adjustments
 * - True Bradford chromatic adaptation (RGB→LMS→scale→RGB)
 * - True sigmoid contrast (compresses extremes, prevents clipping)
 * - OKLab for perceptually uniform vibrance/saturation
 * - Adaptive chroma limits per hue (gamut-aware)
 * - Tone curve BEFORE highlights/shadows
 * - Single gamma conversion at the end
 * - Separable Gaussian blur for O(n·r) local contrast
 */

export class ImageDevelopment {
    constructor() {
        this.settings = {
            // Profile
            profile: 'color', // 'color', 'bw', 'hdr'

            // White Balance
            temperature: 0,   // -100 to +100 (blue↔yellow)
            tint: 0,          // -100 to +100 (green↔magenta)

            // Tone
            exposure: 0,      // -5 to +5 (EV stops)
            contrast: 0,      // -100 to +100
            highlights: 0,    // -100 to +100
            shadows: 0,       // -100 to +100
            whites: 0,        // -100 to +100
            blacks: 0,        // -100 to +100

            // Presence
            texture: 0,       // -100 to +100 (high-freq contrast)
            clarity: 0,       // -100 to +100 (mid-freq contrast)
            dehaze: 0,        // -100 to +100

            // Color
            vibrance: 0,      // -100 to +100 (selective saturation)
            saturation: 0     // -100 to +100 (global saturation)
        };

        // Precomputed LUTs for gamma conversion (sRGB ↔ Linear)
        this._sRGBtoLinearLUT = new Float32Array(256);
        this._linearToSRGBLUT = new Uint8Array(4096); // 12-bit precision
        this._buildLUTs();

        // Tone curve LUTs (from ToneCurve component)
        this.curveLUTs = null;
    }

    /**
     * Set curve LUTs from ToneCurve component
     */
    setCurveLUTs(luts) {
        this.curveLUTs = luts;
    }

    /**
     * Build lookup tables for fast gamma conversion
     */
    _buildLUTs() {
        // sRGB to Linear LUT
        for (let i = 0; i < 256; i++) {
            const srgb = i / 255;
            if (srgb <= 0.04045) {
                this._sRGBtoLinearLUT[i] = srgb / 12.92;
            } else {
                this._sRGBtoLinearLUT[i] = Math.pow((srgb + 0.055) / 1.055, 2.4);
            }
        }

        // Linear to sRGB LUT (12-bit input for precision)
        for (let i = 0; i < 4096; i++) {
            const linear = i / 4095;
            let srgb;
            if (linear <= 0.0031308) {
                srgb = linear * 12.92;
            } else {
                srgb = 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
            }
            this._linearToSRGBLUT[i] = Math.round(Math.max(0, Math.min(255, srgb * 255)));
        }
    }

    /**
     * Convert sRGB (0-255) to Linear (0-1)
     */
    sRGBtoLinear(value) {
        return this._sRGBtoLinearLUT[Math.round(Math.max(0, Math.min(255, value)))];
    }

    /**
     * Convert Linear (0-1) to sRGB (0-255)
     */
    linearToSRGB(value) {
        const idx = Math.round(Math.max(0, Math.min(1, value)) * 4095);
        return this._linearToSRGBLUT[idx];
    }

    /**
     * Calculate luminance (Rec. 709)
     */
    luminance(r, g, b) {
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    /**
     * Smoothstep function for smooth transitions
     */
    smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    /**
     * Apply luminance-ratio scaling (color-preserving brightness change)
     * newRGB = RGB * (Y' / Y)
     */
    applyLuminanceRatio(r, g, b, newLum) {
        const oldLum = this.luminance(r, g, b);
        if (oldLum > 0.0001) {
            const ratio = newLum / oldLum;
            return [r * ratio, g * ratio, b * ratio];
        }
        // For very dark pixels, add uniformly
        const delta = newLum - oldLum;
        return [r + delta, g + delta, b + delta];
    }

    /**
     * Convert Linear RGB to OKLab
     * OKLab is a perceptually uniform color space ideal for color manipulation
     * Reference: https://bottosson.github.io/posts/oklab/
     */
    linearRGBtoOKLab(r, g, b) {
        // Linear RGB to LMS (cone response)
        const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
        const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
        const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

        // Cube root (with sign preservation for negatives)
        const l_ = Math.cbrt(l);
        const m_ = Math.cbrt(m);
        const s_ = Math.cbrt(s);

        // LMS to OKLab
        const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
        const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
        const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

        return [L, a, B];
    }

    /**
     * Convert OKLab to Linear RGB
     */
    OKLabToLinearRGB(L, a, B) {
        // OKLab to LMS
        const l_ = L + 0.3963377774 * a + 0.2158037573 * B;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * B;
        const s_ = L - 0.0894841775 * a - 1.2914855480 * B;

        // Cube (inverse of cbrt)
        const l = l_ * l_ * l_;
        const m = m_ * m_ * m_;
        const s = s_ * s_ * s_;

        // LMS to Linear RGB
        const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
        const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
        const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

        return [r, g, b];
    }

    /**
     * Get chroma (saturation) in OKLab: sqrt(a² + b²)
     */
    OKLabChroma(a, b) {
        return Math.sqrt(a * a + b * b);
    }

    /**
     * Update a single setting
     */
    set(key, value) {
        if (key in this.settings) {
            this.settings[key] = value;
        }
    }

    /**
     * Get current setting value
     */
    get(key) {
        return this.settings[key];
    }

    /**
     * Reset all settings to defaults
     */
    reset() {
        this.settings = {
            profile: 'color',
            temperature: 0,
            tint: 0,
            exposure: 0,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            texture: 0,
            clarity: 0,
            dehaze: 0,
            vibrance: 0,
            saturation: 0
        };
    }

    /**
     * Apply all adjustments to image data
     * @param {ImageData} sourceImageData - Original image data
     * @returns {ImageData} - Processed image data
     */
    apply(sourceImageData) {
        const { width, height, data: srcData } = sourceImageData;
        const pixelCount = width * height;

        const {
            profile,
            temperature, tint,
            exposure, contrast,
            highlights, shadows, whites, blacks,
            texture, clarity, dehaze,
            vibrance, saturation
        } = this.settings;

        // ============================================================
        // STEP 1: Convert to Float32 Linear RGB buffer
        // All processing happens in this buffer until final output
        // ============================================================
        const linearR = new Float32Array(pixelCount);
        const linearG = new Float32Array(pixelCount);
        const linearB = new Float32Array(pixelCount);
        const alpha = new Uint8Array(pixelCount);

        for (let i = 0; i < pixelCount; i++) {
            const idx = i * 4;
            linearR[i] = this.sRGBtoLinear(srcData[idx]);
            linearG[i] = this.sRGBtoLinear(srcData[idx + 1]);
            linearB[i] = this.sRGBtoLinear(srcData[idx + 2]);
            alpha[i] = srcData[idx + 3];
        }

        // Precompute adjustment factors
        const tempFactor = 1 + (temperature / 100) * 0.3;
        const tintFactor = 1 + (tint / 100) * 0.2;
        const exposureGain = Math.pow(2, exposure);
        const highlightAmount = highlights / 100;
        const shadowAmount = shadows / 100;
        const whiteAmount = whites / 200;
        const blackAmount = blacks / 200;
        const dehazeAmount = dehaze / 100;
        const vibranceAmount = vibrance / 100;
        const saturationFactor = 1 + saturation / 100;

        // ============================================================
        // STEP 2: White Balance (True Bradford Chromatic Adaptation)
        // RGB → LMS → scale by source/target white → LMS → RGB
        // ============================================================
        if (temperature !== 0 || tint !== 0) {
            // Temperature/tint to illuminant shift
            // D65 (6500K) as reference, temperature shifts toward blue/yellow
            const tempNorm = temperature / 100; // -1 to +1
            const tintNorm = tint / 100;

            // Target white point relative to D65 (approximation)
            // Positive temp = warmer = more red/yellow = simulate cooler source
            // This is the ratio: target_white / source_white
            const targetR = 1 + tempNorm * 0.15;
            const targetG = 1 - tintNorm * 0.10;
            const targetB = 1 - tempNorm * 0.25;

            // Bradford matrix: RGB to LMS (cone response)
            // Standard Bradford coefficients
            const M_RGB_to_LMS = [
                [0.8951, 0.2664, -0.1614],
                [-0.7502, 1.7135, 0.0367],
                [0.0389, -0.0685, 1.0296]
            ];

            // Inverse Bradford matrix: LMS to RGB
            const M_LMS_to_RGB = [
                [0.9870, -0.1471, 0.1600],
                [0.4323, 0.5184, 0.0493],
                [-0.0085, 0.0400, 0.9685]
            ];

            // Compute D65 white point in LMS
            const D65_L = M_RGB_to_LMS[0][0] + M_RGB_to_LMS[0][1] + M_RGB_to_LMS[0][2];
            const D65_M = M_RGB_to_LMS[1][0] + M_RGB_to_LMS[1][1] + M_RGB_to_LMS[1][2];
            const D65_S = M_RGB_to_LMS[2][0] + M_RGB_to_LMS[2][1] + M_RGB_to_LMS[2][2];

            // Compute target white point in LMS
            const TGT_L = M_RGB_to_LMS[0][0] * targetR + M_RGB_to_LMS[0][1] * targetG + M_RGB_to_LMS[0][2] * targetB;
            const TGT_M = M_RGB_to_LMS[1][0] * targetR + M_RGB_to_LMS[1][1] * targetG + M_RGB_to_LMS[1][2] * targetB;
            const TGT_S = M_RGB_to_LMS[2][0] * targetR + M_RGB_to_LMS[2][1] * targetG + M_RGB_to_LMS[2][2] * targetB;

            // Diagonal scaling matrix: D65 / Target (to adapt from target illuminant to D65)
            const scaleL = D65_L / TGT_L;
            const scaleM = D65_M / TGT_M;
            const scaleS = D65_S / TGT_S;

            for (let i = 0; i < pixelCount; i++) {
                const r = linearR[i];
                const g = linearG[i];
                const b = linearB[i];

                // RGB to LMS
                const L = M_RGB_to_LMS[0][0] * r + M_RGB_to_LMS[0][1] * g + M_RGB_to_LMS[0][2] * b;
                const M = M_RGB_to_LMS[1][0] * r + M_RGB_to_LMS[1][1] * g + M_RGB_to_LMS[1][2] * b;
                const S = M_RGB_to_LMS[2][0] * r + M_RGB_to_LMS[2][1] * g + M_RGB_to_LMS[2][2] * b;

                // Scale LMS (chromatic adaptation)
                const L_adapted = L * scaleL;
                const M_adapted = M * scaleM;
                const S_adapted = S * scaleS;

                // LMS to RGB
                linearR[i] = M_LMS_to_RGB[0][0] * L_adapted + M_LMS_to_RGB[0][1] * M_adapted + M_LMS_to_RGB[0][2] * S_adapted;
                linearG[i] = M_LMS_to_RGB[1][0] * L_adapted + M_LMS_to_RGB[1][1] * M_adapted + M_LMS_to_RGB[1][2] * S_adapted;
                linearB[i] = M_LMS_to_RGB[2][0] * L_adapted + M_LMS_to_RGB[2][1] * M_adapted + M_LMS_to_RGB[2][2] * S_adapted;
            }
        }

        // ============================================================
        // STEP 3: Exposure (EV gain)
        // ============================================================
        for (let i = 0; i < pixelCount; i++) {
            linearR[i] *= exposureGain;
            linearG[i] *= exposureGain;
            linearB[i] *= exposureGain;
        }

        // ============================================================
        // STEP 4: Contrast (True Sigmoid / Logistic curve)
        // Y' = (Y - 0.18) / (1 + |Y - 0.18| * k) + 0.18
        // Compresses extremes naturally, prevents clipping
        // ============================================================
        if (contrast !== 0) {
            const MIDDLE_GRAY = 0.18;
            // k controls the steepness: 0 = linear, higher = more S-curve
            // contrast = 100 → k ≈ 3 (strong S)
            // contrast = -100 → k ≈ -0.5 (flatten toward gray)
            const k = contrast > 0
                ? (contrast / 100) * 3.0
                : (contrast / 100) * 0.5;

            for (let i = 0; i < pixelCount; i++) {
                const r = linearR[i];
                const g = linearG[i];
                const b = linearB[i];

                const lum = this.luminance(r, g, b);

                let newLum;
                if (contrast > 0) {
                    // Increase contrast: sigmoid curve
                    // Y' = (Y - 0.18) / (1 + |Y - 0.18| * k) + 0.18
                    // But scaled to create an S-curve that preserves extremes
                    const delta = lum - MIDDLE_GRAY;
                    const compressed = delta / (1 + Math.abs(delta) * k);
                    // Scale back to full range (sigmoid naturally compresses)
                    const scale = 1 + k * 0.5;
                    newLum = MIDDLE_GRAY + compressed * scale;
                } else {
                    // Decrease contrast: pull toward middle gray
                    const blend = -k; // k is negative, so -k is positive
                    newLum = lum + (MIDDLE_GRAY - lum) * blend;
                }

                // Clamp and apply luminance-ratio scaling
                newLum = Math.max(0, newLum);
                [linearR[i], linearG[i], linearB[i]] = this.applyLuminanceRatio(r, g, b, newLum);
            }
        }

        // ============================================================
        // STEP 5: Tone Curve (BEFORE highlights/shadows)
        // Curve defines global contrast, sliders refine it
        // ============================================================
        if (this.curveLUTs) {
            for (let i = 0; i < pixelCount; i++) {
                let r = Math.max(0, Math.min(1, linearR[i]));
                let g = Math.max(0, Math.min(1, linearG[i]));
                let b = Math.max(0, Math.min(1, linearB[i]));

                // Apply RGB curve using luminance-ratio method (color-preserving)
                const rgbLUT = this.curveLUTs.rgb;
                const lumBefore = this.luminance(r, g, b);

                if (lumBefore > 0.001) {
                    const lumAfter = rgbLUT[Math.round(lumBefore * 255)];
                    const scale = lumAfter / lumBefore;
                    r *= scale;
                    g *= scale;
                    b *= scale;
                } else {
                    const adjustment = rgbLUT[Math.round(lumBefore * 255)] - lumBefore;
                    r += adjustment;
                    g += adjustment;
                    b += adjustment;
                }

                // Apply per-channel curves (for color grading)
                r = Math.max(0, Math.min(1, r));
                g = Math.max(0, Math.min(1, g));
                b = Math.max(0, Math.min(1, b));

                linearR[i] = this.curveLUTs.r[Math.round(r * 255)];
                linearG[i] = this.curveLUTs.g[Math.round(g * 255)];
                linearB[i] = this.curveLUTs.b[Math.round(b * 255)];
            }
        }

        // ============================================================
        // STEP 6: Highlights / Shadows / Whites / Blacks
        // Using luminance-ratio scaling (color-preserving)
        // ============================================================
        const hasHighlights = highlightAmount !== 0;
        const hasShadows = shadowAmount !== 0;
        const hasWhites = whiteAmount !== 0;
        const hasBlacks = blackAmount !== 0;

        if (hasHighlights || hasShadows || hasWhites || hasBlacks) {
            for (let i = 0; i < pixelCount; i++) {
                const r = linearR[i];
                const g = linearG[i];
                const b = linearB[i];

                let lum = this.luminance(r, g, b);
                let newLum = lum;

                // Highlights: compress bright areas
                if (hasHighlights && lum > 0.5) {
                    const factor = this.smoothstep(0.5, 1.0, lum);
                    newLum -= highlightAmount * factor * lum * 0.4;
                }

                // Shadows: lift dark areas
                if (hasShadows && lum < 0.5) {
                    const factor = this.smoothstep(0.5, 0.0, lum);
                    newLum += shadowAmount * factor * (1 - lum) * 0.3;
                }

                // Whites: adjust white point
                if (hasWhites) {
                    const factor = this.smoothstep(0.7, 1.0, lum);
                    newLum += whiteAmount * factor * (1 - lum);
                }

                // Blacks: adjust black point
                if (hasBlacks) {
                    const factor = this.smoothstep(0.3, 0.0, lum);
                    newLum += blackAmount * factor * lum;
                }

                // Clamp and apply luminance-ratio scaling
                newLum = Math.max(0, newLum);
                [linearR[i], linearG[i], linearB[i]] = this.applyLuminanceRatio(r, g, b, newLum);
            }
        }

        // ============================================================
        // STEP 7: Dehaze (contrast + slight blue reduction)
        // ============================================================
        if (dehazeAmount !== 0) {
            const MIDDLE_GRAY = 0.18;
            const dehazeContrast = 1 + dehazeAmount * 0.25;

            for (let i = 0; i < pixelCount; i++) {
                const r = linearR[i];
                const g = linearG[i];
                const b = linearB[i];

                const lum = this.luminance(r, g, b);
                const newLum = (lum - MIDDLE_GRAY) * dehazeContrast + MIDDLE_GRAY - dehazeAmount * 0.03;

                [linearR[i], linearG[i], linearB[i]] = this.applyLuminanceRatio(r, g, b, Math.max(0, newLum));
            }
        }

        // ============================================================
        // STEP 8: Texture & Clarity (local contrast in Float32 space)
        // Separable Gaussian for O(n·r) performance
        // ============================================================
        if (texture !== 0 || clarity !== 0) {
            // Extract luminance for local contrast operations
            const lum = new Float32Array(pixelCount);
            for (let i = 0; i < pixelCount; i++) {
                lum[i] = this.luminance(linearR[i], linearG[i], linearB[i]);
            }

            // Texture: high-frequency (small radius ~3px)
            if (texture !== 0) {
                const blurred = this._separableGaussian(lum, width, height, 3);
                const textureAmount = texture / 100 * 0.4;

                for (let i = 0; i < pixelCount; i++) {
                    const highPass = lum[i] - blurred[i];
                    const newLum = Math.max(0, lum[i] + highPass * textureAmount);
                    [linearR[i], linearG[i], linearB[i]] = this.applyLuminanceRatio(
                        linearR[i], linearG[i], linearB[i], newLum
                    );
                }
            }

            // Clarity: mid-frequency (larger radius ~12px)
            if (clarity !== 0) {
                // Re-extract luminance after texture
                for (let i = 0; i < pixelCount; i++) {
                    lum[i] = this.luminance(linearR[i], linearG[i], linearB[i]);
                }

                const blurred = this._separableGaussian(lum, width, height, 12);
                const clarityAmount = clarity / 100 * 0.5;

                for (let i = 0; i < pixelCount; i++) {
                    const highPass = lum[i] - blurred[i];
                    const newLum = Math.max(0, lum[i] + highPass * clarityAmount);
                    [linearR[i], linearG[i], linearB[i]] = this.applyLuminanceRatio(
                        linearR[i], linearG[i], linearB[i], newLum
                    );
                }
            }
        }

        // ============================================================
        // STEP 9: Profile (B&W, HDR tone mapping)
        // ============================================================
        if (profile === 'bw') {
            for (let i = 0; i < pixelCount; i++) {
                const gray = this.luminance(linearR[i], linearG[i], linearB[i]);
                linearR[i] = linearG[i] = linearB[i] = gray;
            }
        } else if (profile === 'hdr') {
            // Reinhard tone mapping
            for (let i = 0; i < pixelCount; i++) {
                linearR[i] = linearR[i] / (1 + linearR[i]);
                linearG[i] = linearG[i] / (1 + linearG[i]);
                linearB[i] = linearB[i] / (1 + linearB[i]);
            }
        }

        // ============================================================
        // STEP 10: Vibrance (OKLab - perceptually uniform)
        // Works in chroma (a/b) dimensions, protects saturated colors
        // ============================================================
        if (vibranceAmount !== 0 && profile !== 'bw') {
            for (let i = 0; i < pixelCount; i++) {
                const r = linearR[i];
                const g = linearG[i];
                const b = linearB[i];

                // Convert to OKLab
                const [L, a, B] = this.linearRGBtoOKLab(r, g, b);

                // Calculate current chroma and hue
                const chroma = this.OKLabChroma(a, B);

                // Adaptive max chroma per hue (sRGB gamut varies by hue)
                // Approximate max chroma for sRGB at different hue angles:
                // Red/Orange: ~0.25, Yellow: ~0.22, Green: ~0.15, Cyan: ~0.13, Blue: ~0.31, Magenta: ~0.32
                const hueAngle = Math.atan2(B, a); // -π to π
                // Smooth approximation of sRGB gamut boundary at L=0.6
                // Uses Fourier-like approximation for the irregular gamut shape
                const maxChroma = 0.20 + 0.08 * Math.cos(hueAngle) + 0.05 * Math.cos(2 * hueAngle - 0.5);

                // Vibrance: boost inversely proportional to current chroma
                // Low-saturation colors get boosted more
                const normalizedChroma = Math.min(1, chroma / maxChroma);
                const boost = 1 + vibranceAmount * (1 - normalizedChroma) * 0.5;

                // Scale a and b (chroma dimensions) while preserving L
                const newA = a * boost;
                const newB = B * boost;

                // Convert back to Linear RGB
                [linearR[i], linearG[i], linearB[i]] = this.OKLabToLinearRGB(L, newA, newB);
            }
        }

        // ============================================================
        // STEP 11: Saturation (OKLab - perceptually uniform)
        // Global chroma scaling
        // ============================================================
        if (saturationFactor !== 1 && profile !== 'bw') {
            for (let i = 0; i < pixelCount; i++) {
                const r = linearR[i];
                const g = linearG[i];
                const b = linearB[i];

                // Convert to OKLab
                const [L, a, B] = this.linearRGBtoOKLab(r, g, b);

                // Scale chroma (a and b) by saturation factor
                // L (lightness) stays unchanged
                const newA = a * saturationFactor;
                const newB = B * saturationFactor;

                // Convert back to Linear RGB
                [linearR[i], linearG[i], linearB[i]] = this.OKLabToLinearRGB(L, newA, newB);
            }
        }

        // ============================================================
        // STEP 12: Final conversion - Linear Float32 → sRGB Uint8
        // Single gamma conversion at the very end
        // ============================================================
        const result = new ImageData(width, height);
        const destData = result.data;

        for (let i = 0; i < pixelCount; i++) {
            const idx = i * 4;
            destData[idx] = this.linearToSRGB(Math.max(0, linearR[i]));
            destData[idx + 1] = this.linearToSRGB(Math.max(0, linearG[i]));
            destData[idx + 2] = this.linearToSRGB(Math.max(0, linearB[i]));
            destData[idx + 3] = alpha[i];
        }

        return result;
    }

    /**
     * Separable Gaussian blur - O(n·r) instead of O(n·r²)
     * Uses box blur approximation (3 passes ≈ Gaussian)
     */
    _separableGaussian(data, width, height, radius) {
        // 3 box blur passes approximate a Gaussian
        let result = this._separableBoxBlur(data, width, height, radius);
        result = this._separableBoxBlur(result, width, height, radius);
        result = this._separableBoxBlur(result, width, height, radius);
        return result;
    }

    /**
     * Single-pass separable box blur
     */
    _separableBoxBlur(data, width, height, radius) {
        const size = radius * 2 + 1;
        const result = new Float32Array(width * height);
        const temp = new Float32Array(width * height);

        // Horizontal pass
        for (let y = 0; y < height; y++) {
            let sum = 0;
            // Initialize window
            for (let x = -radius; x <= radius; x++) {
                const sx = Math.max(0, Math.min(width - 1, x));
                sum += data[y * width + sx];
            }
            temp[y * width] = sum / size;

            // Slide window
            for (let x = 1; x < width; x++) {
                const removeX = Math.max(0, x - radius - 1);
                const addX = Math.min(width - 1, x + radius);
                sum -= data[y * width + removeX];
                sum += data[y * width + addX];
                temp[y * width + x] = sum / size;
            }
        }

        // Vertical pass
        for (let x = 0; x < width; x++) {
            let sum = 0;
            // Initialize window
            for (let y = -radius; y <= radius; y++) {
                const sy = Math.max(0, Math.min(height - 1, y));
                sum += temp[sy * width + x];
            }
            result[x] = sum / size;

            // Slide window
            for (let y = 1; y < height; y++) {
                const removeY = Math.max(0, y - radius - 1);
                const addY = Math.min(height - 1, y + radius);
                sum -= temp[removeY * width + x];
                sum += temp[addY * width + x];
                result[y * width + x] = sum / size;
            }
        }

        return result;
    }

    /**
     * Check if any settings deviate from defaults
     */
    hasChanges() {
        return this.settings.profile !== 'color' ||
            this.settings.temperature !== 0 ||
            this.settings.tint !== 0 ||
            this.settings.exposure !== 0 ||
            this.settings.contrast !== 0 ||
            this.settings.highlights !== 0 ||
            this.settings.shadows !== 0 ||
            this.settings.whites !== 0 ||
            this.settings.blacks !== 0 ||
            this.settings.texture !== 0 ||
            this.settings.clarity !== 0 ||
            this.settings.dehaze !== 0 ||
            this.settings.vibrance !== 0 ||
            this.settings.saturation !== 0;
    }
}
