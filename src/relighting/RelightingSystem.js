/**
 * RelightingSystem.js - Production-ready 3D Relighting System
 * 
 * Architecture:
 * - Stage 1: AI Analysis (Depth → Normals) - runs once, cached
 * - Stage 2: Real-time Shading (60 FPS) - GPU shader with cached normals
 * 
 * Supports: Portraits, Landscapes, Product Images
 */

import { NormalEstimator } from './NormalEstimator.js';
import { LightingShader } from './LightingShader.js';

export class RelightingSystem {
    constructor() {
        // Core components
        this.normalEstimator = new NormalEstimator();
        this.lightingShader = null;

        // Cached textures
        this.normalMap = null;      // RGB = XYZ normal direction
        this.depthMap = null;       // Grayscale depth
        this.albedoMap = null;      // Original image (for now)

        // Own WebGL context (offscreen)
        this.glCanvas = null;
        this.gl = null;

        // Light parameters
        this.light = {
            position: { x: 0.5, y: 0.3 },  // Normalized 0-1
            color: { r: 1.0, g: 0.95, b: 0.9 },  // Warm white
            intensity: 1.0,
            type: 'directional',  // 'directional', 'point', 'spot'
            reach: 300,           // Point/Spot falloff distance in pixels
            ambient: 0.3,         // Ambient fill light
            specularity: 0.0,     // Specular highlight intensity
            glossiness: 32,       // Specular size (1-256)
        };

        // Surface parameters (for hiding AI artifacts)
        this.surface = {
            softness: 0,          // Normal map blur (0-100)
        };

        // Compositing
        this.composite = {
            mode: 'softLight',    // 'softLight', 'additive', 'screen', 'multiply'
            intensity: 1.0,       // Overall effect strength
        };

        // State
        this.isReady = false;
        this.isProcessing = false;
        this.hasDepth = false;

        // Dimensions
        this.width = 0;
        this.height = 0;
    }

    /**
     * Initialize the shader program with offscreen WebGL2 context
     */
    async init() {
        // Create offscreen canvas for WebGL
        this.glCanvas = document.createElement('canvas');
        this.glCanvas.width = 1024;  // Will resize on use
        this.glCanvas.height = 1024;

        this.gl = this.glCanvas.getContext('webgl2', {
            antialias: false,
            alpha: true,
            premultipliedAlpha: false,
        });

        if (!this.gl) {
            console.error('RelightingSystem: WebGL2 not supported');
            return false;
        }

        this.lightingShader = new LightingShader(this.gl);
        await this.lightingShader.init();

        this.isReady = true;
        return true;
    }

    /**
     * Process image: estimate depth and compute normals
     * This is Stage 1 - runs once per image
     */
    async processImage(depthEstimator, image) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            this.width = image.width || image.naturalWidth;
            this.height = image.height || image.naturalHeight;


            // Step 1: Estimate depth using AI
            const depthResult = await depthEstimator.estimate(image);
            this.depthMap = depthResult;
            this.hasDepth = true;

            // Step 2: Compute normals from depth
            this.normalMap = this.normalEstimator.computeFromDepth(
                depthResult,
                this.width,
                this.height,
                this.surface.softness
            );

            // Step 3: Store albedo (original image for now)
            this.albedoMap = image;

            // Step 4: Upload textures to GPU
            this._uploadTextures();

            return true;
        } catch (error) {
            console.error('❌ Relighting processing failed:', error);
            return false;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Upload normal and depth textures to GPU
     */
    _uploadTextures() {
        if (!this.gl || !this.lightingShader) return;

        // Upload normal map
        if (this.normalMap) {
            this.lightingShader.uploadNormalMap(this.normalMap);
        }

        // Upload depth map
        if (this.depthMap) {
            this.lightingShader.uploadDepthMap(this.depthMap);
        }
    }

    /**
     * Update surface softness and recompute normals
     */
    setSurfaceSoftness(softness) {
        this.surface.softness = softness;

        // Recompute normals with new softness
        if (this.depthMap && this.width && this.height) {
            this.normalMap = this.normalEstimator.computeFromDepth(
                this.depthMap,
                this.width,
                this.height,
                softness
            );
            this._uploadTextures();
        }
    }

    /**
     * Set light position (normalized 0-1)
     */
    setLightPosition(x, y) {
        this.light.position.x = Math.max(0, Math.min(1, x));
        this.light.position.y = Math.max(0, Math.min(1, y));
    }

    /**
     * Set light color (RGB 0-1)
     */
    setLightColor(r, g, b) {
        this.light.color.r = r;
        this.light.color.g = g;
        this.light.color.b = b;
    }

    /**
     * Set light intensity (0-2)
     */
    setLightIntensity(intensity) {
        this.light.intensity = Math.max(0, Math.min(2, intensity));
    }

    /**
     * Set ambient level (0-1)
     */
    setAmbient(ambient) {
        this.light.ambient = Math.max(0, Math.min(1, ambient));
    }

    /**
     * Set specularity (0-1)
     */
    setSpecularity(specularity) {
        this.light.specularity = Math.max(0, Math.min(1, specularity));
    }

    /**
     * Set glossiness (1-256)
     */
    setGlossiness(glossiness) {
        this.light.glossiness = Math.max(1, Math.min(256, glossiness));
    }

    /**
     * Set blend mode
     */
    setBlendMode(mode) {
        if (['softLight', 'additive', 'screen', 'multiply', 'normal'].includes(mode)) {
            this.composite.mode = mode;
        }
    }

    /**
     * Set composite intensity
     */
    setCompositeIntensity(intensity) {
        this.composite.intensity = Math.max(0, Math.min(1, intensity));
    }

    /**
     * Render the relighting effect
     * This is Stage 2 - runs at 60 FPS
     * 
     * @param {HTMLCanvasElement|ImageData} originalImage - The original image
     * @param {CanvasRenderingContext2D} outputCtx - Output canvas context
     */
    render(originalImage, outputCtx) {
        if (!this.isReady || !this.hasDepth || !this.lightingShader) {
            return;
        }

        // Compute light direction from position
        // Position (0.5, 0.5) = light from front
        // Position (0, 0.5) = light from left
        // Position (1, 0.5) = light from right
        const lightDir = this._computeLightDirection();

        // Render with shader
        const result = this.lightingShader.render({
            albedo: originalImage,
            light: {
                direction: lightDir,
                color: this.light.color,
                intensity: this.light.intensity,
                ambient: this.light.ambient,
                specularity: this.light.specularity,
                glossiness: this.light.glossiness,
            },
            composite: this.composite,
            width: this.width,
            height: this.height,
        });

        // Draw result to output
        if (result && outputCtx) {
            outputCtx.drawImage(result, 0, 0);
        }

        return result;
    }

    /**
     * Compute 3D light direction from 2D position
     */
    _computeLightDirection() {
        // Map 2D position to 3D direction
        // x: 0 = left, 0.5 = center, 1 = right
        // y: 0 = top, 0.5 = center, 1 = bottom

        const x = (this.light.position.x - 0.5) * 2;  // -1 to 1
        const y = (this.light.position.y - 0.5) * 2;  // -1 to 1

        // Z component: light comes from in front when position is at center
        // Compute Z so the vector is normalized
        const xyLen = Math.sqrt(x * x + y * y);
        const z = Math.max(0.1, 1 - xyLen);  // Minimum z to avoid back-lighting

        // Normalize
        const len = Math.sqrt(x * x + y * y + z * z);

        return {
            x: x / len,
            y: -y / len,  // Flip Y for screen coordinates
            z: z / len
        };
    }

    /**
     * Get current light direction for UI display
     */
    getLightDirection() {
        return this._computeLightDirection();
    }

    /**
     * Export the relit image by baking the effect
     */
    async exportImage(originalImage) {
        if (!this.isReady || !this.hasDepth) {
            return originalImage;
        }

        // Create offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');

        // Render final result
        this.render(originalImage, ctx);

        return canvas;
    }

    /**
     * Cleanup resources
     */
    dispose() {
        if (this.lightingShader) {
            this.lightingShader.dispose();
            this.lightingShader = null;
        }

        this.normalMap = null;
        this.depthMap = null;
        this.albedoMap = null;
        this.isReady = false;
        this.hasDepth = false;
    }
}

export default RelightingSystem;
