/**
 * GPUProcessor - GPU Image Processing Pipeline
 * 
 * Uses WebGPU when available, falls back to WebGL2.
 * Provides unified API regardless of backend.
 */

import { createBestBackend } from './GPUBackend.js';

export class GPUProcessor {
    constructor(canvas) {
        this.canvas = canvas;
        this.backend = null;

        // Textures
        this.inputTexture = null;

        // Current image dimensions
        this.width = 0;
        this.height = 0;

        // Adjustment parameters
        this.params = {
            exposure: 0,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            temperature: 0,
            tint: 0,
            vibrance: 0,
            saturation: 0,
            clarity: 0,
            structure: 0,
            dehaze: 0,

            // HSL Per-Channel Adjustments (8 colors × 3 channels = 24 params)
            // Hue shifts (-100 to +100 = -180° to +180°)
            hslHueRed: 0,
            hslHueOrange: 0,
            hslHueYellow: 0,
            hslHueGreen: 0,
            hslHueAqua: 0,
            hslHueBlue: 0,
            hslHuePurple: 0,
            hslHueMagenta: 0,

            // Saturation adjustments (-100 to +100)
            hslSatRed: 0,
            hslSatOrange: 0,
            hslSatYellow: 0,
            hslSatGreen: 0,
            hslSatAqua: 0,
            hslSatBlue: 0,
            hslSatPurple: 0,
            hslSatMagenta: 0,

            // Luminance adjustments (-100 to +100)
            hslLumRed: 0,
            hslLumOrange: 0,
            hslLumYellow: 0,
            hslLumGreen: 0,
            hslLumAqua: 0,
            hslLumBlue: 0,
            hslLumPurple: 0,
            hslLumMagenta: 0,

            // Color Grading (3-Way)
            // Hues: 0-1 (0-360), Sat: 0-1 (0-100)
            shadowsHue: 0,
            shadowsSat: 0,
            midtonesHue: 0,
            midtonesSat: 0,
            highlightsHue: 0,
            highlightsSat: 0,

            // Luminance: -100 to +100
            shadowsLum: 0,
            midtonesLum: 0,
            highlightsLum: 0,

            // Global
            colorBalance: 0,   // -100 to +100
            colorBlending: 50, // 0 to 100 (Default 50)

            // Tone Curve LUTs (256 entries each, null = identity)
            curveLutRgb: null,
            curveLutRed: null,
            curveLutGreen: null,
            curveLutBlue: null,

            // 3D LUT Color Grading
            lut3d: null,
            lut3dIntensity: 100
        };

        // Processing framebuffer
        this._processedFBO = null;

        // Mask system reference
        this.maskSystem = null;

        // Exposure clipping warnings (Lightroom style J shortcut)
        this.clippingWarnings = false;
        this.clipShadows = true;
        this.clipHighlights = true;
    }

    /**
     * Toggle exposure clipping warnings (J key)
     */
    toggleClippingWarnings(type = 'both') {
        if (type === 'shadows') {
            this.clipShadows = !this.clipShadows;
            if (!this.clipShadows && !this.clipHighlights) {
                this.clippingWarnings = false;
            } else {
                this.clippingWarnings = true;
            }
        } else if (type === 'highlights') {
            this.clipHighlights = !this.clipHighlights;
            if (!this.clipShadows && !this.clipHighlights) {
                this.clippingWarnings = false;
            } else {
                this.clippingWarnings = true;
            }
        } else {
            this.clippingWarnings = !this.clippingWarnings;
            if (this.clippingWarnings) {
                this.clipShadows = true;
                this.clipHighlights = true;
            }
        }
        this.render();
        return {
            active: this.clippingWarnings,
            shadows: this.clipShadows,
            highlights: this.clipHighlights
        };
    }

    /**
     * Attach mask system for compositing during renders
     */
    setMaskSystem(maskSystem) {
        this.maskSystem = maskSystem;
    }

    /**
     * Initialize GPU backend
     */
    async init() {
        try {
            this.backend = await createBestBackend(this.canvas);
            return true;
        } catch (e) {
            console.error('GPUProcessor initialization failed:', e);
            return false;
        }
    }

    /**
     * Get the GL context (for backward compatibility with MaskSystem)
     * Returns the WebGL2 context if using WebGL2 backend
     */
    get gl() {
        if (this.backend?.getName() === 'WebGL2') {
            return this.backend.gl;
        }
        return null;
    }

    /**
     * Get position buffer (for MaskSystem backward compatibility)
     */
    get positionBuffer() {
        return this.backend?.positionBuffer || null;
    }

    /**
     * Get FBO texture coordinate buffer (for MaskSystem backward compatibility)
     */
    get texCoordBufferFBO() {
        return this.backend?.texCoordBufferFBO || null;
    }

    /**
     * Load image into GPU texture using Safe Handoff pattern
     * 
     * Uses "Create, Swap, then Destroy" to ensure inputTexture always
     * points to a valid GPU resource. This prevents "destroyed texture"
     * errors from stale render commands.
     */
    loadImage(imageElement) {
        if (!this.backend?.isReady) {
            console.warn('GPUProcessor not initialized');
            return;
        }

        this.width = imageElement.naturalWidth || imageElement.width;
        this.height = imageElement.naturalHeight || imageElement.height;

        // Set canvas and backend size
        this.backend.setSize(this.width, this.height);

        // === SAFE HANDOFF PATTERN ===

        // Step 1: Create NEW texture first (don't touch inputTexture yet)
        const newTexture = this.backend.createTextureFromSource(imageElement);

        // Step 2: Store reference to OLD texture
        const oldTexture = this.inputTexture;
        const oldFBO = this._processedFBO;

        // Step 3: ATOMIC SWAP - inputTexture now points to valid new texture
        this.inputTexture = newTexture;
        this._processedFBO = null; // Will be recreated on demand

        // Step 4: Render with new texture (synchronous, no requestAnimationFrame)
        this.render();

        // Step 5: NOW it's safe to delete old resources
        if (oldTexture) {
            this.backend.deleteTexture(oldTexture);
        }
        if (oldFBO) {
            this.backend.deleteFramebuffer?.(oldFBO);
        }

    }

    /**
     * Update adjustment parameter
     */
    setParam(name, value) {
        if (name in this.params) {
            this.params[name] = value;
            this.render();
        }
    }

    /**
     * Get current parameter value
     */
    getParam(name) {
        return this.params[name] ?? 0;
    }

    /**
     * Set or clear 3D LUT
     * @param {Object|null} lutInfo - { size, data, title }
     * @param {number|null} intensity - 0 to 100
     */
    setLut3d(lutInfo, intensity = null) {
        this.params.lut3d = lutInfo;
        if (intensity !== null && !isNaN(intensity)) {
            this.params.lut3dIntensity = intensity;
        }
        this.render();
    }

    /**
     * Reset all parameters
     */
    reset() {
        for (const key in this.params) {
            // Curve LUT and 3D LUT params must be null (identity), not 0
            if (key.startsWith('curveLut') || key === 'lut3d') {
                this.params[key] = null;
            } else if (key === 'colorBlending') {
                this.params[key] = 50;
            } else if (key === 'lut3dIntensity') {
                this.params[key] = 100;
            } else {
                this.params[key] = 0;
            }
        }
        this.render();
    }

    /**
     * Render original image (for before/after)
     */
    renderOriginal() {
        if (!this.inputTexture || !this.backend?.isReady) return;
        this.backend.renderPassthrough(this.inputTexture);
    }

    /**
     * Render with current adjustments to internal texture (for mask compositing)
     */
    renderToTexture() {
        if (!this.inputTexture || !this.backend?.isReady) return null;

        // Ensure processing FBO exists
        if (!this._processedFBO ||
            this._processedFBO.texture.width !== this.width ||
            this._processedFBO.texture.height !== this.height) {
            if (this._processedFBO) {
                this.backend.deleteFramebuffer?.(this._processedFBO);
            }
            this._processedFBO = this.backend.createFramebuffer(this.width, this.height);
        }

        // Render to texture
        this.backend.renderDevelop(this.inputTexture, this.params, this._processedFBO);

        return this._processedFBO.texture;
    }

    /**
     * Blit texture to canvas
     */
    blitToCanvas(texture) {
        if (!texture || !this.backend?.isReady) return;
        this.backend.renderPassthrough(texture, null, true);
    }

    /**
     * Render with current adjustments and composite any active masks
     * @param {Object|null} targetFBO - Optional target framebuffer
     * @param {boolean} showOverlay - Whether to force mask overlay visualization
     */
    render(targetFBO = null, showOverlay = false) {
        if (!this.inputTexture || !this.backend?.isReady) return;

        const wantsOverlay = showOverlay || (this.maskSystem?.shouldShowOverlay ? this.maskSystem.shouldShowOverlay() : this.maskSystem?.showOverlay);
        const hasMasks = this.maskSystem && typeof this.maskSystem.hasActiveMasks === 'function' && this.maskSystem.hasActiveMasks();

        const clippingOpts = (!targetFBO && this.clippingWarnings) ? {
            show: true,
            shadows: Boolean(this.clipShadows),
            highlights: Boolean(this.clipHighlights)
        } : null;

        if (hasMasks || (wantsOverlay && this.maskSystem?.getActiveLayer?.())) {
            const baseTexture = this.renderToTexture();
            if (baseTexture) {
                const compositedTexture = hasMasks
                    ? this.maskSystem.applyMaskedAdjustments(baseTexture)
                    : baseTexture;

                if (targetFBO) {
                    this.backend.renderPassthrough(compositedTexture, targetFBO, true);
                } else {
                    this.backend.renderPassthrough(compositedTexture, null, true, clippingOpts);
                }

                if (wantsOverlay && typeof this.maskSystem?.renderMaskOverlay === 'function') {
                    this.maskSystem.renderMaskOverlay();
                }
                return;
            }
        }

        this.backend.renderDevelop(this.inputTexture, this.params, targetFBO, clippingOpts);
    }

    /**
     * Export as ImageData
     */
    toImageData() {
        if (this.maskSystem && typeof this.maskSystem.hasActiveMasks === 'function' && this.maskSystem.hasActiveMasks()) {
            this.render();
        }
        return this.backend?.toImageData?.() || null;
    }

    /**
     * Export as Blob
     */
    toBlob(type = 'image/jpeg', quality = 0.92) {
        return new Promise(resolve => {
            this.canvas.toBlob(resolve, type, quality);
        });
    }

    /**
     * Cleanup
     */
    dispose() {
        if (this.inputTexture) {
            this.backend?.deleteTexture(this.inputTexture);
        }
        if (this._processedFBO) {
            this.backend?.deleteFramebuffer?.(this._processedFBO);
        }
        this.backend?.dispose();
    }
}
