/**
 * TextTool - Handles canvas interactions for text
 * 
 * Features:
 * - Click: Place new text or select existing
 * - Double-click: Enter edit mode
 * - Drag: Move text object
 * - Handles: Resize
 * - Edit mode: Overlay contenteditable div
 */

export class TextTool {
    constructor(app) {
        this.app = app;
        this.active = false;

        // Interaction state
        this.dragStart = null;
        this.dragOffset = { x: 0, y: 0 };
        this.isDragging = false;

        // Edit mode
        this.editingLayer = null;
        this.editorElement = null;

        // Selection handle size
        this.handleSize = 8;

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

    _onMouseDown(e) {
        if (this.editingLayer) return; // Don't handle if editing

        const { x, y } = this.getImageCoords(e);
        const textManager = this.app.textManager;

        // Check if clicking on existing text
        const layer = textManager.findAtPoint(x, y);

        if (layer) {
            // Select and prepare to drag
            textManager.selectText(layer.id);
            this.dragStart = { x, y };
            this.dragOffset = {
                x: x - layer.x,
                y: y - layer.y
            };
            this.isDragging = false;
        } else {
            // Deselect
            textManager.deselectAll();
        }

        this.app.components.canvas?.requestRender();
    }

    _onMouseMove(e) {
        if (!this.dragStart) return;

        const { x, y } = this.getImageCoords(e);
        const selected = this.app.textManager?.getSelected();

        if (selected) {
            this.isDragging = true;
            selected.x = x - this.dragOffset.x;
            selected.y = y - this.dragOffset.y;
            this.app.components.canvas?.requestRender();
        }
    }

    _onMouseUp(e) {
        this.dragStart = null;
        this.isDragging = false;
    }

    _onDblClick(e) {
        const { x, y } = this.getImageCoords(e);
        const textManager = this.app.textManager;

        // Check if double-clicking on text
        const layer = textManager.findAtPoint(x, y);

        if (layer) {
            this.enterEditMode(layer);
        }
    }

    _onKeyDown(e) {
        if (this.editingLayer) return; // Let editor handle it

        const textManager = this.app.textManager;
        const selected = textManager.getSelected();

        if (!selected) return;

        // Delete key
        if (e.key === 'Delete' || e.key === 'Backspace') {
            textManager.removeSelected();
            e.preventDefault();
        }

        // Enter to edit
        if (e.key === 'Enter') {
            this.enterEditMode(selected);
            e.preventDefault();
        }

        // Arrow keys to nudge
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

        // Duplicate
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

        // Create editor overlay
        this._createEditor(layer);

        this.app.components.canvas?.requestRender();
    }

    /**
     * Exit edit mode
     */
    exitEditMode() {
        if (!this.editingLayer) return;

        // Save content
        if (this.editorElement) {
            this.editingLayer.content = this.editorElement.innerText || 'Add text';
            this.editorElement.remove();
            this.editorElement = null;
        }

        this.editingLayer.editing = false;
        this.editingLayer = null;

        this.app.components.canvas?.requestRender();
    }

    /**
     * Create the text editor overlay
     */
    _createEditor(layer) {
        const canvas = this.app.components.canvas?.mainCanvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;

        // Create contenteditable div
        const editor = document.createElement('div');
        editor.contentEditable = true;
        editor.className = 'text-editor-overlay';

        // Position over the text
        editor.style.cssText = `
            position: absolute;
            left: ${rect.left + layer.x * scaleX}px;
            top: ${rect.top + layer.y * scaleY}px;
            min-width: 50px;
            min-height: 20px;
            padding: 4px;
            font-family: ${layer.fontFamily};
            font-size: ${layer.fontSize * scaleY}px;
            font-weight: ${layer.fontWeight};
            font-style: ${layer.fontStyle};
            color: ${layer.color};
            line-height: ${layer.lineHeight};
            text-align: ${layer.textAlign};
            background: rgba(0,0,0,0.2);
            border: 2px solid #6366f1;
            border-radius: 4px;
            outline: none;
            white-space: pre-wrap;
            z-index: 10000;
        `;

        editor.innerText = layer.content;

        // Handle blur to save
        editor.addEventListener('blur', () => {
            this.exitEditMode();
        });

        // Handle escape to cancel
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.exitEditMode();
                e.preventDefault();
            }
        });

        document.body.appendChild(editor);
        this.editorElement = editor;

        // Focus and select all
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    /**
     * Render text layers and selection overlay
     */
    renderOverlay(ctx) {
        const textManager = this.app.textManager;
        if (!textManager) return;

        const selected = textManager.getSelected();
        if (!selected || selected.editing) return;

        // Measure the text
        selected.measure(ctx);
        const bounds = selected.getBounds();

        const hs = this.handleSize;

        // Draw selection box
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        ctx.setLineDash([]);

        // Draw corner handles
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;

        const corners = [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x, y: bounds.y + bounds.height },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
        ];

        for (const corner of corners) {
            ctx.fillRect(corner.x - hs / 2, corner.y - hs / 2, hs, hs);
            ctx.strokeRect(corner.x - hs / 2, corner.y - hs / 2, hs, hs);
        }
    }
}
