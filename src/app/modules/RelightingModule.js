/**
 * RelightingModule.js - UI integration for 3D Relighting v4
 * 
 * Uses neural network-based depth/normal estimation:
 * - Transformers.js with Depth Anything V2
 * - High-quality surface normals from AI
 * - DaVinci Resolve-quality relighting
 */

import { RelightingEngine } from '../../relighting/v2/RelightingEngine.js';

export class RelightingModule {
    constructor(ui) {
        this.ui = ui;
        this.engine = null;

        // State
        this.isActive = false;
        this.isProcessing = false;
        this.hasProcessed = false;

        // Light indicator element
        this.lightIndicator = null;

        // Canvas event handlers
        this._canvasClickHandler = null;
        this._canvasDragHandler = null;
        this._canvasUpHandler = null;
        this._isDragging = false;

        // Render debounce
        this._renderTimeout = null;

        // Preview canvas
        this.previewCanvas = null;
        this.previewCtx = null;
    }

    /**
     * Initialize the module
     */
    init() {
        this._initSliders();
        this._initButtons();
        this._createLightIndicator();
        this._createProgressBar();
        this._createPreviewCanvas();

        console.log('🔆 RelightingModule v2 initialized');
    }

    /**
     * Initialize slider controls
     */
    _initSliders() {
        const sliders = [
            { id: 'relight-intensity', param: 'intensity', divisor: 100 },
            { id: 'relight-ambient', param: 'ambient', divisor: 100 },
            { id: 'relight-softness', param: 'reach', divisor: 1 },  // Repurpose "softness" as "reach"
            { id: 'relight-specularity', param: 'specularity', divisor: 100 },
            { id: 'relight-glossiness', param: 'glossiness', divisor: 1 },
            // Note: If we add a contrast slider in HTML, add it here
        ];

        sliders.forEach(({ id, param, divisor }) => {
            const slider = document.getElementById(`slider-${id}`);
            const valueEl = document.getElementById(`val-${id}`);

            if (!slider) return;

            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                if (valueEl) valueEl.textContent = value;
                this._updateParameter(param, value / divisor);
            });
        });
    }

    /**
     * Update lighting parameter
     */
    _updateParameter(param, value) {
        if (!this.engine) return;

        switch (param) {
            case 'intensity':
                this.engine.setLightIntensity(value);
                break;
            case 'ambient':
                this.engine.setAmbient(value);
                break;
            case 'reach':
                this.engine.setReach(value);
                break;
            case 'contrast':
                this.engine.setContrast(value);
                break;
            case 'specularity':
                this.engine.setSpecularity(value);
                break;
            case 'glossiness':
                this.engine.setGlossiness(value);
                break;
        }

        this._debouncedRender();
    }

    /**
     * Initialize buttons
     */
    _initButtons() {
        const depthBtn = document.getElementById('btn-relight-depth');
        if (depthBtn) {
            depthBtn.addEventListener('click', () => this._estimateDepth());
        }

        const applyBtn = document.getElementById('btn-relight-apply');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => this._applyEffect());
        }

        const resetBtn = document.getElementById('btn-relight-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this._resetToDefaults());
        }

        // Light type toggle
        const directionalBtn = document.getElementById('btn-light-directional');
        const pointBtn = document.getElementById('btn-light-point');

        if (directionalBtn) {
            directionalBtn.addEventListener('click', () => {
                if (this.engine) {
                    this.engine.setDirectional(true);
                    directionalBtn.classList.add('btn-primary');
                    if (pointBtn) pointBtn.classList.remove('btn-primary');
                    this._debouncedRender();
                }
            });
        }

        if (pointBtn) {
            pointBtn.addEventListener('click', () => {
                if (this.engine) {
                    this.engine.setDirectional(false);
                    pointBtn.classList.add('btn-primary');
                    if (directionalBtn) directionalBtn.classList.remove('btn-primary');
                    this._debouncedRender();
                }
            });
        }

        // Debug buttons
        const showNormalsBtn = document.getElementById('btn-show-normals');
        if (showNormalsBtn) {
            showNormalsBtn.addEventListener('click', () => this._showDebugMap('normals'));
        }

        const showDepthBtn = document.getElementById('btn-show-depth');
        if (showDepthBtn) {
            showDepthBtn.addEventListener('click', () => this._showDebugMap('depth'));
        }

        const showLightingBtn = document.getElementById('btn-show-lighting');
        if (showLightingBtn) {
            showLightingBtn.addEventListener('click', () => this._showDebugMap('albedo'));
        }

        const showResultBtn = document.getElementById('btn-show-result');
        if (showResultBtn) {
            showResultBtn.addEventListener('click', () => this._showDebugMap('result'));
        }
    }

    /**
     * Show debug visualization
     */
    _showDebugMap(type) {
        if (!this.engine || !this.hasProcessed) {
            console.warn('No surface map available');
            return;
        }

        let debugCanvas = null;
        switch (type) {
            case 'normals':
                debugCanvas = this.engine.getDebugNormalMap();
                console.log('📊 Showing normal map (R=X, G=Y, B=Z, purple=facing camera)');
                break;
            case 'depth':
                // Use heightmap now (unified 3D surface)
                debugCanvas = this.engine.getDebugHeightMap();
                console.log('📊 Showing unified heightmap (white=close, black=far)');
                break;
            case 'lighting':
                debugCanvas = this.engine.getDebugLightingMap();
                console.log('📊 Showing lighting result');
                break;
            case 'albedo':
                debugCanvas = this.engine.getDebugAlbedo();
                console.log('📊 Showing albedo (base color without lighting)');
                break;
            case 'result':
                this._renderPreview();
                console.log('📊 Showing relit result');
                return;
        }

        if (debugCanvas && this.previewCanvas) {
            const mainCanvas = this.ui.elements?.canvas || this.ui.gpu?.canvas;
            if (!mainCanvas) return;

            this.previewCanvas.width = mainCanvas.width;
            this.previewCanvas.height = mainCanvas.height;
            this.previewCanvas.style.display = 'block';

            this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
            this.previewCtx.drawImage(debugCanvas, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
        }
    }

    /**
     * Create light position indicator
     */
    _createLightIndicator() {
        this.lightIndicator = document.createElement('div');
        this.lightIndicator.id = 'relight-light-indicator';
        this.lightIndicator.innerHTML = `
            <svg width="48" height="48" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="rgba(255,200,50,0.3)" stroke="#ffc832" stroke-width="3"/>
                <circle cx="24" cy="24" r="8" fill="#ffc832"/>
            </svg>
        `;
        this.lightIndicator.style.cssText = `
            position: absolute;
            width: 48px;
            height: 48px;
            pointer-events: none;
            z-index: 100;
            transform: translate(-50%, -50%);
            display: none;
            filter: drop-shadow(0 0 10px rgba(255, 200, 50, 0.5));
        `;

        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.appendChild(this.lightIndicator);
        }
    }

    /**
     * Create progress bar
     */
    _createProgressBar() {
        const panel = document.getElementById('panel-relight');
        if (!panel) return;

        if (document.getElementById('relight-progress-container')) return;

        const progressContainer = document.createElement('div');
        progressContainer.id = 'relight-progress-container';
        progressContainer.style.cssText = `
            display: none;
            padding: 12px;
            background: var(--bg-tertiary);
            border-radius: 8px;
            margin-bottom: 12px;
        `;
        progressContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span id="relight-progress-text">Processing...</span>
                <span id="relight-progress-percent">0%</span>
            </div>
            <div style="height: 4px; background: var(--bg-secondary); border-radius: 2px; overflow: hidden;">
                <div id="relight-progress-bar" style="height: 100%; width: 0%; background: var(--accent); transition: width 0.2s;"></div>
            </div>
        `;

        const firstSection = panel.querySelector('.panel-content');
        if (firstSection) {
            firstSection.insertBefore(progressContainer, firstSection.firstChild);
        }
    }

    /**
     * Create preview canvas
     */
    _createPreviewCanvas() {
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.id = 'relight-preview-canvas';
        this.previewCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            display: none;
            z-index: 50;
        `;

        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.appendChild(this.previewCanvas);
        }

        this.previewCtx = this.previewCanvas.getContext('2d');
    }

    /**
     * Update progress bar
     */
    _updateProgress(percent, text) {
        const container = document.getElementById('relight-progress-container');
        const bar = document.getElementById('relight-progress-bar');
        const percentEl = document.getElementById('relight-progress-percent');
        const textEl = document.getElementById('relight-progress-text');

        if (container) container.style.display = 'block';
        if (bar) bar.style.width = `${percent}%`;
        if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
        if (textEl) textEl.textContent = text;
    }

    /**
     * Hide progress bar
     */
    _hideProgress() {
        const container = document.getElementById('relight-progress-container');
        if (container) container.style.display = 'none';
    }

    /**
     * Activate relighting mode
     */
    async activate() {
        if (this.isActive) return;
        this.isActive = true;

        if (!this.ui.state?.hasImage || !this.ui.gpu) {
            console.warn('🔆 Relighting: No image loaded');
            this._updateDepthStatus();
            return;
        }

        // Initialize engine if needed
        if (!this.engine) {
            this.engine = new RelightingEngine();
            await this.engine.init((progress) => {
                this._updateProgress(progress.progress || 0, progress.message || 'Loading...');
            });
        }

        // Setup canvas events
        this._setupCanvasEvents();

        // Show light indicator
        this._updateLightIndicator();

        // Update status
        this._updateDepthStatus();

        // If already processed, render preview
        if (this.hasProcessed) {
            this._renderPreview();
            this.previewCanvas.style.display = 'block';
        }

        console.log('🔆 Relighting v2 activated');
    }

    /**
     * Deactivate relighting mode
     */
    deactivate() {
        if (!this.isActive) return;
        this.isActive = false;

        this._removeCanvasEvents();

        if (this.lightIndicator) {
            this.lightIndicator.style.display = 'none';
        }

        if (this.previewCanvas) {
            this.previewCanvas.style.display = 'none';
        }

        console.log('🔆 Relighting deactivated');
    }

    /**
     * Setup canvas click/drag for light position
     */
    _setupCanvasEvents() {
        const canvas = this.ui.gpu?.canvas;
        if (!canvas) return;

        this._canvasClickHandler = (e) => {
            this._isDragging = true;
            this._handleLightPosition(e);
        };

        this._canvasDragHandler = (e) => {
            if (this._isDragging) {
                this._handleLightPosition(e);
            }
        };

        this._canvasUpHandler = () => {
            this._isDragging = false;
        };

        canvas.addEventListener('mousedown', this._canvasClickHandler);
        canvas.addEventListener('mousemove', this._canvasDragHandler);
        document.addEventListener('mouseup', this._canvasUpHandler);
    }

    /**
     * Remove canvas events
     */
    _removeCanvasEvents() {
        const canvas = this.ui.gpu?.canvas;
        if (!canvas) return;

        if (this._canvasClickHandler) {
            canvas.removeEventListener('mousedown', this._canvasClickHandler);
        }
        if (this._canvasDragHandler) {
            canvas.removeEventListener('mousemove', this._canvasDragHandler);
        }
        if (this._canvasUpHandler) {
            document.removeEventListener('mouseup', this._canvasUpHandler);
        }
    }

    /**
     * Handle light position from mouse event
     */
    _handleLightPosition(e) {
        const canvas = this.ui.gpu?.canvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        if (this.engine) {
            this.engine.setLightPosition(x, y);
            this._updateLightIndicator();
            this._debouncedRender();
        }
    }

    /**
     * Update light indicator position
     */
    _updateLightIndicator() {
        if (!this.lightIndicator || !this.engine) return;

        const canvas = this.ui.gpu?.canvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const container = this.lightIndicator.parentElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();

        const x = rect.left - containerRect.left + rect.width * this.engine.light.position.x;
        const y = rect.top - containerRect.top + rect.height * this.engine.light.position.y;

        this.lightIndicator.style.left = `${x}px`;
        this.lightIndicator.style.top = `${y}px`;
        this.lightIndicator.style.display = 'block';
    }

    /**
     * Update depth estimation status
     */
    _updateDepthStatus() {
        const statusEl = document.getElementById('relight-depth-status');
        const depthBtn = document.getElementById('btn-relight-depth');

        if (this.hasProcessed) {
            if (statusEl) statusEl.textContent = '✅ Surface map ready';
            if (depthBtn) depthBtn.textContent = 'Re-estimate Depth';
        } else {
            if (statusEl) statusEl.textContent = 'ℹ️ Click "Estimate Depth" to start';
            if (depthBtn) depthBtn.textContent = 'Estimate Depth';
        }
    }

    /**
     * Estimate depth and compute surface normals
     */
    async _estimateDepth() {
        if (this.isProcessing) return;

        if (!this.ui.state?.hasImage) {
            console.warn('No image loaded');
            return;
        }

        this.isProcessing = true;
        const depthBtn = document.getElementById('btn-relight-depth');
        if (depthBtn) depthBtn.disabled = true;

        try {
            this._updateProgress(0, 'Initializing Neural Network...');

            // Initialize engine if not ready
            if (!this.engine || !this.engine.isReady) {
                this.engine = new RelightingEngine();
                await this.engine.init((progress) => {
                    this._updateProgress(progress.progress || 0, progress.message || 'Loading AI model...');
                });
            }

            this._updateProgress(50, 'Running AI depth estimation...');

            // Get current image
            const imageData = this.ui.gpu.toImageData();
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageData.width;
            tempCanvas.height = imageData.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(imageData, 0, 0);

            // Create image from canvas
            const imageUrl = tempCanvas.toDataURL();
            const image = await this._loadImage(imageUrl);

            // Process with neural network engine (no external depth estimator needed)
            const success = await this.engine.processImage(image);

            if (!success) {
                throw new Error('Neural estimation failed');
            }

            this._updateProgress(100, 'Complete!');

            this.hasProcessed = true;
            this._updateDepthStatus();

            // Show preview
            this.previewCanvas.style.display = 'block';
            this._renderPreview();

            setTimeout(() => this._hideProgress(), 1000);

        } catch (error) {
            console.error('Neural estimation failed:', error);
            this._updateProgress(0, `Error: ${error.message}`);
        } finally {
            this.isProcessing = false;
            if (depthBtn) depthBtn.disabled = false;
        }
    }

    /**
     * Load image from URL
     */
    _loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    /**
     * Debounced render for slider updates
     */
    _debouncedRender() {
        if (this._renderTimeout) {
            clearTimeout(this._renderTimeout);
        }
        this._renderTimeout = setTimeout(() => {
            this._renderPreview();
        }, 16); // ~60fps
    }

    /**
     * Render preview
     */
    _renderPreview() {
        if (!this.engine || !this.hasProcessed || !this.isActive) return;

        // Render with engine
        const resultCanvas = this.engine.render();
        if (!resultCanvas) return;

        // Match canvas size
        const mainCanvas = this.ui.elements?.canvas || this.ui.gpu?.canvas;
        if (!mainCanvas) return;

        this.previewCanvas.width = mainCanvas.width;
        this.previewCanvas.height = mainCanvas.height;

        // Draw result
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        this.previewCtx.drawImage(resultCanvas, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }

    /**
     * Reset to default values
     */
    _resetToDefaults() {
        const defaults = {
            'relight-intensity': 100,
            'relight-ambient': 30,
            'relight-softness': 50,
            'relight-specularity': 50,
            'relight-glossiness': 32,
        };

        Object.entries(defaults).forEach(([id, value]) => {
            const slider = document.getElementById(`slider-${id}`);
            const valueEl = document.getElementById(`val-${id}`);
            if (slider) slider.value = value;
            if (valueEl) valueEl.textContent = value;
        });

        if (this.engine) {
            this.engine.setLightIntensity(1.0);
            this.engine.setAmbient(0.3);
            this.engine.setShadowSoftness(0.5);
            this.engine.setSpecularity(0.5);
            this.engine.setGlossiness(32);
            this.engine.setLightPosition(0.5, 0.3);
        }

        this._updateLightIndicator();
        this._debouncedRender();
    }

    /**
     * Apply effect to image
     */
    async _applyEffect() {
        if (!this.engine || !this.hasProcessed) {
            console.warn('No relighting result to apply');
            return;
        }

        // Get the preview result
        const resultCanvas = this.engine.render();
        if (!resultCanvas) return;

        // Load result back into GPU processor
        this.ui.gpu.loadImage(resultCanvas);

        // Hide preview
        this.previewCanvas.style.display = 'none';

        // Push to history
        if (this.ui._pushHistoryDebounced) {
            this.ui._pushHistoryDebounced();
        }

        // Reset for next use
        this.hasProcessed = false;
        this._updateDepthStatus();

        console.log('✅ Relighting v2 applied');
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.deactivate();

        if (this.engine) {
            this.engine.dispose();
            this.engine = null;
        }

        if (this.lightIndicator?.parentElement) {
            this.lightIndicator.parentElement.removeChild(this.lightIndicator);
        }

        if (this.previewCanvas?.parentElement) {
            this.previewCanvas.parentElement.removeChild(this.previewCanvas);
        }
    }
}

export default RelightingModule;
