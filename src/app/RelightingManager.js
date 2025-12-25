/**
 * RelightingManager - Integrates depth estimation and relighting into the editor
 * Bridge between the modular editor and the existing RelightingEffect/DepthEstimator
 */
import { DepthEstimator } from '../ml/DepthEstimator.js';
import { RelightingEffect } from '../effects/RelightingEffect.js';

export class RelightingManager {
    constructor(app) {
        this.app = app;
        this.depthEstimator = null;
        this.relightingEffect = null;
        this.depthMap = null;
        this.isEnabled = false;

        this._initUI();
    }

    /**
     * Initialize UI event listeners
     */
    _initUI() {
        // Depth estimation button
        const btnEstimate = document.getElementById('btn-estimate-depth');
        if (btnEstimate) {
            btnEstimate.addEventListener('click', () => this.estimateDepth());
        }

        // Lighting sliders
        this._initSlider('slider-light-intensity', 'val-light-intensity', (val) => {
            this.relightingEffect?.setIntensity(val);
        }, (v) => v.toFixed(1));

        this._initSlider('slider-light-ambient', 'val-light-ambient', (val) => {
            this.relightingEffect?.setAmbient(val / 100);
        });

        this._initSlider('slider-light-shadow', 'val-light-shadow', (val) => {
            this.relightingEffect?.setShadowStrength(val / 100);
        });

        this._initSlider('slider-light-temperature', 'val-light-temperature', (val) => {
            this.relightingEffect?.setColorTemperature(val);
        }, (v) => `${v}K`);

        this._initSlider('slider-light-brightness', 'val-light-brightness', (val) => {
            this.relightingEffect?.setBrightness(val);
        });

        // Reset lights button
        const btnReset = document.getElementById('btn-reset-lights');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.relightingEffect?.resetLights();
            });
        }

        // Disable button
        const btnDisable = document.getElementById('btn-disable-relight');
        if (btnDisable) {
            btnDisable.addEventListener('click', () => this.disable());
        }
    }

    /**
     * Helper to initialize a slider
     */
    _initSlider(sliderId, displayId, callback, formatter = (v) => Math.round(v)) {
        const slider = document.getElementById(sliderId);
        const display = document.getElementById(displayId);
        if (!slider) return;

        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value);
            if (display) display.textContent = formatter(val);
            callback(val);
        });
    }

    /**
     * Estimate depth from the current image
     */
    async estimateDepth() {
        if (!this.app.state.hasImage) {
            console.warn('No image loaded');
            return;
        }

        const progressContainer = document.getElementById('depth-progress');
        const progressBar = document.getElementById('depth-progress-bar');
        const progressText = document.getElementById('depth-progress-text');
        const progressPercent = document.getElementById('depth-progress-percent');
        const btnEstimate = document.getElementById('btn-estimate-depth');

        try {
            // Show progress
            if (progressContainer) progressContainer.hidden = false;
            if (btnEstimate) btnEstimate.disabled = true;

            // Create depth estimator if needed
            if (!this.depthEstimator) {
                this.depthEstimator = new DepthEstimator(this._createAppAdapter());
            }

            // Get image data URL
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = this.app.state.originalImage;
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imageData = {
                dataURL: canvas.toDataURL('image/jpeg', 0.9),
                width: img.width,
                height: img.height
            };

            // Estimate depth
            this.depthMap = await this.depthEstimator.estimate(imageData);

            console.log('✅ Depth map generated:', this.depthMap.width, '×', this.depthMap.height);

            // Enable relighting
            await this.enable();

            // Update UI
            if (btnEstimate) {
                btnEstimate.textContent = 'Re-estimate Depth';
                btnEstimate.disabled = false;
            }
            if (progressContainer) progressContainer.hidden = true;

        } catch (error) {
            console.error('Depth estimation failed:', error);
            if (progressContainer) progressContainer.hidden = true;
            if (btnEstimate) btnEstimate.disabled = false;
            if (progressText) progressText.textContent = 'Error: ' + error.message;
        }
    }

    /**
     * Create an adapter object that mimics the old app interface for DepthEstimator
     */
    _createAppAdapter() {
        return {
            updateProgress: (percent, text) => {
                const progressBar = document.getElementById('depth-progress-bar');
                const progressText = document.getElementById('depth-progress-text');
                const progressPercent = document.getElementById('depth-progress-percent');

                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressText) progressText.textContent = text;
                if (progressPercent) progressPercent.textContent = `${percent}%`;
            }
        };
    }

    /**
     * Enable relighting mode
     */
    async enable() {
        if (!this.depthMap) {
            console.warn('No depth map available');
            return;
        }

        // Create relighting effect if needed
        if (!this.relightingEffect) {
            this.relightingEffect = new RelightingEffect(this._createRelightAppAdapter());
        }

        // Set depth map and enable
        this.relightingEffect.depthMap = this.depthMap;
        this.relightingEffect.enable();
        this.isEnabled = true;

        // Show controls
        const controls = document.getElementById('relight-controls');
        if (controls) controls.style.display = 'block';

        console.log('🔦 Relighting enabled');
    }

    /**
     * Disable relighting mode
     */
    disable() {
        if (this.relightingEffect) {
            this.relightingEffect.disable();
        }
        this.isEnabled = false;

        // Hide controls
        const controls = document.getElementById('relight-controls');
        if (controls) controls.style.display = 'none';

        // Re-render with develop settings
        if (this.app.ui) {
            this.app.ui.renderWithMask(false);
        }

        console.log('🔦 Relighting disabled');
    }

    /**
     * Create an adapter for RelightingEffect that mimics the old app interface
     */
    _createRelightAppAdapter() {
        const self = this;
        return {
            state: {
                get image() {
                    return self.app.state.originalImage;
                },
                get depthMap() {
                    return self.depthMap;
                }
            },
            canvasManager: {
                canvas: document.getElementById('gpu-canvas'),
                getExportCanvas: () => document.getElementById('gpu-canvas')
            }
        };
    }
}
