/**
 * TextModule - Text tool UI and interactions
 * 
 * Handles:
 * - Text tool activation/deactivation
 * - Canvas click-to-add text
 * - Selection and transform interactions
 * - Inline text editing
 * - Property panel synchronization
 */

export class TextModule {
    constructor(editor) {
        this.editor = editor;
        this.textManager = null; // Set by EditorApp after init

        // UI state
        this.isActive = false;
        this.editOverlay = null;

        // Google Fonts list (popular fonts)
        this.fonts = [
            'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald',
            'Raleway', 'Poppins', 'Playfair Display', 'Merriweather',
            'PT Sans', 'Source Sans Pro', 'Nunito', 'Ubuntu', 'Rubik',
            'Work Sans', 'Quicksand', 'Karla', 'Libre Baskerville', 'Crimson Text',
            'Bebas Neue', 'Anton', 'Archivo Black', 'Righteous', 'Permanent Marker',
            'Pacifico', 'Dancing Script', 'Lobster', 'Satisfy', 'Great Vibes',
            'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana'
        ];

        this._boundHandleCanvasClick = this._handleCanvasClick.bind(this);
        this._boundHandleCanvasDblClick = this._handleCanvasDblClick.bind(this);
        this._boundHandleCanvasMouseDown = this._handleCanvasMouseDown.bind(this);
        this._boundHandleCanvasMouseMove = this._handleCanvasMouseMove.bind(this);
        this._boundHandleCanvasMouseUp = this._handleCanvasMouseUp.bind(this);
        this._boundHandleKeyDown = this._handleKeyDown.bind(this);
    }

    /**
     * Set text manager reference
     */
    setTextManager(manager) {
        this.textManager = manager;
        this._bindManagerEvents();
    }

    /**
     * Bind manager events
     */
    _bindManagerEvents() {
        if (!this.textManager) return;

        this.textManager.on('selectionChanged', ({ layerId }) => {
            this._updatePanelFromSelection();
            this._updateTextLayerList();
            this._togglePanelSections(!!layerId);
        });

        this.textManager.on('layerTransformed', () => {
            this._updatePanelFromSelection();
        });

        this.textManager.on('layerAdded', () => {
            this._updateTextLayerList();
            this._togglePanelSections(true);
        });
    }

    /**
     * Toggle panel sections visibility based on selection
     */
    _togglePanelSections(hasSelection) {
        const textPanel = document.getElementById('text-panel');
        const colorsSection = document.getElementById('text-colors-section');
        const effectsSection = document.getElementById('text-effects-section');

        const display = hasSelection ? 'block' : 'none';
        if (textPanel) textPanel.style.display = display;
        if (colorsSection) colorsSection.style.display = display;
        if (effectsSection) effectsSection.style.display = display;
    }

    /**
     * Initialize text module
     */
    init() {
        this._initPanel();
        this._initTextLayerList();
        console.log('✅ TextModule initialized');
    }

    /**
     * Activate text mode
     */
    activate() {
        this.isActive = true;

        const canvas = this.editor.elements.canvas;
        if (canvas) {
            canvas.style.cursor = 'text';
            canvas.addEventListener('click', this._boundHandleCanvasClick);
            canvas.addEventListener('dblclick', this._boundHandleCanvasDblClick);
            canvas.addEventListener('mousedown', this._boundHandleCanvasMouseDown);
            canvas.addEventListener('mousemove', this._boundHandleCanvasMouseMove);
            canvas.addEventListener('mouseup', this._boundHandleCanvasMouseUp);
        }

        document.addEventListener('keydown', this._boundHandleKeyDown);

        // Update canvas size and show overlay
        if (this.textManager) {
            this.textManager.updateCanvasSize();
            this.textManager.showOverlay();
        }
    }

    /**
     * Deactivate text mode
     */
    deactivate() {
        this.isActive = false;
        this._endEditing();

        const canvas = this.editor.elements.canvas;
        if (canvas) {
            canvas.style.cursor = '';
            canvas.removeEventListener('click', this._boundHandleCanvasClick);
            canvas.removeEventListener('dblclick', this._boundHandleCanvasDblClick);
            canvas.removeEventListener('mousedown', this._boundHandleCanvasMouseDown);
            canvas.removeEventListener('mousemove', this._boundHandleCanvasMouseMove);
            canvas.removeEventListener('mouseup', this._boundHandleCanvasMouseUp);
        }

        document.removeEventListener('keydown', this._boundHandleKeyDown);

        // Hide overlay and deselect
        if (this.textManager) {
            this.textManager.hideOverlay();
            this.textManager.deselectAll();
        }

        // Hide panel sections
        this._togglePanelSections(false);
    }

    /**
     * Handle canvas click
     */
    _handleCanvasClick(e) {
        if (!this.textManager || !this.isActive) return;
        if (this.textManager.isDragging) return;

        const pos = this._getCanvasPos(e);
        const layer = this.textManager.getLayerAtPoint(pos.x, pos.y);

        if (layer) {
            // Single click selects
            this.textManager.selectLayer(layer.id);
        }
    }

    /**
     * Handle canvas double-click (start editing or add new text)
     */
    _handleCanvasDblClick(e) {
        if (!this.textManager || !this.isActive) return;

        const pos = this._getCanvasPos(e);
        const layer = this.textManager.getLayerAtPoint(pos.x, pos.y);

        if (layer) {
            // Edit existing text
            this._startEditing(layer);
        } else {
            // Add new text at click position
            const newLayer = this.textManager.addLayer();
            if (newLayer) {
                newLayer.x = pos.x - 100; // Offset to center roughly
                newLayer.y = pos.y - 30;
                newLayer.invalidate();
                this.textManager.render();
                this._updateTextLayerList();
                // Start editing immediately
                setTimeout(() => this._startEditing(newLayer), 50);
            }
        }
    }

    /**
     * Handle mouse down
     */
    _handleCanvasMouseDown(e) {
        if (!this.textManager || !this.isActive) return;

        const pos = this._getCanvasPos(e);
        const selected = this.textManager.getSelectedLayer();

        // Check for handle interaction
        if (selected) {
            const handle = selected.getHandleAt(pos.x, pos.y, this.textManager.overlayCtx);
            if (handle) {
                e.preventDefault();
                this.textManager.startDrag(pos.x, pos.y, handle);
                return;
            }
        }

        // Check for layer hit
        const layer = this.textManager.getLayerAtPoint(pos.x, pos.y);

        if (layer) {
            if (layer.id !== this.textManager.selectedLayerId) {
                this.textManager.selectLayer(layer.id);
            }
            e.preventDefault();
            this.textManager.startDrag(pos.x, pos.y, null);
        } else if (!e.target.closest('.text-edit-overlay')) {
            // Clicked empty area - add new text layer
            this.textManager.deselectAll();
        }
    }

    /**
     * Handle mouse move
     */
    _handleCanvasMouseMove(e) {
        if (!this.textManager) return;

        const pos = this._getCanvasPos(e);

        if (this.textManager.isDragging) {
            e.preventDefault();
            this.textManager.updateDrag(pos.x, pos.y);
        } else {
            // Update cursor based on handle hover
            const selected = this.textManager.getSelectedLayer();
            if (selected) {
                const handle = selected.getHandleAt(pos.x, pos.y, this.textManager.overlayCtx);
                const canvas = this.editor.elements.canvas;

                if (handle === 'rotate') {
                    canvas.style.cursor = 'grab';
                } else if (handle) {
                    const cursors = {
                        'tl': 'nwse-resize', 'br': 'nwse-resize',
                        'tr': 'nesw-resize', 'bl': 'nesw-resize',
                        't': 'ns-resize', 'b': 'ns-resize',
                        'l': 'ew-resize', 'r': 'ew-resize'
                    };
                    canvas.style.cursor = cursors[handle] || 'move';
                } else if (selected.containsPoint(pos.x, pos.y, this.textManager.overlayCtx)) {
                    canvas.style.cursor = 'move';
                } else {
                    canvas.style.cursor = 'text';
                }
            }
        }
    }

    /**
     * Handle mouse up
     */
    _handleCanvasMouseUp(e) {
        if (!this.textManager) return;
        this.textManager.endDrag();
    }

    /**
     * Handle keyboard shortcuts
     */
    _handleKeyDown(e) {
        if (!this.isActive || !this.textManager) return;
        if (this.textManager.isEditing) return;

        const selected = this.textManager.getSelectedLayer();

        // Delete selected layer
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
            e.preventDefault();
            this.textManager.deleteLayer(selected.id);
            this._updateTextLayerList();
        }

        // Duplicate
        if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey) && selected) {
            e.preventDefault();
            this.textManager.duplicateLayer(selected.id);
            this._updateTextLayerList();
        }

        // Enter to start editing
        if (e.key === 'Enter' && selected && !this.textManager.isEditing) {
            e.preventDefault();
            this._startEditing(selected);
        }

        // Escape to deselect
        if (e.key === 'Escape') {
            if (this.textManager.isEditing) {
                this._endEditing();
            } else {
                this.textManager.deselectAll();
            }
        }
    }

    /**
     * Start inline editing
     */
    _startEditing(layer) {
        if (!this.textManager || layer.locked) return;

        this.textManager.isEditing = true;
        this.textManager.editingLayerId = layer.id;

        const bounds = layer.getBounds(this.textManager.overlayCtx);

        // Get the canvas display scale (CSS vs actual pixels)
        const canvas = this.editor.elements.canvas;
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;

        // Create edit overlay
        this.editOverlay = document.createElement('div');
        this.editOverlay.className = 'text-edit-overlay';
        this.editOverlay.contentEditable = 'true';
        this.editOverlay.spellcheck = false;
        this.editOverlay.textContent = layer.text;

        // Position and style - convert canvas coords to display coords
        const displayX = bounds.x * scaleX;
        const displayY = bounds.y * scaleY;
        const displayWidth = bounds.width * scaleX;
        const displayHeight = bounds.height * scaleY;
        const displayFontSize = layer.fontSize * scaleX;

        this.editOverlay.style.cssText = `
            position: absolute;
            left: ${displayX}px;
            top: ${displayY}px;
            min-width: ${displayWidth}px;
            min-height: ${displayHeight}px;
            font-family: "${layer.fontFamily}", sans-serif;
            font-size: ${displayFontSize}px;
            font-weight: ${layer.fontWeight};
            font-style: ${layer.fontStyle};
            color: ${layer.fillColor};
            text-align: ${layer.textAlign};
            line-height: ${layer.lineHeight};
            letter-spacing: ${layer.letterSpacing * scaleX}px;
            padding: 4px;
            outline: 2px solid #6366f1;
            background: rgba(0, 0, 0, 0.1);
            white-space: pre-wrap;
            word-break: break-word;
            transform: rotate(${layer.rotation}deg);
            transform-origin: center center;
            z-index: 100;
        `;

        const container = document.querySelector('.canvas-container');
        if (container) {
            container.appendChild(this.editOverlay);
            this.editOverlay.focus();

            // Select all text
            const range = document.createRange();
            range.selectNodeContents(this.editOverlay);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // Update layer on input
        this.editOverlay.addEventListener('input', () => {
            layer.text = this.editOverlay.textContent || 'Text';
            layer.invalidate();
            this.textManager.render();
        });

        // End editing on blur
        this.editOverlay.addEventListener('blur', () => {
            setTimeout(() => this._endEditing(), 100);
        });

        // Hide the rendered text while editing
        this.textManager.render();
    }

    /**
     * End inline editing
     */
    _endEditing() {
        if (!this.textManager) return;

        this.textManager.isEditing = false;
        this.textManager.editingLayerId = null;

        if (this.editOverlay) {
            this.editOverlay.remove();
            this.editOverlay = null;
        }

        this.textManager.render();
        this._updateTextLayerList();
    }

    /**
     * Get canvas coordinates from mouse event
     */
    _getCanvasPos(e) {
        const canvas = this.editor.elements.canvas;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    /**
     * Initialize text control panel
     */
    _initPanel() {
        // Bind add text button
        const addBtn = document.getElementById('add-text-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                if (this.textManager) {
                    this.textManager.addLayer();
                    this._updateTextLayerList();
                }
            });
        }

        // Font family
        const fontSelect = document.getElementById('text-font-family');
        if (fontSelect) {
            fontSelect.innerHTML = this.fonts.map(f =>
                `<option value="${f}">${f}</option>`
            ).join('');

            fontSelect.addEventListener('change', () => {
                this._applyToSelected('fontFamily', fontSelect.value);
            });
        }

        // Font size
        this._bindSlider('text-font-size', 'fontSize', 8, 400, 1);

        // Font weight
        const weightSelect = document.getElementById('text-font-weight');
        if (weightSelect) {
            weightSelect.addEventListener('change', () => {
                this._applyToSelected('fontWeight', parseInt(weightSelect.value));
            });
        }

        // Style toggles
        this._bindToggle('text-italic', 'fontStyle', 'italic', 'normal');
        this._bindToggle('text-underline', 'textDecoration', 'underline', 'none');

        // Text alignment
        document.querySelectorAll('[data-align]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-align]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._applyToSelected('textAlign', btn.dataset.align);
            });
        });

        // Colors
        this._bindColorPicker('text-fill-color', 'fillColor');
        this._bindColorPicker('text-stroke-color', 'strokeColor');
        this._bindColorPicker('text-bg-color', 'backgroundColor');
        this._bindColorPicker('text-shadow-color', 'shadowColor');

        // Effect toggles
        this._bindCheckbox('text-stroke-enabled', 'strokeEnabled');
        this._bindCheckbox('text-bg-enabled', 'backgroundEnabled');
        this._bindCheckbox('text-shadow-enabled', 'shadowEnabled');

        // Effect sliders
        this._bindSlider('text-stroke-width', 'strokeWidth', 1, 20, 1);
        this._bindSlider('text-bg-padding', 'backgroundPadding', 0, 50, 1);
        this._bindSlider('text-bg-radius', 'backgroundRadius', 0, 50, 1);
        this._bindSlider('text-shadow-x', 'shadowOffsetX', -50, 50, 1);
        this._bindSlider('text-shadow-y', 'shadowOffsetY', -50, 50, 1);
        this._bindSlider('text-shadow-blur', 'shadowBlur', 0, 50, 1);
        this._bindSlider('text-opacity', 'opacity', 0, 1, 0.01);
        this._bindSlider('text-line-height', 'lineHeight', 0.5, 3, 0.1);
        this._bindSlider('text-letter-spacing', 'letterSpacing', -10, 50, 1);
    }

    /**
     * Bind slider to property
     */
    _bindSlider(id, prop, min, max, step) {
        const slider = document.getElementById(id);
        const valueEl = document.getElementById(`${id}-value`);

        if (slider) {
            slider.min = min;
            slider.max = max;
            slider.step = step;

            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                if (valueEl) valueEl.textContent = step < 1 ? value.toFixed(2) : value;
                this._applyToSelected(prop, value);
            });
        }
    }

    /**
     * Bind toggle button
     */
    _bindToggle(id, prop, activeValue, inactiveValue) {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                this._applyToSelected(prop, btn.classList.contains('active') ? activeValue : inactiveValue);
            });
        }
    }

    /**
     * Bind checkbox
     */
    _bindCheckbox(id, prop) {
        const cb = document.getElementById(id);
        if (cb) {
            cb.addEventListener('change', () => {
                this._applyToSelected(prop, cb.checked);
            });
        }
    }

    /**
     * Bind color picker
     */
    _bindColorPicker(id, prop) {
        const picker = document.getElementById(id);
        if (picker) {
            picker.addEventListener('input', () => {
                this._applyToSelected(prop, picker.value);
            });
        }
    }

    /**
     * Apply property to selected layer
     */
    _applyToSelected(prop, value) {
        if (!this.textManager) return;

        const layer = this.textManager.getSelectedLayer();
        if (layer && !layer.locked) {
            layer[prop] = value;
            layer.invalidate();
            this.textManager.render();
        }
    }

    /**
     * Update panel from current selection
     */
    _updatePanelFromSelection() {
        const layer = this.textManager?.getSelectedLayer();
        if (!layer) return;

        // Update all controls to match layer properties
        this._setSelectValue('text-font-family', layer.fontFamily);
        this._setSliderValue('text-font-size', layer.fontSize);
        this._setSelectValue('text-font-weight', layer.fontWeight);
        this._setToggleState('text-italic', layer.fontStyle === 'italic');
        this._setToggleState('text-underline', layer.textDecoration === 'underline');

        document.querySelectorAll('[data-align]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.align === layer.textAlign);
        });

        this._setColorValue('text-fill-color', layer.fillColor);
        this._setColorValue('text-stroke-color', layer.strokeColor);
        this._setColorValue('text-bg-color', layer.backgroundColor);
        this._setColorValue('text-shadow-color', layer.shadowColor);

        this._setCheckboxValue('text-stroke-enabled', layer.strokeEnabled);
        this._setCheckboxValue('text-bg-enabled', layer.backgroundEnabled);
        this._setCheckboxValue('text-shadow-enabled', layer.shadowEnabled);

        this._setSliderValue('text-stroke-width', layer.strokeWidth);
        this._setSliderValue('text-bg-padding', layer.backgroundPadding);
        this._setSliderValue('text-bg-radius', layer.backgroundRadius);
        this._setSliderValue('text-shadow-x', layer.shadowOffsetX);
        this._setSliderValue('text-shadow-y', layer.shadowOffsetY);
        this._setSliderValue('text-shadow-blur', layer.shadowBlur);
        this._setSliderValue('text-opacity', layer.opacity);
        this._setSliderValue('text-line-height', layer.lineHeight);
        this._setSliderValue('text-letter-spacing', layer.letterSpacing);
    }

    _setSelectValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    _setSliderValue(id, value) {
        const slider = document.getElementById(id);
        const valueEl = document.getElementById(`${id}-value`);
        if (slider) slider.value = value;
        if (valueEl) valueEl.textContent = parseFloat(value).toFixed(slider?.step < 1 ? 2 : 0);
    }

    _setToggleState(id, active) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', active);
    }

    _setCheckboxValue(id, checked) {
        const el = document.getElementById(id);
        if (el) el.checked = checked;
    }

    _setColorValue(id, color) {
        const el = document.getElementById(id);
        if (el) el.value = color;
    }

    /**
     * Initialize text layer list
     */
    _initTextLayerList() {
        this._updateTextLayerList();
    }

    /**
     * Update text layer list UI
     */
    _updateTextLayerList() {
        const container = document.getElementById('text-layers-list');
        if (!container || !this.textManager) return;

        if (this.textManager.layers.length === 0) {
            container.innerHTML = `
                <div class="empty-layers-msg">
                    No text layers. Click "Add Text" to create one.
                </div>`;
            return;
        }

        container.innerHTML = this.textManager.layers.map((layer, i) => `
            <div class="text-layer-item ${layer.id === this.textManager.selectedLayerId ? 'active' : ''}" 
                 data-id="${layer.id}">
                <span class="text-layer-icon">T</span>
                <span class="text-layer-name">${layer.name}</span>
                <button class="text-layer-delete" data-delete="${layer.id}" title="Delete">×</button>
            </div>
        `).reverse().join('');

        // Bind events
        container.querySelectorAll('.text-layer-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (!e.target.classList.contains('text-layer-delete')) {
                    this.textManager.selectLayer(el.dataset.id);
                    this._updateTextLayerList();
                }
            });

            el.addEventListener('dblclick', () => {
                const layer = this.textManager.getLayer(el.dataset.id);
                if (layer) this._startEditing(layer);
            });
        });

        container.querySelectorAll('.text-layer-delete').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.textManager.deleteLayer(el.dataset.delete);
                this._updateTextLayerList();
            });
        });
    }
}
