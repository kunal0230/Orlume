import { GeometryMath } from './GeometryMath.js';

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
     * Apply geometric transform (crop, rotate, flip)
     * Returns the transformed PROXY image for UI display
     * Also updates the original blob in background
     */
    async applyTransform(image, { crop, rotation, flipX, flipY }, depthMap = null) {
        // 1. Transform the proxy (what the user sees)
        // Note: The 'image' passed here is usually the current proxy

        console.log('Applying transform:', { crop, rotation, flipX, flipY });

        const transformedProxyCanvas = this._performTransform(image, { crop, rotation, flipX, flipY });

        // Update our local proxy reference
        // We need to create a new Image element from the canvas result
        const newProxyImage = new Image();
        const proxyUrl = transformedProxyCanvas.toDataURL(this.originalMimeType);
        newProxyImage.src = proxyUrl;
        await new Promise(r => newProxyImage.onload = r);

        // Update internal state
        const newProxy = {
            element: newProxyImage,
            width: newProxyImage.naturalWidth, // 278
            height: newProxyImage.naturalHeight,
            canvas: transformedProxyCanvas,
            imageData: transformedProxyCanvas.getContext('2d').getImageData(0, 0, newProxyImage.naturalWidth, newProxyImage.naturalHeight),
            dataURL: proxyUrl
        };

        this.proxy = newProxy;

        // 2. Transform Depth Map if provided
        let newDepthMap = null;
        if (depthMap) {
            newDepthMap = this._transformDepthMap(depthMap, { crop, rotation, flipX, flipY });
        }

        // 3. Update the Original Blob (Scale up the transform)
        await this.updateOriginalWithTransform({ crop, rotation, flipX, flipY });

        return { image: newProxy, depthMap: newDepthMap };
    }

    /**
     * Transform depth map using canvas operations
     */
    _transformDepthMap(depthMap, transform) {
        // 1. Convert depth data to temporary canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = depthMap.width;
        tempCanvas.height = depthMap.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Put depth data
        const imageData = new ImageData(depthMap.data, depthMap.width, depthMap.height);
        tempCtx.putImageData(imageData, 0, 0);

        // 2. Apply generic transform
        // Note: We use scale=1 because image and depth map are currently 1:1 in our pipeline (at proxy resolution)
        const newCanvas = this._performTransform(tempCanvas, transform, 1.0);

        // 3. Extract new data
        const newCtx = newCanvas.getContext('2d');
        const newData = newCtx.getImageData(0, 0, newCanvas.width, newCanvas.height);

        return {
            width: newCanvas.width,
            height: newCanvas.height,
            data: newData.data // Uint8ClampedArray
        };
    }

    /**
     * Helper to perform canvas transformation
     */
    _performTransform(sourceImage, { crop, rotation, flipX, flipY }, sourceScale = 1.0) {
        const canvas = document.createElement('canvas');
        canvas.width = crop.width * sourceScale;
        canvas.height = crop.height * sourceScale;
        const ctx = canvas.getContext('2d');

        // We want to project the Source Image -> Destination Canvas
        // such that the 'crop' rect (in Visual Space) fills the Canvas.

        // 1. Transform coordinate system to be relative to the Crop Rect Top-Left
        // The crop rect is defined in Visual Space (where the image is already rotated/centered)
        ctx.translate(-crop.x * sourceScale, -crop.y * sourceScale);

        // 2. Apply the Visual Transformations to the Source Image to recreate Visual Space
        // Center of the source image
        const srcW = (sourceImage.naturalWidth || sourceImage.width) * sourceScale;
        const srcH = (sourceImage.naturalHeight || sourceImage.height) * sourceScale;
        const cx = srcW / 2;
        const cy = srcH / 2;

        ctx.translate(cx, cy);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        ctx.translate(-cx, -cy);

        // 3. Draw Source
        const drawable = sourceImage.canvas || sourceImage.element || sourceImage;
        try {
            ctx.drawImage(drawable, 0, 0, srcW, srcH);
        } catch (e) {
            console.error('Draw error in transform:', e, sourceImage);
        }

        return canvas;
    }

    /**
     * Process the original full-res image with the transform
     */
    async updateOriginalWithTransform({ crop, rotation, flipX, flipY }) {
        // Load full res
        const fullResImg = await this.loadImageFromURL(this.originalBlobURL);

        // Calculate scale factor between Proxy (where crop was defined) and Original
        // crop is in Proxy coordinates!
        // this.proxyScale = Proxy / Original
        // So Original = Proxy / this.proxyScale

        const scale = 1 / Math.max(0.001, this.proxyScale);

        // Transform
        const newCanvas = this._performTransform(fullResImg, { crop, rotation, flipX, flipY }, scale);

        // Update Original Blob
        return new Promise(resolve => {
            newCanvas.toBlob(blob => {
                // Revoke old URL
                if (this.originalBlobURL) URL.revokeObjectURL(this.originalBlobURL);

                this.originalBlob = blob;
                this.originalBlobURL = URL.createObjectURL(blob);
                this.originalWidth = newCanvas.width;
                this.originalHeight = newCanvas.height;

                // Recalculate proxy scale based on new original dimensions vs new proxy dimensions
                // New proxy width is crop.width
                // New original width is crop.width * scale
                // So scale shouldn't change significantly, but good to be precise.
                this.proxyScale = this.proxy.width / this.originalWidth;

                console.log(`✅ Original updated: ${this.originalWidth}×${this.originalHeight}`);
                console.log(`   New Proxy Scale: ${this.proxyScale}`);

                resolve();
            }, this.originalMimeType, 0.95);
        });
    }

    /**
     * Apply Homography Transform (Geometry Engine)
     * Resamples image using inverse pixel mapping
     * Calculates expanded bounding box to prevent corner clipping
     * @param {Object} image - Input image (proxy or full res)
     * @param {Float32Array} matrix - 3x3 Homography Matrix
     * @returns {HTMLCanvasElement} - Transformed canvas
     */
    applyHomography(image, matrix) {
        if (!matrix) return image; // Identity

        const srcWidth = image.width;
        const srcHeight = image.height;

        // Transform the 4 corners to find the bounding box of the output
        const corners = [
            [-1, -1], [1, -1], [1, 1], [-1, 1] // Normalized corners
        ];

        const transformedCorners = corners.map(([nx, ny]) => {
            const w = matrix[6] * nx + matrix[7] * ny + matrix[8];
            const polyW = 1.0 / (w || 0.00001);
            return [
                (matrix[0] * nx + matrix[1] * ny + matrix[2]) * polyW,
                (matrix[3] * nx + matrix[4] * ny + matrix[5]) * polyW
            ];
        });

        // Find bounding box in normalized coords
        const xCoords = transformedCorners.map(c => c[0]);
        const yCoords = transformedCorners.map(c => c[1]);
        const minX = Math.min(...xCoords);
        const maxX = Math.max(...xCoords);
        const minY = Math.min(...yCoords);
        const maxY = Math.max(...yCoords);

        // Calculate output dimensions (scale to fit the transformed content)
        const outWidth = Math.ceil(((maxX - minX) / 2) * srcWidth);
        const outHeight = Math.ceil(((maxY - minY) / 2) * srcHeight);

        // Offset to center the bounding box
        const offsetX = (minX + maxX) / 2;
        const offsetY = (minY + maxY) / 2;

        // Output canvas with expanded size
        const canvas = document.createElement('canvas');
        canvas.width = outWidth;
        canvas.height = outHeight;
        const ctx = canvas.getContext('2d');
        const outputData = ctx.createImageData(outWidth, outHeight);

        // Input data
        let inputCtx;
        if (image.canvas) {
            inputCtx = image.canvas.getContext('2d');
        } else {
            const temp = document.createElement('canvas');
            temp.width = srcWidth;
            temp.height = srcHeight;
            inputCtx = temp.getContext('2d');
            inputCtx.drawImage(image.element || image, 0, 0);
        }
        const inputData = inputCtx.getImageData(0, 0, srcWidth, srcHeight);

        // Inverse matrix for reverse mapping
        const invMatrix = GeometryMath.invert(matrix);
        if (!invMatrix) return image; // Singular

        const srcData = inputData.data;
        const dstData = outputData.data;

        for (let y = 0; y < outHeight; y++) {
            // Map output pixel to normalized coords (accounting for bounding box)
            const ny = minY + (y / outHeight) * (maxY - minY);

            for (let x = 0; x < outWidth; x++) {
                const nx = minX + (x / outWidth) * (maxX - minX);

                // Inverse Project back to source normalized coords
                const w = invMatrix[6] * nx + invMatrix[7] * ny + invMatrix[8];
                const polyW = 1.0 / (w || 0.00001);

                const srcNx = (invMatrix[0] * nx + invMatrix[1] * ny + invMatrix[2]) * polyW;
                const srcNy = (invMatrix[3] * nx + invMatrix[4] * ny + invMatrix[5]) * polyW;

                // Denormalize to source pixel coords
                const u = (srcNx + 1) * 0.5 * srcWidth;
                const v = (srcNy + 1) * 0.5 * srcHeight;

                // Boundary check (source image bounds)
                if (u < 0 || u >= srcWidth - 1 || v < 0 || v >= srcHeight - 1) {
                    // Leave transparent
                    continue;
                }

                // Bilinear Sample
                const u0 = Math.floor(u);
                const v0 = Math.floor(v);
                const u1 = u0 + 1;
                const v1 = v0 + 1;

                const fu = u - u0;
                const fv = v - v0;
                const w00 = (1 - fu) * (1 - fv);
                const w10 = fu * (1 - fv);
                const w01 = (1 - fu) * fv;
                const w11 = fu * fv;

                const idx = (y * outWidth + x) * 4;

                const i00 = (v0 * srcWidth + u0) * 4;
                const i10 = (v0 * srcWidth + u1) * 4;
                const i01 = (v1 * srcWidth + u0) * 4;
                const i11 = (v1 * srcWidth + u1) * 4;

                for (let c = 0; c < 4; c++) {
                    dstData[idx + c] =
                        srcData[i00 + c] * w00 +
                        srcData[i10 + c] * w10 +
                        srcData[i01 + c] * w01 +
                        srcData[i11 + c] * w11;
                }
            }
        }

        ctx.putImageData(outputData, 0, 0);
        return canvas;
    }

    /**
     * Commit Homography to Proxy (Destructive Edit)
     */
    async commitHomography(matrix) {
        if (!this.proxy) return null;

        console.log('Committing Homography...');

        // 1. Apply to Proxy
        const newCanvas = this.applyHomography(this.proxy, matrix);

        // 2. Update Proxy
        const newProxyImage = new Image();
        const proxyUrl = newCanvas.toDataURL(this.originalMimeType);
        newProxyImage.src = proxyUrl;
        await new Promise(r => newProxyImage.onload = r);

        const newProxy = {
            element: newProxyImage,
            width: newProxyImage.naturalWidth,
            height: newProxyImage.naturalHeight,
            canvas: newCanvas,
            imageData: newCanvas.getContext('2d').getImageData(0, 0, newProxyImage.naturalWidth, newProxyImage.naturalHeight),
            dataURL: proxyUrl
        };

        this.proxy = newProxy;

        // Note: We do NOT update originalBlob here because JS homography is too slow for 40MP.
        // We defer full-res processing to Export time (or accept mismatch).
        // For V1, this is acceptable.

        return newProxy;
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
