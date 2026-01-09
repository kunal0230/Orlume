/**
 * NormalEstimator.js - Computes surface normals from depth map
 * 
 * Uses Sobel-based gradient computation with optional smoothing
 * to hide AI depth estimation artifacts.
 */

export class NormalEstimator {
    constructor() {
        // Offscreen canvas for processing
        this.canvas = null;
        this.ctx = null;
    }

    /**
     * Compute normal map from depth map
     * 
     * @param {Object} depthResult - Depth estimation result with canvas
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @param {number} softness - Blur amount (0-100)
     * @returns {ImageData} Normal map
     */
    computeFromDepth(depthResult, width, height, softness = 0) {
        // Get depth data
        const depthCanvas = depthResult.canvas || depthResult;
        const depthCtx = depthCanvas.getContext('2d');
        let depthData = depthCtx.getImageData(0, 0, width, height);

        // Apply softness (blur) if requested
        if (softness > 0) {
            depthData = this._applyBlur(depthData, softness);
        }

        // Compute normals using Sobel operator
        const normalData = this._computeSobelNormals(depthData, width, height);

        return normalData;
    }

    /**
     * Apply Gaussian blur to depth data
     */
    _applyBlur(imageData, softness) {
        const { width, height, data } = imageData;

        // Convert softness (0-100) to kernel radius
        const radius = Math.ceil(softness / 10);
        if (radius === 0) return imageData;

        // Create output
        const output = new ImageData(width, height);
        const outData = output.data;

        // Generate Gaussian kernel
        const kernel = this._generateGaussianKernel(radius);
        const size = radius * 2 + 1;

        // Apply separable blur (horizontal then vertical)
        const temp = new Float32Array(width * height);

        // Horizontal pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let weightSum = 0;

                for (let k = -radius; k <= radius; k++) {
                    const sx = Math.max(0, Math.min(width - 1, x + k));
                    const idx = (y * width + sx) * 4;
                    const weight = kernel[k + radius];
                    sum += data[idx] * weight;
                    weightSum += weight;
                }

                temp[y * width + x] = sum / weightSum;
            }
        }

        // Vertical pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let weightSum = 0;

                for (let k = -radius; k <= radius; k++) {
                    const sy = Math.max(0, Math.min(height - 1, y + k));
                    const weight = kernel[k + radius];
                    sum += temp[sy * width + x] * weight;
                    weightSum += weight;
                }

                const idx = (y * width + x) * 4;
                const val = Math.round(sum / weightSum);
                outData[idx] = val;
                outData[idx + 1] = val;
                outData[idx + 2] = val;
                outData[idx + 3] = 255;
            }
        }

        return output;
    }

    /**
     * Generate 1D Gaussian kernel
     */
    _generateGaussianKernel(radius) {
        const sigma = radius / 2;
        const size = radius * 2 + 1;
        const kernel = new Float32Array(size);

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
     * Compute normals using Sobel operator
     * 
     * Normal is computed from depth gradients:
     * - dzdx = horizontal derivative
     * - dzdy = vertical derivative
     * - Normal = normalize(-dzdx, -dzdy, 1)
     */
    _computeSobelNormals(depthData, width, height) {
        const { data } = depthData;
        const normalData = new ImageData(width, height);
        const normals = normalData.data;

        // Depth scale factor - controls normal "sharpness"
        const depthScale = 0.5;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Sample depth at neighboring pixels (clamped to edges)
                const left = this._getDepth(data, width, height, x - 1, y);
                const right = this._getDepth(data, width, height, x + 1, y);
                const up = this._getDepth(data, width, height, x, y - 1);
                const down = this._getDepth(data, width, height, x, y + 1);

                // Compute gradients (Sobel-like)
                const dzdx = (right - left) / 2.0;
                const dzdy = (down - up) / 2.0;

                // Compute normal vector
                // N = normalize(-dzdx, -dzdy, depthScale)
                let nx = -dzdx;
                let ny = -dzdy;
                let nz = depthScale;

                // Normalize
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 0) {
                    nx /= len;
                    ny /= len;
                    nz /= len;
                }

                // Encode normal to RGB (0-255)
                // Normal components are in [-1, 1], map to [0, 255]
                const idx = (y * width + x) * 4;
                normals[idx] = Math.round((nx + 1) * 0.5 * 255);     // R = X
                normals[idx + 1] = Math.round((ny + 1) * 0.5 * 255); // G = Y
                normals[idx + 2] = Math.round((nz + 1) * 0.5 * 255); // B = Z
                normals[idx + 3] = 255;                               // A = 1
            }
        }

        return normalData;
    }

    /**
     * Get depth value at pixel with clamping
     */
    _getDepth(data, width, height, x, y) {
        // Clamp coordinates
        x = Math.max(0, Math.min(width - 1, x));
        y = Math.max(0, Math.min(height - 1, y));

        const idx = (y * width + x) * 4;
        // Depth is in red channel, normalized to 0-1
        return data[idx] / 255.0;
    }

    /**
     * Debug: Render normal map to canvas for visualization
     */
    renderDebug(normalData, canvas) {
        const ctx = canvas.getContext('2d');
        ctx.putImageData(normalData, 0, 0);
    }
}

export default NormalEstimator;
