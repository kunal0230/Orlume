/**
 * ShadowCaster.js - Depth-Based Shadow Casting
 * 
 * DaVinci Resolve-style shadow generation:
 * - Raymarches through depth buffer toward light
 * - Generates soft shadow factor per pixel
 * - Supports directional and point lights
 */

export class ShadowCaster {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.width = 0;
        this.height = 0;

        // Shadow configuration
        this.config = {
            samples: 32,          // Number of raymarch steps
            softness: 0.5,        // Shadow edge softness (0 = hard, 1 = very soft)
            bias: 0.02,           // Depth bias to prevent self-shadowing
            intensity: 0.8,       // Shadow darkness (0 = no shadow, 1 = full black)
            maxDistance: 0.3,     // Max raymarch distance (as fraction of image)
        };
    }

    /**
     * Generate shadow map from depth buffer and light position
     * 
     * @param {Float32Array} depthData - Normalized depth values (0-1, closer = higher)
     * @param {Object} light - Light parameters { position, direction, directional }
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {Float32Array} Shadow factor per pixel (0 = full shadow, 1 = no shadow)
     */
    generateShadowMap(depthData, light, width, height) {
        this.width = width;
        this.height = height;

        const shadowMap = new Float32Array(width * height);
        const { samples, softness, bias, intensity, maxDistance } = this.config;

        // Calculate light direction for each pixel
        const isDirectional = light.directional !== false;

        // Light position in pixel space
        const lightPixelX = light.position.x * width;
        const lightPixelY = light.position.y * height;

        // Directional light direction (normalized)
        const lightDir = light.direction || { x: 0, y: 0, z: 1 };
        const dirLen = Math.sqrt(lightDir.x ** 2 + lightDir.y ** 2 + lightDir.z ** 2);
        const normalizedDir = {
            x: lightDir.x / dirLen,
            y: lightDir.y / dirLen,
            z: lightDir.z / dirLen,
        };

        // Max raymarch distance in pixels
        const maxDistPixels = maxDistance * Math.max(width, height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const currentDepth = depthData[idx];

                // Calculate ray direction toward light
                let rayDirX, rayDirY;

                if (isDirectional) {
                    // Directional: ray goes in light direction (opposite to light)
                    rayDirX = normalizedDir.x;
                    rayDirY = -normalizedDir.y; // Flip Y for screen coords
                } else {
                    // Point light: ray goes toward light position
                    const dx = lightPixelX - x;
                    const dy = lightPixelY - y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 1) {
                        shadowMap[idx] = 1.0; // At light source, no shadow
                        continue;
                    }
                    rayDirX = dx / dist;
                    rayDirY = dy / dist;
                }

                // Raymarch toward light
                let shadow = 1.0;
                let penumbra = 0;

                for (let s = 1; s <= samples; s++) {
                    const t = (s / samples) * maxDistPixels;

                    const sampleX = Math.round(x + rayDirX * t);
                    const sampleY = Math.round(y + rayDirY * t);

                    // Check bounds
                    if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
                        break;
                    }

                    const sampleIdx = sampleY * width + sampleX;
                    const sampleDepth = depthData[sampleIdx];

                    // Check if this sample occludes the current pixel
                    // Higher depth = closer to camera
                    // If sample is closer AND higher than current pixel + height difference
                    const heightDiff = sampleDepth - currentDepth;
                    const expectedHeight = (t / maxDistPixels) * 0.1; // Expected height for light angle

                    if (heightDiff > bias + expectedHeight) {
                        // This sample casts shadow on current pixel
                        const occlusionStrength = Math.min(1.0, (heightDiff - bias) / 0.1);
                        penumbra += occlusionStrength;

                        // Soft shadow: early hits create harder shadows
                        const softFactor = 1.0 - softness * (s / samples);
                        shadow = Math.min(shadow, 1.0 - occlusionStrength * softFactor * intensity);
                    }
                }

                // Apply softness through accumulated penumbra
                if (softness > 0 && penumbra > 0) {
                    const softShadow = 1.0 - Math.min(1.0, penumbra / (samples * 0.3)) * intensity;
                    shadow = shadow * (1 - softness) + softShadow * softness;
                }

                shadowMap[idx] = Math.max(0, Math.min(1, shadow));
            }
        }

        // Apply gaussian blur for soft shadows
        if (softness > 0.1) {
            return this._gaussianBlur(shadowMap, width, height, Math.floor(softness * 5) + 1);
        }

        return shadowMap;
    }

    /**
     * Convert shadow map to ImageData for shader
     */
    toImageData(shadowMap, width, height) {
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const shadow = Math.floor(shadowMap[i] * 255);
            const idx = i * 4;
            data[idx] = shadow;     // R = shadow factor
            data[idx + 1] = shadow; // G = shadow factor
            data[idx + 2] = shadow; // B = shadow factor
            data[idx + 3] = 255;    // A = opaque
        }

        return imageData;
    }

    /**
     * Simple gaussian blur for shadow softness
     */
    _gaussianBlur(data, width, height, radius) {
        const output = new Float32Array(data.length);
        const kernel = this._createGaussianKernel(radius);
        const kernelSize = kernel.length;
        const halfKernel = Math.floor(kernelSize / 2);

        // Horizontal pass
        const temp = new Float32Array(data.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let weightSum = 0;

                for (let k = 0; k < kernelSize; k++) {
                    const sx = x + k - halfKernel;
                    if (sx >= 0 && sx < width) {
                        sum += data[y * width + sx] * kernel[k];
                        weightSum += kernel[k];
                    }
                }

                temp[y * width + x] = sum / weightSum;
            }
        }

        // Vertical pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let weightSum = 0;

                for (let k = 0; k < kernelSize; k++) {
                    const sy = y + k - halfKernel;
                    if (sy >= 0 && sy < height) {
                        sum += temp[sy * width + x] * kernel[k];
                        weightSum += kernel[k];
                    }
                }

                output[y * width + x] = sum / weightSum;
            }
        }

        return output;
    }

    /**
     * Create 1D Gaussian kernel
     */
    _createGaussianKernel(radius) {
        const size = radius * 2 + 1;
        const kernel = new Float32Array(size);
        const sigma = radius / 3;

        let sum = 0;
        for (let i = 0; i < size; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }

        // Normalize
        for (let i = 0; i < size; i++) {
            kernel[i] /= sum;
        }

        return kernel;
    }

    /**
     * Update shadow configuration
     */
    setConfig(config) {
        Object.assign(this.config, config);
    }

    /**
     * Set shadow softness (0-1)
     */
    setSoftness(softness) {
        this.config.softness = Math.max(0, Math.min(1, softness));
    }

    /**
     * Set shadow intensity (0-1)
     */
    setIntensity(intensity) {
        this.config.intensity = Math.max(0, Math.min(1, intensity));
    }
}

export default ShadowCaster;
