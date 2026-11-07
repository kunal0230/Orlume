/**
 * EditorUI - UI management for the GPU Editor
 * Handles all DOM interactions, event bindings, and UI updates
 */
import { HistoryManager } from './HistoryManager.js';

// Modular components
import { HistoryModule, ZoomPanModule, ExportModule, CropModule, LiquifyModule, HealingModule, CloneModule, UpscaleModule, KeyboardModule, ComparisonModule, LayersModule, BackgroundRemovalModule, GodRaysModule, HSLModule, PresetsModule, TextModule, ToneCurveModule, ColorGradingModule, LutModule, FeedbackModule, CrashReporterModule } from './modules/index.js';

// v8 PRO Relighting
import { RelightingProModule } from '../modules/RelightingProModule.js';

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
            'structure', 'clarity', 'dehaze',
            'temperature', 'tint', 'vibrance', 'saturation'
        ];

        this.maskSliders = [
            'density', 'exposure', 'contrast', 'highlights', 'shadows', 'clarity', 'temperature', 'tint', 'saturation'
        ];

        // Smooth histogram throttling and GPU render telemetry
        this._histThrottleTimer = null;
        this._histPending = false;
        if (this.gpu) {
            this.gpu.onRender = (elapsed) => {
                if (this.elements.perfIndicator) {
                    this.elements.perfIndicator.textContent = `${elapsed.toFixed(1)}ms`;
                }
            };
        }

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
        this.bgRemovalModule = new BackgroundRemovalModule(this);
        this.godRaysModule = new GodRaysModule(this);
        this.hslModule = new HSLModule(this);
        this.presetsModule = new PresetsModule(this);
        this.textModule = new TextModule(this);
        this.relightingProModule = new RelightingProModule(this);  // v8 PRO
        this.toneCurveModule = new ToneCurveModule(this);
        this.colorGradingModule = new ColorGradingModule(this);
        this.lutModule = new LutModule(this);
        this.feedbackModule = new FeedbackModule(this);
        this.feedbackModule.init();

        this.crashReporterModule = new CrashReporterModule(this);
        this.crashReporterModule.init();

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

        // White Balance Eyedropper state
        this.isWBPicking = false;
        this._wbSampleCanvas = null;
        this._wbSampleCtx = null;

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
        this._initClippingControls();
        this._initWBPicker();

        // Bind Undo/Redo buttons
        document.getElementById('btn-undo')?.addEventListener('click', () => this.undo());
        document.getElementById('btn-redo')?.addEventListener('click', () => this.redo());

        // Initialize modular components
        this.zoomPanModule.init();
        this.cropModule.init();
        this.liquifyModule.init();
        this.healingModule.init();
        this.cloneModule.init();
        this.upscaleModule.init();
        this.keyboardModule.init();
        this.comparisonModule.init();
        this.bgRemovalModule.init();
        this.godRaysModule.init();
        this.hslModule.init();
        this.presetsModule.init();
        this.textModule.init();
        // RelightingModule removed - using v8 PRO only
        this.toneCurveModule.init();
        this.colorGradingModule.init();
        this.lutModule.init();

        // Sync tool references for backward compatibility
        this.liquifyTool = this.liquifyModule.liquifyTool;
        this.liquifyCanvas = this.liquifyModule.liquifyCanvas;
        this.healingTool = this.healingModule.healingTool;
        this.healingCanvas = this.healingModule.healingCanvas;
        this.replicate = this.healingModule.replicate;
        this.upscaler = this.upscaleModule.upscaler;
        this.upscaleScaleFactor = this.upscaleModule.scaleFactor;
        this.comparison = this.comparisonModule.comparison;

        // Handle URL parameters for direct tool access
        this._handleURLParameters();
    }

    /**
     * Handle URL parameters to open specific tools
     * Example: /editor?tool=3d-pro will open 3D Relighting
     */
    _handleURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const tool = urlParams.get('tool');

        if (tool) {
            // Delay to ensure UI is fully initialized
            setTimeout(() => {
                this.setMode(tool);
            }, 100);
        }
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

                if (panelId === 'masks') {
                    if (this.masks) this.masks.isMaskMode = true;
                    const activeBtn = document.querySelector('.mask-tool-btn.active');
                    const tool = activeBtn ? activeBtn.id.replace('mask-tool-', '') : 'brush';
                    this.setMaskTool(tool, false);
                    this.updateLayersList();
                    this.syncLayerUI();
                    this.updateMaskGuides();
                    this.gpu.render();
                } else if (panelId === 'develop') {
                    if (this.masks) this.masks.isMaskMode = false;
                    this.state.setTool('develop');
                    if (this.elements.brushCursor) this.elements.brushCursor.style.display = 'none';
                    this.hideMaskGuides();
                    this.gpu.render();
                }
            });
        });

        // Mask tool buttons within Masks panel
        document.querySelectorAll('.mask-tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const toolId = btn.id.replace('mask-tool-', '');
                this.setMaskTool(toolId, true);
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


        // Deactivate god rays when leaving godrays mode
        if (previousMode === 'godrays' && mode !== 'godrays') {
            this._deactivateGodRaysTool();
        }

        // Deactivate text tool when leaving text mode
        if (previousMode === 'text' && mode !== 'text') {
            this.textModule.deactivate();
        }

        // Deactivate relighting PRO when leaving 3d-pro mode
        if (previousMode === '3d-pro' && mode !== '3d-pro') {
            this.relightingProModule.deactivate();
        }

        // Reset any in-progress mask drawing when switching modes
        if (['brush', 'radial', 'gradient'].includes(previousMode)) {
            this.state.setPainting(false, null);
            this._maskDragStart = null;
        }

        if (this.masks) {
            this.masks.isMaskMode = (mode === 'develop' && document.querySelector('#develop-mode-tabs [data-panel="masks"]')?.classList.contains('active'));
        }

        this.state.setTool(mode);

        // Update toolbar button UI
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tool-${mode}`)?.classList.add('active');

        // Hide all mode headers
        document.getElementById('develop-mode-tabs')?.style.setProperty('display', 'none');
        document.getElementById('export-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('crop-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('upscale-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('liquify-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('healing-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('clone-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('hsl-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('presets-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('bg-remove-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('godrays-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('relight-pro-mode-header')?.style.setProperty('display', 'none');
        document.getElementById('text-mode-header')?.style.setProperty('display', 'none');

        // Hide all panels
        document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));

        // Hide brush cursor and mask guides by default
        if (this.elements.brushCursor) this.elements.brushCursor.style.display = 'none';
        this.hideMaskGuides();

        switch (mode) {
            case 'develop': {
                document.getElementById('develop-mode-tabs')?.style.setProperty('display', 'flex');
                const masksTabActive = document.querySelector('#develop-mode-tabs [data-panel="masks"]')?.classList.contains('active');
                if (masksTabActive) {
                    document.getElementById('panel-masks')?.classList.add('active');
                    const activeBtn = document.querySelector('.mask-tool-btn.active');
                    const tool = activeBtn ? activeBtn.id.replace('mask-tool-', '') : 'brush';
                    this.setMaskTool(tool, false);
                    this.updateLayersList();
                    this.syncLayerUI();
                    this.updateMaskGuides();
                } else {
                    document.getElementById('panel-develop')?.classList.add('active');
                    this.state.setTool('develop');
                }
                break;
            }



            case '3d-pro':
                document.getElementById('relight-pro-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-3d-pro')?.classList.add('active');
                this.relightingProModule.activate();
                break;

            case 'export':
                document.getElementById('export-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-export')?.classList.add('active');
                // Estimate file size when entering export mode
                setTimeout(() => this.estimateFileSize(), 100);
                break;

            case 'crop':
                document.getElementById('crop-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-crop')?.classList.add('active');
                // Initialize and activate crop tool
                this._activateCropTool();
                break;

            case 'upscale':
                document.getElementById('upscale-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-upscale')?.classList.add('active');
                // Update dimensions display
                this._updateUpscaleDimensions();
                break;

            case 'liquify':
                document.getElementById('liquify-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-liquify')?.classList.add('active');
                // Activate liquify tool
                this._activateLiquifyTool();
                break;

            case 'healing':
                document.getElementById('healing-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-healing')?.classList.add('active');
                // Activate healing tool
                this._activateHealingTool();
                break;

            case 'clone':
                document.getElementById('clone-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-clone')?.classList.add('active');
                // Activate clone tool
                this.cloneModule.activate();
                break;

            case 'hsl':
                document.getElementById('hsl-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-hsl')?.classList.add('active');
                this.colorGradingModule.updateUIFromState();
                break;

            case 'presets':
                document.getElementById('presets-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-presets')?.classList.add('active');
                this.lutModule?.syncUI?.();
                break;

            case 'bg-remove':
                document.getElementById('bg-remove-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-bg-remove')?.classList.add('active');
                break;

            case 'godrays':
                document.getElementById('godrays-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-godrays')?.classList.add('active');
                // Activate god rays tool
                this._activateGodRaysTool();
                break;


            case 'text':
                document.getElementById('text-mode-header')?.style.setProperty('display', 'block');
                document.getElementById('panel-text')?.classList.add('active');
                // Activate text tool
                this.textModule.activate();
                break;
        }
    }

    /**
     * Set active mask tool (brush, radial, gradient)
     * @param {string} tool - 'brush' | 'radial' | 'gradient'
     * @param {boolean} [autoCreate=true] - Whether to auto-create a layer if none matches
     */
    setMaskTool(tool, autoCreate = true) {
        if (this.masks) {
            this.masks.isMaskMode = true;
        }

        // Update mask tool button UI
        document.querySelectorAll('.mask-tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`mask-tool-${tool}`)?.classList.add('active');

        // Show/hide brush settings and adjustments based on tool
        const brushSettings = document.getElementById('brush-settings');
        const maskAdjustments = document.getElementById('mask-adjustments');

        if (tool === 'brush') {
            this.state.setTool('brush');
            if (brushSettings) brushSettings.style.display = 'block';
            if (maskAdjustments) maskAdjustments.style.display = 'block';
            if (this.elements?.brushCursor) this.elements.brushCursor.style.display = 'block';
            this.updateBrushCursor();
            this.hideMaskGuides();
        } else if (tool === 'radial') {
            this.state.setTool('radial');
            if (brushSettings) brushSettings.style.display = 'none';
            if (maskAdjustments) maskAdjustments.style.display = 'block';
            if (this.elements?.brushCursor) this.elements.brushCursor.style.display = 'none';
            this.updateMaskGuides();
        } else if (tool === 'gradient') {
            this.state.setTool('gradient');
            if (brushSettings) brushSettings.style.display = 'none';
            if (maskAdjustments) maskAdjustments.style.display = 'block';
            if (this.elements?.brushCursor) this.elements.brushCursor.style.display = 'none';
            this.updateMaskGuides();
        }

        if (this.masks) {
            const currentLayer = this.masks.getActiveLayer?.();
            if (currentLayer && currentLayer.type === tool) {
                this.updateLayersList();
                this.syncLayerUI();
                this.updateMaskGuides();
                return;
            }

            // Look for existing layer with matching type
            const existingIndex = this.masks.layers.findIndex(l => l.type === tool);
            if (existingIndex >= 0) {
                this.masks.activeLayerIndex = existingIndex;
                this.updateLayersList();
                this.syncLayerUI();
                this.updateMaskGuides();
                return;
            }

            // Create new layer if autoCreate is true or no layers exist
            if (autoCreate || this.masks.layers.length === 0) {
                const layer = this.masks.createLayer(tool);
                this.updateLayersList();
                this.syncLayerUI();

                // If radial or gradient, create default mask on creation
                const w = this.gpu.width || 1000;
                const h = this.gpu.height || 1000;
                if (tool === 'radial' && this.masks.createRadialMask) {
                    const rx = Math.round(Math.min(w, h) * 0.28);
                    const ry = Math.round(Math.min(w, h) * 0.22);
                    this.masks.createRadialMask(w / 2, h / 2, rx, ry, 0, 0.5, false);
                } else if (tool === 'gradient' && this.masks.createLinearMask) {
                    this.masks.createLinearMask(w / 2, h * 0.25, w / 2, h * 0.75, 0.5, false);
                }

                if (layer) {
                    this.gpu.render();
                    this.updateMaskGuides();
                    this._pushHistoryDebounced();
                }
            }
        }
    }

    /**
     * Legacy setTool for backward compatibility with keyboard shortcuts
     */
    setTool(tool) {
        const mode = (tool === '3d' || tool === 'depth') ? '3d-pro' : tool;
        if (['develop', '3d-pro', 'export', 'crop', 'upscale', 'liquify', 'healing', 'clone', 'hsl', 'presets', 'bg-remove', 'text', 'godrays'].includes(mode)) {
            this.setMode(mode);
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
            if (!slider) {
                console.warn(`[EditorUI] Slider not found: slider-${name}`);
                return;
            }

            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                valueDisplay.textContent = name === 'exposure' ? (value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2)) : Math.round(value);
                this.state.setAdjustment(name, value);

                // RAF-coalesced GPU parameter update (silky-smooth 60/120fps preview)
                this.gpu.setParam(name, value, false);

                // Throttled histogram update during dragging (never blocks slider interaction)
                this.requestHistogramUpdate(false);
            });

            // Push to history & execute immediate histogram refresh when slider is released
            slider.addEventListener('change', () => {
                this.requestHistogramUpdate(true);
                this._pushHistoryDebounced();
            });

            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                valueDisplay.textContent = name === 'exposure' ? '0.00' : '0';
                this.gpu.setParam(name, 0, true);
                this.state.setAdjustment(name, 0);
                this.requestHistogramUpdate(true);
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
                if (name === 'exposure') {
                    valueDisplay.textContent = value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
                } else if (name === 'density') {
                    valueDisplay.textContent = `${Math.round(value)}%`;
                } else {
                    valueDisplay.textContent = Math.round(value);
                }
                this.masks.setActiveAdjustment(name, value);
                this.renderWithMask(false, false);
            });

            // Push to history when mask slider is released
            slider.addEventListener('change', () => {
                this.renderWithMask(false, true);
                this._pushHistoryDebounced();
            });

            slider.addEventListener('dblclick', () => {
                const defaultVal = name === 'density' ? 100 : 0;
                slider.value = defaultVal;
                if (name === 'exposure') {
                    valueDisplay.textContent = '0.00';
                } else if (name === 'density') {
                    valueDisplay.textContent = '100%';
                } else {
                    valueDisplay.textContent = '0';
                }
                this.masks.setActiveAdjustment(name, defaultVal);
                this.renderWithMask(false, true);
                this._pushHistoryDebounced();
            });
        });

        // Initialize Luminance Range Controls (Lightroom Style)
        const lumToggle = document.getElementById('mask-lum-range-toggle');
        const lumControls = document.getElementById('mask-lum-range-controls');
        if (lumToggle) {
            lumToggle.addEventListener('change', () => {
                const enabled = lumToggle.checked ? 1 : 0;
                if (lumControls) lumControls.style.display = enabled ? 'block' : 'none';
                this.masks.setActiveAdjustment('useLumRange', enabled);
                this.renderWithMask(false, true);
                this._pushHistoryDebounced();
            });
        }

        const lumParams = [
            { id: 'min', key: 'lumMin', def: 0 },
            { id: 'max', key: 'lumMax', def: 100 },
            { id: 'feather', key: 'lumFeather', def: 20 }
        ];

        lumParams.forEach(({ id, key, def }) => {
            const slider = document.getElementById(`slider-mask-lum-${id}`);
            const valDisplay = document.getElementById(`val-mask-lum-${id}`);
            if (!slider) return;

            slider.addEventListener('input', () => {
                const val = parseFloat(slider.value);
                if (valDisplay) valDisplay.textContent = `${Math.round(val)}%`;
                this.masks.setActiveAdjustment(key, val);
                this.renderWithMask(false, false);
            });

            slider.addEventListener('change', () => {
                this.renderWithMask(false, true);
                this._pushHistoryDebounced();
            });

            slider.addEventListener('dblclick', () => {
                slider.value = def;
                if (valDisplay) valDisplay.textContent = `${def}%`;
                this.masks.setActiveAdjustment(key, def);
                this.renderWithMask(false, true);
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
                const valEl = document.getElementById('val-brush-size');
                if (valEl) valEl.textContent = size;
                this.masks.brushSettings.size = size;
                this.state.setBrushSetting('size', size);
                this.updateBrushCursor();
                this.updateBrushSizeIndicator(size);
            });
        }

        // Brush hardness (feather) slider
        const brushHardnessSlider = document.getElementById('slider-brush-hardness');
        if (brushHardnessSlider) {
            brushHardnessSlider.addEventListener('input', () => {
                const hardness = parseInt(brushHardnessSlider.value, 10);
                const valEl = document.getElementById('val-brush-hardness');
                if (valEl) valEl.textContent = hardness;
                this.masks.brushSettings.hardness = hardness;
                this.state.setBrushSetting('hardness', hardness);
                this.updateBrushPreview();
                this.updateBrushCursor();
            });
        }

        // Brush flow / opacity slider
        const brushFlowSlider = document.getElementById('slider-brush-flow') || document.getElementById('slider-brush-opacity');
        if (brushFlowSlider) {
            brushFlowSlider.addEventListener('input', () => {
                const flow = parseInt(brushFlowSlider.value, 10);
                const valEl = document.getElementById('val-brush-flow') || document.getElementById('val-brush-opacity');
                if (valEl) valEl.textContent = flow;
                if (this.masks?.brushSettings) {
                    this.masks.brushSettings.flow = flow;
                    this.masks.brushSettings.opacity = 100;
                }
                this.state.setBrushSetting('flow', flow);
                this.state.setBrushSetting('opacity', flow);
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
                const currentTool = ['brush', 'radial', 'gradient'].includes(this.state.currentTool)
                    ? this.state.currentTool
                    : 'brush';
                this.masks.createLayer(currentTool);
                this.updateLayersList();
                this.syncLayerUI();
                this.setTool(currentTool);
                this.gpu.render();
                this._pushHistoryDebounced();
            });
        }

        // Duplicate layer button
        const btnDuplicate = document.getElementById('btn-duplicate-layer');
        if (btnDuplicate) {
            btnDuplicate.addEventListener('click', () => {
                this.layersModule.duplicateActiveLayer();
            });
        }

        // Invert mask button
        const btnInvert = document.getElementById('btn-invert-mask');
        if (btnInvert) {
            btnInvert.addEventListener('click', () => {
                this.layersModule.invertActiveMask();
            });
        }

        // Clear mask button
        const btnClearMask = document.getElementById('btn-clear-mask-layer');
        if (btnClearMask) {
            btnClearMask.addEventListener('click', () => {
                this.layersModule.clearActiveMask();
            });
        }

        // Toggle overlay button
        const btnToggleOverlay = document.getElementById('btn-toggle-mask-overlay');
        if (btnToggleOverlay) {
            btnToggleOverlay.addEventListener('click', () => {
                this.layersModule.toggleOverlay();
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
        if (this.masks?.brushSettings) {
            this.masks.brushSettings.erase = erase;
        }
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
        this.updateBrushCursor();
    }

    /**
     * Initialize canvas events for painting
     */
    _initCanvasEvents() {
        const canvasArea = document.querySelector('.canvas-area');
        const canvas = this.elements.canvas;

        if (canvasArea) {
            canvasArea.addEventListener('mousemove', (e) => {
                if (this.isWBPicking) {
                    const rect = canvas.getBoundingClientRect();
                    const x = (e.clientX - rect.left) * (this.gpu.width / rect.width);
                    const y = (e.clientY - rect.top) * (this.gpu.height / rect.height);
                    const sample = this._sampleBasePixel(x, y);
                    const badge = document.getElementById('wb-sample-badge');
                    if (sample && badge) {
                        badge.style.display = 'block';
                        badge.style.left = `${e.clientX}px`;
                        badge.style.top = `${e.clientY}px`;
                        badge.textContent = `R: ${Math.round(sample.r)}  G: ${Math.round(sample.g)}  B: ${Math.round(sample.b)}`;
                    }
                    return;
                }

                this.updateBrushCursorPosition(e);

                const rect = canvas.getBoundingClientRect();
                const rawX = (e.clientX - rect.left) * (this.gpu.width / rect.width);
                const rawY = (e.clientY - rect.top) * (this.gpu.height / rect.height);
                const x = Math.max(0, Math.min(this.gpu.width, rawX));
                const y = Math.max(0, Math.min(this.gpu.height, rawY));
                const tool = this.state.currentTool;

                if (this.state.isPainting) {
                    const layer = this.masks?.getActiveLayer?.();
                    const dragMode = this._maskDragMode || 'move';

                    if (tool === 'brush') {
                        if (this.state.lastPaintPos) {
                            this.masks.paintStroke(this.state.lastPaintPos.x, this.state.lastPaintPos.y, x, y);
                        } else {
                            this.masks.paintBrush(x, y);
                        }
                        this.state.updatePaintPos({ x, y });
                        this.renderWithMask(true);
                    } else if (layer?.shape && tool === 'gradient') {
                        const { startX, startY, endX, endY, feather = 0.5, invert = false } = layer.shape;
                        const midX = (startX + endX) * 0.5;
                        const midY = (startY + endY) * 0.5;

                        if (dragMode === 'move' && this._lastPinPos) {
                            const dx = x - this._lastPinPos.x;
                            const dy = y - this._lastPinPos.y;
                            this._lastPinPos = { x, y };
                            this.masks.createLinearMask(startX + dx, startY + dy, endX + dx, endY + dy, feather, invert);
                        } else if (dragMode === 'linear-start') {
                            let newStartX = x;
                            let newStartY = y;
                            if (e.shiftKey) {
                                const curD = Math.hypot(endX - newStartX, endY - newStartY);
                                const snapA = Math.round(Math.atan2(newStartY - endY, newStartX - endX) / (Math.PI / 4)) * (Math.PI / 4);
                                newStartX = endX + Math.cos(snapA) * curD;
                                newStartY = endY + Math.sin(snapA) * curD;
                            }
                            this.masks.createLinearMask(newStartX, newStartY, endX, endY, feather, invert);
                        } else if (dragMode === 'linear-end') {
                            let newEndX = x;
                            let newEndY = y;
                            if (e.shiftKey) {
                                const curD = Math.hypot(newEndX - startX, newEndY - startY);
                                const snapA = Math.round(Math.atan2(newEndY - startY, newEndX - startX) / (Math.PI / 4)) * (Math.PI / 4);
                                newEndX = startX + Math.cos(snapA) * curD;
                                newEndY = startY + Math.sin(snapA) * curD;
                            }
                            this.masks.createLinearMask(startX, startY, newEndX, newEndY, feather, invert);
                        } else if (dragMode === 'linear-rotate') {
                            const curD = Math.max(10, Math.hypot(endX - startX, endY - startY) * 0.5);
                            let rotA = Math.atan2(y - midY, x - midX);
                            if (e.shiftKey) {
                                rotA = Math.round(rotA / (Math.PI / 4)) * (Math.PI / 4);
                            }
                            this.masks.createLinearMask(
                                midX - Math.cos(rotA) * curD,
                                midY - Math.sin(rotA) * curD,
                                midX + Math.cos(rotA) * curD,
                                midY + Math.sin(rotA) * curD,
                                feather,
                                invert
                            );
                        } else if (dragMode === 'linear-create') {
                            const start = this._maskDragStart || { x, y };
                            let endPtX = x;
                            let endPtY = y;
                            if (e.shiftKey) {
                                const curD = Math.hypot(endPtX - start.x, endPtY - start.y);
                                const snapA = Math.round(Math.atan2(endPtY - start.y, endPtX - start.x) / (Math.PI / 4)) * (Math.PI / 4);
                                endPtX = start.x + Math.cos(snapA) * curD;
                                endPtY = start.y + Math.sin(snapA) * curD;
                            }
                            this.masks.createLinearMask(start.x, start.y, endPtX, endPtY, 0.5, false);
                        }
                        this.renderWithMask(true);
                        this.updateMaskGuides();
                    } else if (layer?.shape && tool === 'radial') {
                        const { centerX, centerY, angle = 0, feather = 0.5, invert = false } = layer.shape;
                        const rx = layer.shape.radiusX || 100;
                        const ry = layer.shape.radiusY || 100;
                        const rot = angle || 0;

                        const relX = x - centerX;
                        const relY = y - centerY;
                        const cosA = Math.cos(rot);
                        const sinA = Math.sin(rot);
                        const lx = relX * cosA + relY * sinA;
                        const ly = -relX * sinA + relY * cosA;

                        if (dragMode === 'move' && this._lastPinPos) {
                            const dx = x - this._lastPinPos.x;
                            const dy = y - this._lastPinPos.y;
                            this._lastPinPos = { x, y };
                            this.masks.createRadialMask(centerX + dx, centerY + dy, rx, ry, rot, feather, invert);
                        } else if (dragMode === 'radial-right' || dragMode === 'radial-left') {
                            const newRx = Math.max(10, Math.abs(lx));
                            const newRy = e.shiftKey ? newRx : ry;
                            this.masks.createRadialMask(centerX, centerY, newRx, newRy, rot, feather, invert);
                        } else if (dragMode === 'radial-top' || dragMode === 'radial-bottom') {
                            const newRy = Math.max(10, Math.abs(ly));
                            const newRx = e.shiftKey ? newRy : rx;
                            this.masks.createRadialMask(centerX, centerY, newRx, newRy, rot, feather, invert);
                        } else if (dragMode === 'radial-rotate') {
                            let newAngle = Math.atan2(x - centerX, -(y - centerY));
                            if (e.shiftKey) {
                                newAngle = Math.round(newAngle / (Math.PI / 12)) * (Math.PI / 12);
                            }
                            this.masks.createRadialMask(centerX, centerY, rx, ry, newAngle, feather, invert);
                        } else if (dragMode === 'radial-scale') {
                            const factor = Math.max(0.05, Math.hypot(lx / rx, ly / ry));
                            this.masks.createRadialMask(centerX, centerY, Math.max(10, Math.round(rx * factor)), Math.max(10, Math.round(ry * factor)), rot, feather, invert);
                        } else if (dragMode === 'radial-create') {
                            const start = this._maskDragStart || { x, y };
                            const diffX = x - start.x;
                            const diffY = y - start.y;
                            let newRx = Math.max(10, Math.abs(diffX));
                            let newRy = Math.max(10, Math.abs(diffY));
                            if (e.shiftKey) {
                                const circR = Math.max(10, Math.hypot(diffX, diffY));
                                newRx = circR;
                                newRy = circR;
                            }
                            this.masks.createRadialMask(start.x, start.y, newRx, newRy, 0, 0.5, false);
                        }
                        this.renderWithMask(true);
                        this.updateMaskGuides();
                    }
                } else if (['radial', 'gradient'].includes(tool)) {
                    // Update hover cursor based on handle hit test
                    const layer = this.masks?.getActiveLayer?.();
                    if (layer?.shape) {
                        const scale = rect.width > 0 ? (this.gpu.width / rect.width) : 1;
                        const hitThreshold = 18 * scale;
                        let hoverCursor = 'crosshair';

                        if (tool === 'gradient') {
                            const { startX, startY, endX, endY } = layer.shape;
                            const midX = (startX + endX) * 0.5;
                            const midY = (startY + endY) * 0.5;
                            const dist = Math.hypot(endX - startX, endY - startY);
                            const ang = Math.atan2(endY - startY, endX - startX);
                            const lx = (x - midX) * Math.cos(ang) + (y - midY) * Math.sin(ang);
                            const ly = -(x - midX) * Math.sin(ang) + (y - midY) * Math.cos(ang);

                            if (Math.hypot(lx, ly) <= hitThreshold) {
                                hoverCursor = 'move';
                            } else if (Math.hypot(lx - (-dist * 0.5), ly) <= hitThreshold || Math.hypot(lx - dist * 0.5, ly) <= hitThreshold) {
                                hoverCursor = 'pointer';
                            } else if (Math.abs(lx) <= hitThreshold) {
                                hoverCursor = 'grab';
                            }
                        } else if (tool === 'radial') {
                            const { centerX, centerY, angle = 0 } = layer.shape;
                            const rx = layer.shape.radiusX || 100;
                            const ry = layer.shape.radiusY || 100;
                            const stemLen = Math.max(18, Math.round(26 * scale));
                            const relX = x - centerX;
                            const relY = y - centerY;
                            const lx = relX * Math.cos(angle) + relY * Math.sin(angle);
                            const ly = -relX * Math.sin(angle) + relY * Math.cos(angle);

                            if (Math.hypot(lx, ly) <= hitThreshold) {
                                hoverCursor = 'move';
                            } else if (Math.hypot(lx, ly - (-ry - stemLen)) <= hitThreshold) {
                                hoverCursor = 'grab';
                            } else if (Math.hypot(lx, ly - (-ry)) <= hitThreshold || Math.hypot(lx, ly - ry) <= hitThreshold) {
                                hoverCursor = 'ns-resize';
                            } else if (Math.hypot(lx - rx, ly) <= hitThreshold || Math.hypot(lx - (-rx), ly) <= hitThreshold) {
                                hoverCursor = 'ew-resize';
                            } else if (Math.abs(Math.hypot(lx / rx, ly / ry) - 1.0) * Math.min(rx, ry) <= hitThreshold) {
                                hoverCursor = 'pointer';
                            }
                        }
                        canvas.style.cursor = hoverCursor;
                    }
                }
            });

            canvasArea.addEventListener('mouseenter', () => {
                if (this.state.currentTool === 'brush') {
                    if (this.elements.brushCursor) this.elements.brushCursor.style.display = 'block';
                    this.updateBrushCursor();
                }
            });

            canvasArea.addEventListener('mouseleave', () => {
                const badge = document.getElementById('wb-sample-badge');
                if (badge) badge.style.display = 'none';
                if (this.elements.brushCursor) this.elements.brushCursor.style.display = 'none';
            });
        }

        if (canvas) {
            canvas.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // Only primary mouse button

                // White Balance Eyedropper sampling
                if (this.isWBPicking) {
                    const rect = canvas.getBoundingClientRect();
                    const x = (e.clientX - rect.left) * (this.gpu.width / rect.width);
                    const y = (e.clientY - rect.top) * (this.gpu.height / rect.height);
                    this.applyWhiteBalanceSample(x, y);
                    return;
                }

                if (this.zoomPanModule?.zoom?.isPanning) return; // Ignore during Space-panning

                const tool = this.state.currentTool;
                if (!['brush', 'radial', 'gradient'].includes(tool)) return;

                const activeLayer = this.masks?.getActiveLayer?.();
                if (!activeLayer || activeLayer.type !== tool) {
                    const existingIndex = this.masks?.layers ? this.masks.layers.findIndex(l => l.type === tool) : -1;
                    if (existingIndex >= 0) {
                        this.masks.activeLayerIndex = existingIndex;
                    } else {
                        this.masks?.createLayer?.(tool);
                    }
                    this.updateLayersList();
                    this.syncLayerUI();
                }

                const rect = canvas.getBoundingClientRect();
                const rawX = (e.clientX - rect.left) * (this.gpu.width / rect.width);
                const rawY = (e.clientY - rect.top) * (this.gpu.height / rect.height);
                const x = Math.max(0, Math.min(this.gpu.width, rawX));
                const y = Math.max(0, Math.min(this.gpu.height, rawY));
                const scale = rect.width > 0 ? (this.gpu.width / rect.width) : 1;
                const hitThreshold = 18 * scale;

                this._maskDragMode = null;
                this._lastPinPos = { x, y };
                this._maskDragStart = { x, y };

                const currentLayer = this.masks?.getActiveLayer?.();
                if (currentLayer?.shape) {
                    if (tool === 'gradient') {
                        const { startX, startY, endX, endY } = currentLayer.shape;
                        const midX = (startX + endX) * 0.5;
                        const midY = (startY + endY) * 0.5;
                        const dist = Math.hypot(endX - startX, endY - startY);
                        const ang = Math.atan2(endY - startY, endX - startX);
                        const lx = (x - midX) * Math.cos(ang) + (y - midY) * Math.sin(ang);
                        const ly = -(x - midX) * Math.sin(ang) + (y - midY) * Math.cos(ang);

                        if (Math.hypot(lx, ly) <= hitThreshold) {
                            this._maskDragMode = 'move';
                        } else if (Math.hypot(lx - (-dist * 0.5), ly) <= hitThreshold) {
                            this._maskDragMode = 'linear-start';
                        } else if (Math.hypot(lx - dist * 0.5, ly) <= hitThreshold) {
                            this._maskDragMode = 'linear-end';
                        } else if (Math.abs(lx) <= hitThreshold) {
                            this._maskDragMode = 'linear-rotate';
                        } else {
                            this._maskDragMode = 'linear-create';
                        }
                    } else if (tool === 'radial') {
                        const { centerX, centerY, angle = 0 } = currentLayer.shape;
                        const rx = currentLayer.shape.radiusX || 100;
                        const ry = currentLayer.shape.radiusY || 100;
                        const stemLen = Math.max(18, Math.round(26 * scale));
                        const relX = x - centerX;
                        const relY = y - centerY;
                        const lx = relX * Math.cos(angle) + relY * Math.sin(angle);
                        const ly = -relX * Math.sin(angle) + relY * Math.cos(angle);

                        if (Math.hypot(lx, ly) <= hitThreshold) {
                            this._maskDragMode = 'move';
                        } else if (Math.hypot(lx, ly - (-ry - stemLen)) <= hitThreshold) {
                            this._maskDragMode = 'radial-rotate';
                        } else if (Math.hypot(lx, ly - (-ry)) <= hitThreshold) {
                            this._maskDragMode = 'radial-top';
                        } else if (Math.hypot(lx, ly - ry) <= hitThreshold) {
                            this._maskDragMode = 'radial-bottom';
                        } else if (Math.hypot(lx - rx, ly) <= hitThreshold) {
                            this._maskDragMode = 'radial-right';
                        } else if (Math.hypot(lx - (-rx), ly) <= hitThreshold) {
                            this._maskDragMode = 'radial-left';
                        } else if (Math.abs(Math.hypot(lx / rx, ly / ry) - 1.0) * Math.min(rx, ry) <= hitThreshold) {
                            this._maskDragMode = 'radial-scale';
                        } else {
                            this._maskDragMode = 'radial-create';
                        }
                    }
                } else {
                    if (tool === 'gradient') this._maskDragMode = 'linear-create';
                    if (tool === 'radial') this._maskDragMode = 'radial-create';
                }

                this.state.setPainting(true, { x, y });

                if (tool === 'brush') {
                    this.hideMaskGuides();
                    this.masks.paintBrush(x, y);
                    this.renderWithMask(true);
                } else if (this._maskDragMode === 'radial-create') {
                    this.masks.createRadialMask(x, y, 10, 10, 0, 0.5, false);
                    this.renderWithMask(true);
                    this.updateMaskGuides();
                } else if (this._maskDragMode === 'linear-create') {
                    this.masks.createLinearMask(x, y, x + 1, y + 1, 0.5, false);
                    this.renderWithMask(true);
                    this.updateMaskGuides();
                }
            });

            const endMaskPainting = () => {
                if (this.state.isPainting) {
                    this.state.setPainting(false, null);
                    this._maskDragStart = null;
                    this._maskDragMode = null;
                    this._lastPinPos = null;
                    if (this.state.hasImage) {
                        this.renderWithMask(false);
                        this.layersModule?.updateThumbnails?.();
                        this.updateMaskGuides();
                        this._pushHistoryDebounced();
                    }
                }
            };

            canvas.addEventListener('mouseup', endMaskPainting);
            window.addEventListener('mouseup', endMaskPainting);
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
        const valEl = document.getElementById('val-brush-size');
        if (valEl) valEl.textContent = this.masks.brushSettings.size;
        this.updateBrushCursor();
        this.updateBrushSizeIndicator(this.masks.brushSettings.size);
    }

    /**
     * Adjust brush hardness / feather by delta
     */
    adjustBrushHardness(delta) {
        if (!this.masks?.brushSettings) return;
        const currentHardness = this.masks.brushSettings.hardness !== undefined ? this.masks.brushSettings.hardness : 50;
        const newHardness = Math.max(0, Math.min(100, currentHardness + delta));
        this.masks.brushSettings.hardness = newHardness;
        this.state.setBrushSetting('hardness', newHardness);
        const slider = document.getElementById('slider-brush-hardness');
        if (slider) slider.value = newHardness;
        const valEl = document.getElementById('val-brush-hardness');
        if (valEl) valEl.textContent = newHardness;
        this.updateBrushPreview();
        this.updateBrushCursor();
    }

    /**
     * Cycle through mask overlay colors (Shift+O)
     */
    cycleMaskOverlayColor() {
        this.layersModule.cycleOverlayColor();
    }

    /**
     * Invert active mask (Cmd/Ctrl+I)
     */
    invertActiveMask() {
        this.layersModule.invertActiveMask();
    }

    /**
     * Duplicate active mask layer (Cmd/Ctrl+J)
     */
    duplicateActiveMaskLayer() {
        this.layersModule.duplicateActiveLayer();
    }

    /**
     * Delete active mask layer (Del/Backspace)
     */
    deleteActiveMaskLayer() {
        this.layersModule.deleteActiveLayer();
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
     * Deactivate ALL overlay tools (liquify, healing, clone, bg-remove)
     * Called at the start of every mode switch to prevent image overlap
     */
    _deactivateAllOverlayTools() {
        this.liquifyModule?.deactivate();
        this.healingModule?.deactivate();
        this.cloneModule?.deactivate();
        this.bgRemovalModule?.deactivate();
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
     * Activate god rays tool
     */
    _activateGodRaysTool() {
        this.godRaysModule.activate();
    }

    /**
     * Deactivate god rays tool
     */
    _deactivateGodRaysTool() {
        this.godRaysModule.deactivate();
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
                // Cancel pending debounced push before pushing manual snapshot (Law 1)
                clearTimeout(this._historyDebounceTimer);

                // Save state BEFORE reset for undo support
                const snapshot = this._captureFullState();
                this.history.pushState(snapshot);

                this.globalSliders.forEach(name => {
                    const slider = document.getElementById(`slider-${name}`);
                    const valueDisplay = document.getElementById(`val-${name}`);
                    if (slider) {
                        slider.value = 0;
                        valueDisplay.textContent = name === 'exposure' ? '0.00' : '0';
                    }
                    if (name in this.gpu.params) {
                        this.gpu.params[name] = 0;
                    }
                });
                this.gpu.render();
                this.state.resetAdjustments();

                // H3 FIX: Also reset HSL, Tone Curves, Color Grading, and Presets
                if (this.hslModule?.reset) this.hslModule.reset();
                if (this.toneCurveModule?.reset) this.toneCurveModule.reset();
                if (this.colorGradingModule?.resetToDefaults) this.colorGradingModule.resetToDefaults();
                if (this.lutModule?.reset) this.lutModule.reset();
                if (this.presetsModule) {
                    this.presetsModule.activePresetId = null;
                    this.presetsModule._updateActivePresetUI?.();
                }

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

                // Reset masks on new file load to prevent dimensions/state mismatch
                if (this.masks) {
                    if (typeof this.masks.reset === 'function') {
                        this.masks.reset();
                    } else {
                        this.masks.layers = [];
                        this.masks.activeLayerIndex = -1;
                    }
                }
                this.updateLayersList();
                this.syncLayerUI();

                // Notify mask system of dimension change so it can update textures
                if (this.masks && typeof this.masks.onImageDimensionsChanged === 'function') {
                    this.masks.onImageDimensionsChanged();
                }

                this.elements.dropZone?.classList.add('hidden');
                this.elements.perfIndicator.textContent = `${img.width}×${img.height}`;
                setTimeout(() => this.renderHistogram(), 100);

                // Detect transparency and show checkerboard if needed
                this._detectAndShowTransparency(img);

                // Push initial state to history for undo support
                this.history.clear();
                this._pushHistoryDebounced();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    /**
     * Detect if image has transparency and show/hide checkerboard background
     */
    _detectAndShowTransparency(img) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(img.width, 100); // Sample a smaller area for performance
        canvas.height = Math.min(img.height, 100);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        let hasTransparency = false;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 250) { // Alpha less than ~98% = transparent
                hasTransparency = true;
                break;
            }
        }

        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            if (hasTransparency) {
                canvasContainer.classList.add('transparency-bg');
            } else {
                canvasContainer.classList.remove('transparency-bg');
            }
        }

        // Store transparency state
        this.state.hasTransparency = hasTransparency;
    }

    /**
     * Render with mask overlay
     * @param {boolean} showOverlay - Whether to show red mask overlay during painting
     * @param {boolean} immediate - Whether to render immediately or schedule via RAF
     */
    renderWithMask(showOverlay = false, immediate = false) {
        if (!this.gpu?.backend?.isReady) return;
        if (immediate) {
            this.gpu.render(null, showOverlay);
        } else {
            this.gpu.requestRender(null, showOverlay);
        }
    }

    /**
     * Toggle mask overlay visualization on/off
     */
    toggleMaskOverlay() {
        this.layersModule?.toggleOverlay();
    }

    /**
     * Throttled histogram update request
     * Coalesces updates during rapid slider dragging so the main thread is never blocked
     * @param {boolean} immediate - If true, cancels pending timer and executes immediately
     */
    requestHistogramUpdate(immediate = false) {
        if (!this.gpu?.inputTexture || !this.histogramCtx) return;

        if (immediate) {
            if (this._histThrottleTimer) {
                clearTimeout(this._histThrottleTimer);
                this._histThrottleTimer = null;
            }
            this._histPending = false;
            this.renderHistogram();
            return;
        }

        if (this._histThrottleTimer) {
            this._histPending = true;
            return;
        }

        this._histPending = false;
        this._histThrottleTimer = setTimeout(() => {
            this._histThrottleTimer = null;
            this.renderHistogram();
            if (this._histPending) {
                this.requestHistogramUpdate(false);
            }
        }, 80);
    }

    /**
     * Render histogram (ultra-fast sub-millisecond execution via downsampled GPU read)
     */
    renderHistogram() {
        if (!this.gpu.inputTexture || !this.histogramCtx) return;

        const canvas = this.elements.histogramCanvas;
        const ctx = this.histogramCtx;

        // Avoid setting canvas dimensions on every frame if unchanged (prevents context reset & reflow)
        const targetW = (canvas.offsetWidth || 256) * 2;
        if (canvas.width !== targetW) canvas.width = targetW;
        if (canvas.height !== 160) canvas.height = 160;
        const w = canvas.width;
        const h = canvas.height;

        // Ultra-fast sub-millisecond GPU-accelerated histogram data
        const histData = this.gpu.getHistogramData ? this.gpu.getHistogramData() : null;
        let data, step = 1, sampleCount = 0;

        if (histData && histData.data) {
            data = histData.data;
            step = 1;
        } else {
            // Fallback: fast strided sample across full canvas pixels without row flipping
            const fullData = this.gpu.backend?.readPixels ? this.gpu.backend.readPixels() : this.gpu.toImageData()?.data;
            if (!fullData) return;
            data = fullData;
            const totalPixels = data.length / 4;
            step = Math.max(1, Math.floor(totalPixels / 65536));
        }

        const r = new Uint32Array(256);
        const g = new Uint32Array(256);
        const b = new Uint32Array(256);
        const lum = new Uint32Array(256);

        const byteStep = step * 4;
        for (let i = 0; i < data.length; i += byteStep) {
            const red = data[i];
            const grn = data[i + 1];
            const blu = data[i + 2];
            r[red]++;
            g[grn]++;
            b[blu]++;
            const L = Math.round(0.299 * red + 0.587 * grn + 0.114 * blu);
            lum[L]++;
            sampleCount++;
        }

        if (sampleCount === 0) return;

        let maxVal = 0;
        for (let i = 5; i < 250; i++) {
            maxVal = Math.max(maxVal, r[i], g[i], b[i], lum[i]);
        }
        if (maxVal === 0) maxVal = 1;

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

        // Update Tone Curve histogram
        if (this.toneCurveModule) {
            this.toneCurveModule.setHistogramData({
                luminosity: lum,
                rgb: lum,
                red: r,
                green: g,
                blue: b
            });
        }

        // Update clipping indicators (Lightroom style)
        const hasShadowClipping = lum[0] > (sampleCount * 0.0003);
        const hasHighlightClipping = lum[255] > (sampleCount * 0.0003);

        const btnShadows = document.getElementById('btn-clip-shadows');
        const btnHighlights = document.getElementById('btn-clip-highlights');
        if (btnShadows) {
            btnShadows.classList.toggle('has-clipping', hasShadowClipping);
            btnShadows.classList.toggle('active', Boolean(this.gpu?.clippingWarnings && this.gpu?.clipShadows));
        }
        if (btnHighlights) {
            btnHighlights.classList.toggle('has-clipping', hasHighlightClipping);
            btnHighlights.classList.toggle('active', Boolean(this.gpu?.clippingWarnings && this.gpu?.clipHighlights));
        }
    }

    /**
     * Initialize exposure clipping indicator buttons
     */
    _initClippingControls() {
        const btnShadows = document.getElementById('btn-clip-shadows');
        const btnHighlights = document.getElementById('btn-clip-highlights');

        if (btnShadows) {
            btnShadows.addEventListener('click', (e) => {
                e.stopPropagation();
                this.gpu?.toggleClippingWarnings?.('shadows');
                this.renderHistogram();
            });
        }

        if (btnHighlights) {
            btnHighlights.addEventListener('click', (e) => {
                e.stopPropagation();
                this.gpu?.toggleClippingWarnings?.('highlights');
                this.renderHistogram();
            });
        }
    }

    /**
     * Toggle exposure clipping warnings on canvas (Lightroom J hotkey)
     */
    toggleClippingWarnings(type = 'both') {
        if (!this.gpu) return;
        this.gpu.toggleClippingWarnings(type);
        this.renderHistogram();
    }

    /**
     * Initialize White Balance Eyedropper tool
     */
    _initWBPicker() {
        const btn = document.getElementById('btn-wb-picker');
        if (btn) {
            btn.addEventListener('click', () => {
                this.toggleWBPicker();
            });
        }
    }

    /**
     * Toggle White Balance eyedropper
     */
    toggleWBPicker() {
        if (this.isWBPicking) {
            this.deactivateWBPicker();
        } else {
            this.activateWBPicker();
        }
    }

    /**
     * Activate White Balance eyedropper mode
     */
    activateWBPicker() {
        if (!this.state.hasImage) return;
        this.isWBPicking = true;
        const btn = document.getElementById('btn-wb-picker');
        if (btn) btn.classList.add('active');
        const canvasArea = document.querySelector('.canvas-area');
        if (canvasArea) canvasArea.classList.add('is-wb-picking');

        let badge = document.getElementById('wb-sample-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'wb-sample-badge';
            badge.className = 'wb-sample-badge';
            document.body.appendChild(badge);
        }
    }

    /**
     * Deactivate White Balance eyedropper mode
     */
    deactivateWBPicker() {
        this.isWBPicking = false;
        const btn = document.getElementById('btn-wb-picker');
        if (btn) btn.classList.remove('active');
        const canvasArea = document.querySelector('.canvas-area');
        if (canvasArea) canvasArea.classList.remove('is-wb-picking');
        const badge = document.getElementById('wb-sample-badge');
        if (badge) badge.style.display = 'none';
    }

    /**
     * Sample 5x5 neighborhood from base image
     */
    _sampleBasePixel(canvasX, canvasY) {
        if (!this.state.originalImage) return null;
        const img = this.state.originalImage;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;

        if (!this._wbSampleCanvas || this._wbSampleCanvas.width !== w || this._wbSampleCanvas.height !== h) {
            this._wbSampleCanvas = document.createElement('canvas');
            this._wbSampleCanvas.width = w;
            this._wbSampleCanvas.height = h;
            this._wbSampleCtx = this._wbSampleCanvas.getContext('2d', { willReadFrequently: true });
            this._wbSampleCtx.drawImage(img, 0, 0);
        }

        const half = 2;
        const startX = Math.max(0, Math.min(w - 5, Math.round(canvasX) - half));
        const startY = Math.max(0, Math.min(h - 5, Math.round(canvasY) - half));
        const imgData = this._wbSampleCtx.getImageData(startX, startY, 5, 5);
        const data = imgData.data;

        let sumR = 0, sumG = 0, sumB = 0;
        const count = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
            sumR += data[i];
            sumG += data[i + 1];
            sumB += data[i + 2];
        }

        return {
            r: sumR / count,
            g: sumG / count,
            b: sumB / count
        };
    }

    /**
     * Compute and apply auto-neutralized White Balance from sampled pixel
     */
    applyWhiteBalanceSample(canvasX, canvasY) {
        const sample = this._sampleBasePixel(canvasX, canvasY);
        if (!sample) return;

        const { r, g, b } = sample;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 5 || lum > 250) {
            this.deactivateWBPicker();
            return;
        }

        const tempDelta = Math.round(Math.max(-100, Math.min(100, ((b - r) / lum) * 115)));
        const tintDelta = Math.round(Math.max(-100, Math.min(100, (((r + b) * 0.5 - g) / lum) * 90)));

        this.state.setAdjustment('temperature', tempDelta);
        this.state.setAdjustment('tint', tintDelta);
        this.gpu.setParam('temperature', tempDelta);
        this.gpu.setParam('tint', tintDelta);

        const tempSlider = document.getElementById('slider-temperature');
        const tintSlider = document.getElementById('slider-tint');
        const tempVal = document.getElementById('val-temperature');
        const tintVal = document.getElementById('val-tint');

        if (tempSlider) tempSlider.value = tempDelta;
        if (tintSlider) tintSlider.value = tintDelta;
        if (tempVal) tempVal.textContent = tempDelta;
        if (tintVal) tintVal.textContent = tintDelta;

        this.gpu.render();
        this.renderHistogram();
        this._pushHistoryDebounced();
        this.deactivateWBPicker();
    }

    /**
     * Update layers list in UI
     */
    updateLayersList() {
        this.layersModule?.updateList();
    }

    /**
     * Aliases for layer list updating to prevent any runtime TypeErrors
     */
    _updateLayerList() {
        this.updateLayersList();
    }

    updateLayerList() {
        this.updateLayersList();
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
        const size = this.masks?.brushSettings?.size || 100;
        const rect = this.elements.canvas?.getBoundingClientRect();
        const scale = (rect && this.gpu?.width) ? (rect.width / this.gpu.width) : 1;
        const screenDiameter = Math.max(4, Math.round(size * scale));
        cursor.style.width = `${screenDiameter}px`;
        cursor.style.height = `${screenDiameter}px`;

        const isEraser = Boolean(this.masks?.brushSettings?.erase);
        cursor.classList.toggle('is-eraser', isEraser);

        const innerCursor = document.getElementById('brush-cursor-inner');
        if (innerCursor) {
            // Feather slider in UI: 0 = hard, 100 = soft
            // Hardness ratio: (100 - feather) / 100
            const featherVal = this.masks?.brushSettings?.hardness !== undefined ? this.masks.brushSettings.hardness : 50;
            const hardnessRatio = Math.max(0.05, Math.min(1.0, (100 - featherVal) / 100));
            const innerSize = Math.max(2, Math.round(screenDiameter * hardnessRatio));
            innerCursor.style.width = `${innerSize}px`;
            innerCursor.style.height = `${innerSize}px`;
        }
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
        if (!previewCircle || !this.masks?.brushSettings) return;
        const featherVal = this.masks.brushSettings.hardness !== undefined ? this.masks.brushSettings.hardness : 50;
        const hardnessRatio = (100 - featherVal) / 100;
        const stopPos = Math.max(5, Math.round(hardnessRatio * 75));
        previewCircle.style.background = `radial-gradient(circle, 
            rgba(255,255,255,0.95) 0%, 
            rgba(255,255,255,0.85) ${stopPos}%, 
            rgba(255,255,255,0) 100%)`;
    }

    /**
     * Update brush size indicator
     */
    updateBrushSizeIndicator(size) {
        const indicator = this.elements.brushSizeIndicator;
        if (indicator) indicator.textContent = `${size}px`;
    }

    /**
     * Hide Lightroom-style mask guidelines
     */
    hideMaskGuides() {
        const svg = document.getElementById('mask-guides-svg');
        if (svg) {
            svg.style.display = 'none';
            svg.innerHTML = '';
        }
    }

    /**
     * Update and render Lightroom-style mask guidelines for Linear and Radial masks
     */
    updateMaskGuides() {
        const svg = document.getElementById('mask-guides-svg');
        const canvas = this.elements.canvas;
        if (!svg || !canvas || !this.state.hasImage) {
            this.hideMaskGuides();
            return;
        }

        const layer = this.masks?.getActiveLayer?.();
        const isMaskMode = this.state.currentTab === 'masks' || ['radial', 'gradient', 'brush'].includes(this.state.currentTool);
        if (!isMaskMode || !layer || !layer.shape || !['radial', 'gradient'].includes(layer.type)) {
            this.hideMaskGuides();
            return;
        }

        const imgW = this.gpu.width;
        const imgH = this.gpu.height;
        if (!imgW || !imgH) {
            this.hideMaskGuides();
            return;
        }

        // Align SVG viewbox and bounds to canvas
        svg.style.display = 'block';
        svg.setAttribute('viewBox', `0 0 ${imgW} ${imgH}`);
        svg.style.width = `${canvas.offsetWidth}px`;
        svg.style.height = `${canvas.offsetHeight}px`;
        svg.style.left = `${canvas.offsetLeft}px`;
        svg.style.top = `${canvas.offsetTop}px`;

        if (layer.type === 'gradient') {
            const { startX, startY, endX, endY } = layer.shape;
            const dx = endX - startX;
            const dy = endY - startY;
            const dist = Math.hypot(dx, dy);

            const midX = (startX + endX) * 0.5;
            const midY = (startY + endY) * 0.5;
            const rotDeg = Math.atan2(dy, dx) * (180 / Math.PI);

            const scale = canvas.offsetWidth > 0 ? (imgW / canvas.offsetWidth) : 1;
            const pinRadius = Math.max(5, Math.round(7 * scale));
            const handleRadius = Math.max(4, Math.round(5.5 * scale));
            const lineLen = Math.max(imgW, imgH) * 1.5;
            const arrowHead = Math.max(6, Math.round(8 * scale));

            svg.innerHTML = `
                <g transform="translate(${midX}, ${midY}) rotate(${rotDeg})">
                    <!-- Direction arrow line (Start to End) -->
                    <line x1="${-dist * 0.5}" y1="0" x2="${dist * 0.5}" y2="0" class="mask-guide-arrow" fill="none" />
                    <!-- Direction arrowhead at End -->
                    <polygon points="${dist * 0.5},0 ${dist * 0.5 - arrowHead},${-arrowHead * 0.55} ${dist * 0.5 - arrowHead},${arrowHead * 0.55}" fill="rgba(255,255,255,0.95)" />

                    <!-- 100% Start boundary line (Full effect) -->
                    <line x1="${-dist * 0.5}" y1="${-lineLen}" x2="${-dist * 0.5}" y2="${lineLen}" class="mask-guide-line-solid" fill="none" />
                    <circle cx="${-dist * 0.5}" cy="0" r="${handleRadius}" class="mask-guide-handle" title="Start boundary (100% effect)" />

                    <!-- 50% Midpoint Center line -->
                    <line x1="0" y1="${-lineLen}" x2="0" y2="${lineLen}" class="mask-guide-line-center" fill="none" />
                    <!-- Center Pin Handle -->
                    <circle cx="0" cy="0" r="${pinRadius}" class="mask-guide-pin" title="Drag to reposition gradient" />

                    <!-- 0% End boundary line (Fade boundary) -->
                    <line x1="${dist * 0.5}" y1="${-lineLen}" x2="${dist * 0.5}" y2="${lineLen}" class="mask-guide-line" fill="none" />
                    <circle cx="${dist * 0.5}" cy="0" r="${handleRadius}" class="mask-guide-handle" title="End boundary (0% effect)" />
                </g>
            `;
        } else if (layer.type === 'radial') {
            const { centerX, centerY } = layer.shape;
            const rx = layer.shape.radiusX || (layer.shape.outerRadius ? layer.shape.outerRadius * (layer.shape.outerRadius < 2 ? imgH : 1) : Math.round(imgW * 0.25));
            const ry = layer.shape.radiusY || (layer.shape.outerRadius ? layer.shape.outerRadius * (layer.shape.outerRadius < 2 ? imgH : 1) : Math.round(imgH * 0.2));
            const rotDeg = (layer.shape.angle || 0) * (180 / Math.PI);
            const feather = typeof layer.shape.feather === 'number' ? layer.shape.feather : 0.5;
            const innerRx = Math.max(2, Math.round(rx * (1.0 - feather)));
            const innerRy = Math.max(2, Math.round(ry * (1.0 - feather)));

            const scale = canvas.offsetWidth > 0 ? (imgW / canvas.offsetWidth) : 1;
            const pinRadius = Math.max(5, Math.round(7 * scale));
            const handleRadius = Math.max(3.5, Math.round(5 * scale));
            const stemLen = Math.max(18, Math.round(26 * scale));

            svg.innerHTML = `
                <g transform="translate(${centerX}, ${centerY}) rotate(${rotDeg})">
                    <!-- Outer boundary (0% effect edge) -->
                    <ellipse cx="0" cy="0" rx="${rx}" ry="${ry}" class="mask-guide-line-solid" fill="none" />
                    
                    <!-- Inner boundary (100% effect edge / feather start) -->
                    <ellipse cx="0" cy="0" rx="${innerRx}" ry="${innerRy}" class="mask-guide-line" fill="none" />
                    
                    <!-- Center Pin Handle -->
                    <circle cx="0" cy="0" r="${pinRadius}" class="mask-guide-pin" title="Drag to reposition radial mask" />
                    
                    <!-- 4 Cardinal Handles (Top, Bottom, Left, Right) -->
                    <circle cx="0" cy="${-ry}" r="${handleRadius}" class="mask-guide-handle" title="Drag to adjust height" />
                    <circle cx="0" cy="${ry}" r="${handleRadius}" class="mask-guide-handle" title="Drag to adjust height" />
                    <circle cx="${-rx}" cy="0" r="${handleRadius}" class="mask-guide-handle" title="Drag to adjust width" />
                    <circle cx="${rx}" cy="0" r="${handleRadius}" class="mask-guide-handle" title="Drag to adjust width" />

                    <!-- Rotation Stem & Handle (Lightroom style) -->
                    <line x1="0" y1="${-ry}" x2="0" y2="${-ry - stemLen}" class="mask-guide-arrow" fill="none" />
                    <circle cx="0" cy="${-ry - stemLen}" r="${handleRadius}" class="mask-guide-pin" style="fill: #3b82f6;" title="Drag to rotate" />
                </g>
            `;
        }
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

    /**
     * Display a floating feedback toast notification
     * @param {string} message - Notification text
     * @param {'success'|'info'|'warning'|'error'} type - Notification style
     * @param {number} duration - Display time in ms
     */
    showToast(message, type = 'success', duration = 2200) {
        let container = document.getElementById('editor-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'editor-toast-container';
            container.className = 'editor-toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `editor-toast toast-${type}`;

        const iconMap = {
            success: '✓',
            info: 'ℹ',
            warning: '⚠',
            error: '✕'
        };

        const icon = document.createElement('span');
        icon.className = 'editor-toast-icon';
        icon.textContent = iconMap[type] || '✓';

        const text = document.createElement('span');
        text.className = 'editor-toast-text';
        text.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(text);
        container.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto dismiss
        const dismiss = () => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
                if (container.children.length === 0) {
                    container.remove();
                }
            }, 250);
        };

        const timer = setTimeout(dismiss, duration);
        toast.addEventListener('click', () => {
            clearTimeout(timer);
            dismiss();
        });
    }
}

