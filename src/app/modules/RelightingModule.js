/**
 * RelightingModule.js - UI integration for 3D Relighting v7
 * 
 * Uses neural network-based depth/normal estimation:
 * - Transformers.js with Depth Anything V2
 * - Multi-scale normal fusion for improved detail
 * - Depth confidence maps for reliable lighting
 * - Linear color space albedo estimation
 * - DaVinci Resolve-quality relighting
 */

import { RelightingEngineV7 } from '../../relighting/v2/RelightingEngineV7.js';
import { NeuralEstimatorV7 } from '../../relighting/v2/NeuralEstimatorV7.js';

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
        this.directionIndicator = null; // Ray showing light direction

        // Canvas event handlers
        this._canvasClickHandler = null;
        this._canvasDragHandler = null;
        this._canvasUpHandler = null;
        this._isDragging = false;

        // Anchor-direction control state
        this._lightAnchor = null; // { x, y } - where user clicked (light source)
        this._isSettingDirection = false;

        // Render debounce
        this._renderTimeout = null;
        this._rafId = null; // requestAnimationFrame ID for smooth preview
        this._isInteracting = false; // True during drag for fast preview
        this._needsFullRender = false; // Flag to trigger full quality render on release

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
        this._initBlendModeSelect();
        this._createLightIndicator();
        this._createDirectionIndicator();
        this._createProgressBar();
        this._createPreviewCanvas();
        this._updateCacheStatus();

    }

    /**
     * Check and update cache status display
     */
    async _updateCacheStatus() {
        const status = await NeuralEstimatorV7.checkCacheStatus();
        const badge = document.getElementById('relight-cache-badge');
        const clearBtn = document.getElementById('btn-relight-clear-cache');

        if (badge) {
            if (status.cached) {
                badge.textContent = `✓ Model Cached (${status.size})`;
                badge.style.color = '#4ade80';
            } else {
                badge.textContent = '○ Model Not Cached';
                badge.style.color = 'var(--text-secondary)';
            }
        }

        if (clearBtn) {
            clearBtn.disabled = !status.cached;
            clearBtn.style.opacity = status.cached ? '1' : '0.5';
        }
    }

    /**
     * Clear the model cache
     */
    async _clearModelCache() {
        const clearBtn = document.getElementById('btn-relight-clear-cache');
        if (clearBtn) {
            clearBtn.disabled = true;
            clearBtn.textContent = 'Clearing...';
        }

        const success = await NeuralEstimatorV7.clearCache();

        if (success) {
            // Reset engine so it will re-download on next use
            if (this.engine) {
                this.engine.dispose();
                this.engine = null;
            }
        }

        if (clearBtn) {
            clearBtn.textContent = 'Clear Cache';
        }

        await this._updateCacheStatus();
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
            // Rim lighting controls (new)
            { id: 'relight-rim-intensity', param: 'rimIntensity', divisor: 100 },
            { id: 'relight-rim-width', param: 'rimWidth', divisor: 100 },
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
            case 'rimIntensity':
                this.engine.setRimIntensity(value);
                break;
            case 'rimWidth':
                this.engine.setRimWidth(value);
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
                break;
            case 'depth':
                // Use heightmap now (unified 3D surface)
                debugCanvas = this.engine.getDebugHeightMap();
                break;
            case 'lighting':
                debugCanvas = this.engine.getDebugLightingMap();
                break;
            case 'albedo':
                debugCanvas = this.engine.getDebugAlbedo();
                break;
            case 'result':
                this._renderPreview();
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
     * Create direction indicator (ray from light source)
     */
    _createDirectionIndicator() {
        this.directionIndicator = document.createElement('div');
        this.directionIndicator.id = 'relight-direction-indicator';
        this.directionIndicator.style.cssText = `
            position: absolute;
            width: 2px;
            height: 0px;
            background: linear-gradient(to bottom, #ffc832, transparent);
            pointer-events: none;
            z-index: 99;
            transform-origin: top center;
            display: none;
        `;

        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.appendChild(this.directionIndicator);
        }
    }

    /**
     * Initialize blend mode select dropdown
     */
    _initBlendModeSelect() {
        const blendSelect = document.getElementById('relight-blend-mode');
        if (!blendSelect) return;

        blendSelect.addEventListener('change', () => {
            if (this.engine) {
                this.engine.setBlendMode(blendSelect.value);
                this._debouncedRender();
            }
        });
    }

    /**
     * Update direction indicator position and angle
     */
    _updateDirectionIndicator(anchorX, anchorY, targetX, targetY) {
        if (!this.directionIndicator) return;

        const canvas = this.ui.gpu?.canvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const container = this.directionIndicator.parentElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();

        // Convert to pixel positions
        const ax = rect.left - containerRect.left + rect.width * anchorX;
        const ay = rect.top - containerRect.top + rect.height * anchorY;
        const tx = rect.left - containerRect.left + rect.width * targetX;
        const ty = rect.top - containerRect.top + rect.height * targetY;

        // Calculate length and angle
        const dx = tx - ax;
        const dy = ty - ay;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90; // +90 because we start pointing up

        this.directionIndicator.style.left = `${ax}px`;
        this.directionIndicator.style.top = `${ay}px`;
        this.directionIndicator.style.height = `${length}px`;
        this.directionIndicator.style.transform = `rotate(${angle}deg)`;
        this.directionIndicator.style.display = 'block';
    }

    _hideDirectionIndicator() {
        if (this.directionIndicator) {
            this.directionIndicator.style.display = 'none';
        }
    }

    /**
     * Create progress bar
     */
    _createProgressBar() {
        const panel = document.getElementById('panel-relight');
        if (!panel) return;

        if (document.getElementById('relight-progress-container')) return;

        // Create progress container
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
            <div style="height: 6px; background: var(--bg-secondary); border-radius: 3px; overflow: hidden;">
                <div id="relight-progress-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), #60a5fa); transition: width 0.15s ease-out;"></div>
            </div>
        `;

        // Create cache status container
        const cacheContainer = document.createElement('div');
        cacheContainer.id = 'relight-cache-container';
        cacheContainer.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: var(--bg-tertiary);
            border-radius: 8px;
            margin-bottom: 12px;
            font-size: 11px;
        `;
        cacheContainer.innerHTML = `
            <span id="relight-cache-badge" style="color: var(--text-secondary);">○ Checking cache...</span>
            <button id="btn-relight-clear-cache" class="btn" style="padding: 4px 8px; font-size: 10px; opacity: 0.5;" disabled>Clear Cache</button>
        `;

        // Insert into the first section of the panel (before the Estimate Depth button)
        const firstSection = panel.querySelector('.section');
        if (firstSection) {
            // Insert at the very beginning of the first section, after the header
            const sectionHeader = firstSection.querySelector('.section-header');
            if (sectionHeader && sectionHeader.nextSibling) {
                firstSection.insertBefore(cacheContainer, sectionHeader.nextSibling);
                firstSection.insertBefore(progressContainer, sectionHeader.nextSibling);
            } else {
                firstSection.insertBefore(cacheContainer, firstSection.firstChild);
                firstSection.insertBefore(progressContainer, firstSection.firstChild);
            }
        }

        // Add event listener for clear cache button
        const clearBtn = document.getElementById('btn-relight-clear-cache');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this._clearModelCache());
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
            this.engine = new RelightingEngineV7();
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

    }

    /**
     * Setup canvas click/drag for light position with anchor-direction control
     * - Click/mousedown: Sets the anchor point (light source position)
     * - Drag: Sets the direction the light is pointing
     */
    _setupCanvasEvents() {
        const canvas = this.ui.gpu?.canvas;
        if (!canvas) return;

        this._canvasClickHandler = (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;

            // Set anchor point (light source position)
            this._lightAnchor = { x, y };
            this._isDragging = true;
            this._isInteracting = true;
            this._isSettingDirection = false;

            if (this.engine) {
                this.engine.setLightPosition(x, y);
                this._updateLightIndicator();
                this._schedulePreviewRender();
            }
        };

        this._canvasDragHandler = (e) => {
            if (!this._isDragging || !this._lightAnchor) return;

            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;

            // Calculate direction from anchor to current mouse position
            const dx = x - this._lightAnchor.x;
            const dy = y - this._lightAnchor.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Only set direction if dragged far enough (threshold: 5% of canvas)
            if (dist > 0.05) {
                this._isSettingDirection = true;

                // Update direction indicator visual
                this._updateDirectionIndicator(this._lightAnchor.x, this._lightAnchor.y, x, y);

                // Set light direction based on drag (inverted - light points opposite to drag)
                if (this.engine) {
                    // The light direction is opposite to the drag direction
                    // We want light to shine FROM anchor TOWARD where user drags
                    const dirX = dx * 2;  // Scale for more noticeable effect
                    const dirY = -dy * 2; // Invert Y for screen coords
                    const dirZ = 1.0 - dist * 0.5; // Z decreases as we drag further (more angled light)

                    this.engine.setLightDirection(dirX, dirY, Math.max(0.3, dirZ));
                    this._schedulePreviewRender();
                }
            }
        };

        this._canvasUpHandler = () => {
            this._isDragging = false;
            this._isInteracting = false;

            // If we were setting direction, hide the indicator
            if (this._isSettingDirection) {
                this._hideDirectionIndicator();
            }
            this._isSettingDirection = false;

            // Trigger full quality render on release
            if (this._needsFullRender) {
                this._needsFullRender = false;
                this._renderPreview();
            }
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

        // Clean up state
        this._lightAnchor = null;
        this._isSettingDirection = false;
        this._hideDirectionIndicator();
    }

    /**
     * Handle light position from mouse event (legacy fallback)
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
        if (depthBtn) {
            depthBtn.disabled = true;
            depthBtn.textContent = 'Processing...';
        }

        try {
            this._updateProgress(0, 'Initializing...');

            // Initialize engine if not ready
            if (!this.engine || !this.engine.isReady) {
                this.engine = new RelightingEngineV7();

                // Model loading phase: 0-40%
                await this.engine.init((progress) => {
                    const modelPercent = (progress.progress || 0) * 0.4; // Scale to 0-40%
                    this._updateProgress(modelPercent, progress.message || 'Loading AI model...');
                });
            } else {
                // Engine already ready, skip model loading
                this._updateProgress(40, 'Model loaded from cache');
            }

            this._updateProgress(40, 'Preparing image...');

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

            // Estimation phase: 40-100% (progress callback maps estimator's 0-100 to our 40-100)
            const estimationCallback = (progress) => {
                const mappedPercent = 40 + (progress.progress * 0.6); // 40% to 100%
                this._updateProgress(mappedPercent, progress.message);
            };

            // Process with neural network engine
            const success = await this.engine.processImage(image, estimationCallback);

            if (!success) {
                throw new Error('Neural estimation failed');
            }

            this._updateProgress(100, 'Complete! ✓');

            this.hasProcessed = true;
            this._updateDepthStatus();
            this._updateCacheStatus(); // Update cache badge after successful run

            // Show preview
            this.previewCanvas.style.display = 'block';
            this._renderPreview();

            setTimeout(() => this._hideProgress(), 1500);

        } catch (error) {
            console.error('Neural estimation failed:', error);
            this._updateProgress(0, `Error: ${error.message}`);
            setTimeout(() => this._hideProgress(), 3000);
        } finally {
            this.isProcessing = false;
            if (depthBtn) {
                depthBtn.disabled = false;
                depthBtn.textContent = this.hasProcessed ? 'Re-estimate Depth' : 'Estimate Depth';
            }
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
     * Schedule preview render using RAF for smooth 60fps during interaction
     * This uses the GPU-optimized fast path
     */
    _schedulePreviewRender() {
        this._needsFullRender = true;

        // Skip if RAF already scheduled
        if (this._rafId) return;

        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._renderPreview();
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
