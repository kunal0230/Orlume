/**
 * TextTool - Enhanced canvas interactions for text
 * 
 * Features:
 * - Click: Select text
 * - Double-click: Enter edit mode
 * - Drag: Move text object
 * - Side handles: Width resize (layout reflow)
 * - Corner handles: Scale
 * - Rotation handle: Rotate with 15° snapping
 * - Live editor sync
 * - Cursor semantics
 * - Snapping guides
 */

export class TextTool {
    constructor(app) {
        this.app = app;
        this.active = false;

        // Interaction state
        this.dragStart = null;
        this.dragOffset = { x: 0, y: 0 };
        this.isDragging = false;

        // Handle interaction
        this.activeHandle = null; // null | 'move' | 'left' | 'right' | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br' | 'rotate'
        this.handleStartValue = null;

        // Edit mode
        this.editingLayer = null;
        this.editorElement = null;

        // Handle dimensions
        this.handleSize = 10;
        this.rotationHandleOffset = 30;

        // Snapping
        this.snapThreshold = 8;
        this.snapLines = { x: null, y: null };

        // Bound handlers
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    activate() {
        this.active = true;

        const canvas = this.app.components.canvas?.mainCanvas;
        if (canvas) {
            canvas.addEventListener('mousedown', this._onMouseDown);
            canvas.addEventListener('dblclick', this._onDblClick);
            canvas.addEventListener('mousemove', this._updateCursor.bind(this));
        }
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('keydown', this._onKeyDown);

        this.app.components.canvas?.requestRender();
    }

    deactivate() {
        this.active = false;
        this.exitEditMode();

        const canvas = this.app.components.canvas?.mainCanvas;
        if (canvas) {
            canvas.removeEventListener('mousedown', this._onMouseDown);
            canvas.removeEventListener('dblclick', this._onDblClick);
            canvas.style.cursor = 'default';
        }
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('keydown', this._onKeyDown);

        this.app.textManager?.deselectAll();
        this.app.components.canvas?.requestRender();
    }

    /**
     * Convert mouse event to image coordinates
     */
    getImageCoords(e) {
        const canvas = this.app.components.canvas?.mainCanvas;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    /**
     * Get handle positions for selected layer
     */
    getHandles(layer) {
        if (!layer) return null;

        const ctx = this.app.components.canvas?.mainCtx;
        if (!ctx) return null;

        layer.measure(ctx);
        const bounds = layer.getBounds();
        const hs = this.handleSize;
        const rot = this.rotationHandleOffset;

        return {
            // Side handles (width resize)
            left: { x: bounds.x, y: bounds.y + bounds.height / 2, type: 'left', cursor: 'ew-resize' },
            right: { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2, type: 'right', cursor: 'ew-resize' },

            // Corner handles (scale)
            'corner-tl': { x: bounds.x, y: bounds.y, type: 'corner-tl', cursor: 'nwse-resize' },
            'corner-tr': { x: bounds.x + bounds.width, y: bounds.y, type: 'corner-tr', cursor: 'nesw-resize' },
            'corner-bl': { x: bounds.x, y: bounds.y + bounds.height, type: 'corner-bl', cursor: 'nesw-resize' },
            'corner-br': { x: bounds.x + bounds.width, y: bounds.y + bounds.height, type: 'corner-br', cursor: 'nwse-resize' },

            // Rotation handle (above center top)
            rotate: { x: bounds.x + bounds.width / 2, y: bounds.y - rot, type: 'rotate', cursor: 'grab' },

            // Center for rotation pivot
            center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },

            bounds: bounds
        };
    }

    /**
     * Check which handle is at point
     */
    getHandleAtPoint(x, y, handles) {
        if (!handles) return null;
        const hs = this.handleSize;

        const checkHandle = (h) => {
            return Math.abs(x - h.x) < hs && Math.abs(y - h.y) < hs;
        };

        // Check rotation first (highest priority)
        if (checkHandle(handles.rotate)) return 'rotate';

        // Check corners
        if (checkHandle(handles['corner-tl'])) return 'corner-tl';
        if (checkHandle(handles['corner-tr'])) return 'corner-tr';
        if (checkHandle(handles['corner-bl'])) return 'corner-bl';
        if (checkHandle(handles['corner-br'])) return 'corner-br';

        // Check sides
        if (checkHandle(handles.left)) return 'left';
        if (checkHandle(handles.right)) return 'right';

        return null;
    }

    /**
     * Update cursor based on hover position
     */
    _updateCursor(e) {
        if (this.editingLayer) return;

        const canvas = this.app.components.canvas?.mainCanvas;
        if (!canvas) return;

        const { x, y } = this.getImageCoords(e);
        const selected = this.app.textManager?.getSelected();

        if (selected) {
            const handles = this.getHandles(selected);
            const handleType = this.getHandleAtPoint(x, y, handles);

            if (handleType) {
                canvas.style.cursor = handles[handleType]?.cursor || 'pointer';
                return;
            }

            // Check if over text (move)
            if (selected.containsPoint(x, y)) {
                canvas.style.cursor = 'move';
                return;
            }
        }

        // Check if over any text
        const layer = this.app.textManager?.findAtPoint(x, y);
        canvas.style.cursor = layer ? 'pointer' : 'default';
    }

    _onMouseDown(e) {
        if (this.editingLayer) return;

        const { x, y } = this.getImageCoords(e);
        const textManager = this.app.textManager;
        const selected = textManager.getSelected();

        // Check if clicking on handle of selected item
        if (selected) {
            const handles = this.getHandles(selected);
            const handleType = this.getHandleAtPoint(x, y, handles);

            if (handleType) {
                this.activeHandle = handleType;
                this.dragStart = { x, y };

                // Store initial values for the operation
                if (handleType === 'rotate') {
                    this.handleStartValue = selected.rotation;
                } else if (handleType === 'left' || handleType === 'right') {
                    this.handleStartValue = {
                        width: selected.fixedWidth || selected._bounds.width,
                        x: selected.x,
                        autoWidth: selected.autoWidth
                    };
                } else if (handleType.startsWith('corner')) {
                    this.handleStartValue = { scale: selected.scale };
                }
                return;
            }
        }

        // Check if clicking on existing text
        const layer = textManager.findAtPoint(x, y);

        if (layer) {
            textManager.selectText(layer.id);
            this.activeHandle = 'move';
            this.dragStart = { x, y };
            this.dragOffset = {
                x: x - layer.x,
                y: y - layer.y
            };
            this.isDragging = false;

            // Update panel
            this.app.components.textPanel?.updateUI();
        } else {
            textManager.deselectAll();
            this.app.components.textPanel?.updateUI();
        }

        this.app.components.canvas?.requestRender();
    }

    _onMouseMove(e) {
        if (!this.dragStart || !this.activeHandle) return;

        const { x, y } = this.getImageCoords(e);
        const selected = this.app.textManager?.getSelected();
        if (!selected) return;

        this.isDragging = true;
        const handles = this.getHandles(selected);

        switch (this.activeHandle) {
            case 'move':
                // Apply snapping
                let newX = x - this.dragOffset.x;
                let newY = y - this.dragOffset.y;

                const snapped = this._applySnapping(selected, newX, newY);
                selected.x = snapped.x;
                selected.y = snapped.y;
                break;

            case 'left':
                // Resize from left (change width and x)
                const dxLeft = x - this.dragStart.x;
                selected.autoWidth = false;
                selected.fixedWidth = Math.max(50, this.handleStartValue.width - dxLeft);
                selected.x = this.handleStartValue.x + dxLeft;
                break;

            case 'right':
                // Resize from right (change width only)
                const dxRight = x - this.dragStart.x;
                selected.autoWidth = false;
                selected.fixedWidth = Math.max(50, this.handleStartValue.width + dxRight);
                break;

            case 'rotate':
                // Calculate angle from center
                const cx = handles.center.x;
                const cy = handles.center.y;
                const angle = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;

                // Snap to 15° increments with Shift key
                if (e.shiftKey) {
                    selected.rotation = Math.round(angle / 15) * 15;
                } else {
                    selected.rotation = angle;
                }
                break;

            default:
                // Corner scaling
                if (this.activeHandle.startsWith('corner')) {
                    const startScale = this.handleStartValue.scale;
                    const dx = x - this.dragStart.x;
                    const dy = y - this.dragStart.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const sign = (dx + dy) > 0 ? 1 : -1;
                    selected.scale = Math.max(0.1, startScale + sign * dist / 200);
                }
        }

        // Update panel live
        this.app.components.textPanel?.updateUI();
        this.app.components.canvas?.requestRender();
    }

    _onMouseUp(e) {
        this.dragStart = null;
        this.activeHandle = null;
        this.handleStartValue = null;
        this.isDragging = false;
        this.snapLines = { x: null, y: null };
        this.app.components.canvas?.requestRender();
    }

    /**
     * Apply snapping to position
     */
    _applySnapping(layer, x, y) {
        const image = this.app.state?.image;
        if (!image) return { x, y };

        const ctx = this.app.components.canvas?.mainCtx;
        layer.measure(ctx);
        const bounds = layer._bounds;

        const centerX = x + bounds.width * layer.scale / 2;
        const centerY = y + bounds.height * layer.scale / 2;

        const imageCenterX = image.width / 2;
        const imageCenterY = image.height / 2;

        let snappedX = x;
        let snappedY = y;
        this.snapLines = { x: null, y: null };

        // Snap to center X
        if (Math.abs(centerX - imageCenterX) < this.snapThreshold) {
            snappedX = imageCenterX - bounds.width * layer.scale / 2;
            this.snapLines.x = imageCenterX;
        }

        // Snap to center Y
        if (Math.abs(centerY - imageCenterY) < this.snapThreshold) {
            snappedY = imageCenterY - bounds.height * layer.scale / 2;
            this.snapLines.y = imageCenterY;
        }

        return { x: snappedX, y: snappedY };
    }

    _onDblClick(e) {
        const { x, y } = this.getImageCoords(e);
        const textManager = this.app.textManager;
        const selected = textManager.getSelected();

        // Check if double-clicking on side handle (return to auto-width)
        if (selected) {
            const handles = this.getHandles(selected);
            const handleType = this.getHandleAtPoint(x, y, handles);

            if (handleType === 'left' || handleType === 'right') {
                selected.autoWidth = true;
                selected.fixedWidth = null;
                this.app.components.canvas?.requestRender();
                return;
            }
        }

        // Check if double-clicking on text to edit
        const layer = textManager.findAtPoint(x, y);
        if (layer) {
            this.enterEditMode(layer);
        }
    }

    _onKeyDown(e) {
        if (this.editingLayer) return;

        const textManager = this.app.textManager;
        const selected = textManager.getSelected();

        if (!selected) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            textManager.removeSelected();
            this.app.components.textPanel?.updateUI();
            e.preventDefault();
        }

        if (e.key === 'Enter') {
            this.enterEditMode(selected);
            e.preventDefault();
        }

        const nudge = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') {
            selected.y -= nudge;
            this.app.components.canvas?.requestRender();
            e.preventDefault();
        }
        if (e.key === 'ArrowDown') {
            selected.y += nudge;
            this.app.components.canvas?.requestRender();
            e.preventDefault();
        }
        if (e.key === 'ArrowLeft') {
            selected.x -= nudge;
            this.app.components.canvas?.requestRender();
            e.preventDefault();
        }
        if (e.key === 'ArrowRight') {
            selected.x += nudge;
            this.app.components.canvas?.requestRender();
            e.preventDefault();
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            textManager.duplicate();
            e.preventDefault();
        }
    }

    /**
     * Enter edit mode for a text layer
     */
    enterEditMode(layer) {
        if (this.editingLayer) {
            this.exitEditMode();
        }

        this.editingLayer = layer;
        layer.editing = true;

        this._createEditor(layer);
        this.app.components.canvas?.requestRender();
    }

    /**
     * Exit edit mode
     */
    exitEditMode() {
        if (!this.editingLayer) return;

        if (this.editorElement) {
            this.editingLayer.content = this.editorElement.innerText || 'Add text';
            this.editorElement.remove();
            this.editorElement = null;
        }

        this.editingLayer.editing = false;
        this.editingLayer = null;

        this.app.components.canvas?.requestRender();
        this.app.components.textPanel?.updateUI();
    }

    /**
     * Create the text editor overlay with live sync
     */
    _createEditor(layer) {
        const canvas = this.app.components.canvas?.mainCanvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;

        const editor = document.createElement('div');
        editor.contentEditable = true;
        editor.className = 'text-editor-overlay';

        editor.style.cssText = `
            position: fixed;
            left: ${rect.left + layer.x * scaleX}px;
            top: ${rect.top + layer.y * scaleY}px;
            min-width: 50px;
            min-height: 20px;
            padding: 4px 8px;
            font-family: ${layer.fontFamily};
            font-size: ${layer.fontSize * scaleY}px;
            font-weight: ${layer.fontWeight};
            font-style: ${layer.fontStyle};
            color: ${layer.color};
            line-height: ${layer.lineHeight};
            text-align: ${layer.textAlign};
            background: rgba(0,0,0,0.3);
            border: 2px solid #6366f1;
            border-radius: 4px;
            outline: none;
            white-space: pre-wrap;
            z-index: 10000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            transform-origin: top left;
            transform: rotate(${layer.rotation}deg) scale(${layer.scale});
        `;

        editor.innerText = layer.content;

        // LIVE SYNC: Update on every keystroke
        editor.addEventListener('input', () => {
            layer.content = editor.innerText || 'Add text';
            this.app.components.canvas?.requestRender();
        });

        editor.addEventListener('blur', () => {
            this.exitEditMode();
        });

        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.exitEditMode();
                e.preventDefault();
            }
        });

        document.body.appendChild(editor);
        this.editorElement = editor;

        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    /**
     * Render selection overlay with handles
     */
    renderOverlay(ctx) {
        const textManager = this.app.textManager;
        if (!textManager) return;

        // Draw snap guides first (under selection)
        this._drawSnapGuides(ctx);

        const selected = textManager.getSelected();
        if (!selected || selected.editing) return;

        const handles = this.getHandles(selected);
        if (!handles) return;

        const bounds = handles.bounds;
        const hs = this.handleSize;

        ctx.save();

        // Apply rotation transform for selection box
        const cx = handles.center.x;
        const cy = handles.center.y;
        ctx.translate(cx, cy);
        ctx.rotate(selected.rotation * Math.PI / 180);
        ctx.translate(-cx, -cy);

        // Draw selection box
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

        // Draw side handles (circles for width resize)
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;

        // Left handle
        ctx.beginPath();
        ctx.arc(handles.left.x, handles.left.y, hs / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Right handle
        ctx.beginPath();
        ctx.arc(handles.right.x, handles.right.y, hs / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw corner handles (squares for scale)
        const cornerKeys = ['corner-tl', 'corner-tr', 'corner-bl', 'corner-br'];
        for (const key of cornerKeys) {
            const h = handles[key];
            ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
            ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
        }

        ctx.restore();

        // Draw rotation handle (not rotated, stays above)
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(selected.rotation * Math.PI / 180);

        // Line from top center to rotation handle
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -(bounds.height / 2));
        ctx.lineTo(0, -(bounds.height / 2) - this.rotationHandleOffset);
        ctx.stroke();

        // Rotation handle (circle with cross)
        ctx.beginPath();
        ctx.arc(0, -(bounds.height / 2) - this.rotationHandleOffset, hs / 2 + 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Cross inside
        ctx.beginPath();
        ctx.moveTo(-3, -(bounds.height / 2) - this.rotationHandleOffset);
        ctx.lineTo(3, -(bounds.height / 2) - this.rotationHandleOffset);
        ctx.moveTo(0, -(bounds.height / 2) - this.rotationHandleOffset - 3);
        ctx.lineTo(0, -(bounds.height / 2) - this.rotationHandleOffset + 3);
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Draw snapping guide lines
     */
    _drawSnapGuides(ctx) {
        if (!this.snapLines.x && !this.snapLines.y) return;

        const image = this.app.state?.image;
        if (!image) return;

        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        if (this.snapLines.x !== null) {
            ctx.beginPath();
            ctx.moveTo(this.snapLines.x, 0);
            ctx.lineTo(this.snapLines.x, image.height);
            ctx.stroke();
        }

        if (this.snapLines.y !== null) {
            ctx.beginPath();
            ctx.moveTo(0, this.snapLines.y);
            ctx.lineTo(image.width, this.snapLines.y);
            ctx.stroke();
        }

        ctx.restore();
    }
}
