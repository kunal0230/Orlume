/**
 * TextLayerManager - Central manager for all text layers
 * 
 * Handles:
 * - Layer CRUD operations
 * - Selection and multi-select
 * - Z-ordering
 * - Undo/redo integration
 * - Rendering coordination
 */

import { TextLayer } from './TextLayer.js';

export class TextLayerManager {
    constructor(editor) {
        this.editor = editor;
        this.layers = [];
        this.selectedLayerId = null;
        this.hoveredLayerId = null;

        // Canvas overlay for text rendering
        this.overlayCanvas = null;
        this.overlayCtx = null;

        // Editing state
        this.isEditing = false;
        this.editingLayerId = null;

        // Drag state
        this.isDragging = false;
        this.dragHandle = null;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragLayerStartX = 0;
        this.dragLayerStartY = 0;
        this.dragLayerStartW = 0;
        this.dragLayerStartH = 0;
        this.dragLayerStartRot = 0;

        // Event listeners
        this._listeners = new Map();

        this._init();
    }

    /**
     * Initialize overlay canvas
     */
    _init() {
        // Create overlay canvas for text rendering
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            this.overlayCanvas = document.createElement('canvas');
            this.overlayCanvas.id = 'text-overlay-canvas';
            this.overlayCanvas.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 10;
                display: none;
            `;
            canvasContainer.appendChild(this.overlayCanvas);
            this.overlayCtx = this.overlayCanvas.getContext('2d');
        }
    }

    /**
     * Show overlay canvas
     */
    showOverlay() {
        if (this.overlayCanvas) {
            this.overlayCanvas.style.display = 'block';
        }
    }

    /**
     * Hide overlay canvas
     */
    hideOverlay() {
        if (this.overlayCanvas) {
            this.overlayCanvas.style.display = 'none';
        }
    }

    /**
     * Update overlay canvas size to match GPU canvas
     */
    updateCanvasSize() {
        if (!this.overlayCanvas) return;

        const gpuCanvas = document.getElementById('gpu-canvas');
        if (gpuCanvas) {
            this.overlayCanvas.width = gpuCanvas.width;
            this.overlayCanvas.height = gpuCanvas.height;
            this.render();
        }
    }

    /**
     * Add a new text layer
     */
    addLayer(options = {}) {
        const layer = new TextLayer({
            x: options.x || this.overlayCanvas.width / 2 - 100,
            y: options.y || this.overlayCanvas.height / 2 - 25,
            ...options
        });

        // Auto-increment name
        layer.name = `Text ${this.layers.length + 1}`;

        this.layers.push(layer);
        this.selectedLayerId = layer.id;

        this._emit('layerAdded', { layer });
        this._emit('selectionChanged', { layerId: layer.id });

        this.render();
        return layer;
    }

    /**
     * Get layer by ID
     */
    getLayer(id) {
        return this.layers.find(l => l.id === id);
    }

    /**
     * Get selected layer
     */
    getSelectedLayer() {
        return this.selectedLayerId ? this.getLayer(this.selectedLayerId) : null;
    }

    /**
     * Select a layer
     */
    selectLayer(id) {
        if (this.selectedLayerId !== id) {
            this.selectedLayerId = id;
            this._emit('selectionChanged', { layerId: id });
            this.render();
        }
    }

    /**
     * Deselect all layers
     */
    deselectAll() {
        if (this.selectedLayerId) {
            this.selectedLayerId = null;
            this._emit('selectionChanged', { layerId: null });
            this.render();
        }
    }

    /**
     * Delete a layer
     */
    deleteLayer(id) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index !== -1) {
            const layer = this.layers[index];
            this.layers.splice(index, 1);

            if (this.selectedLayerId === id) {
                this.selectedLayerId = this.layers.length > 0 ? this.layers[this.layers.length - 1].id : null;
            }

            this._emit('layerDeleted', { layer });
            this._emit('selectionChanged', { layerId: this.selectedLayerId });
            this.render();
        }
    }

    /**
     * Duplicate a layer
     */
    duplicateLayer(id) {
        const layer = this.getLayer(id);
        if (layer) {
            const clone = layer.clone();
            clone.name = `${layer.name} Copy`;
            this.layers.push(clone);
            this.selectedLayerId = clone.id;
            this._emit('layerAdded', { layer: clone });
            this._emit('selectionChanged', { layerId: clone.id });
            this.render();
            return clone;
        }
        return null;
    }

    /**
     * Move layer in z-order
     */
    moveLayer(id, direction) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return;

        const newIndex = direction === 'up' ? index + 1 : index - 1;
        if (newIndex < 0 || newIndex >= this.layers.length) return;

        const [layer] = this.layers.splice(index, 1);
        this.layers.splice(newIndex, 0, layer);

        this._emit('layerOrderChanged');
        this.render();
    }

    /**
     * Get layer at point
     */
    getLayerAtPoint(x, y) {
        // Check from top to bottom (reverse order)
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            if (!layer.visible || layer.locked) continue;

            if (layer.containsPoint(x, y, this.overlayCtx)) {
                return layer;
            }
        }
        return null;
    }

    /**
     * Start dragging
     */
    startDrag(x, y, handle = null) {
        const layer = this.getSelectedLayer();
        if (!layer || layer.locked) return false;

        this.isDragging = true;
        this.dragHandle = handle;
        this.dragStartX = x;
        this.dragStartY = y;

        const bounds = layer.getBounds(this.overlayCtx);
        this.dragLayerStartX = layer.x;
        this.dragLayerStartY = layer.y;
        this.dragLayerStartW = bounds.width;
        this.dragLayerStartH = bounds.height;
        this.dragLayerStartRot = layer.rotation;

        return true;
    }

    /**
     * Update drag
     */
    updateDrag(x, y) {
        if (!this.isDragging) return;

        const layer = this.getSelectedLayer();
        if (!layer) return;

        const dx = x - this.dragStartX;
        const dy = y - this.dragStartY;

        if (this.dragHandle === 'rotate') {
            // Rotation
            const bounds = layer.getBounds(this.overlayCtx);
            const cx = bounds.x + bounds.width / 2;
            const cy = bounds.y + bounds.height / 2;

            const startAngle = Math.atan2(this.dragStartY - cy, this.dragStartX - cx);
            const currentAngle = Math.atan2(y - cy, x - cx);
            const angleDiff = (currentAngle - startAngle) * 180 / Math.PI;

            layer.rotation = this.dragLayerStartRot + angleDiff;
            layer.invalidate();
        } else if (this.dragHandle) {
            // Resize
            let newX = this.dragLayerStartX;
            let newY = this.dragLayerStartY;
            let newW = this.dragLayerStartW;
            let newH = this.dragLayerStartH;

            if (this.dragHandle.includes('r')) {
                newW = Math.max(layer.minWidth, this.dragLayerStartW + dx);
            }
            if (this.dragHandle.includes('l')) {
                newW = Math.max(layer.minWidth, this.dragLayerStartW - dx);
                newX = this.dragLayerStartX + (this.dragLayerStartW - newW);
            }
            if (this.dragHandle.includes('b')) {
                newH = Math.max(layer.minHeight, this.dragLayerStartH + dy);
            }
            if (this.dragHandle.includes('t')) {
                newH = Math.max(layer.minHeight, this.dragLayerStartH - dy);
                newY = this.dragLayerStartY + (this.dragLayerStartH - newH);
            }

            layer.x = newX;
            layer.y = newY;
            layer.width = newW;
            layer.height = newH;
            layer.invalidate();
        } else {
            // Move
            layer.x = this.dragLayerStartX + dx;
            layer.y = this.dragLayerStartY + dy;
            layer.invalidate();
        }

        this._emit('layerTransformed', { layer });
        this.render();
    }

    /**
     * End drag
     */
    endDrag() {
        if (this.isDragging) {
            this.isDragging = false;
            this.dragHandle = null;
            this._emit('layerTransformEnd');
        }
    }

    /**
     * Render all text layers to overlay canvas
     */
    render() {
        if (!this.overlayCtx) return;

        const ctx = this.overlayCtx;
        ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        // Render each visible layer
        this.layers.forEach(layer => {
            if (!layer.visible) return;
            this._renderLayer(ctx, layer);
        });

        // Render selection UI for selected layer
        const selected = this.getSelectedLayer();
        if (selected && !this.isEditing) {
            this._renderSelectionUI(ctx, selected);
        }
    }

    /**
     * Render a single text layer
     */
    _renderLayer(ctx, layer) {
        const bounds = layer.getBounds(ctx);

        ctx.save();
        ctx.globalAlpha = layer.opacity;

        // Apply transforms
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate(layer.rotation * Math.PI / 180);
        ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
        ctx.translate(-cx, -cy);

        // Background
        if (layer.backgroundEnabled) {
            const pad = layer.backgroundPadding;
            ctx.fillStyle = layer.backgroundColor;
            ctx.globalAlpha = layer.opacity * layer.backgroundOpacity;

            this._roundRect(ctx,
                bounds.x - pad,
                bounds.y - pad,
                bounds.width + pad * 2,
                bounds.height + pad * 2,
                layer.backgroundRadius
            );
            ctx.fill();
            ctx.globalAlpha = layer.opacity;
        }

        // Set up text rendering
        ctx.font = layer.font;
        ctx.textBaseline = 'top';

        // Apply text transform
        let text = layer.text;
        if (layer.textTransform === 'uppercase') text = text.toUpperCase();
        else if (layer.textTransform === 'lowercase') text = text.toLowerCase();
        else if (layer.textTransform === 'capitalize') text = text.replace(/\b\w/g, c => c.toUpperCase());

        const lines = text.split('\n');

        // Calculate text positions
        lines.forEach((line, i) => {
            const lineY = bounds.y + i * bounds.lineHeight;
            let lineX = bounds.x;

            // Text alignment
            if (layer.textAlign === 'center') {
                const lineWidth = ctx.measureText(line).width;
                lineX = bounds.x + (bounds.width - lineWidth) / 2;
            } else if (layer.textAlign === 'right') {
                const lineWidth = ctx.measureText(line).width;
                lineX = bounds.x + bounds.width - lineWidth;
            }

            // Shadow
            if (layer.shadowEnabled) {
                ctx.save();
                ctx.shadowColor = layer.shadowColor;
                ctx.shadowOffsetX = layer.shadowOffsetX;
                ctx.shadowOffsetY = layer.shadowOffsetY;
                ctx.shadowBlur = layer.shadowBlur;
                ctx.globalAlpha = layer.opacity * layer.shadowOpacity;
                ctx.fillStyle = layer.fillColor;
                this._drawTextWithSpacing(ctx, line, lineX, lineY, layer.letterSpacing);
                ctx.restore();
            }

            // Stroke
            if (layer.strokeEnabled && layer.strokeWidth > 0) {
                ctx.strokeStyle = layer.strokeColor;
                ctx.lineWidth = layer.strokeWidth;
                ctx.lineJoin = 'round';
                this._strokeTextWithSpacing(ctx, line, lineX, lineY, layer.letterSpacing);
            }

            // Fill
            ctx.fillStyle = layer.fillColor;
            ctx.globalAlpha = layer.opacity * layer.fillOpacity;
            this._drawTextWithSpacing(ctx, line, lineX, lineY, layer.letterSpacing);

            // Underline / Line-through
            if (layer.textDecoration !== 'none') {
                const lineWidth = ctx.measureText(line).width + layer.letterSpacing * line.length;
                ctx.globalAlpha = layer.opacity;
                ctx.strokeStyle = layer.fillColor;
                ctx.lineWidth = layer.fontSize / 20;

                let decoY = lineY;
                if (layer.textDecoration === 'underline') {
                    decoY = lineY + layer.fontSize * 0.9;
                } else if (layer.textDecoration === 'line-through') {
                    decoY = lineY + layer.fontSize * 0.5;
                }

                ctx.beginPath();
                ctx.moveTo(lineX, decoY);
                ctx.lineTo(lineX + lineWidth, decoY);
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    /**
     * Draw text with letter spacing
     */
    _drawTextWithSpacing(ctx, text, x, y, spacing) {
        if (spacing === 0) {
            ctx.fillText(text, x, y);
            return;
        }

        let currentX = x;
        for (const char of text) {
            ctx.fillText(char, currentX, y);
            currentX += ctx.measureText(char).width + spacing;
        }
    }

    /**
     * Stroke text with letter spacing
     */
    _strokeTextWithSpacing(ctx, text, x, y, spacing) {
        if (spacing === 0) {
            ctx.strokeText(text, x, y);
            return;
        }

        let currentX = x;
        for (const char of text) {
            ctx.strokeText(char, currentX, y);
            currentX += ctx.measureText(char).width + spacing;
        }
    }

    /**
     * Helper for rounded rectangles
     */
    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /**
     * Render selection UI (handles, border)
     */
    _renderSelectionUI(ctx, layer) {
        const bounds = layer.getBounds(ctx);

        ctx.save();

        // Apply rotation transform
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate(layer.rotation * Math.PI / 180);
        ctx.translate(-cx, -cy);

        // Selection border
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

        // Handle positions
        const handleSize = 8;
        const handles = [
            { x: bounds.x, y: bounds.y }, // tl
            { x: bounds.x + bounds.width, y: bounds.y }, // tr
            { x: bounds.x, y: bounds.y + bounds.height }, // bl
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, // br
            { x: bounds.x + bounds.width / 2, y: bounds.y }, // t
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }, // r
            { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }, // b
            { x: bounds.x, y: bounds.y + bounds.height / 2 }, // l
        ];

        // Draw handles
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;

        handles.forEach(h => {
            ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        });

        // Rotation handle
        const rotateY = bounds.y - 30;

        // Line to rotate handle
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bounds.x + bounds.width / 2, bounds.y);
        ctx.lineTo(bounds.x + bounds.width / 2, rotateY);
        ctx.stroke();

        // Rotate handle circle
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bounds.x + bounds.width / 2, rotateY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Render text layers to a given canvas (for export)
     */
    renderToCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        this.layers.forEach(layer => {
            if (layer.visible) {
                this._renderLayer(ctx, layer);
            }
        });
    }

    /**
     * Subscribe to events
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(callback);
    }

    /**
     * Emit event
     */
    _emit(event, data = {}) {
        const listeners = this._listeners.get(event) || [];
        listeners.forEach(cb => cb(data));
    }

    /**
     * Serialize all layers
     */
    serialize() {
        return this.layers.map(l => l.serialize());
    }

    /**
     * Deserialize layers
     */
    deserialize(data) {
        this.layers = data.map(d => TextLayer.deserialize(d));
        this.selectedLayerId = null;
        this.render();
    }
}
