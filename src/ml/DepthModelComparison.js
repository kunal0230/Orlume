/**
 * DepthModelComparison - Test utility for comparing depth estimation models
 * 
 * Runs all available depth models on the same image and exports results
 * for quality comparison.
 */

import { pipeline, env } from '@huggingface/transformers';

// Available depth estimation models for browser (tested Dec 2024)
// Only includes models confirmed to work with Transformers.js
export const DEPTH_MODELS = [
    // ===== DEPTH ANYTHING V2 (Best overall) =====
    {
        id: 'depth-anything-v2-small',
        name: 'Depth Anything V2 Small',
        hfId: 'Xenova/depth-anything-small-hf',
        size: '25M',
        speed: 'fast',
        quality: 'good',
        year: 2024,
        recommended: true  // Best speed/quality balance
    },
    {
        id: 'depth-anything-v2-base',
        name: 'Depth Anything V2 Base',
        hfId: 'Xenova/depth-anything-base-hf',
        size: '98M',
        speed: 'medium',
        quality: 'better',
        year: 2024
    },
    // NOTE: DA V2 Large has no ONNX file, DA V3 is gated

    // ===== DPT / MiDaS FAMILY =====
    {
        id: 'dpt-hybrid',
        name: 'DPT Hybrid (MiDaS)',
        hfId: 'Xenova/dpt-hybrid-midas',
        size: '123M',
        speed: 'medium',
        quality: 'good',
        year: 2022
    },
    {
        id: 'dpt-large',
        name: 'DPT Large',
        hfId: 'Xenova/dpt-large',
        size: '340M',
        speed: 'slow',
        quality: 'better',
        year: 2022
    },

    // ===== LIGHTWEIGHT =====
    {
        id: 'glpn-nyu',
        name: 'GLPN NYU',
        hfId: 'Xenova/glpn-nyu',
        size: '37M',
        speed: 'fast',
        quality: 'good',
        year: 2022
    }
];

export class DepthModelComparison {
    constructor() {
        this.results = [];
        this.loadedModels = new Map();
    }

    /**
     * Run comparison on all models
     * @param {HTMLImageElement|HTMLCanvasElement} image - Input image
     * @param {Function} progressCallback - Progress callback (modelId, status, progress)
     * @returns {Array} - Results with depth maps and timing info
     */
    async runComparison(image, progressCallback = () => { }) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;

        this.results = [];
        const imageUrl = this._getImageUrl(image);

        for (const model of DEPTH_MODELS) {
            progressCallback(model.id, 'loading', 0);

            try {
                const startLoad = performance.now();

                // Load model if not cached
                let depthPipeline = this.loadedModels.get(model.id);
                if (!depthPipeline) {
                    progressCallback(model.id, 'loading', 10);

                    depthPipeline = await pipeline('depth-estimation', model.hfId, {
                        device: navigator.gpu ? 'webgpu' : 'wasm',
                        dtype: 'fp32',
                        progress_callback: (p) => {
                            if (p.progress) {
                                progressCallback(model.id, 'loading', 10 + p.progress * 0.4);
                            }
                        }
                    });

                    this.loadedModels.set(model.id, depthPipeline);
                }

                const loadTime = performance.now() - startLoad;
                progressCallback(model.id, 'running', 50);

                // Run inference
                const startInference = performance.now();
                const result = await depthPipeline(imageUrl);
                const inferenceTime = performance.now() - startInference;

                progressCallback(model.id, 'processing', 80);

                // Convert to canvas
                const depthCanvas = this._depthToCanvas(result.depth, image.width || image.naturalWidth, image.height || image.naturalHeight);

                progressCallback(model.id, 'complete', 100);

                this.results.push({
                    model: model,
                    depthCanvas: depthCanvas,
                    loadTime: loadTime,
                    inferenceTime: inferenceTime,
                    totalTime: loadTime + inferenceTime,
                    success: true
                });


            } catch (error) {
                console.error(`  ❌ ${model.name} failed:`, error.message);
                progressCallback(model.id, 'error', 0);

                this.results.push({
                    model: model,
                    depthCanvas: null,
                    error: error.message,
                    success: false
                });
            }
        }

        return this.results;
    }

    /**
     * Export all results as a ZIP file
     */
    async exportResults() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

        // Create comparison summary
        let summary = `Depth Model Comparison - ${timestamp}\n`;
        summary += '='.repeat(50) + '\n\n';

        for (const result of this.results) {
            summary += `Model: ${result.model.name}\n`;
            summary += `  HuggingFace ID: ${result.model.hfId}\n`;
            summary += `  Size: ${result.model.size}\n`;
            if (result.success) {
                summary += `  Load Time: ${result.loadTime.toFixed(0)}ms\n`;
                summary += `  Inference Time: ${result.inferenceTime.toFixed(0)}ms\n`;
                summary += `  Total Time: ${result.totalTime.toFixed(0)}ms\n`;
            } else {
                summary += `  Status: FAILED - ${result.error}\n`;
            }
            summary += '\n';
        }

        // Download each depth map
        for (const result of this.results) {
            if (result.success && result.depthCanvas) {
                const filename = `depth_${result.model.id}_${timestamp}.png`;
                this._downloadCanvas(result.depthCanvas, filename);
            }
        }

        // Download summary
        const blob = new Blob([summary], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `depth_comparison_${timestamp}.txt`;
        a.click();
        URL.revokeObjectURL(url);

    }

    /**
     * Create a side-by-side comparison canvas
     */
    createComparisonGrid() {
        const successfulResults = this.results.filter(r => r.success);
        if (successfulResults.length === 0) return null;

        const cols = Math.min(3, successfulResults.length);
        const rows = Math.ceil(successfulResults.length / cols);

        const cellWidth = 400;
        const cellHeight = 350;
        const labelHeight = 30;

        const canvas = document.createElement('canvas');
        canvas.width = cols * cellWidth;
        canvas.height = rows * cellHeight;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        successfulResults.forEach((result, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = col * cellWidth;
            const y = row * cellHeight;

            // Draw depth map
            if (result.depthCanvas) {
                const imgHeight = cellHeight - labelHeight;
                const scale = Math.min(cellWidth / result.depthCanvas.width, imgHeight / result.depthCanvas.height);
                const drawWidth = result.depthCanvas.width * scale;
                const drawHeight = result.depthCanvas.height * scale;
                const drawX = x + (cellWidth - drawWidth) / 2;
                const drawY = y + (imgHeight - drawHeight) / 2;

                ctx.drawImage(result.depthCanvas, drawX, drawY, drawWidth, drawHeight);
            }

            // Draw label
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(
                `${result.model.name} (${result.inferenceTime.toFixed(0)}ms)`,
                x + cellWidth / 2,
                y + cellHeight - 10
            );
        });

        return canvas;
    }

    /**
     * Cleanup loaded models to free memory
     */
    dispose() {
        this.loadedModels.clear();
        this.results = [];
    }

    // Private helpers
    _getImageUrl(image) {
        if (image instanceof HTMLImageElement) {
            return image.src;
        }
        if (image instanceof HTMLCanvasElement) {
            return image.toDataURL('image/png');
        }
        return image;
    }

    _depthToCanvas(depthData, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = depthData.width;
        canvas.height = depthData.height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(depthData.width, depthData.height);

        // Normalize depth values
        const data = depthData.data;
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }
        const range = max - min || 1;

        for (let i = 0; i < data.length; i++) {
            const normalized = ((data[i] - min) / range) * 255;
            const idx = i * 4;
            imageData.data[idx] = normalized;
            imageData.data[idx + 1] = normalized;
            imageData.data[idx + 2] = normalized;
            imageData.data[idx + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);

        // Resize to original dimensions if needed
        if (canvas.width !== width || canvas.height !== height) {
            const resized = document.createElement('canvas');
            resized.width = width;
            resized.height = height;
            resized.getContext('2d').drawImage(canvas, 0, 0, width, height);
            return resized;
        }

        return canvas;
    }

    _downloadCanvas(canvas, filename) {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    }
}

// Quick test function for console
export async function testAllDepthModels(imageElement) {
    const comparison = new DepthModelComparison();


    const results = await comparison.runComparison(imageElement, (modelId, status, progress) => {
    });

    console.table(results.map(r => ({
        Model: r.model.name,
        Size: r.model.size,
        Status: r.success ? '✅ Success' : '❌ Failed',
        InferenceMs: r.success ? r.inferenceTime.toFixed(0) : 'N/A'
    })));

    // Export results
    await comparison.exportResults();

    // Create comparison grid
    const grid = comparison.createComparisonGrid();
    if (grid) {
        document.body.appendChild(grid);
        grid.style.position = 'fixed';
        grid.style.top = '50%';
        grid.style.left = '50%';
        grid.style.transform = 'translate(-50%, -50%)';
        grid.style.zIndex = '10000';
        grid.style.border = '2px solid #4a9eff';
        grid.style.borderRadius = '8px';
        grid.onclick = () => grid.remove();
    }

    return results;
}
