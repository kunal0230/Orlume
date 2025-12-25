/**
 * TextManager - Manages collection of text layers
 * 
 * Handles adding, removing, selecting, and ordering text layers.
 * Completely separate from image processing.
 */

import { TextLayer, TextPresets } from './TextLayer.js';

export class TextManager {
    constructor(app) {
        this.app = app;

        // Collection of text layers
        this.layers = [];

        // Currently selected layer
        this.selectedId = null;

        // Clipboard for copy/paste
        this._clipboard = null;
    }

    /**
     * Get all text layers (for rendering)
     */
    getTextLayers() {
        return this.layers;
    }

    /**
     * Get selected text layer
     */
    getSelected() {
        if (!this.selectedId) return null;
        return this.layers.find(l => l.id === this.selectedId) || null;
    }

    /**
     * Add a new text layer
     * @param {Object} options - TextLayer options or preset name
     */
    addText(options = {}) {
        // Check for preset
        if (typeof options === 'string' && TextPresets[options]) {
            options = { ...TextPresets[options] };
        }

        // Default position: center of canvas
        if (!options.x && !options.y) {
            const image = this.app.state?.image;
            if (image) {
                options.x = image.width / 2 - 100;
                options.y = image.height / 2;
            }
        }

        const layer = new TextLayer(options);
        this.layers.push(layer);
        this.selectText(layer.id);

        console.log(`📝 Added text layer: ${layer.id}`);
        this._notifyChange();

        return layer;
    }

    /**
     * Add text from preset
     */
    addHeading(x, y) {
        return this.addText({ ...TextPresets.heading, x, y });
    }

    addSubheading(x, y) {
        return this.addText({ ...TextPresets.subheading, x, y });
    }

    addBody(x, y) {
        return this.addText({ ...TextPresets.body, x, y });
    }

    /**
     * Remove a text layer
     */
    removeText(id) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return false;

        this.layers.splice(index, 1);

        if (this.selectedId === id) {
            this.selectedId = null;
        }

        console.log(`🗑️ Removed text layer: ${id}`);
        this._notifyChange();
        return true;
    }

    /**
     * Remove selected text layer
     */
    removeSelected() {
        if (this.selectedId) {
            return this.removeText(this.selectedId);
        }
        return false;
    }

    /**
     * Select a text layer
     */
    selectText(id) {
        // Deselect all
        for (const layer of this.layers) {
            layer.selected = false;
        }

        // Select the target
        const layer = this.layers.find(l => l.id === id);
        if (layer) {
            layer.selected = true;
            this.selectedId = id;
        } else {
            this.selectedId = null;
        }

        this._notifyChange();
    }

    /**
     * Deselect all
     */
    deselectAll() {
        for (const layer of this.layers) {
            layer.selected = false;
            layer.editing = false;
        }
        this.selectedId = null;
        this._notifyChange();
    }

    /**
     * Update a text layer's properties
     */
    updateText(id, props) {
        const layer = this.layers.find(l => l.id === id);
        if (!layer) return false;

        Object.assign(layer, props);
        this._notifyChange();
        return true;
    }

    /**
     * Update selected layer
     */
    updateSelected(props) {
        if (this.selectedId) {
            return this.updateText(this.selectedId, props);
        }
        return false;
    }

    /**
     * Find text layer at point
     * @param {number} x - X coordinate in image space
     * @param {number} y - Y coordinate in image space
     */
    findAtPoint(x, y) {
        // Check in reverse order (top layers first)
        for (let i = this.layers.length - 1; i >= 0; i--) {
            if (this.layers[i].containsPoint(x, y)) {
                return this.layers[i];
            }
        }
        return null;
    }

    /**
     * Move layer up (forward)
     */
    bringForward(id) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1 || index === this.layers.length - 1) return;

        [this.layers[index], this.layers[index + 1]] =
            [this.layers[index + 1], this.layers[index]];

        this._notifyChange();
    }

    /**
     * Move layer down (backward)
     */
    sendBackward(id) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index <= 0) return;

        [this.layers[index], this.layers[index - 1]] =
            [this.layers[index - 1], this.layers[index]];

        this._notifyChange();
    }

    /**
     * Move layer to top
     */
    bringToFront(id) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return;

        const [layer] = this.layers.splice(index, 1);
        this.layers.push(layer);

        this._notifyChange();
    }

    /**
     * Move layer to bottom
     */
    sendToBack(id) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return;

        const [layer] = this.layers.splice(index, 1);
        this.layers.unshift(layer);

        this._notifyChange();
    }

    /**
     * Copy selected layer to clipboard
     */
    copy() {
        const selected = this.getSelected();
        if (selected) {
            this._clipboard = selected.toJSON();
        }
    }

    /**
     * Paste from clipboard
     */
    paste() {
        if (this._clipboard) {
            const layer = TextLayer.fromJSON(this._clipboard);
            layer.id = `text-${Date.now()}`; // New ID
            layer.x += 20;
            layer.y += 20;
            this.layers.push(layer);
            this.selectText(layer.id);
            this._notifyChange();
        }
    }

    /**
     * Duplicate selected layer
     */
    duplicate() {
        const selected = this.getSelected();
        if (selected) {
            const copy = selected.clone();
            this.layers.push(copy);
            this.selectText(copy.id);
            this._notifyChange();
        }
    }

    /**
     * Clear all text layers
     */
    clear() {
        this.layers = [];
        this.selectedId = null;
        this._notifyChange();
    }

    /**
     * Serialize all layers
     */
    toJSON() {
        return this.layers.map(l => l.toJSON());
    }

    /**
     * Load from serialized data
     */
    fromJSON(data) {
        this.layers = data.map(d => TextLayer.fromJSON(d));
        this.selectedId = null;
        this._notifyChange();
    }

    /**
     * Notify app of changes (triggers re-render)
     */
    _notifyChange() {
        // Request canvas update
        if (this.app.components?.canvas) {
            this.app.components.canvas.requestRender();
        }
    }
}
