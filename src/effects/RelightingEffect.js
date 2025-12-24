/**
 * Relighting Effect - Advanced
 * Realistic lighting with proper directional shadows, draggable and deletable lights
 */

export class RelightingEffect {
    constructor(app) {
        this.app = app;
        this.enabled = false;

        this.lights = [];
        this.intensity = 1.5;
        this.color = '#ffffff';
        this.ambient = 0.8;  // High ambient = preserve original brightness
        this.shadowStrength = 0.5;  // Softer shadows
        this.shadowSoftness = 3;
        this.brightness = 1.0;
        this.lightSoftness = 0.3;  // Softens light falloff and shadows
        this.colorTemperature = 5500;  // Kelvin (2700 warm - 10000 cool)

        // Flat profile settings
        this.flatProfileEnabled = false;
        this.flatStrength = 0.5;

        // Light mode: 'point' or 'directional'
        this.mode = 'point';

        this.canvas = null;
        this.ctx = null;
        this.normalMap = null;
        this.shadowMap = null;

        // Drag state
        this.isDragging = false;
        this.draggedLight = null;
        this.hoveredLight = null;

        // Directional light drag state
        this.directionalDragStart = null;

        // Render scheduling for performance
        this.renderPending = false;
        this.lastRenderTime = 0;
        this.minRenderInterval = 16; // ~60fps for preview

        // Performance: half-res preview during interaction
        this.isInteracting = false;
        this.previewScale = 0.5; // Render at 50% during drag/slider
        this.previewCanvas = null;
        this.previewCtx = null;

        // Cache shadow maps (expensive to compute)
        this.cachedShadowMaps = null;
        this.shadowMapsDirty = true;

        // Bind event handlers
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onContextMenu = this.onContextMenu.bind(this);
        this.onDoubleClick = this.onDoubleClick.bind(this);
        this.actualRender = this.actualRender.bind(this);
    }

    // Mark shadow maps as needing recalculation
    invalidateShadowMaps() {
        this.shadowMapsDirty = true;
    }

    // Debounced render - schedules render on next frame if not already pending
    render(forceFullQuality = false) {
        if (this.renderPending) return;

        const now = performance.now();
        const timeSinceLastRender = now - this.lastRenderTime;
        const interval = this.isInteracting ? 16 : this.minRenderInterval;

        if (timeSinceLastRender < interval) {
            // Throttle: schedule for later
            this.renderPending = true;
            setTimeout(() => {
                this.renderPending = false;
                this.actualRender({ forceFullQuality });
            }, interval - timeSinceLastRender);
        } else {
            // Immediate render with RAF
            this.renderPending = true;
            requestAnimationFrame(() => {
                this.renderPending = false;
                this.actualRender({ forceFullQuality });
            });
        }
    }

    getExportCanvas() {
        if (!this.enabled || !this.ctx) return null;

        // Synchronously render full quality without indicators
        this.actualRender({ forceFullQuality: true, skipIndicators: true });
        return this.canvas;
    }

    enable() {
        if (this.enabled) return;

        const { depthMap } = this.app.state;
        if (!depthMap) return;

        this.enabled = true;

        // Generate high-quality normal map from depth
        this.normalMap = this.generateEnhancedNormalMap(depthMap);

        // Setup relighting canvas
        const mainCanvas = document.getElementById('main-canvas');
        const container = document.querySelector('.editor-canvas');

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'relight-canvas';
        this.canvas.width = this.app.state.image.width;
        this.canvas.height = this.app.state.image.height;
        this.canvas.style.cssText = `
      position: absolute;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      z-index: 5;
      cursor: crosshair;
    `;
        this.canvas.style.width = mainCanvas.style.width;
        this.canvas.style.height = mainCanvas.style.height;

        this.ctx = this.canvas.getContext('2d');
        container.appendChild(this.canvas);

        // Hide other canvases
        mainCanvas.style.opacity = '0';
        document.getElementById('depth-canvas').style.opacity = '0';

        // Bind mouse events for drag and delete
        this.canvas.addEventListener('mousedown', this.onMouseDown);
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mouseup', this.onMouseUp);
        this.canvas.addEventListener('mouseleave', this.onMouseUp);
        this.canvas.addEventListener('contextmenu', this.onContextMenu);
        this.canvas.addEventListener('dblclick', this.onDoubleClick);

        // Initial render
        this.render();
    }

    updateCanvasSize() {
        if (!this.canvas) return;

        const mainCanvas = document.getElementById('main-canvas');
        if (mainCanvas) {
            this.canvas.style.width = mainCanvas.style.width;
            this.canvas.style.height = mainCanvas.style.height;
        }
    }

    disable() {
        this.enabled = false;

        if (this.canvas) {
            this.canvas.removeEventListener('mousedown', this.onMouseDown);
            this.canvas.removeEventListener('mousemove', this.onMouseMove);
            this.canvas.removeEventListener('mouseup', this.onMouseUp);
            this.canvas.removeEventListener('mouseleave', this.onMouseUp);
            this.canvas.removeEventListener('contextmenu', this.onContextMenu);
            this.canvas.removeEventListener('dblclick', this.onDoubleClick);
            this.canvas.remove();
            this.canvas = null;
            this.ctx = null;
        }

        // Restore main canvas
        const mainCanvas = document.getElementById('main-canvas');
        if (mainCanvas) {
            mainCanvas.style.opacity = '1';
        }
    }

    generateEnhancedNormalMap(depthMap) {
        const { width, height, data } = depthMap;
        const normalData = new Uint8ClampedArray(width * height * 4);

        // Sobel operator for better edge detection
        const sobelScale = 3.0;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;

                // Sample neighbors
                const getDepth = (ox, oy) => {
                    const i = ((y + oy) * width + (x + ox)) * 4;
                    return data[i] / 255;
                };

                // Sobel X
                const dX = (
                    -getDepth(-1, -1) + getDepth(1, -1) +
                    -2 * getDepth(-1, 0) + 2 * getDepth(1, 0) +
                    -getDepth(-1, 1) + getDepth(1, 1)
                ) / 4;

                // Sobel Y
                const dY = (
                    -getDepth(-1, -1) - 2 * getDepth(0, -1) - getDepth(1, -1) +
                    getDepth(-1, 1) + 2 * getDepth(0, 1) + getDepth(1, 1)
                ) / 4;

                // Calculate normal
                const nx = -dX * sobelScale;
                const ny = -dY * sobelScale;
                const nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

                // Encode to 0-255
                normalData[idx] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
                normalData[idx + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
                normalData[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
                normalData[idx + 3] = 255;
            }
        }

        return { width, height, data: normalData };
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    }

    findLightAtPosition(pos, threshold = 0.04) {
        for (let i = this.lights.length - 1; i >= 0; i--) {
            const light = this.lights[i];
            const dx = light.x - pos.x;
            const dy = light.y - pos.y;
            if (Math.sqrt(dx * dx + dy * dy) < threshold) {
                return { light, index: i };
            }
        }
        return null;
    }

    onMouseDown(e) {
        if (e.button !== 0) return;

        const pos = this.getMousePos(e);

        if (this.mode === 'directional') {
            // Start directional drag
            this.directionalDragStart = pos;
            this.canvas.style.cursor = 'crosshair';
            return;
        }

        // Point light mode
        const found = this.findLightAtPosition(pos);

        if (found) {
            // Start dragging existing light
            this.isDragging = true;
            this.draggedLight = found.light;
            this.isInteracting = true;
            this.canvas.style.cursor = 'grabbing';
        } else {
            // Add new point light
            this.lights.push({
                id: Date.now(),
                type: 'point',
                x: pos.x,
                y: pos.y,
                z: 0.5,
                color: this.hexToRgb(this.color),
                intensity: this.intensity
            });
            this.invalidateShadowMaps();
            this.render();
        }
    }

    onMouseMove(e) {
        const pos = this.getMousePos(e);

        if (this.mode === 'directional' && this.directionalDragStart) {
            // Show preview line while dragging
            this.render();
            this.drawDirectionalPreview(this.directionalDragStart, pos);
            return;
        }

        if (this.isDragging && this.draggedLight) {
            // Update light position
            this.draggedLight.x = Math.max(0, Math.min(1, pos.x));
            this.draggedLight.y = Math.max(0, Math.min(1, pos.y));
            this.render();
        } else {
            // Check for hover
            const found = this.findLightAtPosition(pos);
            this.hoveredLight = found ? found.light : null;
            this.canvas.style.cursor = found ? 'grab' : 'crosshair';
        }
    }

    onMouseUp(e) {
        if (this.mode === 'directional' && this.directionalDragStart) {
            const pos = this.getMousePos(e);
            const dx = pos.x - this.directionalDragStart.x;
            const dy = pos.y - this.directionalDragStart.y;
            const len = Math.sqrt(dx * dx + dy * dy);

            if (len > 0.02) { // Minimum drag distance
                // Calculate direction vector (normalized)
                const dirX = dx / len;
                const dirY = dy / len;

                this.lights.push({
                    id: Date.now(),
                    type: 'directional',
                    dirX: dirX,
                    dirY: dirY,
                    startX: this.directionalDragStart.x,
                    startY: this.directionalDragStart.y,
                    endX: pos.x,
                    endY: pos.y,
                    color: this.hexToRgb(this.color),
                    intensity: this.intensity
                });
                this.invalidateShadowMaps();
                this.render(true); // Full quality
            }
            this.directionalDragStart = null;
            return;
        }

        // End interaction - render at full quality
        if (this.isInteracting) {
            this.isInteracting = false;
            this.invalidateShadowMaps(); // Light position changed
            this.render(true); // Force full quality render
        }

        this.isDragging = false;
        this.draggedLight = null;
        this.canvas.style.cursor = this.hoveredLight ? 'grab' : 'crosshair';
    }

    drawDirectionalPreview(start, end) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.beginPath();
        ctx.moveTo(start.x * w, start.y * h);
        ctx.lineTo(end.x * w, end.y * h);
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Arrow head
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 15;
        ctx.beginPath();
        ctx.moveTo(end.x * w, end.y * h);
        ctx.lineTo(
            end.x * w - headLen * Math.cos(angle - Math.PI / 6),
            end.y * h - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(end.x * w, end.y * h);
        ctx.lineTo(
            end.x * w - headLen * Math.cos(angle + Math.PI / 6),
            end.y * h - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
    }

    onContextMenu(e) {
        e.preventDefault();

        const pos = this.getMousePos(e);
        const found = this.findLightAtPosition(pos);

        if (found) {
            this.lights.splice(found.index, 1);
            this.hoveredLight = null;
            this.canvas.style.cursor = 'crosshair';
            this.render();
        }
    }

    onDoubleClick(e) {
        const pos = this.getMousePos(e);
        const found = this.findLightAtPosition(pos);

        if (found) {
            this.lights.splice(found.index, 1);
            this.hoveredLight = null;
            this.render();
        }
    }

    computeShadowMap(light, depthData, width, height) {
        const shadowMap = new Float32Array(width * height);

        // For directional lights, use uniform direction to source
        const isDirectional = light.type === 'directional';
        // Direction opposite to light direction (shadow cast direction)
        const dirStepX = isDirectional ? -light.dirX : 0;
        const dirStepY = isDirectional ? -light.dirY : 0;

        const lightX = isDirectional ? 0 : light.x * width;
        const lightY = isDirectional ? 0 : light.y * height;

        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const idx = py * width + px;
                const currentDepth = depthData[idx * 4] / 255;

                let stepX, stepY, maxSteps;

                if (isDirectional) {
                    // Uniform direction (opposite to light direction)
                    stepX = dirStepX;
                    stepY = dirStepY;
                    maxSteps = 80; // Fixed ray length
                } else {
                    // Direction to point light
                    const dx = lightX - px;
                    const dy = lightY - py;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 3) continue;

                    stepX = dx / dist;
                    stepY = dy / dist;
                    maxSteps = Math.min(dist * 0.7, 60);
                }

                let shadow = 0;

                // Ray march toward light source
                for (let step = 2; step < maxSteps; step += 1.5) {
                    const sampleX = Math.floor(px + stepX * step);
                    const sampleY = Math.floor(py + stepY * step);

                    if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) break;

                    const sampleIdx = (sampleY * width + sampleX) * 4;
                    const sampleDepth = depthData[sampleIdx] / 255;

                    // Check if occluded
                    const depthDiff = sampleDepth - currentDepth;
                    if (depthDiff > 0.02) {
                        const occlusionStrength = Math.min(1, depthDiff * 12);
                        shadow = Math.max(shadow, occlusionStrength * (1 - step / maxSteps));
                    }
                }

                shadowMap[idx] = shadow;
            }
        }

        // Blur for softness
        return this.blurShadowMap(shadowMap, width, height);
    }

    blurShadowMap(shadowMap, width, height) {
        const blurred = new Float32Array(shadowMap.length);
        const radius = this.shadowSoftness;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                let count = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const sx = x + dx;
                        const sy = y + dy;

                        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                            sum += shadowMap[sy * width + sx];
                            count++;
                        }
                    }
                }

                blurred[y * width + x] = sum / count;
            }
        }

        return blurred;
    }

    actualRender(options = {}) {
        if (!this.enabled || !this.ctx) return;

        this.lastRenderTime = performance.now();

        const { image, depthMap } = this.app.state;
        const { width, height } = image;

        // Handle options (legacy support for boolean)
        let forceFullQuality = false;
        let skipIndicators = false;

        if (typeof options === 'boolean') {
            forceFullQuality = options;
        } else {
            forceFullQuality = options.forceFullQuality || false;
            skipIndicators = options.skipIndicators || false;
        }

        // Performance: Use half-resolution during interaction
        const usePreview = this.isInteracting && !forceFullQuality;
        const scale = usePreview ? this.previewScale : 1.0;
        const renderWidth = Math.floor(width * scale);
        const renderHeight = Math.floor(height * scale);

        const originalData = image.imageData.data;
        const normalData = this.normalMap.data;
        const depthData = depthMap.data;

        // If no lights, show image with flat profile applied (if enabled)
        if (this.lights.length === 0) {
            // Fast path: just apply brightness/flat to original
            const outputData = new Uint8ClampedArray(originalData.length);
            for (let i = 0; i < originalData.length; i += 4) {
                const flat = this.applyFlatProfile(originalData[i], originalData[i + 1], originalData[i + 2]);
                outputData[i] = Math.min(255, flat.r * this.brightness);
                outputData[i + 1] = Math.min(255, flat.g * this.brightness);
                outputData[i + 2] = Math.min(255, flat.b * this.brightness);
                outputData[i + 3] = originalData[i + 3];
            }

            const imageData = new ImageData(outputData, width, height);
            this.ctx.putImageData(imageData, 0, 0);

            if (!skipIndicators) {
                this.ctx.font = 'bold 16px Inter, sans-serif';
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                this.ctx.textAlign = 'center';
                this.ctx.shadowColor = 'rgba(0,0,0,0.8)';
                this.ctx.shadowBlur = 4;
                this.ctx.fillText('Click anywhere to place a light', width / 2, 40);
                this.ctx.shadowBlur = 0;
            }
            return;
        }

        // Use cached shadow maps if available and not dirty
        let shadowMaps;
        if (!this.shadowMapsDirty && this.cachedShadowMaps &&
            this.cachedShadowMaps.length === this.lights.length) {
            shadowMaps = this.cachedShadowMaps;
        } else {
            // Compute shadow maps (expensive - cache them)
            shadowMaps = this.lights.map(light =>
                this.computeShadowMap(light, depthData, width, height)
            );
            this.cachedShadowMaps = shadowMaps;
            this.shadowMapsDirty = false;
        }

        // Create output buffer (full size - we'll skip pixels for preview)
        const outputData = new Uint8ClampedArray(originalData.length);

        // Pixel skip for preview mode (process every Nth pixel, fill neighbors)
        const pixelStride = usePreview ? 2 : 1;

        // Apply lighting with optional pixel skipping
        for (let py = 0; py < height; py += pixelStride) {
            for (let px = 0; px < width; px += pixelStride) {
                const pixelIndex = py * width + px;
                const i = pixelIndex * 4;
                const pxNorm = px / width;
                const pyNorm = py / height;

                // Get normal (decode from 0-255 to -1 to 1)
                const nx = (normalData[i] / 255) * 2 - 1;
                const ny = (normalData[i + 1] / 255) * 2 - 1;
                const nz = (normalData[i + 2] / 255) * 2 - 1;

                // Get depth
                const pixelDepth = depthData[i] / 255;

                // View direction (camera looking at screen)
                const vx = 0, vy = 0, vz = 1;

                // Accumulate lighting
                let diffuseLight = 0;
                let specularLight = 0;

                for (let li = 0; li < this.lights.length; li++) {
                    const light = this.lights[li];

                    let ldx, ldy, ldz, attenuation;

                    if (light.type === 'directional') {
                        // Directional light: uniform direction, no attenuation
                        ldx = light.dirX;
                        ldy = light.dirY;
                        ldz = 0.5; // Slightly elevated
                        attenuation = 1.0; // No falloff
                    } else {
                        // Point light: direction from pixel to light, with attenuation
                        const lx = light.x - pxNorm;
                        const ly = light.y - pyNorm;
                        const lz = light.z || 0.5;

                        const lightDist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                        ldx = lx / lightDist;
                        ldy = ly / lightDist;
                        ldz = lz / lightDist;

                        attenuation = 1 / (1 + lightDist * lightDist * 4);
                    }

                    // Normalize directional vector
                    const dirLen = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz);
                    ldx /= dirLen;
                    ldy /= dirLen;
                    ldz /= dirLen;

                    // Diffuse (N dot L)
                    const NdotL = Math.max(0, nx * ldx + ny * ldy + nz * ldz);

                    // Blinn-Phong specular
                    const halfX = ldx + vx, halfY = ldy + vy, halfZ = ldz + vz;
                    const halfLen = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ);
                    const hx = halfX / halfLen, hy = halfY / halfLen, hz = halfZ / halfLen;
                    const NdotH = Math.max(0, nx * hx + ny * hy + nz * hz);
                    const specular = Math.pow(NdotH, 32) * 0.3;

                    // Shadow
                    const shadow = 1 - shadowMaps[li][pixelIndex] * this.shadowStrength;

                    // Combine
                    const contribution = attenuation * light.intensity * shadow;
                    diffuseLight += NdotL * contribution;
                    specularLight += specular * contribution;
                }

                // NATURAL LIGHTING WITH SHADOWS
                // - Light enhances original colors (not just white overlay)
                // - Uses light color for tinting
                // - Shadows darken occluded areas

                const bright = this.brightness;

                // Shadow: only apply where there's actual occlusion
                let maxShadow = 0;
                for (let li = 0; li < this.lights.length; li++) {
                    maxShadow = Math.max(maxShadow, shadowMaps[li][pixelIndex]);
                }
                const shadowDarken = maxShadow * this.shadowStrength * 0.6;

                // Apply flat profile to original pixel values
                const flat = this.applyFlatProfile(originalData[i], originalData[i + 1], originalData[i + 2]);

                // Calculate colored light contribution from all lights
                let lightR = 0, lightG = 0, lightB = 0;
                for (let li = 0; li < this.lights.length; li++) {
                    const light = this.lights[li];
                    const shadow = 1 - shadowMaps[li][pixelIndex] * this.shadowStrength;

                    // Get light direction and attenuation
                    let attenuation = 1.0;
                    let NdotL = 0;

                    if (light.type === 'directional') {
                        const ldx = light.dirX, ldy = light.dirY, ldz = 0.5;
                        const len = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz);
                        NdotL = Math.max(0, nx * ldx / len + ny * ldy / len + nz * ldz / len);
                    } else {
                        const lx = light.x - pxNorm, ly = light.y - pyNorm, lz = 0.5;
                        const dist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                        const ldx = lx / dist, ldy = ly / dist, ldz = lz / dist;
                        NdotL = Math.max(0, nx * ldx + ny * ldy + nz * ldz);
                        attenuation = 1 / (1 + dist * dist * 3);
                    }

                    // Natural light contribution with color
                    const intensity = NdotL * attenuation * light.intensity * shadow * 0.4;
                    lightR += intensity * (light.color.r / 255);
                    lightG += intensity * (light.color.g / 255);
                    lightB += intensity * (light.color.b / 255);
                }

                // EXPOSURE-BASED LIGHTING (instead of brightness-based)
                // Exposure affects all tones multiplicatively, highlights most affected
                // Like changing camera shutter speed - more natural light falloff

                // Calculate exposure multiplier for each channel
                // Formula: 2^(exposure_stops) where 0 = no change, 1 = double, -1 = half
                const exposureR = Math.pow(2, lightR * 2); // Light intensity -> exposure stops
                const exposureG = Math.pow(2, lightG * 2);
                const exposureB = Math.pow(2, lightB * 2);

                // Apply shadow darkening
                const shadowMultiplier = 1 - shadowDarken;

                // Final: multiply original by exposure (highlights affected most)
                // Apply soft highlight compression to prevent pure white blow-out
                const compressHighlight = (val) => {
                    // Soft knee compression above 200
                    if (val > 200) {
                        const excess = val - 200;
                        return 200 + excess * 0.3;
                    }
                    return val;
                };

                let r = flat.r * shadowMultiplier * exposureR;
                let g = flat.g * shadowMultiplier * exposureG;
                let b = flat.b * shadowMultiplier * exposureB;

                // Apply highlight compression for natural look
                r = compressHighlight(r);
                g = compressHighlight(g);
                b = compressHighlight(b);

                outputData[i] = Math.min(255, r * bright);
                outputData[i + 1] = Math.min(255, g * bright);
                outputData[i + 2] = Math.min(255, b * bright);
                outputData[i + 3] = originalData[i + 3];

                // Fill neighboring pixels in preview mode
                if (pixelStride > 1) {
                    for (let dy = 0; dy < pixelStride && py + dy < height; dy++) {
                        for (let dx = 0; dx < pixelStride && px + dx < width; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const ni = ((py + dy) * width + (px + dx)) * 4;
                            outputData[ni] = outputData[i];
                            outputData[ni + 1] = outputData[i + 1];
                            outputData[ni + 2] = outputData[i + 2];
                            outputData[ni + 3] = outputData[i + 3];
                        }
                    }
                }
            }
        }

        const imageData = new ImageData(outputData, width, height);
        this.ctx.putImageData(imageData, 0, 0);

        // Draw light indicators
        if (!skipIndicators) {
            this.drawLightIndicators();
        }
    }

    drawLightIndicators() {
        for (const light of this.lights) {
            const x = light.x * this.canvas.width;
            const y = light.y * this.canvas.height;

            const isHovered = light === this.hoveredLight;
            const isDragged = light === this.draggedLight;

            // Outer glow
            const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, 30);
            gradient.addColorStop(0, `rgba(${light.color.r}, ${light.color.g}, ${light.color.b}, 0.5)`);
            gradient.addColorStop(0.5, `rgba(${light.color.r}, ${light.color.g}, ${light.color.b}, 0.15)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 30, 0, Math.PI * 2);
            this.ctx.fill();

            // Light bulb
            const size = isHovered || isDragged ? 14 : 12;

            this.ctx.beginPath();
            this.ctx.arc(x, y, size, 0, Math.PI * 2);
            this.ctx.fillStyle = '#ffffee';
            this.ctx.fill();
            this.ctx.strokeStyle = isHovered || isDragged ? '#00ff88' : '#ffffff';
            this.ctx.lineWidth = isDragged ? 3 : 2;
            this.ctx.stroke();

            // Rays
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
                const innerR = size + 4;
                const outerR = size + 10;

                this.ctx.beginPath();
                this.ctx.moveTo(x + Math.cos(angle) * innerR, y + Math.sin(angle) * innerR);
                this.ctx.lineTo(x + Math.cos(angle) * outerR, y + Math.sin(angle) * outerR);
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${isHovered ? 0.9 : 0.6})`;
                this.ctx.lineWidth = 2;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();
            }

            // Delete hint
            if (isHovered && !isDragged) {
                this.ctx.font = 'bold 11px Inter, sans-serif';
                this.ctx.fillStyle = '#ff6666';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('Right-click to delete', x, y + size + 24);
            }
        }

        // Draw directional light arrows
        for (const light of this.lights) {
            if (light.type !== 'directional') continue;

            const startX = light.startX * this.canvas.width;
            const startY = light.startY * this.canvas.height;
            const endX = light.endX * this.canvas.width;
            const endY = light.endY * this.canvas.height;

            // Arrow line
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(endX, endY);
            this.ctx.strokeStyle = `rgb(${light.color.r}, ${light.color.g}, ${light.color.b})`;
            this.ctx.lineWidth = 4;
            this.ctx.stroke();

            // Arrow head
            const angle = Math.atan2(endY - startY, endX - startX);
            const headLen = 18;
            this.ctx.beginPath();
            this.ctx.moveTo(endX, endY);
            this.ctx.lineTo(
                endX - headLen * Math.cos(angle - Math.PI / 6),
                endY - headLen * Math.sin(angle - Math.PI / 6)
            );
            this.ctx.lineTo(
                endX - headLen * Math.cos(angle + Math.PI / 6),
                endY - headLen * Math.sin(angle + Math.PI / 6)
            );
            this.ctx.closePath();
            this.ctx.fillStyle = `rgb(${light.color.r}, ${light.color.g}, ${light.color.b})`;
            this.ctx.fill();

            // Start circle
            this.ctx.beginPath();
            this.ctx.arc(startX, startY, 8, 0, Math.PI * 2);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fill();
            this.ctx.strokeStyle = `rgb(${light.color.r}, ${light.color.g}, ${light.color.b})`;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }
    }

    setIntensity(intensity) {
        this.intensity = intensity * 2;

        for (const light of this.lights) {
            light.intensity = this.intensity;
        }

        if (this.enabled) this.render();
    }

    setColor(color) {
        this.color = color;
    }

    setAmbient(ambient) {
        this.ambient = ambient * 0.3;
        if (this.enabled) this.render();
    }

    setShadowStrength(strength) {
        this.shadowStrength = strength;
        if (this.enabled) this.render();
    }

    setBrightness(brightness) {
        this.brightness = brightness;
        if (this.enabled) this.render();
    }

    setMode(mode) {
        this.mode = mode;
    }

    setLightSoftness(softness) {
        this.lightSoftness = softness;
        // Softness affects both light falloff and shadow strength
        this.shadowStrength = Math.max(0.1, 0.6 - softness * 0.5);
        if (this.enabled) this.render();
    }

    setColorTemperature(kelvin) {
        this.colorTemperature = kelvin;
        // Convert temperature to color and apply to current light color
        const rgb = this.kelvinToRgb(kelvin);
        this.color = this.rgbToHex(rgb.r, rgb.g, rgb.b);

        // Update color picker UI
        const picker = document.getElementById('light-color');
        if (picker) picker.value = this.color;

        if (this.enabled) this.render();
    }

    // Convert color temperature (Kelvin) to RGB
    // Based on Tanner Helland's algorithm
    kelvinToRgb(kelvin) {
        const temp = kelvin / 100;
        let r, g, b;

        // Red
        if (temp <= 66) {
            r = 255;
        } else {
            r = temp - 60;
            r = 329.698727446 * Math.pow(r, -0.1332047592);
            r = Math.max(0, Math.min(255, r));
        }

        // Green
        if (temp <= 66) {
            g = temp;
            g = 99.4708025861 * Math.log(g) - 161.1195681661;
        } else {
            g = temp - 60;
            g = 288.1221695283 * Math.pow(g, -0.0755148492);
        }
        g = Math.max(0, Math.min(255, g));

        // Blue
        if (temp >= 66) {
            b = 255;
        } else if (temp <= 19) {
            b = 0;
        } else {
            b = temp - 10;
            b = 138.5177312231 * Math.log(b) - 305.0447927307;
            b = Math.max(0, Math.min(255, b));
        }

        return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
    }

    rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    resetLights() {
        this.lights = [];
        if (this.enabled) this.render();
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16),
            }
            : { r: 255, g: 255, b: 255 };
    }

    setFlatProfile(enabled) {
        this.flatProfileEnabled = enabled;
        if (this.enabled) this.render();
    }

    setFlatStrength(strength) {
        this.flatStrength = strength;
        if (this.enabled) this.render();
    }

    // Apply flat profile to reduce brightness contrast (highlights/shadows) without affecting saturation
    applyFlatProfile(r, g, b) {
        if (!this.flatProfileEnabled) return { r, g, b };

        const s = this.flatStrength;

        // Calculate luminance (perceived brightness)
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Target luminance: middle gray (128) - reduces highlights, lifts shadows
        const targetLum = 128;
        const newLum = lum + (targetLum - lum) * s;

        // Scale RGB to match new luminance while preserving color ratios (saturation)
        if (lum > 0) {
            const scale = newLum / lum;
            return {
                r: Math.min(255, r * scale),
                g: Math.min(255, g * scale),
                b: Math.min(255, b * scale)
            };
        } else {
            // If original is black, just brighten uniformly
            return { r: newLum, g: newLum, b: newLum };
        }
    }

    /**
     * Apply all edits to arbitrary resolution image data (for full-res export)
     * @param {ImageData} imageData - Full resolution image data
     * @param {Object} depthData - Depth map data (may need upscaling)
     * @param {Function} onProgress - Progress callback
     * @returns {ImageData} Edited image data
     */
    async applyEditsToImageData(imageData, depthData, onProgress = () => { }) {
        const { width, height, data: originalData } = imageData;
        const outputData = new Uint8ClampedArray(originalData.length);

        // If no lights and no flat profile, just copy with brightness
        if (this.lights.length === 0 && !this.flatProfileEnabled) {
            for (let i = 0; i < originalData.length; i += 4) {
                const flat = this.applyFlatProfile(originalData[i], originalData[i + 1], originalData[i + 2]);
                outputData[i] = Math.min(255, flat.r * this.brightness);
                outputData[i + 1] = Math.min(255, flat.g * this.brightness);
                outputData[i + 2] = Math.min(255, flat.b * this.brightness);
                outputData[i + 3] = originalData[i + 3];
            }
            return new ImageData(outputData, width, height);
        }

        // Generate normal map for this resolution
        onProgress(0.1);
        const normalMap = this.generateEnhancedNormalMapForData(depthData, width, height);

        // Compute shadow maps for each light
        onProgress(0.2);
        const shadowMaps = this.lights.map(light =>
            this.computeShadowMapForData(light, depthData.data, width, height)
        );

        const totalPixels = width * height;
        let processedPixels = 0;

        // Process in chunks for progress updates
        const chunkSize = 50000;

        for (let i = 0; i < originalData.length; i += 4) {
            const pixelIndex = i / 4;
            const px = pixelIndex % width;
            const py = Math.floor(pixelIndex / width);
            const pxNorm = px / width;
            const pyNorm = py / height;

            // Get normal
            const nx = (normalMap.data[i] / 255) * 2 - 1;
            const ny = (normalMap.data[i + 1] / 255) * 2 - 1;
            const nz = (normalMap.data[i + 2] / 255) * 2 - 1;

            const bright = this.brightness;

            // Shadow calculation
            let maxShadow = 0;
            for (let li = 0; li < this.lights.length; li++) {
                maxShadow = Math.max(maxShadow, shadowMaps[li][pixelIndex]);
            }
            const shadowDarken = maxShadow * this.shadowStrength * 0.6;

            // Flat profile
            const flat = this.applyFlatProfile(originalData[i], originalData[i + 1], originalData[i + 2]);

            // Calculate colored light contribution
            let lightR = 0, lightG = 0, lightB = 0;
            for (let li = 0; li < this.lights.length; li++) {
                const light = this.lights[li];
                const shadow = 1 - shadowMaps[li][pixelIndex] * this.shadowStrength;

                let attenuation = 1.0;
                let NdotL = 0;

                if (light.type === 'directional') {
                    const ldx = light.dirX, ldy = light.dirY, ldz = 0.5;
                    const len = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz);
                    NdotL = Math.max(0, nx * ldx / len + ny * ldy / len + nz * ldz / len);
                } else {
                    const lx = light.x - pxNorm, ly = light.y - pyNorm, lz = 0.5;
                    const dist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                    const ldx = lx / dist, ldy = ly / dist, ldz = lz / dist;
                    NdotL = Math.max(0, nx * ldx + ny * ldy + nz * ldz);
                    attenuation = 1 / (1 + dist * dist * 3);
                }

                const intensity = NdotL * attenuation * light.intensity * shadow * 0.4;
                lightR += intensity * (light.color.r / 255);
                lightG += intensity * (light.color.g / 255);
                lightB += intensity * (light.color.b / 255);
            }

            // EXPOSURE-BASED LIGHTING (same as preview render)
            const exposureR = Math.pow(2, lightR * 2);
            const exposureG = Math.pow(2, lightG * 2);
            const exposureB = Math.pow(2, lightB * 2);

            const shadowMultiplier = 1 - shadowDarken;

            // Highlight compression function
            const compressHighlight = (val) => {
                if (val > 200) {
                    const excess = val - 200;
                    return 200 + excess * 0.3;
                }
                return val;
            };

            let r = flat.r * shadowMultiplier * exposureR;
            let g = flat.g * shadowMultiplier * exposureG;
            let b = flat.b * shadowMultiplier * exposureB;

            r = compressHighlight(r);
            g = compressHighlight(g);
            b = compressHighlight(b);

            outputData[i] = Math.min(255, r * bright);
            outputData[i + 1] = Math.min(255, g * bright);
            outputData[i + 2] = Math.min(255, b * bright);
            outputData[i + 3] = originalData[i + 3];

            // Progress update
            processedPixels++;
            if (processedPixels % chunkSize === 0) {
                onProgress(0.2 + 0.8 * (processedPixels / totalPixels));
                // Yield to main thread
                await new Promise(r => setTimeout(r, 0));
            }
        }

        return new ImageData(outputData, width, height);
    }

    /**
     * Generate normal map for arbitrary resolution data
     */
    generateEnhancedNormalMapForData(depthData, width, height) {
        const normalData = new Uint8ClampedArray(width * height * 4);
        const srcData = depthData.data;
        const srcWidth = depthData.width;
        const srcHeight = depthData.height;

        const scaleX = srcWidth / width;
        const scaleY = srcHeight / height;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcX = Math.min(Math.floor(x * scaleX), srcWidth - 1);
                const srcY = Math.min(Math.floor(y * scaleY), srcHeight - 1);

                const getDepth = (px, py) => {
                    const clampedX = Math.max(0, Math.min(srcWidth - 1, px));
                    const clampedY = Math.max(0, Math.min(srcHeight - 1, py));
                    return srcData[(clampedY * srcWidth + clampedX) * 4] / 255;
                };

                const left = getDepth(srcX - 1, srcY);
                const right = getDepth(srcX + 1, srcY);
                const up = getDepth(srcX, srcY - 1);
                const down = getDepth(srcX, srcY + 1);

                let nx = (left - right) * 2;
                let ny = (up - down) * 2;
                let nz = 1;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                nx /= len; ny /= len; nz /= len;

                const idx = (y * width + x) * 4;
                normalData[idx] = ((nx + 1) / 2) * 255;
                normalData[idx + 1] = ((ny + 1) / 2) * 255;
                normalData[idx + 2] = ((nz + 1) / 2) * 255;
                normalData[idx + 3] = 255;
            }
        }

        return { data: normalData, width, height };
    }

    /**
     * Compute shadow map for arbitrary resolution
     */
    computeShadowMapForData(light, depthData, width, height) {
        const shadowMap = new Float32Array(width * height);

        const isDirectional = light.type === 'directional';
        const dirStepX = isDirectional ? -light.dirX : 0;
        const dirStepY = isDirectional ? -light.dirY : 0;

        const lightX = isDirectional ? 0 : light.x * width;
        const lightY = isDirectional ? 0 : light.y * height;

        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const idx = py * width + px;
                const currentDepth = depthData[idx * 4] / 255;

                let stepX, stepY, maxSteps;

                if (isDirectional) {
                    stepX = dirStepX;
                    stepY = dirStepY;
                    maxSteps = 80;
                } else {
                    const dx = lightX - px;
                    const dy = lightY - py;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 3) continue;

                    stepX = dx / dist;
                    stepY = dy / dist;
                    maxSteps = Math.min(dist * 0.7, 60);
                }

                let shadow = 0;

                for (let step = 2; step < maxSteps; step += 1.5) {
                    const sampleX = Math.floor(px + stepX * step);
                    const sampleY = Math.floor(py + stepY * step);

                    if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) break;

                    const sampleIdx = (sampleY * width + sampleX) * 4;
                    const sampleDepth = depthData[sampleIdx] / 255;

                    const depthDiff = sampleDepth - currentDepth;
                    if (depthDiff > 0.02) {
                        const occlusionStrength = Math.min(1, depthDiff * 12);
                        shadow = Math.max(shadow, occlusionStrength * (1 - step / maxSteps));
                    }
                }

                shadowMap[idx] = shadow;
            }
        }

        return shadowMap;
    }
}

