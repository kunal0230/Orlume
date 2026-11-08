/**
 * ImageUpscaler - AI Image Enhancement & Restoration
 * 
 * Uses self-hosted Python server with:
 * - Real-ESRGAN for general image enhancement
 * - GFPGAN for face restoration
 * 
 * Falls back to local browser AI if server unavailable
 */

export class ImageUpscaler {
    constructor() {
        this.upscaler = null;
        this.isLoading = false;
        this.isProcessing = false;

        // Settings
        this.scaleFactor = 2;
        this.useAI = true;
        this.enhanceFace = false;
        this.sharpenEdges = true;
        this.processingMode = 'both'; // 'enhance', 'upscale', or 'both'
        this.modelType = 'slim'; // 'slim' (fast, local) or 'thick' (ultra quality)
        this.useRemoteServer = false; // By default use fast client-side WebGL
        this.serverUrl = 'http://localhost:8000';
        this.maxDimension = 4096; // Safe default matching hardware MAX_TEXTURE_SIZE
    }

    // Setters
    setScaleFactor(factor) {
        this.scaleFactor = Math.min(4, Math.max(1, factor));
    }

    setMaxDimension(maxDim) {
        if (typeof maxDim === 'number' && maxDim > 0) {
            this.maxDimension = maxDim;
        }
    }

    setUseAI(enabled) {
        this.useAI = enabled;
    }

    setModelType(type) {
        this.modelType = type === 'thick' ? 'thick' : 'slim';
    }

    setUseRemoteServer(enabled) {
        this.useRemoteServer = Boolean(enabled);
    }

    setEnhanceFace(enabled) {
        this.enhanceFace = enabled;
    }

    setSharpenEdges(enabled) {
        this.sharpenEdges = enabled;
    }

    setProcessingMode(mode) {
        this.processingMode = mode; // 'enhance', 'upscale', 'both'
    }

    setServerUrl(url) {
        this.serverUrl = url.replace(/\/$/, ''); // Remove trailing slash
    }

    getOutputDimensions(width, height, maxDimension = this.maxDimension) {
        const max = maxDimension || 4096;

        if (this.processingMode === 'enhance') {
            // Enhance only - same size, clamped to maxDimension if already exceeding
            if (width > max || height > max) {
                const ratio = Math.min(max / width, max / height);
                return {
                    width: Math.round(width * ratio),
                    height: Math.round(height * ratio),
                    clamped: true,
                    originalTargetWidth: width,
                    originalTargetHeight: height
                };
            }
            return { width, height, clamped: false };
        }

        const rawTargetWidth = Math.round(width * this.scaleFactor);
        const rawTargetHeight = Math.round(height * this.scaleFactor);

        if (rawTargetWidth > max || rawTargetHeight > max) {
            const ratio = Math.min(max / rawTargetWidth, max / rawTargetHeight);
            return {
                width: Math.round(rawTargetWidth * ratio),
                height: Math.round(rawTargetHeight * ratio),
                clamped: true,
                originalTargetWidth: rawTargetWidth,
                originalTargetHeight: rawTargetHeight
            };
        }

        return {
            width: rawTargetWidth,
            height: rawTargetHeight,
            clamped: false
        };
    }

    /**
     * Check if server is available
     */
    async checkServerHealth() {
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Main processing function
     */
    async upscale(source, progressCallback = () => { }) {
        if (this.isProcessing) {
            throw new Error('Processing already in progress');
        }

        this.isProcessing = true;

        try {
            const srcWidth = source.width || source.naturalWidth;
            const srcHeight = source.height || source.naturalHeight;
            const dims = this.getOutputDimensions(srcWidth, srcHeight, this.maxDimension);
            const outWidth = dims.width;
            const outHeight = dims.height;

            if (this.useAI) {
                // If remote server explicitly enabled, try server first
                if (this.useRemoteServer) {
                    const serverAvailable = await this.checkServerHealth();
                    if (serverAvailable) {
                        return await this._processWithServer(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
                    }
                    progressCallback(5, 'Remote server unavailable, using local WebGL AI...');
                }

                // Default: Fast, private, client-side WebGL Super Resolution
                return await this._processWithLocalAI(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
            } else {
                return await this._processClassic(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Process with local Python server (Real-ESRGAN + GFPGAN)
     */
    async _processWithServer(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback) {
        progressCallback(5, 'Connecting to AI server...');

        // For large images, clamp input to max 2500px before base64 encoding to prevent huge payload
        let sWidth = srcWidth;
        let sHeight = srcHeight;
        if (srcWidth > 2500 || srcHeight > 2500) {
            const r = Math.min(2500 / srcWidth, 2500 / srcHeight);
            sWidth = Math.max(1, Math.floor(srcWidth * r));
            sHeight = Math.max(1, Math.floor(srcHeight * r));
        }

        // Convert source to base64
        const canvas = document.createElement('canvas');
        canvas.width = sWidth;
        canvas.height = sHeight;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, sWidth, sHeight);
        const base64 = canvas.toDataURL('image/jpeg', 0.95);

        progressCallback(15, 'Sending to AI server...');

        try {
            // Determine which endpoint to call
            let endpoint = '/process'; // Default: combined
            if (this.processingMode === 'enhance') {
                endpoint = this.enhanceFace ? '/enhance-face' : '/enhance';
            } else if (this.processingMode === 'upscale') {
                endpoint = '/upscale';
            }

            const response = await fetch(`${this.serverUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image: base64,
                    scale: this.processingMode === 'enhance' ? 1 : this.scaleFactor,
                    enhance_face: this.enhanceFace
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Server error');
            }

            progressCallback(80, 'Receiving enhanced image...');

            const result = await response.json();

            // Convert result to canvas
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = result.image;
            });

            progressCallback(90, 'Finalizing...');

            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = img.width;
            outputCanvas.height = img.height;
            const outputCtx = outputCanvas.getContext('2d');
            outputCtx.drawImage(img, 0, 0);

            // Apply additional sharpening if enabled and image size is within CPU limits
            if (this.sharpenEdges && outputCanvas.width * outputCanvas.height <= 2000000) {
                progressCallback(95, 'Sharpening...');
                await this._enhanceDetails(outputCtx, outputCanvas.width, outputCanvas.height);
            }

            progressCallback(100, 'Complete!');
            return outputCanvas;

        } catch (error) {
            console.error('Server processing failed:', error);
            progressCallback(20, 'Server failed, using local AI...');
            return await this._processWithLocalAI(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
        }
    }

    /**
     * Process with local browser AI (Real-ESRGAN WebGL)
     */
    async _processWithLocalAI(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback) {
        progressCallback(10, 'Loading local neural super-resolution model...');

        try {
            const { default: Upscaler } = await import('upscaler');

            const scale = this.processingMode === 'enhance' ? 2 : this.scaleFactor;
            const clampedScale = scale <= 2 ? 2 : (scale <= 3 ? 3 : 4);
            let model;

            if (this.modelType === 'thick') {
                if (clampedScale <= 2) {
                    const { default: m } = await import('@upscalerjs/esrgan-thick/2x');
                    model = m;
                } else if (clampedScale <= 3) {
                    const { default: m } = await import('@upscalerjs/esrgan-thick/3x');
                    model = m;
                } else {
                    const { default: m } = await import('@upscalerjs/esrgan-thick/4x');
                    model = m;
                }
            } else {
                // Default: Fast, local ESRGAN-Slim served directly from /models/esrgan-slim/
                model = {
                    scale: clampedScale,
                    modelType: 'layers',
                    path: `/models/esrgan-slim/x${clampedScale}/model.json`,
                    inputRange: [0, 255],
                    outputRange: [0, 255],
                    _internals: {
                        path: `models/x${clampedScale}/model.json`,
                        name: '@upscalerjs/esrgan-slim',
                        version: '1.0.0-beta.12'
                    }
                };
            }

            progressCallback(25, 'Initializing WebGL GPU engine...');

            if (this.upscaler) {
                try {
                    await this.upscaler.dispose();
                } catch {
                    // Ignore disposal error
                }
                this.upscaler = null;
            }

            this.upscaler = new Upscaler({ model });
            await this.upscaler.ready;

            // Constrain source dimensions so neural output does not exceed this.maxDimension
            const maxAllowedInputW = Math.floor(this.maxDimension / clampedScale);
            const maxAllowedInputH = Math.floor(this.maxDimension / clampedScale);

            let sourceToProcess = source;
            let currentSrcW = srcWidth;
            let currentSrcH = srcHeight;

            if (srcWidth > maxAllowedInputW || srcHeight > maxAllowedInputH) {
                const ratio = Math.min(maxAllowedInputW / srcWidth, maxAllowedInputH / srcHeight);
                currentSrcW = Math.max(1, Math.floor(srcWidth * ratio));
                currentSrcH = Math.max(1, Math.floor(srcHeight * ratio));

                progressCallback(30, `Optimizing large input (${srcWidth}×${srcHeight} → ${currentSrcW}×${currentSrcH})...`);

                const preCanvas = document.createElement('canvas');
                preCanvas.width = currentSrcW;
                preCanvas.height = currentSrcH;
                const preCtx = preCanvas.getContext('2d');
                preCtx.imageSmoothingEnabled = true;
                preCtx.imageSmoothingQuality = 'high';
                preCtx.drawImage(source, 0, 0, currentSrcW, currentSrcH);
                sourceToProcess = preCanvas;
            }

            progressCallback(35, 'Processing neural super-resolution patches...');

            // Patch sizing: 128px offers optimal balance of speed, GPU memory, and boundary seam minimization.
            // awaitNextFrame: true yields execution to requestAnimationFrame between patches, keeping the UI
            // responsive and preventing browser watchdog hangs on multi-megapixel images.
            const patchSize = 128;
            const padding = 6;

            const upscaledTensor = await this.upscaler.upscale(sourceToProcess, {
                output: 'tensor',
                patchSize,
                padding,
                awaitNextFrame: true,
                progress: (progress) => {
                    const pct = Math.round(35 + progress * 50);
                    progressCallback(pct, `Upscaling image patches... ${Math.round(progress * 100)}%`);
                }
            });

            progressCallback(88, 'Finalizing enhanced resolution...');

            const tensorH = upscaledTensor.shape[0];
            const tensorW = upscaledTensor.shape[1];

            const rawCanvas = document.createElement('canvas');
            rawCanvas.width = tensorW;
            rawCanvas.height = tensorH;

            const tf = await import('@tensorflow/tfjs');
            const tensorToDraw = upscaledTensor.shape.length === 4 ? upscaledTensor.squeeze([0]) : upscaledTensor;

            // TensorFlow.js toPixels expects int32 for [0, 255] or float32 for [0, 1].
            // ESRGAN outputs float32 values in [0, 255] which may slightly exceed 1.0 or 255.
            const intTensor = tf.tidy(() => {
                return tensorToDraw.clipByValue(0, 255).cast('int32');
            });

            await tf.browser.toPixels(intTensor, rawCanvas);

            intTensor.dispose();
            upscaledTensor.dispose();
            if (tensorToDraw !== upscaledTensor) {
                tensorToDraw.dispose();
            }

            // Target dimensions
            const targetWidth = this.processingMode === 'enhance' ? srcWidth : outWidth;
            const targetHeight = this.processingMode === 'enhance' ? srcHeight : outHeight;

            let canvas = rawCanvas;
            if (rawCanvas.width !== targetWidth || rawCanvas.height !== targetHeight) {
                const finalCanvas = document.createElement('canvas');
                finalCanvas.width = targetWidth;
                finalCanvas.height = targetHeight;
                const finalCtx = finalCanvas.getContext('2d');
                finalCtx.imageSmoothingEnabled = true;
                finalCtx.imageSmoothingQuality = 'high';
                finalCtx.drawImage(rawCanvas, 0, 0, targetWidth, targetHeight);
                canvas = finalCanvas;
            }

            if (this.sharpenEdges) {
                // Only run per-pixel CPU unsharp mask on small-to-medium images (<= 2MP)
                // Real-ESRGAN already sharpens high-frequency edges natively.
                if (targetWidth * targetHeight <= 2000000) {
                    progressCallback(95, 'Refining edge sharpness...');
                    const ctx = canvas.getContext('2d');
                    await this._enhanceDetails(ctx, targetWidth, targetHeight);
                } else {
                    console.log(`[ImageUpscaler] Output size ${targetWidth}×${targetHeight} exceeds 2MP; preserving neural sharpness without CPU loop.`);
                }
            }

            progressCallback(100, 'Super-resolution complete!');
            return canvas;

        } catch (error) {
            console.error('Local AI failed, falling back to bicubic interpolation:', error);
            return await this._processClassic(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
        }
    }

    /**
     * Classic processing (no AI)
     */
    async _processClassic(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback) {
        progressCallback(20, 'Processing...');

        const canvas = document.createElement('canvas');
        canvas.width = outWidth;
        canvas.height = outHeight;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, srcWidth, srcHeight, 0, 0, outWidth, outHeight);

        if (this.sharpenEdges && outWidth * outHeight <= 2000000) {
            progressCallback(60, 'Sharpening...');
            await this._enhanceDetails(ctx, outWidth, outHeight);
        }

        progressCallback(100, 'Complete!');
        return canvas;
    }

    /**
     * Detail enhancement (unsharp mask)
     */
    async _enhanceDetails(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const original = new Uint8ClampedArray(data);

        const amount = 0.3;
        const threshold = 8;

        for (let i = 0; i < data.length; i += 4) {
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);

            if (x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2) continue;

            for (let c = 0; c < 3; c++) {
                const idx = i + c;
                const current = original[idx];
                const top = original[idx - width * 4];
                const bottom = original[idx + width * 4];
                const left = original[idx - 4];
                const right = original[idx + 4];
                const avgNeighbor = (top + bottom + left + right) / 4;
                const diff = current - avgNeighbor;

                if (Math.abs(diff) > threshold) {
                    data[idx] = Math.min(255, Math.max(0, Math.round(current + diff * amount)));
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Upscale from WebGL canvas
     */
    async upscaleFromWebGL(gl, width, height, progressCallback = () => { }) {
        progressCallback(0, 'Reading image...');

        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        const imageData = tempCtx.createImageData(width, height);

        // Flip Y axis (WebGL origin is bottom-left)
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            for (let x = 0; x < width * 4; x++) {
                imageData.data[dstRow + x] = pixels[srcRow + x];
            }
        }

        tempCtx.putImageData(imageData, 0, 0);
        progressCallback(5, 'Starting processing...');

        return this.upscale(tempCanvas, (percent, msg) => {
            progressCallback(5 + percent * 0.95, msg);
        });
    }

    cancel() {
        this.isProcessing = false;
    }

    dispose() {
        if (this.upscaler) {
            this.upscaler.dispose();
            this.upscaler = null;
        }
    }
}
