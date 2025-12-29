/**
 * ShadowCaster - Screen-Space Raymarched Shadows
 * 
 * Casts shadows by raymarching through the depth buffer.
 * For each pixel, we trace a ray toward the light source and check
 * if we hit any geometry along the way (indicated by depth values).
 */

export class ShadowCaster {
    constructor() {
        this.shadowCanvas = null;
    }

    /**
     * Calculate shadow map for given lights
     * 
     * @param {HTMLCanvasElement} depthMap - Depth map (brighter = farther)
     * @param {Array} lights - Array of light objects { x, y, z, intensity }
     * @param {Object} options - Shadow options
     * @returns {HTMLCanvasElement} - Shadow map (0 = full shadow, 1 = lit)
     */
    calculate(depthMap, lights, options = {}) {
        const {
            steps = 32,              // Number of raymarch steps
            stepSize = 0.015,        // Step size in normalized space
            bias = 0.002,            // Depth bias to prevent self-shadowing
            softness = 0.3,          // Shadow softness (0 = hard, 1 = very soft)
            maxShadow = 0.7,         // Maximum shadow darkness (0 = black, 1 = no shadow)
            falloff = 2.0,           // Light distance falloff
        } = options;

        const width = depthMap.width;
        const height = depthMap.height;

        console.log(`🌑 Calculating shadows: ${width}×${height}`);
        const startTime = performance.now();

        // Get depth data
        const depthCanvas = this._ensureCanvas(depthMap, width, height);
        const depthCtx = depthCanvas.getContext('2d');
        const depthData = depthCtx.getImageData(0, 0, width, height).data;

        // Create shadow map
        this.shadowCanvas = document.createElement('canvas');
        this.shadowCanvas.width = width;
        this.shadowCanvas.height = height;
        const shadowCtx = this.shadowCanvas.getContext('2d');
        const shadowData = shadowCtx.createImageData(width, height);

        // Process each pixel
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;

                // Current pixel depth
                const pixelDepth = depthData[idx] / 255;

                // Pixel position in normalized space (0-1)
                const pixelX = x / width;
                const pixelY = y / height;

                // Calculate shadow from all lights
                let totalShadow = 1.0; // Start fully lit

                for (const light of lights) {
                    // Light position in normalized space
                    const lightX = light.x / width;
                    const lightY = light.y / height;
                    const lightZ = light.z || 0.5;

                    // Direction toward light
                    const dirX = lightX - pixelX;
                    const dirY = lightY - pixelY;
                    const dirZ = lightZ - pixelDepth;

                    // Distance to light
                    const dist = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);

                    // Normalize direction
                    const len = dist + 0.0001;
                    const ndirX = dirX / len;
                    const ndirY = dirY / len;
                    const ndirZ = dirZ / len;

                    // Raymarch toward light
                    let shadow = 1.0;
                    let rayX = pixelX;
                    let rayY = pixelY;
                    let rayZ = pixelDepth;

                    for (let i = 1; i <= steps; i++) {
                        // Move along ray
                        rayX += ndirX * stepSize;
                        rayY += ndirY * stepSize;
                        rayZ += ndirZ * stepSize;

                        // Check bounds
                        if (rayX < 0 || rayX >= 1 || rayY < 0 || rayY >= 1) {
                            break; // Left screen
                        }

                        // Check if we've reached the light
                        const progress = i * stepSize / dist;
                        if (progress > 1) break;

                        // Sample depth at ray position
                        const sampleX = Math.floor(rayX * width);
                        const sampleY = Math.floor(rayY * height);
                        const sampleIdx = (sampleY * width + sampleX) * 4;
                        const sampledDepth = depthData[sampleIdx] / 255;

                        // Compare depths - if sampled surface is closer to camera
                        // than our ray, we're in shadow
                        if (sampledDepth < rayZ - bias) {
                            // Calculate soft shadow based on depth difference
                            const depthDiff = rayZ - sampledDepth;
                            const softShadow = 1.0 - Math.min(1.0, depthDiff / softness);
                            shadow = Math.min(shadow, softShadow);

                            // Early exit for hard shadows
                            if (shadow < 0.1 && softness < 0.1) break;
                        }
                    }

                    // Apply light intensity and distance falloff
                    const intensity = light.intensity || 1.0;
                    const attenuation = 1.0 / (1.0 + dist * dist * falloff);

                    // Combine shadows (multiplicative)
                    shadow = maxShadow + (1.0 - maxShadow) * shadow;
                    totalShadow *= this._lerp(1.0, shadow, intensity * attenuation);
                }

                // Clamp and store
                totalShadow = Math.max(0, Math.min(1, totalShadow));

                const v = Math.round(totalShadow * 255);
                shadowData.data[idx] = v;
                shadowData.data[idx + 1] = v;
                shadowData.data[idx + 2] = v;
                shadowData.data[idx + 3] = 255;
            }
        }

        shadowCtx.putImageData(shadowData, 0, 0);

        const elapsed = performance.now() - startTime;
        console.log(`✅ Shadows calculated (${elapsed.toFixed(0)}ms)`);

        return this.shadowCanvas;
    }

    /**
     * Calculate contact shadows (soft shadows near occlusion points)
     */
    calculateContactShadows(depthMap, options = {}) {
        const {
            radius = 5,
            strength = 0.5
        } = options;

        const width = depthMap.width;
        const height = depthMap.height;

        const depthCanvas = this._ensureCanvas(depthMap, width, height);
        const depthCtx = depthCanvas.getContext('2d');
        const depthData = depthCtx.getImageData(0, 0, width, height).data;

        const output = document.createElement('canvas');
        output.width = width;
        output.height = height;
        const outputCtx = output.getContext('2d');
        const outputData = outputCtx.createImageData(width, height);

        // For each pixel, check depth difference with neighbors
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const centerDepth = depthData[idx] / 255;

                let occlusion = 0;
                let samples = 0;

                // Sample in a disc pattern
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if (dx * dx + dy * dy > radius * radius) continue;

                        const nx = x + dx;
                        const ny = y + dy;

                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                        const nIdx = (ny * width + nx) * 4;
                        const neighborDepth = depthData[nIdx] / 255;

                        // If neighbor is closer (smaller depth), it occludes
                        if (neighborDepth < centerDepth - 0.01) {
                            const diff = centerDepth - neighborDepth;
                            occlusion += Math.min(1, diff * 10);
                        }
                        samples++;
                    }
                }

                // Average occlusion
                occlusion = samples > 0 ? occlusion / samples : 0;
                occlusion *= strength;

                const v = Math.round((1 - occlusion) * 255);
                outputData.data[idx] = v;
                outputData.data[idx + 1] = v;
                outputData.data[idx + 2] = v;
                outputData.data[idx + 3] = 255;
            }
        }

        outputCtx.putImageData(outputData, 0, 0);
        return output;
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

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    dispose() {
        this.shadowCanvas = null;
    }

    /**
     * Linear interpolation helper
     */
    _lerp(a, b, t) {
        return a + (b - a) * t;
    }
}
