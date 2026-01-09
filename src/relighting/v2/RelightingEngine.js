/**
 * RelightingEngine.js - v5 with DaVinci Resolve-Quality Lighting
 * 
 * Uses Transformers.js with Depth Anything V2 for high-quality
 * depth/normal estimation, plus DaVinci-style lighting model.
 */

import { NeuralEstimator } from './NeuralEstimator.js';
import { AlbedoEstimator } from './AlbedoEstimator.js';
import { DeferredLightingShader } from './DeferredLightingShader.js';
import { LightingCompositor } from './LightingCompositor.js';

export class RelightingEngine {
    constructor() {
        // Components
        this.neuralEstimator = new NeuralEstimator();
        this.albedoEstimator = new AlbedoEstimator();
        this.lightingShader = new DeferredLightingShader();
        this.compositor = new LightingCompositor();

        // Cached data
        this.neuralData = null;
        this.albedoData = null;
        this.originalImageData = null;
        this.originalImage = null;

        // Dimensions
        this.width = 0;
        this.height = 0;

        // Light parameters (DaVinci Resolve-style)
        this.light = {
            position: { x: 0.5, y: 0.3 },
            direction: { x: 0, y: 0, z: 1 },
            color: { r: 1.0, g: 0.98, b: 0.95 },
            intensity: 1.0,
            ambient: 0.35,
            specularity: 0.0,
            glossiness: 32,
            directional: true,
            // NEW: DaVinci-style parameters
            reach: 200.0,      // Controls falloff distance
            contrast: 1.0,     // Terminator sharpness (gamma)
        };

        // State
        this.isReady = false;
        this.isProcessing = false;
        this.hasGeometry = false;
        this.onProgress = null;
    }

    /**
     * Initialize the engine
     * @param {Function} progressCallback - Called during model loading
     */
    async init(progressCallback = null) {
        this.onProgress = progressCallback;

        // Initialize shader
        const shaderReady = await this.lightingShader.init();
        if (!shaderReady) {
            console.error('❌ RelightingEngine: Failed to initialize shader');
            return false;
        }

        // Initialize neural estimator (downloads model)
        if (this.onProgress) {
            this.onProgress({ stage: 'init', message: 'Loading AI model...' });
        }

        const neuralReady = await this.neuralEstimator.init((progress) => {
            if (this.onProgress) {
                this.onProgress(progress);
            }
        });

        if (!neuralReady) {
            console.error('❌ RelightingEngine: Failed to initialize neural estimator');
            return false;
        }

        this.isReady = true;
        console.log('✨ RelightingEngine v4 initialized (Neural Network)');
        return true;
    }

    /**
     * Process image for relighting
     */
    async processImage(image) {
        if (this.isProcessing) return false;
        if (!this.isReady) {
            console.warn('Engine not ready, initializing...');
            await this.init(this.onProgress);
        }

        this.isProcessing = true;

        try {
            console.log('🔄 Processing image with Neural Network...');

            this.width = image.width || image.naturalWidth;
            this.height = image.height || image.naturalHeight;
            this.originalImage = image;

            // Get original ImageData
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.width;
            tempCanvas.height = this.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(image, 0, 0);
            this.originalImageData = tempCtx.getImageData(0, 0, this.width, this.height);

            // Step 1: Neural depth & normal estimation
            if (this.onProgress) {
                this.onProgress({ stage: 'processing', message: 'Running AI depth estimation...' });
            }

            console.log('  📐 Step 1/2: Neural depth & normal estimation...');
            this.neuralData = await this.neuralEstimator.estimate(image);

            // Step 2: Prepare albedo
            console.log('  📐 Step 2/2: Preparing albedo...');
            this.albedoData = this.albedoEstimator.estimateSimple(this.originalImageData, {
                contrastReduction: 0.1,
                brightnessBoost: 0.02,
            });

            this.compositor.init(this.width, this.height);
            this.hasGeometry = true;

            if (this.onProgress) {
                this.onProgress({ stage: 'complete', message: 'Ready' });
            }

            console.log('✅ Neural processing complete');
            return true;
        } catch (error) {
            console.error('❌ Image processing failed:', error);
            return false;
        } finally {
            this.isProcessing = false;
        }
    }

    render() {
        if (!this.isReady || !this.hasGeometry) return null;

        this._updateLightDirection();

        const lightingCanvas = this.lightingShader.render({
            albedo: this.originalImageData,
            normalMap: this.neuralData.normalImageData,
            depthMap: this.neuralData.depthImageData,
            light: this.light,
            width: this.width,
            height: this.height,
        });

        const result = this.lightingShader.getImageData();

        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(result, 0, 0);

        return canvas;
    }

    /**
     * Compute light direction from 2D position
     */
    _updateLightDirection() {
        const px = (this.light.position.x - 0.5) * 2;
        const py = (this.light.position.y - 0.5) * 2;

        const dirX = px;
        const dirY = -py;

        const xyLen = Math.sqrt(px * px + py * py);
        const dirZ = Math.max(0.4, 1.0 - xyLen * 0.5);

        const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

        this.light.direction = {
            x: dirX / len,
            y: dirY / len,
            z: dirZ / len,
        };

        console.log(`💡 Light pos: (${this.light.position.x.toFixed(2)}, ${this.light.position.y.toFixed(2)}) → dir: (${this.light.direction.x.toFixed(2)}, ${this.light.direction.y.toFixed(2)}, ${this.light.direction.z.toFixed(2)})`);
    }

    // === SETTERS ===

    setLightPosition(x, y) {
        this.light.position.x = Math.max(0, Math.min(1, x));
        this.light.position.y = Math.max(0, Math.min(1, y));
    }

    setLightColor(r, g, b) {
        this.light.color = { r, g, b };
    }

    setLightIntensity(intensity) {
        this.light.intensity = Math.max(0, Math.min(2, intensity));
    }

    setAmbient(ambient) {
        this.light.ambient = Math.max(0, Math.min(1, ambient));
    }

    setSpecularity(specularity) {
        this.light.specularity = Math.max(0, Math.min(1, specularity));
    }

    setGlossiness(glossiness) {
        this.light.glossiness = Math.max(1, Math.min(256, glossiness));
    }

    setDirectional(isDirectional) {
        this.light.directional = isDirectional;
    }

    setReach(reach) {
        this.light.reach = Math.max(10, Math.min(500, reach));
    }

    setContrast(contrast) {
        this.light.contrast = Math.max(0.1, Math.min(3.0, contrast));
    }

    setSurfaceSoftness(softness) {
        // Legacy - no longer used
    }

    // === DEBUG ===

    getDebugNormalMap() {
        if (!this.neuralData) return null;

        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(this.neuralData.normalImageData, 0, 0);
        return canvas;
    }

    getDebugHeightMap() {
        if (!this.neuralData) return null;

        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(this.neuralData.depthImageData, 0, 0);
        return canvas;
    }

    getDebugAlbedo() {
        if (!this.albedoData) return null;

        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(this.albedoData, 0, 0);
        return canvas;
    }

    getDebugLightingMap() {
        if (!this.isReady || !this.hasGeometry) return null;
        return this.render();
    }

    // === CLEANUP ===

    dispose() {
        this.lightingShader.dispose();
        this.neuralEstimator.dispose();
        this.compositor.dispose();

        this.neuralData = null;
        this.albedoData = null;
        this.originalImage = null;
        this.originalImageData = null;
        this.isReady = false;
        this.hasGeometry = false;
    }
}

export default RelightingEngine;
