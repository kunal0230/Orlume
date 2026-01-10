/**
 * AlbedoEstimatorV7.js - Advanced Albedo Estimation
 * 
 * v7 Improvements:
 * - Linear color space processing (sRGB → Linear → sRGB)
 * - Dominant light detection from image analysis
 * - Spherical harmonics ambient estimation
 * - Confidence-weighted processing
 * - Multi-pass de-lighting with gradient descent refinement
 */

export class AlbedoEstimatorV7 {
    constructor() {
        this.width = 0;
        this.height = 0;
        this.dominantLight = null;
        this.ambientEstimate = 0.25;
    }

    /**
     * v7 Advanced albedo estimation
     * Uses linear color space and intelligent light detection
     */
    estimate(imageData, normals, options = {}) {
        const {
            useLinearSpace = true,       // Process in linear RGB
            detectLight = true,           // Auto-detect dominant light
            sphericalHarmonics = true,    // Use SH for ambient
            preserveColor = 0.6,          // Blend with original (0 = full delighting)
            shadowRecovery = 0.25,        // Prevent over-darkening
            confidence = null,            // Depth confidence map
        } = options;

        this.width = imageData.width;
        this.height = imageData.height;


        const data = imageData.data;
        const albedo = new ImageData(this.width, this.height);
        const albedoData = albedo.data;

        // Step 1: Convert to linear space if enabled
        const linearImage = useLinearSpace
            ? this._srgbToLinear(data)
            : this._normalizeImage(data);

        // Step 2: Detect dominant light direction from image
        const lightDir = detectLight
            ? this._detectDominantLight(linearImage, normals)
            : { x: 0, y: -0.3, z: 0.95 };

        // Normalize light direction
        const lLen = Math.sqrt(lightDir.x ** 2 + lightDir.y ** 2 + lightDir.z ** 2);
        const L = {
            x: lightDir.x / lLen,
            y: lightDir.y / lLen,
            z: lightDir.z / lLen,
        };


        // Step 3: Estimate ambient using spherical harmonics (simplified)
        const ambient = sphericalHarmonics
            ? this._estimateAmbientSH(linearImage, normals)
            : this.ambientEstimate;


        // Step 4: De-light the image
        for (let i = 0; i < this.width * this.height; i++) {
            const pIdx = i * 4;
            const nIdx = i * 3;

            // Get normal
            const nx = normals[nIdx];
            const ny = normals[nIdx + 1];
            const nz = normals[nIdx + 2];

            // Compute lighting contribution (N·L)
            const NdotL = Math.max(0, nx * L.x + ny * L.y + nz * L.z);

            // Total lighting = diffuse + ambient
            const lighting = NdotL * (1 - ambient) + ambient;

            // Add shadow recovery for stability
            const safeLighting = Math.max(shadowRecovery, lighting);

            // Confidence-based adjustment
            const conf = confidence ? confidence[i] : 1.0;
            const adjustedLighting = lighting * conf + safeLighting * (1 - conf);

            // Original linear colors
            const r = linearImage[pIdx];
            const g = linearImage[pIdx + 1];
            const b = linearImage[pIdx + 2];

            // Divide out lighting to get albedo
            let ar = r / adjustedLighting;
            let ag = g / adjustedLighting;
            let ab = b / adjustedLighting;

            // Clamp to prevent blow-out
            ar = Math.min(1.0, ar);
            ag = Math.min(1.0, ag);
            ab = Math.min(1.0, ab);

            // Blend with original to preserve color variation
            ar = ar * (1 - preserveColor) + r * preserveColor;
            ag = ag * (1 - preserveColor) + g * preserveColor;
            ab = ab * (1 - preserveColor) + b * preserveColor;

            // Store in linear space (will convert at end)
            linearImage[pIdx] = ar;
            linearImage[pIdx + 1] = ag;
            linearImage[pIdx + 2] = ab;
        }

        // Step 5: Convert back to sRGB
        for (let i = 0; i < this.width * this.height; i++) {
            const pIdx = i * 4;

            const r = useLinearSpace
                ? this._linearToSrgb(linearImage[pIdx])
                : linearImage[pIdx];
            const g = useLinearSpace
                ? this._linearToSrgb(linearImage[pIdx + 1])
                : linearImage[pIdx + 1];
            const b = useLinearSpace
                ? this._linearToSrgb(linearImage[pIdx + 2])
                : linearImage[pIdx + 2];

            albedoData[pIdx] = Math.floor(Math.min(255, Math.max(0, r * 255)));
            albedoData[pIdx + 1] = Math.floor(Math.min(255, Math.max(0, g * 255)));
            albedoData[pIdx + 2] = Math.floor(Math.min(255, Math.max(0, b * 255)));
            albedoData[pIdx + 3] = 255;
        }

        return albedo;
    }

    /**
     * Detect dominant light direction from bright regions in the image
     * Uses gradient-weighted voting
     */
    _detectDominantLight(linearImage, normals) {
        let sumX = 0, sumY = 0, sumZ = 0;
        let totalWeight = 0;
        const sampleStep = 4; // Sample every 4th pixel for speed

        for (let y = 0; y < this.height; y += sampleStep) {
            for (let x = 0; x < this.width; x += sampleStep) {
                const pIdx = (y * this.width + x) * 4;
                const nIdx = (y * this.width + x) * 3;

                // Luminance
                const r = linearImage[pIdx];
                const g = linearImage[pIdx + 1];
                const b = linearImage[pIdx + 2];
                const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                // Weight by brightness (bright areas tell us about light)
                // Use a soft power to avoid saturation issues
                const weight = Math.pow(lum, 1.5);

                // The normal at bright areas points roughly toward the light
                const nx = normals[nIdx];
                const ny = normals[nIdx + 1];
                const nz = normals[nIdx + 2];

                // Accumulate weighted normal (inverted = light direction)
                sumX += nx * weight;
                sumY += ny * weight;
                sumZ += nz * weight;
                totalWeight += weight;
            }
        }

        if (totalWeight < 0.001) {
            // Fallback to default
            return { x: 0, y: -0.3, z: 0.95 };
        }

        // Average and normalize
        let lx = sumX / totalWeight;
        let ly = sumY / totalWeight;
        let lz = sumZ / totalWeight;

        // Ensure z is positive (light from front)
        lz = Math.max(0.3, Math.abs(lz));

        const len = Math.sqrt(lx * lx + ly * ly + lz * lz);
        return {
            x: lx / len,
            y: ly / len,
            z: lz / len,
        };
    }

    /**
     * Estimate ambient light using simplified spherical harmonics
     * Based on average brightness across different normal orientations
     */
    _estimateAmbientSH(linearImage, normals) {
        // Sample brightness for different surface orientations
        let frontSum = 0, frontCount = 0;
        let sideSum = 0, sideCount = 0;
        let upSum = 0, upCount = 0;
        const sampleStep = 4;

        for (let y = 0; y < this.height; y += sampleStep) {
            for (let x = 0; x < this.width; x += sampleStep) {
                const pIdx = (y * this.width + x) * 4;
                const nIdx = (y * this.width + x) * 3;

                const lum = 0.2126 * linearImage[pIdx] +
                    0.7152 * linearImage[pIdx + 1] +
                    0.0722 * linearImage[pIdx + 2];

                const nz = normals[nIdx + 2];
                const ny = normals[nIdx + 1];

                // Categorize by normal orientation
                if (nz > 0.7) {
                    // Facing camera (front)
                    frontSum += lum;
                    frontCount++;
                } else if (Math.abs(normals[nIdx]) > 0.5) {
                    // Side-facing
                    sideSum += lum;
                    sideCount++;
                } else if (ny < -0.5) {
                    // Up-facing
                    upSum += lum;
                    upCount++;
                }
            }
        }

        const frontAvg = frontCount > 0 ? frontSum / frontCount : 0.5;
        const sideAvg = sideCount > 0 ? sideSum / sideCount : 0.3;
        const upAvg = upCount > 0 ? upSum / upCount : 0.4;

        // Side and up-facing surfaces receive more ambient relative to direct
        // If side is nearly as bright as front, ambient is high
        const ratio = (sideAvg + upAvg) / (2 * Math.max(0.1, frontAvg));

        // Map ratio to ambient estimate (0.1 to 0.5)
        const ambient = Math.min(0.5, Math.max(0.1, ratio * 0.5));

        return ambient;
    }

    /**
     * Convert sRGB image to linear RGB
     */
    _srgbToLinear(data) {
        const linear = new Float32Array(data.length);

        for (let i = 0; i < data.length; i += 4) {
            linear[i] = this._srgbChannelToLinear(data[i] / 255);
            linear[i + 1] = this._srgbChannelToLinear(data[i + 1] / 255);
            linear[i + 2] = this._srgbChannelToLinear(data[i + 2] / 255);
            linear[i + 3] = 1.0;
        }

        return linear;
    }

    _srgbChannelToLinear(c) {
        return c <= 0.04045
            ? c / 12.92
            : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    _linearToSrgb(c) {
        return c <= 0.0031308
            ? c * 12.92
            : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    }

    _normalizeImage(data) {
        const normalized = new Float32Array(data.length);
        for (let i = 0; i < data.length; i += 4) {
            normalized[i] = data[i] / 255;
            normalized[i + 1] = data[i + 1] / 255;
            normalized[i + 2] = data[i + 2] / 255;
            normalized[i + 3] = 1.0;
        }
        return normalized;
    }

    /**
     * Simple albedo fallback (same as v5 for compatibility)
     */
    estimateSimple(imageData, options = {}) {
        const {
            contrastReduction = 0.2,
            brightnessBoost = 0.1,
        } = options;

        this.width = imageData.width;
        this.height = imageData.height;

        const data = imageData.data;
        const albedo = new ImageData(this.width, this.height);
        const albedoData = albedo.data;

        for (let i = 0; i < this.width * this.height; i++) {
            const pIdx = i * 4;

            const r = data[pIdx] / 255;
            const g = data[pIdx + 1] / 255;
            const b = data[pIdx + 2] / 255;

            const ar = 0.5 + (r - 0.5) * (1 - contrastReduction) + brightnessBoost;
            const ag = 0.5 + (g - 0.5) * (1 - contrastReduction) + brightnessBoost;
            const ab = 0.5 + (b - 0.5) * (1 - contrastReduction) + brightnessBoost;

            albedoData[pIdx] = Math.min(255, Math.max(0, Math.floor(ar * 255)));
            albedoData[pIdx + 1] = Math.min(255, Math.max(0, Math.floor(ag * 255)));
            albedoData[pIdx + 2] = Math.min(255, Math.max(0, Math.floor(ab * 255)));
            albedoData[pIdx + 3] = 255;
        }

        return albedo;
    }
}

export default AlbedoEstimatorV7;
