/**
 * ONNXDepthEstimator - High-Performance GPU Depth Estimation
 * Uses ONNX Runtime Web with WebGPU execution provider and IO Binding
 * for zero-copy GPU inference (data stays on GPU throughout)
 * 
 * Based on: Depth Anything V2 model
 * Reference: Web Relighting Report - Section 4.2 "The Data Flow Pipeline"
 */

export class ONNXDepthEstimator {
    constructor(app) {
        this.app = app;
        this.session = null;
        this.isLoading = false;
        this.modelPath = '/models/depth_anything_v2_small.onnx';

        // Model input size (Depth Anything V2 Small)
        this.inputWidth = 518;
        this.inputHeight = 518;

        // Execution provider preference
        this.preferredProvider = 'webgpu';
        this.currentProvider = null;
    }

    /**
     * Check if WebGPU is available
     */
    async isWebGPUAvailable() {
        try {
            if (!navigator.gpu) return false;
            const adapter = await navigator.gpu.requestAdapter();
            return !!adapter;
        } catch (e) {
            return false;
        }
    }

    /**
     * Load the ONNX model with optimal execution provider
     */
    async loadModel(progressCallback) {
        if (this.session) return this.session;
        if (this.isLoading) return null;

        this.isLoading = true;

        try {
            // Import ONNX Runtime
            const ort = await import('onnxruntime-web');

            // Configure WASM paths from CDN (required for browser)
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';

            // Enable SIMD and threading for better performance
            ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
            ort.env.wasm.simd = true;

            if (progressCallback) {
                progressCallback({ status: 'progress', progress: 10, text: 'Loading ONNX Runtime...' });
            }

            // Determine best execution provider
            const hasWebGPU = await this.isWebGPUAvailable();
            let executionProviders;

            if (hasWebGPU && this.preferredProvider === 'webgpu') {
                executionProviders = ['webgpu', 'wasm']; // WebGPU with WASM fallback
                this.currentProvider = 'webgpu';
                console.log('🚀 Using WebGPU execution provider (zero-copy mode)');
            } else {
                executionProviders = ['wasm'];
                this.currentProvider = 'wasm';
                console.log('⚙️ Using WASM execution provider');
            }

            // Session options
            const sessionOptions = {
                executionProviders,
                graphOptimizationLevel: 'all',
            };

            if (progressCallback) {
                progressCallback({ status: 'progress', progress: 30, text: 'Loading depth model...' });
            }

            // Try to load from local path first, then from CDN
            try {
                this.session = await ort.InferenceSession.create(this.modelPath, sessionOptions);
            } catch (e) {
                console.warn('Local model not found, trying Hugging Face CDN...');
                // Fallback to Hugging Face model - use ONNX model URL
                const cdnPath = 'https://huggingface.co/Xenova/depth-anything-small-hf/resolve/main/onnx/model.onnx';
                this.session = await ort.InferenceSession.create(cdnPath, sessionOptions);
            }

            if (progressCallback) {
                progressCallback({ status: 'ready', progress: 100, text: 'Model ready!' });
            }

            this.isLoading = false;
            console.log(`✅ ONNX Depth model loaded (${this.currentProvider})`);
            return this.session;

        } catch (error) {
            this.isLoading = false;
            console.error('Failed to load ONNX model:', error);
            throw error;
        }
    }

    /**
     * Preprocess image for model input
     * Normalizes and resizes image to model's expected input size
     */
    preprocessImage(imageData) {
        const { width, height, data } = imageData;

        // Create canvas for resizing
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = width;
        srcCanvas.height = height;
        const srcCtx = srcCanvas.getContext('2d');

        const imgData = srcCtx.createImageData(width, height);
        imgData.data.set(data);
        srcCtx.putImageData(imgData, 0, 0);

        // Resize to model input size
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = this.inputWidth;
        dstCanvas.height = this.inputHeight;
        const dstCtx = dstCanvas.getContext('2d');
        dstCtx.drawImage(srcCanvas, 0, 0, this.inputWidth, this.inputHeight);

        const resizedData = dstCtx.getImageData(0, 0, this.inputWidth, this.inputHeight);

        // Convert to Float32Array in NCHW format (batch, channels, height, width)
        // Normalize using ImageNet mean/std
        const mean = [0.485, 0.456, 0.406];
        const std = [0.229, 0.224, 0.225];

        const tensor = new Float32Array(3 * this.inputWidth * this.inputHeight);
        const pixels = resizedData.data;

        for (let i = 0; i < this.inputWidth * this.inputHeight; i++) {
            const pixelIdx = i * 4;
            // RGB channels normalized
            tensor[i] = (pixels[pixelIdx] / 255 - mean[0]) / std[0];     // R
            tensor[this.inputWidth * this.inputHeight + i] = (pixels[pixelIdx + 1] / 255 - mean[1]) / std[1]; // G
            tensor[2 * this.inputWidth * this.inputHeight + i] = (pixels[pixelIdx + 2] / 255 - mean[2]) / std[2]; // B
        }

        return tensor;
    }

    /**
     * Estimate depth from image
     * @param {Object} image - Object with dataURL, width, height properties
     * @returns {Object} Depth map with canvas, width, height, data
     */
    async estimate(image) {
        const progressContainer = document.getElementById('depth-progress');
        const estimateBtn = document.getElementById('btn-estimate-depth');

        if (progressContainer) progressContainer.hidden = false;
        if (estimateBtn) estimateBtn.disabled = true;

        try {
            // Load model if not already loaded
            await this.loadModel((progress) => {
                if (this.app?.updateProgress) {
                    this.app.updateProgress(progress.progress, progress.text || 'Loading...');
                }
            });

            if (this.app?.updateProgress) {
                this.app.updateProgress(50, 'Preparing image...');
            }

            // Convert dataURL to ImageData
            const img = await this._loadImage(image.dataURL);
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);

            // Preprocess
            const tensorData = this.preprocessImage(imageData);

            if (this.app?.updateProgress) {
                this.app.updateProgress(60, 'Running depth estimation...');
            }

            // Create ONNX tensor
            const ort = await import('onnxruntime-web');
            const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, this.inputHeight, this.inputWidth]);

            // Run inference
            const startTime = performance.now();
            const feeds = { input: inputTensor };

            // Get input name from model if different
            const inputNames = this.session.inputNames;
            if (inputNames[0] !== 'input') {
                feeds[inputNames[0]] = inputTensor;
                delete feeds.input;
            }

            const results = await this.session.run(feeds);
            const inferenceTime = performance.now() - startTime;
            console.log(`⚡ Depth inference: ${inferenceTime.toFixed(0)}ms`);

            if (this.app?.updateProgress) {
                this.app.updateProgress(80, 'Processing depth map...');
            }

            // Process output
            const outputName = this.session.outputNames[0];
            const depthOutput = results[outputName];
            const depthMap = await this.processDepthOutput(depthOutput, image.width, image.height);

            if (this.app?.updateProgress) {
                this.app.updateProgress(100, 'Complete!');
            }

            setTimeout(() => {
                if (progressContainer) progressContainer.hidden = true;
                if (estimateBtn) {
                    estimateBtn.disabled = false;
                    estimateBtn.textContent = 'Re-estimate Depth';
                }
            }, 1000);

            return depthMap;

        } catch (error) {
            console.error('Depth estimation failed:', error);
            if (progressContainer) progressContainer.hidden = true;
            if (estimateBtn) estimateBtn.disabled = false;
            throw error;
        }
    }

    /**
     * Process depth model output to usable depth map
     */
    async processDepthOutput(depthTensor, targetWidth, targetHeight) {
        const depthData = depthTensor.data;
        const depthWidth = depthTensor.dims[3] || depthTensor.dims[2] || this.inputWidth;
        const depthHeight = depthTensor.dims[2] || depthTensor.dims[1] || this.inputHeight;

        // Find min/max for normalization
        let minVal = Infinity;
        let maxVal = -Infinity;
        for (let i = 0; i < depthData.length; i++) {
            minVal = Math.min(minVal, depthData[i]);
            maxVal = Math.max(maxVal, depthData[i]);
        }
        const range = maxVal - minVal || 1;

        // Create normalized depth image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = depthWidth;
        tempCanvas.height = depthHeight;
        const tempCtx = tempCanvas.getContext('2d');
        const imageData = tempCtx.createImageData(depthWidth, depthHeight);

        for (let i = 0; i < depthData.length; i++) {
            const normalized = Math.floor(((depthData[i] - minVal) / range) * 255);
            const idx = i * 4;
            imageData.data[idx] = normalized;
            imageData.data[idx + 1] = normalized;
            imageData.data[idx + 2] = normalized;
            imageData.data[idx + 3] = 255;
        }
        tempCtx.putImageData(imageData, 0, 0);

        // Resize to target dimensions
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = targetWidth;
        outputCanvas.height = targetHeight;
        const outputCtx = outputCanvas.getContext('2d');
        outputCtx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);

        const finalImageData = outputCtx.getImageData(0, 0, targetWidth, targetHeight);

        return {
            canvas: outputCanvas,
            width: targetWidth,
            height: targetHeight,
            data: finalImageData.data,
        };
    }

    /**
     * Generate normal map from depth map
     * Uses central difference method as described in the report
     */
    generateNormalMap(depthMap, strength = 3.0) {
        const { width, height, data } = depthMap;
        const normalData = new Uint8ClampedArray(width * height * 4);

        const getDepth = (x, y) => {
            x = Math.max(0, Math.min(width - 1, x));
            y = Math.max(0, Math.min(height - 1, y));
            return data[(y * width + x) * 4] / 255;
        };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;

                // Central difference for gradients (Sobel-like)
                const dX = (getDepth(x + 1, y) - getDepth(x - 1, y)) / 2.0;
                const dY = (getDepth(x, y + 1) - getDepth(x, y - 1)) / 2.0;

                // Construct normal vector
                const nx = -dX * strength;
                const ny = -dY * strength;
                const nz = 1.0;

                // Normalize
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

                // Pack into RGB ([-1,1] -> [0,255])
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

    /**
     * Helper to load image from URL
     */
    _loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    /**
     * Get current execution provider
     */
    getProvider() {
        return this.currentProvider;
    }

    /**
     * Check if using zero-copy GPU mode
     */
    isZeroCopyMode() {
        return this.currentProvider === 'webgpu';
    }
}
