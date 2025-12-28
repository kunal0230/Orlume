/**
 * RelightingEngine - State-of-the-Art Relighting System
 * 
 * Orchestrates the complete relighting pipeline:
 * 1. Scene Analysis (depth, normals, segmentation)
 * 2. Albedo Extraction (intrinsic decomposition)
 * 3. PBR Rendering (GGX specular, Lambert diffuse)
 * 4. Shadow Casting (raymarched shadows)
 * 5. Material-Aware Effects (subsurface, metallic, etc.)
 */

import { AlbedoEstimator } from './AlbedoEstimator.js';
import { PBRShader } from './PBRShader.js';
import { ShadowCaster } from './ShadowCaster.js';

export class RelightingEngine {
    constructor(app) {
        this.app = app;

        // Core components
        this.albedoEstimator = new AlbedoEstimator();
        this.pbrShader = new PBRShader();
        this.shadowCaster = new ShadowCaster();

        // Cached maps
        this.albedoMap = null;
        this.shadingMap = null;
        this.shadowMap = null;
        this.outputCanvas = null;

        // Light sources
        this.lights = [];

        // Options
        this.options = {
            enableShadows: true,
            enablePBR: true,
            shadowSoftness: 0.3,
            ambientIntensity: 0.3,
            ambientColor: [0.1, 0.1, 0.15],
        };

        console.log('🔦 RelightingEngine initialized');
    }

    /**
     * Prepare scene for relighting
     * Call this after depth/segmentation analysis is complete
     * 
     * @param {HTMLImageElement|HTMLCanvasElement} image - Original image
     * @param {Object} sceneData - Analysis results
     */
    prepareScene(image, sceneData) {
        const { depthMap, normalMap, materialMap } = sceneData;

        console.log('🎬 Preparing scene for relighting...');
        const startTime = performance.now();

        // Store references
        this.originalImage = image;
        this.depthMap = this._ensureCanvas(depthMap);
        this.normalMap = normalMap;
        this.materialMap = materialMap;

        // Extract albedo from image
        const albedoResult = this.albedoEstimator.estimate(
            image,
            this.depthMap,
            this.normalMap,
            {
                shadingStrength: 0.5,
                ambientLight: 0.3,
                smoothingRadius: 3
            }
        );

        this.albedoMap = albedoResult.albedo;
        this.shadingMap = albedoResult.shading;

        const elapsed = performance.now() - startTime;
        console.log(`✅ Scene prepared (${elapsed.toFixed(0)}ms)`);

        return {
            albedo: this.albedoMap,
            shading: this.shadingMap
        };
    }

    /**
     * Add a light source
     * 
     * @param {Object} light - { x, y, z, color, intensity }
     */
    addLight(light) {
        this.lights.push({
            x: light.x,
            y: light.y,
            z: light.z || 0.5,
            color: light.color || [1, 1, 1],
            intensity: light.intensity || 1.0
        });
    }

    /**
     * Clear all lights
     */
    clearLights() {
        this.lights = [];
    }

    /**
     * Set light position (for single light mode)
     */
    setLightPosition(x, y, z = 0.5) {
        if (this.lights.length === 0) {
            this.addLight({ x, y, z, intensity: 1.5 });
        } else {
            this.lights[0].x = x;
            this.lights[0].y = y;
            this.lights[0].z = z;
        }
    }

    /**
     * Render the scene with current lights
     * 
     * @returns {HTMLCanvasElement} - Relit image
     */
    render() {
        if (!this.albedoMap) {
            console.warn('Scene not prepared. Call prepareScene() first.');
            return this.originalImage;
        }

        if (this.lights.length === 0) {
            console.warn('No lights added. Add lights with addLight().');
            return this.originalImage;
        }

        console.log(`🎨 Rendering with ${this.lights.length} light(s)...`);
        const startTime = performance.now();

        // Calculate shadows if enabled
        if (this.options.enableShadows) {
            this.shadowMap = this.shadowCaster.calculate(
                this.depthMap,
                this.lights,
                {
                    steps: 24,
                    softness: this.options.shadowSoftness,
                    maxShadow: 0.7
                }
            );
        }

        // Render with PBR
        if (this.options.enablePBR) {
            this.outputCanvas = this.pbrShader.render(
                this.albedoMap,
                this.normalMap,
                this.depthMap,
                this.materialMap,
                this.lights,
                {
                    ambientColor: this.options.ambientColor,
                    ambientIntensity: this.options.ambientIntensity,
                    aoMap: this.shadowMap,
                    shadowStrength: 0.5
                }
            );
        } else {
            // Simple non-PBR rendering (fallback)
            this.outputCanvas = this._simpleRender();
        }

        const elapsed = performance.now() - startTime;
        console.log(`✅ Render complete (${elapsed.toFixed(0)}ms)`);

        return this.outputCanvas;
    }

    /**
     * Quick render for real-time preview (lower quality)
     */
    renderPreview() {
        // Use downscaled version for speed
        const previewScale = 0.5;
        const prevWidth = Math.round(this.albedoMap.width * previewScale);
        const prevHeight = Math.round(this.albedoMap.height * previewScale);

        // Scale down albedo
        const scaledAlbedo = document.createElement('canvas');
        scaledAlbedo.width = prevWidth;
        scaledAlbedo.height = prevHeight;
        scaledAlbedo.getContext('2d').drawImage(this.albedoMap, 0, 0, prevWidth, prevHeight);

        // Scale lights
        const scaledLights = this.lights.map(l => ({
            ...l,
            x: l.x * previewScale,
            y: l.y * previewScale
        }));

        // Simple shading for preview
        return this._simpleRender(scaledAlbedo, scaledLights, prevWidth, prevHeight);
    }

    /**
     * Simple rendering without full PBR (faster)
     */
    _simpleRender(albedo = this.albedoMap, lights = this.lights, width = null, height = null) {
        width = width || albedo.width;
        height = height || albedo.height;

        const output = document.createElement('canvas');
        output.width = width;
        output.height = height;
        const ctx = output.getContext('2d');

        const albedoCtx = albedo.getContext('2d');
        const albedoData = albedoCtx.getImageData(0, 0, width, height);
        const outputData = ctx.createImageData(width, height);

        // Get normal data if available
        let normalData = null;
        if (this.normalMap) {
            const nCanvas = document.createElement('canvas');
            nCanvas.width = width;
            nCanvas.height = height;
            const nCtx = nCanvas.getContext('2d');

            if (this.normalMap instanceof HTMLCanvasElement) {
                nCtx.drawImage(this.normalMap, 0, 0, width, height);
            } else if (this.normalMap.data) {
                const srcCanvas = document.createElement('canvas');
                srcCanvas.width = this.normalMap.width;
                srcCanvas.height = this.normalMap.height;
                const srcCtx = srcCanvas.getContext('2d');
                const srcData = srcCtx.createImageData(this.normalMap.width, this.normalMap.height);
                srcData.data.set(this.normalMap.data);
                srcCtx.putImageData(srcData, 0, 0);
                nCtx.drawImage(srcCanvas, 0, 0, width, height);
            }
            normalData = nCtx.getImageData(0, 0, width, height).data;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;

                // Get albedo
                let r = albedoData.data[idx];
                let g = albedoData.data[idx + 1];
                let b = albedoData.data[idx + 2];

                // Calculate simple lighting
                let totalLight = 0.3; // Ambient

                for (const light of lights) {
                    const dx = (light.x - x) / width;
                    const dy = (light.y - y) / height;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // Distance attenuation
                    const atten = 1.0 / (1.0 + dist * dist * 8);

                    // Diffuse from normal if available
                    let diffuse = 1.0;
                    if (normalData) {
                        const nx = (normalData[idx] / 255) * 2 - 1;
                        const ny = (normalData[idx + 1] / 255) * 2 - 1;
                        const nz = (normalData[idx + 2] / 255) * 2 - 1;

                        const lx = dx / (dist + 0.001);
                        const ly = dy / (dist + 0.001);
                        const lz = 0.5;
                        const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz);

                        diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / lLen);
                    }

                    totalLight += (light.intensity || 1.0) * atten * diffuse;
                }

                // Apply lighting
                r = Math.min(255, Math.round(r * totalLight));
                g = Math.min(255, Math.round(g * totalLight));
                b = Math.min(255, Math.round(b * totalLight));

                outputData.data[idx] = r;
                outputData.data[idx + 1] = g;
                outputData.data[idx + 2] = b;
                outputData.data[idx + 3] = 255;
            }
        }

        ctx.putImageData(outputData, 0, 0);
        return output;
    }

    /**
     * Get debug visualization
     */
    getDebugMaps() {
        return {
            albedo: this.albedoMap,
            shading: this.shadingMap,
            shadow: this.shadowMap,
            output: this.outputCanvas
        };
    }

    /**
     * Ensure input is a canvas
     */
    _ensureCanvas(map) {
        if (map instanceof HTMLCanvasElement) return map;

        if (map.canvas instanceof HTMLCanvasElement) return map.canvas;

        if (map.data && map.width && map.height) {
            const canvas = document.createElement('canvas');
            canvas.width = map.width;
            canvas.height = map.height;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(map.width, map.height);
            imgData.data.set(map.data);
            ctx.putImageData(imgData, 0, 0);
            return canvas;
        }

        return map;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.albedoEstimator.dispose();
        this.shadowCaster.dispose();
        this.albedoMap = null;
        this.shadingMap = null;
        this.shadowMap = null;
        this.outputCanvas = null;
    }
}
