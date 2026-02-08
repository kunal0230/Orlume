/**
 * ColorSpaceConverter.js - v8 Relighting System
 * 
 * Handles sRGB ↔ Linear color space conversions.
 * CRITICAL: All lighting math must be done in linear space.
 * 
 * sRGB photos are gamma-encoded. Multiplying in sRGB = wrong energy/colors.
 */

export class ColorSpaceConverter {
    constructor() {
        // Precompute lookup table for faster conversion
        this.srgbToLinearLUT = this._buildSRGBToLinearLUT();
        this.linearToSRGBLUT = this._buildLinearToSRGBLUT();
    }

    /**
     * Convert sRGB ImageData to linear light space
     * @param {ImageData} imageData - sRGB encoded image
     * @returns {Float32Array} Linear RGB values (3 channels, 0-1 range)
     */
    sRGBToLinear(imageData) {
        const { data, width, height } = imageData;
        const pixels = width * height;
        const linear = new Float32Array(pixels * 3);

        for (let i = 0; i < pixels; i++) {
            const srcIdx = i * 4;
            const dstIdx = i * 3;

            // Use LUT for speed
            linear[dstIdx] = this.srgbToLinearLUT[data[srcIdx]];
            linear[dstIdx + 1] = this.srgbToLinearLUT[data[srcIdx + 1]];
            linear[dstIdx + 2] = this.srgbToLinearLUT[data[srcIdx + 2]];
        }

        return linear;
    }

    /**
     * Convert linear RGB to sRGB ImageData
     * @param {Float32Array} linear - Linear RGB values
     * @param {number} width
     * @param {number} height
     * @returns {ImageData}
     */
    linearToSRGB(linear, width, height) {
        const pixels = width * height;
        const data = new Uint8ClampedArray(pixels * 4);

        for (let i = 0; i < pixels; i++) {
            const srcIdx = i * 3;
            const dstIdx = i * 4;

            // Convert and clamp
            data[dstIdx] = this._linearChannelToSRGBByte(linear[srcIdx]);
            data[dstIdx + 1] = this._linearChannelToSRGBByte(linear[srcIdx + 1]);
            data[dstIdx + 2] = this._linearChannelToSRGBByte(linear[srcIdx + 2]);
            data[dstIdx + 3] = 255; // Full alpha
        }

        return new ImageData(data, width, height);
    }

    /**
     * Convert a single sRGB channel value to linear
     * @param {number} c - sRGB value (0-255)
     * @returns {number} Linear value (0-1)
     */
    sRGBChannelToLinear(c) {
        const normalized = c / 255.0;
        if (normalized <= 0.04045) {
            return normalized / 12.92;
        }
        return Math.pow((normalized + 0.055) / 1.055, 2.4);
    }

    /**
     * Convert a single linear channel value to sRGB
     * @param {number} c - Linear value (0-1)
     * @returns {number} sRGB value (0-255)
     */
    linearChannelToSRGB(c) {
        // Clamp to valid range
        c = Math.max(0, Math.min(1, c));

        if (c <= 0.0031308) {
            return c * 12.92;
        }
        return 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
    }

    /**
     * Convert linear to sRGB byte (0-255)
     */
    _linearChannelToSRGBByte(c) {
        const srgb = this.linearChannelToSRGB(c);
        return Math.round(srgb * 255);
    }

    /**
     * Build sRGB → Linear lookup table (256 entries)
     */
    _buildSRGBToLinearLUT() {
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            lut[i] = this.sRGBChannelToLinear(i);
        }
        return lut;
    }

    /**
     * Build Linear → sRGB lookup table (1024 entries for precision)
     */
    _buildLinearToSRGBLUT() {
        const size = 1024;
        const lut = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
            const linear = i / (size - 1);
            lut[i] = this._linearChannelToSRGBByte(linear);
        }
        return lut;
    }

    /**
     * Get GLSL code for sRGB ↔ Linear conversion
     * For use in GPU shaders
     */
    static getGLSLFunctions() {
        return `
// sRGB to Linear conversion
vec3 sRGBToLinear(vec3 srgb) {
    vec3 low = srgb / 12.92;
    vec3 high = pow((srgb + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(0.04045, srgb));
}

// Linear to sRGB conversion
vec3 linearToSRGB(vec3 linear) {
    vec3 low = linear * 12.92;
    vec3 high = 1.055 * pow(linear, vec3(1.0/2.4)) - 0.055;
    return mix(low, high, step(0.0031308, linear));
}
`;
    }

    /**
     * Process image: apply function in linear space
     * Handles the full sRGB → Linear → Process → sRGB pipeline
     * 
     * @param {ImageData} imageData - Input sRGB image
     * @param {Function} processFunc - Function(linearRGB, width, height) => linearRGB
     * @returns {ImageData} Processed sRGB image
     */
    processInLinearSpace(imageData, processFunc) {
        const { width, height } = imageData;

        // Convert to linear
        const linear = this.sRGBToLinear(imageData);

        // Process
        const processed = processFunc(linear, width, height);

        // Convert back to sRGB
        return this.linearToSRGB(processed, width, height);
    }

    /**
     * Create a linear-space Float32 canvas for GPU operations
     */
    createLinearCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', {
            colorSpace: 'display-p3', // Wider gamut if available
            willReadFrequently: true
        });

        return { canvas, ctx };
    }
}

export default ColorSpaceConverter;
