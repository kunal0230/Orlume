/**
 * Relighting Effect - Enhanced
 * 
 * Improvements over v1.0.0:
 * - Rim/fresnel lighting for 3D depth perception
 * - Contact-hardening shadows (shadows sharper near occluders)
 * - Ambient occlusion from depth
 * - Better light falloff curves
 * - Improved specular with roughness
 */

export class RelightingEffect {
    constructor(app) {
        this.app = app;
        this.enabled = false;

        this.lights = [];
        this.intensity = 1.5;
        this.color = '#ffffff';
        this.ambient = 0.12;
        this.shadowStrength = 0.75;
        this.shadowSoftness = 3;

        this.canvas = null;
        this.ctx = null;
        this.normalMap = null;
        this.aoMap = null;

        // Drag state
        this.isDragging = false;
        this.draggedLight = null;
        this.hoveredLight = null;

        // Bind handlers
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onContextMenu = this.onContextMenu.bind(this);
        this.onDoubleClick = this.onDoubleClick.bind(this);
        this.render = this.render.bind(this);
    }

    enable() {
        if (this.enabled) return;

        const { depthMap } = this.app.state;
        if (!depthMap) return;

        this.enabled = true;

        // Generate normal map from depth
        this.normalMap = this.generateEnhancedNormalMap(depthMap);

        // Generate ambient occlusion from depth
        this.aoMap = this.generateAmbientOcclusion(depthMap);

        // Setup canvas
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

        mainCanvas.style.opacity = '0';
        document.getElementById('depth-canvas').style.opacity = '0';

        this.canvas.addEventListener('mousedown', this.onMouseDown);
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mouseup', this.onMouseUp);
        this.canvas.addEventListener('mouseleave', this.onMouseUp);
        this.canvas.addEventListener('contextmenu', this.onContextMenu);
        this.canvas.addEventListener('dblclick', this.onDoubleClick);

        this.render();
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

        const mainCanvas = document.getElementById('main-canvas');
        if (mainCanvas) mainCanvas.style.opacity = '1';
    }

    generateEnhancedNormalMap(depthMap) {
        const { width, height, data } = depthMap;
        const normalData = new Float32Array(width * height * 3);

        const sobelScale = 2.5;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;

                const getDepth = (ox, oy) => {
                    const i = ((y + oy) * width + (x + ox)) * 4;
                    return data[i] / 255;
                };

                // Sobel
                const dX = (
                    -getDepth(-1, -1) + getDepth(1, -1) +
                    -2 * getDepth(-1, 0) + 2 * getDepth(1, 0) +
                    -getDepth(-1, 1) + getDepth(1, 1)
                ) / 4;

                const dY = (
                    -getDepth(-1, -1) - 2 * getDepth(0, -1) - getDepth(1, -1) +
                    getDepth(-1, 1) + 2 * getDepth(0, 1) + getDepth(1, 1)
                ) / 4;

                let nx = -dX * sobelScale;
                let ny = -dY * sobelScale;
                let nz = 1.0;

                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

                normalData[idx * 3] = nx / len;
                normalData[idx * 3 + 1] = ny / len;
                normalData[idx * 3 + 2] = nz / len;
            }
        }

        return { width, height, data: normalData };
    }

    generateAmbientOcclusion(depthMap) {
        const { width, height, data } = depthMap;
        const ao = new Float32Array(width * height);
        const radius = 4;

        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                const idx = y * width + x;
                const centerDepth = data[idx * 4] / 255;

                let occlusion = 0;
                let samples = 0;

                // Sample in a circle
                for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                    for (let r = 1; r <= radius; r++) {
                        const sx = Math.round(x + Math.cos(angle) * r);
                        const sy = Math.round(y + Math.sin(angle) * r);

                        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                            const sampleDepth = data[(sy * width + sx) * 4] / 255;
                            const depthDiff = sampleDepth - centerDepth;

                            if (depthDiff > 0.01) {
                                occlusion += Math.min(1, depthDiff * 10) / r;
                            }
                            samples++;
                        }
                    }
                }

                ao[idx] = 1 - Math.min(0.5, occlusion / samples * 2);
            }
        }

        return ao;
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    }

    findLightAt(pos, threshold = 0.04) {
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
        const found = this.findLightAt(pos);

        if (found) {
            this.isDragging = true;
            this.draggedLight = found.light;
            this.canvas.style.cursor = 'grabbing';
        } else {
            this.lights.push({
                id: Date.now(),
                x: pos.x,
                y: pos.y,
                z: 0.5,
                color: this.hexToRgb(this.color),
                intensity: this.intensity
            });
            this.render();
        }
    }

    onMouseMove(e) {
        const pos = this.getMousePos(e);

        if (this.isDragging && this.draggedLight) {
            this.draggedLight.x = Math.max(0, Math.min(1, pos.x));
            this.draggedLight.y = Math.max(0, Math.min(1, pos.y));
            this.render();
        } else {
            const found = this.findLightAt(pos);
            this.hoveredLight = found ? found.light : null;
            this.canvas.style.cursor = found ? 'grab' : 'crosshair';
        }
    }

    onMouseUp() {
        this.isDragging = false;
        this.draggedLight = null;
        this.canvas.style.cursor = this.hoveredLight ? 'grab' : 'crosshair';
    }

    onContextMenu(e) {
        e.preventDefault();
        const pos = this.getMousePos(e);
        const found = this.findLightAt(pos);

        if (found) {
            this.lights.splice(found.index, 1);
            this.hoveredLight = null;
            this.render();
        }
    }

    onDoubleClick(e) {
        const pos = this.getMousePos(e);
        const found = this.findLightAt(pos);

        if (found) {
            this.lights.splice(found.index, 1);
            this.hoveredLight = null;
            this.render();
        }
    }

    computeShadowMap(light, depthData, width, height) {
        const shadowMap = new Float32Array(width * height);
        const penumbraMap = new Float32Array(width * height);

        const lightX = light.x * width;
        const lightY = light.y * height;

        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const idx = py * width + px;
                const currentDepth = depthData[idx * 4] / 255;

                const dx = lightX - px;
                const dy = lightY - py;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 3) continue;

                const stepX = dx / dist;
                const stepY = dy / dist;

                let shadow = 0;
                let minBlockerDist = dist;
                const maxSteps = Math.min(dist * 0.7, 50);

                for (let step = 2; step < maxSteps; step += 1.5) {
                    const sampleX = Math.floor(px + stepX * step);
                    const sampleY = Math.floor(py + stepY * step);

                    if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) break;

                    const sampleIdx = (sampleY * width + sampleX) * 4;
                    const sampleDepth = depthData[sampleIdx] / 255;

                    const depthDiff = sampleDepth - currentDepth;
                    if (depthDiff > 0.015) {
                        const occlusionStrength = Math.min(1, depthDiff * 15);
                        const distFalloff = 1 - step / maxSteps;
                        shadow = Math.max(shadow, occlusionStrength * distFalloff);
                        minBlockerDist = Math.min(minBlockerDist, step);
                    }
                }

                shadowMap[idx] = shadow;
                // Contact hardening: shadows sharper when blocker is close
                penumbraMap[idx] = Math.max(1, minBlockerDist / 10);
            }
        }

        // Blur with contact hardening
        return this.blurShadowWithPenumbra(shadowMap, penumbraMap, width, height);
    }

    blurShadowWithPenumbra(shadowMap, penumbraMap, width, height) {
        const blurred = new Float32Array(shadowMap.length);
        const baseRadius = this.shadowSoftness;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const penumbra = penumbraMap[idx];
                const radius = Math.round(baseRadius * Math.min(2, penumbra));

                let sum = 0;
                let weight = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const sx = x + dx;
                        const sy = y + dy;

                        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            const w = 1 / (1 + dist);
                            sum += shadowMap[sy * width + sx] * w;
                            weight += w;
                        }
                    }
                }

                blurred[idx] = sum / weight;
            }
        }

        return blurred;
    }

    render() {
        if (!this.enabled || !this.ctx) return;

        const { image, depthMap } = this.app.state;
        const { width, height } = image;

        const originalData = image.imageData.data;
        const outputData = new Uint8ClampedArray(originalData.length);
        const normalData = this.normalMap.data;
        const depthData = depthMap.data;

        // Show original with hint when no lights
        if (this.lights.length === 0) {
            outputData.set(originalData);
            const imageData = new ImageData(outputData, width, height);
            this.ctx.putImageData(imageData, 0, 0);

            this.ctx.font = 'bold 16px Inter, sans-serif';
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            this.ctx.textAlign = 'center';
            this.ctx.shadowColor = 'rgba(0,0,0,0.8)';
            this.ctx.shadowBlur = 4;
            this.ctx.fillText('Click to place a light source', width / 2, 40);
            this.ctx.shadowBlur = 0;
            return;
        }

        // Compute shadow maps
        const shadowMaps = this.lights.map(light =>
            this.computeShadowMap(light, depthData, width, height)
        );

        // View direction
        const vx = 0, vy = 0, vz = 1;

        for (let i = 0; i < originalData.length; i += 4) {
            const pixelIndex = i / 4;
            const px = pixelIndex % width;
            const py = Math.floor(pixelIndex / width);
            const pxNorm = px / width;
            const pyNorm = py / height;

            // Get normal
            const nIdx = pixelIndex * 3;
            const nx = normalData[nIdx] || 0;
            const ny = normalData[nIdx + 1] || 0;
            const nz = normalData[nIdx + 2] || 1;

            // Get depth and AO
            const pixelDepth = depthData[i] / 255;
            const ao = this.aoMap[pixelIndex] || 1;

            // Accumulate lighting
            let diffuseR = 0, diffuseG = 0, diffuseB = 0;
            let specular = 0;
            let rim = 0;

            for (let li = 0; li < this.lights.length; li++) {
                const light = this.lights[li];

                // Light direction
                const lx = light.x - pxNorm;
                const ly = light.y - pyNorm;
                const lz = light.z;

                const lightDist = Math.sqrt(lx * lx + ly * ly + lz * lz);
                const ldx = lx / lightDist;
                const ldy = ly / lightDist;
                const ldz = lz / lightDist;

                // Diffuse (N·L)
                const NdotL = Math.max(0, nx * ldx + ny * ldy + nz * ldz);

                // Blinn-Phong specular
                const halfX = ldx + vx, halfY = ldy + vy, halfZ = ldz + vz;
                const halfLen = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ);
                const NdotH = Math.max(0, nx * (halfX / halfLen) + ny * (halfY / halfLen) + nz * (halfZ / halfLen));
                const spec = Math.pow(NdotH, 48) * 0.4;

                // Rim/fresnel lighting (view-dependent edge glow)
                const NdotV = Math.max(0, nx * vx + ny * vy + nz * vz);
                const fresnel = Math.pow(1 - NdotV, 3) * 0.15;

                // Attenuation (smoother falloff)
                const attenuation = 1 / (0.5 + lightDist * lightDist * 3);

                // Shadow
                const shadow = 1 - shadowMaps[li][pixelIndex] * this.shadowStrength;

                // Combine
                const contribution = attenuation * light.intensity * shadow;

                diffuseR += NdotL * contribution * light.color.r / 255;
                diffuseG += NdotL * contribution * light.color.g / 255;
                diffuseB += NdotL * contribution * light.color.b / 255;
                specular += spec * contribution;
                rim += fresnel * contribution;
            }

            // Ambient with AO
            const ambientR = this.ambient * ao;
            const ambientG = this.ambient * ao;
            const ambientB = this.ambient * ao;

            // Final color
            outputData[i] = Math.min(255, originalData[i] * (ambientR + diffuseR) + (specular + rim) * 255);
            outputData[i + 1] = Math.min(255, originalData[i + 1] * (ambientG + diffuseG) + (specular + rim) * 255);
            outputData[i + 2] = Math.min(255, originalData[i + 2] * (ambientB + diffuseB) + (specular + rim) * 255);
            outputData[i + 3] = originalData[i + 3];
        }

        const imageData = new ImageData(outputData, width, height);
        this.ctx.putImageData(imageData, 0, 0);

        this.drawLightIndicators();
    }

    drawLightIndicators() {
        for (const light of this.lights) {
            const x = light.x * this.canvas.width;
            const y = light.y * this.canvas.height;

            const isHovered = light === this.hoveredLight;
            const isDragged = light === this.draggedLight;

            // Glow
            const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, 35);
            gradient.addColorStop(0, `rgba(${light.color.r}, ${light.color.g}, ${light.color.b}, 0.5)`);
            gradient.addColorStop(0.5, `rgba(${light.color.r}, ${light.color.g}, ${light.color.b}, 0.15)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 35, 0, Math.PI * 2);
            this.ctx.fill();

            // Bulb
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
                this.ctx.beginPath();
                this.ctx.moveTo(x + Math.cos(angle) * (size + 4), y + Math.sin(angle) * (size + 4));
                this.ctx.lineTo(x + Math.cos(angle) * (size + 10), y + Math.sin(angle) * (size + 10));
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${isHovered ? 0.9 : 0.6})`;
                this.ctx.lineWidth = 2;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();
            }

            if (isHovered && !isDragged) {
                this.ctx.font = 'bold 11px Inter, sans-serif';
                this.ctx.fillStyle = '#ff6666';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('Right-click to delete', x, y + size + 24);
            }
        }
    }

    setIntensity(v) {
        this.intensity = v * 2;
        for (const light of this.lights) light.intensity = this.intensity;
        if (this.enabled) this.render();
    }

    setColor(v) {
        this.color = v;
    }

    setAmbient(v) {
        this.ambient = v * 0.25;
        if (this.enabled) this.render();
    }

    setShadowStrength(v) {
        this.shadowStrength = v;
        if (this.enabled) this.render();
    }

    resetLights() {
        this.lights = [];
        if (this.enabled) this.render();
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
            : { r: 255, g: 255, b: 255 };
    }
}
