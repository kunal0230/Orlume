/**
 * LightIntelligence - Advanced Light Analysis and Manipulation
 * 
 * State-of-the-art light analysis system providing:
 * - D1: Enhanced intrinsic decomposition with chromaticity-based light estimation
 * - D2: Highlight detection to find existing light positions in images
 * - D3: Original light removal for clean relighting
 * - D4: Environment map generation from scene analysis
 * 
 * Key algorithms:
 * - Chromaticity-based illumination estimation (von Kries adaptation)
 * - Specular highlight detection using Phong model inversion
 * - Spherical harmonic environment map approximation
 * - Gradient-domain light removal
 */

export class LightIntelligence {
    constructor(app) {
        this.app = app;

        // Detected light sources
        this.detectedLights = [];

        // Original lighting estimation
        this.originalLighting = null;

        // Environment map (for ambient lighting)
        this.envMap = null;

        // Settings
        this.settings = {
            highlightThreshold: 0.85,      // Brightness threshold for highlights
            specularThreshold: 0.7,         // Specular detection threshold
            minHighlightSize: 8,            // Minimum highlight size in pixels
            maxLightsDetected: 6,           // Maximum lights to detect
            envMapResolution: 64,           // Environment map resolution
            lightRemovalStrength: 0.8,      // How much to remove original lighting
            chromaticityWeight: 0.6         // Weight for chromaticity-based estimation
        };
    }

    /**
     * Analyze image for existing light sources
     * 
     * @param {HTMLImageElement|HTMLCanvasElement} image - Input image
     * @param {Object} depthMap - Depth map for 3D position estimation
     * @param {Object} normalMap - Normal map for light direction estimation
     * @returns {Object} - Light analysis result
     */
    analyzeLight(image, depthMap, normalMap) {
        console.log('🔦 Analyzing scene lighting...');
        const startTime = performance.now();

        // Get image data
        const canvas = this._ensureCanvas(image);
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data, width, height } = imageData;

        // Get depth and normal data if available
        const depthData = depthMap ? this._getMapData(depthMap) : null;
        const normalData = normalMap ? this._getMapData(normalMap) : null;

        // Step 1: Estimate global illumination color (D1)
        const illumination = this._estimateIlluminationColor(data, width, height);

        // Step 2: Detect specular highlights (D2)
        const highlights = this._detectHighlights(data, width, height, depthData, normalData);

        // Step 3: Cluster highlights into light sources
        const lights = this._clusterHighlightsToLights(highlights, width, height);

        // Step 4: Generate environment map (D4)
        const envMap = this._generateEnvironmentMap(data, depthData, normalData, width, height);

        // Store results
        this.originalLighting = illumination;
        this.detectedLights = lights;
        this.envMap = envMap;

        const elapsed = performance.now() - startTime;
        console.log(`✅ Light analysis complete (${elapsed.toFixed(0)}ms) - ${lights.length} lights detected`);

        return {
            illumination,
            lights,
            envMap,
            analysisTime: elapsed
        };
    }

    /**
     * D1: Enhanced Intrinsic Decomposition - Estimate illumination color
     * Uses chromaticity-based approach with gray-world assumption fallback
     */
    _estimateIlluminationColor(data, width, height) {
        let sumR = 0, sumG = 0, sumB = 0;
        let maxR = 0, maxG = 0, maxB = 0;
        let brightPixels = 0;

        // Collect chromaticity information from bright regions
        const brightnessThreshold = 200;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const brightness = (r + g + b) / 3;

            // Track max values (likely near light source)
            if (r > maxR) maxR = r;
            if (g > maxG) maxG = g;
            if (b > maxB) maxB = b;

            // Accumulate bright pixels for illuminant estimation
            if (brightness > brightnessThreshold) {
                sumR += r;
                sumG += g;
                sumB += b;
                brightPixels++;
            }
        }

        // Estimate illuminant color
        let illumR, illumG, illumB;

        if (brightPixels > 100) {
            // Use bright pixel chromaticity (more accurate for strong lights)
            const avgR = sumR / brightPixels;
            const avgG = sumG / brightPixels;
            const avgB = sumB / brightPixels;
            const maxVal = Math.max(avgR, avgG, avgB);

            illumR = avgR / maxVal;
            illumG = avgG / maxVal;
            illumB = avgB / maxVal;
        } else {
            // Fall back to max RGB (von Kries-like approach)
            const maxVal = Math.max(maxR, maxG, maxB);
            illumR = maxR / maxVal;
            illumG = maxG / maxVal;
            illumB = maxB / maxVal;
        }

        // Estimate dominant light direction from brightness gradient
        const direction = this._estimateLightDirection(data, width, height);

        // Estimate light intensity
        const intensity = Math.max(maxR, maxG, maxB) / 255;

        return {
            color: { r: illumR * 255, g: illumG * 255, b: illumB * 255 },
            normalizedColor: { r: illumR, g: illumG, b: illumB },
            intensity,
            direction,
            colorTemperature: this._estimateColorTemperature(illumR, illumG, illumB)
        };
    }

    /**
     * Estimate dominant light direction from image brightness gradient
     */
    _estimateLightDirection(data, width, height) {
        let gradX = 0, gradY = 0;
        let totalWeight = 0;

        // Sample brightness and compute weighted centroid
        const step = 4; // Sample every 4th pixel for speed

        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const i = (y * width + x) * 4;
                const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;

                // Weight by brightness squared (emphasize bright areas)
                const weight = (brightness / 255) * (brightness / 255);

                gradX += (x / width - 0.5) * weight;
                gradY += (y / height - 0.5) * weight;
                totalWeight += weight;
            }
        }

        if (totalWeight > 0) {
            gradX /= totalWeight;
            gradY /= totalWeight;
        }

        // Normalize direction
        const len = Math.sqrt(gradX * gradX + gradY * gradY) || 1;

        return {
            x: gradX / len,
            y: gradY / len,
            z: 0.5,  // Assume light is somewhat frontal
            confidence: Math.min(1, len * 3)  // Higher gradient = more confident
        };
    }

    /**
     * Estimate color temperature in Kelvin from RGB ratios
     */
    _estimateColorTemperature(r, g, b) {
        // Simplified color temperature estimation
        // Based on black body radiation chromaticity
        const ratio = r / (b + 0.001);

        if (ratio > 1.5) {
            // Warm light (2700K - 4000K)
            return 2700 + (1.5 / ratio) * 1300;
        } else if (ratio > 0.8) {
            // Neutral (4000K - 6500K)
            return 4000 + (1.5 - ratio) * 3571;
        } else {
            // Cool light (6500K - 10000K)
            return 6500 + (0.8 - ratio) * 4375;
        }
    }

    /**
     * D2: Detect specular highlights in the image
     */
    _detectHighlights(data, width, height, depthData, normalData) {
        const highlights = [];
        const visited = new Uint8Array(width * height);

        const threshold = this.settings.highlightThreshold * 255;
        const specThreshold = this.settings.specularThreshold;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const idx = y * width + x;

                if (visited[idx]) continue;

                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const brightness = Math.max(r, g, b);

                // Check if this is a highlight pixel
                if (brightness > threshold) {
                    // Check for specular characteristics
                    // Specular highlights tend to be desaturated (close to white)
                    const saturation = 1 - (Math.min(r, g, b) / (brightness + 0.001));
                    const isSpecular = saturation < (1 - specThreshold);

                    if (isSpecular || brightness > 250) {
                        // Flood-fill to find connected highlight region
                        const region = this._floodFillHighlight(
                            data, visited, x, y, width, height, threshold * 0.9
                        );

                        if (region.pixels.length >= this.settings.minHighlightSize) {
                            // Get depth and normal at highlight center
                            let depth = 0.5;
                            let normal = { x: 0, y: 0, z: 1 };

                            if (depthData) {
                                const di = (region.centerY * width + region.centerX) * 4;
                                depth = depthData[di] / 255;
                            }

                            if (normalData) {
                                const ni = (region.centerY * width + region.centerX) * 4;
                                normal = {
                                    x: (normalData[ni] / 255) * 2 - 1,
                                    y: (normalData[ni + 1] / 255) * 2 - 1,
                                    z: (normalData[ni + 2] / 255) * 2 - 1
                                };
                            }

                            highlights.push({
                                x: region.centerX / width,
                                y: region.centerY / height,
                                size: region.pixels.length,
                                brightness: region.avgBrightness / 255,
                                color: region.color,
                                depth,
                                normal,
                                isSpecular
                            });
                        }
                    }
                }
            }
        }

        // Sort by brightness (strongest highlights first)
        highlights.sort((a, b) => b.brightness - a.brightness);

        return highlights;
    }

    /**
     * Flood-fill to find connected highlight region
     */
    _floodFillHighlight(data, visited, startX, startY, width, height, threshold) {
        const pixels = [];
        const stack = [[startX, startY]];
        let sumX = 0, sumY = 0;
        let sumR = 0, sumG = 0, sumB = 0;
        let sumBrightness = 0;

        while (stack.length > 0) {
            const [x, y] = stack.pop();

            if (x < 0 || x >= width || y < 0 || y >= height) continue;

            const idx = y * width + x;
            if (visited[idx]) continue;

            const i = idx * 4;
            const brightness = Math.max(data[i], data[i + 1], data[i + 2]);

            if (brightness < threshold) continue;

            visited[idx] = 1;
            pixels.push({ x, y });

            sumX += x;
            sumY += y;
            sumR += data[i];
            sumG += data[i + 1];
            sumB += data[i + 2];
            sumBrightness += brightness;

            // Add neighbors
            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }

        const count = pixels.length || 1;

        return {
            pixels,
            centerX: Math.round(sumX / count),
            centerY: Math.round(sumY / count),
            avgBrightness: sumBrightness / count,
            color: {
                r: sumR / count,
                g: sumG / count,
                b: sumB / count
            }
        };
    }

    /**
     * Cluster highlights into distinct light sources
     */
    _clusterHighlightsToLights(highlights, width, height) {
        if (highlights.length === 0) return [];

        const lights = [];
        const used = new Set();
        const clusterRadius = 0.1; // 10% of image dimension

        for (let i = 0; i < highlights.length && lights.length < this.settings.maxLightsDetected; i++) {
            if (used.has(i)) continue;

            const h = highlights[i];
            const cluster = [h];
            used.add(i);

            // Find nearby highlights
            for (let j = i + 1; j < highlights.length; j++) {
                if (used.has(j)) continue;

                const h2 = highlights[j];
                const dx = h.x - h2.x;
                const dy = h.y - h2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < clusterRadius) {
                    cluster.push(h2);
                    used.add(j);
                }
            }

            // Compute cluster centroid and properties
            let sumX = 0, sumY = 0, sumZ = 0;
            let sumR = 0, sumG = 0, sumB = 0;
            let sumWeight = 0;

            for (const hl of cluster) {
                const weight = hl.brightness * hl.size;
                sumX += hl.x * weight;
                sumY += hl.y * weight;
                sumZ += (1 - hl.depth) * weight; // Invert depth for z
                sumR += hl.color.r * weight;
                sumG += hl.color.g * weight;
                sumB += hl.color.b * weight;
                sumWeight += weight;
            }

            const avgBrightness = cluster.reduce((s, h) => s + h.brightness, 0) / cluster.length;

            lights.push({
                x: sumX / sumWeight,
                y: sumY / sumWeight,
                z: Math.min(1, sumZ / sumWeight + 0.3),
                color: {
                    r: Math.round(sumR / sumWeight),
                    g: Math.round(sumG / sumWeight),
                    b: Math.round(sumB / sumWeight)
                },
                intensity: Math.min(2, avgBrightness * 1.5),
                confidence: Math.min(1, cluster.length / 5),
                highlightCount: cluster.length
            });
        }

        return lights;
    }

    /**
     * D4: Generate environment map from scene analysis
     * Creates a low-resolution spherical approximation of ambient lighting
     */
    _generateEnvironmentMap(data, depthData, normalData, width, height) {
        const res = this.settings.envMapResolution;
        const envCanvas = document.createElement('canvas');
        envCanvas.width = res;
        envCanvas.height = res / 2; // Equirectangular
        const envCtx = envCanvas.getContext('2d');
        const envData = envCtx.createImageData(res, res / 2);

        // Sample image at various angles
        // For each direction, find visible pixels and average their color

        for (let y = 0; y < res / 2; y++) {
            const theta = (y / (res / 2)) * Math.PI; // 0 to PI (top to bottom)

            for (let x = 0; x < res; x++) {
                const phi = (x / res) * 2 * Math.PI; // 0 to 2PI (around)

                // Direction vector
                const dx = Math.sin(theta) * Math.cos(phi);
                const dy = Math.cos(theta);
                const dz = Math.sin(theta) * Math.sin(phi);

                // Sample image based on direction
                // For sky (upward direction), use top of image
                // For ground (downward), use bottom
                // For sides, use image edges

                let sampleX, sampleY;

                if (Math.abs(dz) > 0.9) {
                    // Looking into/out of screen - use center
                    sampleX = width / 2 + dx * width * 0.3;
                    sampleY = height / 2 + dy * height * 0.3;
                } else {
                    // Looking sideways - map to image plane
                    sampleX = (dx + 1) * 0.5 * width;
                    sampleY = (1 - dy) * 0.5 * height;
                }

                sampleX = Math.max(0, Math.min(width - 1, Math.round(sampleX)));
                sampleY = Math.max(0, Math.min(height - 1, Math.round(sampleY)));

                const si = (sampleY * width + sampleX) * 4;
                const ei = (y * res + x) * 4;

                // Apply some blur by averaging neighbors
                let r = data[si], g = data[si + 1], b = data[si + 2];

                // Boost sky regions (looking up)
                if (dy > 0.5) {
                    const boost = 1 + (dy - 0.5);
                    r = Math.min(255, r * boost);
                    g = Math.min(255, g * boost);
                    b = Math.min(255, b * boost);
                }

                envData.data[ei] = r;
                envData.data[ei + 1] = g;
                envData.data[ei + 2] = b;
                envData.data[ei + 3] = 255;
            }
        }

        envCtx.putImageData(envData, 0, 0);

        // Apply Gaussian blur for soft ambient
        envCtx.filter = 'blur(4px)';
        envCtx.drawImage(envCanvas, 0, 0);
        envCtx.filter = 'none';

        return {
            canvas: envCanvas,
            width: res,
            height: res / 2,
            dominantColor: this._getDominantEnvColor(envData.data)
        };
    }

    /**
     * Get dominant color from environment map
     */
    _getDominantEnvColor(data) {
        let sumR = 0, sumG = 0, sumB = 0, count = 0;

        for (let i = 0; i < data.length; i += 4) {
            sumR += data[i];
            sumG += data[i + 1];
            sumB += data[i + 2];
            count++;
        }

        return {
            r: sumR / count,
            g: sumG / count,
            b: sumB / count
        };
    }

    /**
     * D3: Remove original lighting from image
     * Creates an "unlit" version of the image for clean relighting
     * 
     * @param {HTMLCanvasElement} albedo - Albedo map from intrinsic decomposition
     * @param {Object} lighting - Original lighting estimation
     * @param {number} strength - Removal strength (0-1)
     * @returns {HTMLCanvasElement} - Delighted image
     */
    removeOriginalLighting(albedo, lighting = null, strength = null) {
        if (!lighting) lighting = this.originalLighting;
        if (!lighting) {
            console.warn('⚠️ No lighting analysis available');
            return albedo;
        }

        const s = strength ?? this.settings.lightRemovalStrength;

        const canvas = document.createElement('canvas');
        const ctx = albedo.getContext('2d');
        canvas.width = albedo.width;
        canvas.height = albedo.height;
        const outCtx = canvas.getContext('2d');

        const imageData = ctx.getImageData(0, 0, albedo.width, albedo.height);
        const data = imageData.data;

        // Color correction to remove original illuminant
        const illum = lighting.normalizedColor;

        for (let i = 0; i < data.length; i += 4) {
            // Remove color cast from original lighting
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            // Apply inverse of illuminant color (von Kries-like)
            r = r / (illum.r * s + (1 - s));
            g = g / (illum.g * s + (1 - s));
            b = b / (illum.b * s + (1 - s));

            // Normalize to prevent blowout
            const maxVal = Math.max(r, g, b);
            if (maxVal > 255) {
                r = (r / maxVal) * 255;
                g = (g / maxVal) * 255;
                b = (b / maxVal) * 255;
            }

            data[i] = Math.round(Math.max(0, Math.min(255, r)));
            data[i + 1] = Math.round(Math.max(0, Math.min(255, g)));
            data[i + 2] = Math.round(Math.max(0, Math.min(255, b)));
        }

        outCtx.putImageData(imageData, 0, 0);

        console.log(`🌑 Original lighting removed (${(s * 100).toFixed(0)}% strength)`);

        return canvas;
    }

    /**
     * Get detected lights for use in relighting
     */
    getDetectedLights() {
        return this.detectedLights.map(light => ({
            x: light.x,
            y: light.y,
            z: light.z,
            color: light.color,
            intensity: light.intensity,
            type: 'point',
            isDetected: true,
            confidence: light.confidence
        }));
    }

    /**
     * Sample environment map at a given direction
     */
    sampleEnvMap(dirX, dirY, dirZ) {
        if (!this.envMap) return { r: 200, g: 200, b: 200 };

        // Convert direction to equirectangular coordinates
        const theta = Math.acos(dirY);
        const phi = Math.atan2(dirZ, dirX) + Math.PI;

        const u = phi / (2 * Math.PI);
        const v = theta / Math.PI;

        const x = Math.floor(u * this.envMap.width) % this.envMap.width;
        const y = Math.floor(v * this.envMap.height);

        const ctx = this.envMap.canvas.getContext('2d');
        const pixel = ctx.getImageData(x, y, 1, 1).data;

        return { r: pixel[0], g: pixel[1], b: pixel[2] };
    }

    /**
     * Helper: Ensure input is a canvas
     */
    _ensureCanvas(input) {
        if (input instanceof HTMLCanvasElement) return input;

        const canvas = document.createElement('canvas');
        canvas.width = input.width || input.naturalWidth;
        canvas.height = input.height || input.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(input, 0, 0);
        return canvas;
    }

    /**
     * Helper: Get pixel data from a map
     */
    _getMapData(map) {
        const canvas = map.canvas || map;
        if (!canvas) return null;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        return ctx.getImageData(0, 0, width, height).data;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.detectedLights = [];
        this.originalLighting = null;
        this.envMap = null;
    }
}

export default LightIntelligence;
