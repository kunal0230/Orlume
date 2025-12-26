/**
 * RelightingManager - Full 3D features integration (Depth, Relighting, 3D View, Parallax)
 * Properly bridges new modular architecture with existing effect classes
 */
import { DepthEstimator } from '../ml/DepthEstimator.js';
import { RelightingEffect } from '../effects/RelightingEffect.js';
import { ParallaxEffect } from '../effects/ParallaxEffect.js';
import { SceneManager } from '../renderer/SceneManager.js';

export class RelightingManager {
    constructor(app) {
        this.app = app;

        // State
        this.depthMap = null;
        this.currentMode = null; // 'relight', '3d', 'parallax'

        // Setup DOM elements needed by effects
        this._setupDOMElements();

        // Create app adapter that mimics old OrlumeApp interface
        this.appAdapter = this._createAppAdapter();

        // Initialize components with adapter
        this.depthEstimator = new DepthEstimator(this.appAdapter);
        this.relightingEffect = new RelightingEffect(this.appAdapter);
        this.parallaxEffect = new ParallaxEffect(this.appAdapter);
        this.sceneManager = new SceneManager(this.appAdapter);

        this._initUI();
    }

    /**
     * Setup DOM elements required by effect classes
     * Creates placeholder elements that the old effects expect
     */
    _setupDOMElements() {
        const container = document.querySelector('.canvas-container');
        if (!container) return;

        // Add editor-canvas class that effects look for
        container.classList.add('editor-canvas');

        // Create main-canvas as a real canvas that mirrors gpu-canvas dimensions
        // This is needed because RelightingEffect reads main-canvas.style.width/height
        const gpuCanvas = document.getElementById('gpu-canvas');
        if (gpuCanvas && !document.getElementById('main-canvas')) {
            const mainCanvas = document.createElement('canvas');
            mainCanvas.id = 'main-canvas';
            mainCanvas.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                opacity: 0;
                pointer-events: none;
            `;
            container.appendChild(mainCanvas);

            // Sync dimensions with gpu-canvas
            this._syncMainCanvasDimensions();
        }

        // Create depth-canvas placeholder (effects look for this)
        if (!document.getElementById('depth-canvas')) {
            const depthCanvas = document.createElement('canvas');
            depthCanvas.id = 'depth-canvas';
            depthCanvas.style.cssText = 'display: none; position: absolute;';
            container.appendChild(depthCanvas);
        }

        // Create three-canvas for 3D view
        if (!document.getElementById('three-canvas')) {
            const threeCanvas = document.createElement('canvas');
            threeCanvas.id = 'three-canvas';
            threeCanvas.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: none;
                z-index: 10;
            `;
            container.appendChild(threeCanvas);
        }
    }

    /**
     * Sync main-canvas dimensions with gpu-canvas
     * Called before enabling relighting to ensure proper sizing
     */
    _syncMainCanvasDimensions() {
        const gpuCanvas = document.getElementById('gpu-canvas');
        const mainCanvas = document.getElementById('main-canvas');
        if (!gpuCanvas || !mainCanvas) return;

        // Copy actual rendered dimensions
        const rect = gpuCanvas.getBoundingClientRect();
        mainCanvas.width = gpuCanvas.width;
        mainCanvas.height = gpuCanvas.height;
        mainCanvas.style.width = `${rect.width}px`;
        mainCanvas.style.height = `${rect.height}px`;
    }

    /**
     * Create an adapter that mimics the old OrlumeApp interface
     * This allows the existing effect classes to work with the new architecture
     */
    _createAppAdapter() {
        const self = this;
        const gpuCanvas = document.getElementById('gpu-canvas');

        return {
            // State object matching old structure
            state: {
                get image() {
                    if (!self.app.state.originalImage) return null;
                    const img = self.app.state.originalImage;

                    // Create canvas with image data
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    return {
                        width: img.width,
                        height: img.height,
                        canvas: canvas,
                        imageData: ctx.getImageData(0, 0, img.width, img.height),
                        dataURL: canvas.toDataURL('image/jpeg', 0.9)
                    };
                },
                get depthMap() {
                    return self.depthMap;
                },
                set depthMap(val) {
                    self.depthMap = val;
                }
            },

            // Components matching old structure
            components: {
                get canvas() {
                    return {
                        canvas: gpuCanvas,
                        setDepthMap: (dm) => { self.depthMap = dm; },
                        setDepthVisible: (v) => { /* handled by effect */ }
                    };
                }
            },

            // Canvas manager for relighting overlay
            canvasManager: {
                get canvas() {
                    return gpuCanvas;
                },
                getExportCanvas: () => gpuCanvas
            },

            // Progress updates
            updateProgress: (percent, text) => {
                const progressBar = document.getElementById('depth-progress-bar');
                const progressText = document.getElementById('depth-progress-text');
                const progressPercent = document.getElementById('depth-progress-percent');

                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressText) progressText.textContent = text;
                if (progressPercent) progressPercent.textContent = `${Math.round(percent)}%`;
            },

            // Status messages
            setStatus: (msg) => {
                const perf = document.getElementById('perf');
                if (perf) perf.textContent = msg;
            },

            showLoading: (text) => {
                console.log('Loading:', text);
            },

            hideLoading: () => { }
        };
    }

    /**
     * Initialize UI event listeners
     */
    _initUI() {
        // Depth estimation button
        const btnEstimate = document.getElementById('btn-estimate-depth');
        if (btnEstimate) {
            btnEstimate.addEventListener('click', () => this.estimateDepth());
        }

        // Lighting sliders
        this._initSlider('slider-light-intensity', 'val-light-intensity', (val) => {
            if (this.relightingEffect) {
                this.relightingEffect.setIntensity(val);
                this.relightingEffect.render();
            }
        }, (v) => v.toFixed(1));

        this._initSlider('slider-light-ambient', 'val-light-ambient', (val) => {
            if (this.relightingEffect) {
                this.relightingEffect.setAmbient(val / 100);
                this.relightingEffect.render();
            }
        });

        this._initSlider('slider-light-shadow', 'val-light-shadow', (val) => {
            if (this.relightingEffect) {
                this.relightingEffect.setShadowStrength(val / 100);
                this.relightingEffect.render();
            }
        });

        this._initSlider('slider-light-temperature', 'val-light-temperature', (val) => {
            if (this.relightingEffect) {
                this.relightingEffect.setColorTemperature(val);
                this.relightingEffect.render();
            }
        }, (v) => `${v}K`);

        this._initSlider('slider-light-brightness', 'val-light-brightness', (val) => {
            if (this.relightingEffect) {
                this.relightingEffect.setBrightness(val);
                this.relightingEffect.render();
            }
        });

        // Reset lights button
        const btnReset = document.getElementById('btn-reset-lights');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                if (this.relightingEffect) {
                    this.relightingEffect.resetLights();
                }
            });
        }

        // Disable button
        const btnDisable = document.getElementById('btn-disable-relight');
        if (btnDisable) {
            btnDisable.addEventListener('click', () => this.disableRelight());
        }
    }

    /**
     * Helper to initialize a slider
     */
    _initSlider(sliderId, displayId, callback, formatter = (v) => Math.round(v)) {
        const slider = document.getElementById(sliderId);
        const display = document.getElementById(displayId);
        if (!slider) return;

        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value);
            if (display) display.textContent = formatter(val);
            callback(val);
        });
    }

    /**
     * Estimate depth from the current image
     */
    async estimateDepth() {
        if (!this.app.state.hasImage) {
            console.warn('No image loaded');
            return;
        }

        const progressContainer = document.getElementById('depth-progress');
        const btnEstimate = document.getElementById('btn-estimate-depth');

        try {
            // Show progress
            if (progressContainer) progressContainer.hidden = false;
            if (btnEstimate) btnEstimate.disabled = true;

            // Get image with dataURL for depth estimation
            const img = this.app.state.originalImage;
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const imageData = {
                dataURL: canvas.toDataURL('image/jpeg', 0.9),
                width: img.width,
                height: img.height
            };

            // Estimate depth
            this.depthMap = await this.depthEstimator.estimate(imageData);

            console.log('✅ Depth map generated:', this.depthMap.width, '×', this.depthMap.height);

            // Show relighting controls
            const controls = document.getElementById('relight-controls');
            if (controls) controls.style.display = 'block';

            // Enable relighting automatically
            this.enableRelight();

            // Update UI
            if (btnEstimate) {
                btnEstimate.textContent = 'Re-estimate Depth';
                btnEstimate.disabled = false;
            }

            setTimeout(() => {
                if (progressContainer) progressContainer.hidden = true;
            }, 1000);

        } catch (error) {
            console.error('Depth estimation failed:', error);
            if (progressContainer) progressContainer.hidden = true;
            if (btnEstimate) btnEstimate.disabled = false;
            alert('Depth estimation failed: ' + error.message);
        }
    }

    /**
     * Enable relighting mode
     */
    enableRelight() {
        if (!this.depthMap) {
            console.warn('No depth map available');
            return;
        }

        this.currentMode = 'relight';

        // Ensure main-canvas dimensions match gpu-canvas
        this._syncMainCanvasDimensions();

        // Set depth map on effect's app adapter state
        this.appAdapter.state.depthMap = this.depthMap;

        // Enable the effect
        this.relightingEffect.enable();

        console.log('🔦 Relighting enabled');
    }

    /**
     * Disable relighting mode
     */
    disableRelight() {
        if (this.relightingEffect) {
            this.relightingEffect.disable();
        }
        this.currentMode = null;

        // Re-render the GPU canvas
        if (this.app.ui) {
            this.app.ui.renderWithMask(false);
        }

        console.log('🔦 Relighting disabled');
    }

    /**
     * Enable 3D view mode
     */
    enable3DView() {
        if (!this.depthMap) {
            console.warn('No depth map available');
            return;
        }

        this.currentMode = '3d';
        this.sceneManager.enable();

        // Hide GPU canvas, show three canvas
        const gpuCanvas = document.getElementById('gpu-canvas');
        const threeCanvas = document.getElementById('three-canvas');

        if (gpuCanvas) gpuCanvas.style.display = 'none';
        if (threeCanvas) threeCanvas.style.display = 'block';

        console.log('🎮 3D View enabled');
    }

    /**
     * Disable 3D view mode
     */
    disable3DView() {
        this.sceneManager.disable();
        this.currentMode = null;

        const gpuCanvas = document.getElementById('gpu-canvas');
        const threeCanvas = document.getElementById('three-canvas');

        if (gpuCanvas) gpuCanvas.style.display = 'block';
        if (threeCanvas) threeCanvas.style.display = 'none';

        console.log('🎮 3D View disabled');
    }

    /**
     * Enable parallax effect
     */
    enableParallax() {
        if (!this.depthMap) {
            console.warn('No depth map available');
            return;
        }

        this.currentMode = 'parallax';
        this.parallaxEffect.enable();

        console.log('✨ Parallax enabled');
    }

    /**
     * Disable parallax effect
     */
    disableParallax() {
        this.parallaxEffect.disable();
        this.currentMode = null;

        console.log('✨ Parallax disabled');
    }

    /**
     * Check if depth map is available
     */
    hasDepthMap() {
        return !!this.depthMap;
    }

    /**
     * Get current mode
     */
    getCurrentMode() {
        return this.currentMode;
    }
}
