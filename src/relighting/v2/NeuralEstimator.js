/**
 * NeuralEstimator.js - Neural Network Depth & Normal Estimation
 * 
 * Uses Hugging Face Transformers.js with Depth Anything V2 for
 * high-quality monocular depth estimation, then computes detailed
 * surface normals from the depth map.
 * 
 * This provides DaVinci Resolve-quality 3D understanding.
 */

import { pipeline, env } from '@huggingface/transformers';

// Configure for browser
env.allowLocalModels = false;
env.useBrowserCache = true;

export class NeuralEstimator {
    constructor() {
        this.depthPipeline = null;
        this.isReady = false;
        this.isLoading = false;
        // Use the correct model from onnx-community
        this.modelId = 'onnx-community/depth-anything-v2-small';
        this.onProgress = null;
    }

    /**
     * Initialize the neural network pipeline
     * @param {Function} progressCallback - Called with loading progress
     */
    async init(progressCallback = null) {
        if (this.isReady) return true;
        if (this.isLoading) return false;

        this.isLoading = true;
        this.onProgress = progressCallback;

        try {

            // Initialize depth estimation pipeline
            this.depthPipeline = await pipeline('depth-estimation', this.modelId, {
                progress_callback: (progress) => {
                    if (this.onProgress && progress.status === 'progress') {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        this.onProgress({
                            stage: 'loading',
                            progress: percent,
                            message: `Loading model: ${percent}%`
                        });
                    }
                }
            });

            this.isReady = true;
            this.isLoading = false;
            return true;
        } catch (error) {
            console.error('❌ Neural Estimator init failed:', error);
            this.isLoading = false;
            return false;
        }
    }

    /**
     * Estimate depth and normals from image
     * @param {HTMLImageElement|HTMLCanvasElement} image
     * @returns {Object} depth, normals, and ImageData
     */
    async estimate(image) {
        if (!this.isReady) {
            throw new Error('Neural Estimator not initialized');
        }

        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;


        // Convert image to data URL for pipeline
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const imageDataURL = canvas.toDataURL('image/jpeg', 0.9);

        // Run depth estimation
        const result = await this.depthPipeline(imageDataURL);

        // Extract depth data from result
        const depthTensor = result.depth;
        const depthData = await this._tensorToDepthMap(depthTensor, width, height);

        // Compute high-quality normals from depth
        const normals = this._computeDetailedNormals(depthData, width, height);


        return {
            depth: depthData,
            normals: normals,
            depthImageData: this._depthToImageData(depthData, width, height),
            normalImageData: this._normalsToImageData(normals, width, height),
            width,
            height,
        };
    }

    /**
     * Convert depth tensor to Float32Array
     */
    async _tensorToDepthMap(tensor, targetWidth, targetHeight) {
        // Get raw data from tensor
        const rawData = tensor.data;
        const tensorWidth = tensor.width;
        const tensorHeight = tensor.height;

        // Create output buffer
        const depthMap = new Float32Array(targetWidth * targetHeight);

        // Resize if needed
        if (tensorWidth !== targetWidth || tensorHeight !== targetHeight) {
            // Bilinear resize
            const scaleX = tensorWidth / targetWidth;
            const scaleY = tensorHeight / targetHeight;

            for (let y = 0; y < targetHeight; y++) {
                for (let x = 0; x < targetWidth; x++) {
                    const srcX = x * scaleX;
                    const srcY = y * scaleY;

                    const x0 = Math.floor(srcX);
                    const y0 = Math.floor(srcY);
                    const x1 = Math.min(x0 + 1, tensorWidth - 1);
                    const y1 = Math.min(y0 + 1, tensorHeight - 1);

                    const fx = srcX - x0;
                    const fy = srcY - y0;

                    const v00 = rawData[y0 * tensorWidth + x0];
                    const v10 = rawData[y0 * tensorWidth + x1];
                    const v01 = rawData[y1 * tensorWidth + x0];
                    const v11 = rawData[y1 * tensorWidth + x1];

                    depthMap[y * targetWidth + x] =
                        v00 * (1 - fx) * (1 - fy) +
                        v10 * fx * (1 - fy) +
                        v01 * (1 - fx) * fy +
                        v11 * fx * fy;
                }
            }
        } else {
            depthMap.set(rawData);
        }

        // Normalize to 0-1
        let minD = Infinity, maxD = -Infinity;
        for (let i = 0; i < depthMap.length; i++) {
            minD = Math.min(minD, depthMap[i]);
            maxD = Math.max(maxD, depthMap[i]);
        }

        const range = maxD - minD || 1;
        for (let i = 0; i < depthMap.length; i++) {
            depthMap[i] = (depthMap[i] - minD) / range;
        }

        return depthMap;
    }

    /**
     * Compute detailed surface normals from depth
     * Keep detailed for accurate 3D - shader handles texture smoothing
     */
    _computeDetailedNormals(depth, width, height) {
        const normals = new Float32Array(width * height * 3);

        // Higher strength = more detailed 3D response
        // Shader's frequency separation handles texture smoothing
        const strength = 6.0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;

                // Sample depth at neighboring pixels
                const getD = (px, py) => {
                    px = Math.max(0, Math.min(width - 1, px));
                    py = Math.max(0, Math.min(height - 1, py));
                    return depth[py * width + px];
                };

                // Sobel gradient for detailed normals
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

                // Create normal vector
                const nx = -gx * strength;
                const ny = gy * strength;
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
     * Smooth depth map to reduce high-frequency noise
     */
    _smoothDepth(depth, width, height, radius) {
        const smoothed = new Float32Array(depth.length);
        const kernel = this._createGaussianKernel(radius);
        const kernelSize = radius * 2 + 1;

        // Separable Gaussian blur (horizontal then vertical)
        const temp = new Float32Array(depth.length);

        // Horizontal pass
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
                smoothed[y * width + x] = sum;
            }
        }

        return smoothed;
    }

    /**
     * Create 1D Gaussian kernel
     */
    _createGaussianKernel(radius) {
        const sigma = radius / 2;
        const size = radius * 2 + 1;
        const kernel = new Float32Array(size);
        let sum = 0;

        for (let i = 0; i < size; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }

        for (let i = 0; i < size; i++) {
            kernel[i] /= sum;
        }

        return kernel;
    }

    /**
     * Convert depth to ImageData for visualization
     */
    _depthToImageData(depth, width, height) {
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const value = Math.floor(depth[i] * 255);
            data[i * 4] = value;
            data[i * 4 + 1] = value;
            data[i * 4 + 2] = value;
            data[i * 4 + 3] = 255;
        }

        return imageData;
    }

    /**
     * Convert normals to ImageData for visualization
     * Normal map encoding: RGB = (nx+1)/2, (ny+1)/2, (nz+1)/2
     */
    _normalsToImageData(normals, width, height) {
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const nIdx = i * 3;
            // Encode normals as RGB ([-1,1] -> [0,255])
            data[i * 4] = Math.floor((normals[nIdx] * 0.5 + 0.5) * 255);      // R = X
            data[i * 4 + 1] = Math.floor((normals[nIdx + 1] * 0.5 + 0.5) * 255); // G = Y
            data[i * 4 + 2] = Math.floor((normals[nIdx + 2] * 0.5 + 0.5) * 255); // B = Z
            data[i * 4 + 3] = 255;
        }

        return imageData;
    }

    dispose() {
        this.depthPipeline = null;
        this.isReady = false;
    }
}

export default NeuralEstimator;
