/**
 * EditorState - Centralized state management for the GPU Editor
 */
export class EditorState {
    constructor() {
        // Tool state
        this.currentTool = 'develop';
        this.isPainting = false;
        this.lastPaintPos = null;
        this.showingBefore = false;

        // Image state
        this.originalImage = null;
        this.hasImage = false;

        // Brush settings (synced with MaskSystem)
        this.brushSettings = {
            size: 100,
            hardness: 50,
            opacity: 100,
            erase: false
        };

        // Global adjustment values
        this.globalAdjustments = {
            exposure: 0,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            structure: 0,
            clarity: 0,
            dehaze: 0,
            temperature: 0,
            tint: 0,
            vibrance: 0,
            saturation: 0
        };

        // Event listeners
        this._listeners = new Map();
    }

    /**
     * Set the current tool
     */
    setTool(tool) {
        const previousTool = this.currentTool;
        this.currentTool = tool;
        this._emit('toolChange', { tool, previousTool });
    }

    /**
     * Set a global adjustment value
     */
    setAdjustment(name, value) {
        if (name in this.globalAdjustments) {
            this.globalAdjustments[name] = value;
            this._emit('adjustmentChange', { name, value });
        }
    }

    /**
     * Set brush setting
     */
    setBrushSetting(name, value) {
        if (name in this.brushSettings) {
            this.brushSettings[name] = value;
            this._emit('brushSettingChange', { name, value });
        }
    }

    /**
     * Set painting state
     */
    setPainting(isPainting, pos = null) {
        this.isPainting = isPainting;
        this.lastPaintPos = pos;
    }

    /**
     * Update last paint position
     */
    updatePaintPos(pos) {
        this.lastPaintPos = pos;
    }

    /**
     * Set original image
     */
    setImage(image) {
        this.originalImage = image;
        this.hasImage = !!image;
        this.imageId = Date.now().toString(36) + Math.random().toString(36).substr(2); // Unique ID for this image version
        this._emit('imageLoad', { image });
    }

    /**
     * Reset all adjustments to defaults
     */
    resetAdjustments() {
        for (const key of Object.keys(this.globalAdjustments)) {
            this.globalAdjustments[key] = 0;
        }
        this._emit('reset');
    }

    /**
     * Get current state snapshot
     */
    getSnapshot() {
        return {
            currentTool: this.currentTool,
            hasImage: this.hasImage,
            brushSettings: { ...this.brushSettings },
            globalAdjustments: { ...this.globalAdjustments }
        };
    }

    /**
     * Subscribe to state changes
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe from state changes
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index > -1) listeners.splice(index, 1);
        }
    }

    /**
     * Emit event to listeners
     */
    _emit(event, data = {}) {
        const listeners = this._listeners.get(event) || [];
        listeners.forEach(callback => callback(data));
    }
}
