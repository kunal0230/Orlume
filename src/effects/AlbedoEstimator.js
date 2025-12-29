/**
 * AlbedoEstimator v2.0 - Multi-Scale Retinex Intrinsic Decomposition
 * 
 * Implements state-of-the-art Multi-Scale Retinex with Color Restoration (MSRCR)
 * for separating an image into Albedo (reflectance) and Shading (illumination).
 * 
 * Key Insight: In log-space, Image = Albedo × Shading becomes:
 *              log(Image) = log(Albedo) + log(Shading)
 * 
 * The illumination varies slowly across the image, so we can estimate it
 * with low-pass filtering (Gaussian blur). The albedo is the difference.
 * 
 * Multi-scale approach uses multiple Gaussian scales (σ = 15, 80, 250) and
 * combines them for robust estimation across different spatial frequencies.
 */

export class AlbedoEstimator {
    constructor() {
        this.albedoCanvas = null;
        this.shadingCanvas = null;

        // Multi-Scale Retinex parameters (Jobson et al., 1997)
        this.scales = [15, 80, 250];  // Gaussian sigma values
        this.weights = [1 / 3, 1 / 3, 1 / 3];  // Equal weighting

        // Color restoration parameters
        this.colorGain = 1.2;
        this.colorOffset = 0.0;
    }

    /**
     * Estimate albedo using Multi-Scale Retinex
     * 
     * @param {HTMLImageElement|HTMLCanvasElement} image - Input image
     * @param {HTMLCanvasElement} depthMap - Optional depth map for refinement
     * @param {HTMLCanvasElement} normalMap - Optional normal map for refinement
     * @param {Object} options - Configuration options
     * @returns {Object} - { albedo: Canvas, shading: Canvas }
     */
    estimate(image, depthMap, normalMap, options = {}) {
        const {
            colorRestore = true,       // Apply color restoration
            useDepthGuided = true,     // Use depth for improved estimation
            chromaticityPreserve = true, // Preserve chromaticity
        } = options;

        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;

        console.log('🎨 Multi-Scale Retinex albedo estimation...');
        const startTime = performance.now();

        // Get image data
        const imageCanvas = this._toCanvas(image, width, height);
        const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });
        const imageData = imageCtx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        // Convert to float arrays for processing
        const r = new Float32Array(width * height);
        const g = new Float32Array(width * height);
        const b = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            // Add small epsilon to avoid log(0)
            r[i] = pixels[idx] / 255 + 0.001;
            g[i] = pixels[idx + 1] / 255 + 0.001;
            b[i] = pixels[idx + 2] / 255 + 0.001;
        }

        // Apply Multi-Scale Retinex to each channel
        console.log('  ↳ Computing multi-scale illumination estimates...');
        const retinexR = this._multiScaleRetinex(r, width, height);
        const retinexG = this._multiScaleRetinex(g, width, height);
        const retinexB = this._multiScaleRetinex(b, width, height);

        // Apply color restoration if enabled
        let finalR = retinexR;
        let finalG = retinexG;
        let finalB = retinexB;

        if (colorRestore) {
            console.log('  ↳ Applying color restoration...');
            const restored = this._colorRestoration(r, g, b, retinexR, retinexG, retinexB);
            finalR = restored.r;
            finalG = restored.g;
            finalB = restored.b;
        }

        // Optional: Use depth for guided filtering
        if (useDepthGuided && depthMap) {
            console.log('  ↳ Applying depth-guided refinement...');
            const depthCanvas = this._ensureCanvas(depthMap, width, height);
            const depthCtx = depthCanvas.getContext('2d', { willReadFrequently: true });
            const depthData = depthCtx.getImageData(0, 0, width, height).data;

            const refined = this._depthGuidedRefinement(
                finalR, finalG, finalB, depthData, width, height
            );
            finalR = refined.r;
            finalG = refined.g;
            finalB = refined.b;
        }

        // Normalize and create output
        this._normalizeChannel(finalR);
        this._normalizeChannel(finalG);
        this._normalizeChannel(finalB);

        // Estimate shading as inverse of albedo transform
        const shadingR = new Float32Array(width * height);
        const shadingG = new Float32Array(width * height);
        const shadingB = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            // Shading = Image / Albedo (in linear space)
            shadingR[i] = r[i] / Math.max(0.01, finalR[i]);
            shadingG[i] = g[i] / Math.max(0.01, finalG[i]);
            shadingB[i] = b[i] / Math.max(0.01, finalB[i]);
        }

        // Normalize shading
        this._normalizeChannel(shadingR);
        this._normalizeChannel(shadingG);
        this._normalizeChannel(shadingB);

        // Create output canvases
        this.albedoCanvas = this._createOutputCanvas(finalR, finalG, finalB, width, height);

        // For shading, use grayscale average
        const shadingGray = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            shadingGray[i] = (shadingR[i] + shadingG[i] + shadingB[i]) / 3;
        }
        this.shadingCanvas = this._createOutputCanvas(shadingGray, shadingGray, shadingGray, width, height);

        const elapsed = performance.now() - startTime;
        console.log(`✅ MSR Albedo: ${width}×${height} in ${elapsed.toFixed(0)}ms`);

        return {
            albedo: this.albedoCanvas,
            shading: this.shadingCanvas
        };
    }

    /**
     * Multi-Scale Retinex: Combine multiple Gaussian scales in log-space
     */
    _multiScaleRetinex(channel, width, height) {
        const result = new Float32Array(width * height);

        // Convert to log space
        const logChannel = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            logChannel[i] = Math.log(channel[i]);
        }

        // Apply Retinex at each scale and combine
        for (let s = 0; s < this.scales.length; s++) {
            const sigma = this.scales[s];
            const weight = this.weights[s];

            // Gaussian blur for illumination estimate
            const blurred = this._gaussianBlur(channel, width, height, sigma);

            // Convert blurred to log
            const logBlurred = new Float32Array(width * height);
            for (let i = 0; i < width * height; i++) {
                logBlurred[i] = Math.log(Math.max(0.001, blurred[i]));
            }

            // Single-Scale Retinex: R = log(I) - log(L)
            for (let i = 0; i < width * height; i++) {
                result[i] += weight * (logChannel[i] - logBlurred[i]);
            }
        }

        // Convert back from log-space to linear
        for (let i = 0; i < width * height; i++) {
            result[i] = Math.exp(result[i]);
        }

        return result;
    }

    /**
     * Color Restoration: Preserve chromaticity while adjusting intensity
     * Based on MSRCR (Multi-Scale Retinex with Color Restoration)
     */
    _colorRestoration(origR, origG, origB, retR, retG, retB) {
        const n = origR.length;
        const r = new Float32Array(n);
        const g = new Float32Array(n);
        const b = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            // Compute intensity
            const intensity = (origR[i] + origG[i] + origB[i]) / 3;

            // Color restoration factor: log(c × I / (R+G+B))
            const sumRGB = origR[i] + origG[i] + origB[i] + 0.001;

            const crR = this.colorGain * Math.log(125 * origR[i] / sumRGB + 1) + this.colorOffset;
            const crG = this.colorGain * Math.log(125 * origG[i] / sumRGB + 1) + this.colorOffset;
            const crB = this.colorGain * Math.log(125 * origB[i] / sumRGB + 1) + this.colorOffset;

            // Apply color restoration
            r[i] = retR[i] * crR;
            g[i] = retG[i] * crG;
            b[i] = retB[i] * crB;
        }

        return { r, g, b };
    }

    /**
     * Depth-Guided Refinement: Use depth edges to preserve material boundaries
     */
    _depthGuidedRefinement(r, g, b, depthData, width, height) {
        const n = width * height;
        const outR = new Float32Array(n);
        const outG = new Float32Array(n);
        const outB = new Float32Array(n);

        // Compute depth gradient magnitude
        const depthGrad = new Float32Array(n);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const dx = (depthData[(y * width + x + 1) * 4] - depthData[(y * width + x - 1) * 4]) / 2;
                const dy = (depthData[((y + 1) * width + x) * 4] - depthData[((y - 1) * width + x) * 4]) / 2;
                depthGrad[idx] = Math.sqrt(dx * dx + dy * dy) / 255;
            }
        }

        // Edge-preserving smoothing using bilateral-like weighting
        const radius = 3;
        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                const idx = y * width + x;

                // If at depth edge, preserve original albedo
                if (depthGrad[idx] > 0.1) {
                    outR[idx] = r[idx];
                    outG[idx] = g[idx];
                    outB[idx] = b[idx];
                } else {
                    // Smooth in flat regions
                    let sumR = 0, sumG = 0, sumB = 0, sumW = 0;
                    const centerDepth = depthData[idx * 4] / 255;

                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            const ni = (y + dy) * width + (x + dx);
                            const neighborDepth = depthData[ni * 4] / 255;

                            // Weight by depth similarity
                            const depthWeight = Math.exp(-Math.abs(centerDepth - neighborDepth) * 10);
                            const spatialWeight = Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
                            const w = depthWeight * spatialWeight;

                            sumR += r[ni] * w;
                            sumG += g[ni] * w;
                            sumB += b[ni] * w;
                            sumW += w;
                        }
                    }

                    outR[idx] = sumR / sumW;
                    outG[idx] = sumG / sumW;
                    outB[idx] = sumB / sumW;
                }
            }
        }

        // Copy edges
        for (let i = 0; i < n; i++) {
            if (outR[i] === 0) {
                outR[i] = r[i];
                outG[i] = g[i];
                outB[i] = b[i];
            }
        }

        return { r: outR, g: outG, b: outB };
    }

    /**
     * Separable Gaussian Blur (optimized)
     */
    _gaussianBlur(channel, width, height, sigma) {
        // Create Gaussian kernel
        const radius = Math.ceil(sigma * 3);
        const kernel = new Float32Array(radius * 2 + 1);
        let sum = 0;

        for (let i = -radius; i <= radius; i++) {
            const val = Math.exp(-(i * i) / (2 * sigma * sigma));
            kernel[i + radius] = val;
            sum += val;
        }
        for (let i = 0; i < kernel.length; i++) {
            kernel[i] /= sum;
        }

        // Horizontal pass
        const temp = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                let wSum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const sx = Math.max(0, Math.min(width - 1, x + k));
                    const w = kernel[k + radius];
                    val += channel[y * width + sx] * w;
                    wSum += w;
                }
                temp[y * width + x] = val / wSum;
            }
        }

        // Vertical pass
        const result = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                let wSum = 0;
                for (let k = -radius; k <= radius; k++) {
                    const sy = Math.max(0, Math.min(height - 1, y + k));
                    const w = kernel[k + radius];
                    val += temp[sy * width + x] * w;
                    wSum += w;
                }
                result[y * width + x] = val / wSum;
            }
        }

        return result;
    }

    /**
     * Normalize channel to [0, 1] range using percentile clipping
     */
    _normalizeChannel(channel) {
        // Sort for percentile calculation
        const sorted = Float32Array.from(channel).sort((a, b) => a - b);
        const lowIdx = Math.floor(sorted.length * 0.01);
        const highIdx = Math.floor(sorted.length * 0.99);
        const low = sorted[lowIdx];
        const high = sorted[highIdx];
        const range = high - low || 1;

        for (let i = 0; i < channel.length; i++) {
            channel[i] = Math.max(0, Math.min(1, (channel[i] - low) / range));
        }
    }

    /**
     * Create output canvas from RGB channels
     */
    _createOutputCanvas(r, g, b, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            imageData.data[idx] = Math.round(r[i] * 255);
            imageData.data[idx + 1] = Math.round(g[i] * 255);
            imageData.data[idx + 2] = Math.round(b[i] * 255);
            imageData.data[idx + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    /**
     * Convert various input types to canvas
     */
    _toCanvas(source, width, height) {
        if (source instanceof HTMLCanvasElement) {
            if (source.width === width && source.height === height) {
                return source;
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (source instanceof HTMLImageElement) {
            ctx.drawImage(source, 0, 0, width, height);
        } else if (source instanceof HTMLCanvasElement) {
            ctx.drawImage(source, 0, 0, width, height);
        } else if (source.data && source.width && source.height) {
            const imageData = ctx.createImageData(source.width, source.height);
            imageData.data.set(source.data);
            ctx.putImageData(imageData, 0, 0);
        }

        return canvas;
    }

    /**
     * Ensure input is a canvas of specified size
     */
    _ensureCanvas(map, width, height) {
        if (map instanceof HTMLCanvasElement) {
            if (map.width === width && map.height === height) {
                return map;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(map, 0, 0, width, height);
            return canvas;
        }

        if (map instanceof HTMLImageElement) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(map, 0, 0, width, height);
            return canvas;
        }

        if (map.data && map.width && map.height) {
            const canvas = document.createElement('canvas');
            canvas.width = map.width;
            canvas.height = map.height;
            const ctx = canvas.getContext('2d');
            const imageData = ctx.createImageData(map.width, map.height);
            imageData.data.set(map.data);
            ctx.putImageData(imageData, 0, 0);

            if (map.width !== width || map.height !== height) {
                const resized = document.createElement('canvas');
                resized.width = width;
                resized.height = height;
                resized.getContext('2d').drawImage(canvas, 0, 0, width, height);
                return resized;
            }
            return canvas;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.albedoCanvas = null;
        this.shadingCanvas = null;
    }
}
