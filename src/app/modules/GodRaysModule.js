/**
 * GodRaysModule.js - Professional Volumetric Crepuscular God Rays for Orlume
 * 
 * Features:
 * - Ultra-lightweight 60 FPS interactive preview with decoupled resolution
 * - Smooth pointer drag on Sun Gizmo AND direct canvas drag
 * - Dynamic sample throttling during drag for zero-lag response
 * - Full-resolution final bake on Apply with instant Undo/Redo support
 * - AI Depth-aware occlusion & 2D silhouette occlusion
 * - Non-destructive optical screen blending
 */

import { GodRaysEffect } from '../../effects/GodRaysEffect.js';
import { DepthEstimator } from '../../ml/DepthEstimator.js';

export class GodRaysModule {
    constructor(ui) {
        this.ui = ui;
        this.effect = null;
        this.isActive = false;
        this.sunPosition = { x: 0.5, y: 0.18 };
        this.hasDepth = false;
        this.depthMap = null;

        // Depth estimator instance
        this.depthEstimator = null;

        // DOM elements
        this.sunIndicator = null;
        this.previewCanvas = null;

        // Preview & full resolution tracking
        this.previewWidth = 0;
        this.previewHeight = 0;
        this.fullWidth = 0;
        this.fullHeight = 0;

        // Animation & throttling flags
        this._rafId = null;
        this._isDragging = false;
        this._activePointerId = null;
        this._dragInitialized = false;
        this._resizeObserver = null;
        this.showPin = true;
        this._fadeTimer = null;
    }

    /**
     * Initialize the module
     */
    init() {
        this._initSliders();
        this._initButtons();
        this._initColorPickers();
        this._createSunIndicator();
        this._createProgressBar();
        this._initDragHandling();

        // Keep preview and sun gizmo aligned during window resize
        window.addEventListener('resize', () => {
            if (this.isActive) {
                this._syncPreviewCanvasGeometry();
                this._updateSunIndicator();
            }
        });
    }

    /**
     * Create progress bar element in the panel
     */
    _createProgressBar() {
        const statusEl = document.getElementById('godrays-depth-status');
        if (!statusEl) return;

        const progressContainer = document.createElement('div');
        progressContainer.id = 'godrays-progress-container';
        progressContainer.style.cssText = `
            display: none;
            margin-top: 8px;
            margin-bottom: 12px;
        `;
        progressContainer.innerHTML = `
            <div style="background: var(--bg-dark); border-radius: 4px; height: 6px; overflow: hidden;">
                <div id="godrays-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #ffd700, #ffa500); transition: width 0.2s ease;"></div>
            </div>
            <div id="godrays-progress-text" style="font-size: 10px; color: var(--text-secondary); margin-top: 4px; text-align: center;">0%</div>
        `;
        statusEl.parentNode.insertBefore(progressContainer, statusEl.nextSibling);
    }

    /**
     * Update progress bar
     */
    _updateProgress(percent, text) {
        const container = document.getElementById('godrays-progress-container');
        const bar = document.getElementById('godrays-progress-bar');
        const textEl = document.getElementById('godrays-progress-text');

        if (container) container.style.display = 'block';
        if (bar) bar.style.width = `${percent}%`;
        if (textEl) textEl.textContent = text || `${percent}%`;
    }

    /**
     * Hide progress bar
     */
    _hideProgress() {
        const container = document.getElementById('godrays-progress-container');
        if (container) container.style.display = 'none';
    }

    /**
     * Initialize slider controls
     */
    _initSliders() {
        const sliders = [
            { id: 'godrays-intensity', param: 'intensity', divisor: 100 },
            { id: 'godrays-decay', param: 'decay', divisor: 100 },
            { id: 'godrays-density', param: 'density', divisor: 100 },
            { id: 'godrays-samples', param: 'samples', divisor: 1 },
            { id: 'godrays-lum', param: 'lumThreshold', divisor: 100 },
            { id: 'godrays-depth', param: 'depthThreshold', divisor: 100 },
            { id: 'godrays-radius', param: 'sunRadius', divisor: 100 },
            { id: 'godrays-exposure', param: 'exposure', divisor: 10 },
            { id: 'godrays-chromatic', param: 'chromatic', divisor: 100 },
            { id: 'godrays-noise', param: 'noise', divisor: 100 },
            { id: 'godrays-bloom', param: 'bloom', divisor: 50 },
            { id: 'godrays-scatter', param: 'scatter', divisor: 100 },
            { id: 'godrays-tonemap', param: 'toneMap', divisor: 100 },
            { id: 'godrays-shadowintensity', param: 'shadowIntensity', divisor: 100 },
            { id: 'godrays-shadowsoftness', param: 'shadowSoftness', divisor: 100 },
            { id: 'godrays-shadowlength', param: 'shadowLength', divisor: 100 }
        ];

        sliders.forEach(({ id, param, divisor }) => {
            const slider = document.getElementById(`slider-${id}`);
            const valueDisplay = document.getElementById(`val-${id}`);

            if (!slider) return;

            slider.addEventListener('input', () => {
                const value = parseInt(slider.value, 10);
                if (valueDisplay) valueDisplay.textContent = value;

                if (this.effect && this.isActive) {
                    const paramValue = value / divisor;
                    switch (param) {
                        case 'intensity': this.effect.setIntensity(paramValue); break;
                        case 'decay': this.effect.setDecay(paramValue); break;
                        case 'density': this.effect.setDensity(paramValue); break;
                        case 'samples': this.effect.setSamples(value); break;
                        case 'lumThreshold': this.effect.setLumThreshold(paramValue); break;
                        case 'depthThreshold': this.effect.setDepthThreshold(paramValue); break;
                        case 'sunRadius': this.effect.setSunRadius(paramValue); break;
                        case 'exposure': this.effect.setExposure(paramValue); break;
                        case 'chromatic': this.effect.setChromatic(paramValue); break;
                        case 'noise': this.effect.setNoise(paramValue); break;
                        case 'bloom': this.effect.setBloom(paramValue); break;
                        case 'scatter': this.effect.setScatter(paramValue); break;
                        case 'toneMap': this.effect.setToneMap(paramValue); break;
                        case 'shadowIntensity': this.effect.setShadowIntensity(paramValue); break;
                        case 'shadowSoftness': this.effect.setShadowSoftness(paramValue); break;
                        case 'shadowLength': this.effect.setShadowLength(paramValue); break;
                    }
                    this._scheduleFastPreview();
                }
            });

            // On slider release, trigger clean high-quality render
            slider.addEventListener('change', () => {
                if (this.effect && this.isActive) {
                    this._renderPreview();
                }
            });
        });
    }

    /**
     * Initialize buttons
     */
    _initButtons() {
        // Auto-detect light source button
        const autoDetectBtn = document.getElementById('btn-godrays-autodetect');
        if (autoDetectBtn) {
            autoDetectBtn.addEventListener('click', () => {
                this.autoDetectLightSource();
            });
        }

        // Toggle show/hide light position reticle
        const pinToggle = document.getElementById('toggle-godrays-pin');
        if (pinToggle) {
            pinToggle.addEventListener('change', () => {
                this.showPin = pinToggle.checked;
                if (this.sunIndicator) {
                    if (this.showPin) {
                        this.sunIndicator.classList.remove('hidden-pin');
                    } else {
                        this.sunIndicator.classList.add('hidden-pin');
                    }
                }
            });
        }

        const depthBtn = document.getElementById('btn-godrays-depth');
        if (depthBtn) {
            depthBtn.addEventListener('click', async () => {
                await this._estimateDepth();
            });
        }

        const resetBtn = document.getElementById('btn-godrays-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this._resetToDefaults();
            });
        }

        const applyBtn = document.getElementById('btn-godrays-apply');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this._applyEffect();
            });
        }
    }

    /**
     * Initialize color pickers and presets
     */
    _initColorPickers() {
        // Preset buttons
        document.querySelectorAll('#panel-godrays .color-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;

                document.querySelectorAll('#panel-godrays .color-preset-btn').forEach(b => {
                    b.style.border = '1px solid var(--border)';
                });
                btn.style.border = '2px solid var(--accent)';

                const picker = document.getElementById('godrays-color-picker');
                if (picker) picker.value = color;

                if (this.effect && this.isActive) {
                    this.effect.setRayColor(color);
                    this._renderPreview();
                }
            });
        });

        // Color picker input
        const colorPicker = document.getElementById('godrays-color-picker');
        if (colorPicker) {
            colorPicker.addEventListener('input', () => {
                document.querySelectorAll('#panel-godrays .color-preset-btn').forEach(b => {
                    b.style.border = '1px solid var(--border)';
                });

                if (this.effect && this.isActive) {
                    this.effect.setRayColor(colorPicker.value);
                    this._scheduleFastPreview();
                }
            });
            colorPicker.addEventListener('change', () => {
                if (this.effect && this.isActive) {
                    this._renderPreview();
                }
            });
        }
    }

    /**
     * Create interactive sun position gizmo element
     */
    _createSunIndicator() {
        const container = document.querySelector('.canvas-container');
        if (!container) return;

        let indicator = document.getElementById('sun-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'sun-indicator';
            indicator.className = 'godrays-sun-gizmo';
            indicator.title = 'Light Position Reticle (drag or click anywhere on image)';
            indicator.innerHTML = `
                <div class="sun-gizmo-core"></div>
                <div class="sun-gizmo-ring"></div>
            `;
            container.appendChild(indicator);
        }
        this.sunIndicator = indicator;
        this.sunIndicator.style.display = 'none';
        if (!this.showPin) {
            this.sunIndicator.classList.add('hidden-pin');
        } else {
            this.sunIndicator.classList.remove('hidden-pin');
        }
    }

    /**
     * Bulletproof drag and click handling for both Sun Gizmo AND Canvas
     */
    _initDragHandling() {
        if (this._dragInitialized) return;
        this._dragInitialized = true;

        const updatePositionFromCoords = (clientX, clientY, isFast = true) => {
            const canvas = document.getElementById('gpu-canvas');
            if (!canvas) return;

            const rect = canvas.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            // Allow positioning slightly outside canvas (-0.25 to 1.25) for dramatic rim/sunset angles
            const x = Math.max(-0.25, Math.min(1.25, (clientX - rect.left) / rect.width));
            const y = Math.max(-0.25, Math.min(1.25, (clientY - rect.top) / rect.height));

            this.sunPosition = { x, y };

            if (this.effect && this.isActive) {
                this.effect.setSunPosition(x, y);
                if (isFast) {
                    this._scheduleFastPreview();
                } else {
                    this._renderPreview();
                }
            }

            this._updateSunIndicator();
        };

        const wakeUpReticle = () => {
            if (!this.isActive || !this.sunIndicator || !this.showPin) return;
            this.sunIndicator.classList.add('active-hover');
            clearTimeout(this._fadeTimer);
            this._fadeTimer = setTimeout(() => {
                if (this.sunIndicator && !this._isDragging) {
                    this.sunIndicator.classList.remove('active-hover');
                }
            }, 1400);
        };

        const onPointerDown = (e) => {
            if (!this.isActive) return;
            // Don't intercept right click or Space key panning (ZoomPanModule)
            if (e.button !== 0 || e.spaceKey || this.ui?.isPanning) return;

            this._isDragging = true;
            this._activePointerId = e.pointerId;

            if (this.sunIndicator) {
                this.sunIndicator.classList.add('dragging');
                this.sunIndicator.classList.add('active-hover');
            }

            // Move sun immediately to cursor on click
            updatePositionFromCoords(e.clientX, e.clientY, true);

            try {
                if (e.target && e.target.setPointerCapture) {
                    e.target.setPointerCapture(e.pointerId);
                }
            } catch (_) {}

            e.stopPropagation();
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            if (!this.isActive) return;
            wakeUpReticle();
            if (!this._isDragging) return;
            updatePositionFromCoords(e.clientX, e.clientY, true);
            e.stopPropagation();
            e.preventDefault();
        };

        const onPointerUp = (e) => {
            if (this._isDragging) {
                this._isDragging = false;
                if (this.sunIndicator) {
                    this.sunIndicator.classList.remove('dragging');
                }
                try {
                    if (e.target && e.target.releasePointerCapture && this._activePointerId !== null) {
                        e.target.releasePointerCapture(this._activePointerId);
                    }
                } catch (_) {}
                this._activePointerId = null;

                wakeUpReticle();

                // Render full configured quality on release
                this._renderPreview();
            }
        };

        this._boundPointerDown = onPointerDown;
        this._boundPointerMove = onPointerMove;
        this._boundPointerUp = onPointerUp;
        this._wakeUpReticle = wakeUpReticle;

        window.addEventListener('pointermove', this._boundPointerMove, { passive: false });
        window.addEventListener('pointerup', this._boundPointerUp, { passive: false });
        window.addEventListener('pointercancel', this._boundPointerUp, { passive: false });
    }

    /**
     * Mathematically analyze image highlights & sky geometry to auto-detect the natural light source
     */
    autoDetectLightSource() {
        if (!this.ui.state.hasImage) return;

        // Use downscaled canvas for fast 1ms centroid analysis
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        if (this.ui.state.originalImage) {
            ctx.drawImage(this.ui.state.originalImage, 0, 0, 120, 90);
        } else {
            ctx.drawImage(this.ui.elements.canvas, 0, 0, 120, 90);
        }
        const data = ctx.getImageData(0, 0, 120, 90).data;

        let sumWeight = 0;
        let sumX = 0;
        let sumY = 0;

        // Search the upper 70% of the image (typical sky / lighting zone)
        const maxY = Math.floor(90 * 0.70);
        for (let y = 0; y < maxY; y++) {
            for (let x = 0; x < 120; x++) {
                const idx = (y * 120 + x) * 4;
                const r = data[idx] / 255;
                const g = data[idx + 1] / 255;
                const b = data[idx + 2] / 255;
                const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                // Fourth-power weighting isolates dominant specular light cluster / aperture
                const weight = Math.pow(Math.max(0, luma - 0.45), 4.0);
                if (weight > 0.0001) {
                    sumWeight += weight;
                    sumX += (x / 120) * weight;
                    sumY += (y / 90) * weight;
                }
            }
        }

        if (sumWeight > 0.001) {
            const targetX = Math.max(0.05, Math.min(0.95, sumX / sumWeight));
            const targetY = Math.max(0.05, Math.min(0.85, sumY / sumWeight));
            this.setSunPosition(targetX, targetY);
            this.ui.showToast?.('✨ Natural light source auto-detected');
        } else {
            this.setSunPosition(0.5, 0.18);
        }
    }

    /**
     * Programmatically or interactively set sun position
     */
    setSunPosition(x, y) {
        this.sunPosition = { x, y };

        if (this.effect && this.isActive) {
            this.effect.setSunPosition(x, y);
            this._renderPreview();
        }

        this._updateSunIndicator();
    }

    /**
     * Update sun indicator position with sub-pixel precision relative to canvas
     */
    _updateSunIndicator() {
        const canvas = document.getElementById('gpu-canvas');
        const container = document.querySelector('.canvas-container');
        if (!canvas || !this.sunIndicator || !container) return;

        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const sunScreenX = canvasRect.left + (this.sunPosition.x * canvasRect.width);
        const sunScreenY = canvasRect.top + (this.sunPosition.y * canvasRect.height);

        const left = sunScreenX - containerRect.left;
        const top = sunScreenY - containerRect.top;

        this.sunIndicator.style.left = `${left}px`;
        this.sunIndicator.style.top = `${top}px`;
        this.sunIndicator.style.display = this.isActive ? 'block' : 'none';
    }

    /**
     * Hide sun indicator
     */
    _hideSunIndicator() {
        if (this.sunIndicator) {
            this.sunIndicator.style.display = 'none';
            this.sunIndicator.classList.remove('dragging');
        }
    }

    /**
     * Synchronize preview canvas position, dimensions and border radius to main canvas
     */
    _syncPreviewCanvasGeometry() {
        const mainCanvas = this.ui.elements.canvas || document.getElementById('gpu-canvas');
        const container = document.querySelector('.canvas-container');
        if (!mainCanvas || !container) return;

        let previewCanvas = document.getElementById('godrays-preview-canvas');
        if (!previewCanvas) {
            previewCanvas = document.createElement('canvas');
            previewCanvas.id = 'godrays-preview-canvas';
            previewCanvas.className = 'godrays-preview-canvas';
            container.appendChild(previewCanvas);
        }
        this.previewCanvas = previewCanvas;

        const mainRect = mainCanvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        previewCanvas.style.position = 'absolute';
        previewCanvas.style.left = `${mainRect.left - containerRect.left}px`;
        previewCanvas.style.top = `${mainRect.top - containerRect.top}px`;
        previewCanvas.style.width = `${mainRect.width}px`;
        previewCanvas.style.height = `${mainRect.height}px`;
        previewCanvas.style.borderRadius = window.getComputedStyle(mainCanvas).borderRadius;
        previewCanvas.style.pointerEvents = 'none';
        previewCanvas.style.zIndex = '50';
        previewCanvas.style.display = this.isActive ? 'block' : 'none';
    }

    /**
     * Activate god rays mode
     */
    activate() {
        this.isActive = true;

        if (!this.ui.state.hasImage || !this.ui.gpu) {
            console.warn('☀️ God Rays: No image loaded');
            return;
        }

        // Add active class to container for crosshair cursor
        const container = document.querySelector('.canvas-container');
        if (container) {
            container.classList.add('godrays-active');
        }

        // Clean up any existing effect
        if (this.effect) {
            this.effect.dispose();
            this.effect = null;
        }

        // 1. Determine optimal decoupled preview resolution (capped to 1280px for buttery 60 FPS)
        const maxPreviewDim = 1280;
        const fullW = this.ui.gpu.width;
        const fullH = this.ui.gpu.height;
        let previewW = fullW;
        let previewH = fullH;

        if (previewW > maxPreviewDim || previewH > maxPreviewDim) {
            if (previewW > previewH) {
                previewH = Math.round((previewH * maxPreviewDim) / previewW);
                previewW = maxPreviewDim;
            } else {
                previewW = Math.round((previewW * maxPreviewDim) / previewH);
                previewH = maxPreviewDim;
            }
        }

        this.previewWidth = previewW;
        this.previewHeight = previewH;
        this.fullWidth = fullW;
        this.fullHeight = fullH;

        // 2. Initialize preview WebGL effect
        this.effect = new GodRaysEffect(
            this.ui.elements.canvas,
            this.ui.elements.canvas.getContext('2d')
        );

        if (!this.effect.init(previewW, previewH)) {
            console.error('Failed to initialize God Rays effect');
            return;
        }

        // 3. Prepare preview base image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = previewW;
        tempCanvas.height = previewH;
        const tempCtx = tempCanvas.getContext('2d');
        if (this.ui.state.originalImage) {
            tempCtx.drawImage(this.ui.state.originalImage, 0, 0, previewW, previewH);
        } else {
            tempCtx.drawImage(this.ui.elements.canvas, 0, 0, previewW, previewH);
        }
        const previewImageData = tempCtx.getImageData(0, 0, previewW, previewH);
        this.effect.uploadImage(previewImageData);

        // 4. Upload depth map if available
        if (this.depthMap) {
            const depthCanvas = this.depthMap.canvas;
            const depthCtx = depthCanvas.getContext('2d');
            const depthImageData = depthCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);
            this.effect.uploadDepth(depthImageData);
        }

        this._checkDepthStatus();

        // 5. Ensure sun indicator and preview canvas exist and are positioned
        this._createSunIndicator();
        this._syncPreviewCanvasGeometry();
        this._updateSunIndicator();

        // 6. Bind pointer down directly to sun indicator AND canvas for effortless dragging
        if (this.sunIndicator && this._boundPointerDown) {
            this.sunIndicator.removeEventListener('pointerdown', this._boundPointerDown);
            this.sunIndicator.addEventListener('pointerdown', this._boundPointerDown);
        }
        const canvas = document.getElementById('gpu-canvas');
        if (canvas && this._boundPointerDown) {
            canvas.removeEventListener('pointerdown', this._boundPointerDown);
            canvas.addEventListener('pointerdown', this._boundPointerDown);
        }
        if (canvas && this._wakeUpReticle) {
            canvas.removeEventListener('pointerenter', this._wakeUpReticle);
            canvas.addEventListener('pointerenter', this._wakeUpReticle);
        }

        // 7. Render initial preview frame immediately
        this._renderPreview();
    }

    /**
     * Deactivate god rays mode
     */
    deactivate() {
        this.isActive = false;

        const container = document.querySelector('.canvas-container');
        if (container) {
            container.classList.remove('godrays-active');
        }

        this._hideSunIndicator();
        this._hidePreviewCanvas();

        // Clean up canvas pointerdown & enter listeners
        const canvas = document.getElementById('gpu-canvas');
        if (canvas && this._boundPointerDown) {
            canvas.removeEventListener('pointerdown', this._boundPointerDown);
        }
        if (canvas && this._wakeUpReticle) {
            canvas.removeEventListener('pointerenter', this._wakeUpReticle);
        }
        if (this.sunIndicator && this._boundPointerDown) {
            this.sunIndicator.removeEventListener('pointerdown', this._boundPointerDown);
        }
        if (this._fadeTimer) {
            clearTimeout(this._fadeTimer);
            this._fadeTimer = null;
        }

        // Cancel pending RAF
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        // Dispose WebGL resources
        if (this.effect) {
            this.effect.dispose();
            this.effect = null;
        }

        // Restore base canvas view
        if (this.ui.gpu) {
            this.ui.gpu.render();
        }
    }

    /**
     * Check and update depth status text
     */
    _checkDepthStatus() {
        const statusEl = document.getElementById('godrays-depth-status');
        if (!statusEl) return;

        if (this.depthMap) {
            this.hasDepth = true;
            statusEl.textContent = '✅ Depth analyzed • Rays cast behind subjects';
            statusEl.style.color = 'var(--accent)';
        } else {
            this.hasDepth = false;
            statusEl.textContent = 'Rays active • Click "Analyze Depth" to cast behind objects';
            statusEl.style.color = 'var(--text-secondary)';
        }
    }

    /**
     * Estimate depth using AI with progress tracking
     */
    async _estimateDepth() {
        const depthBtn = document.getElementById('btn-godrays-depth');
        const statusEl = document.getElementById('godrays-depth-status');

        if (!this.ui.state.hasImage || !this.ui.gpu) {
            if (statusEl) {
                statusEl.textContent = '❌ Please load an image first';
                statusEl.style.color = '#ff6b6b';
            }
            return;
        }

        if (depthBtn) {
            depthBtn.disabled = true;
            depthBtn.innerHTML = `
                <span style="display: inline-block; width: 14px; height: 14px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 6px;"></span>
                Analyzing Depth...
            `;
        }
        if (statusEl) {
            statusEl.textContent = '🔄 Loading AI Depth model...';
            statusEl.style.color = 'var(--text-secondary)';
        }

        this._updateProgress(0, 'Loading AI model...');

        try {
            if (!this.depthEstimator) {
                const appAdapter = {
                    updateProgress: (percent, text) => {
                        this._updateProgress(percent, text);
                    }
                };
                this.depthEstimator = new DepthEstimator(appAdapter);
            }

            // Get source image
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.previewWidth || this.ui.gpu.width;
            tempCanvas.height = this.previewHeight || this.ui.gpu.height;
            const tempCtx = tempCanvas.getContext('2d');
            if (this.ui.state.originalImage) {
                tempCtx.drawImage(this.ui.state.originalImage, 0, 0, tempCanvas.width, tempCanvas.height);
            } else {
                tempCtx.drawImage(this.ui.elements.canvas, 0, 0, tempCanvas.width, tempCanvas.height);
            }
            const dataURL = tempCanvas.toDataURL('image/jpeg', 0.9);

            const image = {
                dataURL,
                width: tempCanvas.width,
                height: tempCanvas.height
            };

            if (statusEl) {
                statusEl.textContent = '🔄 Running AI depth estimation...';
            }

            this.depthMap = await this.depthEstimator.estimate(image);

            if (this.effect && this.depthMap) {
                const depthCanvas = this.depthMap.canvas;
                const depthCtx = depthCanvas.getContext('2d');
                const depthImageData = depthCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);
                this.effect.uploadDepth(depthImageData);
            }

            this._updateProgress(100, '✅ Complete!');

            if (statusEl) {
                statusEl.textContent = '✅ Depth analyzed • Rays cast behind subjects';
                statusEl.style.color = 'var(--accent)';
            }

            setTimeout(() => {
                this._hideProgress();
                this._checkDepthStatus();
            }, 2000);

            this._renderPreview();

        } catch (error) {
            console.error('Depth estimation failed:', error);
            this._updateProgress(0, '❌ Failed');

            if (statusEl) {
                statusEl.textContent = '❌ Depth estimation failed: ' + error.message;
                statusEl.style.color = '#ff6b6b';
            }
        } finally {
            if (depthBtn) {
                depthBtn.disabled = false;
                depthBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 6px;">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    Analyze Depth (AI Occlusion)
                `;
            }
        }
    }

    /**
     * Schedule high-framerate preview update during dragging or slider changes
     */
    _scheduleFastPreview() {
        if (this._rafId) return;

        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            if (this.isActive && this.effect) {
                // Throttled to 32 samples during drag for buttery smooth 60fps interaction
                const origSamples = this.effect.params.samples;
                if (this._isDragging && origSamples > 32) {
                    this.effect.setSamples(32);
                    this._renderPreview();
                    this.effect.setSamples(origSamples);
                } else {
                    this._renderPreview();
                }
            }
        });
    }

    /**
     * Render the preview overlay
     */
    _renderPreview() {
        if (!this.effect || !this.isActive) return;

        const resultCanvas = this.effect.render();
        if (!resultCanvas) return;

        this._syncPreviewCanvasGeometry();
        if (!this.previewCanvas) return;

        // Ensure internal backing buffer matches preview resolution
        if (this.previewCanvas.width !== this.previewWidth || this.previewCanvas.height !== this.previewHeight) {
            this.previewCanvas.width = this.previewWidth;
            this.previewCanvas.height = this.previewHeight;
        }

        const ctx = this.previewCanvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, this.previewWidth, this.previewHeight);
            ctx.drawImage(resultCanvas, 0, 0, this.previewWidth, this.previewHeight);
        }

        this._updateSunIndicator();
    }

    /**
     * Hide preview canvas
     */
    _hidePreviewCanvas() {
        const previewCanvas = document.getElementById('godrays-preview-canvas');
        if (previewCanvas && previewCanvas.parentNode) {
            previewCanvas.parentNode.removeChild(previewCanvas);
        }
        this.previewCanvas = null;
    }

    /**
     * Reset controls to default preset
     */
    _resetToDefaults() {
        const defaults = {
            'godrays-intensity': 75,
            'godrays-decay': 96,
            'godrays-density': 65,
            'godrays-samples': 64,
            'godrays-lum': 60,
            'godrays-depth': 70,
            'godrays-radius': 16,
            'godrays-exposure': 18,
            'godrays-noise': 55,
            'godrays-bloom': 40
        };

        Object.entries(defaults).forEach(([id, value]) => {
            const slider = document.getElementById(`slider-${id}`);
            const valueDisplay = document.getElementById(`val-${id}`);
            if (slider) slider.value = value;
            if (valueDisplay) valueDisplay.textContent = value;
        });

        this.sunPosition = { x: 0.5, y: 0.18 };

        const colorPicker = document.getElementById('godrays-color-picker');
        if (colorPicker) colorPicker.value = '#FFF5E0';

        if (this.effect) {
            this.effect.setIntensity(0.75);
            this.effect.setDecay(0.96);
            this.effect.setDensity(0.65);
            this.effect.setSamples(64);
            this.effect.setLumThreshold(0.60);
            this.effect.setDepthThreshold(0.70);
            this.effect.setSunRadius(0.16);
            this.effect.setExposure(1.8);
            this.effect.setNoise(0.55);
            this.effect.setBloom(0.40);
            this.effect.setSunPosition(0.5, 0.18);
            this.effect.setRayColor('#FFF5E0');
        }

        this._updateSunIndicator();
        this._renderPreview();
    }

    /**
     * Apply effect at FULL 100% resolution with clean Undo/Redo integration
     */
    _applyEffect() {
        if (!this.effect) return;

        // 1. Capture history snapshot BEFORE destructive bake
        clearTimeout(this.ui._historyDebounceTimer);
        const snapshot = this.ui._captureFullState();
        this.ui.history.pushState(snapshot);

        // 2. Perform full-resolution final render
        const fullW = this.fullWidth || this.ui.gpu.width;
        const fullH = this.fullHeight || this.ui.gpu.height;

        const bakeEffect = new GodRaysEffect(
            this.ui.elements.canvas,
            this.ui.elements.canvas.getContext('2d')
        );

        if (!bakeEffect.init(fullW, fullH)) {
            console.error('Failed to initialize full resolution God Rays bake effect');
            return;
        }

        // Copy exact tuned parameters to bake effect
        Object.assign(bakeEffect.params, JSON.parse(JSON.stringify(this.effect.params)));

        // Upload full-resolution base image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = fullW;
        tempCanvas.height = fullH;
        const tempCtx = tempCanvas.getContext('2d');
        if (this.ui.state.originalImage) {
            tempCtx.drawImage(this.ui.state.originalImage, 0, 0, fullW, fullH);
        } else {
            tempCtx.drawImage(this.ui.elements.canvas, 0, 0, fullW, fullH);
        }
        const fullImageData = tempCtx.getImageData(0, 0, fullW, fullH);
        bakeEffect.uploadImage(fullImageData);

        // Upload depth map if available
        if (this.depthMap) {
            const depthCanvas = this.depthMap.canvas;
            const depthCtx = depthCanvas.getContext('2d');
            const depthImageData = depthCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);
            bakeEffect.uploadDepth(depthImageData);
        }

        const resultCanvas = bakeEffect.render();
        bakeEffect.dispose();

        if (!resultCanvas) {
            console.error('God Rays bake failed to produce output canvas');
            return;
        }

        // Convert result to Image via Blob URL for high memory efficiency
        resultCanvas.toBlob((blob) => {
            if (!blob) return;
            const blobUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(blobUrl);

                // Update GPU processor and state with final baked image
                if (this.ui.gpu) {
                    this.ui.gpu.loadImage(img);
                    this.ui.gpu.render();
                }

                if (this.ui.state) {
                    this.ui.state.setImage(img);
                    this.ui.state.originalImage = img;
                }

                setTimeout(() => this.ui.renderHistogram?.(), 100);

                // Clean up preview and deactivate
                this.deactivate();

                // Switch back to develop mode
                this.ui.setMode('develop');
                this.ui.showToast?.('✓ Volumetric God Rays applied');
            };
            img.src = blobUrl;
        }, 'image/png');
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.deactivate();
        if (this.sunIndicator && this.sunIndicator.parentNode) {
            this.sunIndicator.parentNode.removeChild(this.sunIndicator);
            this.sunIndicator = null;
        }
    }

    /**
     * Get current state for history
     */
    getState() {
        return {
            isActive: this.isActive,
            params: this.effect ? {
                intensity: document.getElementById('slider-godrays-intensity')?.value,
                decay: document.getElementById('slider-godrays-decay')?.value,
                density: document.getElementById('slider-godrays-density')?.value,
                samples: document.getElementById('slider-godrays-samples')?.value,
                lum: document.getElementById('slider-godrays-lum')?.value,
                depth: document.getElementById('slider-godrays-depth')?.value,
                sunRadius: document.getElementById('slider-godrays-radius')?.value,
                exposure: document.getElementById('slider-godrays-exposure')?.value,
                chromatic: document.getElementById('slider-godrays-chromatic')?.value,
                noise: document.getElementById('slider-godrays-noise')?.value,
                bloom: document.getElementById('slider-godrays-bloom')?.value,
                scatter: document.getElementById('slider-godrays-scatter')?.value,
                toneMap: document.getElementById('slider-godrays-tonemap')?.value,
                shadowIntensity: document.getElementById('slider-godrays-shadowintensity')?.value,
                shadowSoftness: document.getElementById('slider-godrays-shadowsoftness')?.value,
                shadowLength: document.getElementById('slider-godrays-shadowlength')?.value
            } : null,
            sunPosition: { ...this.sunPosition },
            color: document.getElementById('godrays-color-picker')?.value
        };
    }

    /**
     * Set state from history
     */
    setState(state) {
        if (!state) return;

        const wasActive = this.isActive;
        const shouldBeActive = !!state.isActive;

        if (shouldBeActive && !wasActive) {
            if (this.ui.state.currentTool === 'godrays') {
                this.activate();
            }
        } else if (!shouldBeActive && wasActive) {
            this.deactivate();
        }

        if (state.params) {
            Object.entries(state.params).forEach(([id, value]) => {
                if (value !== undefined) {
                    const sliderKey = id === 'sunRadius' ? 'radius' : id.toLowerCase();
                    const slider = document.getElementById(`slider-godrays-${sliderKey}`);
                    const valueDisplay = document.getElementById(`val-godrays-${sliderKey}`);
                    if (slider) {
                        slider.value = value;
                        if (valueDisplay) valueDisplay.textContent = value;
                    }

                    if (this.isActive && this.effect) {
                        const mapping = {
                            'intensity': { func: 'setIntensity', divisor: 100 },
                            'decay': { func: 'setDecay', divisor: 100 },
                            'density': { func: 'setDensity', divisor: 100 },
                            'samples': { func: 'setSamples', divisor: 1 },
                            'lum': { func: 'setLumThreshold', divisor: 100 },
                            'depth': { func: 'setDepthThreshold', divisor: 100 },
                            'sunRadius': { func: 'setSunRadius', divisor: 100 },
                            'radius': { func: 'setSunRadius', divisor: 100 },
                            'exposure': { func: 'setExposure', divisor: 10 },
                            'chromatic': { func: 'setChromatic', divisor: 100 },
                            'noise': { func: 'setNoise', divisor: 100 },
                            'bloom': { func: 'setBloom', divisor: 50 },
                            'scatter': { func: 'setScatter', divisor: 100 },
                            'tonemap': { func: 'setToneMap', divisor: 100 },
                            'shadowintensity': { func: 'setShadowIntensity', divisor: 100 },
                            'shadowsoftness': { func: 'setShadowSoftness', divisor: 100 },
                            'shadowlength': { func: 'setShadowLength', divisor: 100 }
                        };

                        const map = mapping[id] || mapping[id.toLowerCase()];
                        if (map && typeof this.effect[map.func] === 'function') {
                            this.effect[map.func](value / map.divisor);
                        }
                    }
                }
            });
        }

        if (state.sunPosition) {
            this.sunPosition = { ...state.sunPosition };
            if (this.isActive && this.effect) {
                this.effect.setSunPosition(this.sunPosition.x, this.sunPosition.y);
            }
            this._updateSunIndicator();
        }

        if (state.color) {
            const picker = document.getElementById('godrays-color-picker');
            if (picker) picker.value = state.color;

            if (this.isActive && this.effect) {
                this.effect.setRayColor(state.color);
            }
        }

        if (this.isActive && this.effect) {
            this._renderPreview();
        }
    }
}

export default GodRaysModule;
