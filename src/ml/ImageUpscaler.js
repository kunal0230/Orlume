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
        this.serverUrl = 'http://localhost:8000';
    }

    // Setters
    setScaleFactor(factor) {
        this.scaleFactor = Math.min(4, Math.max(1, factor));
    }

    setUseAI(enabled) {
        this.useAI = enabled;
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

    getOutputDimensions(width, height) {
        if (this.processingMode === 'enhance') {
            // Enhance only - same size
            return { width, height };
        }
        return {
            width: Math.round(width * this.scaleFactor),
            height: Math.round(height * this.scaleFactor)
        };
    }

    /**
     * Check if server is available
     */
    async checkServerHealth() {
        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(3000)
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
            const { width: outWidth, height: outHeight } = this.getOutputDimensions(srcWidth, srcHeight);

            if (this.useAI) {
                // Try server first
                const serverAvailable = await this.checkServerHealth();
                if (serverAvailable) {
                    return await this._processWithServer(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
                } else {
                    progressCallback(5, 'Server unavailable, using local AI...');
                    return await this._processWithLocalAI(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback);
                }
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

        // Convert source to base64
        const canvas = document.createElement('canvas');
        canvas.width = srcWidth;
        canvas.height = srcHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0);
        const base64 = canvas.toDataURL('image/png');

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

            // Apply additional sharpening if enabled
            if (this.sharpenEdges) {
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
     * Process with local browser AI (ESRGAN-thick fallback)
     */
    async _processWithLocalAI(source, srcWidth, srcHeight, outWidth, outHeight, progressCallback) {
        progressCallback(10, 'Loading local AI model...');

        try {
            const { default: Upscaler } = await import('upscaler');

            let model;
            const scale = this.processingMode === 'enhance' ? 2 : this.scaleFactor;

            if (scale <= 2) {
                const { default: m } = await import('@upscalerjs/esrgan-thick/2x');
                model = m;
            } else if (scale <= 3) {
                const { default: m } = await import('@upscalerjs/esrgan-thick/3x');
                model = m;
            } else {
                const { default: m } = await import('@upscalerjs/esrgan-thick/4x');
                model = m;
            }

            progressCallback(30, 'Initializing local AI...');

            this.upscaler = new Upscaler({ model });

            progressCallback(40, 'Processing...');

            const enhancedDataUrl = await this.upscaler.upscale(source, {
                output: 'base64',
                patchSize: 64,
                padding: 6,
                progress: (progress) => {
                    progressCallback(40 + progress * 45, `Processing... ${Math.round(progress * 100)}%`);
                }
            });

            progressCallback(85, 'Finalizing...');

            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = enhancedDataUrl;
            });

            // Scale to target size
            const targetWidth = this.processingMode === 'enhance' ? srcWidth : outWidth;
            const targetHeight = this.processingMode === 'enhance' ? srcHeight : outHeight;

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

            if (this.sharpenEdges) {
                progressCallback(92, 'Sharpening...');
                await this._enhanceDetails(ctx, targetWidth, targetHeight);
            }

            progressCallback(100, 'Complete!');
            return canvas;

        } catch (error) {
            console.error('Local AI failed:', error);
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

        if (this.sharpenEdges) {
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
