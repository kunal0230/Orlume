/**
 * AlbedoEstimator.js - Extract Base Color Without Lighting
 * 
 * Estimates the diffuse albedo (true surface color) by removing
 * the existing shading from the photograph. This prevents
 * double-lighting artifacts when applying new lighting.
 */

export class AlbedoEstimator {
    constructor() {
        this.width = 0;
        this.height = 0;
    }

    /**
     * Estimate albedo from image and lighting estimation
     * @param {ImageData} imageData - Original photograph
     * @param {Float32Array} normals - Surface normals (nx, ny, nz)
     * @param {Object} options - Configuration
     * @returns {ImageData} Estimated albedo
     */
    estimate(imageData, normals, options = {}) {
        const {
            assumedLightDir = { x: 0, y: -0.3, z: 0.95 }, // Default: slight top light
            shadowRecovery = 0.3,  // How much to brighten shadows
            preserveColor = 0.85,  // How much original color to keep (1 = all)
        } = options;

        this.width = imageData.width;
        this.height = imageData.height;

        console.log('🎨 Estimating albedo...');

        const data = imageData.data;
        const albedo = new ImageData(this.width, this.height);
        const albedoData = albedo.data;

        // Normalize assumed light direction
        const lLen = Math.sqrt(
            assumedLightDir.x ** 2 +
            assumedLightDir.y ** 2 +
            assumedLightDir.z ** 2
        );
        const L = {
            x: assumedLightDir.x / lLen,
            y: assumedLightDir.y / lLen,
            z: assumedLightDir.z / lLen,
        };

        for (let i = 0; i < this.width * this.height; i++) {
            const pIdx = i * 4;
            const nIdx = i * 3;

            // Get normal
            const nx = normals[nIdx];
            const ny = normals[nIdx + 1];
            const nz = normals[nIdx + 2];

            // Estimate current lighting contribution (N·L)
            const NdotL = Math.max(0.1, nx * L.x + ny * L.y + nz * L.z);

            // Original colors
            const r = data[pIdx] / 255;
            const g = data[pIdx + 1] / 255;
            const b = data[pIdx + 2] / 255;

            // Estimate albedo by dividing out the lighting
            // albedo = observed_color / (lighting_contribution)
            // Add shadow recovery to prevent extreme darkening
            const lightFactor = NdotL + shadowRecovery * (1 - NdotL);

            let ar = r / lightFactor;
            let ag = g / lightFactor;
            let ab = b / lightFactor;

            // Blend with original to preserve some color variation
            ar = ar * (1 - preserveColor) + r * preserveColor;
            ag = ag * (1 - preserveColor) + g * preserveColor;
            ab = ab * (1 - preserveColor) + b * preserveColor;

            // Clamp and convert back
            albedoData[pIdx] = Math.min(255, Math.max(0, Math.floor(ar * 255)));
            albedoData[pIdx + 1] = Math.min(255, Math.max(0, Math.floor(ag * 255)));
            albedoData[pIdx + 2] = Math.min(255, Math.max(0, Math.floor(ab * 255)));
            albedoData[pIdx + 3] = 255;
        }

        console.log('✅ Albedo estimated');

        return albedo;
    }

    /**
     * Simple albedo: Just use original image with reduced contrast
     * Use this as fallback if normal-based estimation is too aggressive
     */
    estimateSimple(imageData, options = {}) {
        const {
            contrastReduction = 0.2,  // How much to reduce contrast
            brightnessBoost = 0.1,    // How much to brighten
        } = options;

        this.width = imageData.width;
        this.height = imageData.height;

        const data = imageData.data;
        const albedo = new ImageData(this.width, this.height);
        const albedoData = albedo.data;

        for (let i = 0; i < this.width * this.height; i++) {
            const pIdx = i * 4;

            // Get colors normalized
            const r = data[pIdx] / 255;
            const g = data[pIdx + 1] / 255;
            const b = data[pIdx + 2] / 255;

            // Reduce contrast (pull toward 0.5)
            const ar = 0.5 + (r - 0.5) * (1 - contrastReduction) + brightnessBoost;
            const ag = 0.5 + (g - 0.5) * (1 - contrastReduction) + brightnessBoost;
            const ab = 0.5 + (b - 0.5) * (1 - contrastReduction) + brightnessBoost;

            // Clamp and store
            albedoData[pIdx] = Math.min(255, Math.max(0, Math.floor(ar * 255)));
            albedoData[pIdx + 1] = Math.min(255, Math.max(0, Math.floor(ag * 255)));
            albedoData[pIdx + 2] = Math.min(255, Math.max(0, Math.floor(ab * 255)));
            albedoData[pIdx + 3] = 255;
        }

        return albedo;
    }
}

export default AlbedoEstimator;
