/**
 * DepthSystem.js - Clean Depth Estimation System
 * 
 * Stage 1 of Relighting 2.0
 * 
 * Features:
 * - Two model options: Small (fast) and Base (quality)
 * - IndexedDB cache integration
 * - Progress callbacks with time estimates
 * - Normal map generation
 * 
 * Usage:
 *   const depth = new DepthSystem();
 *   const result = await depth.estimate(imageData, 'small', onProgress);
 */

import { modelCache } from './ModelCache.js';

// Model configurations - Depth Anything V2 via onnx-community
const MODELS = {
    small: {
        id: 'depth-small',
        hfId: 'onnx-community/depth-anything-v2-small',
        name: 'DA V2 Small',
        size: 50 * 1024 * 1024,  // ~50MB
        sizeLabel: '~50MB',
        speed: 'Fast (3-5s)',
        description: 'Best for quick previews',
        estimatedTime: { cold: 15, warm: 3 }  // seconds
    },
    base: {
        id: 'depth-base',
        hfId: 'onnx-community/depth-anything-v2-base',
        name: 'DA V2 Base',
        size: 150 * 1024 * 1024,  // ~150MB
        sizeLabel: '~150MB',
        speed: 'Quality (8-15s)',
        description: 'Better depth accuracy',
        estimatedTime: { cold: 30, warm: 8 }  // seconds
    }
};

export class DepthSystem {
    constructor() {
        this.models = {};  // Loaded pipelines
        this.isLoading = false;
        this.currentModel = null;
    }

    /**
     * Get model configuration
     */
    getModelConfig(type = 'small') {
        return MODELS[type] || MODELS.small;
    }

    /**
     * Get all model configs
     */
    getAllModels() {
        return MODELS;
    }

    /**
     * Check cache status for all models
     */
    async getCacheStatus() {
        const status = {};

        for (const [type, config] of Object.entries(MODELS)) {
            const cached = await modelCache.isModelCached(config.id);
            status[type] = {
                ...config,
                cached,
                estimatedLoadTime: cached ? config.estimatedTime.warm : config.estimatedTime.cold
            };
        }

        return status;
    }

    /**
     * Load a specific model
     * @param {string} type - 'small' or 'base'
     * @param {Function} onProgress - Progress callback
     */
    async loadModel(type = 'small', onProgress) {
        const config = this.getModelConfig(type);

        // Return cached pipeline if already loaded in memory
        if (this.models[type]) {
            console.log(`Using in-memory ${config.name}`);
            return this.models[type];
        }

        if (this.isLoading) {
            throw new Error('Another model is currently loading');
        }

        this.isLoading = true;

        try {
            const { pipeline, env } = await import('@huggingface/transformers');

            // Configure for browser
            env.allowLocalModels = false;
            env.useBrowserCache = true;  // Use browser's Cache API

            const isCached = await modelCache.isModelCached(config.id);

            onProgress?.({
                stage: 'loading',
                message: isCached
                    ? `Loading ${config.name} from cache...`
                    : `Downloading ${config.name} (${config.sizeLabel})...`,
                percent: 0,
                isCached
            });

            console.log(`Loading ${config.name}...`);

            // Try WebGPU first, fall back to WASM
            const devices = ['webgpu', 'wasm'];
            let loadedPipeline = null;
            let lastError = null;

            for (const device of devices) {
                try {
                    if (device === 'webgpu' && !navigator.gpu) {
                        continue;  // Skip if WebGPU not available
                    }

                    console.log(`Trying ${device} backend...`);

                    loadedPipeline = await pipeline('depth-estimation', config.hfId, {
                        device,
                        dtype: 'fp32',
                        progress_callback: (progress) => {
                            if (progress.status === 'progress') {
                                onProgress?.({
                                    stage: 'downloading',
                                    message: `Downloading: ${Math.round(progress.progress)}%`,
                                    percent: progress.progress,
                                    isCached: false
                                });
                            } else if (progress.status === 'ready') {
                                onProgress?.({
                                    stage: 'ready',
                                    message: 'Model ready',
                                    percent: 100,
                                    isCached
                                });
                            }
                        }
                    });

                    console.log(`✅ ${config.name} loaded (${device})`);
                    break;

                } catch (err) {
                    console.warn(`${device} failed:`, err.message);
                    lastError = err;
                }
            }

            if (!loadedPipeline) {
                throw lastError || new Error('All backends failed');
            }

            // Cache the model reference
            this.models[type] = loadedPipeline;
            this.currentModel = type;

            // Mark as cached in our IndexedDB (for UI status)
            await modelCache.markModelCached(config.id, config.size);

            this.isLoading = false;
            return loadedPipeline;

        } catch (error) {
            this.isLoading = false;
            console.error(`Failed to load ${config.name}:`, error);
            throw error;
        }
    }

    /**
     * Estimate depth from image
     * @param {Object} image - { dataURL, width, height }
     * @param {string} modelType - 'small' or 'base'
     * @param {Function} onProgress - Progress callback
     * @returns {Object} { canvas, width, height, data }
     */
    async estimate(image, modelType = 'small', onProgress) {
        const config = this.getModelConfig(modelType);

        // Load model if needed
        const model = await this.loadModel(modelType, onProgress);

        onProgress?.({
            stage: 'estimating',
            message: 'Analyzing image depth...',
            percent: 0
        });

        // Run inference
        const startTime = performance.now();
        const result = await model(image.dataURL);
        const inferenceTime = ((performance.now() - startTime) / 1000).toFixed(1);

        console.log(`Depth estimation took ${inferenceTime}s`);

        onProgress?.({
            stage: 'processing',
            message: 'Processing depth map...',
            percent: 50
        });

        // Process output to ImageData
        const depthMap = await this._processDepthOutput(result, image.width, image.height);

        onProgress?.({
            stage: 'complete',
            message: `Complete (${inferenceTime}s)`,
            percent: 100
        });

        return depthMap;
    }

    /**
     * Process depth model output to canvas
     */
    async _processDepthOutput(result, targetWidth, targetHeight) {
        const { depth } = result;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        if (depth.data) {
            const depthData = depth.data;

            // Create temp canvas at model output size
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = depth.width;
            tempCanvas.height = depth.height;

            const imageData = tempCtx.createImageData(depth.width, depth.height);

            // Find min/max for normalization
            let minVal = Infinity;
            let maxVal = -Infinity;
            for (let i = 0; i < depthData.length; i++) {
                minVal = Math.min(minVal, depthData[i]);
                maxVal = Math.max(maxVal, depthData[i]);
            }
            const range = maxVal - minVal || 1;

            // Normalize to 0-255
            for (let i = 0; i < depthData.length; i++) {
                const normalized = Math.floor(((depthData[i] - minVal) / range) * 255);
                const idx = i * 4;
                imageData.data[idx] = normalized;
                imageData.data[idx + 1] = normalized;
                imageData.data[idx + 2] = normalized;
                imageData.data[idx + 3] = 255;
            }

            tempCtx.putImageData(imageData, 0, 0);

            // Scale to target size
            ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
        }

        const finalImageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

        return {
            canvas,
            width: targetWidth,
            height: targetHeight,
            data: finalImageData.data
        };
    }

    /**
 * Generate normal map from depth map with smoothing
 * @param {Object} depthMap - { width, height, data }
 * @param {number} strength - Normal intensity (default 25, reduced for smoother results)
 */
    generateNormalMap(depthMap, strength = 12.0) {
        const { width, height, data } = depthMap;

        // Step 1: Apply multi-pass Gaussian blur to depth data for very smooth normals
        // First pass: initial blur with radius 6
        const blurPass1 = this._gaussianBlurDepth(data, width, height, 6);
        // Second pass: blur again for extra smoothness (create RGBA data for it)
        const tempRGBA = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const v = Math.floor(blurPass1[i] * 255);
            tempRGBA[i * 4] = v;
            tempRGBA[i * 4 + 1] = v;
            tempRGBA[i * 4 + 2] = v;
            tempRGBA[i * 4 + 3] = 255;
        }
        const blurredDepth = this._gaussianBlurDepth(tempRGBA, width, height, 4);

        const normalData = new Uint8ClampedArray(width * height * 4);

        const getDepth = (px, py) => {
            px = Math.max(0, Math.min(width - 1, px));
            py = Math.max(0, Math.min(height - 1, py));
            return blurredDepth[py * width + px];
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;

                // Sobel gradient with 3x3 kernel
                const left = getDepth(x - 1, y);
                const right = getDepth(x + 1, y);
                const top = getDepth(x, y - 1);
                const bottom = getDepth(x, y + 1);
                const topLeft = getDepth(x - 1, y - 1);
                const topRight = getDepth(x + 1, y - 1);
                const bottomLeft = getDepth(x - 1, y + 1);
                const bottomRight = getDepth(x + 1, y + 1);

                const gx = (topRight + 2 * right + bottomRight) - (topLeft + 2 * left + bottomLeft);
                const gy = (bottomLeft + 2 * bottom + bottomRight) - (topLeft + 2 * top + topRight);

                const nx = -gx * strength;
                const ny = -gy * strength;
                const nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

                normalData[idx] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
                normalData[idx + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
                normalData[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
                normalData[idx + 3] = 255;
            }
        }

        // Create canvas for normal map
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);
        imgData.data.set(normalData);
        ctx.putImageData(imgData, 0, 0);

        return {
            canvas,
            width,
            height,
            data: normalData
        };
    }

    /**
     * Apply Gaussian blur to depth data
     * @param {Uint8ClampedArray} data - RGBA depth data
     * @param {number} width
     * @param {number} height
     * @param {number} radius - Blur radius
     * @returns {Float32Array} Blurred depth values (0-1)
     */
    _gaussianBlurDepth(data, width, height, radius = 2) {
        // Extract depth channel (R) and normalize to 0-1
        const depthIn = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            depthIn[i] = data[i * 4] / 255.0;
        }

        // Create Gaussian kernel
        const kernelSize = radius * 2 + 1;
        const kernel = new Float32Array(kernelSize);
        const sigma = radius / 2;
        let sum = 0;

        for (let i = 0; i < kernelSize; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }

        // Normalize kernel
        for (let i = 0; i < kernelSize; i++) {
            kernel[i] /= sum;
        }

        // Horizontal pass
        const temp = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let value = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sx = Math.max(0, Math.min(width - 1, x + k - radius));
                    value += depthIn[y * width + sx] * kernel[k];
                }
                temp[y * width + x] = value;
            }
        }

        // Vertical pass
        const depthOut = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let value = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const sy = Math.max(0, Math.min(height - 1, y + k - radius));
                    value += temp[sy * width + x] * kernel[k];
                }
                depthOut[y * width + x] = value;
            }
        }

        return depthOut;
    }
    /**
     * Clear cache for a specific model
     */
    async clearModelCache(modelType) {
        const config = this.getModelConfig(modelType);
        await modelCache.clearModel(config.id);

        // Remove from memory too
        if (this.models[modelType]) {
            delete this.models[modelType];
        }
    }

    /**
     * Clear all model caches
     */
    async clearAllCaches() {
        await modelCache.clearBrowserCache();
        this.models = {};
        this.currentModel = null;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.models = {};
        this.currentModel = null;
    }
}

// Singleton
export const depthSystem = new DepthSystem();
