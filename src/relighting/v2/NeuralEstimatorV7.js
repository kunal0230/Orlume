/**
 * NeuralEstimatorV7.js - Enhanced Neural Depth & Normal Estimation
 * 
 * v7 Improvements over v5:
 * - Multi-scale normal fusion (3×3, 5×5, 7×7 kernels)
 * - Depth confidence map for reliable region detection
 * - Adaptive normal strength based on local depth variance
 * - Edge-aware processing to preserve silhouettes
 * - Optional Omnidata DPT integration (when available)
 */

import { pipeline, env } from '@huggingface/transformers';

// Configure for browser
env.allowLocalModels = false;
env.useBrowserCache = true;

export class NeuralEstimatorV7 {
    constructor() {
        this.depthPipeline = null;
        this.isReady = false;
        this.isLoading = false;

        // Primary: Depth Anything V2 Base (higher quality than small)
        // Options: 'onnx-community/depth-anything-v2-small' (faster) 
        //          'onnx-community/depth-anything-v2-base' (better quality)
        this.depthModelId = 'onnx-community/depth-anything-v2-base';

        // Optional: Omnidata for direct normals (experimental)
        this.normalModelId = null; // Will try 'onnx-community/omnidata-normal' if available
        this.normalPipeline = null;
        this.hasDirectNormals = false;

        this.onProgress = null;

        // v7: Quality settings
        this.config = {
            multiScaleFusion: true,
            adaptiveStrength: true,
            edgeAwareSmoothing: true,
            generateConfidence: true,
        };
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
            this.depthPipeline = await pipeline('depth-estimation', this.depthModelId, {
                progress_callback: (progress) => {
                    if (this.onProgress && progress.status === 'progress') {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        this.onProgress({
                            stage: 'loading',
                            progress: percent,
                            message: `Loading depth model: ${percent}%`
                        });
                    }
                }
            });

            // Try to load Omnidata DPT for direct normals (optional enhancement)
            // This is wrapped in try-catch as it may not be available
            try {
                // Check if ONNX-converted Omnidata exists
                // For now, we'll skip this as it requires model conversion
                // this.normalPipeline = await pipeline('image-to-image', 'onnx-community/omnidata-normal-dpt-hybrid');
                // this.hasDirectNormals = true;
            } catch (e) {
                this.hasDirectNormals = false;
            }

            this.isReady = true;
            this.isLoading = false;
            return true;
        } catch (error) {
            console.error('❌ Neural Estimator v7 init failed:', error);
            this.isLoading = false;
            return false;
        }
    }

    /**
     * Estimate depth, normals, and confidence from image
     * @param {HTMLImageElement|HTMLCanvasElement} image
     * @param {Function} progressCallback - Optional callback for progress updates
     * @returns {Object} depth, normals, confidence, and ImageData
     */
    async estimate(image, progressCallback = null) {
        if (!this.isReady) {
            throw new Error('Neural Estimator v7 not initialized');
        }

        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;

        const reportProgress = (percent, message) => {
            if (progressCallback) progressCallback({ progress: percent, message, stage: 'estimation' });
        };

        reportProgress(0, 'Preparing image...');

        // Convert image to data URL for pipeline
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const imageDataURL = canvas.toDataURL('image/jpeg', 0.9);

        reportProgress(10, 'Running AI depth estimation...');

        // Run depth estimation
        const result = await this.depthPipeline(imageDataURL);

        reportProgress(50, 'Processing depth data...');

        // Extract depth data from result
        const depthTensor = result.depth;
        const depthData = await this._tensorToDepthMap(depthTensor, width, height);

        reportProgress(60, 'Computing depth confidence...');

        // Generate depth confidence map
        const confidence = this.config.generateConfidence
            ? this._computeDepthConfidence(depthData, width, height)
            : null;

        reportProgress(75, 'Computing surface normals...');

        // Compute multi-scale normals
        const normals = this.config.multiScaleFusion
            ? this._computeMultiScaleNormals(depthData, width, height, confidence)
            : this._computeDetailedNormals(depthData, width, height);

        reportProgress(90, 'Smoothing normals...');

        // Apply edge-aware smoothing
        const smoothedNormals = this.config.edgeAwareSmoothing
            ? this._edgeAwareSmoothing(normals, depthData, width, height)
            : normals;

        reportProgress(100, 'Complete!');

        return {
            depth: depthData,
            normals: smoothedNormals,
            confidence: confidence,
            depthImageData: this._depthToImageData(depthData, width, height),
            normalImageData: this._normalsToImageData(smoothedNormals, width, height),
            confidenceImageData: confidence ? this._confidenceToImageData(confidence, width, height) : null,
            width,
            height,
            version: 7,
        };
    }

    /**
     * Check if the depth model is cached in browser storage
     * @returns {Promise<{cached: boolean, size: string}>}
     */
    static async checkCacheStatus() {
        try {
            // Transformers.js stores models in IndexedDB under 'transformers-cache'
            const databases = await indexedDB.databases();
            const cacheDb = databases.find(db => db.name === 'transformers-cache');

            if (!cacheDb) {
                return { cached: false, size: '0 MB' };
            }

            // Try to estimate cache size
            const estimate = await navigator.storage?.estimate?.();
            const usedMB = estimate ? (estimate.usage / (1024 * 1024)).toFixed(1) : '?';

            return { cached: true, size: `~${usedMB} MB` };
        } catch (error) {
            console.warn('Could not check cache status:', error);
            return { cached: false, size: '0 MB' };
        }
    }

    /**
     * Clear the cached model from browser storage
     * @returns {Promise<boolean>}
     */
    static async clearCache() {
        try {
            // Delete the Transformers.js IndexedDB cache
            const deleteRequest = indexedDB.deleteDatabase('transformers-cache');

            return new Promise((resolve) => {
                deleteRequest.onsuccess = () => {
                    resolve(true);
                };
                deleteRequest.onerror = () => {
                    console.warn('Failed to clear cache');
                    resolve(false);
                };
                deleteRequest.onblocked = () => {
                    console.warn('Cache deletion blocked - close other tabs');
                    resolve(false);
                };
            });
        } catch (error) {
            console.error('Error clearing cache:', error);
            return false;
        }
    }

    /**
     * Convert depth tensor to Float32Array with bilinear interpolation
     */
    async _tensorToDepthMap(tensor, targetWidth, targetHeight) {
        const rawData = tensor.data;
        const tensorWidth = tensor.width;
        const tensorHeight = tensor.height;
        const depthMap = new Float32Array(targetWidth * targetHeight);

        // Bilinear resize if needed
        if (tensorWidth !== targetWidth || tensorHeight !== targetHeight) {
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
     * Compute depth confidence map based on local variance
     * Low confidence in:
     * - High-variance regions (uncertain depth)
     * - Near depth discontinuities (edges)
     */
    _computeDepthConfidence(depth, width, height) {
        const confidence = new Float32Array(width * height);
        const radius = 3;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                // Compute local variance
                let sum = 0, sumSq = 0, count = 0;
                let maxDiff = 0;
                const centerD = depth[idx];

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = Math.max(0, Math.min(width - 1, x + dx));
                        const ny = Math.max(0, Math.min(height - 1, y + dy));
                        const nIdx = ny * width + nx;
                        const d = depth[nIdx];

                        sum += d;
                        sumSq += d * d;
                        count++;
                        maxDiff = Math.max(maxDiff, Math.abs(d - centerD));
                    }
                }

                const mean = sum / count;
                const variance = (sumSq / count) - (mean * mean);

                // High variance or large depth jump = low confidence
                const varianceConf = 1.0 - Math.min(1.0, variance * 50);
                const edgeConf = 1.0 - Math.min(1.0, maxDiff * 5);

                confidence[idx] = Math.min(varianceConf, edgeConf);
            }
        }

        return confidence;
    }

    /**
     * Multi-scale normal fusion
     * Combines normals computed at different scales for robust estimation
     */
    _computeMultiScaleNormals(depth, width, height, confidence = null) {
        const normals = new Float32Array(width * height * 3);

        // Compute normals at 3 scales - subtle strength to avoid texture artifacts
        // These inform lighting direction only, should not create visible patterns
        const fineNormals = this._computeNormalsAtScale(depth, width, height, 1, 8.0);    // 3x3 - fine detail
        const mediumNormals = this._computeNormalsAtScale(depth, width, height, 2, 5.0);  // 5x5 - medium
        const coarseNormals = this._computeNormalsAtScale(depth, width, height, 3, 3.0);  // 7x7 - structure

        // Confidence-weighted fusion
        for (let i = 0; i < width * height; i++) {
            const nIdx = i * 3;

            // Use confidence to blend: low confidence = prefer coarse (more stable)
            const conf = confidence ? confidence[i] : 0.7;

            // Weights: high conf prefers fine detail, low conf prefers structure
            const fineW = conf * 0.5;
            const medW = 0.3;
            const coarseW = (1 - conf) * 0.5 + 0.2;
            const totalW = fineW + medW + coarseW;

            // Weighted average
            let nx = (fineNormals[nIdx] * fineW +
                mediumNormals[nIdx] * medW +
                coarseNormals[nIdx] * coarseW) / totalW;
            let ny = (fineNormals[nIdx + 1] * fineW +
                mediumNormals[nIdx + 1] * medW +
                coarseNormals[nIdx + 1] * coarseW) / totalW;
            let nz = (fineNormals[nIdx + 2] * fineW +
                mediumNormals[nIdx + 2] * medW +
                coarseNormals[nIdx + 2] * coarseW) / totalW;

            // Re-normalize
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            normals[nIdx] = nx / len;
            normals[nIdx + 1] = ny / len;
            normals[nIdx + 2] = nz / len;
        }

        return normals;
    }

    /**
     * Compute normals at a specific scale (Sobel operator size)
     */
    _computeNormalsAtScale(depth, width, height, scale, strength) {
        const normals = new Float32Array(width * height * 3);

        const getD = (x, y) => {
            x = Math.max(0, Math.min(width - 1, x));
            y = Math.max(0, Math.min(height - 1, y));
            return depth[y * width + x];
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;

                // Scaled Sobel gradient
                let gx = 0, gy = 0;

                // Apply Sobel at the given scale
                for (let s = 1; s <= scale; s++) {
                    const w = 1 / s; // Weight decreases with distance

                    gx += w * (
                        getD(x + s, y - s) + 2 * getD(x + s, y) + getD(x + s, y + s)
                        - getD(x - s, y - s) - 2 * getD(x - s, y) - getD(x - s, y + s)
                    );

                    gy += w * (
                        getD(x - s, y + s) + 2 * getD(x, y + s) + getD(x + s, y + s)
                        - getD(x - s, y - s) - 2 * getD(x, y - s) - getD(x + s, y - s)
                    );
                }

                // Normalize Sobel output
                gx /= scale;
                gy /= scale;

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
     * Fallback: Single-scale detailed normals (same as v5)
     */
    _computeDetailedNormals(depth, width, height) {
        const normals = new Float32Array(width * height * 3);
        const strength = 6.0;  // Subtle - informs lighting direction without visible texture

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;

                const getD = (px, py) => {
                    px = Math.max(0, Math.min(width - 1, px));
                    py = Math.max(0, Math.min(height - 1, py));
                    return depth[py * width + px];
                };

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

                const nx = -gx * strength;
                const ny = gy * strength;
                const nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                normals[idx] = nx / len;
                normals[idx + 1] = ny / len;
                normals[idx + 2] = nz / len;
            }
        }

        return normals;
    }

    /**
     * Edge-aware normal smoothing using depth-guided bilateral filter
     * Preserves sharp edges at depth discontinuities
     */
    _edgeAwareSmoothing(normals, depth, width, height) {
        const smoothed = new Float32Array(normals.length);
        const radius = 2;
        const spatialSigma = 1.5;
        const depthSigma = 0.02; // Sensitivity to depth edges

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                const centerDepth = depth[y * width + x];

                let sumNx = 0, sumNy = 0, sumNz = 0;
                let totalWeight = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = Math.max(0, Math.min(width - 1, x + dx));
                        const ny = Math.max(0, Math.min(height - 1, y + dy));
                        const nIdx = (ny * width + nx) * 3;
                        const neighborDepth = depth[ny * width + nx];

                        // Spatial weight (Gaussian)
                        const spatialDist = dx * dx + dy * dy;
                        const spatialWeight = Math.exp(-spatialDist / (2 * spatialSigma * spatialSigma));

                        // Depth weight (range filter)
                        const depthDiff = Math.abs(centerDepth - neighborDepth);
                        const depthWeight = Math.exp(-depthDiff * depthDiff / (2 * depthSigma * depthSigma));

                        const weight = spatialWeight * depthWeight;

                        sumNx += normals[nIdx] * weight;
                        sumNy += normals[nIdx + 1] * weight;
                        sumNz += normals[nIdx + 2] * weight;
                        totalWeight += weight;
                    }
                }

                // Normalize result
                sumNx /= totalWeight;
                sumNy /= totalWeight;
                sumNz /= totalWeight;

                const len = Math.sqrt(sumNx * sumNx + sumNy * sumNy + sumNz * sumNz) || 1;
                smoothed[idx] = sumNx / len;
                smoothed[idx + 1] = sumNy / len;
                smoothed[idx + 2] = sumNz / len;
            }
        }

        return smoothed;
    }

    // ============================================
    // Visualization Helpers
    // ============================================

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

    _normalsToImageData(normals, width, height) {
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const nIdx = i * 3;
            data[i * 4] = Math.floor((normals[nIdx] * 0.5 + 0.5) * 255);
            data[i * 4 + 1] = Math.floor((normals[nIdx + 1] * 0.5 + 0.5) * 255);
            data[i * 4 + 2] = Math.floor((normals[nIdx + 2] * 0.5 + 0.5) * 255);
            data[i * 4 + 3] = 255;
        }

        return imageData;
    }

    _confidenceToImageData(confidence, width, height) {
        const imageData = new ImageData(width, height);
        const data = imageData.data;

        for (let i = 0; i < width * height; i++) {
            const value = Math.floor(confidence[i] * 255);
            // Visualize as green (high confidence) to red (low confidence)
            data[i * 4] = 255 - value;     // R
            data[i * 4 + 1] = value;        // G
            data[i * 4 + 2] = 0;            // B
            data[i * 4 + 3] = 255;
        }

        return imageData;
    }

    dispose() {
        this.depthPipeline = null;
        this.normalPipeline = null;
        this.isReady = false;
    }
}

export default NeuralEstimatorV7;
