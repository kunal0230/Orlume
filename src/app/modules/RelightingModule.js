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

        // Parameter state tracking
        this.params = {
            intensity: 1.0,
            ambient: 0.2,
            reach: 1.0,
            contrast: 1.0,
            specularity: 0.5,
            glossiness: 0.5,
            rimIntensity: 0.5,
            rimWidth: 0.5,
            shadowIntensity: 0.8,
            shadowSoftness: 0.5,
            spotAngle: 45,
            spotSoftness: 0.2,
            sssIntensity: 0.0,
            lightHeight: 0.5,
            // v8: New parameters
            aoIntensity: 0.0,
            aoRadius: 10,
            roughness: 0.5,
            metallic: 0.0,
        };
        this.lightConfig = {
            color: { r: 1, g: 1, b: 1 },
            position: { x: 0.5, y: 0.5 },
            direction: { x: 0, y: 0, z: 1 },
            type: 'directional', // directional, point, spot
            blendMode: 'overlay'
        };
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
        this._createPreviewCanvas();
        this._createProgressBar();
        this._updateModelStatus();
    }

    // =========================================================================
    //  MODEL STATUS (State: 'idle' | 'ready')
    // =========================================================================

    /**
     * Update model status badge based on cache state
     */
    async _updateModelStatus() {
        const status = await NeuralEstimatorV7.checkCacheStatus();
        this._setModelStatus(status.cached ? 'ready' : 'idle', status.size);
    }

    /**
     * Set model status UI state
     * @param {'idle' | 'ready'} state
     * @param {string} size - Optional size string like "~97 MB"
     */
    _setModelStatus(state, size = '') {
        const statusIcon = document.getElementById('relight-status-icon');
        const statusText = document.getElementById('relight-status-text');
        const clearBtn = document.getElementById('btn-relight-clear-cache');
        const progressRow = document.getElementById('relight-progress-row');
        const firstTimeNote = document.getElementById('relight-first-time-note');

        // Hide progress bar when showing status
        if (progressRow) progressRow.style.display = 'none';

        if (state === 'ready') {
            // Cached/ready state - show database icon and green text
            if (statusIcon) {
                statusIcon.innerHTML = '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>';
                statusIcon.style.stroke = '#4ade80';
            }
            if (statusText) {
                statusText.textContent = size ? `AI Model Ready (${size})` : 'AI Model Ready';
                statusText.style.color = '#4ade80';
            }
            if (clearBtn) {
                clearBtn.style.display = 'block';
            }
            // Hide first-time note when cached
            if (firstTimeNote) firstTimeNote.style.display = 'none';
        } else {
            // Idle/not cached state - show download icon and secondary text
            if (statusIcon) {
                statusIcon.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
                statusIcon.style.stroke = 'var(--text-secondary)';
            }
            if (statusText) {
                statusText.textContent = 'AI Model Required';
                statusText.style.color = 'var(--text-secondary)';
            }
            if (clearBtn) {
                clearBtn.style.display = 'none';
            }
            // Show first-time note when model not cached
            if (firstTimeNote) firstTimeNote.style.display = 'block';
        }
    }

    /**
     * Clear model cache and reset to 'idle' state
     */
    async _clearModelCache() {
        const clearBtn = document.getElementById('btn-relight-clear-cache');
        const statusText = document.getElementById('relight-status-text');

        // Show clearing state
        if (clearBtn) clearBtn.disabled = true;
        if (statusText) statusText.textContent = 'Clearing cache...';

        // Clear the cache
        await NeuralEstimatorV7.clearCache();

        // Dispose engine so it re-downloads next time
        if (this.engine) {
            this.engine.dispose();
            this.engine = null;
        }

        // Immediately update UI to 'idle' state
        this._setModelStatus('idle');

        // Re-enable button (will be hidden by _setModelStatus)
        if (clearBtn) clearBtn.disabled = false;
    }

    /**
     * Initialize slider controls
     */
    _initSliders() {
        const sliders = [
            { id: 'relight-intensity', param: 'intensity', divisor: 100 },
            { id: 'relight-ambient', param: 'ambient', divisor: 100 },
            { id: 'relight-softness', param: 'reach', divisor: 1 },
            { id: 'relight-specularity', param: 'specularity', divisor: 100 },
            { id: 'relight-glossiness', param: 'glossiness', divisor: 1 },
            // Rim lighting
            { id: 'relight-rim-intensity', param: 'rimIntensity', divisor: 100 },
            { id: 'relight-rim-width', param: 'rimWidth', divisor: 100 },
            // Shadows
            { id: 'relight-shadow-intensity', param: 'shadowIntensity', divisor: 100 },
            { id: 'relight-shadow-softness', param: 'shadowSoftness', divisor: 100 },
            // Spotlight
            { id: 'relight-spot-angle', param: 'spotAngle', divisor: 1 },
            { id: 'relight-spot-softness', param: 'spotSoftness', divisor: 100 },
            // SSS
            { id: 'relight-sss-intensity', param: 'sssIntensity', divisor: 100 },
            // Light height
            { id: 'relight-height', param: 'lightHeight', divisor: 100 },
            // v8: Ambient Occlusion
            { id: 'relight-ao-intensity', param: 'aoIntensity', divisor: 100 },
            { id: 'relight-ao-radius', param: 'aoRadius', divisor: 1 },
            // v8: PBR
            { id: 'relight-roughness', param: 'roughness', divisor: 100 },
            { id: 'relight-metallic', param: 'metallic', divisor: 100 },
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

            // Push history on release
            slider.addEventListener('change', () => {
                this.ui._pushHistoryDebounced?.();
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
            case 'shadowIntensity':
                this.engine.setShadowIntensity(value);
                break;
            case 'shadowSoftness':
                this.engine.setShadowSoftness(value);
                break;
            case 'spotAngle':
                this.engine.setSpotAngle(value);
                break;
            case 'spotSoftness':
                this.engine.setSpotSoftness(value);
                break;
            case 'sssIntensity':
                this.engine.setSSSIntensity(value);
                break;
            case 'lightHeight':
                this.engine.setLightHeight(value);
                break;
            // v8: New parameters
            case 'aoIntensity':
                this.engine.setAOIntensity(value);
                break;
            case 'aoRadius':
                this.engine.setAORadius(value);
                break;
            case 'roughness':
                this.engine.setRoughness(value);
                break;
            case 'metallic':
                this.engine.setMetallic(value);
                break;
        }

        // Update local state
        this.params[param] = value;

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
                    this.lightConfig.type = 'directional';
                    this._debouncedRender();
                }
            });
        }

        if (pointBtn) {
            pointBtn.addEventListener('click', () => {
                if (this.engine) {
                    this.engine.setDirectional(false);
                    this.engine.setSpotlightEnabled(false);
                    pointBtn.classList.add('btn-primary');
                    if (directionalBtn) directionalBtn.classList.remove('btn-primary');
                    const spotBtn = document.getElementById('btn-light-spotlight');
                    if (spotBtn) spotBtn.classList.remove('btn-primary');
                    this._hideSpotlightControls();
                    this.lightConfig.type = 'point';
                    this._debouncedRender();
                }
            });
        }

        // Spotlight button
        const spotBtn = document.getElementById('btn-light-spotlight');
        const spotlightControls = document.getElementById('spotlight-controls');

        if (spotBtn) {
            spotBtn.addEventListener('click', () => {
                if (this.engine) {
                    this.engine.setDirectional(false);
                    this.engine.setSpotlightEnabled(true);
                    spotBtn.classList.add('btn-primary');
                    if (directionalBtn) directionalBtn.classList.remove('btn-primary');
                    if (pointBtn) pointBtn.classList.remove('btn-primary');
                    this._showSpotlightControls();
                    this.lightConfig.type = 'spot';
                    this._debouncedRender();
                }
            });
        }

        // Also update directional to hide spotlight controls
        if (directionalBtn) {
            const originalHandler = directionalBtn.onclick;
            directionalBtn.addEventListener('click', () => {
                this.engine?.setSpotlightEnabled(false);
                this._hideSpotlightControls();
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

        // Light color picker
        const colorPicker = document.getElementById('relight-color-picker');
        if (colorPicker) {
            colorPicker.addEventListener('input', () => {
                if (this.engine) {
                    const hex = colorPicker.value;
                    const r = parseInt(hex.slice(1, 3), 16) / 255;
                    const g = parseInt(hex.slice(3, 5), 16) / 255;
                    const b = parseInt(hex.slice(5, 7), 16) / 255;
                    this.engine.setLightColor(r, g, b);
                    this.lightConfig.color = { r, g, b };
                    this._debouncedRender();
                }
            });
        }

        // Light color presets
        document.querySelectorAll('[data-light-color]').forEach(btn => {
            btn.addEventListener('click', () => {
                const hex = btn.dataset.lightColor;
                if (colorPicker) colorPicker.value = hex;
                if (this.engine) {
                    const r = parseInt(hex.slice(1, 3), 16) / 255;
                    const g = parseInt(hex.slice(3, 5), 16) / 255;
                    const b = parseInt(hex.slice(5, 7), 16) / 255;
                    this.engine.setLightColor(r, g, b);
                    this.lightConfig.color = { r, g, b };
                    this._debouncedRender();
                }
            });
        });

        // Lighting presets
        this._initLightingPresets();

        // v8: Quality preset dropdown
        const qualityPreset = document.getElementById('relight-quality-preset');
        if (qualityPreset) {
            qualityPreset.addEventListener('change', () => {
                if (this.engine) {
                    const preset = qualityPreset.value;
                    this.engine.applyPreset(preset);
                    this._debouncedRender();
                }
            });
        }

        // v8: PBR toggle
        const pbrToggle = document.getElementById('btn-relight-pbr');
        if (pbrToggle) {
            pbrToggle.addEventListener('click', () => {
                if (this.engine) {
                    const isActive = pbrToggle.classList.toggle('btn-primary');
                    this.engine.setUsePBR(isActive);
                    this._debouncedRender();
                }
            });
        }

        // v8: GPU Shadows toggle  
        const gpuShadowsToggle = document.getElementById('btn-relight-gpu-shadows');
        if (gpuShadowsToggle) {
            gpuShadowsToggle.addEventListener('click', () => {
                if (this.engine) {
                    const isActive = gpuShadowsToggle.classList.toggle('btn-primary');
                    this.engine.setGPUShadows(isActive);
                    this._debouncedRender();
                }
            });
        }

        // v8: Shadow color picker
        const shadowColorPicker = document.getElementById('relight-shadow-color');
        if (shadowColorPicker) {
            shadowColorPicker.addEventListener('input', () => {
                if (this.engine) {
                    const hex = shadowColorPicker.value;
                    const r = parseInt(hex.slice(1, 3), 16) / 255;
                    const g = parseInt(hex.slice(3, 5), 16) / 255;
                    const b = parseInt(hex.slice(5, 7), 16) / 255;
                    this.engine.setShadowColor(r, g, b);
                    this._debouncedRender();
                }
            });
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
                this.lightConfig.blendMode = blendSelect.value;
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
     * Initialize progress bar and cache controls (HTML is static, just bind events)
     */
    _createProgressBar() {
        // Elements are now static in HTML, just bind the clear cache button
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

    // ==================== UNIFIED PROGRESS SYSTEM ====================

    /**
     * Show download progress in unified card
     * @param {number} sizeMB - Current downloaded size in MB
     * @param {number} totalMB - Total size in MB (optional, for showing percentage)
     */
    _showDownload(sizeMB, totalMB = 97) {
        const statusIcon = document.getElementById('relight-status-icon');
        const statusText = document.getElementById('relight-status-text');
        const progressRow = document.getElementById('relight-progress-row');
        const progressText = document.getElementById('relight-progress-text');
        const progressPercent = document.getElementById('relight-progress-percent');
        const progressBar = document.getElementById('relight-progress-bar');
        const clearBtn = document.getElementById('btn-relight-clear-cache');

        // Update status to downloading
        if (statusIcon) {
            statusIcon.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
            statusIcon.style.stroke = 'var(--accent)';
        }
        if (statusText) {
            statusText.textContent = 'Downloading AI Model...';
            statusText.style.color = 'var(--accent)';
        }
        if (clearBtn) clearBtn.style.display = 'none';

        // Show progress row
        if (progressRow) progressRow.style.display = 'block';
        if (progressText) progressText.textContent = `${sizeMB.toFixed(1)} MB / ~${totalMB} MB`;

        const percent = Math.min(100, (sizeMB / totalMB) * 100);
        if (progressPercent) progressPercent.textContent = `${Math.round(percent)}%`;
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
            progressBar.style.background = 'var(--accent)';
        }
    }

    /**
     * Hide download and transition to analysis phase
     */
    _hideDownload() {
        // No-op - progress bar stays visible for analysis phase
        // This method exists for API compatibility
    }

    /**
     * Update progress bar (0-100%)
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} text - Status message
     */
    _updateProgress(percent, text) {
        const statusIcon = document.getElementById('relight-status-icon');
        const statusText = document.getElementById('relight-status-text');
        const progressRow = document.getElementById('relight-progress-row');
        const progressBar = document.getElementById('relight-progress-bar');
        const progressPercent = document.getElementById('relight-progress-percent');
        const progressTextEl = document.getElementById('relight-progress-text');
        const clearBtn = document.getElementById('btn-relight-clear-cache');

        // Update status to analyzing
        if (statusIcon) {
            statusIcon.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>';
            statusIcon.style.stroke = 'var(--accent)';
        }
        if (statusText) {
            statusText.textContent = 'Analyzing Image...';
            statusText.style.color = 'var(--accent)';
        }
        if (clearBtn) clearBtn.style.display = 'none';

        // Show progress row
        if (progressRow) progressRow.style.display = 'block';
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${Math.round(percent)}%`;
        if (progressTextEl) progressTextEl.textContent = text;

        // Green color on completion
        if (percent >= 100 && progressBar) {
            progressBar.style.background = '#22c55e';
        }
    }

    /**
     * Show completion state then restore to ready
     */
    _showComplete() {
        this._updateProgress(100, 'Complete!');
        setTimeout(() => {
            this._hideProgress();
            this._updateModelStatus(); // Refresh to show cached state
        }, 800);
    }

    /**
     * Hide progress bar and reset
     */
    _hideProgress() {
        const progressRow = document.getElementById('relight-progress-row');
        const progressBar = document.getElementById('relight-progress-bar');

        if (progressRow) progressRow.style.display = 'none';
        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.style.background = 'var(--accent)';
        }
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
            if (!this.isActive) {
                console.debug('Relighting: Click ignored - not active');
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;

            console.debug(`Relighting: Light position set to (${x.toFixed(2)}, ${y.toFixed(2)})`);

            // Set anchor point (light source position)
            this._lightAnchor = { x, y };
            this._isDragging = true;
            this._isInteracting = true;
            this._isSettingDirection = false;

            if (this.engine) {
                this.engine.setLightPosition(x, y);
                this.lightConfig.position = { x, y };
                this._updateLightIndicator();
                this._renderPreview(); // Force immediate render
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
                    this.lightConfig.direction = { x: dirX, y: dirY, z: Math.max(0.3, dirZ) };
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
            this.lightConfig.position = { x, y };
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
            if (statusEl) statusEl.textContent = 'Surface map ready';
            if (depthBtn) depthBtn.textContent = 'Re-analyze Image';
        } else {
            if (statusEl) statusEl.textContent = 'Click "Analyze Image" to start';
            if (depthBtn) depthBtn.textContent = 'Analyze Image';
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
            // Check if engine is already ready (model cached)
            const modelAlreadyLoaded = this.engine && this.engine.isReady;

            if (!modelAlreadyLoaded) {
                // Model needs to be downloaded - show download progress
                this._showDownload(0, 97); // Initial state with estimated total
                this.engine = new RelightingEngineV7();
                await this.engine.init((progress) => {
                    // Show download size in MB (progress.loaded/total are in bytes)
                    if (progress.loaded && progress.total) {
                        const loadedMB = progress.loaded / (1024 * 1024);
                        const totalMB = progress.total / (1024 * 1024);
                        this._showDownload(loadedMB, totalMB);
                    }
                });
                this._hideDownload();
            }

            // Image processing: Simple 0-100% progress bar
            this._updateProgress(0, 'Preparing image...');

            // Get current image
            const imageData = this.ui.gpu.toImageData();
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageData.width;
            tempCanvas.height = imageData.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(imageData, 0, 0);

            this._updateProgress(5, 'Loading image...');

            // Create image from canvas
            const imageUrl = tempCanvas.toDataURL();
            const image = await this._loadImage(imageUrl);

            this._updateProgress(10, 'Starting analysis...');

            // Estimation phase: engine reports 0-100, we map to 10-95
            const estimationCallback = (progress) => {
                const mappedPercent = 10 + (progress.progress * 0.85); // 10% to 95%
                this._updateProgress(Math.min(95, mappedPercent), progress.message);
            };

            // Process with neural network engine
            const success = await this.engine.processImage(image, estimationCallback);

            if (!success) {
                throw new Error('Neural estimation failed');
            }

            // Show completion state (stops spinner, turns bar green, then hides)
            this._showComplete();

            this.hasProcessed = true;
            this._updateDepthStatus();
            this._updateModelStatus(); // Update cache badge after successful run

            // Show preview
            this.previewCanvas.style.display = 'block';
            this._renderPreview();

        } catch (error) {
            console.error('Neural estimation failed:', error);
            this._updateProgress(0, `Error: ${error.message}`);
            setTimeout(() => this._hideProgress(), 3000);
        } finally {
            this.isProcessing = false;
            if (depthBtn) {
                depthBtn.disabled = false;
                depthBtn.textContent = this.hasProcessed ? 'Re-analyze Image' : 'Analyze Image';
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
            'relight-intensity': 80,
            'relight-ambient': 15,
            'relight-softness': 50,
            'relight-specularity': 0,
            'relight-glossiness': 32,
            'relight-height': 50,
            'relight-rim-intensity': 0,
            'relight-rim-width': 50,
        };

        Object.entries(defaults).forEach(([id, value]) => {
            const slider = document.getElementById(`slider-${id}`);
            const valueEl = document.getElementById(`val-${id}`);
            if (slider) slider.value = value;
            if (valueEl) valueEl.textContent = value;
        });

        if (this.engine) {
            this.engine.setLightIntensity(0.8);
            this.engine.setAmbient(0.15);
            this.engine.setReach(50);
            this.engine.setSpecularity(0.0);
            this.engine.setGlossiness(32);
            this.engine.setLightPosition(0.5, 0.5);
            this.engine.setRimIntensity(0.0);
            this.engine.setShadowEnabled(false);
        }

        this._updateLightIndicator();
        this._debouncedRender();
    }

    /**
     * Show spotlight controls section
     */
    _showSpotlightControls() {
        const controls = document.getElementById('spotlight-controls');
        if (controls) controls.style.display = 'block';
    }

    /**
     * Hide spotlight controls section
     */
    _hideSpotlightControls() {
        const controls = document.getElementById('spotlight-controls');
        if (controls) controls.style.display = 'none';
    }

    /**
     * Initialize lighting presets
     */
    _initLightingPresets() {
        const presets = {
            'preset-natural': {
                intensity: 0.8,
                ambient: 0.2,
                position: { x: 0.6, y: 0.4 },
                color: { r: 1.0, g: 0.98, b: 0.95 },
                rimIntensity: 0.0,
                shadowEnabled: false,
                isSpotlight: false
            },
            'preset-studio': {
                intensity: 1.0,
                ambient: 0.15,
                position: { x: 0.3, y: 0.3 },
                color: { r: 1.0, g: 1.0, b: 1.0 },
                rimIntensity: 0.3,
                shadowEnabled: true,
                isSpotlight: false
            },
            'preset-dramatic': {
                intensity: 1.2,
                ambient: 0.05,
                position: { x: 0.1, y: 0.5 },
                color: { r: 1.0, g: 0.9, b: 0.8 },
                rimIntensity: 0.0,
                shadowEnabled: true,
                isSpotlight: false
            },
            'preset-backlit': {
                intensity: 0.6,
                ambient: 0.3,
                position: { x: 0.5, y: 0.2 },
                color: { r: 1.0, g: 0.95, b: 0.85 },
                rimIntensity: 0.8,
                shadowEnabled: false,
                isSpotlight: false
            }
        };

        Object.entries(presets).forEach(([id, settings]) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => {
                    if (!this.engine) return;

                    // Apply preset settings
                    this.engine.setLightIntensity(settings.intensity);
                    this.engine.setAmbient(settings.ambient);
                    this.engine.setLightPosition(settings.position.x, settings.position.y);
                    this.engine.setLightColor(settings.color.r, settings.color.g, settings.color.b);
                    this.engine.setRimIntensity(settings.rimIntensity);
                    this.engine.setShadowEnabled(settings.shadowEnabled);
                    this.engine.setSpotlightEnabled(settings.isSpotlight);

                    // Update UI sliders
                    this._updateSliderUI('relight-intensity', settings.intensity * 100);
                    this._updateSliderUI('relight-ambient', settings.ambient * 100);
                    this._updateSliderUI('relight-rim-intensity', settings.rimIntensity * 100);

                    // Update light indicator and render
                    this._updateLightIndicator();
                    this._debouncedRender();
                });
            }
        });
    }

    /**
     * Update slider UI value
     */
    _updateSliderUI(id, value) {
        const slider = document.getElementById(`slider-${id}`);
        const valueEl = document.getElementById(`val-${id}`);
        if (slider) slider.value = value;
        if (valueEl) valueEl.textContent = Math.round(value);
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
    /**
     * Get current state for history
     */
    getState() {
        return {
            isActive: this.isActive,
            params: { ...this.params },
            lightConfig: JSON.parse(JSON.stringify(this.lightConfig))
        };
    }

    /**
     * Set state from history
     */
    setState(state) {
        if (!state) return;

        try {
            // Helper to apply params once engine is ready
            const applyParams = () => {
                try {
                    if (!this.engine) return;

                    // Restore params
                    if (state.params) {
                        this.params = { ...state.params };

                        // Apply all params to engine
                        this.engine.setLightIntensity(this.params.intensity);
                        this.engine.setAmbient(this.params.ambient);
                        this.engine.setReach(this.params.reach);
                        this.engine.setContrast(this.params.contrast);
                        this.engine.setSpecularity(this.params.specularity);
                        this.engine.setGlossiness(this.params.glossiness);
                        this.engine.setRimIntensity(this.params.rimIntensity);
                        this.engine.setRimWidth(this.params.rimWidth);
                        this.engine.setShadowIntensity(this.params.shadowIntensity);
                        this.engine.setShadowSoftness(this.params.shadowSoftness);
                        this.engine.setSpotAngle(this.params.spotAngle);
                        this.engine.setSpotSoftness(this.params.spotSoftness);
                        this.engine.setSSSIntensity(this.params.sssIntensity);
                        this.engine.setLightHeight(this.params.lightHeight);

                        // Re-sync UI sliders
                        this._syncSliders();
                    }

                    // Restore light config
                    if (state.lightConfig) {
                        this.lightConfig = JSON.parse(JSON.stringify(state.lightConfig));

                        // Apply light config
                        if (this.lightConfig.color) {
                            const { r, g, b } = this.lightConfig.color;
                            this.engine.setLightColor(r, g, b);

                            // Update color picker UI
                            const toHex = (c) => {
                                const hex = Math.round(c * 255).toString(16);
                                return hex.length === 1 ? '0' + hex : hex;
                            };
                            const hexColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                            const picker = document.getElementById('relight-color-picker');
                            if (picker) picker.value = hexColor;
                        }

                        if (this.lightConfig.position) {
                            this.engine.setLightPosition(this.lightConfig.position.x, this.lightConfig.position.y);
                            this._updateLightIndicator();
                        }

                        if (this.lightConfig.direction) {
                            this.engine.setLightDirection(
                                this.lightConfig.direction.x,
                                this.lightConfig.direction.y,
                                this.lightConfig.direction.z
                            );
                        }

                        if (this.lightConfig.type) {
                            if (this.lightConfig.type === 'directional') {
                                this.engine.setDirectional(true);
                                this._hideSpotlightControls();
                            } else if (this.lightConfig.type === 'point') {
                                this.engine.setDirectional(false);
                                this.engine.setSpotlightEnabled(false);
                                this._hideSpotlightControls();
                            } else if (this.lightConfig.type === 'spot') {
                                this.engine.setDirectional(false);
                                this.engine.setSpotlightEnabled(true);
                                this._showSpotlightControls();
                            }
                            this._updateLightTypeUI();
                        }

                        if (this.lightConfig.blendMode) {
                            this.engine.setBlendMode(this.lightConfig.blendMode);
                            const blendSelect = document.getElementById('relight-blend-mode');
                            if (blendSelect) blendSelect.value = this.lightConfig.blendMode;
                        }
                    }

                    this._debouncedRender();
                } catch (err) {
                    console.error('Error applying relighting params:', err);
                }
            };

            // Restore active state
            if (state.isActive && !this.isActive) {
                // activate() is likely async, so chain the param application
                Promise.resolve(this.activate())
                    .then(() => applyParams())
                    .catch(err => console.error('Error activating relighting module during undo:', err));
            } else if (!state.isActive && this.isActive) {
                this.deactivate();
                // No need to apply params if deactivating
            } else {
                // Already active or inactive, just apply params
                applyParams();
            }
        } catch (e) {
            console.warn('Failed to restore Relighting state:', e);
        }
    }

    /**
     * Sync sliders with current params
     */
    _syncSliders() {
        const paramToId = {
            intensity: 'relight-intensity',
            ambient: 'relight-ambient',
            reach: 'relight-softness', // mapped from code
            specularity: 'relight-specularity',
            glossiness: 'relight-glossiness',
            rimIntensity: 'relight-rim-intensity',
            rimWidth: 'relight-rim-width',
            shadowIntensity: 'relight-shadow-intensity',
            shadowSoftness: 'relight-shadow-softness',
            spotAngle: 'relight-spot-angle',
            spotSoftness: 'relight-spot-softness',
            sssIntensity: 'relight-sss-intensity',
            lightHeight: 'relight-height'
        };

        const divisors = {
            intensity: 100, ambient: 100, reach: 1, specularity: 100, glossiness: 1,
            rimIntensity: 100, rimWidth: 100, shadowIntensity: 100, shadowSoftness: 100,
            spotAngle: 1, spotSoftness: 100, sssIntensity: 100, lightHeight: 100
        };

        for (const [param, id] of Object.entries(paramToId)) {
            const val = this.params[param];
            if (val !== undefined) {
                const slider = document.getElementById(`slider-${id}`);
                const valEl = document.getElementById(`val-${id}`);
                if (slider) {
                    const divisor = divisors[param] || 1;
                    slider.value = val * divisor;
                    if (valEl) valEl.textContent = val * divisor; // display value is usually scaled
                }
            }
        }
    }

    /**
     * Update Light Type button UI state
     */
    _updateLightTypeUI() {
        const type = this.lightConfig.type;
        const directionalBtn = document.getElementById('btn-light-directional');
        const pointBtn = document.getElementById('btn-light-point');
        const spotBtn = document.getElementById('btn-light-spotlight');

        if (directionalBtn) directionalBtn.classList.toggle('btn-primary', type === 'directional');
        if (pointBtn) pointBtn.classList.toggle('btn-primary', type === 'point');
        if (spotBtn) spotBtn.classList.toggle('btn-primary', type === 'spot');
    }
}

export default RelightingModule;
