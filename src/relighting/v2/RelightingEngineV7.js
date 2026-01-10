/**
 * RelightingEngineV7.js - High-Quality Relighting Engine
 * 
 * v7 Features:
 * - Multi-scale normal fusion for better surface detail
 * - Depth confidence maps for reliable lighting
 * - Advanced albedo estimation with linear color space
 * - Quality mode toggle (v5 fast vs v7 quality)
 * - Backward compatible with v5 API
 */

import { NeuralEstimatorV7 } from './NeuralEstimatorV7.js';
import { AlbedoEstimatorV7 } from './AlbedoEstimatorV7.js';
import { DeferredLightingShader } from './DeferredLightingShader.js';
import { LightingCompositor } from './LightingCompositor.js';
import { ShadowCaster } from './ShadowCaster.js';
import { SmoothSurfaceGenerator } from './SmoothSurfaceGenerator.js';

// Also import v5 components for fallback/comparison
import { NeuralEstimator } from './NeuralEstimator.js';
import { AlbedoEstimator } from './AlbedoEstimator.js';

export class RelightingEngineV7 {
    constructor() {
        // v7 Components
        this.neuralEstimatorV7 = new NeuralEstimatorV7();
        this.albedoEstimatorV7 = new AlbedoEstimatorV7();

        // v5 Fallback Components  
        this.neuralEstimatorV5 = new NeuralEstimator();
        this.albedoEstimatorV5 = new AlbedoEstimator();

        // Shared Components
        this.lightingShader = new DeferredLightingShader();
        this.compositor = new LightingCompositor();
        this.shadowCaster = new ShadowCaster();
        this.smoothSurfaceGenerator = new SmoothSurfaceGenerator();

        // Cached data
        this.neuralData = null;
        this.albedoData = null;
        this.originalImageData = null;
        this.originalImage = null;
        this.confidenceData = null;
        this.shadowMap = null;           // Shadow map for cast shadows
        this.shadowMapDirty = true;      // Flag to regenerate shadows on light move
        this.smoothSurfaceData = null;   // Bilateral-filtered depth and smooth normals

        // Dimensions
        this.width = 0;
        this.height = 0;

        // Light parameters (DaVinci Resolve-style)
        this.light = {
            position: { x: 0.5, y: 0.5 },
            direction: { x: 0, y: 0, z: 1 },
            color: { r: 1.0, g: 0.98, b: 0.95 },
            intensity: 0.8,
            ambient: 0.15,
            specularity: 0.0,
            glossiness: 32,
            directional: true,
            reach: 200.0,
            contrast: 1.0,
            blendMode: 1, // 0=softLight, 1=normal, 2=additive, 3=screen, 4=multiply
            // Rim lighting
            rimIntensity: 0.0,
            rimColor: { r: 1.0, g: 1.0, b: 1.0 },
            rimWidth: 0.5,
            // Shadow controls
            shadowIntensity: 0.7,
            shadowSoftness: 0.5,
            shadowEnabled: true,
            // Spotlight controls
            isSpotlight: false,
            spotAngle: 30.0,
            spotSoftness: 0.3,
            // Subsurface scattering (new)
            sssIntensity: 0.0,         // 0 = off, 1 = full translucency
            sssColor: { r: 1.0, g: 0.4, b: 0.3 },  // Skin-like warm color
            // Light height (for 3D effect)
            lightHeight: 0.5,  // 0 = low, 1 = high
        };

        // v7: Quality mode
        this.qualityMode = 'v7'; // 'v5' or 'v7'
        this.useAdvancedAlbedo = true;

        // State
        this.isReady = false;
        this.isProcessing = false;
        this.hasGeometry = false;
        this.onProgress = null;

        // Performance tracking
        this.lastProcessingTime = 0;
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
            console.error('❌ RelightingEngineV7: Failed to initialize shader');
            return false;
        }

        // Initialize appropriate neural estimator based on quality mode
        if (this.onProgress) {
            this.onProgress({ stage: 'init', message: 'Loading AI model...' });
        }

        let neuralReady = false;

        if (this.qualityMode === 'v7') {
            neuralReady = await this.neuralEstimatorV7.init((progress) => {
                if (this.onProgress) this.onProgress(progress);
            });
        }

        // Always initialize v5 as fallback
        if (!neuralReady) {
            neuralReady = await this.neuralEstimatorV5.init((progress) => {
                if (this.onProgress) this.onProgress(progress);
            });
            this.qualityMode = 'v5';
        }

        if (!neuralReady) {
            console.error('❌ RelightingEngineV7: Failed to initialize any neural estimator');
            return false;
        }

        this.isReady = true;
        return true;
    }

    /**
     * Set quality mode
     * @param {'v5' | 'v7'} mode
     */
    setQualityMode(mode) {
        if (mode !== 'v5' && mode !== 'v7') {
            console.warn('Invalid quality mode, using v7');
            mode = 'v7';
        }
        this.qualityMode = mode;
    }

    /**
     * Process image for relighting
     * @param {Function} progressCallback - Optional callback for granular progress
     */
    async processImage(image, progressCallback = null) {
        if (this.isProcessing) return false;
        if (!this.isReady) {
            console.warn('Engine not ready, initializing...');
            await this.init(this.onProgress);
        }

        this.isProcessing = true;
        const startTime = performance.now();

        // Use provided callback or fall back to this.onProgress
        const reportProgress = (percent, message) => {
            const callback = progressCallback || this.onProgress;
            if (callback) callback({ progress: percent, message, stage: 'processing' });
        };

        try {
            reportProgress(5, 'Preparing image...');

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

            reportProgress(10, 'Starting AI depth estimation...');


            // Create a sub-progress callback that maps estimator progress (0-100) to our range (10-85)
            const estimationProgressCallback = (progress) => {
                const mappedPercent = 10 + (progress.progress * 0.75); // 10% to 85%
                reportProgress(mappedPercent, progress.message);
            };

            if (this.qualityMode === 'v7') {
                this.neuralData = await this.neuralEstimatorV7.estimate(image, estimationProgressCallback);
                this.confidenceData = this.neuralData.confidence;
            } else {
                this.neuralData = await this.neuralEstimatorV5.estimate(image);
                this.confidenceData = null;
            }

            reportProgress(85, 'Generating smooth 3D surface...');

            // Step 1.5: Generate smooth surface from depth (bilateral filter + smooth normals)
            // This removes texture artifacts while preserving face/body shape for lighting
            this.smoothSurfaceData = this.smoothSurfaceGenerator.generate(
                this.neuralData.depthData || this.neuralData.depth,
                this.width,
                this.height
            );

            reportProgress(88, 'Preparing albedo...');

            // Step 2: Prepare albedo

            if (this.qualityMode === 'v7' && this.useAdvancedAlbedo) {
                // v7: Advanced albedo with linear color space
                this.albedoData = this.albedoEstimatorV7.estimate(
                    this.originalImageData,
                    this.neuralData.normals,
                    {
                        useLinearSpace: true,
                        detectLight: true,
                        sphericalHarmonics: true,
                        preserveColor: 0.65,
                        shadowRecovery: 0.2,
                        confidence: this.confidenceData,
                    }
                );
            } else {
                // v5: Simple albedo
                this.albedoData = this.albedoEstimatorV5.estimateSimple(this.originalImageData, {
                    contrastReduction: 0.1,
                    brightnessBoost: 0.02,
                });
            }

            this.compositor.init(this.width, this.height);
            this.hasGeometry = true;

            this.lastProcessingTime = performance.now() - startTime;

            reportProgress(100, 'Complete!');

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

        // Generate shadow map if enabled (regenerate on light position change)
        let shadowMapData = null;
        if (this.light.shadowEnabled && this.neuralData?.depthData) {
            // Configure shadow caster based on current settings
            this.shadowCaster.setIntensity(this.light.shadowIntensity);
            this.shadowCaster.setSoftness(this.light.shadowSoftness);

            // Generate shadow map from depth data
            const shadowMap = this.shadowCaster.generateShadowMap(
                this.neuralData.depthData,
                this.light,
                this.width,
                this.height
            );

            // Convert to ImageData for shader
            shadowMapData = this.shadowCaster.toImageData(shadowMap, this.width, this.height);
        }

        const lightingCanvas = this.lightingShader.render({
            albedo: this.originalImageData,
            normalMap: this.smoothSurfaceData?.normalImageData || this.neuralData.normalImageData,
            depthMap: this.neuralData.depthImageData,
            shadowMap: shadowMapData,  // Pass shadow map to shader
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
    }

    // === SETTERS (v5 compatible) ===

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

    setBlendMode(mode) {
        // Map string to int or use direct int
        const modeMap = {
            'softLight': 0,
            'normal': 1,
            'additive': 2,
            'screen': 3,
            'multiply': 4,
        };
        if (typeof mode === 'string') {
            this.light.blendMode = modeMap[mode] ?? 0;
        } else {
            this.light.blendMode = Math.max(0, Math.min(4, mode));
        }
    }

    setLightDirection(dx, dy, dz = 0.5) {
        // Normalize direction
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        this.light.direction = {
            x: dx / len,
            y: dy / len,
            z: Math.max(0.3, dz / len),
        };
    }

    // v7: Advanced albedo toggle
    setAdvancedAlbedo(enabled) {
        this.useAdvancedAlbedo = enabled;
    }

    // === RIM LIGHTING SETTERS ===

    setRimIntensity(intensity) {
        this.light.rimIntensity = Math.max(0, Math.min(2, intensity));
    }

    setRimColor(r, g, b) {
        this.light.rimColor = { r, g, b };
    }

    setRimWidth(width) {
        this.light.rimWidth = Math.max(0, Math.min(1, width));
    }

    // === SHADOW SETTERS ===

    setShadowEnabled(enabled) {
        this.light.shadowEnabled = enabled;
    }

    setShadowIntensity(intensity) {
        this.light.shadowIntensity = Math.max(0, Math.min(1, intensity));
    }

    setShadowSoftness(softness) {
        this.light.shadowSoftness = Math.max(0, Math.min(1, softness));
    }

    // === SPOTLIGHT SETTERS ===

    setSpotlightEnabled(enabled) {
        this.light.isSpotlight = enabled;
    }

    setSpotAngle(angle) {
        // Clamp between 5 and 90 degrees
        this.light.spotAngle = Math.max(5, Math.min(90, angle));
    }

    setSpotSoftness(softness) {
        this.light.spotSoftness = Math.max(0, Math.min(1, softness));
    }

    // === SSS SETTERS ===

    setSSSIntensity(intensity) {
        this.light.sssIntensity = Math.max(0, Math.min(1, intensity));
    }

    setSSSColor(r, g, b) {
        this.light.sssColor = { r, g, b };
    }

    setLightHeight(height) {
        this.light.lightHeight = Math.max(0, Math.min(1, height));
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

    getDebugConfidence() {
        if (!this.neuralData?.confidenceImageData) return null;

        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(this.neuralData.confidenceImageData, 0, 0);
        return canvas;
    }

    getDebugLightingMap() {
        if (!this.isReady || !this.hasGeometry) return null;
        return this.render();
    }

    getProcessingTime() {
        return this.lastProcessingTime;
    }

    getQualityMode() {
        return this.qualityMode;
    }

    // === CLEANUP ===

    dispose() {
        this.lightingShader.dispose();
        this.neuralEstimatorV7.dispose();
        this.neuralEstimatorV5.dispose();
        this.compositor.dispose();

        this.neuralData = null;
        this.albedoData = null;
        this.originalImage = null;
        this.originalImageData = null;
        this.confidenceData = null;
        this.isReady = false;
        this.hasGeometry = false;
    }
}

export default RelightingEngineV7;
