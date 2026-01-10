/**
 * UpscaleModule - AI image upscaling functionality
 * 
 * Handles:
 * - Upscale tool initialization and controls
 * - Scale factor selection (2x, 4x)
 * - Processing mode (enhance, upscale, both)
 * - AI server configuration
 * - Upscaling progress and application
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
        this.scaleFactor = 2;

        // Mode selector buttons (Enhance / Upscale / Both)
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                this.upscaler.setProcessingMode(mode);
                this.updateDimensions();
            });
        });

        // Scale factor buttons
        document.querySelectorAll('.scale-factor-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.scale-factor-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.scaleFactor = parseInt(btn.dataset.scale);
                this.upscaler.setScaleFactor(this.scaleFactor);
                this.updateDimensions();
            });
        });

        // Sharpen toggle
        const sharpenToggle = document.getElementById('upscale-sharpen-toggle');
        if (sharpenToggle) {
            sharpenToggle.addEventListener('change', () => {
                this.upscaler.setSharpenEdges(sharpenToggle.checked);
            });
        }

        // AI server toggle
        const aiToggle = document.getElementById('upscale-ai-toggle');
        if (aiToggle) {
            aiToggle.addEventListener('change', () => {
                this.upscaler.setUseAI(aiToggle.checked);
            });
        }

        // Face enhancement toggle
        const faceToggle = document.getElementById('upscale-face-toggle');
        if (faceToggle) {
            faceToggle.addEventListener('change', () => {
                this.upscaler.setEnhanceFace(faceToggle.checked);
            });
        }

        // Server URL input
        const serverUrlInput = document.getElementById('ai-server-url');
        if (serverUrlInput) {
            serverUrlInput.addEventListener('change', () => {
                this.upscaler.setServerUrl(serverUrlInput.value);
            });
        }

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
        const outputWidth = Math.round(width * this.scaleFactor);
        const outputHeight = Math.round(height * this.scaleFactor);

        if (currentDims) currentDims.textContent = `${width} × ${height}`;
        if (outputDims) outputDims.textContent = `${outputWidth} × ${outputHeight}`;
    }

    /**
     * Apply upscale to image
     */
    async apply() {
        if (!this.state.hasImage) {
            console.warn('No image loaded for upscaling');
            return;
        }

        const progressSection = document.getElementById('upscale-progress-section');
        const progressBar = document.getElementById('upscale-progress-bar');
        const progressText = document.getElementById('upscale-progress-text');
        const progressPercent = document.getElementById('upscale-progress-percent');
        const btnApply = document.getElementById('btn-upscale-apply');

        // Show progress and disable button
        if (progressSection) progressSection.style.display = 'block';
        if (btnApply) btnApply.disabled = true;

        try {
            // Save state for undo
            const snapshot = this.editor._captureFullState();
            this.history.pushState(snapshot);

            // Upscale the image
            const upscaledCanvas = await this.upscaler.upscaleFromWebGL(
                this.gpu.gl,
                this.gpu.width,
                this.gpu.height,
                (percent, message) => {
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressText) progressText.textContent = message;
                    if (progressPercent) progressPercent.textContent = `${Math.round(percent)}%`;
                }
            );

            // Create image from canvas
            const img = new Image();
            img.onload = () => {
                // Update state
                this.state.setImage(img);

                // Reload GPU processor with upscaled image
                this.gpu.loadImage(img);

                // Clear masks (they no longer align)
                this.masks.layers = [];
                this.masks.activeLayerIndex = -1;
                this.editor.updateLayersList();

                // Update UI
                this.elements.perfIndicator.textContent = `${img.width}×${img.height}`;
                setTimeout(() => this.editor.renderHistogram(), 100);

                // Hide progress
                if (progressSection) progressSection.style.display = 'none';
                if (btnApply) btnApply.disabled = false;
                if (progressBar) progressBar.style.width = '0%';

                // Update dimensions display
                this.updateDimensions();

            };
            img.src = upscaledCanvas.toDataURL('image/png');

        } catch (error) {
            console.error('Upscale failed:', error);
            if (progressSection) progressSection.style.display = 'none';
            if (btnApply) btnApply.disabled = false;
        }
    }
}
