/**
 * Depth Estimator - Simple
 * Uses Depth Anything V2 via Transformers.js
 */

export class DepthEstimator {
    constructor(app) {
        this.app = app;
        this.model = null;
        this.isLoading = false;
    }

    async loadModel(progressCallback) {
        if (this.model) return this.model;
        if (this.isLoading) return null;

        this.isLoading = true;

        try {
            const { pipeline, env } = await import('@huggingface/transformers');

            // Configure environment for browser usage
            env.allowLocalModels = false;
            env.useBrowserCache = true;

            // Note: Don't override wasmPaths - let Transformers.js handle ONNX internally

            console.log('Loading Depth Anything V2 model...');

            // Robust fallback chain: WebGPU → WASM
            const devices = ['webgpu', 'wasm'];
            let lastError = null;

            for (const device of devices) {
                try {
                    console.log(`Trying ${device} backend...`);

                    // Check WebGPU availability before trying
                    if (device === 'webgpu' && !navigator.gpu) {
                        console.log('WebGPU not supported, skipping...');
                        continue;
                    }

                    this.model = await pipeline('depth-estimation', 'Xenova/depth-anything-small-hf', {
                        device: device,
                        dtype: 'fp32',
                        progress_callback: progressCallback,
                    });

                    this.isLoading = false;
                    console.log(`✅ Depth model loaded (${device})`);
                    return this.model;

                } catch (deviceError) {
                    console.warn(`${device} backend failed:`, deviceError.message);
                    lastError = deviceError;
                    // Continue to next device
                }
            }

            // All backends failed
            this.isLoading = false;
            throw lastError || new Error('All backends failed');

        } catch (error) {
            this.isLoading = false;
            console.error('Depth model loading failed:', error);
            throw error;
        }
    }

    async estimate(image) {
        const progressContainer = document.getElementById('depth-progress');
        const estimateBtn = document.getElementById('btn-estimate-depth');

        progressContainer.hidden = false;
        estimateBtn.disabled = true;

        try {
            await this.loadModel((progress) => {
                if (progress.status === 'progress') {
                    const percent = Math.round(progress.progress);
                    this.app.updateProgress(percent, `Loading model: ${percent}%`);
                } else if (progress.status === 'ready') {
                    this.app.updateProgress(100, 'Model ready');
                }
            });

            this.app.updateProgress(0, 'Estimating depth...');

            const result = await this.model(image.dataURL);
            const depthMap = await this.processDepthOutput(result, image.width, image.height);

            this.app.updateProgress(100, 'Complete!');

            setTimeout(() => {
                progressContainer.hidden = true;
                estimateBtn.disabled = false;
                estimateBtn.textContent = 'Re-estimate Depth';
            }, 1000);

            return depthMap;

        } catch (error) {
            console.error('Depth estimation failed:', error);
            progressContainer.hidden = true;
            estimateBtn.disabled = false;
            throw error;
        }
    }

    async processDepthOutput(result, targetWidth, targetHeight) {
        const { depth } = result;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        if (depth.data) {
            const depthData = depth.data;
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = depth.width;
            tempCanvas.height = depth.height;

            const imageData = tempCtx.createImageData(depth.width, depth.height);

            let minVal = Infinity;
            let maxVal = -Infinity;

            for (let i = 0; i < depthData.length; i++) {
                minVal = Math.min(minVal, depthData[i]);
                maxVal = Math.max(maxVal, depthData[i]);
            }

            const range = maxVal - minVal || 1;

            for (let i = 0; i < depthData.length; i++) {
                const normalized = Math.floor(((depthData[i] - minVal) / range) * 255);
                const idx = i * 4;
                imageData.data[idx] = normalized;
                imageData.data[idx + 1] = normalized;
                imageData.data[idx + 2] = normalized;
                imageData.data[idx + 3] = 255;
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
        };
    }

    generateNormalMap(depthMap, strength = 50.0) {
        const { width, height, data } = depthMap;
        const normalData = new Uint8ClampedArray(width * height * 4);

        // Sobel kernels for better edge detection
        // Gx = [-1, 0, 1], Gy = [-1, 0, 1]^T

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;

                // Get 3x3 neighborhood depth values (using R channel which has depth)
                const getDepth = (px, py) => {
                    px = Math.max(0, Math.min(width - 1, px));
                    py = Math.max(0, Math.min(height - 1, py));
                    return data[(py * width + px) * 4] / 255.0;
                };

                // Sobel gradient calculation
                const left = getDepth(x - 1, y);
                const right = getDepth(x + 1, y);
                const top = getDepth(x, y - 1);
                const bottom = getDepth(x, y + 1);
                const topLeft = getDepth(x - 1, y - 1);
                const topRight = getDepth(x + 1, y - 1);
                const bottomLeft = getDepth(x - 1, y + 1);
                const bottomRight = getDepth(x + 1, y + 1);

                // Sobel X = right - left (with diagonal weights)
                const gx = (topRight + 2 * right + bottomRight) - (topLeft + 2 * left + bottomLeft);
                // Sobel Y = bottom - top
                const gy = (bottomLeft + 2 * bottom + bottomRight) - (topLeft + 2 * top + topRight);

                // Scale up gradients to make normals more pronounced
                const nx = -gx * strength;
                const ny = -gy * strength;
                const nz = 1.0;

                // Normalize
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

                // Encode to 0-255 range (normal from -1..1 to 0..255)
                normalData[idx] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
                normalData[idx + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
                normalData[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
                normalData[idx + 3] = 255;
            }
        }

        return {
            width,
            height,
            data: normalData,
        };
    }
}
