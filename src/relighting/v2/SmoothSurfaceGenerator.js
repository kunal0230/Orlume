/**
 * SmoothSurfaceGenerator.js - Bilateral Filtered 3D Surface
 * 
 * Creates a smooth 3D surface model from depth map:
 * 1. Applies bilateral filter to depth (preserves edges, removes texture)
 * 2. Computes smooth normals from filtered depth
 * 3. Outputs artifact-free surface for realistic lighting
 */

export class SmoothSurfaceGenerator {
    constructor() {
        this.config = {
            // Bilateral filter settings
            filterRadius: 9,           // Larger = smoother (was 3)
            spatialSigma: 4.0,         // Spatial Gaussian sigma
            depthSigma: 0.05,          // Depth range sigma (edge preservation)

            // Normal computation
            normalScale: 3.0,          // Low = subtle normals, no texture
            normalSmoothPasses: 2,     // Additional smoothing passes
        };
    }

    /**
     * Generate smooth surface normals from raw depth map
     * @param {Float32Array} rawDepth - Raw depth values (0-1)
     * @param {number} width
     * @param {number} height
     * @returns {Object} { smoothDepth, smoothNormals, normalImageData }
     */
    generate(rawDepth, width, height) {
        // Step 1: Bilateral filter the depth map
        const smoothDepth = this._bilateralFilter(rawDepth, width, height);

        // Step 2: Additional smoothing passes
        let finalDepth = smoothDepth;
        for (let i = 0; i < this.config.normalSmoothPasses; i++) {
            finalDepth = this._gaussianBlur(finalDepth, width, height, 3);
        }

        // Step 3: Compute normals from smooth depth
        const smoothNormals = this._computeNormals(finalDepth, width, height);

        // Step 4: Convert to ImageData for shader
        const normalImageData = this._normalsToImageData(smoothNormals, width, height);

        return {
            smoothDepth: finalDepth,
            smoothNormals,
            normalImageData,
            width,
            height
        };
    }

    /**
     * Bilateral filter - smooths depth while preserving edges
     * Key: the depth sigma preserves face outline while smoothing skin texture
     */
    _bilateralFilter(depth, width, height) {
        const output = new Float32Array(depth.length);
        const { filterRadius, spatialSigma, depthSigma } = this.config;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const centerDepth = depth[idx];

                let sum = 0;
                let weightSum = 0;

                for (let dy = -filterRadius; dy <= filterRadius; dy++) {
                    for (let dx = -filterRadius; dx <= filterRadius; dx++) {
                        const nx = Math.max(0, Math.min(width - 1, x + dx));
                        const ny = Math.max(0, Math.min(height - 1, y + dy));
                        const nIdx = ny * width + nx;
                        const neighborDepth = depth[nIdx];

                        // Spatial weight (Gaussian based on distance)
                        const spatialDist = Math.sqrt(dx * dx + dy * dy);
                        const spatialWeight = Math.exp(-(spatialDist * spatialDist) / (2 * spatialSigma * spatialSigma));

                        // Depth weight (Gaussian based on depth difference)
                        // This is what preserves edges - large depth difference = low weight
                        const depthDiff = Math.abs(neighborDepth - centerDepth);
                        const depthWeight = Math.exp(-(depthDiff * depthDiff) / (2 * depthSigma * depthSigma));

                        const weight = spatialWeight * depthWeight;
                        sum += neighborDepth * weight;
                        weightSum += weight;
                    }
                }

                output[idx] = sum / weightSum;
            }
        }

        return output;
    }

    /**
     * Simple Gaussian blur for additional smoothing
     */
    _gaussianBlur(depth, width, height, radius) {
        const output = new Float32Array(depth.length);
        const sigma = radius / 2;

        // Create 1D kernel
        const kernelSize = radius * 2 + 1;
        const kernel = new Float32Array(kernelSize);
        let kernelSum = 0;
        for (let i = 0; i < kernelSize; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            kernelSum += kernel[i];
        }
        for (let i = 0; i < kernelSize; i++) kernel[i] /= kernelSum;

        // Horizontal pass
        const temp = new Float32Array(depth.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sx = Math.max(0, Math.min(width - 1, x + k - radius));
                    sum += depth[y * width + sx] * kernel[k];
                }
                temp[y * width + x] = sum;
            }
        }

        // Vertical pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sy = Math.max(0, Math.min(height - 1, y + k - radius));
                    sum += temp[sy * width + x] * kernel[k];
                }
                output[y * width + x] = sum;
            }
        }

        return output;
    }

    /**
     * Compute normals from smooth depth using Sobel operator
     * Lower scale = more subtle normals (less texture visible)
     */
    _computeNormals(depth, width, height) {
        const normals = new Float32Array(width * height * 3);
        const scale = this.config.normalScale;

        const getD = (x, y) => {
            x = Math.max(0, Math.min(width - 1, x));
            y = Math.max(0, Math.min(height - 1, y));
            return depth[y * width + x];
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;

                // Sobel gradients
                const gx = (
                    getD(x + 1, y - 1) + 2 * getD(x + 1, y) + getD(x + 1, y + 1)
                ) - (
                        getD(x - 1, y - 1) + 2 * getD(x - 1, y) + getD(x - 1, y + 1)
                    );

                const gy = (
                    getD(x - 1, y + 1) + 2 * getD(x, y + 1) + getD(x + 1, y + 1)
                ) - (
                        getD(x - 1, y - 1) + 2 * getD(x, y - 1) + getD(x + 1, y - 1)
                    );

                // Create normal vector (subtle scale)
                const nx = -gx * scale;
                const ny = gy * scale;
                const nz = 1.0;

                // Normalize
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                normals[idx] = nx / len;
                normals[idx + 1] = ny / len;
                normals[idx + 2] = nz / len;
            }
        }

        return normals;
    }

    /**
     * Convert normals to ImageData for shader
     */
    _normalsToImageData(normals, width, height) {
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const nIdx = i * 3;
            // Map from [-1,1] to [0,255]
            data[i * 4] = Math.floor((normals[nIdx] * 0.5 + 0.5) * 255);
            data[i * 4 + 1] = Math.floor((normals[nIdx + 1] * 0.5 + 0.5) * 255);
            data[i * 4 + 2] = Math.floor((normals[nIdx + 2] * 0.5 + 0.5) * 255);
            data[i * 4 + 3] = 255;
        }

        return imageData;
    }

    /**
     * Update configuration
     */
    setConfig(config) {
        Object.assign(this.config, config);
    }
}

export default SmoothSurfaceGenerator;
