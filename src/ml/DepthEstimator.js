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

            // Configure ONNX Runtime WASM paths (Transformers.js uses ONNX internally)
            env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';

            env.allowLocalModels = false;
            env.useBrowserCache = true;

            console.log('Loading Depth Anything V2 model (WASM backend)...');

            // Use WASM directly to avoid WebGPU conflicts
            this.model = await pipeline('depth-estimation', 'Xenova/depth-anything-small-hf', {
                device: 'wasm',
                dtype: 'fp32',
                progress_callback: progressCallback,
            });

            this.isLoading = false;
            console.log('✅ Depth model loaded (WASM)');
            return this.model;

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

    generateNormalMap(depthMap) {
        const { width, height, data } = depthMap;
        const normalData = new Uint8ClampedArray(width * height * 4);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;

                const leftIdx = (y * width + Math.max(0, x - 1)) * 4;
                const rightIdx = (y * width + Math.min(width - 1, x + 1)) * 4;
                const topIdx = (Math.max(0, y - 1) * width + x) * 4;
                const bottomIdx = (Math.min(height - 1, y + 1) * width + x) * 4;

                const dX = (data[rightIdx] - data[leftIdx]) / 255;
                const dY = (data[bottomIdx] - data[topIdx]) / 255;

                const scale = 3.0;
                const nx = -dX * scale;
                const ny = -dY * scale;
                const nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

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
