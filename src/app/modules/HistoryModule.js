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

        // Image change tracking
        this.lastCapturedImage = null;

        // Image Registry - stores robust image copies by ID
        // This ensures we can always restore the exact image version needed
        this.imageRegistry = new Map();
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
            adjustments: { ...layer.adjustments },
            strokes: layer.strokes ? [...layer.strokes] : [] // Capture brush strokes
        }));

        // Capture current image state
        // We use the imageId to track uniqueness
        const imageId = this.state.imageId;
        let imageDataUrl = null;

        // If we have an image ID, ensure it's in the registry
        if (imageId && this.state.originalImage) {
            if (!this.imageRegistry.has(imageId)) {
                // Determine if we need to serialize (first time seeing this version)
                console.log(`📸 Registering new image version: ${imageId}`);

                // Create data URL
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = this.state.originalImage.width;
                tempCanvas.height = this.state.originalImage.height;
                const ctx = tempCanvas.getContext('2d');
                ctx.drawImage(this.state.originalImage, 0, 0);
                imageDataUrl = tempCanvas.toDataURL('image/png');

                // Save to registry
                this.imageRegistry.set(imageId, imageDataUrl);
            }
        }
        // Fallback: If no ID (legacy?) or we just want to ensure we have a URL for the record
        // but for now the registry handles the "data" part.
        // We leave imageDataUrl as null unless we just generated it.
        // If we didn't generate it, but we need it for the snapshot (legacy support),
        // we could pull it from registry:
        if (!imageDataUrl && imageId && this.imageRegistry.has(imageId)) {
            imageDataUrl = this.imageRegistry.get(imageId);
        }

        // Capture standard state
        const state = {
            currentTool: this.state.currentTool, // Capture active tool
            globalAdjustments,
            maskLayerAdjustments,
            activeLayerIndex: this.masks.activeLayerIndex,
            imageId: imageId, // Track by ID instead of raw data URL check by logic
            // We still store dataUrl in snapshot for potential serialization/export, 
            // but runtime mostly uses registry
            imageDataUrl: imageDataUrl,
            imageWidth: this.state.originalImage?.width || 0,
            imageHeight: this.state.originalImage?.height || 0,
            modules: {}
        };

        // Dynamic Module State Capture
        // Iterates through all properties of editor ending in 'Module'
        // checks for getState() method and saves it
        for (const key of Object.keys(this.editor)) {
            if (key.endsWith('Module') && this.editor[key] && typeof this.editor[key].getState === 'function') {
                const moduleName = key.replace('Module', '');
                const moduleState = this.editor[key].getState();
                if (moduleState !== null && moduleState !== undefined) {
                    state.modules[moduleName] = moduleState;
                }
            }
        }

        return state;
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
        console.log('🔄 Restoring State...', snapshot);

        if (!snapshot) {
            console.warn('⚠️ Unknown state snapshot');
            return;
        }

        try {
            // Check if we need to restore a different image
            // Logic: If snapshot has an imageId and it differs from current state, we MUST restore.
            const targetImageId = snapshot.imageId;
            const currentImageId = this.state.imageId;

            const needsImageRestore = (targetImageId && targetImageId !== currentImageId);

            const executeRestore = () => {
                // Restore tool mode first to Ensure UI is in sync
                if (snapshot.currentTool && snapshot.currentTool !== this.state.currentTool) {
                    console.log(`🔄 Switching tool to ${snapshot.currentTool}`);
                    this.editor.setMode(snapshot.currentTool);
                }

                // Restore active layer
                if (snapshot.activeLayerIndex !== undefined) {
                    this.masks.activeLayerIndex = snapshot.activeLayerIndex;
                    this.editor.updateLayersList();
                }

                // Restore adjustments
                this.restoreAdjustments(snapshot);

                // Re-render
                this.editor.renderWithMask(false);
                requestAnimationFrame(() => this.editor.renderHistogram());

                console.log('✅ State Restored Successfully');
            };

            if (needsImageRestore) {
                console.log('🖼️ Restoring Source Image from Registry...');

                let restoreUrl = snapshot.imageDataUrl;

                // Try registry first for robustness
                if (targetImageId && this.imageRegistry.has(targetImageId)) {
                    restoreUrl = this.imageRegistry.get(targetImageId);
                }

                if (restoreUrl) {
                    const img = new Image();
                    img.onload = () => {
                        // Update state
                        this.state.setImage(img);

                        // Force ID to match snapshot so history stays consistent
                        if (targetImageId) {
                            this.state.imageId = targetImageId;
                        }

                        this.lastCapturedImage = img;

                        // Reload GPU processor with restored image
                        this.editor.gpu.loadImage(img);
                        this.editor.resetAdjustments(); // Reset to fresh state before applying params

                        // Clear masks (they don't align with restored image)
                        this.masks.layers = [];
                        this.masks.activeLayerIndex = -1;
                        this.editor.updateLayersList();

                        // Update UI
                        if (this.elements.perfIndicator) {
                            this.elements.perfIndicator.textContent = `${img.width}×${img.height}`;
                        }

                        executeRestore();
                    };
                    img.onerror = (e) => {
                        console.error('❌ Failed to restore image from snapshot', e);
                        // Try to restore adjustments anyway
                        executeRestore();
                    };
                    img.src = restoreUrl;
                    return;
                }
            }

            // No image change, just restore adjustments
            executeRestore();

        } catch (e) {
            console.error('🔥 CRITICAL ERROR during restoreState:', e);
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

                    // Restore strokes
                    if (savedLayer.strokes) {
                        layer.strokes = [...savedLayer.strokes];
                        // Replay strokes on GPU
                        this.masks.replayLayer(layer.id);
                    }
                }
            }
        }

        // Dynamic Module State Restoration
        if (snapshot.modules) {
            for (const [moduleName, moduleState] of Object.entries(snapshot.modules)) {
                // Reconstruct module key: 'Relighting' -> 'relightingModule'
                // But editor usually has them as 'relightingModule' or 'camelCaseModule'
                // The capture captured 'GodRays' -> 'modules.GodRays'
                // We need to find `editor.godRaysModule` or similar.
                // Assuming standard naming convention from EditorUI imports:
                // import { GodRaysModule } ... editor.godRaysModule
                // But wait, key in modules is 'GodRays'.
                // So property is likely `godRaysModule`.
                const camelCaseName = moduleName.charAt(0).toLowerCase() + moduleName.slice(1);
                // Try likely candidates
                const targetModule = this.editor[`${camelCaseName}Module`] || this.editor[camelCaseName];

                if (targetModule) {
                    if (typeof targetModule.setState === 'function') {
                        try {
                            console.log(`invoking ${moduleName}.setState()`);
                            targetModule.setState(moduleState);
                        } catch (err) {
                            console.error(`❌ Module '${moduleName}' crashed during restore:`, err);
                        }
                    }
                } else {
                    // console.warn(`⚠️ Module '${moduleName}' found in history but not loaded in editor.`);
                }
            }
        }

        // Handle Legacy Tone Curves
        if (snapshot.toneCurves && this.editor.toneCurveModule) {
            try {
                this.editor.toneCurveModule.setCurves(snapshot.toneCurves);
            } catch (err) {
                console.error('Failed to restore legacy tone curves:', err);
            }
        }
    }
}
