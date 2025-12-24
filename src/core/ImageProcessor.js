/**
 * ImageProcessor - Manages proxy/original images for optimized editing
 * 
 * Features:
 * - Keeps original full-resolution blob reference
 * - Generates optimized proxy for editing
 * - Handles full-resolution export with all edits applied
 */

export class ImageProcessor {
    constructor() {
        // Original image data
        this.originalBlob = null;
        this.originalBlobURL = null;
        this.originalWidth = 0;
        this.originalHeight = 0;
        this.originalMimeType = 'image/jpeg';

        // Proxy image for editing
        this.proxy = null;
        this.proxyScale = 1.0;

        // Proxy size limits based on original resolution
        // Optimized for smooth real-time editing
        this.proxySizeThresholds = [
            { maxOriginal: 1280, proxyMax: null },      // No proxy needed
            { maxOriginal: 2500, proxyMax: 1280 },      // Standard proxy
            { maxOriginal: 5000, proxyMax: 1280 },      // Large images
            { maxOriginal: Infinity, proxyMax: 1440 }   // Very large images
        ];
    }

    /**
     * Process an uploaded file - create both original reference and proxy
     */
    async processFile(file) {
        // Store original blob
        this.originalBlob = file;
        this.originalBlobURL = URL.createObjectURL(file);
        this.originalMimeType = file.type || 'image/jpeg';

        // Load image to get dimensions
        const img = await this.loadImageFromURL(this.originalBlobURL);
        this.originalWidth = img.naturalWidth;
        this.originalHeight = img.naturalHeight;

        // Determine proxy size
        const maxDim = Math.max(this.originalWidth, this.originalHeight);
        const proxyMax = this.getProxySize(maxDim);

        // Generate proxy
        this.proxy = await this.generateProxy(img, proxyMax);

        console.log(`📷 Image loaded: ${this.originalWidth}×${this.originalHeight}`);
        console.log(`🔧 Proxy: ${this.proxy.width}×${this.proxy.height} (scale: ${this.proxyScale.toFixed(3)})`);

        return this.proxy;
    }

    /**
     * Get appropriate proxy size for given original dimension
     */
    getProxySize(originalMax) {
        for (const threshold of this.proxySizeThresholds) {
            if (originalMax <= threshold.maxOriginal) {
                return threshold.proxyMax;
            }
        }
        return 2560; // Default for very large images
    }

    /**
     * Generate proxy image at specified max dimension
     */
    async generateProxy(img, maxDim) {
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        // Calculate scale if needed
        if (maxDim && (width > maxDim || height > maxDim)) {
            const scale = maxDim / Math.max(width, height);
            width = Math.floor(width * scale);
            height = Math.floor(height * scale);
            this.proxyScale = scale;
        } else {
            this.proxyScale = 1.0;
        }

        // Create canvas and draw
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        return {
            element: img,
            width,
            height,
            canvas,
            imageData: ctx.getImageData(0, 0, width, height),
            dataURL: canvas.toDataURL('image/jpeg', 0.92)
        };
    }

    /**
     * Load image from URL
     */
    loadImageFromURL(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    /**
     * Export at full resolution with edits applied
     * @param {Function} applyEdits - Function that applies edits to imageData
     * @param {Object} options - Export options (format, quality)
     * @param {Function} onProgress - Progress callback
     */
    async exportFullResolution(applyEdits, depthData, options = {}, onProgress = () => { }) {
        const format = options.format || 'image/png';
        const quality = options.quality || 0.95;

        onProgress(0, 'Loading full resolution image...');

        // Load original at full resolution
        const img = await this.loadImageFromURL(this.originalBlobURL);

        onProgress(10, 'Creating full resolution canvas...');

        // Create full-res canvas
        const canvas = document.createElement('canvas');
        canvas.width = this.originalWidth;
        canvas.height = this.originalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        onProgress(20, 'Getting image data...');

        // Get full-res image data
        const imageData = ctx.getImageData(0, 0, this.originalWidth, this.originalHeight);

        onProgress(30, 'Upscaling depth map...');

        // Upscale depth map if needed
        let fullResDepth = depthData;
        if (depthData && this.proxyScale < 1.0) {
            fullResDepth = this.upscaleDepthMap(depthData, this.originalWidth, this.originalHeight);
        }

        onProgress(50, 'Applying edits at full resolution...');

        // Apply edits to full-res image
        const editedData = await applyEdits(imageData, fullResDepth, (p) => {
            onProgress(50 + p * 0.4, 'Rendering...');
        });

        onProgress(90, 'Encoding image...');

        // Put edited data back
        ctx.putImageData(editedData, 0, 0);

        onProgress(95, 'Preparing download...');

        // Get data URL
        const dataURL = canvas.toDataURL(format, quality);

        onProgress(100, 'Complete!');

        return {
            dataURL,
            width: this.originalWidth,
            height: this.originalHeight,
            format
        };
    }

    /**
     * Upscale depth map using bilinear interpolation
     */
    upscaleDepthMap(depthData, targetWidth, targetHeight) {
        const srcWidth = depthData.width;
        const srcHeight = depthData.height;
        const srcData = depthData.data;

        const dstData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

        const scaleX = srcWidth / targetWidth;
        const scaleY = srcHeight / targetHeight;

        for (let y = 0; y < targetHeight; y++) {
            for (let x = 0; x < targetWidth; x++) {
                // Source position
                const srcX = x * scaleX;
                const srcY = y * scaleY;

                // Bilinear interpolation
                const x0 = Math.floor(srcX);
                const y0 = Math.floor(srcY);
                const x1 = Math.min(x0 + 1, srcWidth - 1);
                const y1 = Math.min(y0 + 1, srcHeight - 1);

                const fx = srcX - x0;
                const fy = srcY - y0;

                // Get 4 source pixels
                const getDepth = (px, py) => srcData[(py * srcWidth + px) * 4];

                const d00 = getDepth(x0, y0);
                const d10 = getDepth(x1, y0);
                const d01 = getDepth(x0, y1);
                const d11 = getDepth(x1, y1);

                // Interpolate
                const depth = (1 - fx) * (1 - fy) * d00 + fx * (1 - fy) * d10 + (1 - fx) * fy * d01 + fx * fy * d11;

                const dstIdx = (y * targetWidth + x) * 4;
                dstData[dstIdx] = depth;
                dstData[dstIdx + 1] = depth;
                dstData[dstIdx + 2] = depth;
                dstData[dstIdx + 3] = 255;
            }
        }

        return {
            width: targetWidth,
            height: targetHeight,
            data: dstData
        };
    }

    /**
     * Get info about current image
     */
    getInfo() {
        return {
            originalWidth: this.originalWidth,
            originalHeight: this.originalHeight,
            proxyWidth: this.proxy?.width || 0,
            proxyHeight: this.proxy?.height || 0,
            proxyScale: this.proxyScale,
            isProxy: this.proxyScale < 1.0,
            mimeType: this.originalMimeType
        };
    }

    /**
     * Cleanup resources
     */
    dispose() {
        if (this.originalBlobURL) {
            URL.revokeObjectURL(this.originalBlobURL);
            this.originalBlobURL = null;
        }
        this.originalBlob = null;
        this.proxy = null;
    }
}
