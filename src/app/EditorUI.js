/**
 * EditorUI - UI management for the GPU Editor
 * Handles all DOM interactions, event bindings, and UI updates
 */
import { CropTool } from '../tools/CropTool.js';
import { HistoryManager } from './HistoryManager.js';
import { ImageUpscaler } from '../ml/ImageUpscaler.js';
import { LiquifyTool } from '../tools/LiquifyTool.js';
import { HealingTool } from '../tools/HealingTool.js';
import { replicateService } from '../services/ReplicateService.js';

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

        // Initialize crop tool
        this.cropTool = null;

        // Applied crop state (persists across mode changes)
        this.appliedCrop = null;

        // Initialize undo/redo history manager
        this.history = new HistoryManager(50);
        this._historyDebounceTimer = null;

        // Zoom and Pan state
        this.zoom = {
            level: 1,
            min: 0.1,
            max: 5,
            step: 0.1,
            panX: 0,
            panY: 0,
            isPanning: false
        };

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
        this._initCropControls();
        this._initCanvasEvents();
        this._initKeyboardShortcuts();
        this._initFileHandling();
        this._initActionButtons();
        this._initZoomControls();
        this._initZoomEvents();
        this._initPanEvents();
        this._initComparisonSlider();
        this._initUpscaleControls();
        this._initLiquifyControls();
        this._initHealingControls();
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
     * Initialize crop tool controls
     */
    _initCropControls() {
        // Aspect ratio buttons
        document.querySelectorAll('.aspect-ratio-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                document.querySelectorAll('.aspect-ratio-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Set aspect ratio on crop tool
                const ratioStr = btn.dataset.ratio;
                let ratio = null;

                if (ratioStr === '1:1') ratio = 1;
                else if (ratioStr === '4:3') ratio = 4 / 3;
                else if (ratioStr === '3:2') ratio = 3 / 2;
                else if (ratioStr === '16:9') ratio = 16 / 9;
                else if (ratioStr === '2:1') ratio = 2;
                else if (ratioStr === '5:4') ratio = 5 / 4;
                else if (ratioStr === '9:16') ratio = 9 / 16;
                else if (ratioStr === '2:3') ratio = 2 / 3;
                // 'free' = null

                this.cropTool?.setAspectRatio(ratio);
            });
        });

        // Grid toggle
        const gridToggle = document.getElementById('crop-grid-toggle');
        if (gridToggle) {
            gridToggle.addEventListener('change', () => {
                this.cropTool?.toggleGrid(gridToggle.checked);
            });
        }

        // Apply crop button
        const btnApply = document.getElementById('btn-crop-apply');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.applyCrop());
        }

        // Cancel crop button
        const btnCancel = document.getElementById('btn-crop-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => this.cancelCrop());
        }

        // Editable dimensions input
        this._initCropDimensionsInput();

        // Rotation slider - with real-time preview
        const rotationSlider = document.getElementById('slider-crop-rotation');
        const rotationValue = document.getElementById('val-crop-rotation');
        if (rotationSlider && rotationValue) {
            rotationSlider.addEventListener('input', () => {
                const angle = parseFloat(rotationSlider.value);
                rotationValue.textContent = `${angle}°`;
                this.cropRotation = angle;
                this._applyTransformPreview();
                // Sync crop overlay with canvas rotation
                this.cropTool?.setRotation(angle);
            });

            rotationSlider.addEventListener('dblclick', () => {
                rotationSlider.value = 0;
                rotationValue.textContent = '0°';
                this.cropRotation = 0;
                this._applyTransformPreview();
                this.cropTool?.setRotation(0);
            });
        }

        // Rotation increment/decrement buttons for accessibility
        const btnRotateMinus = document.getElementById('btn-rotate-minus');
        const btnRotatePlus = document.getElementById('btn-rotate-plus');

        const updateRotation = (delta) => {
            if (!rotationSlider || !rotationValue) return;
            let newValue = parseFloat(rotationSlider.value) + delta;
            // Clamp to slider bounds
            newValue = Math.max(-180, Math.min(180, newValue));
            rotationSlider.value = newValue;
            rotationValue.textContent = `${newValue}°`;
            this.cropRotation = newValue;
            this._applyTransformPreview();
            this.cropTool?.setRotation(newValue);
        };

        if (btnRotateMinus) {
            btnRotateMinus.addEventListener('click', () => updateRotation(-1));
        }

        if (btnRotatePlus) {
            btnRotatePlus.addEventListener('click', () => updateRotation(1));
        }

        // Flip buttons - with real-time preview
        const btnFlipH = document.getElementById('btn-flip-h');
        const btnFlipV = document.getElementById('btn-flip-v');

        if (btnFlipH) {
            btnFlipH.addEventListener('click', () => {
                this.cropFlipH = !this.cropFlipH;
                btnFlipH.classList.toggle('active', this.cropFlipH);
                this._applyTransformPreview();
            });
        }

        if (btnFlipV) {
            btnFlipV.addEventListener('click', () => {
                this.cropFlipV = !this.cropFlipV;
                btnFlipV.classList.toggle('active', this.cropFlipV);
                this._applyTransformPreview();
            });
        }

        // Reset transform button - with real-time preview
        const btnReset = document.getElementById('btn-reset-transform');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                // Reset rotation
                if (rotationSlider) {
                    rotationSlider.value = 0;
                    rotationValue.textContent = '0°';
                }
                this.cropRotation = 0;

                // Reset flips
                this.cropFlipH = false;
                this.cropFlipV = false;
                btnFlipH?.classList.remove('active');
                btnFlipV?.classList.remove('active');

                this._applyTransformPreview();
                this.cropTool?.setRotation(0);
            });
        }

        // Initialize transform states
        this.cropRotation = 0;
        this.cropFlipH = false;
        this.cropFlipV = false;
    }

    /**
     * Apply real-time CSS transform preview for rotation and flip
     */
    _applyTransformPreview() {
        const canvas = this.elements.canvas;
        if (!canvas) return;

        const transforms = [];

        // Apply rotation
        if (this.cropRotation && this.cropRotation !== 0) {
            transforms.push(`rotate(${this.cropRotation}deg)`);
        }

        // Apply flip
        const scaleX = this.cropFlipH ? -1 : 1;
        const scaleY = this.cropFlipV ? -1 : 1;
        if (scaleX !== 1 || scaleY !== 1) {
            transforms.push(`scale(${scaleX}, ${scaleY})`);
        }

        canvas.style.transform = transforms.length > 0 ? transforms.join(' ') : '';
        canvas.style.transformOrigin = 'center center';
    }

    /**
     * Clear transform preview (reset CSS transform)
     */
    _clearTransformPreview() {
        const canvas = this.elements.canvas;
        if (canvas) {
            canvas.style.transform = '';
        }
    }

    /**
     * Initialize editable crop dimensions input
     */
    _initCropDimensionsInput() {
        const display = document.getElementById('crop-dimensions-display');
        const input = document.getElementById('crop-dimensions-input');

        if (!display || !input) return;

        // Click on display to show input
        display.addEventListener('click', () => {
            if (!this.cropTool) return;

            const pixels = this.cropTool.getCropPixels();
            input.value = `${pixels.width}x${pixels.height}`;
            display.style.display = 'none';
            input.style.display = 'block';
            input.focus();
            input.select();
        });

        // Handle input submission
        const applyCustomDimensions = () => {
            const value = input.value.trim();
            // Parse formats: "800x600", "800*600", "800 600"
            const match = value.match(/^(\d+)\s*[x×*\s]\s*(\d+)$/i);

            if (match) {
                const width = parseInt(match[1]);
                const height = parseInt(match[2]);

                if (width > 0 && height > 0 && this.cropTool) {
                    this.cropTool.setCustomDimensions(width, height);
                }
            }

            // Hide input, show display
            input.style.display = 'none';
            display.style.display = 'inline';
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyCustomDimensions();
            } else if (e.key === 'Escape') {
                input.style.display = 'none';
                display.style.display = 'inline';
            }
        });

        input.addEventListener('blur', () => {
            // Hide input on blur
            input.style.display = 'none';
            display.style.display = 'inline';
        });
    }

    /**
     * Activate crop tool and show overlay
     */
    _activateCropTool() {
        if (!this.state.hasImage) {
            console.warn('No image loaded for cropping');
            return;
        }

        // Create crop tool if not exists
        if (!this.cropTool) {
            const canvasArea = document.querySelector('.canvas-area');
            this.cropTool = new CropTool(canvasArea, this.elements.canvas);
        }

        // Activate with callback for dimension updates
        this.cropTool.onUpdate = () => {
            this._updateCropDimensionsDisplay();
        };

        this.cropTool.activate();
        this._updateCropDimensionsDisplay();
    }

    /**
     * Apply crop to image
     */
    applyCrop() {
        if (!this.cropTool) return;

        // Save state BEFORE crop for undo support
        const snapshot = this._captureFullState();
        this.history.pushState(snapshot);

        const cropData = this.cropTool.apply();
        if (!cropData || cropData.width <= 0 || cropData.height <= 0) {
            console.warn('Invalid crop region');
            return;
        }

        // Store the crop data for export
        this.appliedCrop = cropData;

        // Add rotation and flip data
        cropData.rotation = this.cropRotation || 0;
        cropData.flipH = this.cropFlipH || false;
        cropData.flipV = this.cropFlipV || false;

        // Apply the crop to the image
        this._performCrop(cropData);

        // Stay in crop mode - don't switch to develop mode
        // The crop tool will be reactivated after the image is loaded

        console.log(`✅ Crop applied: ${cropData.width}×${cropData.height}${cropData.rotation ? ` @ ${cropData.rotation}°` : ''}`);
    }

    /**
     * Cancel crop and reset (stay in crop mode)
     */
    cancelCrop() {
        this.cropTool?.cancel();

        // Reset rotation and flip UI
        const rotationSlider = document.getElementById('slider-crop-rotation');
        const rotationValue = document.getElementById('val-crop-rotation');
        if (rotationSlider && rotationValue) {
            rotationSlider.value = 0;
            rotationValue.textContent = '0°';
        }
        this.cropRotation = 0;
        this.cropFlipH = false;
        this.cropFlipV = false;
        document.getElementById('btn-flip-h')?.classList.remove('active');
        document.getElementById('btn-flip-v')?.classList.remove('active');

        // Clear real-time transform preview
        this._clearTransformPreview();

        // Reactivate crop tool instead of switching mode
        if (this.state.hasImage) {
            this.cropTool?.activate();
            this._updateCropDimensionsDisplay();
        }
    }

    /**
     * Perform the actual crop operation with rotation and flip
     */
    _performCrop(cropData) {
        // Read current canvas pixels
        const gl = this.gpu.gl;
        const fullWidth = this.gpu.width;
        const fullHeight = this.gpu.height;

        // Read pixels from WebGL
        const pixels = new Uint8Array(fullWidth * fullHeight * 4);
        gl.readPixels(0, 0, fullWidth, fullHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Create ImageData from full canvas (flipping Y for WebGL)
        const fullTempCanvas = document.createElement('canvas');
        fullTempCanvas.width = fullWidth;
        fullTempCanvas.height = fullHeight;
        const fullTempCtx = fullTempCanvas.getContext('2d');
        const fullImageData = fullTempCtx.createImageData(fullWidth, fullHeight);

        for (let y = 0; y < fullHeight; y++) {
            const srcRow = (fullHeight - 1 - y) * fullWidth * 4;
            const dstRow = y * fullWidth * 4;
            for (let x = 0; x < fullWidth * 4; x++) {
                fullImageData.data[dstRow + x] = pixels[srcRow + x];
            }
        }
        fullTempCtx.putImageData(fullImageData, 0, 0);

        // Calculate output dimensions based on rotation
        const radians = (cropData.rotation || 0) * Math.PI / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));

        // If rotated, the bounding box changes
        let outputWidth, outputHeight;
        if (cropData.rotation && cropData.rotation !== 0) {
            outputWidth = Math.ceil(cropData.width * cos + cropData.height * sin);
            outputHeight = Math.ceil(cropData.height * cos + cropData.width * sin);
        } else {
            outputWidth = cropData.width;
            outputHeight = cropData.height;
        }

        // Create output canvas with proper dimensions
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = outputWidth;
        outputCanvas.height = outputHeight;
        const outputCtx = outputCanvas.getContext('2d');

        // Apply transformations
        outputCtx.save();
        outputCtx.translate(outputWidth / 2, outputHeight / 2);

        // Apply rotation
        if (cropData.rotation) {
            outputCtx.rotate(radians);
        }

        // Apply flip
        const scaleX = cropData.flipH ? -1 : 1;
        const scaleY = cropData.flipV ? -1 : 1;
        outputCtx.scale(scaleX, scaleY);

        // Draw cropped region centered
        outputCtx.drawImage(
            fullTempCanvas,
            cropData.x, cropData.y, cropData.width, cropData.height,
            -cropData.width / 2, -cropData.height / 2, cropData.width, cropData.height
        );
        outputCtx.restore();

        // Create new image from output canvas and reload
        const croppedImage = new Image();
        croppedImage.onload = () => {
            // Update state
            this.state.setImage(croppedImage);

            // Reload GPU processor with cropped image
            this.gpu.loadImage(croppedImage);

            // Clear any masks (they no longer align)
            this.masks.layers = [];
            this.masks.activeLayerIndex = -1;
            this.updateLayersList();

            // Update UI
            this.elements.perfIndicator.textContent = `${croppedImage.width}×${croppedImage.height}`;
            setTimeout(() => this.renderHistogram(), 100);

            // Clear applied crop (it's been applied)
            this.appliedCrop = null;

            // Reset rotation and flip UI after successful crop
            const rotationSlider = document.getElementById('slider-crop-rotation');
            const rotationValue = document.getElementById('val-crop-rotation');
            if (rotationSlider && rotationValue) {
                rotationSlider.value = 0;
                rotationValue.textContent = '0°';
            }
            this.cropRotation = 0;
            this.cropFlipH = false;
            this.cropFlipV = false;
            document.getElementById('btn-flip-h')?.classList.remove('active');
            document.getElementById('btn-flip-v')?.classList.remove('active');

            // Clear CSS transform preview (rotation/flip is now baked into image)
            this._clearTransformPreview();

            // Reactivate crop tool for the new image (stay in crop mode)
            setTimeout(() => {
                if (this.state.currentTool === 'crop') {
                    this.cropTool?.deactivate();
                    this._activateCropTool();
                }
            }, 150);
        };
        croppedImage.src = outputCanvas.toDataURL('image/png');
    }

    /**
     * Update crop dimensions display in panel
     */
    _updateCropDimensionsDisplay() {
        const display = document.getElementById('crop-dimensions-display');
        if (display && this.cropTool) {
            const pixels = this.cropTool.getCropPixels();
            display.textContent = `${pixels.width} × ${pixels.height}`;
        }
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
     * Initialize Liquify tool controls
     */
    _initLiquifyControls() {
        // Create canvas for liquify (overlay on main canvas)
        this.liquifyCanvas = document.createElement('canvas');
        this.liquifyCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            display: none;
        `;
        this.elements.canvas.parentElement.appendChild(this.liquifyCanvas);

        // Create liquify tool instance
        this.liquifyTool = new LiquifyTool(this.liquifyCanvas);
        this.liquifyTool.init();

        // Mode buttons
        document.querySelectorAll('.liquify-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.liquify-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                this.liquifyTool.setMode(mode);

                // Update label
                const label = document.getElementById('liquify-mode-label');
                if (label) {
                    label.textContent = mode.toUpperCase().replace('SWIRLRIGHT', 'SWIRL RIGHT').replace('SWIRLLEFT', 'SWIRL LEFT');
                }
            });
        });

        // Size slider
        const sizeSlider = document.getElementById('liquify-size');
        const sizeValue = document.getElementById('liquify-size-value');
        if (sizeSlider) {
            sizeSlider.addEventListener('input', () => {
                const size = parseInt(sizeSlider.value);
                this.liquifyTool.setBrushSize(size);
                if (sizeValue) sizeValue.textContent = `${size}px`;
                this._updateLiquifyBrushCursor();
            });
        }

        // Strength slider
        const strengthSlider = document.getElementById('liquify-strength');
        const strengthValue = document.getElementById('liquify-strength-value');
        if (strengthSlider) {
            strengthSlider.addEventListener('input', () => {
                const strength = parseInt(strengthSlider.value);
                this.liquifyTool.setBrushStrength(strength / 100);
                if (strengthValue) strengthValue.textContent = `${strength}%`;
            });
        }

        // Density slider
        const densitySlider = document.getElementById('liquify-density');
        const densityValue = document.getElementById('liquify-density-value');
        if (densitySlider) {
            densitySlider.addEventListener('input', () => {
                const density = parseInt(densitySlider.value);
                this.liquifyTool.setBrushDensity(density / 100);
                if (densityValue) densityValue.textContent = `${density}%`;
            });
        }

        // High quality toggle
        const hqToggle = document.getElementById('liquify-high-quality');
        if (hqToggle) {
            hqToggle.addEventListener('change', () => {
                this.liquifyTool.setHighQuality(hqToggle.checked);
            });
        }

        // Reset All button
        const btnReset = document.getElementById('btn-liquify-reset');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.liquifyTool.resetAll();
            });
        }

        // Apply button
        const btnApply = document.getElementById('btn-liquify-apply');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.applyLiquify());
        }

        // Cancel button
        const btnCancel = document.getElementById('btn-liquify-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                this.liquifyTool.resetAll();
                this._deactivateLiquifyTool();
                this.setMode('develop');
            });
        }
    }

    /**
     * Activate liquify tool
     */
    _activateLiquifyTool() {
        if (!this.state.hasImage) return;

        // Show liquify canvas
        this.liquifyCanvas.style.display = 'block';
        this.liquifyCanvas.style.pointerEvents = 'auto';

        // Position canvas over the main canvas
        const rect = this.elements.canvas.getBoundingClientRect();
        this.liquifyCanvas.style.width = rect.width + 'px';
        this.liquifyCanvas.style.height = rect.height + 'px';

        // Set the image to liquify
        this.liquifyTool.setImage(this.elements.canvas);

        // Create liquify brush cursor if it doesn't exist
        if (!this.liquifyBrushCursor) {
            this.liquifyBrushCursor = document.createElement('div');
            this.liquifyBrushCursor.className = 'liquify-brush-cursor';
            this.liquifyBrushCursor.style.cssText = `
                position: fixed;
                pointer-events: none;
                border: 2px solid rgba(0, 180, 255, 0.8);
                border-radius: 50%;
                z-index: 10000;
                display: none;
                box-shadow: 0 0 10px rgba(0, 180, 255, 0.3);
            `;
            document.body.appendChild(this.liquifyBrushCursor);
        }
        this.liquifyBrushCursor.style.display = 'block';
        this._updateLiquifyBrushCursor();

        // Add mouse event listeners
        this._liquifyMouseDown = (e) => {
            const rect = this.liquifyCanvas.getBoundingClientRect();
            const scaleX = this.liquifyTool.imageWidth / rect.width;
            const scaleY = this.liquifyTool.imageHeight / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            this.liquifyTool.onMouseDown(x, y);
        };

        this._liquifyMouseMove = (e) => {
            // Update cursor position
            if (this.liquifyBrushCursor) {
                const size = this.liquifyTool.brushSize;
                const rect = this.liquifyCanvas.getBoundingClientRect();
                const scaleX = rect.width / this.liquifyTool.imageWidth;
                const displaySize = size * scaleX;

                this.liquifyBrushCursor.style.width = displaySize + 'px';
                this.liquifyBrushCursor.style.height = displaySize + 'px';
                this.liquifyBrushCursor.style.left = (e.clientX - displaySize / 2) + 'px';
                this.liquifyBrushCursor.style.top = (e.clientY - displaySize / 2) + 'px';
            }

            // Apply liquify if dragging
            if (this.liquifyTool.isDragging) {
                const rect = this.liquifyCanvas.getBoundingClientRect();
                const scaleX = this.liquifyTool.imageWidth / rect.width;
                const scaleY = this.liquifyTool.imageHeight / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;
                this.liquifyTool.onMouseMove(x, y);
            }
        };

        this._liquifyMouseUp = () => {
            this.liquifyTool.onMouseUp();
        };

        this.liquifyCanvas.addEventListener('mousedown', this._liquifyMouseDown);
        document.addEventListener('mousemove', this._liquifyMouseMove);
        document.addEventListener('mouseup', this._liquifyMouseUp);
    }

    /**
     * Update liquify brush cursor size
     */
    _updateLiquifyBrushCursor() {
        if (this.liquifyBrushCursor && this.liquifyTool) {
            const size = this.liquifyTool.brushSize;
            const rect = this.liquifyCanvas.getBoundingClientRect();
            const scaleX = rect.width / this.liquifyTool.imageWidth;
            const displaySize = size * scaleX;
            this.liquifyBrushCursor.style.width = displaySize + 'px';
            this.liquifyBrushCursor.style.height = displaySize + 'px';
        }
    }

    /**
     * Deactivate liquify tool
     */
    _deactivateLiquifyTool() {
        // Hide liquify canvas
        this.liquifyCanvas.style.display = 'none';
        this.liquifyCanvas.style.pointerEvents = 'none';

        // Hide brush cursor
        if (this.liquifyBrushCursor) {
            this.liquifyBrushCursor.style.display = 'none';
        }

        // Remove event listeners
        if (this._liquifyMouseDown) {
            this.liquifyCanvas.removeEventListener('mousedown', this._liquifyMouseDown);
        }
        if (this._liquifyMouseMove) {
            document.removeEventListener('mousemove', this._liquifyMouseMove);
        }
        if (this._liquifyMouseUp) {
            document.removeEventListener('mouseup', this._liquifyMouseUp);
        }
    }

    /**
     * Apply liquify changes to the main canvas
     */
    async applyLiquify() {
        try {
            // Clear any pending debounced history push to avoid duplicates
            clearTimeout(this._historyDebounceTimer);

            // Save state BEFORE liquify for undo support
            const snapshot = this._captureFullState();
            console.log('📸 Liquify: Capturing state. DataURL:', snapshot.imageDataUrl?.length || 0);
            this.history.pushState(snapshot);

            // Get the result from the liquify tool's WebGL canvas
            const liquifyCanvas = this.liquifyTool.getResultCanvas();

            // Create an intermediate 2D canvas to transfer the image
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = liquifyCanvas.width;
            tempCanvas.height = liquifyCanvas.height;
            const tempCtx = tempCanvas.getContext('2d');

            // Draw the WebGL canvas onto the 2D canvas
            tempCtx.drawImage(liquifyCanvas, 0, 0);

            // Update the GPU with the new image
            // First, resize the GPU if needed
            if (this.gpu.width !== tempCanvas.width || this.gpu.height !== tempCanvas.height) {
                this.gpu.resize(tempCanvas.width, tempCanvas.height);
            }

            // Load the new image into the GPU - WAIT for it to complete
            const dataUrl = tempCanvas.toDataURL('image/png');
            const img = await this._loadImageAsync(dataUrl);

            // Update state with new image (like crop apply does)
            this.state.setImage(img);

            // Reload GPU processor with new image  
            this.gpu.loadImage(img);

            // Store the image (not ImageData) as new original for undo compatibility
            this.state.originalImage = img;

            // Update histogram
            setTimeout(() => this.renderHistogram(), 100);

            console.log('✅ Liquify applied successfully');

            // Reset liquify tool for next use but stay in liquify mode
            this.liquifyTool.resetAll();

            // Re-initialize the liquify tool with the new image
            if (this.state.currentTool === 'liquify') {
                setTimeout(() => this._activateLiquifyTool(), 100);
            }

        } catch (error) {
            console.error('Failed to apply liquify:', error);
        }
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
     * Initialize healing tool controls
     */
    _initHealingControls() {
        // Create healing canvas (overlay on main canvas)
        this.healingCanvas = document.createElement('canvas');
        this.healingCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            display: none;
        `;
        this.elements.canvas.parentElement.appendChild(this.healingCanvas);

        // Create healing tool instance
        this.healingTool = new HealingTool(this.healingCanvas);

        // Store reference to Replicate service
        this.replicate = replicateService;

        // Load saved API token
        const tokenInput = document.getElementById('replicate-api-token');
        if (tokenInput && this.replicate.hasApiToken()) {
            tokenInput.value = this.replicate.getApiToken();
            document.getElementById('api-status').textContent = '✅ Token loaded from storage';
            document.getElementById('api-status').style.color = 'var(--accent)';
        }

        // API Token input
        tokenInput?.addEventListener('change', () => {
            this.replicate.setApiToken(tokenInput.value);
            document.getElementById('api-status').textContent = '💾 Token saved';
            document.getElementById('api-status').style.color = 'var(--accent)';
        });

        // Test API button
        document.getElementById('btn-test-api')?.addEventListener('click', async () => {
            const status = document.getElementById('api-status');
            status.textContent = '🔄 Testing connection...';
            status.style.color = 'var(--text-secondary)';

            const result = await this.replicate.testConnection();
            if (result.success) {
                status.textContent = '✅ Connection successful!';
                status.style.color = 'var(--accent)';
            } else {
                status.textContent = `❌ ${result.error}`;
                status.style.color = 'var(--text-error)';
            }
        });

        // Size slider
        const sizeSlider = document.getElementById('healing-size');
        const sizeValue = document.getElementById('healing-size-value');
        sizeSlider?.addEventListener('input', () => {
            const size = parseInt(sizeSlider.value);
            this.healingTool.setBrushSize(size);
            if (sizeValue) sizeValue.textContent = `${size}px`;
            this._updateHealingBrushCursor();
        });

        // Hardness slider
        const hardnessSlider = document.getElementById('healing-hardness');
        const hardnessValue = document.getElementById('healing-hardness-value');
        hardnessSlider?.addEventListener('input', () => {
            const hardness = parseInt(hardnessSlider.value);
            this.healingTool.setBrushHardness(hardness / 100);
            if (hardnessValue) hardnessValue.textContent = `${hardness}%`;
        });

        // Heal button
        document.getElementById('btn-heal')?.addEventListener('click', () => this._performHealing());

        // Clear mask button
        document.getElementById('btn-clear-mask')?.addEventListener('click', () => {
            this.healingTool.clearMask();
            this._renderHealingPreview();
        });

        // Apply button
        document.getElementById('btn-healing-apply')?.addEventListener('click', () => this._applyHealing());

        // Cancel button
        document.getElementById('btn-healing-cancel')?.addEventListener('click', () => {
            this.healingTool.reset();
            this._deactivateHealingTool();
            this.setMode('develop');
        });

        // Face enhance button
        document.getElementById('btn-enhance-face')?.addEventListener('click', () => this._enhanceFace());

        // Remove background button
        document.getElementById('btn-remove-bg')?.addEventListener('click', () => this._removeBackground());
    }

    /**
     * Activate healing tool
     */
    _activateHealingTool() {
        if (!this.state.hasImage) return;

        // Show healing canvas
        this.healingCanvas.style.display = 'block';
        this.healingCanvas.style.pointerEvents = 'auto';

        // Position canvas over the main canvas
        const rect = this.elements.canvas.getBoundingClientRect();
        this.healingCanvas.style.width = rect.width + 'px';
        this.healingCanvas.style.height = rect.height + 'px';
        this.healingCanvas.width = this.gpu.width;
        this.healingCanvas.height = this.gpu.height;

        // Set the image to heal
        this.healingTool.setImage(this.elements.canvas);

        // Create healing brush cursor if it doesn't exist
        if (!this.healingBrushCursor) {
            this.healingBrushCursor = document.createElement('div');
            this.healingBrushCursor.className = 'healing-brush-cursor';
            this.healingBrushCursor.style.cssText = `
                position: fixed;
                pointer-events: none;
                border: 2px solid rgba(255, 100, 100, 0.8);
                border-radius: 50%;
                z-index: 10000;
                display: none;
                box-shadow: 0 0 10px rgba(255, 100, 100, 0.3);
            `;
            document.body.appendChild(this.healingBrushCursor);
        }
        this.healingBrushCursor.style.display = 'block';
        this._updateHealingBrushCursor();

        // Add mouse event listeners
        this._healingMouseDown = (e) => {
            const rect = this.healingCanvas.getBoundingClientRect();
            const scaleX = this.healingTool.imageWidth / rect.width;
            const scaleY = this.healingTool.imageHeight / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            this.healingTool.onMouseDown(x, y);
            this._renderHealingPreview();
        };

        this._healingMouseMove = (e) => {
            // Update cursor position
            if (this.healingBrushCursor) {
                const size = this.healingTool.brushSize;
                const rect = this.healingCanvas.getBoundingClientRect();
                const scale = rect.width / this.healingTool.imageWidth;
                const displaySize = size * scale;
                this.healingBrushCursor.style.width = displaySize + 'px';
                this.healingBrushCursor.style.height = displaySize + 'px';
                this.healingBrushCursor.style.left = (e.clientX - displaySize / 2) + 'px';
                this.healingBrushCursor.style.top = (e.clientY - displaySize / 2) + 'px';
            }

            const rect = this.healingCanvas.getBoundingClientRect();
            const scaleX = this.healingTool.imageWidth / rect.width;
            const scaleY = this.healingTool.imageHeight / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            this.healingTool.onMouseMove(x, y);

            if (this.healingTool.isDrawing) {
                this._renderHealingPreview();
            }
        };

        this._healingMouseUp = () => {
            this.healingTool.onMouseUp();
        };

        this.healingCanvas.addEventListener('mousedown', this._healingMouseDown);
        this.healingCanvas.addEventListener('mousemove', this._healingMouseMove);
        this.healingCanvas.addEventListener('mouseup', this._healingMouseUp);
        this.healingCanvas.addEventListener('mouseleave', this._healingMouseUp);

        // Initial render
        this._renderHealingPreview();

        console.log('🩹 Healing tool activated');
    }

    /**
     * Deactivate healing tool
     */
    _deactivateHealingTool() {
        if (this.healingCanvas) {
            this.healingCanvas.style.display = 'none';
            this.healingCanvas.style.pointerEvents = 'none';

            // Remove event listeners
            if (this._healingMouseDown) {
                this.healingCanvas.removeEventListener('mousedown', this._healingMouseDown);
                this.healingCanvas.removeEventListener('mousemove', this._healingMouseMove);
                this.healingCanvas.removeEventListener('mouseup', this._healingMouseUp);
                this.healingCanvas.removeEventListener('mouseleave', this._healingMouseUp);
            }
        }

        // Hide cursor
        if (this.healingBrushCursor) {
            this.healingBrushCursor.style.display = 'none';
        }

        console.log('🩹 Healing tool deactivated');
    }

    /**
     * Update healing brush cursor size
     */
    _updateHealingBrushCursor() {
        if (!this.healingBrushCursor || !this.healingTool) return;
        const size = this.healingTool.brushSize;
        const rect = this.healingCanvas?.getBoundingClientRect();
        if (!rect) return;
        const scale = rect.width / (this.healingTool.imageWidth || 1);
        const displaySize = size * scale;
        this.healingBrushCursor.style.width = displaySize + 'px';
        this.healingBrushCursor.style.height = displaySize + 'px';
    }

    /**
     * Render healing preview with mask overlay
     */
    _renderHealingPreview() {
        if (!this.healingTool) return;
        const previewCanvas = this.healingTool.getPreviewCanvas();
        const ctx = this.healingCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.healingCanvas.width, this.healingCanvas.height);
        ctx.drawImage(previewCanvas, 0, 0, this.healingCanvas.width, this.healingCanvas.height);
    }

    /**
     * Perform AI healing using LaMa
     */
    async _performHealing() {
        if (!this.healingTool.hasMaskDrawn()) {
            alert('Please paint over the area you want to heal first.');
            return;
        }

        if (!this.replicate.hasApiToken()) {
            alert('Please enter your Replicate API token first.');
            return;
        }

        const btn = document.getElementById('btn-heal');
        const originalText = btn.textContent;
        btn.textContent = '⏳ Healing...';
        btn.disabled = true;

        try {
            const imageDataUrl = this.healingTool.getImageDataUrl();
            const maskDataUrl = this.healingTool.getMaskDataUrl();

            console.log('🩹 Sending to LaMa API...');
            const result = await this.replicate.inpaint(imageDataUrl, maskDataUrl);

            console.log('🩹 Healing result received');

            // Load the result image
            this.healedImage = await this._loadImageAsync(result);

            // Show result on canvas
            const ctx = this.healingCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.healingCanvas.width, this.healingCanvas.height);
            ctx.drawImage(this.healedImage, 0, 0, this.healingCanvas.width, this.healingCanvas.height);

            // Clear the mask
            this.healingTool.clearMask();

            btn.textContent = '✅ Done! Click Apply';

        } catch (error) {
            console.error('Healing failed:', error);
            alert(`Healing failed: ${error.message}`);
            btn.textContent = originalText;
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * Apply healed result to main canvas
     */
    async _applyHealing() {
        if (!this.healedImage) {
            alert('No healed image to apply. Run healing first.');
            return;
        }

        try {
            // Clear debounce and save state for undo
            clearTimeout(this._historyDebounceTimer);
            const snapshot = this._captureFullState();
            this.history.pushState(snapshot);

            // Update state and GPU
            this.state.setImage(this.healedImage);
            this.gpu.loadImage(this.healedImage);
            this.state.originalImage = this.healedImage;

            // Clear healed image reference
            this.healedImage = null;

            // Update histogram
            setTimeout(() => this.renderHistogram(), 100);

            // Reinitialize healing tool with new image
            this.healingTool.setImage(this.elements.canvas);
            this._renderHealingPreview();

            console.log('✅ Healing applied successfully');

        } catch (error) {
            console.error('Failed to apply healing:', error);
        }
    }

    /**
     * Enhance face using GFPGAN
     */
    async _enhanceFace() {
        if (!this.state.hasImage) return;

        if (!this.replicate.hasApiToken()) {
            alert('Please enter your Replicate API token first.');
            return;
        }

        const btn = document.getElementById('btn-enhance-face');
        const originalText = btn.textContent;
        btn.textContent = '⏳ Enhancing...';
        btn.disabled = true;

        try {
            // Capture current image
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.gpu.width;
            tempCanvas.height = this.gpu.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(this.elements.canvas, 0, 0);
            const imageDataUrl = tempCanvas.toDataURL('image/png');

            console.log('✨ Sending to GFPGAN API...');
            const result = await this.replicate.enhanceFace(imageDataUrl);

            console.log('✨ Face enhancement result received');

            // Save state for undo
            clearTimeout(this._historyDebounceTimer);
            const snapshot = this._captureFullState();
            this.history.pushState(snapshot);

            // Load and apply the result
            const enhancedImage = await this._loadImageAsync(result);
            this.state.setImage(enhancedImage);
            this.gpu.loadImage(enhancedImage);
            this.state.originalImage = enhancedImage;

            // Update UI
            setTimeout(() => this.renderHistogram(), 100);

            btn.textContent = '✅ Enhanced!';
            setTimeout(() => { btn.textContent = originalText; }, 2000);

        } catch (error) {
            console.error('Face enhancement failed:', error);
            alert(`Face enhancement failed: ${error.message}`);
            btn.textContent = originalText;
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * Remove background using rembg
     */
    async _removeBackground() {
        if (!this.state.hasImage) return;

        if (!this.replicate.hasApiToken()) {
            alert('Please enter your Replicate API token first.');
            return;
        }

        const btn = document.getElementById('btn-remove-bg');
        const originalText = btn.textContent;
        btn.textContent = '⏳ Removing...';
        btn.disabled = true;

        try {
            // Capture current image
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.gpu.width;
            tempCanvas.height = this.gpu.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(this.elements.canvas, 0, 0);
            const imageDataUrl = tempCanvas.toDataURL('image/png');

            console.log('🎭 Sending to rembg API...');
            const result = await this.replicate.removeBackground(imageDataUrl);

            console.log('🎭 Background removal result received');

            // Save state for undo
            clearTimeout(this._historyDebounceTimer);
            const snapshot = this._captureFullState();
            this.history.pushState(snapshot);

            // Load and apply the result
            const resultImage = await this._loadImageAsync(result);
            this.state.setImage(resultImage);
            this.gpu.loadImage(resultImage);
            this.state.originalImage = resultImage;

            // Update UI
            setTimeout(() => this.renderHistogram(), 100);

            btn.textContent = '✅ Removed!';
            setTimeout(() => { btn.textContent = originalText; }, 2000);

        } catch (error) {
            console.error('Background removal failed:', error);
            alert(`Background removal failed: ${error.message}`);
            btn.textContent = originalText;
        } finally {
            btn.disabled = false;
        }
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
        if (!this.state.originalImage) {
            console.warn('No image to export');
            return;
        }

        // Get export settings from UI or use defaults
        const formatSelect = document.getElementById('export-format');
        const qualitySlider = document.getElementById('slider-export-quality');

        const format = formatSelect?.value || 'png';
        const quality = (qualitySlider?.value || 95) / 100;

        // Determine MIME type
        const mimeTypes = {
            'png': 'image/png',
            'jpeg': 'image/jpeg',
            'webp': 'image/webp'
        };
        const mimeType = mimeTypes[format] || 'image/png';

        // File extension
        const extensions = {
            'png': 'png',
            'jpeg': 'jpg',
            'webp': 'webp'
        };
        const extension = extensions[format] || 'png';

        // Show export progress
        const statusBar = document.querySelector('.status-right .perf');
        const originalStatus = statusBar?.textContent;
        if (statusBar) statusBar.textContent = 'Exporting...';

        // Use setTimeout to allow UI to update
        setTimeout(() => {
            try {
                this._performExport(mimeType, quality, extension);
            } catch (error) {
                console.error('Export failed:', error);
                alert('Export failed: ' + error.message);
            } finally {
                if (statusBar) statusBar.textContent = originalStatus || 'Ready';
            }
        }, 50);
    }

    /**
     * Internal export method - renders at original resolution
     */
    _performExport(mimeType, quality, extension) {
        const originalWidth = this.state.originalImage.width;
        const originalHeight = this.state.originalImage.height;

        // Check if we're already at full resolution
        const currentWidth = this.gpu.width;
        const currentHeight = this.gpu.height;

        let exportCanvas;

        if (currentWidth === originalWidth && currentHeight === originalHeight) {
            // Already at full resolution, use current canvas
            exportCanvas = this.elements.canvas;

            // Make sure we have the latest render with all adjustments
            let resultTexture = this.gpu.renderToTexture();
            resultTexture = this.masks.applyMaskedAdjustments(resultTexture);
            this.gpu.blitToCanvas(resultTexture);
        } else {
            // Need to render at full resolution
            // For now, use current canvas (full resolution rendering is complex)
            // TODO: Implement true full-resolution export in future
            exportCanvas = this.elements.canvas;

            // Render with current adjustments
            let resultTexture = this.gpu.renderToTexture();
            resultTexture = this.masks.applyMaskedAdjustments(resultTexture);
            this.gpu.blitToCanvas(resultTexture);

            console.log(`⚠️ Exporting at display resolution (${currentWidth}×${currentHeight}). ` +
                `Original: ${originalWidth}×${originalHeight}`);
        }

        // Export to blob
        exportCanvas.toBlob((blob) => {
            if (!blob) {
                console.error('Failed to create blob');
                return;
            }

            // Create download link
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            // Get custom filename or generate with timestamp
            const filenameInput = document.getElementById('export-filename');
            let filename = filenameInput?.value?.trim();

            if (!filename) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                filename = `orlume-export-${timestamp}`;
            }

            // Sanitize filename (remove invalid characters)
            filename = filename.replace(/[<>:"/\\|?*]/g, '-');

            link.download = `${filename}.${extension}`;
            link.href = url;
            link.click();

            // Cleanup
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            // Log export info
            const sizeKB = (blob.size / 1024).toFixed(1);
            console.log(`✅ Exported ${extension.toUpperCase()} (${sizeKB} KB) at ${currentWidth}×${currentHeight}`);
        }, mimeType, quality);
    }

    /**
     * Estimate file size based on current settings
     * Called when quality slider changes
     */
    estimateFileSize() {
        if (!this.state.originalImage || !this.elements.canvas) {
            this._updateFileSizeDisplay('--');
            return;
        }

        const formatSelect = document.getElementById('export-format');
        const qualitySlider = document.getElementById('slider-export-quality');

        const format = formatSelect?.value || 'jpeg';
        const quality = (qualitySlider?.value || 95) / 100;

        const mimeTypes = {
            'png': 'image/png',
            'jpeg': 'image/jpeg',
            'webp': 'image/webp'
        };
        const mimeType = mimeTypes[format] || 'image/jpeg';

        // Ensure we have the latest render
        let resultTexture = this.gpu.renderToTexture();
        resultTexture = this.masks.applyMaskedAdjustments(resultTexture);
        this.gpu.blitToCanvas(resultTexture);

        // Generate blob to estimate size
        this.elements.canvas.toBlob((blob) => {
            if (blob) {
                const sizeKB = blob.size / 1024;
                let sizeText;
                if (sizeKB < 1024) {
                    sizeText = `~${sizeKB.toFixed(0)} KB`;
                } else {
                    sizeText = `~${(sizeKB / 1024).toFixed(1)} MB`;
                }
                this._updateFileSizeDisplay(sizeText);
            }
        }, mimeType, quality);
    }

    /**
     * Update file size display in UI
     */
    _updateFileSizeDisplay(sizeText) {
        const sizeDisplay = document.getElementById('estimated-file-size');
        if (sizeDisplay) {
            sizeDisplay.textContent = sizeText;
        }
    }

    /**
     * Show export options modal (if expanded export UI is desired)
     */
    showExportOptions() {
        // Toggle export options visibility
        const exportOptions = document.getElementById('export-options');
        if (exportOptions) {
            exportOptions.style.display = exportOptions.style.display === 'none' ? 'block' : 'none';
        }
    }

    /**
     * Push current state to history (debounced to avoid flooding)
     * Captures global state across all sections for full undo/redo support
     */
    _pushHistoryDebounced() {
        clearTimeout(this._historyDebounceTimer);
        this._historyDebounceTimer = setTimeout(() => {
            const snapshot = this._captureFullState();
            this.history.pushState(snapshot);
        }, 100);
    }

    /**
     * Capture the full application state for history
     * Includes image data for undoing crops and destructive operations
     */
    _captureFullState() {
        // Global develop adjustments
        const globalAdjustments = { ...this.state.globalAdjustments };

        // Mask layer adjustments (don't store texture data, just adjustments)
        const maskLayerAdjustments = this.masks.layers.map(layer => ({
            id: layer.id,
            name: layer.name,
            adjustments: { ...layer.adjustments }
        }));

        // Capture current image state for crop undo
        let imageDataUrl = null;
        if (this.state.originalImage) {
            // Create a canvas to capture the original image
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.state.originalImage.width;
            tempCanvas.height = this.state.originalImage.height;
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(this.state.originalImage, 0, 0);
            imageDataUrl = tempCanvas.toDataURL('image/png');
        }

        return {
            globalAdjustments,
            maskLayerAdjustments,
            activeLayerIndex: this.masks.activeLayerIndex,
            imageDataUrl,
            imageWidth: this.state.originalImage?.width || 0,
            imageHeight: this.state.originalImage?.height || 0
        };
    }

    /**
     * Undo last adjustment
     */
    undo() {
        const state = this.history.undo();
        if (state) {
            this._restoreState(state);
            console.log('↩️ Undo', this.history.getInfo());

            // If in liquify mode, refresh the liquify tool to show the change
            if (this.state.currentTool === 'liquify') {
                setTimeout(() => this._activateLiquifyTool(), 300);
            }
        }
    }

    /**
     * Redo previously undone adjustment
     */
    redo() {
        const state = this.history.redo();
        if (state) {
            this._restoreState(state);
            console.log('↪️ Redo', this.history.getInfo());

            // If in liquify mode, refresh the liquify tool to show the change
            if (this.state.currentTool === 'liquify') {
                setTimeout(() => this._activateLiquifyTool(), 300);
            }
        }
    }

    /**
     * Restore full state from history snapshot
     * Handles image restoration for crop undo
     */
    _restoreState(snapshot) {
        console.log('🔄 Restoring state. DataURL length:', snapshot.imageDataUrl?.length || 0);

        // Check if we need to restore a different image (crop or liquify undo)
        // Always restore if imageDataUrl exists - this handles liquify with same dimensions
        const needsImageRestore = !!snapshot.imageDataUrl;

        if (needsImageRestore) {
            // Restore the image from data URL
            const img = new Image();
            img.onload = () => {
                // Update state
                this.state.setImage(img);

                // Reload GPU processor with restored image
                this.gpu.loadImage(img);

                // Clear masks (they don't align with restored image)
                this.masks.layers = [];
                this.masks.activeLayerIndex = -1;
                this.updateLayersList();

                // Update UI
                this.elements.perfIndicator.textContent = `${img.width}×${img.height}`;

                // Then restore adjustments
                this._restoreAdjustments(snapshot);

                console.log(`🖼️ Image restored: ${img.width}×${img.height}`);
            };
            img.src = snapshot.imageDataUrl;
        } else {
            // No image change, just restore adjustments
            this._restoreAdjustments(snapshot);
        }
    }

    /**
     * Restore adjustment values from snapshot
     */
    _restoreAdjustments(snapshot) {
        // Restore global adjustments
        if (snapshot.globalAdjustments) {
            for (const [name, value] of Object.entries(snapshot.globalAdjustments)) {
                // Update state
                this.state.globalAdjustments[name] = value;

                // Update GPU
                this.gpu.setParam(name, value);

                // Update slider UI
                const slider = document.getElementById(`slider-${name}`);
                const valueDisplay = document.getElementById(`val-${name}`);
                if (slider && valueDisplay) {
                    slider.value = value;
                    valueDisplay.textContent = name === 'exposure' ? value.toFixed(2) : Math.round(value);
                }
            }
        }

        // Restore mask layer adjustments
        if (snapshot.maskLayerAdjustments) {
            for (const savedLayer of snapshot.maskLayerAdjustments) {
                const layer = this.masks.layers.find(l => l.id === savedLayer.id);
                if (layer) {
                    Object.assign(layer.adjustments, savedLayer.adjustments);

                    // Update mask slider UI if this layer is active
                    if (this.masks.layers.indexOf(layer) === this.masks.activeLayerIndex) {
                        for (const [name, value] of Object.entries(savedLayer.adjustments)) {
                            const slider = document.getElementById(`slider-mask-${name}`);
                            const valueDisplay = document.getElementById(`val-mask-${name}`);
                            if (slider && valueDisplay) {
                                slider.value = value;
                                valueDisplay.textContent = name === 'exposure' ? value.toFixed(2) : Math.round(value);
                            }
                        }
                    }
                }
            }
        }

        // Re-render (handles both global and mask adjustments)
        this.renderWithMask(false);
        requestAnimationFrame(() => this.renderHistogram());
    }
}
