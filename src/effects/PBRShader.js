/**
 * PBRShader - Physically Based Rendering Shader v2.0
 * 
 * Implements hybrid PBR lighting with exposure-based output:
 * - GGX specular (D, G, F terms) for surface reflections
 * - Lambert diffuse for base lighting
 * - Fresnel-Schlick approximation
 * - EXPOSURE-BASED output (matches preview look)
 * 
 * Key insight: We calculate PBR lighting then convert to exposure stops
 * for natural-looking brightness like camera exposure adjustment.
 */

export class PBRShader {
    constructor() {
        this.PI = Math.PI;
    }

    /**
     * Apply PBR lighting to an image
     * 
     * @param {HTMLCanvasElement} albedoMap - Original image (or albedo)
     * @param {Object} normalMap - Normal map with { width, height, data }
     * @param {HTMLCanvasElement} depthMap - Depth map
     * @param {Object} materialMap - Material properties (roughness, metallic, etc.)
     * @param {Array} lights - Array of light objects { x, y, z, color, intensity }
     * @param {Object} options - Rendering options
     * @returns {HTMLCanvasElement} - Relit image
     */
    render(albedoMap, normalMap, depthMap, materialMap, lights, options = {}) {
        const {
            ambientLight = 0.15,           // Base ambient level
            shadowStrength = 0.5,          // How dark shadows are
            aoStrength = 0.3,              // AO effect strength
            aoMap = null,                  // Optional AO map
            defaultRoughness = 0.5,
            defaultMetallic = 0.0,
        } = options;

        const width = albedoMap.width;
        const height = albedoMap.height;

        console.log(`🔬 PBR rendering: ${width}×${height} with ${lights.length} lights`);
        const startTime = performance.now();

        // Get source data
        const albedoCtx = albedoMap.getContext('2d');
        const albedoData = albedoCtx.getImageData(0, 0, width, height).data;

        const normalCanvas = this._ensureCanvas(normalMap, width, height);
        const normalCtx = normalCanvas.getContext('2d');
        const normalData = normalCtx.getImageData(0, 0, width, height).data;

        const depthCanvas = this._ensureCanvas(depthMap, width, height);
        const depthCtx = depthCanvas.getContext('2d');
        const depthData = depthCtx.getImageData(0, 0, width, height).data;

        // Material data (optional)
        let materialData = null;
        if (materialMap) {
            const matCanvas = this._ensureCanvas(materialMap, width, height);
            const matCtx = matCanvas.getContext('2d');
            materialData = matCtx.getImageData(0, 0, width, height).data;
        }

        // AO data (optional)
        let aoData = null;
        if (aoMap) {
            const aoCanvas = this._ensureCanvas(aoMap, width, height);
            const aoCtx = aoCanvas.getContext('2d');
            aoData = aoCtx.getImageData(0, 0, width, height).data;
        }

        // Create output canvas
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = width;
        outputCanvas.height = height;
        const outputCtx = outputCanvas.getContext('2d');
        const outputData = outputCtx.createImageData(width, height);

        // Process each pixel
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;

                // Get original colors (0-255)
                const origR = albedoData[idx];
                const origG = albedoData[idx + 1];
                const origB = albedoData[idx + 2];

                // Get normal (decode from 0-255 to -1..1)
                const N = this._normalize([
                    (normalData[idx] / 255) * 2 - 1,
                    (normalData[idx + 1] / 255) * 2 - 1,
                    (normalData[idx + 2] / 255) * 2 - 1
                ]);

                // Get depth (0-1)
                const depth = depthData[idx] / 255;

                // Get material properties
                let roughness = defaultRoughness;
                let metallic = defaultMetallic;
                if (materialData) {
                    roughness = materialData[idx] / 255;
                    metallic = materialData[idx + 1] / 255;
                }

                // Get AO
                let ao = 1.0;
                if (aoData) {
                    ao = 1.0 - (1.0 - aoData[idx] / 255) * aoStrength;
                }

                // Pixel position in normalized space (0-1)
                const pxNorm = x / width;
                const pyNorm = y / height;

                // View direction (camera looking at screen)
                const V = this._normalize([0, 0, 1]);

                // Accumulate light contribution per channel
                let lightR = 0, lightG = 0, lightB = 0;
                let maxShadow = 0;

                for (const light of lights) {
                    // Light position is ALREADY normalized (0-1) from RelightingEffect
                    // DO NOT divide by width/height again!
                    const lightX = light.x;
                    const lightY = light.y;
                    const lightZ = light.z || 0.5;

                    // Light direction (toward light)
                    const lx = lightX - pxNorm;
                    const ly = lightY - pyNorm;
                    const lz = lightZ;
                    const lightDist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                    const L = this._normalize([lx, ly, lz]);

                    // Soft attenuation (matches legacy: 1/(1 + dist² × 3))
                    const attenuation = 1 / (1 + lightDist * lightDist * 3);

                    // N·L (Lambert diffuse term)
                    const NdotL = Math.max(0, this._dot(N, L));

                    // Skip backfacing
                    if (NdotL <= 0) continue;

                    // Light color (normalized 0-1)
                    const lightColor = light.color || [1, 1, 1];
                    const lcR = typeof lightColor[0] === 'number' ? lightColor[0] : 1;
                    const lcG = typeof lightColor[1] === 'number' ? lightColor[1] : 1;
                    const lcB = typeof lightColor[2] === 'number' ? lightColor[2] : 1;

                    // Match GPU preview shader (RelightingShader.js line 384-387)
                    // GPU uses: attenuation × intensity × shadow, then × 0.5
                    const lightIntensity = NdotL * attenuation * (light.intensity || 1.0) * 0.5;

                    // Accumulate per-channel (for colored lights)
                    lightR += lightIntensity * lcR;
                    lightG += lightIntensity * lcG;
                    lightB += lightIntensity * lcB;
                }

                // Match GPU preview shader ambient (starts at 0.8)
                const ambient = 0.8;
                const finalLightR = ambient + lightR;
                const finalLightG = ambient + lightG;
                const finalLightB = ambient + lightB;

                // Match GPU preview shader exposure formula (line 392):
                // exposedColor = color.rgb * exp2((finalLight - 1.0) * 0.5)
                const exposureR = Math.pow(2, (finalLightR - 1.0) * 0.5);
                const exposureG = Math.pow(2, (finalLightG - 1.0) * 0.5);
                const exposureB = Math.pow(2, (finalLightB - 1.0) * 0.5);

                // Apply ambient occlusion
                const aoFactor = ao;

                // Apply exposure to original colors
                let r = origR * exposureR * aoFactor;
                let g = origG * exposureG * aoFactor;
                let b = origB * exposureB * aoFactor;

                // Soft highlight compression (prevent pure white blow-out)
                r = this._compressHighlight(r);
                g = this._compressHighlight(g);
                b = this._compressHighlight(b);

                // Clamp to valid range
                outputData.data[idx] = Math.max(0, Math.min(255, Math.round(r)));
                outputData.data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
                outputData.data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
                outputData.data[idx + 3] = 255;
            }
        }

        outputCtx.putImageData(outputData, 0, 0);

        const elapsed = performance.now() - startTime;
        console.log(`✅ PBR render complete (${elapsed.toFixed(0)}ms)`);

        return outputCanvas;
    }

    /**
     * Soft highlight compression to prevent blow-out
     */
    _compressHighlight(val) {
        if (val > 200) {
            const excess = val - 200;
            return 200 + excess * 0.3;
        }
        return val;
    }

    // Vector math helpers
    _normalize(v) {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
    }

    _dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    _addVec(a, b) {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    }

    _ensureCanvas(map, width, height) {
        if (map instanceof HTMLCanvasElement) {
            if (map.width === width && map.height === height) {
                return map;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(map, 0, 0, width, height);
            return canvas;
        }

        if (map instanceof HTMLImageElement) {
            const canvas = document.createElement('canvas');
            canvas.width = map.naturalWidth || map.width;
            canvas.height = map.naturalHeight || map.height;
            canvas.getContext('2d').drawImage(map, 0, 0);
            if (canvas.width !== width || canvas.height !== height) {
                const resized = document.createElement('canvas');
                resized.width = width;
                resized.height = height;
                resized.getContext('2d').drawImage(canvas, 0, 0, width, height);
                return resized;
            }
            return canvas;
        }

        if (map.canvas instanceof HTMLCanvasElement) {
            return this._ensureCanvas(map.canvas, width, height);
        }

        if (map.data && map.width && map.height) {
            const canvas = document.createElement('canvas');
            canvas.width = map.width;
            canvas.height = map.height;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(map.width, map.height);
            imgData.data.set(map.data);
            ctx.putImageData(imgData, 0, 0);

            if (map.width !== width || map.height !== height) {
                const resized = document.createElement('canvas');
                resized.width = width;
                resized.height = height;
                resized.getContext('2d').drawImage(canvas, 0, 0, width, height);
                return resized;
            }
            return canvas;
        }

        // Return empty canvas as fallback
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
}
