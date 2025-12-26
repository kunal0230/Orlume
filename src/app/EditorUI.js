/**
 * EditorUI - UI management for the GPU Editor
 * Handles all DOM interactions, event bindings, and UI updates
 */
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
        this.state.setTool(mode);

        // Update toolbar button UI
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tool-${mode}`)?.classList.add('active');

        // Hide all mode headers
        document.getElementById('develop-mode-tabs').style.display = 'none';
        document.getElementById('3d-mode-header').style.display = 'none';
        document.getElementById('export-mode-header').style.display = 'none';

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
                // For now, show develop panel with crop overlay (to be implemented)
                document.getElementById('develop-mode-tabs').style.display = 'flex';
                document.getElementById('panel-develop').classList.add('active');
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
        if (['develop', '3d', 'export', 'crop'].includes(tool)) {
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

            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                valueDisplay.textContent = name === 'exposure' ? '0.00' : '0';
                this.gpu.setParam(name, 0);
                this.state.setAdjustment(name, 0);
                requestAnimationFrame(() => this.renderHistogram());
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

            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                valueDisplay.textContent = name === 'exposure' ? '0.00' : '0';
                this.masks.setActiveAdjustment(name, 0);
                this.renderWithMask(false);
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

            // Close modal with Escape
            if (e.code === 'Escape') {
                this.toggleShortcutsModal(false);
            }

            // Export with Ctrl/Cmd + E
            if ((e.metaKey || e.ctrlKey) && e.code === 'KeyE') {
                e.preventDefault();
                this.exportImage();
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
}
