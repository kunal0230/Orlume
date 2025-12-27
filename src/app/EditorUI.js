/**
 * EditorUI - UI management for the GPU Editor
 * Handles all DOM interactions, event bindings, and UI updates
 */
import { HistoryManager } from './HistoryManager.js';
import { ImageUpscaler } from '../ml/ImageUpscaler.js';

// Modular components
import { HistoryModule, ZoomPanModule, ExportModule, CropModule, LiquifyModule, HealingModule } from './modules/index.js';

export class EditorUI {
    constructor(state, gpu, masks) {
        this.state = state;
        this.gpu = gpu;
        this.masks = masks;

        // Cache DOM elements
        this.elements = {
            canvas: document.getElementById('gpu-canvas'),
            dropZone: document.getElementById('drop-zone'),
            fileInput: document.getElementById('file-input'),
            perfIndicator: document.getElementById('perf'),
            beforeIndicator: document.getElementById('before-indicator'),
            histogramCanvas: document.getElementById('histogram-canvas'),
            brushCursor: document.getElementById('brush-cursor'),
            brushPreviewCircle: document.getElementById('brush-preview-circle'),
            brushSizeIndicator: document.getElementById('brush-size-indicator')
        };

        this.histogramCtx = this.elements.histogramCanvas?.getContext('2d');

        // Slider lists
        this.globalSliders = [
            'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
            'temperature', 'tint', 'vibrance', 'saturation'
        ];

        this.maskSliders = ['exposure', 'contrast', 'shadows', 'temperature', 'saturation'];

        // Initialize undo/redo history manager
        this.history = new HistoryManager(50);
        this._historyDebounceTimer = null;

        // Initialize modular components
        this.historyModule = new HistoryModule(this);
        this.zoomPanModule = new ZoomPanModule(this);
        this.exportModule = new ExportModule(this);
        this.cropModule = new CropModule(this);
        this.liquifyModule = new LiquifyModule(this);
        this.healingModule = new HealingModule(this);

        // Expose zoom state from module for backward compatibility
        this.zoom = this.zoomPanModule.zoom;

        // Expose crop tool from module for backward compatibility
        this.cropTool = null; // Will be set when cropModule.activate() is called
        this.appliedCrop = null;

        // Expose liquify tool from module for backward compatibility
        this.liquifyTool = null; // Will be set when liquifyModule.init() is called
        this.liquifyCanvas = null;

        // Expose healing tool from module for backward compatibility
        this.healingTool = null; // Will be set when healingModule.init() is called
        this.healingCanvas = null;
        this.replicate = null;

        // Comparison slider state
        this.comparison = {
            active: false,
            position: 50  // percentage from left
        };

        this._initEventListeners();
    }

    /**
     * Initialize all event listeners
     */
    _initEventListeners() {
        this._initPanelTabs();
        this._initToolButtons();
        this._initGlobalSliders();
        this._initMaskSliders();
        this._initBrushControls();
        this._initCanvasEvents();
        this._initKeyboardShortcuts();
        this._initFileHandling();
        this._initActionButtons();

        // Initialize modular components
        this.zoomPanModule.init();
        this.cropModule.init();
        this.liquifyModule.init();
        this.healingModule.init();

        // Sync tool references for backward compatibility
        this.liquifyTool = this.liquifyModule.liquifyTool;
        this.liquifyCanvas = this.liquifyModule.liquifyCanvas;
        this.healingTool = this.healingModule.healingTool;
        this.healingCanvas = this.healingModule.healingCanvas;
        this.replicate = this.healingModule.replicate;

        this._initComparisonSlider();
        this._initUpscaleControls();
    }

    /**
     * Panel tab switching
     */
    _initPanelTabs() {
        // Develop mode panel tabs (Develop / Masks)
        document.querySelectorAll('#develop-mode-tabs .panel-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Only switch tabs within develop mode
                document.querySelectorAll('#develop-mode-tabs .panel-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Show the corresponding panel
                const panelId = tab.dataset.panel;
                document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));
                document.getElementById(`panel-${panelId}`)?.classList.add('active');
            });
        });

        // Mask tool buttons within Masks panel
        document.querySelectorAll('.mask-tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const toolId = btn.id.replace('mask-tool-', '');
                this.setMaskTool(toolId);
            });
        });
    }

    /**
     * Tool button handling - main mode switches
     */
    _initToolButtons() {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const toolId = btn.id.replace('tool-', '');
                this.setMode(toolId);
            });
        });
    }

    /**
     * Set active mode (develop, 3d, export, crop)
     */
    setMode(mode) {
        const previousMode = this.state.currentTool;

        // Deactivate crop tool and clear transform preview if leaving crop mode
        if (previousMode === 'crop' && mode !== 'crop') {
            this.cropTool?.deactivate();
            this._clearTransformPreview();
        }

        // Disable relighting when leaving 3d mode to clean up light indicators
        if (previousMode === '3d' && mode !== '3d') {
            if (this.app?.relighting) {
                this.app.relighting.disableRelight();
            }
        }

        // Deactivate liquify tool when leaving liquify mode
        if (previousMode === 'liquify' && mode !== 'liquify') {
            this._deactivateLiquifyTool();
        }

        // Deactivate healing tool when leaving healing mode
        if (previousMode === 'healing' && mode !== 'healing') {
            this._deactivateHealingTool();
        }

        this.state.setTool(mode);

        // Update toolbar button UI
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tool-${mode}`)?.classList.add('active');

        // Hide all mode headers
        document.getElementById('develop-mode-tabs').style.display = 'none';
        document.getElementById('3d-mode-header').style.display = 'none';
        document.getElementById('export-mode-header').style.display = 'none';
        document.getElementById('crop-mode-header').style.display = 'none';
        document.getElementById('upscale-mode-header').style.display = 'none';
        document.getElementById('liquify-mode-header').style.display = 'none';
        document.getElementById('healing-mode-header').style.display = 'none';

        // Hide all panels
        document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));

        // Hide brush cursor by default
        this.elements.brushCursor.style.display = 'none';

        switch (mode) {
            case 'develop':
                document.getElementById('develop-mode-tabs').style.display = 'flex';
                document.getElementById('panel-develop').classList.add('active');
                break;

            case '3d':
                document.getElementById('3d-mode-header').style.display = 'block';
                document.getElementById('panel-relight').classList.add('active');
                break;

            case 'export':
                document.getElementById('export-mode-header').style.display = 'block';
                document.getElementById('panel-export').classList.add('active');
                // Estimate file size when entering export mode
                setTimeout(() => this.estimateFileSize(), 100);
                break;

            case 'crop':
                document.getElementById('crop-mode-header').style.display = 'block';
                document.getElementById('panel-crop').classList.add('active');
                // Initialize and activate crop tool
                this._activateCropTool();
                break;

            case 'upscale':
                document.getElementById('upscale-mode-header').style.display = 'block';
                document.getElementById('panel-upscale').classList.add('active');
                // Update dimensions display
                this._updateUpscaleDimensions();
                break;

            case 'liquify':
                document.getElementById('liquify-mode-header').style.display = 'block';
                document.getElementById('panel-liquify').classList.add('active');
                // Activate liquify tool
                this._activateLiquifyTool();
                break;

            case 'healing':
                document.getElementById('healing-mode-header').style.display = 'block';
                document.getElementById('panel-healing').classList.add('active');
                // Activate healing tool
                this._activateHealingTool();
                break;
        }
    }

    /**
     * Set active mask tool (brush, radial, gradient)
     */
    setMaskTool(tool) {
        // Update mask tool button UI
        document.querySelectorAll('.mask-tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`mask-tool-${tool}`)?.classList.add('active');

        // Show/hide brush settings and adjustments based on tool
        const brushSettings = document.getElementById('brush-settings');
        const maskAdjustments = document.getElementById('mask-adjustments');

        if (tool === 'brush') {
            this.state.setTool('brush');
            brushSettings.style.display = 'block';
            maskAdjustments.style.display = 'block';
            this.elements.brushCursor.style.display = 'block';
        } else if (tool === 'radial') {
            this.state.setTool('radial');
            brushSettings.style.display = 'none';
            maskAdjustments.style.display = 'block';
            this.elements.brushCursor.style.display = 'none';
        } else if (tool === 'gradient') {
            this.state.setTool('gradient');
            brushSettings.style.display = 'none';
            maskAdjustments.style.display = 'block';
            this.elements.brushCursor.style.display = 'none';
        }

        // Create a new layer if none exists
        if (this.masks.layers.length === 0) {
            this.masks.createBrushLayer(`${tool.charAt(0).toUpperCase() + tool.slice(1)} Mask 1`);
            this._updateLayerList();
        }
    }

    /**
     * Legacy setTool for backward compatibility with keyboard shortcuts
     */
    setTool(tool) {
        if (['develop', '3d', 'export', 'crop', 'upscale', 'liquify'].includes(tool)) {
            this.setMode(tool);
        } else if (['brush', 'radial', 'gradient'].includes(tool)) {
            // Switch to develop mode and masks tab, then select the tool
            this.setMode('develop');
            document.querySelector('#develop-mode-tabs [data-panel="masks"]')?.click();
            this.setMaskTool(tool);
        }
    }

    /**
     * Initialize global adjustment sliders
     */
    _initGlobalSliders() {
        // Push initial state to history when initialized
        this._pushHistoryDebounced();

        this.globalSliders.forEach(name => {
            const slider = document.getElementById(`slider-${name}`);
            const valueDisplay = document.getElementById(`val-${name}`);
            if (!slider) return;

            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                valueDisplay.textContent = name === 'exposure' ? value.toFixed(2) : Math.round(value);
                this.state.setAdjustment(name, value);

                const start = performance.now();
                this.gpu.setParam(name, value);
                const elapsed = performance.now() - start;
                this.elements.perfIndicator.textContent = `${elapsed.toFixed(1)}ms`;

                requestAnimationFrame(() => this.renderHistogram());
            });

            // Push to history when slider is released
            slider.addEventListener('change', () => {
                this._pushHistoryDebounced();
            });

            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                valueDisplay.textContent = name === 'exposure' ? '0.00' : '0';
                this.gpu.setParam(name, 0);
                this.state.setAdjustment(name, 0);
                requestAnimationFrame(() => this.renderHistogram());
                this._pushHistoryDebounced();
            });
        });
    }

    /**
     * Initialize mask adjustment sliders
     */
    _initMaskSliders() {
        this.maskSliders.forEach(name => {
            const slider = document.getElementById(`slider-mask-${name}`);
            const valueDisplay = document.getElementById(`val-mask-${name}`);
            if (!slider) return;

            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                valueDisplay.textContent = name === 'exposure' ? value.toFixed(2) : Math.round(value);
                this.masks.setActiveAdjustment(name, value);
                this.renderWithMask(false);
            });

            // Push to history when mask slider is released
            slider.addEventListener('change', () => {
                this._pushHistoryDebounced();
            });

            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                valueDisplay.textContent = name === 'exposure' ? '0.00' : '0';
                this.masks.setActiveAdjustment(name, 0);
                this.renderWithMask(false);
                this._pushHistoryDebounced();
            });
        });
    }

    /**
     * Initialize brush controls
     */
    _initBrushControls() {
        // Brush size slider
        const brushSizeSlider = document.getElementById('slider-brush-size');
        if (brushSizeSlider) {
            brushSizeSlider.addEventListener('input', () => {
                const size = parseInt(brushSizeSlider.value);
                document.getElementById('val-brush-size').textContent = size;
                this.masks.brushSettings.size = size;
                this.state.setBrushSetting('size', size);
                this.updateBrushCursor();
                this.updateBrushSizeIndicator(size);
            });
        }

        // Brush hardness slider
        const brushHardnessSlider = document.getElementById('slider-brush-hardness');
        if (brushHardnessSlider) {
            brushHardnessSlider.addEventListener('input', () => {
                const hardness = parseInt(brushHardnessSlider.value);
                document.getElementById('val-brush-hardness').textContent = hardness;
                this.masks.brushSettings.hardness = hardness / 100;
                this.state.setBrushSetting('hardness', hardness);
                this.updateBrushPreview();
            });
        }

        // Brush opacity slider
        const brushOpacitySlider = document.getElementById('slider-brush-opacity');
        if (brushOpacitySlider) {
            brushOpacitySlider.addEventListener('input', () => {
                const opacity = parseInt(brushOpacitySlider.value);
                document.getElementById('val-brush-opacity').textContent = opacity;
                this.masks.brushSettings.opacity = opacity / 100;
                this.state.setBrushSetting('opacity', opacity);
                this.updateBrushPreview();
            });
        }

        // Brush mode buttons
        const btnAdd = document.getElementById('btn-brush-add');
        const btnErase = document.getElementById('btn-brush-erase');

        if (btnAdd) {
            btnAdd.addEventListener('click', () => this.setBrushMode(false));
        }
        if (btnErase) {
            btnErase.addEventListener('click', () => this.setBrushMode(true));
        }

        // New layer button
        const btnNewLayer = document.getElementById('btn-new-layer');
        if (btnNewLayer) {
            btnNewLayer.addEventListener('click', () => {
                this.masks.createLayer('brush');
                this.updateLayersList();
                this.syncLayerUI();
                this.setTool('brush');
            });
        }
    }

    /**
     * @deprecated Handled by cropModule.init()
     */
    _initCropControls() {
        // Now delegated to cropModule.init()
    }

    /**
     * Apply real-time CSS transform preview for rotation and flip
     */
    _applyTransformPreview() {
        this.cropModule._applyTransformPreview();
    }

    /**
     * Clear transform preview (reset CSS transform)
     */
    _clearTransformPreview() {
        this.cropModule._clearTransformPreview();
    }

    /**
     * @deprecated Handled by cropModule
     */
    _initCropDimensionsInput() {
        // Now delegated to cropModule
    }

    /**
     * Activate crop tool and show overlay
     */
    _activateCropTool() {
        this.cropModule.activate();
        // Sync cropTool reference for backward compatibility
        this.cropTool = this.cropModule.cropTool;
    }

    /**
     * Apply crop to image
     */
    applyCrop() {
        this.cropModule.applyCrop();
        // Sync appliedCrop for backward compatibility
        this.appliedCrop = this.cropModule.appliedCrop;
    }

    /**
     * Cancel crop and reset (stay in crop mode)
     */
    cancelCrop() {
        this.cropModule.cancelCrop();
    }

    /**
     * Perform the actual crop operation with rotation and flip
     * @deprecated Use cropModule._performCrop instead
     */
    _performCrop(cropData) {
        this.cropModule._performCrop(cropData);
    }

    /**
     * Update crop dimensions display in panel
     */
    _updateCropDimensionsDisplay() {
        this.cropModule._updateCropDimensionsDisplay();
    }

    /**
     * Set brush mode (add/erase)
     */
    setBrushMode(erase) {
        this.masks.brushSettings.erase = erase;
        this.state.setBrushSetting('erase', erase);

        const btnAdd = document.getElementById('btn-brush-add');
        const btnErase = document.getElementById('btn-brush-erase');

        if (erase) {
            btnAdd?.classList.remove('active');
            btnErase?.classList.add('active');
        } else {
            btnAdd?.classList.add('active');
            btnErase?.classList.remove('active');
        }
    }

    /**
     * Initialize canvas events for painting
     */
    _initCanvasEvents() {
        const canvasArea = document.querySelector('.canvas-area');
        const canvas = this.elements.canvas;

        if (canvasArea) {
            canvasArea.addEventListener('mousemove', (e) => {
                this.updateBrushCursorPosition(e);

                if (this.state.isPainting) {
                    const rect = canvas.getBoundingClientRect();
                    const x = (e.clientX - rect.left) * (this.gpu.width / rect.width);
                    const y = (e.clientY - rect.top) * (this.gpu.height / rect.height);

                    if (this.state.lastPaintPos) {
                        this.masks.paintStroke(this.state.lastPaintPos.x, this.state.lastPaintPos.y, x, y);
                    } else {
                        this.masks.paintBrush(x, y);
                    }
                    this.state.updatePaintPos({ x, y });
                    this.renderWithMask(true);
                }
            });
        }

        if (canvas) {
            canvas.addEventListener('mousedown', (e) => {
                if (this.state.currentTool !== 'brush') return;
                if (this.masks.activeLayerIndex < 0) {
                    this.masks.createLayer('brush');
                    this.updateLayersList();
                    this.syncLayerUI();
                }

                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (this.gpu.width / rect.width);
                const y = (e.clientY - rect.top) * (this.gpu.height / rect.height);

                this.state.setPainting(true, { x, y });
                this.masks.paintBrush(x, y);
                this.renderWithMask(true);
            });

            canvas.addEventListener('mouseup', () => {
                this.state.setPainting(false, null);
                if (this.state.hasImage) {
                    this.renderWithMask(false);
                }
            });

            canvas.addEventListener('mouseleave', () => {
                if (this.state.isPainting) {
                    this.state.setPainting(false, null);
                    this.renderWithMask(false);
                }
            });
        }
    }

    /**
     * Initialize keyboard shortcuts
     */
    _initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ignore shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            if (e.code === 'Space' && !this.state.showingBefore && this.state.hasImage) {
                e.preventDefault();
                this.state.showingBefore = true;
                this.elements.beforeIndicator?.classList.add('visible');
                this.gpu.renderOriginal(this.state.originalImage);
            }
            if (e.code === 'KeyD') this.setTool('develop');
            if (e.code === 'KeyB') this.setTool('brush');
            if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) this.setTool('radial');
            if (e.code === 'KeyG') this.setTool('gradient');
            if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) this.setTool('crop');
            if (e.code === 'KeyE' && !e.metaKey && !e.ctrlKey) this.setTool('export');
            if (e.code === 'KeyU' && !e.metaKey && !e.ctrlKey) this.setTool('upscale');
            if (e.code === 'KeyW' && !e.metaKey && !e.ctrlKey) this.setTool('liquify');
            if (e.code === 'KeyH' && !e.metaKey && !e.ctrlKey) this.setTool('healing');
            if (e.code === 'KeyX' && this.state.currentTool === 'brush') {
                this.setBrushMode(!this.masks.brushSettings.erase);
            }
            if (e.code === 'BracketLeft') {
                this.adjustBrushSize(-10);
            }
            if (e.code === 'BracketRight') {
                this.adjustBrushSize(10);
            }

            // Show keyboard shortcuts modal with ? key
            if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
                e.preventDefault();
                this.toggleShortcutsModal(true);
            }

            // Close modal with Escape (or cancel crop if in crop mode)
            if (e.code === 'Escape') {
                if (this.state.currentTool === 'crop') {
                    e.preventDefault();
                    this.cancelCrop();
                } else {
                    this.toggleShortcutsModal(false);
                }
            }

            // Apply crop with Enter when in crop mode
            if (e.code === 'Enter' && this.state.currentTool === 'crop') {
                e.preventDefault();
                this.applyCrop();
            }

            // Export with Ctrl/Cmd + E
            if ((e.metaKey || e.ctrlKey) && e.code === 'KeyE') {
                e.preventDefault();
                this.exportImage();
            }

            // Undo with Ctrl/Cmd + Z
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ') {
                e.preventDefault();
                this.undo();
            }

            // Redo with Ctrl/Cmd + Shift + Z
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyZ') {
                e.preventDefault();
                this.redo();
            }

            // Toggle Before/After comparison with backslash
            if (e.code === 'Backslash' && this.state.hasImage) {
                e.preventDefault();
                this.toggleComparison();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && this.state.showingBefore) {
                this.state.showingBefore = false;
                this.elements.beforeIndicator?.classList.remove('visible');
                this.gpu.render();
            }
        });

        // Shortcuts modal close button
        const shortcutsClose = document.getElementById('shortcuts-close');
        if (shortcutsClose) {
            shortcutsClose.addEventListener('click', () => this.toggleShortcutsModal(false));
        }

        // Close modal on backdrop click
        const shortcutsModal = document.getElementById('shortcuts-modal');
        if (shortcutsModal) {
            shortcutsModal.addEventListener('click', (e) => {
                if (e.target === shortcutsModal) {
                    this.toggleShortcutsModal(false);
                }
            });
        }
    }

    /**
     * Toggle keyboard shortcuts modal
     */
    toggleShortcutsModal(show) {
        const modal = document.getElementById('shortcuts-modal');
        if (modal) {
            modal.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Adjust brush size by delta
     */
    adjustBrushSize(delta) {
        const brushSizeSlider = document.getElementById('slider-brush-size');
        this.masks.brushSettings.size = Math.max(1, Math.min(500, this.masks.brushSettings.size + delta));
        if (brushSizeSlider) brushSizeSlider.value = this.masks.brushSettings.size;
        document.getElementById('val-brush-size').textContent = this.masks.brushSettings.size;
        this.updateBrushCursor();
        this.updateBrushSizeIndicator(this.masks.brushSettings.size);
    }

    /**
     * Initialize zoom controls UI at bottom center of canvas
     */
    _initZoomControls() {
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        // Create zoom controls container
        const zoomControls = document.createElement('div');
        zoomControls.className = 'zoom-controls';
        zoomControls.id = 'zoom-controls';
        zoomControls.innerHTML = `
            <button class="zoom-btn" id="btn-zoom-out" title="Zoom Out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </button>
            <span class="zoom-level" id="zoom-level">100%</span>
            <button class="zoom-btn" id="btn-zoom-in" title="Zoom In">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </button>
            <button class="zoom-btn zoom-btn-text" id="btn-zoom-fit" title="Fit to View">Fit</button>
        `;

        canvasArea.appendChild(zoomControls);

        // Bind button events
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.zoomOut());
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.zoomIn());
        document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.resetZoom());
    }

    /**
     * Initialize zoom events (Ctrl/Cmd + scroll)
     */
    _initZoomEvents() {
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        canvasArea.addEventListener('wheel', (e) => {
            // Only trigger zoom when Ctrl (Windows/Linux) or Cmd (Mac) is held
            if (!e.ctrlKey && !e.metaKey) return;

            e.preventDefault();

            // Determine zoom direction based on scroll
            const delta = e.deltaY < 0 ? this.zoom.step : -this.zoom.step;
            const newLevel = Math.max(this.zoom.min, Math.min(this.zoom.max, this.zoom.level + delta));

            this.setZoom(newLevel);
        }, { passive: false });
    }

    /**
     * Set zoom level and apply transform
     */
    setZoom(level) {
        // Clamp zoom level
        this.zoom.level = Math.max(this.zoom.min, Math.min(this.zoom.max, level));
        this._applyCanvasTransform();

        // Update zoom level display
        const zoomLevelDisplay = document.getElementById('zoom-level');
        if (zoomLevelDisplay) {
            zoomLevelDisplay.textContent = `${Math.round(this.zoom.level * 100)}%`;
        }
    }

    /**
     * Apply combined zoom and pan transform to canvas
     */
    _applyCanvasTransform() {
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.style.transform = `translate(${this.zoom.panX}px, ${this.zoom.panY}px) scale(${this.zoom.level})`;
            canvasContainer.style.transformOrigin = 'center center';
        }
    }

    /**
     * Zoom in by one step
     */
    zoomIn() {
        this.setZoom(this.zoom.level + this.zoom.step);
    }

    /**
     * Zoom out by one step
     */
    zoomOut() {
        this.setZoom(this.zoom.level - this.zoom.step);
    }

    /**
     * Reset zoom to 100% and pan to center
     */
    resetZoom() {
        this.zoom.panX = 0;
        this.zoom.panY = 0;
        this.setZoom(1);
    }

    /**
     * Initialize pan events (Space + drag)
     */
    _initPanEvents() {
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        let startX = 0, startY = 0;
        let startPanX = 0, startPanY = 0;

        // Track Space key state
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.zoom.isPanning && !this.state.showingBefore) {
                canvasArea.style.cursor = 'grab';
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && !this.zoom.isPanning) {
                canvasArea.style.cursor = '';
            }
        });

        // Mouse down - start panning if Space is held
        canvasArea.addEventListener('mousedown', (e) => {
            // Check if Space is being held (we check via keyboard state)
            if (e.buttons === 1 && canvasArea.style.cursor === 'grab') {
                e.preventDefault();
                this.zoom.isPanning = true;
                startX = e.clientX;
                startY = e.clientY;
                startPanX = this.zoom.panX;
                startPanY = this.zoom.panY;
                canvasArea.style.cursor = 'grabbing';
            }
        });

        // Mouse move - pan if dragging
        document.addEventListener('mousemove', (e) => {
            if (this.zoom.isPanning) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                this.zoom.panX = startPanX + dx;
                this.zoom.panY = startPanY + dy;
                this._applyCanvasTransform();
            }
        });

        // Mouse up - stop panning
        document.addEventListener('mouseup', () => {
            if (this.zoom.isPanning) {
                this.zoom.isPanning = false;
                const canvasArea = document.querySelector('.canvas-area');
                if (canvasArea) {
                    canvasArea.style.cursor = '';
                }
            }
        });
    }

    /**
     * Initialize Before/After comparison slider
     */
    _initComparisonSlider() {
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        // Create comparison slider container
        const slider = document.createElement('div');
        slider.className = 'comparison-slider';
        slider.id = 'comparison-slider';
        slider.style.display = 'none';
        slider.innerHTML = `
            <div class="comparison-line"></div>
            <div class="comparison-handle">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M8 5v14l-5-7zM16 5v14l5-7z"/>
                </svg>
            </div>
            <div class="comparison-label comparison-label-before">Before</div>
            <div class="comparison-label comparison-label-after">After</div>
        `;
        canvasArea.appendChild(slider);

        // Create original canvas overlay for comparison
        const originalCanvas = document.createElement('canvas');
        originalCanvas.id = 'original-canvas';
        originalCanvas.className = 'original-canvas';
        originalCanvas.style.display = 'none';
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.appendChild(originalCanvas);
        }

        // Slider drag handling
        let isDragging = false;
        const handle = slider.querySelector('.comparison-handle');

        handle?.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging || !this.comparison.active) return;

            const rect = canvasArea.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.comparison.position = Math.max(5, Math.min(95, (x / rect.width) * 100));
            this._updateComparisonSlider();
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Before/After toggle button for accessibility
        const beforeAfterBtn = document.getElementById('btn-before-after');
        if (beforeAfterBtn) {
            beforeAfterBtn.addEventListener('click', () => {
                this.toggleComparison();
                beforeAfterBtn.classList.toggle('active', this.comparison.active);
            });
        }
    }

    /**
     * Toggle before/after comparison mode
     */
    toggleComparison(show = !this.comparison.active) {
        this.comparison.active = show;

        const slider = document.getElementById('comparison-slider');
        const originalCanvas = document.getElementById('original-canvas');

        if (show && this.state.hasImage) {
            // Copy original image to overlay canvas
            if (originalCanvas) {
                const ctx = originalCanvas.getContext('2d');
                const mainCanvas = this.elements.canvas;
                originalCanvas.width = mainCanvas.width;
                originalCanvas.height = mainCanvas.height;

                // Draw original image
                if (this.state.originalImage) {
                    ctx.drawImage(this.state.originalImage, 0, 0, originalCanvas.width, originalCanvas.height);
                }
                originalCanvas.style.display = 'block';
            }

            if (slider) {
                slider.style.display = 'flex';
            }
            this._updateComparisonSlider();
        } else {
            if (slider) slider.style.display = 'none';
            if (originalCanvas) originalCanvas.style.display = 'none';
        }

        // Sync the toggle button active state
        const beforeAfterBtn = document.getElementById('btn-before-after');
        if (beforeAfterBtn) {
            beforeAfterBtn.classList.toggle('active', this.comparison.active);
        }
    }

    /**
     * Update comparison slider position and clipping
     */
    _updateComparisonSlider() {
        const slider = document.getElementById('comparison-slider');
        const originalCanvas = document.getElementById('original-canvas');

        if (!slider || !originalCanvas) return;

        const position = this.comparison.position;

        // Position the slider line and handle
        slider.style.left = `${position}%`;

        // Clip the original canvas to show only the left portion
        originalCanvas.style.clipPath = `inset(0 ${100 - position}% 0 0)`;
    }

    /**
     * Initialize upscale controls
     */
    _initUpscaleControls() {
        // Create upscaler instance
        this.upscaler = new ImageUpscaler();
        this.upscaleScaleFactor = 2;

        // Mode selector buttons (Enhance / Upscale / Both)
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                this.upscaler.setProcessingMode(mode);
                this._updateUpscaleDimensions();
            });
        });

        // Scale factor buttons
        document.querySelectorAll('.scale-factor-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.scale-factor-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.upscaleScaleFactor = parseInt(btn.dataset.scale);
                this.upscaler.setScaleFactor(this.upscaleScaleFactor);
                this._updateUpscaleDimensions();
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
            btnApply.addEventListener('click', () => this.applyUpscale());
        }

        // Cancel button
        const btnCancel = document.getElementById('btn-upscale-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                this.setMode('develop');
            });
        }
    }

    /**
     * @deprecated Handled by liquifyModule.init()
     */
    _initLiquifyControls() {
        // Now delegated to liquifyModule.init()
    }

    /**
     * Activate liquify tool
     */
    _activateLiquifyTool() {
        this.liquifyModule.activate();
    }

    /**
     * Update liquify brush cursor size
     */
    _updateLiquifyBrushCursor() {
        this.liquifyModule._updateBrushCursor();
    }

    /**
     * Deactivate liquify tool
     */
    _deactivateLiquifyTool() {
        this.liquifyModule.deactivate();
    }

    /**
     * Apply liquify changes to the main canvas
     */
    async applyLiquify() {
        return this.liquifyModule.apply();
    }

    /**
     * Helper to load image as async/await
     */
    _loadImageAsync(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    /**
     * @deprecated Handled by healingModule.init()
     */
    _initHealingControls() {
        // Now delegated to healingModule.init()
    }

    /**
     * Activate healing tool
     */
    _activateHealingTool() {
        this.healingModule.activate();
    }

    /**
     * Deactivate healing tool
     */
    _deactivateHealingTool() {
        this.healingModule.deactivate();
    }

    /**
     * Update healing brush cursor size
     */
    _updateHealingBrushCursor() {
        this.healingModule._updateBrushCursor();
    }

    /**
     * Render healing preview with mask overlay
     */
    _renderHealingPreview() {
        this.healingModule._renderPreview();
    }

    /**
     * Perform AI healing using LaMa
     */
    async _performHealing() {
        return this.healingModule.performHealing();
    }

    /**
     * Apply healed result to main canvas
     */
    async _applyHealing() {
        return this.healingModule.applyHealing();
    }

    /**
     * Enhance face using GFPGAN
     */
    async _enhanceFace() {
        return this.healingModule.enhanceFace();
    }

    /**
     * Remove background using rembg
     */
    async _removeBackground() {
        return this.healingModule.removeBackground();
    }

    /**
     * Update upscale dimensions display
     */
    _updateUpscaleDimensions() {
        const currentDims = document.getElementById('upscale-current-dims');
        const outputDims = document.getElementById('upscale-output-dims');

        if (!this.state.hasImage) {
            if (currentDims) currentDims.textContent = '-- × --';
            if (outputDims) outputDims.textContent = '-- × --';
            return;
        }

        const width = this.gpu.width;
        const height = this.gpu.height;
        const outputWidth = Math.round(width * this.upscaleScaleFactor);
        const outputHeight = Math.round(height * this.upscaleScaleFactor);

        if (currentDims) currentDims.textContent = `${width} × ${height}`;
        if (outputDims) outputDims.textContent = `${outputWidth} × ${outputHeight}`;
    }

    /**
     * Apply upscale to image
     */
    async applyUpscale() {
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
            const snapshot = this._captureFullState();
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
                this.updateLayersList();

                // Update UI
                this.elements.perfIndicator.textContent = `${img.width}×${img.height}`;
                setTimeout(() => this.renderHistogram(), 100);

                // Hide progress
                if (progressSection) progressSection.style.display = 'none';
                if (btnApply) btnApply.disabled = false;
                if (progressBar) progressBar.style.width = '0%';

                // Update dimensions display
                this._updateUpscaleDimensions();

                console.log(`✅ Upscale complete: ${img.width}×${img.height}`);
            };
            img.src = upscaledCanvas.toDataURL('image/png');

        } catch (error) {
            console.error('Upscale failed:', error);
            if (progressSection) progressSection.style.display = 'none';
            if (btnApply) btnApply.disabled = false;
        }
    }

    /**
     * Initialize file handling
     */
    _initFileHandling() {
        const dropZone = this.elements.dropZone;
        const fileInput = this.elements.fileInput;

        if (dropZone) {
            dropZone.addEventListener('click', () => fileInput?.click());
        }

        const btnBrowse = document.getElementById('btn-browse');
        if (btnBrowse) {
            btnBrowse.addEventListener('click', (e) => {
                e.stopPropagation();
                fileInput?.click();
            });
        }

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files[0]) this.loadImage(e.target.files[0]);
            });
        }

        document.body.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone?.classList.add('dragover');
        });

        document.body.addEventListener('dragleave', (e) => {
            if (!e.relatedTarget) dropZone?.classList.remove('dragover');
        });

        document.body.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone?.classList.remove('dragover');
            if (e.dataTransfer.files[0]) this.loadImage(e.dataTransfer.files[0]);
        });
    }

    /**
     * Initialize action buttons
     */
    _initActionButtons() {
        const btnReset = document.getElementById('btn-reset');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                // Save state BEFORE reset for undo support
                const snapshot = this._captureFullState();
                this.history.pushState(snapshot);

                this.globalSliders.forEach(name => {
                    const slider = document.getElementById(`slider-${name}`);
                    const valueDisplay = document.getElementById(`val-${name}`);
                    if (slider) {
                        slider.value = 0;
                        valueDisplay.textContent = name === 'exposure' ? '0.00' : '0';
                        this.gpu.setParam(name, 0);
                    }
                });
                this.state.resetAdjustments();
                requestAnimationFrame(() => this.renderHistogram());
            });
        }

        const btnExport = document.getElementById('btn-export');
        if (btnExport) {
            btnExport.addEventListener('click', () => this.exportImage());
        }

        // Export format dropdown - initial state
        const exportFormat = document.getElementById('export-format');
        const qualityControl = document.getElementById('quality-control');
        if (exportFormat && qualityControl) {
            // Initial state
            qualityControl.style.display = exportFormat.value === 'png' ? 'none' : 'block';
        }

        // Export quality slider
        const qualitySlider = document.getElementById('slider-export-quality');
        const qualityValue = document.getElementById('val-export-quality');
        if (qualitySlider && qualityValue) {
            qualitySlider.addEventListener('input', () => {
                qualityValue.textContent = qualitySlider.value;
                // Debounce file size estimation
                clearTimeout(this._estimateSizeTimeout);
                this._estimateSizeTimeout = setTimeout(() => this.estimateFileSize(), 300);
            });
        }

        // Also trigger estimation when format changes
        if (exportFormat) {
            exportFormat.addEventListener('change', () => {
                // Hide quality slider for PNG (lossless)
                if (qualityControl) {
                    qualityControl.style.display = exportFormat.value === 'png' ? 'none' : 'block';
                }
                // Re-estimate file size with new format
                this.estimateFileSize();
            });
        }
    }

    /**
     * Load image file
     */
    loadImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.state.setImage(img);
                this.gpu.loadImage(img);
                this.elements.dropZone?.classList.add('hidden');
                this.elements.perfIndicator.textContent = `${img.width}×${img.height}`;
                setTimeout(() => this.renderHistogram(), 100);

                // Push initial state to history for undo support
                this.history.clear();
                this._pushHistoryDebounced();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    /**
     * Render with mask overlay
     * @param {boolean} showOverlay - Whether to show red mask overlay during painting
     */
    renderWithMask(showOverlay = false) {
        // Step 1: Render base image with global adjustments to texture
        let resultTexture = this.gpu.renderToTexture();

        // Step 2: Apply masked adjustments (if any layers with adjustments)
        resultTexture = this.masks.applyMaskedAdjustments(resultTexture);

        // Step 3: Blit result to canvas
        this.gpu.blitToCanvas(resultTexture);

        // Step 4: If painting, show red mask overlay for visual feedback
        if (showOverlay && this.masks.getActiveLayer()) {
            this.masks.renderMaskOverlay();
        }
    }

    /**
     * Render histogram
     */
    renderHistogram() {
        if (!this.gpu.inputTexture || !this.histogramCtx) return;

        const canvas = this.elements.histogramCanvas;
        const ctx = this.histogramCtx;
        const w = canvas.width = canvas.offsetWidth * 2;
        const h = canvas.height = 160;

        const imageData = this.gpu.toImageData();
        const data = imageData.data;

        const r = new Uint32Array(256);
        const g = new Uint32Array(256);
        const b = new Uint32Array(256);
        const lum = new Uint32Array(256);

        for (let i = 0; i < data.length; i += 4) {
            r[data[i]]++;
            g[data[i + 1]]++;
            b[data[i + 2]]++;
            const L = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            lum[L]++;
        }

        let maxVal = 0;
        for (let i = 5; i < 250; i++) {
            maxVal = Math.max(maxVal, r[i], g[i], b[i], lum[i]);
        }

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        const barWidth = w / 256;

        // Draw luminance fill
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < 256; i++) {
            const barHeight = (lum[i] / maxVal) * h * 0.9;
            ctx.lineTo(i * barWidth, h - barHeight);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();

        // Draw RGB channels
        const drawChannel = (bins, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < 256; i++) {
                const barHeight = (bins[i] / maxVal) * h * 0.9;
                if (i === 0) ctx.moveTo(i * barWidth, h - barHeight);
                else ctx.lineTo(i * barWidth, h - barHeight);
            }
            ctx.stroke();
        };

        drawChannel(r, 'rgba(239, 68, 68, 0.6)');
        drawChannel(g, 'rgba(34, 197, 94, 0.6)');
        drawChannel(b, 'rgba(59, 130, 246, 0.6)');
    }

    /**
     * Update layers list in UI
     */
    updateLayersList() {
        const container = document.getElementById('mask-layers');
        if (!container) return;

        if (this.masks.layers.length === 0) {
            container.innerHTML = `
                <div style="color: var(--text-secondary); font-size: 12px; text-align: center; padding: 20px;">
                    No adjustment layers yet.<br>Select a tool to create one.
                </div>`;
            return;
        }

        container.innerHTML = this.masks.layers.map((layer, i) => `
            <div class="mask-layer ${i === this.masks.activeLayerIndex ? 'active' : ''}" data-index="${i}">
                <div class="mask-layer-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                    </svg>
                </div>
                <div class="mask-layer-name" data-layer-index="${i}">${layer.name}</div>
                <span class="mask-layer-delete" data-delete="${i}" title="Delete layer">×</span>
            </div>
        `).join('');

        this._bindLayerEvents(container);
    }

    /**
     * Bind layer list events
     */
    _bindLayerEvents(container) {
        // Layer selection
        container.querySelectorAll('.mask-layer').forEach(el => {
            el.addEventListener('click', (e) => {
                if (!e.target.classList.contains('mask-layer-delete') &&
                    !e.target.classList.contains('mask-layer-name') &&
                    e.target.tagName !== 'INPUT') {
                    this.masks.activeLayerIndex = parseInt(el.dataset.index);
                    this.updateLayersList();
                    this.syncLayerUI();
                }
            });
        });

        // Single click on name selects layer (only if different layer)
        container.querySelectorAll('.mask-layer-name').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const index = parseInt(el.dataset.layerIndex);
                if (this.masks.activeLayerIndex !== index) {
                    this.masks.activeLayerIndex = index;
                    this.updateLayersList();
                    this.syncLayerUI();
                }
            });

            // Double-click for inline rename
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const index = parseInt(el.dataset.layerIndex);
                const layer = this.masks.layers[index];

                const input = document.createElement('input');
                input.type = 'text';
                input.value = layer.name;
                input.style.cssText = `
                    width: 100%;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--accent-primary);
                    border-radius: 4px;
                    color: var(--text-primary);
                    font-size: 12px;
                    padding: 2px 6px;
                    outline: none;
                    box-sizing: border-box;
                `;

                el.textContent = '';
                el.appendChild(input);
                input.focus();
                input.select();

                let saved = false;
                const saveRename = () => {
                    if (saved) return;
                    saved = true;
                    const newName = input.value.trim();
                    if (newName) {
                        layer.name = newName;
                    }
                    this.updateLayersList();
                };

                input.addEventListener('blur', saveRename);
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        input.blur();
                    } else if (ev.key === 'Escape') {
                        saved = true;
                        this.updateLayersList();
                    }
                });
            });
        });

        // Delete layer with confirmation
        container.querySelectorAll('.mask-layer-delete').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(el.dataset.delete);
                const layer = this.masks.layers[index];
                if (confirm(`Delete "${layer.name}"?`)) {
                    this.masks.deleteLayer(index);
                    this.updateLayersList();
                    this.syncLayerUI();
                    this.renderWithMask(false);
                }
            });
        });
    }

    /**
     * Sync layer UI with active layer
     */
    syncLayerUI() {
        const adj = this.masks.getActiveAdjustments();
        this.maskSliders.forEach(name => {
            const slider = document.getElementById(`slider-mask-${name}`);
            const valueDisplay = document.getElementById(`val-mask-${name}`);
            const value = adj ? (adj[name] || 0) : 0;
            if (slider) slider.value = value;
            if (valueDisplay) valueDisplay.textContent = name === 'exposure' ? value.toFixed(2) : Math.round(value);
        });
    }

    /**
     * Update brush cursor
     */
    updateBrushCursor() {
        const cursor = this.elements.brushCursor;
        if (!cursor) return;
        const size = this.masks.brushSettings.size;
        cursor.style.width = `${size}px`;
        cursor.style.height = `${size}px`;
    }

    /**
     * Update brush cursor position
     */
    updateBrushCursorPosition(e) {
        const cursor = this.elements.brushCursor;
        if (!cursor || this.state.currentTool !== 'brush') return;
        const rect = this.elements.canvas?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX;
        const y = e.clientY;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            cursor.style.left = `${x}px`;
            cursor.style.top = `${y}px`;
            cursor.style.opacity = '1';
        } else {
            cursor.style.opacity = '0';
        }
    }

    /**
     * Update brush preview
     */
    updateBrushPreview() {
        const previewCircle = this.elements.brushPreviewCircle;
        if (!previewCircle) return;
        const opacity = this.masks.brushSettings.opacity;
        const hardness = this.masks.brushSettings.hardness;
        const stopPos = Math.max(0, hardness * 70);
        previewCircle.style.background = `radial-gradient(circle, 
            rgba(255,255,255,${opacity}) 0%, 
            rgba(255,255,255,${opacity}) ${stopPos}%, 
            rgba(255,255,255,0) 70%)`;
    }

    /**
     * Update brush size indicator
     */
    updateBrushSizeIndicator(size) {
        const indicator = this.elements.brushSizeIndicator;
        if (indicator) indicator.textContent = `${size}px`;
    }

    /**
     * Export image with full resolution and format options
     * Uses offscreen canvas to render at original image resolution
     */
    exportImage() {
        this.exportModule.exportImage();
    }

    /**
     * Internal export method - renders at original resolution
     * @deprecated Use exportModule._performExport instead
     */
    _performExport(mimeType, quality, extension) {
        this.exportModule._performExport(mimeType, quality, extension);
    }

    /**
     * Estimate file size based on current settings
     * Called when quality slider changes
     */
    estimateFileSize() {
        this.exportModule.estimateFileSize();
    }

    /**
     * Update file size display in UI
     */
    _updateFileSizeDisplay(sizeText) {
        this.exportModule._updateFileSizeDisplay(sizeText);
    }

    /**
     * Show export options modal (if expanded export UI is desired)
     */
    showExportOptions() {
        this.exportModule.showExportOptions();
    }

    /**
     * Push current state to history (debounced to avoid flooding)
     * Captures global state across all sections for full undo/redo support
     */
    _pushHistoryDebounced() {
        this.historyModule.pushDebounced();
    }

    /**
     * Capture the full application state for history
     * Includes image data for undoing crops and destructive operations
     */
    _captureFullState() {
        return this.historyModule.captureFullState();
    }

    /**
     * Undo last adjustment
     */
    undo() {
        this.historyModule.undo();
    }

    /**
     * Redo previously undone adjustment
     */
    redo() {
        this.historyModule.redo();
    }

    /**
     * Restore full state from history snapshot
     * Handles image restoration for crop undo
     */
    _restoreState(snapshot) {
        this.historyModule.restoreState(snapshot);
    }

    /**
     * Restore adjustment values from snapshot
     */
    _restoreAdjustments(snapshot) {
        this.historyModule.restoreAdjustments(snapshot);
    }
}

