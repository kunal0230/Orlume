/**
 * EditorUI - UI management for the GPU Editor
 * Handles all DOM interactions, event bindings, and UI updates
 */
import { HistoryManager } from './HistoryManager.js';

// Modular components
import { HistoryModule, ZoomPanModule, ExportModule, CropModule, LiquifyModule, HealingModule, CloneModule, UpscaleModule, KeyboardModule, ComparisonModule, LayersModule } from './modules/index.js';

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
        this.cloneModule = new CloneModule(this);
        this.upscaleModule = new UpscaleModule(this);
        this.keyboardModule = new KeyboardModule(this);
        this.comparisonModule = new ComparisonModule(this);
        this.layersModule = new LayersModule(this);

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

        // Expose upscaler from module for backward compatibility
        this.upscaler = null; // Will be set when upscaleModule.init() is called
        this.upscaleScaleFactor = 2;

        // Comparison slider state - exposed from module for backward compatibility
        this.comparison = null; // Will be set when comparisonModule.init() is called

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
        this._initFileHandling();
        this._initActionButtons();

        // Initialize modular components
        this.zoomPanModule.init();
        this.cropModule.init();
        this.liquifyModule.init();
        this.healingModule.init();
        this.cloneModule.init();
        this.upscaleModule.init();
        this.keyboardModule.init();
        this.comparisonModule.init();

        // Sync tool references for backward compatibility
        this.liquifyTool = this.liquifyModule.liquifyTool;
        this.liquifyCanvas = this.liquifyModule.liquifyCanvas;
        this.healingTool = this.healingModule.healingTool;
        this.healingCanvas = this.healingModule.healingCanvas;
        this.replicate = this.healingModule.replicate;
        this.upscaler = this.upscaleModule.upscaler;
        this.upscaleScaleFactor = this.upscaleModule.scaleFactor;
        this.comparison = this.comparisonModule.comparison;
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

        // Always deactivate ALL overlay tools first to prevent image overlap
        this._deactivateAllOverlayTools();

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
        document.getElementById('clone-mode-header').style.display = 'none';
        document.getElementById('hsl-mode-header').style.display = 'none';
        document.getElementById('presets-mode-header').style.display = 'none';
        document.getElementById('bg-remove-mode-header').style.display = 'none';

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

            case 'clone':
                document.getElementById('clone-mode-header').style.display = 'block';
                document.getElementById('panel-clone').classList.add('active');
                // Activate clone tool
                this.cloneModule.activate();
                break;

            case 'hsl':
                document.getElementById('hsl-mode-header').style.display = 'block';
                document.getElementById('panel-hsl').classList.add('active');
                break;

            case 'presets':
                document.getElementById('presets-mode-header').style.display = 'block';
                document.getElementById('panel-presets').classList.add('active');
                break;

            case 'bg-remove':
                document.getElementById('bg-remove-mode-header').style.display = 'block';
                document.getElementById('panel-bg-remove').classList.add('active');
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
     * @deprecated Handled by keyboardModule.init()
     */
    _initKeyboardShortcuts() {
        // Now delegated to keyboardModule.init()
    }

    /**
     * Toggle keyboard shortcuts modal
     */
    toggleShortcutsModal(show) {
        this.keyboardModule.toggleShortcutsModal(show);
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
     * @deprecated Handled by comparisonModule.init()
     */
    _initComparisonSlider() {
        // Now delegated to comparisonModule.init()
    }

    /**
     * Toggle before/after comparison mode
     */
    toggleComparison(show) {
        this.comparisonModule.toggle(show);
    }

    /**
     * Update comparison slider position and clipping
     */
    _updateComparisonSlider() {
        this.comparisonModule._updateSlider();
    }

    /**
     * @deprecated Handled by upscaleModule.init()
     */
    _initUpscaleControls() {
        // Now delegated to upscaleModule.init()
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
     * Deactivate ALL overlay tools (liquify, healing, clone)
     * Called at the start of every mode switch to prevent image overlap
     */
    _deactivateAllOverlayTools() {
        this.liquifyModule?.deactivate();
        this.healingModule?.deactivate();
        this.cloneModule?.deactivate();
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
        this.upscaleModule.updateDimensions();
    }

    /**
     * Apply upscale to image
     */
    async applyUpscale() {
        return this.upscaleModule.apply();
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

                // Notify mask system of dimension change so it can update textures
                if (this.masks && typeof this.masks.onImageDimensionsChanged === 'function') {
                    this.masks.onImageDimensionsChanged();
                }

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
        this.layersModule.updateList();
    }

    /**
     * Bind layer list events
     * @deprecated Layer events are now handled in layersModule
     */
    _bindLayerEvents(container) {
        // Now delegated to layersModule._bindEvents()
    }

    /**
     * Sync layer UI with active layer
     */
    syncLayerUI() {
        this.layersModule.syncUI();
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

