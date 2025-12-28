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
            texture: 0
        };

        // Processing framebuffer
        this._processedFBO = null;
    }

    /**
     * Initialize GPU backend
     */
    async init() {
        try {
            this.backend = await createBestBackend(this.canvas);
            console.log(`🎮 GPUProcessor initialized (${this.backend.getName()})`);
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

        console.log(`📷 Image loaded: ${this.width}x${this.height}`);
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
     * Reset all parameters
     */
    reset() {
        for (const key in this.params) {
            this.params[key] = 0;
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
     * Render with current adjustments
     */
    render() {
        if (!this.inputTexture || !this.backend?.isReady) return;
        this.backend.renderDevelop(this.inputTexture, this.params);
    }

    /**
     * Export as ImageData
     */
    toImageData() {
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
