/**
 * ImageDevelopment - Professional Image Development Pipeline
 * 
 * Implements a proper color science pipeline:
 * sRGB→Linear → WB → Exposure → Tone → Presence → Color → Linear→sRGB
 * 
 * All adjustments are non-destructive (stored as parameters).
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

        const {
            profile,
            temperature, tint,
            exposure, contrast,
            highlights, shadows, whites, blacks,
            texture, clarity, dehaze,
            vibrance, saturation
        } = this.settings;

        // Step 1: Apply per-pixel adjustments first
        const tempResult = new ImageData(width, height);
        const tempData = tempResult.data;

        // Precompute adjustment factors
        const tempFactor = 1 + (temperature / 100) * 0.3;
        const tintFactor = 1 + (tint / 100) * 0.2;
        const exposureGain = Math.pow(2, exposure);
        const contrastFactor = 1 + contrast / 100;
        const highlightAmount = highlights / 100;
        const shadowAmount = shadows / 100;
        const whiteAmount = whites / 200;
        const blackAmount = blacks / 200;
        const dehazeAmount = dehaze / 100;
        const vibranceAmount = vibrance / 100;
        const saturationFactor = 1 + saturation / 100;

        // Process each pixel (per-pixel operations)
        for (let i = 0; i < srcData.length; i += 4) {
            let r = this.sRGBtoLinear(srcData[i]);
            let g = this.sRGBtoLinear(srcData[i + 1]);
            let b = this.sRGBtoLinear(srcData[i + 2]);
            const a = srcData[i + 3];

            // White Balance
            r *= tempFactor;
            b *= 1 / tempFactor;
            g *= tintFactor;

            // Exposure
            r *= exposureGain;
            g *= exposureGain;
            b *= exposureGain;

            // Tone adjustments
            let lum = this.luminance(r, g, b);

            if (highlightAmount !== 0 && lum > 0.5) {
                const factor = this.smoothstep(0.5, 1.0, lum);
                const adjustment = 1 - highlightAmount * factor * 0.5;
                r *= adjustment;
                g *= adjustment;
                b *= adjustment;
            }

            if (shadowAmount !== 0 && lum < 0.5) {
                const factor = this.smoothstep(0.5, 0.0, lum);
                const lift = shadowAmount * factor * 0.3;
                r += lift;
                g += lift;
                b += lift;
            }

            if (whiteAmount !== 0) {
                const factor = this.smoothstep(0.7, 1.0, lum);
                r += whiteAmount * factor;
                g += whiteAmount * factor;
                b += whiteAmount * factor;
            }

            if (blackAmount !== 0) {
                const factor = this.smoothstep(0.3, 0.0, lum);
                r += blackAmount * factor;
                g += blackAmount * factor;
                b += blackAmount * factor;
            }

            // Contrast
            const MIDDLE_GRAY = 0.18;
            r = (r - MIDDLE_GRAY) * contrastFactor + MIDDLE_GRAY;
            g = (g - MIDDLE_GRAY) * contrastFactor + MIDDLE_GRAY;
            b = (b - MIDDLE_GRAY) * contrastFactor + MIDDLE_GRAY;

            // Dehaze
            if (dehazeAmount !== 0) {
                const dehazeContrast = 1 + dehazeAmount * 0.3;
                r = (r - MIDDLE_GRAY) * dehazeContrast + MIDDLE_GRAY;
                g = (g - MIDDLE_GRAY) * dehazeContrast + MIDDLE_GRAY;
                b = (b - MIDDLE_GRAY) * dehazeContrast + MIDDLE_GRAY - dehazeAmount * 0.05;
            }

            // Apply Tone Curve LUTs
            if (this.curveLUTs) {
                // Clamp to 0-1 for LUT lookup
                r = Math.max(0, Math.min(1, r));
                g = Math.max(0, Math.min(1, g));
                b = Math.max(0, Math.min(1, b));

                // Apply RGB curve in a COLOR-PRESERVING way
                // Instead of applying the curve to each channel independently,
                // we apply it to the luminance and scale all channels proportionally
                const rgbLUT = this.curveLUTs.rgb;
                const lumBefore = this.luminance(r, g, b);

                if (lumBefore > 0.001) {
                    // Get the curve adjustment for this luminance value
                    const lumAfter = rgbLUT[Math.round(lumBefore * 255)];
                    // Scale factor to preserve color ratios
                    const scale = lumAfter / lumBefore;
                    r *= scale;
                    g *= scale;
                    b *= scale;
                } else {
                    // For very dark pixels, apply directly
                    const lumIdx = Math.round(lumBefore * 255);
                    const adjustment = rgbLUT[lumIdx] - lumBefore;
                    r += adjustment;
                    g += adjustment;
                    b += adjustment;
                }

                // Apply per-channel curves (for color grading - these DO work independently)
                r = Math.max(0, Math.min(1, r));
                g = Math.max(0, Math.min(1, g));
                b = Math.max(0, Math.min(1, b));

                const rLUT = this.curveLUTs.r;
                const gLUT = this.curveLUTs.g;
                const bLUT = this.curveLUTs.b;
                r = rLUT[Math.round(r * 255)];
                g = gLUT[Math.round(g * 255)];
                b = bLUT[Math.round(b * 255)];
            }

            // Store intermediate result (still in linear space as 0-255 for simplicity)
            tempData[i] = Math.max(0, Math.min(255, r * 255));
            tempData[i + 1] = Math.max(0, Math.min(255, g * 255));
            tempData[i + 2] = Math.max(0, Math.min(255, b * 255));
            tempData[i + 3] = a;
        }

        // Step 2: Apply Texture and Clarity (local contrast operations)
        let processedData = tempData;

        if (texture !== 0 || clarity !== 0) {
            processedData = this._applyLocalContrast(tempData, width, height, texture, clarity);
        }

        // Step 3: Final pass - Profile, Vibrance, Saturation, and gamma
        const result = new ImageData(width, height);
        const destData = result.data;

        for (let i = 0; i < processedData.length; i += 4) {
            // Convert back to linear 0-1
            let r = processedData[i] / 255;
            let g = processedData[i + 1] / 255;
            let b = processedData[i + 2] / 255;
            const a = processedData[i + 3];

            // Profile
            if (profile === 'bw') {
                const gray = this.luminance(r, g, b);
                r = g = b = gray;
            } else if (profile === 'hdr') {
                r = r / (1 + r);
                g = g / (1 + g);
                b = b / (1 + b);
            }

            // Vibrance
            if (vibranceAmount !== 0 && profile !== 'bw') {
                const avg = (r + g + b) / 3;
                const maxC = Math.max(r, g, b);
                const minC = Math.min(r, g, b);
                const currentSat = maxC > 0 ? (maxC - minC) / maxC : 0;
                const boost = vibranceAmount * (1 - currentSat) * 0.5;
                r = avg + (r - avg) * (1 + boost);
                g = avg + (g - avg) * (1 + boost);
                b = avg + (b - avg) * (1 + boost);
            }

            // Saturation
            if (saturationFactor !== 1 && profile !== 'bw') {
                const gray = this.luminance(r, g, b);
                r = gray + (r - gray) * saturationFactor;
                g = gray + (g - gray) * saturationFactor;
                b = gray + (b - gray) * saturationFactor;
            }

            // Convert to sRGB
            destData[i] = this.linearToSRGB(Math.max(0, r));
            destData[i + 1] = this.linearToSRGB(Math.max(0, g));
            destData[i + 2] = this.linearToSRGB(Math.max(0, b));
            destData[i + 3] = a;
        }

        return result;
    }

    /**
     * Apply local contrast (Texture & Clarity) using high-pass filter approach
     */
    _applyLocalContrast(data, width, height, texture, clarity) {
        const result = new Uint8ClampedArray(data);

        // Extract luminance channel
        const lum = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            lum[i] = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
        }

        // Apply Texture (high-frequency: small radius ~3px)
        if (texture !== 0) {
            const blurredSmall = this._boxBlur(lum, width, height, 3);
            const textureAmount = texture / 100 * 0.5;

            for (let i = 0; i < width * height; i++) {
                const highPass = lum[i] - blurredSmall[i];
                const boost = highPass * textureAmount;
                const idx = i * 4;
                result[idx] = Math.max(0, Math.min(255, data[idx] + boost));
                result[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + boost));
                result[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + boost));
            }
        }

        // Apply Clarity (mid-frequency: larger radius ~15px)
        if (clarity !== 0) {
            // Re-extract lum from current result
            const lumCurrent = new Float32Array(width * height);
            for (let i = 0; i < width * height; i++) {
                const idx = i * 4;
                lumCurrent[i] = 0.2126 * result[idx] + 0.7152 * result[idx + 1] + 0.0722 * result[idx + 2];
            }

            const blurredLarge = this._boxBlur(lumCurrent, width, height, 15);
            const clarityAmount = clarity / 100 * 0.7;

            for (let i = 0; i < width * height; i++) {
                const highPass = lumCurrent[i] - blurredLarge[i];
                const boost = highPass * clarityAmount;
                const idx = i * 4;
                result[idx] = Math.max(0, Math.min(255, result[idx] + boost));
                result[idx + 1] = Math.max(0, Math.min(255, result[idx + 1] + boost));
                result[idx + 2] = Math.max(0, Math.min(255, result[idx + 2] + boost));
            }
        }

        return result;
    }

    /**
     * Simple box blur for local contrast operations
     */
    _boxBlur(data, width, height, radius) {
        const result = new Float32Array(width * height);
        const size = radius * 2 + 1;
        const div = size * size;

        // Horizontal pass
        const temp = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let dx = -radius; dx <= radius; dx++) {
                    const sx = Math.max(0, Math.min(width - 1, x + dx));
                    sum += data[y * width + sx];
                }
                temp[y * width + x] = sum / size;
            }
        }

        // Vertical pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    const sy = Math.max(0, Math.min(height - 1, y + dy));
                    sum += temp[sy * width + x];
                }
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
