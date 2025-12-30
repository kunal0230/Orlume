/**
 * Relighting2Module.js - New Relighting System
 * 
 * Orchestrates the 3-stage pipeline:
 * 1. DepthSystem - Estimate depth with model selection
 * 2. LightingSystem - Apply lights with WebGL
 * 
 * Renders to an overlay canvas that sits on top of the main canvas.
 */

import { depthSystem } from '../../core/DepthSystem.js';
import { lightingSystem } from '../../core/LightingSystem.js';
import { meshSystem } from '../../core/MeshSystem.js';

export class Relighting2Module {
    constructor(ui) {
        this.ui = ui;
        this.isActive = false;

        // Current state
        this.hasDepth = false;
        this.depthMap = null;
        this.normalMap = null;
        this.originalImageData = null;

        // Selected model type
        this.selectedModel = 'small';

        // Overlay canvas for relighting output (WebGL)
        this.overlayCanvas = null;
        // Preview canvas for 2D maps (depth/normal display)
        this.previewCanvas = null;
        // Three.js canvas for 3D mesh view
        this.threeCanvas = null;
        this.lightIndicator = null;

        // View states
        this.viewingDepth = false;
        this.viewing3D = false;
        this.viewing3DMesh = false;
    }

    /**
     * Initialize the module
     */
    init() {
        this._createOverlayCanvas();
        this._initModelSelection();
        this._initSliders();
        this._initButtons();
        this._initCacheUI();
        this._initCanvasClick();
        this._createLightIndicator();

        console.log('✅ Relighting2Module initialized');
    }

    /**
     * Create overlay canvas for rendering
     */
    _createOverlayCanvas() {
        const mainCanvas = document.getElementById('gpu-canvas');
        if (!mainCanvas) return;

        const container = mainCanvas.parentElement;
        if (!container) return;

        container.style.position = 'relative';

        // Create WebGL overlay canvas for lighting
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.id = 'relight2-overlay';
        this.overlayCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            display: none;
        `;
        container.appendChild(this.overlayCanvas);

        // Create 2D preview canvas for depth/normal display
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.id = 'relight2-preview';
        this.previewCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            display: none;
            z-index: 1;
        `;
        container.appendChild(this.previewCanvas);

        // Create Three.js canvas for 3D mesh view
        this.threeCanvas = document.createElement('canvas');
        this.threeCanvas.id = 'relight2-three';
        this.threeCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: auto;
            display: none;
            z-index: 2;
        `;
        container.appendChild(this.threeCanvas);
    }

    /**
     * Initialize model selection radio buttons
     */
    _initModelSelection() {
        const smallRadio = document.getElementById('depth-model-small');
        const baseRadio = document.getElementById('depth-model-base');

        if (smallRadio) {
            smallRadio.addEventListener('change', () => {
                if (smallRadio.checked) this.selectedModel = 'small';
            });
        }

        if (baseRadio) {
            baseRadio.addEventListener('change', () => {
                if (baseRadio.checked) this.selectedModel = 'base';
            });
        }
    }

    /**
     * Initialize sliders
     */
    _initSliders() {
        const sliders = [
            { id: 'relight2-ambient', setter: (v) => { if (lightingSystem.isInitialized) lightingSystem.setAmbient(v / 100); } },
            { id: 'relight2-shadow', setter: (v) => { if (lightingSystem.isInitialized) lightingSystem.setShadowStrength(v / 100); } },
            { id: 'relight2-softness', setter: (v) => { if (lightingSystem.isInitialized) lightingSystem.setShadowSoftness(v / 100); } },
            { id: 'relight2-brightness', setter: (v) => { if (lightingSystem.isInitialized) lightingSystem.setBrightness(0.5 + v / 100); } },
            {
                id: 'relight2-displacement', setter: (v) => {
                    if (meshSystem.isInitialized) {
                        meshSystem.setDisplacement(v / 100);
                        meshSystem.needsRender = true;
                    }
                }
            }
        ];

        sliders.forEach(({ id, setter }) => {
            const slider = document.getElementById(`slider-${id}`);
            const valueEl = document.getElementById(`val-${id}`);

            if (slider) {
                slider.addEventListener('input', () => {
                    const value = parseInt(slider.value);
                    if (valueEl) valueEl.textContent = value;
                    setter(value);
                    if (this.hasDepth && !this.viewing3DMesh) this._renderPreview();
                });
            }
        });
    }

    /**
     * Initialize buttons
     */
    _initButtons() {
        // Estimate Depth button
        const depthBtn = document.getElementById('btn-relight2-depth');
        if (depthBtn) {
            depthBtn.addEventListener('click', () => this._estimateDepth());
        }

        // View Depth button
        const viewDepthBtn = document.getElementById('btn-relight2-view-depth');
        if (viewDepthBtn) {
            viewDepthBtn.addEventListener('click', () => this._toggleDepthView());
        }

        // View 3D button
        const view3DBtn = document.getElementById('btn-relight2-view-3d');
        if (view3DBtn) {
            view3DBtn.addEventListener('click', () => this._toggle3DMeshView());
        }

        // Apply button
        const applyBtn = document.getElementById('btn-relight2-apply');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => this._applyEffect());
        }

        // Reset button
        const resetBtn = document.getElementById('btn-relight2-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this._reset());
        }

        // Clear cache button
        const clearCacheBtn = document.getElementById('btn-relight2-clear-cache');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', () => this._clearCache());
        }
    }

    /**
     * Initialize cache status UI
     */
    async _initCacheUI() {
        await this._updateCacheStatus();
    }

    /**
     * Update cache status display
     */
    async _updateCacheStatus() {
        try {
            const status = await depthSystem.getCacheStatus();

            const smallStatus = document.getElementById('cache-status-small');
            const baseStatus = document.getElementById('cache-status-base');

            if (smallStatus) {
                smallStatus.innerHTML = status.small.cached
                    ? '✅ Cached'
                    : '❌ Not cached';
            }

            if (baseStatus) {
                baseStatus.innerHTML = status.base.cached
                    ? '✅ Cached'
                    : '❌ Not cached';
            }
        } catch (e) {
            console.warn('Cache status check failed:', e);
        }
    }

    /**
     * Initialize canvas click for light placement
     * Note: We attach to overlayCanvas since it's on top when visible
     */
    _initCanvasClick() {
        // Create the click handler - will be attached to overlay canvas after depth estimation
        this._canvasClickHandler = (e) => {
            if (!this.isActive || !this.hasDepth) return;
            if (this.viewing3DMesh) return; // Don't handle clicks when in 3D mesh mode

            // Hide preview canvas if showing depth view
            if (this.viewingDepth && this.previewCanvas) {
                this.previewCanvas.style.display = 'none';
                this.overlayCanvas.style.display = 'block';
                this.viewingDepth = false;
                const btn = document.getElementById('btn-relight2-view-depth');
                if (btn) btn.textContent = '📐 View Depth';
            }

            const rect = this.overlayCanvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;

            // Add or move light
            if (lightingSystem.lights.length === 0) {
                lightingSystem.addLight(x, y, '#ffffff', 1.5);
            } else {
                lightingSystem.moveLight(lightingSystem.lights[0].id, x, y);
            }

            this._updateLightIndicator(x, y);
            this._renderPreview();
            console.log(`💡 Light moved to (${x.toFixed(2)}, ${y.toFixed(2)})`);
        };
    }

    /**
     * Create light indicator element
     */
    _createLightIndicator() {
        this.lightIndicator = document.createElement('div');
        this.lightIndicator.className = 'relight2-light-indicator';
        this.lightIndicator.innerHTML = '💡';
        this.lightIndicator.style.cssText = `
            position: absolute;
            font-size: 32px;
            transform: translate(-50%, -50%);
            pointer-events: none;
            display: none;
            z-index: 100;
            filter: drop-shadow(0 0 10px rgba(255,200,100,0.8));
        `;

        const container = document.getElementById('gpu-canvas')?.parentElement;
        if (container) {
            container.appendChild(this.lightIndicator);
        }
    }

    /**
     * Update light indicator position
     */
    _updateLightIndicator(x, y) {
        if (!this.lightIndicator) return;

        this.lightIndicator.style.left = `${x * 100}%`;
        this.lightIndicator.style.top = `${y * 100}%`;
        this.lightIndicator.style.display = 'block';
    }

    /**
     * Estimate depth
     */
    async _estimateDepth() {
        if (!this.ui.app.gpu) return;

        const progressEl = document.getElementById('relight2-progress');
        const progressText = document.getElementById('relight2-progress-text');
        const progressBar = document.getElementById('relight2-progress-bar');

        if (progressEl) progressEl.style.display = 'block';

        try {
            // Store original image data
            this.originalImageData = this.ui.app.gpu.toImageData();
            const { width, height } = this.originalImageData;

            // Create image canvas for depth estimation
            const imageCanvas = document.createElement('canvas');
            imageCanvas.width = width;
            imageCanvas.height = height;
            const ctx = imageCanvas.getContext('2d');
            ctx.putImageData(this.originalImageData, 0, 0);

            // Estimate depth
            this.depthMap = await depthSystem.estimate(
                { dataURL: imageCanvas.toDataURL(), width, height },
                this.selectedModel,
                (progress) => {
                    if (progressText) progressText.textContent = progress.message;
                    if (progressBar) progressBar.style.width = `${progress.percent}%`;
                }
            );

            // Generate normal map
            this.normalMap = depthSystem.generateNormalMap(this.depthMap);

            this.hasDepth = true;

            // Setup overlay canvas and lighting
            this._setupLighting(width, height, imageCanvas);

            // Update cache status
            await this._updateCacheStatus();

            // Enable buttons
            const viewDepthBtn = document.getElementById('btn-relight2-view-depth');
            const view3DBtn = document.getElementById('btn-relight2-view-3d');
            if (viewDepthBtn) viewDepthBtn.disabled = false;
            if (view3DBtn) view3DBtn.disabled = false;

            // Show overlay and attach click handler
            if (this.overlayCanvas) {
                this.overlayCanvas.style.display = 'block';
                this.overlayCanvas.style.pointerEvents = 'auto';
                // Attach click handler to overlay canvas (it's on top)
                this.overlayCanvas.addEventListener('click', this._canvasClickHandler);
            }

            // Initial render
            this._renderPreview();

            console.log('✅ Depth estimation complete');

        } catch (error) {
            console.error('Depth estimation failed:', error);
            if (progressText) progressText.textContent = `Error: ${error.message}`;
        } finally {
            setTimeout(() => {
                if (progressEl) progressEl.style.display = 'none';
            }, 1500);
        }
    }

    /**
     * Setup lighting system
     */
    _setupLighting(width, height, imageCanvas) {
        // Size overlay canvas
        if (!this.overlayCanvas) return;

        this.overlayCanvas.width = width;
        this.overlayCanvas.height = height;

        // Init WebGL lighting system with overlay canvas
        lightingSystem.init(this.overlayCanvas);

        // Upload textures
        lightingSystem.setImage(imageCanvas);
        lightingSystem.setDepth(this.depthMap);
        lightingSystem.setNormals(this.normalMap);

        // Add initial light at center-top
        lightingSystem.addLight(0.5, 0.3, '#ffffff', 1.5);
        this._updateLightIndicator(0.5, 0.3);
    }

    /**
     * Render preview
     */
    _renderPreview() {
        if (!this.hasDepth || !lightingSystem.isInitialized) return;
        if (!this.overlayCanvas) return;

        // Render lighting to overlay canvas
        lightingSystem.render();
    }

    /**
     * Toggle depth map view
     */
    _toggleDepthView() {
        if (!this.depthMap || !this.previewCanvas) return;

        this.viewingDepth = !this.viewingDepth;
        this.viewing3D = false;
        this.viewing3DMesh = false;

        // Stop 3D mesh if active
        if (meshSystem.isInlineMode) {
            meshSystem.stopAnimation();
            this._remove3DClickHandler();
        }

        const viewDepthBtn = document.getElementById('btn-relight2-view-depth');
        const view3DBtn = document.getElementById('btn-relight2-view-3d');

        if (this.viewingDepth) {
            // Size preview canvas if needed
            if (this.previewCanvas.width !== this.depthMap.width) {
                this.previewCanvas.width = this.depthMap.width;
                this.previewCanvas.height = this.depthMap.height;
            }
            // Draw depth map to 2D preview canvas
            const ctx = this.previewCanvas.getContext('2d');
            if (ctx && this.depthMap.canvas) {
                ctx.drawImage(this.depthMap.canvas, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
            }
            // Show preview, hide others
            this.previewCanvas.style.display = 'block';
            if (this.overlayCanvas) this.overlayCanvas.style.display = 'none';
            if (this.threeCanvas) this.threeCanvas.style.display = 'none';
            if (viewDepthBtn) viewDepthBtn.textContent = '🖼️ View Lit';
            if (view3DBtn) view3DBtn.textContent = '🔮 3D Mesh';
        } else {
            // Hide preview, show WebGL overlay
            this.previewCanvas.style.display = 'none';
            if (this.threeCanvas) this.threeCanvas.style.display = 'none';
            if (this.overlayCanvas) this.overlayCanvas.style.display = 'block';
            this._renderPreview();
            if (viewDepthBtn) viewDepthBtn.textContent = '📐 View Depth';
        }
    }

    /**
     * Toggle 3D mesh view with Three.js
     */
    _toggle3DMeshView() {
        if (!this.depthMap || !this.threeCanvas) return;

        this.viewing3DMesh = !this.viewing3DMesh;
        this.viewingDepth = false;
        this.viewing3D = false;

        const view3DBtn = document.getElementById('btn-relight2-view-3d');

        if (this.viewing3DMesh) {
            // Size Three.js canvas
            const width = this.depthMap.width;
            const height = this.depthMap.height;
            this.threeCanvas.width = width;
            this.threeCanvas.height = height;

            // Initialize MeshSystem if needed
            if (!meshSystem.isInitialized) {
                meshSystem.init(width, height);
            }

            // Create image canvas for texture
            const imageCanvas = document.createElement('canvas');
            imageCanvas.width = width;
            imageCanvas.height = height;
            const ctx = imageCanvas.getContext('2d');
            ctx.putImageData(this.originalImageData, 0, 0);

            // Upload textures
            meshSystem.uploadTexture(imageCanvas);
            meshSystem.uploadDepth(this.depthMap.canvas);
            meshSystem.uploadNormals(this.normalMap.canvas);

            // Setup inline renderer on our canvas
            meshSystem.setupInlineRenderer(this.threeCanvas);
            meshSystem.setupControls(this.threeCanvas);

            // Build and render mesh
            meshSystem.buildMesh();
            meshSystem.startAnimation();

            // Setup 3D click handler for light placement
            this._setup3DClickHandler();

            // Show Three.js canvas, hide others
            this.threeCanvas.style.display = 'block';
            if (this.overlayCanvas) this.overlayCanvas.style.display = 'none';
            if (this.previewCanvas) this.previewCanvas.style.display = 'none';
            if (this.lightIndicator) this.lightIndicator.style.display = 'none';

            if (view3DBtn) view3DBtn.textContent = '🖼️ View Lit';
            console.log('🔮 3D mesh view enabled');
        } else {
            // Stop 3D rendering
            meshSystem.stopAnimation();
            this._remove3DClickHandler();

            // Hide Three.js canvas, show WebGL overlay
            this.threeCanvas.style.display = 'none';
            if (this.overlayCanvas) this.overlayCanvas.style.display = 'block';
            if (this.lightIndicator) this.lightIndicator.style.display = 'block';

            this._renderPreview();
            if (view3DBtn) view3DBtn.textContent = '🔮 3D Mesh';
        }
    }

    /**
     * Setup click handler for 3D light placement
     */
    _setup3DClickHandler() {
        this._threeClickHandler = (e) => {
            if (!this.viewing3DMesh || !meshSystem.isInlineMode) return;

            const rect = this.threeCanvas.getBoundingClientRect();
            const uv = meshSystem.raycastClick(e.clientX, e.clientY, rect);

            if (uv) {
                // Place light at UV position
                if (lightingSystem.lights.length === 0) {
                    lightingSystem.addLight(uv.x, 1 - uv.y, '#ffffff', 1.5);
                } else {
                    lightingSystem.moveLight(lightingSystem.lights[0].id, uv.x, 1 - uv.y);
                }

                // Update mesh light position
                meshSystem.setLightPosition(uv.x, uv.y);
                meshSystem.needsRender = true;

                console.log(`💡 Light placed at UV (${uv.x.toFixed(2)}, ${uv.y.toFixed(2)})`);
            }
        };

        this.threeCanvas.addEventListener('dblclick', this._threeClickHandler);
    }

    /**
     * Remove 3D click handler
     */
    _remove3DClickHandler() {
        if (this._threeClickHandler && this.threeCanvas) {
            this.threeCanvas.removeEventListener('dblclick', this._threeClickHandler);
            this._threeClickHandler = null;
        }
    }

    /**
     * Apply effect
     */
    async _applyEffect() {
        console.log('🎨 Apply effect called', { hasDepth: this.hasDepth, overlayCanvas: !!this.overlayCanvas });

        if (!this.hasDepth || !this.overlayCanvas) {
            console.warn('Cannot apply: no depth or overlay canvas');
            return;
        }

        // Ensure we have a render before reading
        this._renderPreview();

        // Use the existing WebGL context from lightingSystem
        const gl = lightingSystem.gl;
        if (!gl) {
            console.error('Failed to get WebGL context from lightingSystem');
            return;
        }

        const width = this.overlayCanvas.width;
        const height = this.overlayCanvas.height;
        console.log(`📐 Reading pixels: ${width}x${height}`);

        const pixels = new Uint8Array(width * height * 4);

        // Read pixels from WebGL framebuffer
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // WebGL has origin at bottom-left, but ImageData expects top-left
        // Flip vertically
        const flippedPixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            for (let x = 0; x < width * 4; x++) {
                flippedPixels[dstRow + x] = pixels[srcRow + x];
            }
        }

        const resultData = new ImageData(flippedPixels, width, height);
        console.log('✅ ImageData created', resultData.width, resultData.height);

        // Apply to main canvas via GPU
        const gpu = this.ui.app.gpu;
        if (gpu) {
            gpu.loadImageData(resultData);
            console.log('✅ Loaded to GPU');

            // Update state
            this.ui.app.state.updateOriginalImage(resultData);

            // Push to history
            this.ui.app.history.push(resultData);
            console.log('✅ Pushed to history');
        } else {
            console.error('GPU not available');
        }

        // Clean up - remove click handler from overlay
        if (this.overlayCanvas && this._canvasClickHandler) {
            this.overlayCanvas.removeEventListener('click', this._canvasClickHandler);
        }

        this._hideOverlay();
        this._hideLightIndicator();
        this.hasDepth = false;
        this.ui.setMode('develop');
        console.log('🎨 Apply complete');
    }

    /**
     * Reset
     */
    _reset() {
        // Clear lighting
        if (lightingSystem.isInitialized) {
            lightingSystem.clearLights();
        }

        // Hide overlay
        this._hideOverlay();
        this._hideLightIndicator();

        // Reset state
        this.hasDepth = false;
        this.depthMap = null;
        this.normalMap = null;
        this.viewingDepth = false;
        this.viewing3D = false;

        // Reset sliders
        const sliders = document.querySelectorAll('[id^="slider-relight2"]');
        sliders.forEach(slider => {
            slider.value = 50;
            const valueEl = document.getElementById(slider.id.replace('slider-', 'val-'));
            if (valueEl) valueEl.textContent = '50';
        });

        // Disable buttons
        const viewDepthBtn = document.getElementById('btn-relight2-view-depth');
        const view3DBtn = document.getElementById('btn-relight2-view-3d');
        if (viewDepthBtn) {
            viewDepthBtn.disabled = true;
            viewDepthBtn.textContent = '📐 View Depth';
        }
        if (view3DBtn) {
            view3DBtn.disabled = true;
            view3DBtn.textContent = '🔮 View 3D';
        }

        // Restore original image
        if (this.originalImageData && this.ui.app.gpu) {
            this.ui.app.gpu.loadImageData(this.originalImageData);
        }
    }

    /**
     * Hide overlay canvas
     */
    _hideOverlay() {
        if (this.overlayCanvas) {
            this.overlayCanvas.style.display = 'none';
        }
        if (this.previewCanvas) {
            this.previewCanvas.style.display = 'none';
        }
        if (this.threeCanvas) {
            this.threeCanvas.style.display = 'none';
        }
    }

    /**
     * Clear model cache
     */
    async _clearCache() {
        await depthSystem.clearAllCaches();
        await this._updateCacheStatus();
        console.log('🗑️ Cache cleared');
    }

    /**
     * Hide light indicator
     */
    _hideLightIndicator() {
        if (this.lightIndicator) {
            this.lightIndicator.style.display = 'none';
        }
    }

    /**
     * Activate module
     */
    activate() {
        this.isActive = true;
        this.viewingDepth = false;
        this.viewing3D = false;

        // Re-init cache status
        this._initCacheUI();

        console.log('🔆 Relighting2 activated');
    }

    /**
     * Deactivate module
     */
    deactivate() {
        this.isActive = false;
        this.viewingDepth = false;
        this.viewing3D = false;
        this.viewing3DMesh = false;

        // Hide overlay and indicator
        this._hideOverlay();
        this._hideLightIndicator();

        // Remove click handlers from overlay canvas
        if (this.overlayCanvas && this._canvasClickHandler) {
            this.overlayCanvas.removeEventListener('click', this._canvasClickHandler);
        }
        this._remove3DClickHandler();

        // Dispose 3D mesh system
        if (meshSystem.isInlineMode) {
            meshSystem.disposeInline();
        }

        // Dispose lighting
        if (lightingSystem.isInitialized) {
            lightingSystem.dispose();
        }
    }
}
