/**
 * RelightingProModule.js - v8 PRO Relighting UI Module
 * 
 * Wires up the v8 relighting pipeline to the editor UI.
 * This module is completely separate from the original RelightingModule.
 */

import { RelightingPipeline } from '../relighting/v8/index.js';

export class RelightingProModule {
    constructor(ui) {
        this.ui = ui;
        this.pipeline = new RelightingPipeline();
        this.isActive = false;
        this.hasAnalyzed = false;

        // Cache DOM elements
        this.elements = {};
        this._cacheElements();

        // Bind methods
        this._onAnalyzeClick = this._onAnalyzeClick.bind(this);
        this._onLightPositionClick = this._onLightPositionClick.bind(this);
        this._onSliderChange = this._onSliderChange.bind(this);
        this._onResetClick = this._onResetClick.bind(this);
        this._onApplyClick = this._onApplyClick.bind(this);

        // Setup event listeners
        this._setupEventListeners();
        this._setupPipelineEvents();

        // Initialize pipeline (starts background model loading)
        this.pipeline.init();
    }

    _cacheElements() {
        // Status elements
        this.elements.statusIndicator = document.getElementById('v8-status-indicator');
        this.elements.statusText = document.getElementById('v8-status-text');
        this.elements.modelBadge = document.getElementById('v8-model-badge');
        this.elements.progressContainer = document.getElementById('v8-progress-container');
        this.elements.progressBar = document.getElementById('v8-progress-bar');
        this.elements.progressStage = document.getElementById('v8-progress-stage');
        this.elements.progressPercent = document.getElementById('v8-progress-percent');

        // Buttons
        this.elements.analyzeBtn = document.getElementById('btn-v8-analyze');
        this.elements.resetBtn = document.getElementById('btn-v8-reset');
        this.elements.applyBtn = document.getElementById('btn-v8-apply');

        // Analysis status
        this.elements.analysisStatus = document.getElementById('v8-analysis-status');
        this.elements.analysisText = document.getElementById('v8-analysis-text');
        this.elements.analysisBar = document.getElementById('v8-analysis-bar');

        // Controls container
        this.elements.controls = document.getElementById('v8-controls');

        // Light position
        this.elements.lightPosition = document.getElementById('v8-light-position');
        this.elements.lightDot = document.getElementById('v8-light-dot');

        // Sliders
        this.elements.sliderIntensity = document.getElementById('slider-v8-intensity');
        this.elements.sliderAmbient = document.getElementById('slider-v8-ambient');
        this.elements.sliderHeight = document.getElementById('slider-v8-height');
        this.elements.sliderShadowIntensity = document.getElementById('slider-v8-shadow-intensity');
        this.elements.sliderShadowSoftness = document.getElementById('slider-v8-shadow-softness');

        // Value displays
        this.elements.valIntensity = document.getElementById('val-v8-intensity');
        this.elements.valAmbient = document.getElementById('val-v8-ambient');
        this.elements.valHeight = document.getElementById('val-v8-height');
        this.elements.valShadowIntensity = document.getElementById('val-v8-shadow-intensity');
        this.elements.valShadowSoftness = document.getElementById('val-v8-shadow-softness');

        // Light color
        this.elements.lightColor = document.getElementById('v8-light-color');
    }

    _setupEventListeners() {
        // Analyze button
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.addEventListener('click', this._onAnalyzeClick);
        }

        // Light position
        if (this.elements.lightPosition) {
            this.elements.lightPosition.addEventListener('click', this._onLightPositionClick);
            this.elements.lightPosition.addEventListener('mousemove', (e) => {
                if (e.buttons === 1) this._onLightPositionClick(e);
            });
        }

        // Sliders
        const sliders = [
            'sliderIntensity', 'sliderAmbient', 'sliderHeight',
            'sliderShadowIntensity', 'sliderShadowSoftness'
        ];

        sliders.forEach(name => {
            if (this.elements[name]) {
                this.elements[name].addEventListener('input', this._onSliderChange);
            }
        });

        // Light color
        if (this.elements.lightColor) {
            this.elements.lightColor.addEventListener('input', () => {
                const color = this.elements.lightColor.value;
                const r = parseInt(color.slice(1, 3), 16) / 255;
                const g = parseInt(color.slice(3, 5), 16) / 255;
                const b = parseInt(color.slice(5, 7), 16) / 255;
                this.pipeline.setLightColor(r, g, b);
                this._render();
            });
        }

        // Action buttons
        if (this.elements.resetBtn) {
            this.elements.resetBtn.addEventListener('click', this._onResetClick);
        }
        if (this.elements.applyBtn) {
            this.elements.applyBtn.addEventListener('click', this._onApplyClick);
        }
    }

    _setupPipelineEvents() {
        // Model loading progress
        this.pipeline.on('model-progress', ({ percent, modelName, stage }) => {
            this._updateModelProgress(percent, modelName);
        });

        // Model loaded
        this.pipeline.on('model-loaded', ({ name }) => {
            console.log(`✓ Model loaded: ${name}`);
        });

        // Models ready
        this.pipeline.on('models-ready', () => {
            this._setModelsReady();
        });

        // Basic readiness (depth model loaded)
        this.pipeline.modelLoader.on('feature-enabled', ({ feature }) => {
            if (feature === 'basic_relighting') {
                this._setBasicReady();
            }
        });

        // Processing progress
        this.pipeline.on('progress', ({ progress, message }) => {
            this._updateAnalysisProgress(progress, message);
        });

        // Processing complete
        this.pipeline.on('processed', ({ confidence }) => {
            this._onAnalysisComplete(confidence);
        });

        // Confidence results
        this.pipeline.on('confidence', (confidence) => {
            this._displayConfidence(confidence);
        });

        // Error
        this.pipeline.on('error', ({ error }) => {
            this._showError(error.message);
        });
    }

    _displayConfidence(confidence) {
        // Get or create quality badge element
        let badge = document.getElementById('v8-quality-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'v8-quality-badge';
            badge.style.cssText = `
                display: inline-block;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                margin-left: 8px;
            `;
            const statusRow = this.elements.statusText?.parentElement;
            if (statusRow) {
                statusRow.appendChild(badge);
            }
        }

        // Set badge color based on quality
        const colors = {
            good: { bg: '#22c55e', text: '#fff' },
            fair: { bg: '#eab308', text: '#000' },
            poor: { bg: '#ef4444', text: '#fff' }
        };

        const color = colors[confidence.quality] || colors.fair;
        badge.style.background = color.bg;
        badge.style.color = color.text;
        badge.textContent = `${confidence.quality.toUpperCase()} (${Math.round(confidence.overall * 100)}%)`;
        badge.style.display = 'inline-block';

        // Display warnings if any
        if (confidence.warnings && confidence.warnings.length > 0) {
            this._displayWarnings(confidence.warnings);
        }
    }

    _displayWarnings(warnings) {
        // Get or create warnings container
        let container = document.getElementById('v8-warnings');
        if (!container) {
            container = document.createElement('div');
            container.id = 'v8-warnings';
            container.style.cssText = `
                margin-top: 10px;
                padding: 10px;
                background: rgba(234, 179, 8, 0.1);
                border-radius: 6px;
                border-left: 3px solid #eab308;
            `;
            // Insert after status area
            const panel = document.getElementById('panel-3d-pro');
            if (panel) {
                const statusArea = panel.querySelector('.pro-status') || panel.firstChild;
                if (statusArea) {
                    statusArea.parentNode.insertBefore(container, statusArea.nextSibling);
                }
            }
        }

        container.innerHTML = warnings.map(w => `
            <div style="margin-bottom: 6px; font-size: 12px; color: ${w.level === 'error' ? '#ef4444' : '#eab308'};">
                <strong>⚠ ${w.message}</strong>
                ${w.details ? `<div style="opacity: 0.8; margin-top: 2px;">${w.details}</div>` : ''}
            </div>
        `).join('');

        container.style.display = 'block';
    }

    // === Model Loading UI ===

    _updateModelProgress(percent, modelName) {
        if (this.elements.progressContainer) {
            this.elements.progressContainer.style.display = 'block';
        }
        if (this.elements.progressBar) {
            this.elements.progressBar.style.width = `${percent}%`;
        }
        if (this.elements.progressStage) {
            this.elements.progressStage.textContent = `Loading ${modelName}...`;
        }
        if (this.elements.progressPercent) {
            this.elements.progressPercent.textContent = `${Math.round(percent)}%`;
        }
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.style.background = '#667eea';
        }
        if (this.elements.statusText) {
            this.elements.statusText.textContent = 'Loading AI models...';
        }
    }

    _setBasicReady() {
        // Enable analyze button when depth model is ready
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = false;
        }
        if (this.elements.statusText) {
            this.elements.statusText.textContent = 'Ready (basic)';
        }
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.style.background = '#4ade80';
        }
    }

    _setModelsReady() {
        if (this.elements.progressContainer) {
            this.elements.progressContainer.style.display = 'none';
        }
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = false;
        }
        if (this.elements.statusText) {
            this.elements.statusText.textContent = 'Ready';
        }
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.style.background = '#4ade80';
        }
        if (this.elements.modelBadge) {
            this.elements.modelBadge.style.display = 'block';
        }
    }

    // === Analysis UI ===

    async _onAnalyzeClick() {
        // Check if we have an image loaded
        if (!this.ui?.state?.hasImage) {
            console.warn('No image loaded');
            return;
        }

        // Show analysis progress
        if (this.elements.analysisStatus) {
            this.elements.analysisStatus.style.display = 'block';
        }
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = true;
            this.elements.analyzeBtn.textContent = 'Analyzing...';
        }

        // Get image data from GPU backend
        const imageData = this.ui.gpu.toImageData();

        // Create image element from the canvas
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        // Create Image element for pipeline
        const img = new Image();
        img.width = canvas.width;
        img.height = canvas.height;

        // Wait for image to be ready
        await new Promise(resolve => {
            img.onload = resolve;
            img.src = canvas.toDataURL();
        });

        try {
            const success = await this.pipeline.processImage(img, (data) => {
                this._updateAnalysisProgress(data.progress, data.message);
            });

            if (success) {
                this._onAnalysisComplete();
            }
        } catch (error) {
            this._showError(error.message);
        }
    }

    _updateAnalysisProgress(progress, message) {
        if (this.elements.analysisBar) {
            this.elements.analysisBar.style.width = `${progress}%`;
        }
        if (this.elements.analysisText) {
            this.elements.analysisText.textContent = message || 'Processing...';
        }
    }

    _onAnalysisComplete(confidence) {
        this.hasAnalyzed = true;

        // Hide analysis progress
        if (this.elements.analysisStatus) {
            this.elements.analysisStatus.style.display = 'none';
        }

        // Show controls
        if (this.elements.controls) {
            this.elements.controls.style.display = 'block';
        }

        // Reset analyze button
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = false;
            this.elements.analyzeBtn.textContent = 'Re-Analyze';
        }

        // Render initial result
        this._render();
    }

    _showError(message) {
        console.error('v8 Relighting Error:', message);

        if (this.elements.analysisStatus) {
            this.elements.analysisStatus.style.display = 'none';
        }
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = false;
            this.elements.analyzeBtn.textContent = 'Analyze Image';
        }
        if (this.elements.statusText) {
            this.elements.statusText.textContent = 'Error: ' + message;
            this.elements.statusText.style.color = '#ef4444';
        }
    }

    // === Light Controls ===

    _onLightPositionClick(e) {
        if (!this.hasAnalyzed) return;

        const rect = this.elements.lightPosition.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        // Update visual dot
        if (this.elements.lightDot) {
            this.elements.lightDot.style.left = `${x * 100}%`;
            this.elements.lightDot.style.top = `${y * 100}%`;
        }

        // Update pipeline
        this.pipeline.setLightPosition(x, y);
        this._render();
    }

    _onSliderChange(e) {
        const slider = e.target;
        const id = slider.id;
        const value = parseFloat(slider.value);

        // Update value display
        const valId = 'val-' + id.replace('slider-', '');
        const valEl = document.getElementById(valId);
        if (valEl) valEl.textContent = value;

        // Update pipeline
        if (id.includes('intensity') && !id.includes('shadow')) {
            this.pipeline.setLightIntensity(value / 100);
        } else if (id.includes('ambient')) {
            this.pipeline.setAmbient(value / 100);
        } else if (id.includes('height')) {
            this.pipeline.setLightHeight(value / 100);
        } else if (id.includes('shadow-intensity')) {
            this.pipeline.setShadowIntensity(value / 100);
        } else if (id.includes('shadow-softness')) {
            this.pipeline.setShadowSoftness(value / 100);
        }

        this._render();
    }

    _onResetClick() {
        // Reset sliders to defaults
        const defaults = {
            'slider-v8-intensity': 50,
            'slider-v8-ambient': 15,
            'slider-v8-height': 50,
            'slider-v8-shadow-intensity': 60,
            'slider-v8-shadow-softness': 40
        };

        Object.entries(defaults).forEach(([id, value]) => {
            const slider = document.getElementById(id);
            if (slider) {
                slider.value = value;
                const valId = 'val-' + id.replace('slider-', '');
                const valEl = document.getElementById(valId);
                if (valEl) valEl.textContent = value;
            }
        });

        // Reset light position
        if (this.elements.lightDot) {
            this.elements.lightDot.style.left = '50%';
            this.elements.lightDot.style.top = '30%';
        }

        // Reset light color
        if (this.elements.lightColor) {
            this.elements.lightColor.value = '#fff8f0';
        }

        // Reset pipeline
        this.pipeline.setLightPosition(0.5, 0.3);
        this.pipeline.setLightIntensity(0.5);
        this.pipeline.setAmbient(0.15);
        this.pipeline.setLightHeight(0.5);
        this.pipeline.setLightColor(1, 0.97, 0.94);

        this._render();
    }

    _onApplyClick() {
        if (!this.hasAnalyzed) return;

        // Get rendered result
        const canvas = this.pipeline.render();
        if (!canvas) return;

        // Apply to GPU backend
        if (this.ui?.gpu) {
            this.ui.gpu.loadImage(canvas);
        }

        console.log('✓ v8 Relighting applied');
    }

    // === Rendering ===

    _render() {
        if (!this.hasAnalyzed || !this.pipeline.hasProcessedImage()) return;

        const canvas = this.pipeline.render();
        if (!canvas) return;

        // Update main canvas with live preview
        if (this.ui?.gpu) {
            this.ui.gpu.loadImage(canvas);
        }
    }

    // === Public Methods ===

    activate() {
        this.isActive = true;
        console.log('🎨 v8 PRO Relighting activated');
    }

    deactivate() {
        this.isActive = false;
    }

    isReady() {
        return this.pipeline.isReady();
    }

    getState() {
        return {
            hasAnalyzed: this.hasAnalyzed,
            light: this.pipeline.light,
            confidence: this.pipeline.confidence?.overall
        };
    }

    dispose() {
        this.pipeline.dispose();
    }
}

export default RelightingProModule;
