/**
 * AlbedoEstimator - Intrinsic Image Decomposition
 * 
 * Separates an image into Albedo (true color) and Shading (lighting).
 * Uses depth gradient as a proxy for shading estimation.
 * 
 * The key insight: Image = Albedo × Shading
 * Therefore: Albedo = Image / Shading
 * 
 * We estimate shading from depth gradients (surfaces facing away from 
 * a virtual overhead light should be darker).
 */

export class AlbedoEstimator {
    constructor() {
        this.albedoCanvas = null;
        this.shadingCanvas = null;
    }

    /**
     * Estimate albedo from image using depth-gradient based shading
     * 
     * @param {HTMLImageElement|HTMLCanvasElement} image - Input image
     * @param {HTMLCanvasElement} depthMap - Depth map (brighter = farther)
     * @param {HTMLCanvasElement} normalMap - Normal map (RGB = XYZ)
     * @param {Object} options - Configuration options
     * @returns {Object} - { albedo: Canvas, shading: Canvas }
     */
    estimate(image, depthMap, normalMap, options = {}) {
        const {
            shadingStrength = 0.5,    // How much depth affects shading
            ambientLight = 0.3,       // Minimum light level
            assumedLightDir = [0, -1, 0.5], // Assumed original light direction (overhead)
            smoothingRadius = 3,      // Blur radius for shading
        } = options;

        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;

        console.log('🎨 Estimating albedo from image...');
        const startTime = performance.now();

        // Get image data
        const imageCanvas = this._toCanvas(image, width, height);
        const imageCtx = imageCanvas.getContext('2d');
        const imageData = imageCtx.getImageData(0, 0, width, height);
        const imgPixels = imageData.data;

        // Get normal map data (if available)
        let normalData = null;
        if (normalMap && normalMap.width && normalMap.height) {
            const normalCanvas = this._ensureCanvas(normalMap, width, height);
            const normalCtx = normalCanvas.getContext('2d');
            normalData = normalCtx.getImageData(0, 0, width, height).data;
        }

        // Get depth data (if available)
        let depthData = null;
        if (depthMap && depthMap.width && depthMap.height) {
            const depthCanvas = this._ensureCanvas(depthMap, width, height);
            const depthCtx = depthCanvas.getContext('2d');
            depthData = depthCtx.getImageData(0, 0, width, height).data;
        }

        // Create output canvases
        this.albedoCanvas = document.createElement('canvas');
        this.albedoCanvas.width = width;
        this.albedoCanvas.height = height;
        const albedoCtx = this.albedoCanvas.getContext('2d');
        const albedoData = albedoCtx.createImageData(width, height);

        this.shadingCanvas = document.createElement('canvas');
        this.shadingCanvas.width = width;
        this.shadingCanvas.height = height;
        const shadingCtx = this.shadingCanvas.getContext('2d');
        const shadingData = shadingCtx.createImageData(width, height);

        // Normalize assumed light direction
        const lightDir = this._normalize(assumedLightDir);

        // First pass: Estimate shading from normals
        const shadingBuffer = new Float32Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;

                let shading = 1.0;

                // If we have normals, use them to estimate shading
                if (normalData) {
                    // Decode normal from 0-255 to -1..1
                    const nx = (normalData[pixelIdx] / 255.0) * 2.0 - 1.0;
                    const ny = (normalData[pixelIdx + 1] / 255.0) * 2.0 - 1.0;
                    const nz = (normalData[pixelIdx + 2] / 255.0) * 2.0 - 1.0;

                    // N·L (Lambert shading from assumed light)
                    const NdotL = Math.max(0, nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]);
                    shading = ambientLight + (1.0 - ambientLight) * NdotL;
                }

                // Add depth-based shading variation
                if (depthData) {
                    const depth = depthData[pixelIdx] / 255.0;
                    // Deeper areas tend to be less lit (ambient occlusion proxy)
                    const depthFactor = 1.0 - depth * shadingStrength * 0.5;
                    shading *= Math.max(0.5, depthFactor);
                }

                shadingBuffer[idx] = Math.max(0.1, shading); // Avoid division by near-zero
            }
        }

        // Optional: Smooth the shading to reduce noise
        const smoothedShading = this._boxBlur(shadingBuffer, width, height, smoothingRadius);

        // Second pass: Calculate albedo = image / shading
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;

                const shading = smoothedShading[idx];

                // Extract RGB
                const r = imgPixels[pixelIdx];
                const g = imgPixels[pixelIdx + 1];
                const b = imgPixels[pixelIdx + 2];

                // Albedo = Image / Shading (clamped to valid range)
                albedoData.data[pixelIdx] = Math.min(255, Math.round(r / shading));
                albedoData.data[pixelIdx + 1] = Math.min(255, Math.round(g / shading));
                albedoData.data[pixelIdx + 2] = Math.min(255, Math.round(b / shading));
                albedoData.data[pixelIdx + 3] = 255;

                // Store shading for visualization
                const shadingViz = Math.round(shading * 255);
                shadingData.data[pixelIdx] = shadingViz;
                shadingData.data[pixelIdx + 1] = shadingViz;
                shadingData.data[pixelIdx + 2] = shadingViz;
                shadingData.data[pixelIdx + 3] = 255;
            }
        }

        albedoCtx.putImageData(albedoData, 0, 0);
        shadingCtx.putImageData(shadingData, 0, 0);

        const elapsed = performance.now() - startTime;
        console.log(`✅ Albedo estimated: ${width}×${height} (${elapsed.toFixed(0)}ms)`);

        return {
            albedo: this.albedoCanvas,
            shading: this.shadingCanvas,
            width,
            height
        };
    }

    /**
     * Simple box blur for smoothing
     */
    _boxBlur(data, width, height, radius) {
        if (radius <= 0) return data;

        const output = new Float32Array(data.length);
        const size = radius * 2 + 1;

        // Horizontal pass
        const temp = new Float32Array(data.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let count = 0;
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = Math.max(0, Math.min(width - 1, x + dx));
                    sum += data[y * width + nx];
                    count++;
                }
                temp[y * width + x] = sum / count;
            }
        }

        // Vertical pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let count = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    const ny = Math.max(0, Math.min(height - 1, y + dy));
                    sum += temp[ny * width + x];
                    count++;
                }
                output[y * width + x] = sum / count;
            }
        }

        return output;
    }

    /**
     * Normalize a 3D vector
     */
    _normalize(v) {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    /**
     * Convert image element to canvas
     */
    _toCanvas(image, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);
        return canvas;
    }

    /**
     * Ensure map is a canvas of correct size
     */
    _ensureCanvas(map, width, height) {
        if (map instanceof HTMLCanvasElement && map.width === width && map.height === height) {
            return map;
        }

        // Need to resize or convert
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (map instanceof HTMLCanvasElement) {
            ctx.drawImage(map, 0, 0, width, height);
        } else if (map.canvas) {
            ctx.drawImage(map.canvas, 0, 0, width, height);
        } else if (map.data && map.width && map.height) {
            // Object with data array
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = map.width;
            sourceCanvas.height = map.height;
            const sourceCtx = sourceCanvas.getContext('2d');
            const imgData = sourceCtx.createImageData(map.width, map.height);
            imgData.data.set(map.data);
            sourceCtx.putImageData(imgData, 0, 0);
            ctx.drawImage(sourceCanvas, 0, 0, width, height);
        }

        return canvas;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.albedoCanvas = null;
        this.shadingCanvas = null;
    }
}
