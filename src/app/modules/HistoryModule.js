/**
 * HistoryModule - Undo/Redo state management
 * 
 * Handles:
 * - State capture (snapshots)
 * - State restoration
 * - Debounced history push
 * - Undo/Redo operations
 */

export class HistoryModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.gpu = editor.gpu;
        this.masks = editor.masks;
        this.history = editor.history;
        this.elements = editor.elements;

        // Debounce timer
        this._historyDebounceTimer = null;
    }

    /**
     * Push current state to history (debounced to avoid flooding)
     * Captures global state across all sections for full undo/redo support
     */
    pushDebounced() {
        clearTimeout(this._historyDebounceTimer);
        this._historyDebounceTimer = setTimeout(() => {
            const snapshot = this.captureFullState();
            this.history.pushState(snapshot);
        }, 100);
    }

    /**
     * Clear pending debounced push (used before manual push)
     */
    clearDebounce() {
        clearTimeout(this._historyDebounceTimer);
    }

    /**
     * Capture the full application state for history
     * Includes image data for undoing crops and destructive operations
     */
    captureFullState() {
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
            this.restoreState(state);

            // If in liquify mode, refresh the liquify tool to show the change
            if (this.state.currentTool === 'liquify') {
                setTimeout(() => this.editor._activateLiquifyTool(), 300);
            }
        }
    }

    /**
     * Redo previously undone adjustment
     */
    redo() {
        const state = this.history.redo();
        if (state) {
            this.restoreState(state);

            // If in liquify mode, refresh the liquify tool to show the change
            if (this.state.currentTool === 'liquify') {
                setTimeout(() => this.editor._activateLiquifyTool(), 300);
            }
        }
    }

    /**
     * Restore full state from history snapshot
     * Handles image restoration for crop undo
     */
    restoreState(snapshot) {

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
                this.editor.updateLayersList();

                // Update UI
                this.elements.perfIndicator.textContent = `${img.width}×${img.height}`;

                // Then restore adjustments
                this.restoreAdjustments(snapshot);

            };
            img.src = snapshot.imageDataUrl;
        } else {
            // No image change, just restore adjustments
            this.restoreAdjustments(snapshot);
        }
    }

    /**
     * Restore adjustment values from snapshot
     */
    restoreAdjustments(snapshot) {
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
        this.editor.renderWithMask(false);
        requestAnimationFrame(() => this.editor.renderHistogram());
    }
}
