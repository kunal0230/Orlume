/**
 * UpscaleModule - AI image upscaling functionality
 * 
 * Handles:
 * - Upscale tool initialization and controls
 * - Scale factor selection (2x, 3x, 4x)
 * - Neural engine selection (slim / thick)
 * - Super-resolution progress and application
 */

import { ImageUpscaler } from '../../ml/ImageUpscaler.js';

export class UpscaleModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.gpu = editor.gpu;
        this.elements = editor.elements;
        this.history = editor.history;
        this.masks = editor.masks;

        // Upscaler instance
        this.upscaler = null;
        this.scaleFactor = 2;
    }

    /**
     * Initialize upscale controls
     */
    init() {
        // Create upscaler instance
        this.upscaler = new ImageUpscaler();
        const maxTextureSize = this.gpu?.backend?.maxTextureSize || 4096;
        this.upscaler.setMaxDimension(Math.min(maxTextureSize, 4096));
        this.scaleFactor = 2;

        // Scale factor buttons (2x, 3x, 4x)
        document.querySelectorAll('.scale-factor-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.scale-factor-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.scaleFactor = parseInt(btn.dataset.scale);
                this.upscaler.setScaleFactor(this.scaleFactor);
                this.updateDimensions();
            });
        });

        // Model quality selector buttons (Fast / Ultra)
        document.querySelectorAll('.upscale-model-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.upscale-model-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const model = btn.dataset.model || 'slim';
                this.upscaler.setModelType(model);
            });
        });

        // Apply button
        const btnApply = document.getElementById('btn-upscale-apply');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.apply());
        }

        // Cancel button
        const btnCancel = document.getElementById('btn-upscale-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                this.editor.setMode('develop');
            });
        }
    }

    /**
     * Update upscale dimensions display
     */
    updateDimensions() {
        const currentDims = document.getElementById('upscale-current-dims');
        const outputDims = document.getElementById('upscale-output-dims');

        if (!this.state.hasImage) {
            if (currentDims) currentDims.textContent = '-- × --';
            if (outputDims) outputDims.textContent = '-- × --';
            return;
        }

        const width = this.gpu.width;
        const height = this.gpu.height;
        const maxDim = this.gpu?.backend?.maxTextureSize || 4096;
        const maxAllowed = Math.min(maxDim, 4096);
        this.upscaler.setMaxDimension(maxAllowed);

        const out = this.upscaler.getOutputDimensions(width, height, maxAllowed);

        if (currentDims) currentDims.textContent = `${width} × ${height}`;
        if (outputDims) {
            if (out.clamped) {
                outputDims.innerHTML = `${out.width} × ${out.height} <span class="upscale-clamped-badge" title="Clamped to GPU limit of ${maxAllowed}px">GPU Clamped</span>`;
            } else {
                outputDims.textContent = `${out.width} × ${out.height}`;
            }
        }

        // Update apply button text to reflect scale factor
        const btnApply = document.getElementById('btn-upscale-apply');
        if (btnApply) {
            btnApply.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                    stroke-width="2" style="vertical-align: middle; margin-right: 4px;">
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                </svg>
                Upscale Image (${this.scaleFactor}×)`;
        }
    }

    /**
     * Apply upscale to image
     */
    async apply() {
        if (!this.state.hasImage) {
            this.editor.showToast?.('Please load an image first');
            return;
        }

        const btnApply = document.getElementById('btn-upscale-apply');
        const progressSection = document.getElementById('upscale-progress-section');
        const progressBar = document.getElementById('upscale-progress-bar');
        const progressText = document.getElementById('upscale-progress-text');
        const progressPercent = document.getElementById('upscale-progress-percent');

        // Show progress and disable button
        if (progressSection) progressSection.style.display = 'block';
        if (btnApply) {
            btnApply.disabled = true;
            btnApply.style.opacity = '0.7';
        }

        try {
            // Save state for undo (LAW 1)
            clearTimeout(this.editor._historyDebounceTimer);
            const snapshot = this.editor._captureFullState();
            this.history.pushState(snapshot);

            // Synchronize hardware max texture limit (safely capped to 4096 for optimal in-browser super-resolution)
            const maxDim = this.gpu?.backend?.maxTextureSize || 4096;
            this.upscaler.setMaxDimension(Math.min(maxDim, 4096));

            // Prefer clean originalImage so adjustments are not doubled
            const sourceToUpscale = this.state.originalImage || this.gpu.canvas;

            // Upscale the image using memory-efficient tensor/blob pipeline
            const upscaledCanvas = await this.upscaler.upscale(
                sourceToUpscale,
                (percent, message) => {
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = message;
                    if (progressPercent) progressPercent.textContent = `${Math.round(percent)}%`;
                }
            );

            // Convert canvas to image via Blob URL to prevent V8 Base64 string memory blowup
            await new Promise((resolve, reject) => {
                upscaledCanvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Failed to create image blob from upscaled canvas'));
                        return;
                    }
                    const blobUrl = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => {
                        URL.revokeObjectURL(blobUrl);

                        // Store previous image so Before/After comparison reveals the super-resolution detail
                        this.state.preUpscaleImage = this.state.originalImage;

                        // Update state
                        this.state.setImage(img);
                        this.state.originalImage = img;

                        // Reload GPU processor with upscaled image
                        this.gpu.loadImage(img);

                        // Adapt masks to new upscaled dimensions
                        if (this.masks && typeof this.masks.onImageDimensionsChanged === 'function') {
                            this.masks.onImageDimensionsChanged();
                        }
                        this.editor.updateLayersList?.();
                        this.editor.syncLayerUI?.();

                        // Update UI
                        if (this.elements.perfIndicator) {
                            this.elements.perfIndicator.textContent = `${img.width}×${img.height}`;
                        }
                        setTimeout(() => this.editor.renderHistogram(), 100);

                        // Hide progress
                        if (progressSection) progressSection.style.display = 'none';
                        if (btnApply) {
                            btnApply.disabled = false;
                            btnApply.style.opacity = '1';
                        }
                        if (progressBar) progressBar.style.width = '0%';

                        // Update dimensions display
                        this.updateDimensions();

                        // If Before/After comparison slider is currently active, refresh its overlay canvas
                        if (this.editor.comparisonModule?.comparison?.active) {
                            this.editor.comparisonModule.toggle(true);
                        }

                        // Visual toast confirmation
                        this.editor.showToast?.(`✓ AI Super-resolution (${this.scaleFactor}×) applied! Click Before/After (\\) to compare`);
                        resolve();
                    };
                    img.onerror = (err) => {
                        URL.revokeObjectURL(blobUrl);
                        reject(err || new Error('Failed to load upscaled image'));
                    };
                    img.src = blobUrl;
                }, 'image/png');
            });

        } catch (error) {
            console.error('Upscale failed:', error);
            if (progressSection) progressSection.style.display = 'none';
            if (btnApply) {
                btnApply.disabled = false;
                btnApply.style.opacity = '1';
            }
            this.editor.showToast?.('Upscale failed: ' + error.message);
        }
    }
}
