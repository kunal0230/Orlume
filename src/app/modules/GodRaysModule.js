/**
 * GodRaysModule.js - God Rays / Volumetric Lighting integration for EditorUI
 * 
 * Handles:
 * - Effect initialization
 * - Slider controls
 * - Sun position (click to place)
 * - Depth estimation with progress bar
 * - Preview rendering
 */

import { GodRaysEffect } from '../../effects/GodRaysEffect.js';
import { DepthEstimator } from '../../ml/DepthEstimator.js';

export class GodRaysModule {
    constructor(ui) {
        this.ui = ui;
        this.effect = null;
        this.isActive = false;
        this.sunPosition = { x: 0.5, y: 0.2 };
        this.hasDepth = false;
        this.depthMap = null;

        // Own depth estimator instance
        this.depthEstimator = null;

        // Sun indicator element
        this.sunIndicator = null;

        // Debounce for slider updates (performance)
        this.renderTimeout = null;
        this.pendingRender = false;
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

        // Keep preview and sun gizmo aligned during window resize
        window.addEventListener('resize', () => {
            if (this.isActive) {
                this._renderPreview();
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

        // Create progress container after status
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
     * Debounced render - batches slider updates for performance
     */
    _debouncedRender() {
        // Clear any pending render
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }

        // Schedule render after short delay
        this.renderTimeout = setTimeout(() => {
            if (this.effect && this.isActive) {
                this._renderPreview();
            }
            this.renderTimeout = null;
        }, 30);  // 30ms debounce
    }

    /**
     * Initialize slider controls
     */
    _initSliders() {
        const sliders = [
            { id: 'godrays-intensity', param: 'intensity', min: 0, max: 100, divisor: 100 },
            { id: 'godrays-decay', param: 'decay', min: 80, max: 99, divisor: 100 },
            { id: 'godrays-density', param: 'density', min: 10, max: 100, divisor: 100 },
            { id: 'godrays-samples', param: 'samples', min: 16, max: 128, divisor: 1 },
            { id: 'godrays-lum', param: 'lumThreshold', min: 0, max: 100, divisor: 100 },
            { id: 'godrays-depth', param: 'depthThreshold', min: 0, max: 100, divisor: 100 },
            { id: 'godrays-radius', param: 'sunRadius', min: 1, max: 50, divisor: 100 },
            { id: 'godrays-exposure', param: 'exposure', min: 5, max: 50, divisor: 10 },
            // Advanced sliders
            { id: 'godrays-chromatic', param: 'chromatic', min: 0, max: 100, divisor: 100 },
            { id: 'godrays-noise', param: 'noise', min: 0, max: 100, divisor: 100 },
            { id: 'godrays-bloom', param: 'bloom', min: 0, max: 100, divisor: 50 },  // Max 2.0
            { id: 'godrays-scatter', param: 'scatter', min: 0, max: 100, divisor: 100 },
            { id: 'godrays-tonemap', param: 'toneMap', min: 0, max: 100, divisor: 100 },
            // Shadow sliders
            { id: 'godrays-shadowintensity', param: 'shadowIntensity', min: 0, max: 100, divisor: 100 },
            { id: 'godrays-shadowsoftness', param: 'shadowSoftness', min: 0, max: 100, divisor: 100 },
            { id: 'godrays-shadowlength', param: 'shadowLength', min: 10, max: 100, divisor: 100 }
        ];

        sliders.forEach(({ id, param, divisor }) => {
            const slider = document.getElementById(`slider-${id}`);
            const valueDisplay = document.getElementById(`val-${id}`);

            if (!slider) return;

            slider.addEventListener('input', () => {
                const value = parseInt(slider.value);
                if (valueDisplay) valueDisplay.textContent = value;

                if (this.effect) {
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
                    // Use debounced render for performance
                    this._debouncedRender();
                }
            });
        });
    }

    /**
     * Initialize buttons
     */
    _initButtons() {
        // Estimate Depth button
        const depthBtn = document.getElementById('btn-godrays-depth');
        if (depthBtn) {
            depthBtn.addEventListener('click', async () => {
                await this._estimateDepth();
            });
        }

        // Reset button
        const resetBtn = document.getElementById('btn-godrays-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this._resetToDefaults();
            });
        }

        // Apply button
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
        // Color preset buttons
        document.querySelectorAll('#panel-godrays .color-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;

                // Update active state
                document.querySelectorAll('#panel-godrays .color-preset-btn').forEach(b => {
                    b.style.border = '1px solid var(--border)';
                });
                btn.style.border = '2px solid var(--accent)';

                // Update color picker
                const picker = document.getElementById('godrays-color-picker');
                if (picker) picker.value = color;

                // Apply to effect
                if (this.effect) {
                    this.effect.setRayColor(color);
                    this._renderPreview();
                }
            });
        });

        // Color picker input
        const colorPicker = document.getElementById('godrays-color-picker');
        if (colorPicker) {
            colorPicker.addEventListener('input', () => {
                // Clear preset selection
                document.querySelectorAll('#panel-godrays .color-preset-btn').forEach(b => {
                    b.style.border = '1px solid var(--border)';
                });

                if (this.effect) {
                    this.effect.setRayColor(colorPicker.value);
                    this._renderPreview();
                }
            });
        }
    }

    /**
     * Handle canvas click to place sun
     */
    _onCanvasClick(e) {
        if (!this.isActive) return;
        
        const canvas = document.getElementById('gpu-canvas');
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = Math.max(-0.25, Math.min(1.25, (e.clientX - rect.left) / rect.width));
        const y = Math.max(-0.25, Math.min(1.25, (e.clientY - rect.top) / rect.height));

        this.setSunPosition(x, y);
    }

    /**
     * Programmatically or interactively set sun position
     * @param {number} x - Normalized X coordinate (0-1, can be slightly outside canvas)
     * @param {number} y - Normalized Y coordinate (0-1, can be slightly outside canvas)
     */
    setSunPosition(x, y) {
        this.sunPosition = { x, y };

        if (this.effect) {
            this.effect.setSunPosition(x, y);
            this._renderPreview();
        }

        this._updateSunIndicator();
    }

    /**
     * Create interactive sun position gizmo element
     */
    _createSunIndicator() {
        const container = document.querySelector('.canvas-container');
        if (!container) return;

        if (this.sunIndicator && this.sunIndicator.parentNode) {
            this.sunIndicator.parentNode.removeChild(this.sunIndicator);
            this.sunIndicator = null;
        }

        this.sunIndicator = document.createElement('div');
        this.sunIndicator.id = 'sun-indicator';
        this.sunIndicator.className = 'godrays-sun-gizmo';
        this.sunIndicator.title = 'Drag to position sun / light source';
        this.sunIndicator.innerHTML = `
            <div class="sun-gizmo-core"></div>
            <div class="sun-gizmo-ring"></div>
            <div class="sun-gizmo-label">Sun</div>
        `;
        container.appendChild(this.sunIndicator);

        this._initSunDrag();
    }

    /**
     * Interactive drag handling for the sun gizmo
     */
    _initSunDrag() {
        if (!this.sunIndicator || this._hasDragInitialized) return;
        this._hasDragInitialized = true;

        let isDragging = false;

        const onPointerDown = (e) => {
            if (!this.isActive) return;
            isDragging = true;
            this.sunIndicator.classList.add('dragging');
            e.stopPropagation();
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            if (!isDragging || !this.isActive) return;
            const canvas = document.getElementById('gpu-canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const x = Math.max(-0.35, Math.min(1.35, (e.clientX - rect.left) / rect.width));
            const y = Math.max(-0.35, Math.min(1.35, (e.clientY - rect.top) / rect.height));
            this.setSunPosition(x, y);
        };

        const onPointerUp = () => {
            if (isDragging) {
                isDragging = false;
                if (this.sunIndicator) this.sunIndicator.classList.remove('dragging');
            }
        };

        this.sunIndicator.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    }

    /**
     * Update sun indicator position
     */
    _updateSunIndicator() {
        const canvas = document.getElementById('gpu-canvas');
        if (!canvas || !this.sunIndicator) return;

        // Position accurately relative to main canvas inside .canvas-container
        const left = canvas.offsetLeft + (this.sunPosition.x * canvas.clientWidth);
        const top = canvas.offsetTop + (this.sunPosition.y * canvas.clientHeight);

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
        }
    }

    /**
     * Activate god rays mode
     */
    activate() {
        this.isActive = true;

        // Check if we have an image
        if (!this.ui.state.hasImage || !this.ui.gpu) {
            console.warn('☀️ God Rays: No image loaded');
            return;
        }

        // Always create fresh effect on activation to ensure clean state
        if (this.effect) {
            this.effect.dispose();
            this.effect = null;
        }

        this.effect = new GodRaysEffect(
            this.ui.elements.canvas,
            this.ui.elements.canvas.getContext('2d')
        );

        if (!this.effect.init(this.ui.gpu.width, this.ui.gpu.height)) {
            console.error('Failed to initialize God Rays effect');
            return;
        }

        // Upload current base image (prefer clean originalImage so adjustments are not doubled)
        let imageData = null;
        if (this.ui.state.originalImage) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.ui.gpu.width;
            tempCanvas.height = this.ui.gpu.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(this.ui.state.originalImage, 0, 0, this.ui.gpu.width, this.ui.gpu.height);
            imageData = tempCtx.getImageData(0, 0, this.ui.gpu.width, this.ui.gpu.height);
        } else {
            imageData = this.ui.gpu.toImageData();
        }
        if (imageData) {
            this.effect.uploadImage(imageData);
        }

        // If we have depth from previous session, upload it
        if (this.depthMap) {
            const depthCanvas = this.depthMap.canvas;
            const depthCtx = depthCanvas.getContext('2d');
            const depthImageData = depthCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);
            this.effect.uploadDepth(depthImageData);
        }

        // Check if depth is available
        this._checkDepthStatus();

        // Create or ensure sun gizmo exists
        this._createSunIndicator();
        this._updateSunIndicator();

        // M6 FIX: Add click listener only when active
        if (!this._boundOnCanvasClick) {
            this._boundOnCanvasClick = this._onCanvasClick.bind(this);
        }
        document.getElementById('gpu-canvas')?.addEventListener('click', this._boundOnCanvasClick);

        // Immediately render volumetric light rays so they appear instantly!
        this._renderPreview();
    }

    /**
     * Deactivate god rays mode
     */
    deactivate() {
        this.isActive = false;
        this._hideSunIndicator();
        this._hidePreviewCanvas();

        // M6 FIX: Remove click listener when inactive
        if (this._boundOnCanvasClick) {
            document.getElementById('gpu-canvas')?.removeEventListener('click', this._boundOnCanvasClick);
        }

        // Dispose effect to free WebGL resources
        if (this.effect) {
            this.effect.dispose();
            this.effect = null;
        }

        // Restore the original canvas view by re-rendering
        if (this.ui.gpu) {
            this.ui.gpu.render();
        }
    }

    /**
     * Check and update depth status
     */
    _checkDepthStatus() {
        const statusEl = document.getElementById('godrays-depth-status');

        if (this.depthMap) {
            this.hasDepth = true;
            if (statusEl) {
                statusEl.textContent = '✅ Depth map available';
                statusEl.style.color = 'var(--accent)';
            }
        } else {
            this.hasDepth = false;
            if (statusEl) {
                statusEl.textContent = '⚡ Click "Estimate Depth" first for best results';
                statusEl.style.color = 'var(--text-secondary)';
            }
        }
    }

    /**
     * Estimate depth using AI with progress tracking
     */
    async _estimateDepth() {
        const depthBtn = document.getElementById('btn-godrays-depth');
        const statusEl = document.getElementById('godrays-depth-status');

        // Check if we have an image
        if (!this.ui.state.hasImage || !this.ui.gpu) {
            if (statusEl) {
                statusEl.textContent = '❌ Please load an image first';
                statusEl.style.color = '#ff6b6b';
            }
            return;
        }

        // Update button state
        if (depthBtn) {
            depthBtn.disabled = true;
            depthBtn.innerHTML = `
                <span style="display: inline-block; width: 14px; height: 14px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 6px;"></span>
                Estimating...
            `;
        }
        if (statusEl) {
            statusEl.textContent = '🔄 Loading AI model...';
            statusEl.style.color = 'var(--text-secondary)';
        }

        this._updateProgress(0, 'Loading AI model...');

        try {
            // Create depth estimator if not exists
            if (!this.depthEstimator) {
                // Create a simple app adapter for depth estimator
                const appAdapter = {
                    updateProgress: (percent, text) => {
                        this._updateProgress(percent, text);
                    }
                };
                this.depthEstimator = new DepthEstimator(appAdapter);
            }

            // Get current base image as ImageData
            let imageData = null;
            if (this.ui.state.originalImage) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = this.ui.gpu.width;
                tempCanvas.height = this.ui.gpu.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(this.ui.state.originalImage, 0, 0, this.ui.gpu.width, this.ui.gpu.height);
                imageData = tempCtx.getImageData(0, 0, this.ui.gpu.width, this.ui.gpu.height);
            } else {
                imageData = this.ui.gpu.toImageData();
            }
            if (!imageData) {
                throw new Error('Could not get image data');
            }

            // Create a data URL from the image for the depth estimator
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageData.width;
            tempCanvas.height = imageData.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(imageData, 0, 0);
            const dataURL = tempCanvas.toDataURL('image/jpeg', 0.9);

            // Create image object for depth estimation
            const image = {
                dataURL,
                width: imageData.width,
                height: imageData.height
            };

            // Run depth estimation
            if (statusEl) {
                statusEl.textContent = '🔄 Running AI depth estimation...';
            }

            this.depthMap = await this.depthEstimator.estimate(image);

            // Upload depth to effect
            if (this.effect && this.depthMap) {
                const depthCanvas = this.depthMap.canvas;
                const depthCtx = depthCanvas.getContext('2d');
                const depthImageData = depthCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height);
                this.effect.uploadDepth(depthImageData);
            }

            this._updateProgress(100, '✅ Complete!');

            if (statusEl) {
                statusEl.textContent = '✅ Depth estimation complete!';
                statusEl.style.color = 'var(--accent)';
            }

            // Hide progress after delay
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

            setTimeout(() => {
                this._hideProgress();
            }, 3000);
        } finally {
            if (depthBtn) {
                depthBtn.disabled = false;
                depthBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                        stroke-width="2" style="vertical-align: middle; margin-right: 6px;">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    ${this.depthMap ? 'Re-estimate Depth' : 'Estimate Depth'}
                `;
            }
        }
    }

    /**
     * Render preview
     */
    _renderPreview() {
        if (!this.effect || !this.isActive) return;

        const resultCanvas = this.effect.render();
        if (!resultCanvas) return;

        const mainCanvas = this.ui.elements.canvas || document.getElementById('gpu-canvas');
        if (!mainCanvas) return;

        const container = document.querySelector('.canvas-container');
        if (!container) return;

        // Create or get overlay canvas for preview
        let previewCanvas = document.getElementById('godrays-preview-canvas');
        if (!previewCanvas) {
            previewCanvas = document.createElement('canvas');
            previewCanvas.id = 'godrays-preview-canvas';
            previewCanvas.className = 'godrays-preview-canvas';
            container.appendChild(previewCanvas);
        }

        // Match exact main canvas position, dimensions, and border radius inside container
        previewCanvas.width = mainCanvas.width;
        previewCanvas.height = mainCanvas.height;
        previewCanvas.style.position = 'absolute';
        previewCanvas.style.top = `${mainCanvas.offsetTop}px`;
        previewCanvas.style.left = `${mainCanvas.offsetLeft}px`;
        previewCanvas.style.width = `${mainCanvas.clientWidth}px`;
        previewCanvas.style.height = `${mainCanvas.clientHeight}px`;
        previewCanvas.style.borderRadius = window.getComputedStyle(mainCanvas).borderRadius;
        previewCanvas.style.pointerEvents = 'none';
        previewCanvas.style.zIndex = '50';
        previewCanvas.style.display = 'block';

        // Draw result to preview canvas
        const ctx = previewCanvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            ctx.drawImage(resultCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
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
    }

    /**
     * Reset to default values
     */
    _resetToDefaults() {
        // Reset sliders
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

        // Reset sun position to top center (0.5, 0.15)
        this.sunPosition = { x: 0.5, y: 0.15 };

        // Reset color to warm golden sunlight
        const colorPicker = document.getElementById('godrays-color-picker');
        if (colorPicker) colorPicker.value = '#FFF5E0';

        // Reset effect parameters
        if (this.effect) {
            this.effect.setIntensity(0.75);
            this.effect.setDecay(0.95);
            this.effect.setDensity(0.60);
            this.effect.setSamples(48);
            this.effect.setLumThreshold(0.50);
            this.effect.setDepthThreshold(0.65);
            this.effect.setSunRadius(0.14);
            this.effect.setExposure(2.2);
            this.effect.setNoise(0.40);
            this.effect.setBloom(0.35);
            this.effect.setSunPosition(0.5, 0.15);
            this.effect.setRayColor('#FFF5E0');
        }

        this._updateSunIndicator();
        this._renderPreview();
    }

    /**
     * Apply effect to image
     */
    _applyEffect() {
        if (!this.effect) return;

        // Get final result
        const resultCanvas = this.effect.render();
        if (!resultCanvas) return;

        // H1 FIX: Capture state BEFORE the destructive operation for proper undo
        clearTimeout(this.ui._historyDebounceTimer);
        const snapshot = this.ui._captureFullState();
        this.ui.history.pushState(snapshot);

        // Convert result to proper HTMLImageElement via Blob URL to avoid large string allocation
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = resultCanvas.width;
        tempCanvas.height = resultCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(resultCanvas, 0, 0);

        tempCanvas.toBlob((blob) => {
            if (!blob) return;
            const blobUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(blobUrl);

                // Apply to GPU processor
                if (this.ui.gpu) {
                    this.ui.gpu.loadImage(img);
                    this.ui.gpu.render();
                }

                // Update original image reference
                if (this.ui.state) {
                    this.ui.state.setImage(img);
                    this.ui.state.originalImage = img;
                }

                // Update histogram
                setTimeout(() => this.ui.renderHistogram?.(), 100);

                // Hide preview canvas and sun indicator immediately
                this._hidePreviewCanvas();
                this._hideSunIndicator();

                // Dispose effect
                if (this.effect) {
                    this.effect.dispose();
                    this.effect = null;
                }
                this.isActive = false;

                // Switch back to develop mode
                this.ui.setMode('develop');

                // Visual toast confirmation
                this.ui.showToast?.('✓ Volumetric God Rays applied');
            };
            img.src = blobUrl;
        }, 'image/png');

        // Hide preview immediately for visual feedback
        this._hidePreviewCanvas();
        this._hideSunIndicator();
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.effect) {
            this.effect.dispose();
            this.effect = null;
        }

        if (this.sunIndicator && this.sunIndicator.parentNode) {
            this.sunIndicator.parentNode.removeChild(this.sunIndicator);
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

        // Restore active state logic FIRST
        // This ensures the effect exists if we need to set params on it
        const wasActive = this.isActive;
        const shouldBeActive = !!state.isActive;

        if (shouldBeActive && !wasActive) {
            // Safety Check: Only activate if we are actually in godrays mode
            // This prevents inconsistent history states (e.g. currentTool='develop' but godRays.isActive=true)
            // from verifying opening the tool.
            if (this.ui.state.currentTool === 'godrays') {
                this.activate();
            } else {
                console.warn('⚠️ God Rays active in state but current tool is not godrays. Suppressing activation.');
            }
        } else if (!shouldBeActive && wasActive) {
            this.deactivate();
        }

        // Restore params (Update UI + Internal Effect)
        if (state.params) {
            Object.entries(state.params).forEach(([id, value]) => {
                if (value !== undefined) {
                    // 1. Update UI Slider (Silent, no event)
                    const sliderKey = id === 'sunRadius' ? 'radius' : id.toLowerCase();
                    const slider = document.getElementById(`slider-godrays-${sliderKey}`);
                    const valueDisplay = document.getElementById(`val-godrays-${sliderKey}`);
                    if (slider) {
                        slider.value = value;
                        if (valueDisplay) valueDisplay.textContent = value;
                    }

                    // 2. Update Internal Effect (Directly)
                    if (this.isActive && this.effect) {
                        const mapping = {
                            'intensity': { func: 'setIntensity', divisor: 100 },
                            'decay': { func: 'setDecay', divisor: 100 },
                            'density': { func: 'setDensity', divisor: 100 },
                            'samples': { func: 'setSamples', divisor: 1 },
                            'lum': { func: 'setLumThreshold', divisor: 100 },
                            'depth': { func: 'setDepthThreshold', divisor: 100 },
                            'sunRadius': { func: 'setSunRadius', divisor: 100 }, // Note: param name mismatch in slider init vs here helper
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

                        // Map state param key to function
                        // Note: state.params keys match the slider IDs suffix (e.g. 'intensity', 'decay')
                        const map = mapping[id] || mapping[id.toLowerCase()];

                        if (map && typeof this.effect[map.func] === 'function') {
                            this.effect[map.func](value / map.divisor);
                        }
                    }
                }
            });
        }

        // Restore Sun Position
        if (state.sunPosition) {
            this.sunPosition = { ...state.sunPosition };
            if (this.isActive && this.effect) {
                this.effect.setSunPosition(this.sunPosition.x, this.sunPosition.y);
            }
            this._updateSunIndicator();
        }

        // Restore Color
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
