/**
 * LightingCompositor.js - Highlight/Shadow Layer Compositing
 * 
 * Key insight from DaVinci Resolve:
 * - Lighting goes to Alpha/separate layer, NOT directly to RGB
 * - Highlights use Screen blend
 * - Shadows use Multiply blend
 * - This preserves color integrity and allows artistic control
 */

export class LightingCompositor {
    constructor() {
        this.canvas = null;
        this.ctx = null;
    }

    /**
     * Initialize compositor canvas
     */
    init(width, height) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }

    /**
     * Composite lighting onto original image
     * 
     * @param {ImageData|HTMLCanvasElement} original - Original image
     * @param {ImageData} lightingMask - Lighting output from shader (RGB = lighting, A = highlights)
     * @param {Object} options - Compositing options
     */
    composite(original, lightingMask, options = {}) {
        const {
            highlightIntensity = 1.0,   // 0 to 2
            shadowDepth = 1.0,          // 0 to 1
            colorTemp = 0,              // -1 (cool) to 1 (warm)
            preserveOriginal = 0.2,     // How much original lighting to keep
        } = options;

        // Ensure canvas is correct size
        const width = lightingMask.width;
        const height = lightingMask.height;

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        // Get original pixels
        let originalData;
        if (original instanceof ImageData) {
            originalData = original.data;
        } else {
            const tempCtx = original.getContext('2d');
            originalData = tempCtx.getImageData(0, 0, width, height).data;
        }

        const lightData = lightingMask.data;
        const outputData = this.ctx.createImageData(width, height);
        const output = outputData.data;

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;

            // Original pixel
            const oR = originalData[idx] / 255;
            const oG = originalData[idx + 1] / 255;
            const oB = originalData[idx + 2] / 255;

            // Lighting mask (RGB = lighting intensity, A = specular highlights)
            const lR = lightData[idx] / 255;
            const lG = lightData[idx + 1] / 255;
            const lB = lightData[idx + 2] / 255;
            const specular = lightData[idx + 3] / 255;

            // Compute average lighting (for shadow/highlight detection)
            const lightAvg = (lR + lG + lB) / 3;

            // Separate into shadow and highlight components
            // Values below 1.0 = shadow, above 1.0 = highlight
            // Since our shader outputs lighting intensity directly, we use it

            let r = oR, g = oG, b = oB;

            // === SHADOW PASS (Multiply blend for darks) ===
            if (lightAvg < 1.0) {
                const shadowFactor = lightAvg;
                const shadowStrength = shadowDepth;

                // Multiply blend: result = original * shadow
                const shadowR = oR * (shadowFactor + (1 - shadowFactor) * (1 - shadowStrength));
                const shadowG = oG * (shadowFactor + (1 - shadowFactor) * (1 - shadowStrength));
                const shadowB = oB * (shadowFactor + (1 - shadowFactor) * (1 - shadowStrength));

                r = shadowR;
                g = shadowG;
                b = shadowB;
            }

            // === HIGHLIGHT PASS (Screen blend for lights) ===
            if (lightAvg > 1.0 || specular > 0) {
                const highlightAmount = (lightAvg - 1.0) * highlightIntensity + specular * highlightIntensity;

                // Screen blend: result = 1 - (1 - original) * (1 - highlight)
                const highlightColor = {
                    r: lR * highlightAmount,
                    g: lG * highlightAmount,
                    b: lB * highlightAmount
                };

                // Apply screen blend
                r = 1 - (1 - r) * (1 - highlightColor.r);
                g = 1 - (1 - g) * (1 - highlightColor.g);
                b = 1 - (1 - b) * (1 - highlightColor.b);
            }

            // === COLOR TEMPERATURE ADJUSTMENT ===
            if (colorTemp !== 0) {
                if (colorTemp > 0) {
                    // Warm: boost red, reduce blue
                    r = r + colorTemp * 0.1 * (lightAvg - 0.5);
                    b = b - colorTemp * 0.1 * (lightAvg - 0.5);
                } else {
                    // Cool: boost blue, reduce red
                    r = r + colorTemp * 0.1 * (lightAvg - 0.5);
                    b = b - colorTemp * 0.1 * (lightAvg - 0.5);
                }
            }

            // === PRESERVE SOME ORIGINAL LIGHTING ===
            if (preserveOriginal > 0) {
                r = r * (1 - preserveOriginal) + oR * preserveOriginal;
                g = g * (1 - preserveOriginal) + oG * preserveOriginal;
                b = b * (1 - preserveOriginal) + oB * preserveOriginal;
            }

            // Clamp and write output
            output[idx] = Math.max(0, Math.min(255, Math.round(r * 255)));
            output[idx + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
            output[idx + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
            output[idx + 3] = 255;
        }

        this.ctx.putImageData(outputData, 0, 0);

        return {
            canvas: this.canvas,
            imageData: outputData
        };
    }

    /**
     * Quick preview composite (lower quality but faster)
     */
    compositeQuick(original, lightingCanvas, options = {}) {
        const { highlightIntensity = 1.0 } = options;

        const width = lightingCanvas.width;
        const height = lightingCanvas.height;

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        // Draw original
        if (original instanceof ImageData) {
            this.ctx.putImageData(original, 0, 0);
        } else {
            this.ctx.drawImage(original, 0, 0);
        }

        // Overlay lighting with soft-light blend
        this.ctx.globalCompositeOperation = 'soft-light';
        this.ctx.globalAlpha = highlightIntensity;
        this.ctx.drawImage(lightingCanvas, 0, 0);

        // Reset
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1.0;

        return this.canvas;
    }

    /**
     * Get result as ImageData
     */
    getImageData() {
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    dispose() {
        this.canvas = null;
        this.ctx = null;
    }
}

export default LightingCompositor;
