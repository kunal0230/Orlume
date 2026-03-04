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
        this.rendererBackend = null; // 'webgpu' or 'webgl2'

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

        // Model tier selector
        this.elements.modelTier = document.getElementById('v8-model-tier');

        // Download progress elements
        this.elements.downloadStatus = document.getElementById('v8-download-status');
        this.elements.downloadText = document.getElementById('v8-download-text');
        this.elements.downloadBar = document.getElementById('v8-download-bar');
        this.elements.downloadSize = document.getElementById('v8-download-size');
        this.elements.downloadPercent = document.getElementById('v8-download-percent');

        // Analysis progress elements
        this.elements.analysisStage = document.getElementById('v8-analysis-stage');
        this.elements.analysisPercent = document.getElementById('v8-analysis-percent');

        // Time estimation and tips
        this.elements.estTime = document.getElementById('v8-est-time');
        this.elements.tipsSection = document.getElementById('v8-tips-section');

        // Debug maps
        this.elements.debugCanvas = document.getElementById('v8-debug-canvas');
        this.elements.debugLabel = document.getElementById('v8-debug-label');
        this.elements.debugInfoContent = document.getElementById('v8-debug-info-content');
        this.elements.debugMapBtns = document.querySelectorAll('.v8-map-btn');
        this.elements.exportMapsBtn = document.getElementById('btn-v8-export-maps');
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

        // Model tier selector
        if (this.elements.modelTier) {
            this.elements.modelTier.addEventListener('change', async (e) => {
                const tier = e.target.value;
                console.log(`🔄 Switching to model tier: ${tier}`);

                // Disable analyze button during model loading
                if (this.elements.analyzeBtn) {
                    this.elements.analyzeBtn.disabled = true;
                    this.elements.analyzeBtn.textContent = 'Loading Model...';
                }

                // Wait for tier switch and model loading
                await this.pipeline.setModelTier(tier);

                // Re-enable button
                if (this.elements.analyzeBtn) {
                    this.elements.analyzeBtn.disabled = false;
                    this.elements.analyzeBtn.textContent = 'Analyze Image';
                }
            });
        }

        // Keyboard shortcuts for light control
        this._keyboardHandler = this._onKeyDown.bind(this);
        document.addEventListener('keydown', this._keyboardHandler);

        // Debug map buttons
        if (this.elements.debugMapBtns) {
            this.elements.debugMapBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Toggle active state
                    this.elements.debugMapBtns.forEach(b => b.style.background = '');
                    btn.style.background = 'rgba(102, 126, 234, 0.3)';
                    this._renderDebugMap(btn.dataset.map);
                });
            });
        }
        // Export maps button
        if (this.elements.exportMapsBtn) {
            this.elements.exportMapsBtn.addEventListener('click', () => this._exportAllMaps());
        }
    }

    _onKeyDown(e) {
        // Only handle if we have analyzed and the tool is active
        if (!this.hasAnalyzed || !this.isActive) return;

        // Don't capture if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const step = 0.05; // 5% movement per keypress
        let handled = false;

        switch (e.key.toLowerCase()) {
            case 'w': // Move light up
                this.pipeline.light.position.y = Math.max(0, this.pipeline.light.position.y - step);
                handled = true;
                break;
            case 's': // Move light down
                this.pipeline.light.position.y = Math.min(1, this.pipeline.light.position.y + step);
                handled = true;
                break;
            case 'a': // Move light left
                this.pipeline.light.position.x = Math.max(0, this.pipeline.light.position.x - step);
                handled = true;
                break;
            case 'd': // Move light right
                this.pipeline.light.position.x = Math.min(1, this.pipeline.light.position.x + step);
                handled = true;
                break;
            case 'r': // Reset light position
                this.pipeline.setLightPosition(0.5, 0.5);
                this.pipeline.setLightIntensity(1.0);
                this.pipeline.setAmbient(0.3);
                this.pipeline.setLightHeight(0.5);
                this._updateLightHandle(0.5, 0.5);
                handled = true;
                break;
        }

        if (handled) {
            e.preventDefault();
            this._updateLightHandle(this.pipeline.light.position.x, this.pipeline.light.position.y);
            this._render();
        }
    }

    _setupPipelineEvents() {
        // Model downloading progress (before loading)
        this.pipeline.modelLoader.on('model-loading', ({ model, description, size }) => {
            this._showDownloadStatus(description, size);
        });

        // Model download progress (actual download)
        this.pipeline.modelLoader.on('model-progress', ({ model, percent, loaded, total }) => {
            this._updateDownloadProgress(percent, loaded, total);
        });

        // Model loaded
        this.pipeline.modelLoader.on('model-loaded', ({ model, fromCache }) => {
            console.log(`✓ Model loaded: ${model}${fromCache ? ' (cached)' : ''}`);
            this._hideDownloadStatus();
        });

        // Model loaded from cache (fast feedback)
        this.pipeline.modelLoader.on('model-cached', ({ model, loadTime }) => {
            console.log(`⚡ Model ${model} loaded from cache in ${loadTime}ms`);
            this._showCacheMessage();
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

        // User cancelled (e.g. declined resize prompt)
        this.pipeline.on('cancelled', () => {
            this._resetAnalysisUI();
        });

        // Confidence results
        this.pipeline.on('confidence', (confidence) => {
            this._displayConfidence(confidence);
        });

        // Error
        this.pipeline.on('error', ({ error }) => {
            this._showError(error.message);
        });

        // Renderer initialized
        this.pipeline.on('renderer-initialized', ({ backend }) => {
            this.rendererBackend = backend;
            console.log(`🎮 Renderer: ${backend.toUpperCase()}`);
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

    // === Download Progress Methods ===

    _showDownloadStatus(description, sizeMB) {
        console.log(`📦 Starting download: ${description} (${sizeMB}MB)`);

        if (this.elements.downloadStatus) {
            this.elements.downloadStatus.style.display = 'block';
        }
        if (this.elements.downloadText) {
            this.elements.downloadText.textContent = `Downloading ${description}...`;
        }
        if (this.elements.downloadBar) {
            this.elements.downloadBar.style.width = '0%';
        }
        if (this.elements.downloadSize) {
            this.elements.downloadSize.textContent = `0 MB / ${sizeMB} MB`;
        }
        if (this.elements.downloadPercent) {
            this.elements.downloadPercent.textContent = '0%';
        }

        // Disable analyze button during download
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = true;
            this.elements.analyzeBtn.textContent = 'Downloading Model...';
        }

        // Store expected size
        this._expectedDownloadSize = sizeMB;
    }

    _updateDownloadProgress(percent, loadedBytes, totalBytes) {
        const loadedMB = (loadedBytes / (1024 * 1024)).toFixed(1);
        const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

        if (this.elements.downloadBar) {
            this.elements.downloadBar.style.width = `${percent}%`;
        }
        if (this.elements.downloadSize) {
            this.elements.downloadSize.textContent = `${loadedMB} MB / ${totalMB} MB`;
        }
        if (this.elements.downloadPercent) {
            this.elements.downloadPercent.textContent = `${percent}%`;
        }
    }

    _hideDownloadStatus() {
        if (this.elements.downloadStatus) {
            this.elements.downloadStatus.style.display = 'none';
        }
        // Re-enable analyze button
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = false;
            this.elements.analyzeBtn.textContent = 'Analyze Image';
        }
    }

    _showCacheMessage() {
        // Show brief "Using cached model" feedback
        if (this.elements.statusText) {
            const originalText = this.elements.statusText.textContent;
            this.elements.statusText.textContent = 'Using cached model';
            this.elements.statusText.style.color = '#4ade80'; // Green

            // Fade back after 2 seconds
            setTimeout(() => {
                this.elements.statusText.textContent = originalText;
                this.elements.statusText.style.color = '';
            }, 2000);
        }

        // Flash the status indicator
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.style.animation = 'none';
            this.elements.statusIndicator.offsetHeight; // Force reflow
            this.elements.statusIndicator.style.animation = 'pulse 0.5s ease-out';
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
        // Hide old status elements - we use renderer status instead
        if (this.elements.statusText) {
            this.elements.statusText.style.display = 'none';
        }
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.style.display = 'none';
        }
        if (this.elements.modelBadge) {
            this.elements.modelBadge.style.display = 'none';
        }
        // Hide the entire model status card
        const modelStatusCard = document.getElementById('v8-model-status-card');
        if (modelStatusCard) {
            modelStatusCard.style.display = 'none';
        }

        // Create renderer status display
        this._createRendererStatusDisplay();
    }

    /**
     * Create a visual display showing renderer status
     */
    _createRendererStatusDisplay() {
        // Find or create the container
        let container = document.getElementById('v8-renderer-status');
        if (!container) {
            container = document.createElement('div');
            container.id = 'v8-renderer-status';
            container.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-top: 8px;
                padding: 10px 12px;
                background: rgba(30, 30, 40, 0.5);
                border-radius: 8px;
                font-size: 11px;
            `;

            // Insert after the model status card
            const modelStatusCard = document.getElementById('v8-model-status-card');
            if (modelStatusCard && modelStatusCard.parentNode) {
                modelStatusCard.parentNode.insertBefore(container, modelStatusCard.nextSibling);
            }
        }

        const isWebGPU = this.rendererBackend === 'webgpu';

        container.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #22c55e;
                    box-shadow: 0 0 6px #22c55e;
                "></span>
                <span style="color: #fff; font-weight: 500;">WebGPU</span>
                <span style="color: #22c55e; font-size: 10px; margin-left: auto;">Active</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; opacity: 0.6;">
                <span style="
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #eab308;
                "></span>
                <span style="color: #9ca3af;">WebGL2</span>
                <span style="color: #eab308; font-size: 10px; margin-left: auto;">Fallback</span>
            </div>
        `;
    }

    // === Analysis UI ===

    async _onAnalyzeClick() {
        // Check if we have an image loaded
        if (!this.ui?.state?.hasImage) {
            console.warn('No image loaded');
            return;
        }

        // Show analysis progress and disable button IMMEDIATELY
        if (this.elements.analysisStatus) {
            this.elements.analysisStatus.style.display = 'block';
        }
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = true;
            this.elements.analyzeBtn.textContent = 'Analyzing...';
        }
        if (this.elements.analysisBar) {
            this.elements.analysisBar.style.width = '2%';
        }
        if (this.elements.analysisStage) {
            this.elements.analysisStage.textContent = 'Starting...';
        }
        if (this.elements.analysisPercent) {
            this.elements.analysisPercent.textContent = '2%';
        }

        // CRITICAL: Force the browser to repaint BEFORE heavy work begins.
        // Without this, the button/progress changes above are never rendered
        // because createImageBitmap + pipeline init blocks the main thread.
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

        try {
            // Get the GPU canvas directly — avoids the expensive toImageData() readback
            // which synchronously reads millions of pixels from the GPU
            const gpuCanvas = this.ui.gpu.canvas || this.ui.gpu.backend?.canvas;
            if (!gpuCanvas) {
                throw new Error('No GPU canvas available');
            }

            // Update time estimate from canvas dimensions (no pixel readback needed)
            this._updateTimeEstimate(gpuCanvas.width, gpuCanvas.height);

            // Use createImageBitmap for a non-blocking image capture from the canvas.
            // This avoids the catastrophic toDataURL() call that base64-encodes
            // the entire full-resolution image synchronously on the main thread.
            const imageBitmap = await createImageBitmap(gpuCanvas);

            // Pass the ImageBitmap directly to the pipeline.
            // The pipeline's ResolutionManager will check dimensions and downscale
            // BEFORE any heavy processing begins.
            const success = await this.pipeline.processImage(imageBitmap, (data) => {
                this._updateAnalysisProgress(data.progress, data.message);
            });

            if (success) {
                this._onAnalysisComplete();
            } else {
                // processImage returned false — user cancelled or models not ready
                this._resetAnalysisUI();
            }
        } catch (error) {
            this._showError(error.message);
        } finally {
            // Always re-enable button on completion or failure
            if (!this.hasAnalyzed) {
                this.elements.analyzeBtn.disabled = false;
                this.elements.analyzeBtn.textContent = 'Analyze Image';
            }
        }
    }

    /**
     * Reset the analysis UI back to its initial state (e.g. after user cancels)
     */
    _resetAnalysisUI() {
        if (this.elements.analysisStatus) {
            this.elements.analysisStatus.style.display = 'none';
        }
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = false;
            this.elements.analyzeBtn.textContent = 'Analyze Image';
        }
        if (this.elements.analysisBar) {
            this.elements.analysisBar.style.width = '0%';
        }
        if (this.elements.analysisStage) {
            this.elements.analysisStage.textContent = '';
        }
        if (this.elements.analysisPercent) {
            this.elements.analysisPercent.textContent = '';
        }
    }

    _updateAnalysisProgress(progress, message) {
        // Safety check for undefined/NaN progress
        const safeProgress = (typeof progress === 'number' && !isNaN(progress)) ? progress : 0;

        if (this.elements.analysisBar) {
            this.elements.analysisBar.style.width = `${safeProgress}%`;
        }
        if (this.elements.analysisText) {
            this.elements.analysisText.textContent = message || 'Processing...';
        }
        if (this.elements.analysisStage) {
            this.elements.analysisStage.textContent = message || 'Processing...';
        }
        if (this.elements.analysisPercent) {
            this.elements.analysisPercent.textContent = `${Math.round(safeProgress)}%`;
        }
    }

    /**
     * Update estimated processing time based on image size and model tier
     */
    _updateTimeEstimate(imageWidth, imageHeight) {
        const pixels = imageWidth * imageHeight;
        const tier = this.pipeline.getCurrentModelTier();

        // Base time estimates (seconds)
        let baseTime = 2;

        // Adjust for image size
        if (pixels > 4000000) {  // > 4MP (e.g., 2000x2000)
            baseTime = 8;
        } else if (pixels > 2000000) {  // > 2MP
            baseTime = 5;
        } else if (pixels > 1000000) {  // > 1MP
            baseTime = 3;
        }

        // Adjust for model tier
        if (tier === 'balanced') {
            baseTime *= 1.5;
        }

        // Calculate range
        const minTime = Math.max(1, Math.round(baseTime * 0.7));
        const maxTime = Math.round(baseTime * 1.5);

        const estimate = `~${minTime}-${maxTime} seconds`;

        if (this.elements.estTime) {
            this.elements.estTime.textContent = estimate;
        }

        return estimate;
    }

    _onAnalysisComplete(confidence) {
        this.hasAnalyzed = true;

        // Hide analysis progress
        if (this.elements.analysisStatus) {
            this.elements.analysisStatus.style.display = 'none';
        }

        // Hide tips section (no longer needed after analysis)
        if (this.elements.tipsSection) {
            this.elements.tipsSection.style.display = 'none';
        }

        // Show controls
        if (this.elements.controls) {
            this.elements.controls.style.display = 'block';
        }

        // Hide intro text and beta notice for cleaner post-analysis UI
        const introText = document.getElementById('v8-intro-text');
        const betaNotice = document.getElementById('v8-beta-notice');
        if (introText) introText.style.display = 'none';
        if (betaNotice) betaNotice.style.display = 'none';
        // Hide performance notice too
        const perfNotice = betaNotice?.nextElementSibling;
        if (perfNotice && perfNotice.textContent.includes('GPU-intensive')) {
            perfNotice.style.display = 'none';
        }

        // Add BETA badge with hover tooltip to header (if not already added)
        this._addBetaHeaderBadge();

        // Reset analyze button
        if (this.elements.analyzeBtn) {
            this.elements.analyzeBtn.disabled = false;
            this.elements.analyzeBtn.textContent = 'Re-Analyze';
        }

        // Render initial result
        this._render();

        // Update debug info
        this._updateDebugInfo();
    }

    /**
     * Add a small BETA badge to the header with hover tooltip
     */
    _addBetaHeaderBadge() {
        if (document.getElementById('v8-header-beta-badge')) return; // Already added

        // Find the header with "3D Relighting v8"
        const panel = document.getElementById('panel-3d-pro');
        if (!panel) return;

        // Create the badge with tooltip
        const badge = document.createElement('span');
        badge.id = 'v8-header-beta-badge';
        badge.style.cssText = `
            position: relative;
            display: inline-flex;
            align-items: center;
            margin-left: 8px;
            padding: 2px 6px;
            font-size: 9px;
            font-weight: 600;
            color: var(--accent);
            background: rgba(99, 102, 241, 0.2);
            border-radius: 4px;
            cursor: help;
        `;
        badge.textContent = 'BETA';

        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.style.cssText = `
            position: fixed;
            padding: 10px 12px;
            width: 200px;
            background: rgba(30, 30, 40, 0.98);
            border: 1px solid rgba(99, 102, 241, 0.3);
            border-radius: 8px;
            font-size: 10px;
            font-weight: 400;
            color: var(--text-secondary);
            line-height: 1.5;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: opacity 0.2s, visibility 0.2s;
            z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        `;
        tooltip.innerHTML = `
            <div style="font-weight: 600; color: var(--accent); margin-bottom: 4px;">BETA · Updated 25 Feb 2026</div>
            SH-based albedo extraction for cleaner relighting. 4-stage normal smoothing eliminates surface texture artifacts. Hybrid neural + depth-derived normals for accurate shading.
        `;
        document.body.appendChild(tooltip);

        // Show/hide tooltip on hover with dynamic positioning
        badge.addEventListener('mouseenter', () => {
            const rect = badge.getBoundingClientRect();
            // Position below the badge, but shift left to stay in viewport
            tooltip.style.top = `${rect.bottom + 8}px`;
            tooltip.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - 220))}px`;
            tooltip.style.opacity = '1';
            tooltip.style.visibility = 'visible';
        });
        badge.addEventListener('mouseleave', () => {
            tooltip.style.opacity = '0';
            tooltip.style.visibility = 'hidden';
        });

        // Find the mode header with "3D Relighting v8" and insert after v8 badge
        const modeHeader = document.getElementById('relight-pro-mode-header');
        if (modeHeader) {
            // Insert at the end of the header (after v8 badge)
            modeHeader.appendChild(badge);
        }
    }

    /**
     * Update the visual light handle position (for keyboard controls)
     * @param {number} x - 0-1 horizontal position
     * @param {number} y - 0-1 vertical position
     */
    _updateLightHandle(x, y) {
        if (!this.elements.lightDot || !this.elements.lightPosition) return;

        const rect = this.elements.lightPosition.getBoundingClientRect();
        const dotX = x * rect.width;
        const dotY = y * rect.height;

        this.elements.lightDot.style.left = `${dotX}px`;
        this.elements.lightDot.style.top = `${dotY}px`;
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

    /**
     * Render a debug visualization map and show it on the MAIN canvas
     */
    _renderDebugMap(mapType) {
        const label = this.elements.debugLabel;

        // Reset: go back to the relit image
        if (mapType === 'reset') {
            this._activeDebugMap = null;
            if (label) label.textContent = 'Click a map to view on canvas';
            this.elements.debugMapBtns.forEach(b => b.style.background = '');
            this._render();  // Restore the relit image
            return;
        }

        if (!this.pipeline.gBuffer) return;

        this._activeDebugMap = mapType;
        const { width, height, depth, normals, sceneMap, albedo } = this.pipeline.gBuffer;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);

        const labels = {
            depth: 'Depth Map — near=bright, far=dark',
            normals: 'Surface Normals — RGB = XYZ direction',
            albedo: 'Albedo — original image used as base color',
            material: 'Material — skin=orange, hair=green, fabric=blue, metal=white',
            roughness: 'Roughness — smooth=dark, rough=bright',
            curvature: 'Curvature — concave=dark, flat=gray, convex=bright',
            depthLayer: 'Depth Layers — far=dark, near=bright'
        };
        if (label) label.textContent = labels[mapType] || mapType;

        if (mapType === 'depth') {
            // Depth: Float32Array with arbitrary range, needs min/max normalization
            if (depth && depth.data) {
                let minD = Infinity, maxD = -Infinity;
                for (let i = 0; i < depth.data.length; i++) {
                    if (depth.data[i] < minD) minD = depth.data[i];
                    if (depth.data[i] > maxD) maxD = depth.data[i];
                }
                const range = maxD - minD || 1;
                for (let i = 0; i < depth.data.length; i++) {
                    const v = Math.round(((depth.data[i] - minD) / range) * 255);
                    const px = i * 4;
                    imgData.data[px] = v;
                    imgData.data[px + 1] = v;
                    imgData.data[px + 2] = v;
                    imgData.data[px + 3] = 255;
                }
            }

        } else if (mapType === 'normals') {
            // Normals: Float32Array (nx, ny, nz) -> map [-1,1] to [0,255]
            if (normals && normals.data) {
                for (let i = 0; i < width * height; i++) {
                    const ni = i * 3;
                    const px = i * 4;
                    imgData.data[px] = Math.round((normals.data[ni] * 0.5 + 0.5) * 255);
                    imgData.data[px + 1] = Math.round((normals.data[ni + 1] * 0.5 + 0.5) * 255);
                    imgData.data[px + 2] = Math.round((normals.data[ni + 2] * 0.5 + 0.5) * 255);
                    imgData.data[px + 3] = 255;
                }
            }

        } else if (mapType === 'albedo') {
            // Albedo: the original image stored as ImageData (RGBA uint8)
            if (albedo && albedo.data) {
                for (let i = 0; i < width * height * 4; i++) {
                    imgData.data[i] = albedo.data[i];
                }
            }

        } else if (mapType === 'material') {
            // Scene map R channel = material type, color-coded
            if (sceneMap) {
                for (let i = 0; i < width * height; i++) {
                    const px = i * 4;
                    const mat = sceneMap.data[px] / 255;
                    if (mat < 0.1) {
                        imgData.data[px] = 30; imgData.data[px + 1] = 30; imgData.data[px + 2] = 30;
                    } else if (mat < 0.35) {
                        imgData.data[px] = 255; imgData.data[px + 1] = 140; imgData.data[px + 2] = 100;
                    } else if (mat < 0.6) {
                        imgData.data[px] = 80; imgData.data[px + 1] = 200; imgData.data[px + 2] = 100;
                    } else if (mat < 0.85) {
                        imgData.data[px] = 100; imgData.data[px + 1] = 140; imgData.data[px + 2] = 255;
                    } else {
                        imgData.data[px] = 230; imgData.data[px + 1] = 230; imgData.data[px + 2] = 240;
                    }
                    imgData.data[px + 3] = 255;
                }
            }

        } else if (mapType === 'roughness') {
            if (sceneMap) {
                for (let i = 0; i < width * height; i++) {
                    const px = i * 4;
                    const v = sceneMap.data[px + 1];
                    imgData.data[px] = v; imgData.data[px + 1] = v; imgData.data[px + 2] = v;
                    imgData.data[px + 3] = 255;
                }
            }

        } else if (mapType === 'curvature') {
            if (sceneMap) {
                for (let i = 0; i < width * height; i++) {
                    const px = i * 4;
                    const v = sceneMap.data[px + 2];
                    imgData.data[px] = v; imgData.data[px + 1] = v; imgData.data[px + 2] = v;
                    imgData.data[px + 3] = 255;
                }
            }

        } else if (mapType === 'depthLayer') {
            if (sceneMap) {
                for (let i = 0; i < width * height; i++) {
                    const px = i * 4;
                    const v = sceneMap.data[px + 3];
                    imgData.data[px] = v; imgData.data[px + 1] = v; imgData.data[px + 2] = v;
                    imgData.data[px + 3] = 255;
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);

        // Show on the MAIN canvas (big view)
        if (this.ui?.gpu) {
            this.ui.gpu.loadImage(canvas);
        }
    }

    /**
     * Export all analysis maps as PNG downloads (staggered to avoid blocking)
     */
    async _exportAllMaps() {
        if (!this.pipeline.gBuffer) {
            console.warn('No analysis data — run Analyze first');
            return;
        }

        const mapTypes = ['depth', 'normals', 'albedo', 'material', 'roughness', 'curvature', 'depthLayer'];

        for (const mapType of mapTypes) {
            // Reuse _renderDebugMap logic to draw each map onto a temp canvas
            const { width, height, depth, normals, sceneMap, albedo } = this.pipeline.gBuffer;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(width, height);

            if (mapType === 'depth' && depth?.data) {
                let minD = Infinity, maxD = -Infinity;
                for (let i = 0; i < depth.data.length; i++) {
                    if (depth.data[i] < minD) minD = depth.data[i];
                    if (depth.data[i] > maxD) maxD = depth.data[i];
                }
                const range = maxD - minD || 1;
                for (let i = 0; i < depth.data.length; i++) {
                    const v = Math.round(((depth.data[i] - minD) / range) * 255);
                    const px = i * 4;
                    imgData.data[px] = v; imgData.data[px + 1] = v; imgData.data[px + 2] = v; imgData.data[px + 3] = 255;
                }
            } else if (mapType === 'normals' && normals?.data) {
                for (let i = 0; i < width * height; i++) {
                    const ni = i * 3, px = i * 4;
                    imgData.data[px] = Math.round((normals.data[ni] * 0.5 + 0.5) * 255);
                    imgData.data[px + 1] = Math.round((normals.data[ni + 1] * 0.5 + 0.5) * 255);
                    imgData.data[px + 2] = Math.round((normals.data[ni + 2] * 0.5 + 0.5) * 255);
                    imgData.data[px + 3] = 255;
                }
            } else if (mapType === 'albedo' && albedo?.data) {
                for (let i = 0; i < width * height * 4; i++) imgData.data[i] = albedo.data[i];
            } else if (mapType === 'material' && sceneMap) {
                for (let i = 0; i < width * height; i++) {
                    const px = i * 4;
                    const mat = sceneMap.data[px] / 255;
                    if (mat < 0.1) { imgData.data[px] = 30; imgData.data[px + 1] = 30; imgData.data[px + 2] = 30; }
                    else if (mat < 0.35) { imgData.data[px] = 255; imgData.data[px + 1] = 140; imgData.data[px + 2] = 100; }
                    else if (mat < 0.6) { imgData.data[px] = 80; imgData.data[px + 1] = 200; imgData.data[px + 2] = 100; }
                    else if (mat < 0.85) { imgData.data[px] = 100; imgData.data[px + 1] = 140; imgData.data[px + 2] = 255; }
                    else { imgData.data[px] = 230; imgData.data[px + 1] = 230; imgData.data[px + 2] = 240; }
                    imgData.data[px + 3] = 255;
                }
            } else if (mapType === 'roughness' && sceneMap) {
                for (let i = 0; i < width * height; i++) {
                    const px = i * 4, v = sceneMap.data[px + 1];
                    imgData.data[px] = v; imgData.data[px + 1] = v; imgData.data[px + 2] = v; imgData.data[px + 3] = 255;
                }
            } else if (mapType === 'curvature' && sceneMap) {
                for (let i = 0; i < width * height; i++) {
                    const px = i * 4, v = sceneMap.data[px + 2];
                    imgData.data[px] = v; imgData.data[px + 1] = v; imgData.data[px + 2] = v; imgData.data[px + 3] = 255;
                }
            } else if (mapType === 'depthLayer' && sceneMap) {
                for (let i = 0; i < width * height; i++) {
                    const px = i * 4, v = sceneMap.data[px + 3];
                    imgData.data[px] = v; imgData.data[px + 1] = v; imgData.data[px + 2] = v; imgData.data[px + 3] = 255;
                }
            } else {
                continue; // Skip if data missing
            }

            ctx.putImageData(imgData, 0, 0);

            // Trigger download
            const link = document.createElement('a');
            link.download = `orlume_${mapType}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            // Stagger downloads to avoid browser blocking
            await new Promise(r => setTimeout(r, 200));
        }

        console.log('✓ Exported all 7 analysis maps');
    }

    /**
     * Update the debug info panel with scene analysis data
     */
    _updateDebugInfo() {
        const el = this.elements.debugInfoContent;
        if (!el) return;

        const conf = this.pipeline.confidence;
        const light = this.pipeline.light;
        const gb = this.pipeline.gBuffer;

        if (!conf || !gb) {
            el.textContent = 'Analyze an image to see scene info';
            return;
        }

        const origDir = light.originalLightDir;
        const lighting = conf.lighting || {};

        let html = '';
        html += `<div><strong>Image:</strong> ${gb.width}×${gb.height} (${((gb.width * gb.height) / 1e6).toFixed(1)}MP)</div>`;
        html += `<div><strong>Quality:</strong> ${conf.quality || '?'} (${Math.round((conf.overall || 0) * 100)}%)</div>`;
        html += `<div><strong>Depth conf:</strong> ${Math.round((conf.depth?.score || 0) * 100)}%</div>`;
        html += `<div><strong>Normal conf:</strong> ${Math.round((conf.normal?.score || 0) * 100)}%</div>`;
        html += `<div><strong>Material conf:</strong> ${Math.round((conf.material?.score || 0) * 100)}%</div>`;

        if (origDir) {
            html += `<div style="margin-top: 6px; border-top: 1px solid var(--border-color); padding-top: 6px;">`;
            html += `<strong>Detected light dir:</strong> (${origDir.x.toFixed(2)}, ${origDir.y.toFixed(2)})</div>`;
        }
        if (lighting.lightSources) {
            html += `<div><strong>Light sources:</strong> ${lighting.lightSources}</div>`;
        }
        if (lighting.complexity !== undefined) {
            html += `<div><strong>Lighting complexity:</strong> ${Math.round(lighting.complexity * 100)}%</div>`;
        }
        if (lighting.harshShadows) {
            html += `<div><strong>Harsh shadows:</strong> Yes</div>`;
        }
        if (lighting.coloredLighting) {
            html += `<div><strong>Colored lighting:</strong> Yes</div>`;
        }

        html += `<div style="margin-top: 6px; border-top: 1px solid var(--border-color); padding-top: 6px;">`;
        html += `<strong>Renderer:</strong> ${this.rendererBackend || 'unknown'}</div>`;

        el.innerHTML = html;
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
