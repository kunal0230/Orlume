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
        this.initialImage = null;       // Untouched photo as loaded from file
        this.preUpscaleImage = null;   // Photo immediately before AI super-resolution/enhancement
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
            saturation: 0,

            // Color Grading
            shadowsHue: 0,
            shadowsSat: 0,
            midtonesHue: 0,
            midtonesSat: 0,
            highlightsHue: 0,
            highlightsSat: 0,
            shadowsLum: 0,
            midtonesLum: 0,
            highlightsLum: 0,
            colorBalance: 0,
            colorBlending: 50,

            // HSL (8 channels x Hue, Sat, Lum)
            hslHueRed: 0, hslSatRed: 0, hslLumRed: 0,
            hslHueOrange: 0, hslSatOrange: 0, hslLumOrange: 0,
            hslHueYellow: 0, hslSatYellow: 0, hslLumYellow: 0,
            hslHueGreen: 0, hslSatGreen: 0, hslLumGreen: 0,
            hslHueAqua: 0, hslSatAqua: 0, hslLumAqua: 0,
            hslHueBlue: 0, hslSatBlue: 0, hslLumBlue: 0,
            hslHuePurple: 0, hslSatPurple: 0, hslLumPurple: 0,
            hslHueMagenta: 0, hslSatMagenta: 0, hslLumMagenta: 0,

            // 3D LUT Color Grading
            lutPreset: 'none',
            lutIntensity: 100
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
     * @param {HTMLImageElement|HTMLCanvasElement} image
     * @param {boolean} isNewFile - Whether this is a freshly loaded file from disk/URL
     */
    setImage(image, isNewFile = false) {
        const dimensionsChanged = this.initialImage && (image.width !== this.initialImage.width || image.height !== this.initialImage.height);
        if (isNewFile || !this.initialImage || (dimensionsChanged && !this.preUpscaleImage)) {
            this.initialImage = image;
            this.preUpscaleImage = null;
        }
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
            if (key === 'colorBlending') {
                this.globalAdjustments[key] = 50;
            } else if (key === 'lutPreset') {
                this.globalAdjustments[key] = 'none';
            } else if (key === 'lutIntensity') {
                this.globalAdjustments[key] = 100;
            } else {
                this.globalAdjustments[key] = 0;
            }
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
