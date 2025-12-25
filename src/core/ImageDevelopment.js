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

        // Color Mixer - 8 hue bands + All
        // Values stored as normalized floats:
        //   h: hue shift in degrees (-30 to +30)
        //   s: saturation multiplier (-1 to +1)
        //   l: luminance offset (-0.3 to +0.3)
        this.colorMixer = {
            all: { h: 0, s: 0, l: 0 },
            red: { h: 0, s: 0, l: 0 },
            orange: { h: 0, s: 0, l: 0 },
            yellow: { h: 0, s: 0, l: 0 },
            green: { h: 0, s: 0, l: 0 },
            aqua: { h: 0, s: 0, l: 0 },
            blue: { h: 0, s: 0, l: 0 },
            purple: { h: 0, s: 0, l: 0 },
            magenta: { h: 0, s: 0, l: 0 }
        };

        // Scientifically-tuned hue band definitions
        // Each band has center hue (degrees) and width for smooth blending
        this.COLOR_BANDS = {
            red: { center: 25, width: 35 },
            orange: { center: 45, width: 35 },
            yellow: { center: 95, width: 40 },
            green: { center: 145, width: 40 },
            aqua: { center: 195, width: 40 },
            blue: { center: 255, width: 45 },
            purple: { center: 295, width: 40 },
            magenta: { center: 335, width: 35 }
        };

        // Color Grading - Shadows/Midtones/Highlights color wheels
        // Each wheel: angle (0-360° hue direction), strength (0-1 intensity)
        // Applied as OKLab chroma offsets per tonal range
        this.colorGrading = {
            shadows: { angle: 0, strength: 0 },
            midtones: { angle: 0, strength: 0 },
            highlights: { angle: 0, strength: 0 },
            blending: 50,  // 0-100: how much midtones inherit edge colors
            balance: 0     // -100 to +100: shift toward shadows/highlights
        };

        // Detail (Sharpening & Noise Reduction)
        this.detail = {
            sharpening: {
                amount: 0,      // 0-100
                radius: 1.0,    // 0.5-3.0
                detail: 25,     // 0-100
                masking: 0      // 0-100
            },
            noise: {
                luminance: 0,           // 0-100
                luminanceDetail: 50,    // 0-100
                luminanceContrast: 0,   // 0-100
                color: 0,               // 0-100
                colorDetail: 50,        // 0-100
                colorSmoothness: 50     // 0-100
            }
        };

        // Precomputed LUTs for gamma conversion (sRGB ↔ Linear)
        this._sRGBtoLinearLUT = new Float32Array(256);
        this._linearToSRGBLUT = new Uint8Array(4096); // 12-bit precision
        this._buildLUTs();

        // Tone curve LUTs (from ToneCurve component)
        this.curveLUTs = null;
    }

    /**
     * Smoothstep function for perceptual blending
     * Returns 0-1 smooth transition between edge0 and edge1
     */
    smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
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
     * Efficient Separable Gaussian Blur
     * Used for frequency separation in Sharpening and Denoise
     */
    applyGaussianSeparable(width, height, inputChannel, outputChannel, radius) {
        if (radius < 0.1) {
            outputChannel.set(inputChannel);
            return;
        }

        // 1. Compute kernel
        const sigma = radius; // typically radius maps well to sigma
        const kSize = Math.ceil(radius * 3) * 2 + 1; // 3 sigma rule
        const kernel = new Float32Array(kSize);
        const center = Math.floor(kSize / 2);
        let sum = 0;

        for (let i = 0; i < kSize; i++) {
            const x = i - center;
            const g = Math.exp(-(x * x) / (2 * sigma * sigma));
            kernel[i] = g;
            sum += g;
        }
        // Normalize
        for (let i = 0; i < kSize; i++) kernel[i] /= sum;

        // Temp buffer for horizontal pass
        const temp = new Float32Array(inputChannel.length);

        // 2. Horizontal Pass
        for (let y = 0; y < height; y++) {
            const rowOffset = y * width;
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let k = 0; k < kSize; k++) {
                    const offset = k - center;
                    const sampleX = Math.min(width - 1, Math.max(0, x + offset));
                    val += inputChannel[rowOffset + sampleX] * kernel[k];
                }
                temp[rowOffset + x] = val;
            }
        }

        // 3. Vertical Pass
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                let val = 0;
                for (let k = 0; k < kSize; k++) {
                    const offset = k - center;
                    const sampleY = Math.min(height - 1, Math.max(0, y + offset));
                    val += temp[sampleY * width + x] * kernel[k];
                }
                outputChannel[y * width + x] = val;
            }
        }
    }

    /**
     * Calculate luminance (Rec. 709)
     */
    luminance(r, g, b) {
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
     * Convert Linear RGB to OKLCh (polar form)
     * L = Lightness, C = Chroma, h = Hue angle (degrees)
     */
    linearRGBtoOKLCh(r, g, b) {
        const [L, a, B] = this.linearRGBtoOKLab(r, g, b);
        const C = Math.sqrt(a * a + B * B);
        let h = Math.atan2(B, a) * 180 / Math.PI;
        if (h < 0) h += 360;
        return [L, C, h];
    }

    /**
     * Convert OKLCh to Linear RGB
     */
    OKLChToLinearRGB(L, C, h) {
        const hRad = h * Math.PI / 180;
        const a = C * Math.cos(hRad);
        const B = C * Math.sin(hRad);
        return this.OKLabToLinearRGB(L, a, B);
    }

    /**
     * Hue weight function - smooth circular blending
     * Returns 0-1 weight based on angular distance from band center
     */
    hueWeight(h, center, width = 35) {
        let d = Math.abs(h - center);
        d = Math.min(d, 360 - d); // Circular wrap
        const t = Math.max(0, 1 - d / width);
        return t * t * (3 - 2 * t); // Smoothstep
    }



    /**
     * Approximate maximum chroma for sRGB gamut at given L and h
     * Uses Fourier approximation of the irregular sRGB gamut boundary
     * Hue-dependent: blues are more restricted, reds have more headroom
     */
    approxMaxChroma(L, h) {
        const hRad = h * Math.PI / 180;

        // Hue-dependent envelope (Fourier approx of sRGB gamut)
        // Blues (~255°) get lower max, reds/yellows get higher
        const hueFactor =
            0.28 +
            0.07 * Math.cos(hRad) +
            0.06 * Math.cos(2 * hRad - 0.5);

        // Lightness envelope - midtones allow most chroma
        const lightFactor = Math.sin(Math.PI * Math.min(1, L + 0.05));

        return hueFactor * lightFactor;
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
     * Set Color Mixer value for a band
     * UI values are -100 to +100, converted to engine-normalized values:
     *   hue: -30 to +30 degrees
     *   sat: -1.0 to +1.0 multiplier
     *   lum: -0.3 to +0.3 offset
     * @param {string} band - 'all', 'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'
     * @param {string} property - 'hue', 'sat', 'lum'
     * @param {number} uiValue - -100 to +100 (UI scale)
     */
    setColorMixer(band, property, uiValue) {
        if (!this.colorMixer[band]) return;

        // Clamp UI value
        const clamped = Math.max(-100, Math.min(100, uiValue));

        // Normalize to engine scale
        switch (property) {
            case 'hue':
                this.colorMixer[band].h = (clamped / 100) * 30; // ±30°
                break;
            case 'sat':
                this.colorMixer[band].s = clamped / 100; // ±1.0
                break;
            case 'lum':
                this.colorMixer[band].l = (clamped / 100) * 0.3; // ±0.3
                break;
        }
    }

    /**
     * Get Color Mixer value (returns UI scale -100..100)
     */
    getColorMixer(band, property) {
        if (!this.colorMixer[band]) return 0;

        switch (property) {
            case 'hue':
                return Math.round((this.colorMixer[band].h / 30) * 100);
            case 'sat':
                return Math.round(this.colorMixer[band].s * 100);
            case 'lum':
                return Math.round((this.colorMixer[band].l / 0.3) * 100);
            default:
                return 0;
        }
    }

    /**
     * Check if any color mixer band has non-zero values
     */
    _hasColorMixerChanges() {
        for (const band of Object.values(this.colorMixer)) {
            if (band.h !== 0 || band.s !== 0 || band.l !== 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Set Color Grading value
     * @param {string} wheel - 'shadows', 'midtones', 'highlights'
     * @param {string} property - 'angle', 'strength' OR 'blending', 'balance'
     * @param {number} value - angle: 0-360, strength: 0-100, blending: 0-100, balance: -100 to +100
     */
    setColorGrading(wheel, property, value) {
        if (wheel === 'blending') {
            this.colorGrading.blending = Math.max(0, Math.min(100, value));
        } else if (wheel === 'balance') {
            this.colorGrading.balance = Math.max(-100, Math.min(100, value));
        } else if (this.colorGrading[wheel]) {
            if (property === 'angle') {
                this.colorGrading[wheel].angle = ((value % 360) + 360) % 360;
            } else if (property === 'strength') {
                // UI uses 0-100, internally store 0-1
                this.colorGrading[wheel].strength = Math.max(0, Math.min(1, value / 100));
            }
        }
    }

    /**
     * Get Color Grading value (returns UI scale)
     */
    getColorGrading(wheel, property) {
        if (wheel === 'blending') return this.colorGrading.blending;
        if (wheel === 'balance') return this.colorGrading.balance;
        if (!this.colorGrading[wheel]) return 0;

        if (property === 'angle') return this.colorGrading[wheel].angle;
        if (property === 'strength') return Math.round(this.colorGrading[wheel].strength * 100);
        return 0;
    }

    /**
     * Check if any color grading has non-zero values
     */
    _hasColorGradingChanges() {
        const { shadows, midtones, highlights } = this.colorGrading;
        return shadows.strength > 0 || midtones.strength > 0 || highlights.strength > 0;
    }

    /**
     * Set Detail (Sharpening/Noise) value
     * @param {string} type - 'sharpening' or 'noise'
     * @param {string} property - parameter name
     * @param {number} value - slider value
     */
    setDetail(type, property, value) {
        if (this.detail[type] && property in this.detail[type]) {
            // Validate bounds
            if (property === 'radius') {
                // Radius is 0.5-3.0
                this.detail[type][property] = Math.max(0.5, Math.min(3.0, value));
            } else {
                // All other values 0-100
                this.detail[type][property] = Math.max(0, Math.min(100, value));
            }
        }
    }

    /**
     * Get Detail value
     */
    getDetail(type, property) {
        if (this.detail[type] && property in this.detail[type]) {
            return this.detail[type][property];
        }
        return 0;
    }

    /**
     * Check if any detail adjustments are active
     */
    _hasDetailChanges() {
        const { sharpening, noise } = this.detail;
        return sharpening.amount > 0 ||
            noise.luminance > 0 ||
            noise.color > 0;
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

        // Reset color mixer
        for (const band of Object.keys(this.colorMixer)) {
            this.colorMixer[band] = { h: 0, s: 0, l: 0 };
        }

        // Reset color grading
        this.colorGrading = {
            shadows: { angle: 0, strength: 0 },
            midtones: { angle: 0, strength: 0 },
            highlights: { angle: 0, strength: 0 },
            blending: 50,
            balance: 0
        };

        // Reset detail
        this.detail = {
            sharpening: { amount: 0, radius: 1.0, detail: 25, masking: 0 },
            noise: { luminance: 0, luminanceDetail: 50, luminanceContrast: 0, color: 0, colorDetail: 50, colorSmoothness: 50 }
        };

        // Reset effects
        this.effects = {
            vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 },
            grain: { amount: 0, size: 25, roughness: 50 }
        };
    }

    /**
     * Set effects settings
     */
    setEffects(type, property, value) {
        if (!this.effects) this.effects = { vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 }, grain: { amount: 0, size: 25, roughness: 50 } };
        if (this.effects[type] && this.effects[type][property] !== undefined) {
            this.effects[type][property] = value;
        }
    }

    /**
     * Get effects settings
     */
    getEffects(type, property) {
        if (!this.effects) return 0;
        if (this.effects[type] && this.effects[type][property] !== undefined) {
            return this.effects[type][property];
        }
        return 0;
    }

    /**
     * Check if effects have changes
     */
    _hasEffectsChanges() {
        if (!this.effects) return false;
        const v = this.effects.vignette;
        const g = this.effects.grain;
        return (v && v.amount !== 0) || (g && g.amount !== 0);
    }

    /**
     * Set Preview Mode (e.g. 'sharpenMask')
     */
    setPreviewMode(mode) {
        this.previewMode = mode;
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
        // STEP 8.5: Sharpening (Frequency Separation)
        // Luminance-only, edge-aware mask
        // ============================================================
        const { amount: sharpAmount, radius: sharpRadius, detail: sharpDetail, masking: sharpMasking } = this.detail.sharpening;

        // Preview buffer
        let previewBuffer = null;
        if (this.previewMode === 'sharpenMask') {
            previewBuffer = new Float32Array(pixelCount);
        }

        if (sharpAmount > 0 || this.previewMode === 'sharpenMask') {
            // Extract luminance
            const lum = new Float32Array(pixelCount);
            for (let i = 0; i < pixelCount; i++) {
                lum[i] = this.luminance(linearR[i], linearG[i], linearB[i]);
            }

            // Multi-scale blur
            // Radius perceptual mapping: 0.5-1 crisp, 2-3 halo risk
            const effectiveRadius = 0.6 + Math.pow(sharpRadius / 3, 1.4) * 2.4;

            const blurred = new Float32Array(pixelCount);
            this.applyGaussianSeparable(width, height, lum, blurred, effectiveRadius);

            const detailThreshLow = 0.02;  // Noise floor
            const detailThreshHigh = 0.15; // Strong edge

            // Edge mask threshold (0-1) - Perceptual remap
            const t = sharpMasking / 100;
            const maskThresh = 0.01 + t * t * 0.25;

            for (let i = 0; i < pixelCount; i++) {
                const Y = lum[i];
                const highPass = Y - blurred[i];
                const edgeMag = Math.abs(highPass);

                // Detail Gate: controls which frequencies are sharpened
                const detailFactor = sharpDetail / 100;
                const gate = this.smoothstep(detailThreshLow * (1 - detailFactor * 0.8), detailThreshHigh, edgeMag);

                // Masking: protect smooth areas
                let mask = 1.0;
                if (sharpMasking > 0 || this.previewMode === 'sharpenMask') {
                    mask = this.smoothstep(maskThresh, maskThresh + 0.05, edgeMag);
                }

                // Capture preview
                if (previewBuffer) {
                    previewBuffer[i] = mask;
                }

                // Apply sharpening
                const gain = (sharpAmount / 100) * 2.2; // Reduced from 3.0 for better control
                const sharpY = Y + highPass * gain * gate * mask;

                // Apply via luminance ratio
                [linearR[i], linearG[i], linearB[i]] = this.applyLuminanceRatio(
                    linearR[i], linearG[i], linearB[i], Math.max(0, sharpY)
                );
            }
        }

        // Return Preview if active
        if (this.previewMode === 'sharpenMask' && previewBuffer) {
            const previewData = new ImageData(width, height);
            for (let i = 0; i < pixelCount; i++) {
                // Visualize mask (Black = protected, White = sharpened)
                const v = Math.round(Math.max(0, Math.min(1, previewBuffer[i])) * 255);
                previewData.data[i * 4] = v;
                previewData.data[i * 4 + 1] = v;
                previewData.data[i * 4 + 2] = v;
                previewData.data[i * 4 + 3] = 255;
            }
            return previewData;
        }

        // ============================================================
        // STEP 8.7: Noise Reduction (Luminance & Color)
        // ============================================================
        const { luminance: nrLum, color: nrColor } = this.detail.noise;

        if (nrLum > 0 || nrColor > 0) {
            // 1. Color Noise Reduction (Chroma Blur)
            if (nrColor > 0) {
                // Convert to OKLab
                const L_buf = new Float32Array(pixelCount);
                const a_buf = new Float32Array(pixelCount);
                const b_buf = new Float32Array(pixelCount);

                for (let i = 0; i < pixelCount; i++) {
                    const [L, a, b] = this.linearRGBtoOKLab(linearR[i], linearG[i], linearB[i]);
                    L_buf[i] = L;
                    a_buf[i] = a;
                    b_buf[i] = b;
                }

                // Blur a/b channels only
                const radius = (nrColor / 100) * 10.0;
                const a_blur = new Float32Array(pixelCount);
                const b_blur = new Float32Array(pixelCount);

                this.applyGaussianSeparable(width, height, a_buf, a_blur, radius);
                this.applyGaussianSeparable(width, height, b_buf, b_blur, radius);

                // Recombine
                for (let i = 0; i < pixelCount; i++) {
                    [linearR[i], linearG[i], linearB[i]] = this.OKLabToLinearRGB(
                        L_buf[i], a_blur[i], b_blur[i]
                    );
                    linearR[i] = Math.max(0, linearR[i]);
                    linearG[i] = Math.max(0, linearG[i]);
                    linearB[i] = Math.max(0, linearB[i]);
                }
            }

            // 2. Luminance Noise Reduction (Edge-aware smoothing)
            if (nrLum > 0) {
                // Re-extract L
                const lum = new Float32Array(pixelCount);
                for (let i = 0; i < pixelCount; i++) {
                    lum[i] = this.luminance(linearR[i], linearG[i], linearB[i]);
                }

                const blurRad = (nrLum / 100) * 3.0; // Max 3px radius
                const lumBlurred = new Float32Array(pixelCount);
                this.applyGaussianSeparable(width, height, lum, lumBlurred, blurRad);

                for (let i = 0; i < pixelCount; i++) {
                    const Y = lum[i];
                    const diff = Math.abs(Y - lumBlurred[i]);

                    // Edge detection
                    const threshold = 0.05 * (100 / (nrLum + 1));
                    const edgeWeight = this.smoothstep(0, threshold, diff);

                    const newY = Y * edgeWeight + lumBlurred[i] * (1 - edgeWeight);

                    [linearR[i], linearG[i], linearB[i]] = this.applyLuminanceRatio(
                        linearR[i], linearG[i], linearB[i], Math.max(0, newY)
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
        // STEP 9.5: Color Grading (OKLab - Shadows/Midtones/Highlights)
        // Chromatic bias per tonal range, preserves luminance
        // ============================================================
        if (profile !== 'bw' && this._hasColorGradingChanges()) {
            const { shadows, midtones, highlights, blending, balance } = this.colorGrading;

            // Pre-compute wheel chroma offsets (angle → a,b)
            // Pre-compute wheel chroma offsets (angle → a,b)
            // Scaling factors tuned for perceived balance: Midtones are most expressive
            const SHADOW_SCALE = 0.12;
            const MID_SCALE = 0.18;
            const HIGH_SCALE = 0.15;

            const shadowDa = shadows.strength * Math.cos(shadows.angle * Math.PI / 180) * SHADOW_SCALE;
            const shadowDb = shadows.strength * Math.sin(shadows.angle * Math.PI / 180) * SHADOW_SCALE;
            const midDa = midtones.strength * Math.cos(midtones.angle * Math.PI / 180) * MID_SCALE;
            const midDb = midtones.strength * Math.sin(midtones.angle * Math.PI / 180) * MID_SCALE;
            const highDa = highlights.strength * Math.cos(highlights.angle * Math.PI / 180) * HIGH_SCALE;
            const highDb = highlights.strength * Math.sin(highlights.angle * Math.PI / 180) * HIGH_SCALE;

            // Balance factor: shift toward shadows (-1) or highlights (+1)
            const balanceFactor = balance / 100;

            // Blending factor: how much midtones inherit edge colors
            const blend = blending / 100;

            for (let i = 0; i < pixelCount; i++) {
                // Convert to OKLab
                const [L, a, b] = this.linearRGBtoOKLab(linearR[i], linearG[i], linearB[i]);

                // Log-weighted luminance for more natural tonal separation
                // Matches human perception better than linear L
                const Lp = Math.log(1 + 6 * L) / Math.log(7);

                // Compute tonal weights with smooth transitions
                let shadowW = this.smoothstep(0.35, 0.0, Lp);
                let highlightW = this.smoothstep(0.65, 1.0, Lp);
                let midW = Math.max(0, 1 - shadowW - highlightW);

                // Apply balance shift
                shadowW *= (1 - balanceFactor);
                highlightW *= (1 + balanceFactor);

                // Blending: midtones inherit edge color, edges recede
                midW += blend * (shadowW + highlightW) * 0.5;
                shadowW *= (1 - blend * 0.3);
                highlightW *= (1 - blend * 0.3);

                // Normalize weights for energy conservation
                const sum = shadowW + midW + highlightW;
                if (sum > 0) {
                    const invSum = 1 / sum;
                    shadowW *= invSum;
                    midW *= invSum;
                    highlightW *= invSum;
                }

                // Apply weighted chroma bias (preserve L!)
                let newA = a;
                let newB = b;

                newA += shadowW * shadowDa;
                newB += shadowW * shadowDb;
                newA += midW * midDa;
                newB += midW * midDb;
                newA += highlightW * highDa;
                newB += highlightW * highDb;

                // Gamut safety
                const C = Math.sqrt(newA * newA + newB * newB);
                const h = Math.atan2(newB, newA) * 180 / Math.PI;
                const maxC = this.approxMaxChroma(L, (h + 360) % 360);
                if (C > maxC && C > 0.001) {
                    const scale = maxC / C;
                    newA *= scale;
                    newB *= scale;
                }

                // Convert back to RGB
                [linearR[i], linearG[i], linearB[i]] = this.OKLabToLinearRGB(L, newA, newB);

                // Clamp negatives
                linearR[i] = Math.max(0, linearR[i]);
                linearG[i] = Math.max(0, linearG[i]);
                linearB[i] = Math.max(0, linearB[i]);
            }
        }

        // ============================================================
        // STEP 10: Color Mixer (OKLCh - Professional 8-band processing)
        // Accumulative delta approach with perceptual weighting
        // ============================================================
        if (profile !== 'bw' && this._hasColorMixerChanges()) {
            const bandNames = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
            const allBand = this.colorMixer.all;

            for (let i = 0; i < pixelCount; i++) {
                const r = linearR[i];
                const g = linearG[i];
                const b = linearB[i];

                // Convert to OKLCh (polar form)
                let [L, C, h] = this.linearRGBtoOKLCh(r, g, b);

                // Skip near-black pixels
                if (L < 0.001) continue;

                // Accumulative delta approach
                let dH = 0;
                let dC = 0;
                let dL = 0;

                // Chroma factor: neutrals (low chroma) get less hue rotation
                const chromaFactor = this.smoothstep(0.02, 0.15, C);

                // Luminance factor: protect highlights and shadows (clamped to prevent inversion)
                const lumFactor = Math.max(0, 1 - Math.abs(L - 0.5) * 1.6);

                // Track total band weight for interaction damping
                let weightSum = 0;

                // Apply "All" band first (special rules: less aggressive hue rotation)
                if (allBand.h !== 0 || allBand.s !== 0 || allBand.l !== 0) {
                    const neutralWeight = this.smoothstep(0.04, 0.2, C);
                    dH += allBand.h * neutralWeight * 0.3; // All band hue is subtle
                    dC += allBand.s * neutralWeight * 0.6; // All band sat is moderate
                    dL += allBand.l * neutralWeight;
                    weightSum += neutralWeight;
                }

                // Apply individual bands with accumulative deltas
                for (const bandName of bandNames) {
                    const band = this.colorMixer[bandName];
                    const bandDef = this.COLOR_BANDS[bandName];

                    // Skip if no adjustment
                    if (band.h === 0 && band.s === 0 && band.l === 0) continue;

                    // Calculate weight using proper band width
                    const w = this.hueWeight(h, bandDef.center, bandDef.width);

                    if (w > 0.001) {
                        // Hue rotation (scaled by chroma to protect grays)
                        dH += band.h * w * chromaFactor;

                        // Saturation (chroma multiplier)
                        dC += band.s * w;

                        // Luminance (scaled by lumFactor to protect extremes)
                        dL += band.l * w * lumFactor;

                        // Track weight for damping
                        weightSum += w;
                    }
                }

                // Band interaction damping: normalize when multiple bands overlap
                if (weightSum > 1) {
                    dH /= weightSum;
                    dC /= weightSum;
                    dL /= weightSum;
                }

                // Soft clamp hue rotation to prevent extreme drift
                const MAX_HUE_ROT = 45; // degrees
                dH = Math.max(-MAX_HUE_ROT, Math.min(MAX_HUE_ROT, dH));

                // Compress luminance delta at extremes (diminishing returns)
                dL = dL * (1 - Math.abs(dL) * 0.7);

                // Apply accumulated adjustments
                h += dH;
                C *= (1 + dC);
                L += dL;

                // Wrap hue to 0-360 (circular)
                h = ((h % 360) + 360) % 360;

                // Gamut-aware chroma clamp
                const maxC = this.approxMaxChroma(L, h);
                C = Math.max(0, Math.min(C, maxC));

                // Clamp L
                L = Math.max(0, Math.min(1, L));

                // Convert back to Linear RGB
                [linearR[i], linearG[i], linearB[i]] = this.OKLChToLinearRGB(L, C, h);

                // Clamp to prevent negative RGB (OKLab can produce out-of-gamut values)
                linearR[i] = Math.max(0, linearR[i]);
                linearG[i] = Math.max(0, linearG[i]);
                linearB[i] = Math.max(0, linearB[i]);
            }
        }

        // ============================================================
        // STEP 11: Vibrance (OKLab - perceptually uniform)
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

                // Hue-aware protection: dampen vibrance in sensitive hue ranges
                // Skin tones (~20-45° in OKLab hue) and deep blues (~230-270°)
                const hueDeg = (hueAngle * 180 / Math.PI + 360) % 360;
                let hueProtection = 1;

                // Skin tone protection (red-orange hues)
                if (hueDeg >= 15 && hueDeg <= 50) {
                    const skinCenter = 32.5;
                    const dist = Math.abs(hueDeg - skinCenter) / 17.5;
                    hueProtection *= 0.6 + 0.4 * dist; // 40% reduction at center
                }

                // Deep blue protection
                if (hueDeg >= 220 && hueDeg <= 280) {
                    const blueCenter = 250;
                    const dist = Math.abs(hueDeg - blueCenter) / 30;
                    hueProtection *= 0.6 + 0.4 * dist; // 40% reduction at center
                }

                // Luminance damping: protect highlights and shadows from over-boost
                const lumDamp = Math.max(0, 1 - Math.abs(L - 0.5) * 1.4);
                const boost = 1 + vibranceAmount * (1 - normalizedChroma) * 0.5 * hueProtection * lumDamp;

                // Scale a and b (chroma dimensions) while preserving L
                const newA = a * boost;
                const newB = B * boost;

                // Convert back to Linear RGB
                [linearR[i], linearG[i], linearB[i]] = this.OKLabToLinearRGB(L, newA, newB);

                // Clamp to prevent negative RGB
                linearR[i] = Math.max(0, linearR[i]);
                linearG[i] = Math.max(0, linearG[i]);
                linearB[i] = Math.max(0, linearB[i]);
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

                // Clamp to prevent negative RGB
                linearR[i] = Math.max(0, linearR[i]);
                linearG[i] = Math.max(0, linearG[i]);
                linearB[i] = Math.max(0, linearB[i]);
            }
        }

        // ============================================================
        // STEP 8.8: Effects (Vignette & Grain)
        // Pipeline: Sharpen -> NR -> Vignette -> Grain -> Gamma
        // ============================================================

        // 1. Post-Crop Vignette (Highlight Priority)
        if (!this.effects) {
            this.effects = {
                vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 },
                grain: { amount: 0, size: 25, roughness: 50 }
            };
        }
        const { amount: vigAmount, midpoint: vigMid, roundness: vigRound, feather: vigFeather, highlights: vigHigh } = this.effects.vignette;

        if (vigAmount !== 0) {
            const aspect = width / height;
            // Midpoint & Feather remapping
            const midpoint = vigMid / 100;
            const feather = vigFeather / 100;
            const amount = vigAmount / 100; // -1 to +1

            for (let i = 0; i < pixelCount; i++) {
                const x = i % width;
                const y = Math.floor(i / width);

                // Normalized coords (-1 to +1)
                const nx = (x + 0.5) / width * 2 - 1;
                const ny = (y + 0.5) / height * 2 - 1;

                // Roundness mapping
                let rx = nx;
                let ry = ny;
                if (vigRound > 0) {
                    ry *= Math.pow(aspect, vigRound / 100);
                } else if (vigRound < 0) {
                    rx *= Math.pow(aspect, -vigRound / 100);
                }

                // Distance field
                let d = Math.sqrt(rx * rx + ry * ry);
                d = Math.min(1, d);

                // Perceptual falloff
                // t = 0 (center) -> 1 (edge)
                let t = (d - midpoint) / Math.max(1e-4, 1 - midpoint);
                t = Math.max(0, Math.min(1, t));

                // Feather (smoothstep exponent)
                const featherExp = 1 + feather * 4;
                t = Math.pow(t, featherExp);

                // Highlight protection
                if (vigHigh > 0 && amount < 0) { // Only protect if darkening
                    const lum = this.luminance(linearR[i], linearG[i], linearB[i]);
                    // Protect highlights: 0.6 -> 0.95 range
                    const highlightProtect = this.smoothstep(0.6, 0.95, lum);
                    // Reduce vignette effect where high is protected
                    t = t * (1 - highlightProtect * (vigHigh / 100));
                }

                // Apply vignette (Luminance scaling)
                let vignetteFactor = 1.0;
                if (amount < 0) {
                    vignetteFactor = 1 - (t * Math.abs(amount));
                } else {
                    vignetteFactor = 1 + (t * amount * 2.0);
                }

                // Apply via luminance ratio
                const lum = this.luminance(linearR[i], linearG[i], linearB[i]);
                const newLum = lum * Math.max(0, vignetteFactor);

                [linearR[i], linearG[i], linearB[i]] = this.applyLuminanceRatio(
                    linearR[i], linearG[i], linearB[i], newLum
                );
            }
        }

        // 2. Film Grain (Luminance-dependent)
        const { amount: grainAmount, size: grainSize, roughness: grainRough } = this.effects.grain;

        if (grainAmount > 0) {
            const size = Math.max(1, grainSize / 25 * 2.0); // Scale factor
            const seed = 1337;

            // Inline grain synthesis for performance
            for (let i = 0; i < pixelCount; i++) {
                const x = i % width;
                const y = Math.floor(i / width);

                // Sample pos
                const gx = x / size;
                const gy = y / size;

                // Simple high-freq noise (approximation of film structure)
                const n = Math.sin((gx + seed) * 12.9898 + (gy + seed) * 78.233) * 43758.5453;
                const g = n - Math.floor(n); // 0..1

                // Luminance weight (Grain lives in midtones, dies in shadows/highlights)
                const lum = this.luminance(linearR[i], linearG[i], linearB[i]);
                const grainWeight = this.smoothstep(0.02, 0.2, lum) * (1.0 - this.smoothstep(0.8, 1.0, lum));

                const grainValue = (g - 0.5) * (grainAmount / 100) * grainWeight * 0.5;

                // Apply additively
                linearR[i] += grainValue;
                linearG[i] += grainValue;
                linearB[i] += grainValue;
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
            this.settings.saturation !== 0 ||
            this._hasColorMixerChanges() ||
            this._hasEffectsChanges();
    }
}
