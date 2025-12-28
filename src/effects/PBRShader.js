/**
 * PBRShader - Physically Based Rendering Shader
 * 
 * Implements a proper PBR lighting model with:
 * - GGX specular (D, G, F terms)
 * - Lambert diffuse
 * - Fresnel-Schlick approximation
 * - Material properties (roughness, metallic)
 * 
 * This runs in JavaScript for simplicity, but could be ported to WebGL.
 */

export class PBRShader {
    constructor() {
        this.PI = Math.PI;
    }

    /**
     * Apply PBR lighting to an image
     * 
     * @param {HTMLCanvasElement} albedoMap - True color without lighting
     * @param {Object} normalMap - Normal map with { width, height, data }
     * @param {HTMLCanvasElement} depthMap - Depth map
     * @param {Object} materialMap - Material properties (roughness, metallic, etc.)
     * @param {Array} lights - Array of light objects { x, y, z, color, intensity }
     * @param {Object} options - Rendering options
     * @returns {HTMLCanvasElement} - Relit image
     */
    render(albedoMap, normalMap, depthMap, materialMap, lights, options = {}) {
        const {
            ambientColor = [0.1, 0.1, 0.15],   // Ambient light color
            ambientIntensity = 0.3,            // Ambient strength
            cameraZ = -1.0,                     // Camera position (for view vector)
            defaultRoughness = 0.5,
            defaultMetallic = 0.0,
            shadowStrength = 0.5,
            aoStrength = 0.5,
            aoMap = null,                       // Optional AO map
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

                // Get albedo (RGB 0-1)
                const albedo = [
                    albedoData[idx] / 255,
                    albedoData[idx + 1] / 255,
                    albedoData[idx + 2] / 255
                ];

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

                // Pixel position in normalized space
                const pixelPos = [
                    (x / width) * 2 - 1,
                    (y / height) * 2 - 1,
                    depth
                ];

                // View direction (camera to pixel)
                const V = this._normalize([
                    -pixelPos[0],
                    -pixelPos[1],
                    cameraZ - depth
                ]);

                // Accumulate lighting
                let totalLight = [0, 0, 0];

                // Add ambient
                const ambient = [
                    ambientColor[0] * ambientIntensity * ao,
                    ambientColor[1] * ambientIntensity * ao,
                    ambientColor[2] * ambientIntensity * ao
                ];
                totalLight = this._addVec(totalLight, ambient);

                // Process each light
                for (const light of lights) {
                    // Light position in normalized space
                    const lightPos = [
                        (light.x / width) * 2 - 1,
                        (light.y / height) * 2 - 1,
                        light.z || 0.5
                    ];

                    // Light direction
                    const L = this._normalize([
                        lightPos[0] - pixelPos[0],
                        lightPos[1] - pixelPos[1],
                        lightPos[2] - depth
                    ]);

                    // Distance attenuation
                    const dist = this._length([
                        lightPos[0] - pixelPos[0],
                        lightPos[1] - pixelPos[1],
                        lightPos[2] - depth
                    ]);
                    const attenuation = 1.0 / (1.0 + dist * dist * 2);

                    // Light color and intensity
                    const lightColor = light.color || [1, 1, 1];
                    const intensity = (light.intensity || 1.0) * attenuation;

                    // Calculate PBR lighting
                    const [diffuse, specular] = this._calculatePBR(
                        albedo, N, V, L, roughness, metallic
                    );

                    // Add to total
                    totalLight[0] += (diffuse[0] + specular[0]) * lightColor[0] * intensity;
                    totalLight[1] += (diffuse[1] + specular[1]) * lightColor[1] * intensity;
                    totalLight[2] += (diffuse[2] + specular[2]) * lightColor[2] * intensity;
                }

                // Final color = albedo × totalLight
                const finalColor = [
                    Math.min(1, albedo[0] * totalLight[0]),
                    Math.min(1, albedo[1] * totalLight[1]),
                    Math.min(1, albedo[2] * totalLight[2])
                ];

                // Apply simple tone mapping
                const mapped = this._toneMap(finalColor);

                // Write output
                outputData.data[idx] = Math.round(mapped[0] * 255);
                outputData.data[idx + 1] = Math.round(mapped[1] * 255);
                outputData.data[idx + 2] = Math.round(mapped[2] * 255);
                outputData.data[idx + 3] = 255;
            }
        }

        outputCtx.putImageData(outputData, 0, 0);

        const elapsed = performance.now() - startTime;
        console.log(`✅ PBR render complete (${elapsed.toFixed(0)}ms)`);

        return outputCanvas;
    }

    /**
     * Calculate PBR lighting for a single sample
     * Returns [diffuse, specular] both as RGB arrays
     */
    _calculatePBR(albedo, N, V, L, roughness, metallic) {
        // Half vector
        const H = this._normalize(this._addVec(V, L));

        // Dot products
        const NdotL = Math.max(0, this._dot(N, L));
        const NdotV = Math.max(0.001, this._dot(N, V));
        const NdotH = Math.max(0, this._dot(N, H));
        const VdotH = Math.max(0, this._dot(V, H));

        if (NdotL <= 0) {
            return [[0, 0, 0], [0, 0, 0]];
        }

        // F0 (base reflectivity) - use albedo for metals, 0.04 for dielectrics
        const F0 = [
            this._lerp(0.04, albedo[0], metallic),
            this._lerp(0.04, albedo[1], metallic),
            this._lerp(0.04, albedo[2], metallic)
        ];

        // GGX Distribution (D)
        const a = roughness * roughness;
        const a2 = a * a;
        const denom = NdotH * NdotH * (a2 - 1) + 1;
        const D = a2 / (this.PI * denom * denom + 0.0001);

        // Geometry function (G) - Smith GGX
        const k = (roughness + 1) * (roughness + 1) / 8;
        const G1V = NdotV / (NdotV * (1 - k) + k);
        const G1L = NdotL / (NdotL * (1 - k) + k);
        const G = G1V * G1L;

        // Fresnel (F) - Schlick approximation
        const F = [
            F0[0] + (1 - F0[0]) * Math.pow(1 - VdotH, 5),
            F0[1] + (1 - F0[1]) * Math.pow(1 - VdotH, 5),
            F0[2] + (1 - F0[2]) * Math.pow(1 - VdotH, 5)
        ];

        // Specular BRDF
        const specDenom = 4 * NdotV * NdotL + 0.0001;
        const specular = [
            (D * G * F[0]) / specDenom * NdotL,
            (D * G * F[1]) / specDenom * NdotL,
            (D * G * F[2]) / specDenom * NdotL
        ];

        // Diffuse (Lambert) - metals have no diffuse
        const kD = [
            (1 - F[0]) * (1 - metallic),
            (1 - F[1]) * (1 - metallic),
            (1 - F[2]) * (1 - metallic)
        ];
        const diffuse = [
            kD[0] * NdotL / this.PI,
            kD[1] * NdotL / this.PI,
            kD[2] * NdotL / this.PI
        ];

        return [diffuse, specular];
    }

    /**
     * Simple Reinhard tone mapping
     */
    _toneMap(color) {
        return [
            color[0] / (1 + color[0]),
            color[1] / (1 + color[1]),
            color[2] / (1 + color[2])
        ];
    }

    // Vector math helpers
    _normalize(v) {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
    }

    _dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    _length(v) {
        return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    }

    _addVec(a, b) {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    }

    _lerp(a, b, t) {
        return a + (b - a) * t;
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
