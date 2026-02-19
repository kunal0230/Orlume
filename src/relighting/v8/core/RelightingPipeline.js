/**
 * RelightingPipeline.js - v8 Relighting System
 * 
 * Main orchestrator for the relighting pipeline.
 * Coordinates all modules: resolution, color, models, geometry, rendering.
 * 
 * Key responsibilities:
 * - Initialize background model loading on app start
 * - Process images through the full pipeline
 * - Manage rendering mode selection (mesh vs 2D)
 * - Handle errors gracefully with fallbacks
 */

import { EventEmitter } from './EventEmitter.js';
import { ResolutionManager, UserCancelledError } from './ResolutionManager.js';
import { ColorSpaceConverter } from './ColorSpaceConverter.js';
import { BackgroundModelLoader } from './BackgroundModelLoader.js';
import { RenderingEngine } from '../rendering/RenderingEngine.js';
import { ConfidenceEstimator } from '../confidence/ConfidenceEstimator.js';
import { LightingAnalyzer } from '../confidence/LightingAnalyzer.js';
import { NeuralNormalEstimator } from '../../../ml/NeuralNormalEstimator.js';
import { SceneAnalyzer } from './SceneAnalyzer.js';

export class RelightingPipeline extends EventEmitter {
    constructor(options = {}) {
        super();

        // Core modules
        this.resolutionManager = new ResolutionManager({
            onModalShow: () => this.emit('modal-show'),
            onModalHide: () => this.emit('modal-hide')
        });

        this.colorConverter = new ColorSpaceConverter();

        this.modelLoader = new BackgroundModelLoader();

        // GPU Renderer - initialized in init() via factory
        this.gpuRenderer = null;
        this.useGPU = true;

        // Confidence & Analysis
        this.confidenceEstimator = new ConfidenceEstimator();
        this.lightingAnalyzer = new LightingAnalyzer();
        this.sceneAnalyzer = new SceneAnalyzer();

        // Neural Normal Estimator (optional, for higher quality)
        this.neuralNormalEstimator = new NeuralNormalEstimator();
        this.useNeuralNormals = true; // Enable by default, falls back gracefully

        // State
        this.isInitialized = false;
        this.isProcessing = false;
        this.currentImage = null;
        this.gBuffer = null;

        // Light parameters (from UI)
        this.light = {
            position: { x: 0.5, y: 0.5 },
            direction: { x: 0, y: 0, z: 1 },
            color: { r: 1.0, g: 0.98, b: 0.95 },
            intensity: 0.5,
            ambient: 0.1,
            height: 0.5,
            shadowIntensity: 0.6,
            shadowSoftness: 0.4
        };

        // Pipeline data
        this.depth = null;
        this.normals = null;
        this.albedo = null;
        this.sceneMap = null;
        this.confidence = null;

        // Dimensions
        this.width = 0;
        this.height = 0;

        // Setup model loader events
        this._setupModelLoaderEvents();
    }

    /**
     * Initialize the pipeline
     * Call this when app opens - starts background model loading
     */
    async init() {
        if (this.isInitialized) return true;

        console.log('🎨 Initializing v8 Relighting Pipeline...');

        // Start background model loading (non-blocking)
        this.modelLoader.startLoading();

        // Initialize GPU renderer using factory pattern (WebGPU with WebGL2 fallback)
        try {
            this.gpuRenderer = await RenderingEngine.create();
            this.useGPU = true;

            // Emit renderer info for UI
            const capabilities = this.gpuRenderer.getCapabilities();
            this.emit('renderer-initialized', {
                backend: capabilities.backend,
                capabilities
            });

        } catch (error) {
            console.warn('GPU renderer failed, using CPU fallback:', error);
            this.useGPU = false;
        }

        this.isInitialized = true;
        this.emit('initialized');

        return true;
    }

    /**
     * Setup event forwarding from model loader
     */
    _setupModelLoaderEvents() {
        this.modelLoader.on('total-progress', (data) => {
            this.emit('model-progress', data);
        });

        this.modelLoader.on('model-loaded', (data) => {
            this.emit('model-loaded', data);
        });

        this.modelLoader.on('feature-enabled', (data) => {
            this.emit('feature-enabled', data);
        });

        this.modelLoader.on('all-models-ready', () => {
            this.emit('models-ready');
        });

        this.modelLoader.on('loading-error', (data) => {
            this.emit('model-error', data);
        });
    }

    /**
     * Process an image for relighting
     * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} image - Input image
     * @param {Function} progressCallback - Progress updates
     * @returns {Promise<boolean>} Success
     */
    async processImage(image, progressCallback = null) {
        if (this.isProcessing) {
            console.warn('Already processing an image');
            return false;
        }

        if (!this.modelLoader.isReady()) {
            console.warn('Models not ready yet');
            this.emit('not-ready');
            return false;
        }

        this.isProcessing = true;
        const startTime = performance.now();

        try {
            // Step 1: Resolution check
            this._reportProgress(progressCallback, 5, 'Checking resolution...');

            let processedImage;
            try {
                const resizeResult = await this.resolutionManager.checkAndResize(image);
                processedImage = resizeResult.image;

                if (resizeResult.wasResized) {
                    this.emit('image-resized', resizeResult);
                }
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    this.emit('cancelled');
                    return false;
                }
                throw error;
            }

            // Get dimensions
            this.width = processedImage.width || processedImage.naturalWidth;
            this.height = processedImage.height || processedImage.naturalHeight;
            this.currentImage = processedImage;

            // Step 2: Convert to linear color space
            this._reportProgress(progressCallback, 10, 'Preparing image...');
            const imageData = this._getImageData(processedImage);
            const linearImage = this.colorConverter.sRGBToLinear(imageData);

            // Step 3: Depth estimation
            this._reportProgress(progressCallback, 15, 'Estimating depth...');
            this.depth = await this._estimateDepth(processedImage, (p) => {
                const mappedProgress = 15 + (p * 0.4); // 15% to 55%
                this._reportProgress(progressCallback, mappedProgress, 'Estimating depth...');
            });

            // Step 4: Normal estimation (async chunked to avoid main thread blocking)
            this._reportProgress(progressCallback, 60, 'Computing surface normals...');

            // Use neural normals if enabled, with fallback to depth-derived
            if (this.useNeuralNormals) {
                try {
                    this._reportProgress(progressCallback, 60, 'Computing neural normals...');
                    const depthNormals = await this._computeNormalsFromDepth(this.depth);

                    // Create a Blob URL instead of the blocking toDataURL() call.
                    // toDataURL synchronously base64-encodes the full image which freezes
                    // the main thread for seconds on 4K+ images.
                    const canvas = document.createElement('canvas');
                    canvas.width = this.width;
                    canvas.height = this.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(processedImage, 0, 0);
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
                    const imageDataURL = URL.createObjectURL(blob);

                    try {
                        // Try neural estimation
                        const neuralResult = await this.neuralNormalEstimator.estimate(
                            imageDataURL,
                            this.width,
                            this.height,
                            (p) => this._reportProgress(progressCallback, 60 + p.progress * 0.1, 'Neural normals...')
                        );

                        // Convert neuralResult to compatible format
                        const neuralNormals = this._convertNormalMapToFloat32(neuralResult);

                        // Blend neural + depth normals for best quality
                        this.normals = this._blendNormals(neuralNormals, depthNormals, 0.7);
                        console.log('✓ Using hybrid neural + depth normals');
                    } finally {
                        URL.revokeObjectURL(imageDataURL);
                    }
                } catch (error) {
                    console.warn('Neural normals failed, using depth-derived:', error.message);
                    this.normals = await this._computeNormalsFromDepth(this.depth);
                }
            } else {
                this.normals = await this._computeNormalsFromDepth(this.depth);
            }

            // Step 5: Intrinsic Decomposition (Albedo/Shading separation)
            this._reportProgress(progressCallback, 70, 'Extracting albedo...');
            // TODO: Implement actual intrinsic decomposition
            // For now, we still use the original image, but we prepare the architecture
            // to swap this with the de-lit albedo later.
            this.albedo = imageData;

            // Step 5b: Scene Analysis — intelligent scene understanding (async chunked)
            this._reportProgress(progressCallback, 75, 'Analyzing scene...');
            this.sceneMap = await this.sceneAnalyzer.analyze(imageData, this.depth, this.normals);

            // Step 6: Compute confidence
            this._reportProgress(progressCallback, 85, 'Assessing quality...');
            this.confidence = this._computeConfidence(this.depth, this.normals);

            // Step 7: Build G-Buffer
            this._reportProgress(progressCallback, 95, 'Preparing render...');
            this.gBuffer = this._buildGBuffer();

            // Done
            this._reportProgress(progressCallback, 100, 'Ready!');

            const elapsed = performance.now() - startTime;
            console.log(`✓ Image processed in ${(elapsed / 1000).toFixed(2)}s`);

            this.emit('processed', {
                width: this.width,
                height: this.height,
                processingTime: elapsed,
                confidence: this.confidence.overall
            });

            return true;

        } catch (error) {
            console.error('❌ Processing failed:', error);
            this.emit('error', { error });
            return false;

        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Estimate depth using the loaded model
     */
    async _estimateDepth(image, progressCallback) {
        const pipeline = this.modelLoader.getPipeline('depth');

        // Transformers.js expects HTMLCanvasElement, URL, or RawImage
        // Convert HTMLImageElement to canvas first
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        const result = await pipeline(canvas);

        // Convert to Float32Array
        const depthData = result.depth?.data || result.data;

        return {
            data: depthData,
            width: result.depth?.width || this.width,
            height: result.depth?.height || this.height,
            min: 0,
            max: 1
        };
    }

    /**
     * Compute normals from depth map.
     * Async with chunked row processing to avoid blocking the main thread
     * on large images (4K+ = millions of Sobel operations).
     */
    async _computeNormalsFromDepth(depth) {
        const { data, width, height } = depth;
        const normals = new Float32Array(width * height * 3);

        // Process in row chunks, yielding to the main thread between chunks.
        // 128 rows is a good balance between throughput and responsiveness.
        const CHUNK_SIZE = 128;

        for (let startY = 1; startY < height - 1; startY += CHUNK_SIZE) {
            const endY = Math.min(startY + CHUNK_SIZE, height - 1);

            for (let y = startY; y < endY; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;

                    // Sobel Operator (3x3 kernel) for smoother normals
                    const tl = data[(y - 1) * width + (x - 1)];
                    const t = data[(y - 1) * width + x];
                    const tr = data[(y - 1) * width + (x + 1)];
                    const l = data[y * width + (x - 1)];
                    const r = data[y * width + (x + 1)];
                    const bl = data[(y + 1) * width + (x - 1)];
                    const b = data[(y + 1) * width + x];
                    const br = data[(y + 1) * width + (x + 1)];

                    // Sobel X
                    const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
                    // Sobel Y
                    const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);

                    const strength = 1.0;
                    let nx = -dX * strength;
                    let ny = -dY * strength;
                    let nz = 1.0 / 8.0;

                    // Normalize
                    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                    nx /= len;
                    ny /= len;
                    nz /= len;

                    const outIdx = idx * 3;
                    normals[outIdx] = nx;
                    normals[outIdx + 1] = ny;
                    normals[outIdx + 2] = nz;
                }
            }

            // Yield to the main thread between chunks to prevent "Page Unresponsive"
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        return {
            data: normals,
            width,
            height
        };
    }

    /**
     * Convert ImageData-based normal map to Float32Array format
     */
    _convertNormalMapToFloat32(normalMap) {
        const { data, width, height } = normalMap;
        const normals = new Float32Array(width * height * 3);

        for (let i = 0; i < width * height; i++) {
            const pixelIdx = i * 4;
            const outIdx = i * 3;

            // Convert from [0, 255] to [-1, 1]
            normals[outIdx] = (data[pixelIdx] / 255.0) * 2 - 1;     // X
            normals[outIdx + 1] = (data[pixelIdx + 1] / 255.0) * 2 - 1; // Y
            normals[outIdx + 2] = (data[pixelIdx + 2] / 255.0) * 2 - 1; // Z
        }

        return {
            data: normals,
            width,
            height
        };
    }

    /**
     * Blend two normal maps with weighted average
     * @param {Object} normals1 - First normal map (neural)
     * @param {Object} normals2 - Second normal map (depth-derived)
     * @param {number} weight1 - Weight for first map (0-1)
     */
    _blendNormals(normals1, normals2, weight1 = 0.7) {
        const weight2 = 1.0 - weight1;
        const width = normals1.width;
        const height = normals1.height;
        const blended = new Float32Array(width * height * 3);

        for (let i = 0; i < width * height; i++) {
            const idx = i * 3;

            // Weighted average
            let nx = normals1.data[idx] * weight1 + normals2.data[idx] * weight2;
            let ny = normals1.data[idx + 1] * weight1 + normals2.data[idx + 1] * weight2;
            let nz = normals1.data[idx + 2] * weight1 + normals2.data[idx + 2] * weight2;

            // Re-normalize
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 0) {
                nx /= len;
                ny /= len;
                nz /= len;
            }

            blended[idx] = nx;
            blended[idx + 1] = ny;
            blended[idx + 2] = nz;
        }

        return {
            data: blended,
            width,
            height,
            isHybrid: true
        };
    }

    /**
     * Compute confidence score using 3-tier system
     */
    _computeConfidence(depth, normals) {
        // Build temporary gBuffer for confidence estimation
        const gBuffer = {
            depth: depth,
            normals: normals,
            albedo: this.albedo,
            width: this.width,
            height: this.height
        };

        // Use the full confidence estimator
        const confidence = this.confidenceEstimator.estimate(gBuffer);

        // Also analyze lighting if we have image data
        if (this.albedo) {
            const lighting = this.lightingAnalyzer.analyze(this.albedo);
            confidence.lighting = lighting;
            confidence.warnings = [...(confidence.warnings || []), ...(lighting.warnings || [])];

            // Store detected original light direction for intrinsic decomposition
            if (lighting.dominantLightDir) {
                this.light.originalLightDir = lighting.dominantLightDir;
                console.log(`💡 Detected original light direction: (${lighting.dominantLightDir.x.toFixed(2)}, ${lighting.dominantLightDir.y.toFixed(2)})`);
            }
        }

        // Log confidence results
        console.log(`📊 Quality: ${confidence.quality} (${(confidence.overall * 100).toFixed(0)}%)`);
        if (confidence.warnings.length > 0) {
            console.log(`⚠ Warnings:`, confidence.warnings.map(w => w.message));
        }

        // Emit confidence event for UI
        this.emit('confidence', confidence);

        return confidence;
    }

    /**
     * Build G-Buffer for deferred rendering
     */
    _buildGBuffer() {
        return {
            albedo: this.albedo,
            normals: this.normals,
            depth: this.depth,
            sceneMap: this.sceneMap,
            confidence: this.confidence,
            width: this.width,
            height: this.height
        };
    }

    /**
     * Get ImageData from various image types
     */
    _getImageData(image) {
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, this.width, this.height);
    }

    /**
     * Report progress
     */
    _reportProgress(callback, percent, message) {
        if (callback) {
            callback({ progress: percent, message, stage: 'processing' });
        }
        this.emit('progress', { progress: percent, message });
    }

    /**
     * Render with current light settings
     * @returns {HTMLCanvasElement}
     */
    render() {
        if (!this.gBuffer) {
            console.warn('No image processed yet');
            return null;
        }

        // Use GPU renderer if available
        if (this.useGPU && this.gpuRenderer.isInitialized) {
            return this._renderGPU();
        }

        // Fallback to CPU rendering
        return this._renderCPU();
    }

    /**
     * GPU-accelerated deferred rendering
     */
    _renderGPU() {
        const canvas = this.gpuRenderer.render(this.gBuffer, this.light);
        return canvas;
    }

    /**
     * CPU rendering fallback
     */
    _renderCPU() {
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        const ctx = canvas.getContext('2d');

        // Get albedo pixels
        const albedoData = this.albedo;
        const output = ctx.createImageData(this.width, this.height);

        const { normals, depth } = this;
        const { direction, intensity, ambient, color } = this.light;

        // Normalize light direction
        const lx = direction.x;
        const ly = direction.y;
        const lz = direction.z;
        const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const lightDir = { x: lx / lLen, y: ly / lLen, z: lz / lLen };

        for (let i = 0; i < this.width * this.height; i++) {
            const nx = normals.data[i * 3];
            const ny = normals.data[i * 3 + 1];
            const nz = normals.data[i * 3 + 2];

            // Lambertian diffuse
            const NdotL = Math.max(0, nx * lightDir.x + ny * lightDir.y + nz * lightDir.z);
            const lighting = ambient + NdotL * intensity;

            const srcIdx = i * 4;
            output.data[srcIdx] = Math.min(255, albedoData.data[srcIdx] * lighting * color.r);
            output.data[srcIdx + 1] = Math.min(255, albedoData.data[srcIdx + 1] * lighting * color.g);
            output.data[srcIdx + 2] = Math.min(255, albedoData.data[srcIdx + 2] * lighting * color.b);
            output.data[srcIdx + 3] = 255;
        }

        ctx.putImageData(output, 0, 0);
        return canvas;
    }

    // === Light control methods ===

    setLightPosition(x, y) {
        this.light.position.x = Math.max(0, Math.min(1, x));
        this.light.position.y = Math.max(0, Math.min(1, y));
        this._updateLightDirection();
    }

    setLightIntensity(intensity) {
        this.light.intensity = Math.max(0, Math.min(2, intensity));
    }

    setAmbient(ambient) {
        this.light.ambient = Math.max(0, Math.min(1, ambient));
    }

    setLightHeight(height) {
        this.light.height = Math.max(0, Math.min(1, height));
        this._updateLightDirection();
    }

    setLightColor(r, g, b) {
        this.light.color = { r, g, b };
    }

    setShadowIntensity(intensity) {
        this.light.shadowIntensity = Math.max(0, Math.min(1, intensity));
    }

    setShadowSoftness(softness) {
        this.light.shadowSoftness = Math.max(0, Math.min(1, softness));
    }

    // === v7 Compatibility Methods ===
    // These methods exist for UI compatibility with RelightingModule.js

    setSpecularity(specularity) {
        this.light.specularity = Math.max(0, Math.min(1, specularity));
    }

    setGlossiness(glossiness) {
        this.light.glossiness = Math.max(0, Math.min(256, glossiness));
    }

    setReach(reach) {
        this.light.reach = Math.max(0, reach);
    }

    setContrast(contrast) {
        this.light.contrast = Math.max(0, Math.min(2, contrast));
    }

    setDirectional(isDirectional) {
        this.light.isDirectional = isDirectional;
    }

    setBlendMode(mode) {
        this.light.blendMode = mode;
    }

    setLightDirection(dx, dy, dz = 0.5) {
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 0) {
            this.light.direction = {
                x: dx / len,
                y: dy / len,
                z: dz / len
            };
        }
    }

    // Rim lighting
    setRimIntensity(intensity) {
        this.light.rimIntensity = Math.max(0, Math.min(1, intensity));
    }

    setRimWidth(width) {
        this.light.rimWidth = Math.max(0, Math.min(1, width));
    }

    setRimColor(r, g, b) {
        this.light.rimColor = { r, g, b };
    }

    // Shadow controls
    setShadowEnabled(enabled) {
        this.light.shadowEnabled = enabled;
    }

    setShadowColor(r, g, b) {
        this.light.shadowColor = { r, g, b };
    }

    // Spotlight
    setSpotlightEnabled(enabled) {
        this.light.spotlightEnabled = enabled;
    }

    setSpotAngle(angle) {
        this.light.spotAngle = Math.max(1, Math.min(180, angle));
    }

    setSpotSoftness(softness) {
        this.light.spotSoftness = Math.max(0, Math.min(1, softness));
    }

    // Subsurface scattering
    setSSSIntensity(intensity) {
        this.light.sssIntensity = Math.max(0, Math.min(1, intensity));
    }

    setSSSColor(r, g, b) {
        this.light.sssColor = { r, g, b };
    }

    // Ambient occlusion
    setAOIntensity(intensity) {
        this.light.aoIntensity = Math.max(0, Math.min(1, intensity));
    }

    setAORadius(radius) {
        this.light.aoRadius = Math.max(1, Math.min(50, radius));
    }

    // PBR
    setRoughness(roughness) {
        this.light.roughness = Math.max(0, Math.min(1, roughness));
    }

    setMetallic(metallic) {
        this.light.metallic = Math.max(0, Math.min(1, metallic));
    }

    setUsePBR(usePBR) {
        this.light.usePBR = usePBR;
    }

    setGPUShadows(useGPUShadows) {
        this.light.useGPUShadows = useGPUShadows;
    }

    // Preset application
    applyPreset(preset) {
        // Presets would adjust multiple light parameters together
        console.log(`Applied preset: ${preset}`);
    }

    // === Static cache methods (v7 API compatibility) ===

    static async checkCacheStatus() {
        try {
            const cache = await caches.open('transformers-cache');
            const keys = await cache.keys();
            const totalSize = keys.length > 0 ? '~50 MB' : '';
            return {
                cached: keys.length > 0,
                size: totalSize
            };
        } catch {
            return { cached: false, size: '' };
        }
    }

    static async clearCache() {
        try {
            await caches.delete('transformers-cache');
            console.log('✓ Transformers cache cleared');
            return true;
        } catch (error) {
            console.error('Failed to clear cache:', error);
            return false;
        }
    }

    // === Model Tier Methods ===

    /**
     * Set model quality tier
     * @param {string} tier - 'fast' or 'balanced'
     */
    async setModelTier(tier) {
        await this.modelLoader.setTier(tier);
    }

    /**
     * Get available model tiers
     */
    getModelTiers() {
        return this.modelLoader.getTiers();
    }

    /**
     * Get current model tier
     */
    getCurrentModelTier() {
        return this.modelLoader.getCurrentTier();
    }

    _updateLightDirection() {
        const px = (this.light.position.x - 0.5) * 2;
        const py = (this.light.position.y - 0.5) * 2;

        const dirX = px;
        const dirY = py;  // Removed negation - Y now matches UI (top = top light)
        const dirZ = Math.max(0.3, this.light.height);

        const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
        this.light.direction = {
            x: dirX / len,
            y: dirY / len,
            z: dirZ / len
        };
    }

    // === Status methods ===

    isReady() {
        return this.modelLoader.isReady();
    }

    hasProcessedImage() {
        return this.gBuffer !== null;
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            modelsReady: this.modelLoader.isReady(),
            modelsFullyLoaded: this.modelLoader.isFullyLoaded(),
            hasImage: this.hasProcessedImage(),
            dimensions: this.gBuffer ? {
                width: this.width,
                height: this.height
            } : null,
            confidence: this.confidence?.overall || 0,
            modelStatus: this.modelLoader.getStatus()
        };
    }

    // === Cleanup ===

    dispose() {
        this.depth = null;
        this.normals = null;
        this.albedo = null;
        this.confidence = null;
        this.gBuffer = null;
        this.currentImage = null;
        this.removeAllListeners();
    }
}

export default RelightingPipeline;
