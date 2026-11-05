/**
 * LayersModule - Mask layer management
 * 
 * Handles:
 * - Layer list UI rendering (Photoshop-like layer items with live thumbnails, visibility, icons, rename)
 * - Layer selection, activation, and tool synchronization
 * - Layer renaming (inline double-click)
 * - Layer visibility toggle
 * - Layer inversion, duplication, clearing, and deletion
 * - Live 36x24 mask thumbnail rendering (silhouettes)
 * - Lightroom-style overlay color cycling (Shift+O)
 * - Syncing slider UI with active layer adjustments
 */

export class LayersModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.masks = editor.masks;
        this.maskSliders = editor.maskSliders || [
            'density', 'exposure', 'contrast', 'highlights', 'shadows', 'clarity', 'temperature', 'tint', 'saturation'
        ];
    }

    /**
     * Update layers list in UI
     */
    updateList() {
        const container = document.getElementById('mask-layers');
        if (!container) return;

        // Ensure masks reference is up to date
        if (!this.masks && this.editor.masks) {
            this.masks = this.editor.masks;
        }

        const duplicateBtn = document.getElementById('btn-duplicate-layer');
        const overlayBtn = document.getElementById('btn-toggle-mask-overlay');
        const colorIndicator = document.getElementById('overlay-color-indicator');

        if (overlayBtn) {
            overlayBtn.classList.toggle('active', !!this.masks?.showOverlay);
        }
        if (colorIndicator && this.masks?.getCurrentOverlayColor) {
            colorIndicator.style.backgroundColor = this.masks.getCurrentOverlayColor().hex;
        }

        if (!this.masks || !this.masks.layers || this.masks.layers.length === 0) {
            container.innerHTML = `
                <div style="color: var(--text-secondary); font-size: 12px; text-align: center; padding: 20px;">
                    No adjustment layers yet.<br>Select a tool to create one.
                </div>`;
            if (duplicateBtn) duplicateBtn.disabled = true;
            const maskAdjustments = document.getElementById('mask-adjustments');
            if (maskAdjustments) maskAdjustments.style.display = 'none';
            return;
        }

        if (duplicateBtn) duplicateBtn.disabled = false;
        const maskAdjustments = document.getElementById('mask-adjustments');
        if (maskAdjustments && this.masks.activeLayerIndex >= 0) {
            maskAdjustments.style.display = 'block';
        }

        container.innerHTML = this.masks.layers.map((layer, i) => {
            const isActive = i === this.masks.activeLayerIndex;
            const isVisible = layer.visible !== false;

            // Icon matching layer type
            let typeIconSvg = '';
            if (layer.type === 'radial') {
                typeIconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="4" />
                </svg>`;
            } else if (layer.type === 'gradient') {
                typeIconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                </svg>`;
            } else {
                typeIconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
                    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
                </svg>`;
            }

            // Eye icon for visibility
            const eyeSvg = isVisible
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.4;">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>`;

            return `
                <div class="mask-layer ${isActive ? 'active' : ''} ${!isVisible ? 'is-hidden' : ''}" data-index="${i}">
                    <span class="mask-layer-visibility" data-visibility="${i}" title="${isVisible ? 'Hide layer' : 'Show layer'}">
                        ${eyeSvg}
                    </span>
                    <canvas class="mask-layer-thumb" width="36" height="24" data-thumb-index="${i}" title="Mask preview"></canvas>
                    <div class="mask-layer-icon" title="Type: ${layer.type}">
                        ${typeIconSvg}
                    </div>
                    <div class="mask-layer-name" data-layer-index="${i}" title="Double-click to rename">${layer.name}</div>
                    <div class="mask-layer-actions">
                        <span class="mask-layer-invert-btn" data-invert="${i}" title="Invert this mask (⌘/Ctrl+I)">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor"></path>
                            </svg>
                        </span>
                        <span class="mask-layer-delete" data-delete="${i}" title="Delete layer (Del)">×</span>
                    </div>
                </div>
            `;
        }).join('');

        this._renderAllThumbnails(container);
        this._bindEvents(container);
    }

    /**
     * Render all layer thumbnails
     */
    _renderAllThumbnails(container) {
        if (!this.masks?.layers) return;
        const canvases = container.querySelectorAll('.mask-layer-thumb');
        canvases.forEach(canvas => {
            const index = parseInt(canvas.dataset.thumbIndex, 10);
            const layer = this.masks.layers[index];
            if (layer) {
                this._drawLayerThumbnail(canvas, layer);
            }
        });
    }

    /**
     * Update all thumbnails in existing DOM without rebuild
     */
    updateThumbnails() {
        const container = document.getElementById('mask-layers');
        if (container) {
            this._renderAllThumbnails(container);
        }
    }

    /**
     * Draw live mask thumbnail on a 36x24 canvas
     */
    _drawLayerThumbnail(canvas, layer) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        // Base image dimensions
        const imgW = this.masks?.gpu?.width || this.editor.state.image?.width || 1000;
        const imgH = this.masks?.gpu?.height || this.editor.state.image?.height || 1000;
        const scaleX = w / imgW;
        const scaleY = h / imgH;

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        // Black background = masked out
        ctx.fillStyle = '#06090e';
        ctx.fillRect(0, 0, w, h);

        if (layer.type === 'radial' && layer.shape) {
            const cx = layer.shape.centerX * scaleX;
            const cy = layer.shape.centerY * scaleY;
            const rOut = Math.max(2, (layer.shape.outerRadius || 50) * Math.min(scaleX, scaleY));
            const rIn = Math.max(0, (layer.shape.innerRadius || 0) * Math.min(scaleX, scaleY));

            if (layer.shape.invert) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                const grad = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
                grad.addColorStop(0, '#06090e');
                grad.addColorStop(1, 'rgba(6, 9, 14, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const grad = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (layer.type === 'gradient' && layer.shape) {
            const x1 = layer.shape.startX * scaleX;
            const y1 = layer.shape.startY * scaleY;
            const x2 = layer.shape.endX * scaleX;
            const y2 = layer.shape.endY * scaleY;

            const grad = ctx.createLinearGradient(x1, y1, x2, y2);
            if (layer.shape.invert) {
                grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
                grad.addColorStop(1, '#ffffff');
            } else {
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            }
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
        } else {
            // Brush layer strokes
            if (layer.strokes && layer.strokes.length > 0) {
                for (const op of layer.strokes) {
                    const isErase = Boolean(op.settings?.erase);
                    const strokeColor = isErase ? '#06090e' : '#ffffff';
                    const radius = Math.max(1, (op.settings?.size || 40) * Math.min(scaleX, scaleY) * 0.5);

                    ctx.fillStyle = strokeColor;
                    ctx.strokeStyle = strokeColor;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = radius * 2;

                    if (op.type === 'brush') {
                        ctx.beginPath();
                        ctx.arc(op.x * scaleX, op.y * scaleY, radius, 0, Math.PI * 2);
                        ctx.fill();
                    } else if (op.type === 'stroke') {
                        ctx.beginPath();
                        ctx.moveTo(op.x1 * scaleX, op.y1 * scaleY);
                        ctx.lineTo(op.x2 * scaleX, op.y2 * scaleY);
                        ctx.stroke();
                    }
                }
            }
        }

        // Dim if hidden
        if (layer.visible === false) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.fillRect(0, 0, w, h);
        }

        ctx.restore();
    }

    /**
     * Bind layer list events
     */
    _bindEvents(container) {
        // Layer selection: selects layer and syncs active mask tool
        container.querySelectorAll('.mask-layer').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.mask-layer-delete') ||
                    e.target.closest('.mask-layer-visibility') ||
                    e.target.closest('.mask-layer-invert-btn') ||
                    e.target.tagName === 'INPUT') {
                    return;
                }

                const index = parseInt(el.dataset.index, 10);
                if (Number.isNaN(index) || index < 0 || index >= this.masks.layers.length) return;

                this.masks.activeLayerIndex = index;
                const layer = this.masks.layers[index];

                // Synchronize tool to match layer type
                if (layer && layer.type) {
                    this.editor.setMaskTool(layer.type, false);
                }

                this.updateList();
                this.syncUI();
                this.editor.gpu.render();
            });
        });

        // Visibility toggle
        container.querySelectorAll('.mask-layer-visibility').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(el.dataset.visibility, 10);
                if (Number.isNaN(index)) return;

                this.masks.toggleLayerVisibility(index);
                this.updateList();
                this.editor.gpu.render();
                this.editor._pushHistoryDebounced?.();
            });
        });

        // Invert button
        container.querySelectorAll('.mask-layer-invert-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(el.dataset.invert, 10);
                if (Number.isNaN(index)) return;

                this.masks.activeLayerIndex = index;
                this.masks.invertActiveMask();
                this.updateList();
                this.editor.gpu.render();
                this.editor._pushHistoryDebounced?.();
            });
        });

        // Double-click for inline rename
        container.querySelectorAll('.mask-layer-name').forEach(el => {
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const index = parseInt(el.dataset.layerIndex, 10);
                const layer = this.masks.layers[index];
                if (!layer) return;

                const input = document.createElement('input');
                input.type = 'text';
                input.value = layer.name;
                input.style.cssText = `
                    width: 100%;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--accent-primary, #6366f1);
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
                    this.updateList();
                    this.editor._pushHistoryDebounced?.();
                };

                input.addEventListener('blur', saveRename);
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        input.blur();
                    } else if (ev.key === 'Escape') {
                        saved = true;
                        this.updateList();
                    }
                });
            });
        });

        // Delete layer with confirmation
        container.querySelectorAll('.mask-layer-delete').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(el.dataset.delete, 10);
                const layer = this.masks.layers[index];
                if (!layer) return;

                if (confirm(`Delete "${layer.name}"?`)) {
                    this.masks.deleteLayer(index);
                    this.updateList();
                    this.syncUI();
                    this.editor.gpu.render();
                    this.editor._pushHistoryDebounced?.();
                }
            });
        });
    }

    /**
     * Duplicate active layer
     */
    duplicateActiveLayer() {
        if (!this.masks || this.masks.activeLayerIndex < 0) return;
        const newLayer = this.masks.duplicateLayer(this.masks.activeLayerIndex);
        if (newLayer) {
            this.updateList();
            this.syncUI();
            this.editor.gpu.render();
            this.editor._pushHistoryDebounced?.();
        }
    }

    /**
     * Delete active layer
     */
    deleteActiveLayer() {
        if (!this.masks || this.masks.activeLayerIndex < 0) return;
        const index = this.masks.activeLayerIndex;
        const layer = this.masks.layers[index];
        if (!layer) return;

        if (confirm(`Delete "${layer.name}"?`)) {
            this.masks.deleteLayer(index);
            this.updateList();
            this.syncUI();
            this.editor.gpu.render();
            this.editor._pushHistoryDebounced?.();
        }
    }

    /**
     * Invert active mask
     */
    invertActiveMask() {
        if (!this.masks || this.masks.activeLayerIndex < 0) return;
        this.masks.invertActiveMask();
        this.updateThumbnails();
        this.editor.gpu.render();
        this.editor._pushHistoryDebounced?.();
    }

    /**
     * Clear active mask
     */
    clearActiveMask() {
        if (!this.masks || this.masks.activeLayerIndex < 0) return;
        this.masks.clearActiveMask();
        this.updateThumbnails();
        this.editor.gpu.render();
        this.editor._pushHistoryDebounced?.();
    }

    /**
     * Toggle overlay
     */
    toggleOverlay() {
        if (!this.masks) return;
        this.masks.isMaskMode = true;
        const isShown = this.masks.toggleOverlay();
        const overlayBtn = document.getElementById('btn-toggle-mask-overlay');
        if (overlayBtn) {
            overlayBtn.classList.toggle('active', isShown);
        }
        this.editor.gpu.render();
    }

    /**
     * Cycle through mask overlay colors (Shift+O)
     */
    cycleOverlayColor() {
        if (!this.masks) return;
        const color = this.masks.cycleOverlayColor();
        const indicator = document.getElementById('overlay-color-indicator');
        if (indicator && color) {
            indicator.style.backgroundColor = color.hex;
        }
        if (this.masks.showOverlay) {
            this.editor.gpu.render();
        }
    }

    /**
     * Sync layer UI with active layer adjustments
     */
    syncUI() {
        if (!this.masks) return;
        const adj = this.masks.getActiveAdjustments();
        this.maskSliders.forEach(name => {
            const slider = document.getElementById(`slider-mask-${name}`);
            const valueDisplay = document.getElementById(`val-mask-${name}`);
            const defaultValue = name === 'density' ? 100 : 0;
            const value = adj ? (adj[name] !== undefined ? adj[name] : defaultValue) : defaultValue;
            if (slider) slider.value = value;
            if (valueDisplay) {
                if (name === 'exposure') {
                    valueDisplay.textContent = value.toFixed(2);
                } else if (name === 'density') {
                    valueDisplay.textContent = `${Math.round(value)}%`;
                } else {
                    valueDisplay.textContent = Math.round(value);
                }
            }
        });

        // Sync Luminance Range Qualifier UI
        const lumToggle = document.getElementById('mask-lum-range-toggle');
        const lumControls = document.getElementById('mask-lum-range-controls');
        if (lumToggle) {
            lumToggle.checked = Boolean(adj?.useLumRange);
        }
        if (lumControls) {
            lumControls.style.display = adj?.useLumRange ? 'block' : 'none';
        }

        const sliderMin = document.getElementById('slider-mask-lum-min');
        const valMin = document.getElementById('val-mask-lum-min');
        const minVal = adj ? (adj.lumMin !== undefined ? adj.lumMin : 0) : 0;
        if (sliderMin) sliderMin.value = minVal;
        if (valMin) valMin.textContent = `${Math.round(minVal)}%`;

        const sliderMax = document.getElementById('slider-mask-lum-max');
        const valMax = document.getElementById('val-mask-lum-max');
        const maxVal = adj ? (adj.lumMax !== undefined ? adj.lumMax : 100) : 100;
        if (sliderMax) sliderMax.value = maxVal;
        if (valMax) valMax.textContent = `${Math.round(maxVal)}%`;

        const sliderFeather = document.getElementById('slider-mask-lum-feather');
        const valFeather = document.getElementById('val-mask-lum-feather');
        const featherVal = adj ? (adj.lumFeather !== undefined ? adj.lumFeather : 20) : 20;
        if (sliderFeather) sliderFeather.value = featherVal;
        if (valFeather) valFeather.textContent = `${Math.round(featherVal)}%`;
    }
}
