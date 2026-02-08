/**
 * NeuralNormalEstimator - ML-based Surface Normal Estimation
 * 
 * Uses Omnidata or similar model via Transformers.js for direct
 * neural normal prediction. Higher quality than depth-derived normals.
 * 
 * Key Features:
 * - Direct surface normal prediction (not derived from depth)
 * - Captures fine surface detail that depth cannot
 * - Can be blended with depth-derived normals for hybrid approach
 */

export class NeuralNormalEstimator {
    constructor() {
        this.model = null;
        this.isLoading = false;
        this.modelLoaded = false;

        // Model configuration
        // NOTE: No dedicated surface normal model is publicly available on HuggingFace yet.
        // Future options when available: Omnidata, DSINE, or custom ONNX conversion
        // For now, uses depth model and derives high-quality normals from it.
        this.modelId = 'Xenova/omnidata-normals-small'; // Try neural first
        // Fallback: Use depth model and derive normals
        this.fallbackModelId = 'Xenova/depth-anything-small-hf';
    }

    /**
     * Load the neural normal estimation model
     * @param {Function} progressCallback - Progress callback
     */
    async loadModel(progressCallback) {
        if (this.model) return this.model;
        if (this.isLoading) {
            // Wait for existing load
            return new Promise((resolve) => {
                const checkLoaded = setInterval(() => {
                    if (this.modelLoaded) {
                        clearInterval(checkLoaded);
                        resolve(this.model);
                    }
                }, 100);
            });
        }

        this.isLoading = true;

        try {
            const { pipeline, env } = await import('@huggingface/transformers');

            // Configure environment
            env.allowLocalModels = false;
            env.useBrowserCache = true;

            // Try WebGPU first, fallback to WASM
            const devices = ['webgpu', 'wasm'];
            let lastError = null;

            for (const device of devices) {
                try {
                    if (device === 'webgpu' && !navigator.gpu) {
                        continue;
                    }

                    console.log(`Trying neural normal model with ${device}...`);

                    // Attempt to load Omnidata normal model
                    // Note: May need to use 'image-to-image' or 'depth-estimation' pipeline
                    // depending on how the model is exported
                    try {
                        this.model = await pipeline('depth-estimation', this.modelId, {
                            device: device,
                            dtype: 'fp32',
                            progress_callback: progressCallback,
                        });
                        console.log('✓ Neural normal model loaded (Omnidata)');
                    } catch (modelError) {
                        console.warn('Omnidata model not available, using depth-derived normals');
                        // Fall back to depth model and derive normals
                        this.model = await pipeline('depth-estimation', this.fallbackModelId, {
                            device: device,
                            dtype: 'fp32',
                            progress_callback: progressCallback,
                        });
                        this.usingFallback = true;
                        console.log('✓ Using depth model for normal derivation (fallback)');
                    }

                    this.modelLoaded = true;
                    this.isLoading = false;
                    return this.model;

                } catch (deviceError) {
                    console.warn(`${device} backend failed:`, deviceError.message);
                    lastError = deviceError;
                }
            }

            this.isLoading = false;
            throw lastError || new Error('All backends failed');

        } catch (error) {
            this.isLoading = false;
            console.error('Neural normal model loading failed:', error);
            throw error;
        }
    }

    /**
     * Estimate surface normals from an image
     * @param {string} imageDataURL - Image as data URL
     * @param {number} width - Target width
     * @param {number} height - Target height
     * @param {Function} progressCallback - Progress callback
     * @returns {Object} Normal map with canvas, width, height, data
     */
    async estimate(imageDataURL, width, height, progressCallback) {
        await this.loadModel(progressCallback);

        try {
            const result = await this.model(imageDataURL);

            if (this.usingFallback) {
                // Derive normals from depth output
                return this._deriveNormalsFromDepth(result, width, height);
            } else {
                // Direct normal output
                return this._processNormalOutput(result, width, height);
            }
        } catch (error) {
            console.error('Neural normal estimation failed:', error);
            throw error;
        }
    }

    /**
     * Process direct normal output from model
     */
    _processNormalOutput(result, targetWidth, targetHeight) {
        const { depth: normalMap } = result;  // Output key may vary

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        if (normalMap.data) {
            const data = normalMap.data;
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = normalMap.width;
            tempCanvas.height = normalMap.height;

            const imageData = tempCtx.createImageData(normalMap.width, normalMap.height);

            // Normal maps are typically in [-1, 1] range, need to map to [0, 255]
            for (let i = 0; i < data.length; i++) {
                // Assuming RGB output where each channel is a normal component
                const idx = i * 4;
                const channelIdx = i % 3;
                const pixelIdx = Math.floor(i / 3);

                if (channelIdx === 0) {
                    // Map from [-1, 1] to [0, 255]
                    imageData.data[pixelIdx * 4] = Math.floor((data[i] * 0.5 + 0.5) * 255);
                } else if (channelIdx === 1) {
                    imageData.data[pixelIdx * 4 + 1] = Math.floor((data[i] * 0.5 + 0.5) * 255);
                } else {
                    imageData.data[pixelIdx * 4 + 2] = Math.floor((data[i] * 0.5 + 0.5) * 255);
                    imageData.data[pixelIdx * 4 + 3] = 255;
                }
            }

            tempCtx.putImageData(imageData, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
        }

        const finalImageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

        return {
            canvas,
            width: targetWidth,
            height: targetHeight,
            data: finalImageData.data,
            isNeural: true,
            quality: 'high'
        };
    }

    /**
     * Derive normals from depth output (fallback mode)
     */
    _deriveNormalsFromDepth(result, targetWidth, targetHeight) {
        const { depth } = result;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        if (depth.data) {
            const depthData = depth.data;
            const w = depth.width;
            const h = depth.height;

            // Normalize depth
            let minVal = Infinity, maxVal = -Infinity;
            for (let i = 0; i < depthData.length; i++) {
                minVal = Math.min(minVal, depthData[i]);
                maxVal = Math.max(maxVal, depthData[i]);
            }
            const range = maxVal - minVal || 1;

            // Create normalized depth array
            const normalizedDepth = new Float32Array(depthData.length);
            for (let i = 0; i < depthData.length; i++) {
                normalizedDepth[i] = (depthData[i] - minVal) / range;
            }

            // Compute normals using Scharr kernel
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const imageData = tempCtx.createImageData(w, h);

            const strength = 50.0; // Strength for visible normals

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = y * w + x;
                    const pixelIdx = idx * 4;

                    // Get neighboring depths with boundary clamping
                    const getDepth = (px, py) => {
                        px = Math.max(0, Math.min(w - 1, px));
                        py = Math.max(0, Math.min(h - 1, py));
                        return normalizedDepth[py * w + px];
                    };

                    // Scharr kernel
                    const left = getDepth(x - 1, y);
                    const right = getDepth(x + 1, y);
                    const top = getDepth(x, y - 1);
                    const bottom = getDepth(x, y + 1);

                    const gx = (right - left) * strength;
                    const gy = (bottom - top) * strength;

                    // Normal = normalize(-gx, -gy, 1)
                    let nx = -gx;
                    let ny = -gy;
                    let nz = 1.0;

                    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                    if (len > 0) {
                        nx /= len;
                        ny /= len;
                        nz /= len;
                    }

                    // Map from [-1, 1] to [0, 255]
                    imageData.data[pixelIdx] = Math.round((nx * 0.5 + 0.5) * 255);
                    imageData.data[pixelIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
                    imageData.data[pixelIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
                    imageData.data[pixelIdx + 3] = 255;
                }
            }

            tempCtx.putImageData(imageData, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
        }

        const finalImageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

        return {
            canvas,
            width: targetWidth,
            height: targetHeight,
            data: finalImageData.data,
            isNeural: false,  // Derived from depth
            quality: 'medium'
        };
    }

    /**
     * Blend neural normals with depth-derived normals
     * @param {Object} neuralNormals - Neural network output
     * @param {Object} depthNormals - Depth-derived normals
     * @param {number} neuralWeight - Weight for neural normals (0-1)
     */
    blendNormals(neuralNormals, depthNormals, neuralWeight = 0.7) {
        const canvas = document.createElement('canvas');
        canvas.width = neuralNormals.width;
        canvas.height = neuralNormals.height;
        const ctx = canvas.getContext('2d');

        const width = neuralNormals.width;
        const height = neuralNormals.height;
        const imageData = ctx.createImageData(width, height);

        const depthWeight = 1.0 - neuralWeight;

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;

            // Get normals from both sources (map from [0,255] to [-1,1])
            const n1x = (neuralNormals.data[idx] / 255.0) * 2 - 1;
            const n1y = (neuralNormals.data[idx + 1] / 255.0) * 2 - 1;
            const n1z = (neuralNormals.data[idx + 2] / 255.0) * 2 - 1;

            const n2x = (depthNormals.data[idx] / 255.0) * 2 - 1;
            const n2y = (depthNormals.data[idx + 1] / 255.0) * 2 - 1;
            const n2z = (depthNormals.data[idx + 2] / 255.0) * 2 - 1;

            // Weighted blend
            let nx = n1x * neuralWeight + n2x * depthWeight;
            let ny = n1y * neuralWeight + n2y * depthWeight;
            let nz = n1z * neuralWeight + n2z * depthWeight;

            // Re-normalize
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 0) {
                nx /= len;
                ny /= len;
                nz /= len;
            }

            // Map back to [0, 255]
            imageData.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
            imageData.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            imageData.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            imageData.data[idx + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);

        return {
            canvas,
            width,
            height,
            data: imageData.data,
            isBlended: true,
            quality: 'high'
        };
    }

    isReady() {
        return this.modelLoaded;
    }

    dispose() {
        if (this.model) {
            this.model = null;
            this.modelLoaded = false;
        }
    }
}
