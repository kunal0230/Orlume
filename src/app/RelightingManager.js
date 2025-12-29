/**
 * RelightingManager - Full 3D features integration (Depth, Relighting, 3D View, Parallax)
 * 
 * v5.1.0: ORLUME Neural Relighting Engine
 * - Depth Estimation (Depth Anything V2)
 * - ML-based Surface Normals (Metric3D v2)
 * - Semantic Segmentation (SegFormer B0 - 150 classes)
 * - Fusion Engine (depth-seg fusion, material inference)
 * - Enhanced raymarching shadows and HBAO ambient occlusion
 */
import { DepthEstimator } from '../ml/DepthEstimator.js';
import { NormalEstimator } from '../ml/NormalEstimator.js';
import { SegmentationEstimator } from '../ml/SegmentationEstimator.js';
import { MaterialEstimator } from '../ml/MaterialEstimator.js';
import { DepthModelComparison, DEPTH_MODELS } from '../ml/DepthModelComparison.js';
import { FusionEngine } from '../effects/FusionEngine.js';
import { RelightingEffect } from '../effects/RelightingEffect.js';
import { ParallaxEffect } from '../effects/ParallaxEffect.js';
import { SceneManager } from '../renderer/SceneManager.js';
import { RaymarchingShadowProcessor } from '../effects/RaymarchingShadowShader.js';
import { HBAOProcessor } from '../effects/HBAOShader.js';
import { AdvancedShadowProcessor } from '../effects/AdvancedShadowShader.js';
import { RelightingEngine } from '../effects/RelightingEngine.js';

export class RelightingManager {
    constructor(app) {
        this.app = app;

        // State
        this.depthMap = null;
        this.normalMap = null;
        this.mlNormalMap = null;  // ML-based normals (Metric3D)
        this.aoMap = null;
        this.currentMode = null; // 'relight', '3d', 'parallax'

        // Enhanced mode flags
        this.useONNX = false;      // Disabled - conflicts with Transformers.js ONNX runtime
        this.useRaymarching = true;
        this.useHBAO = true;
        this.useSegmentation = true;   // Enable multi-modal segmentation
        this.useMLNormals = true;      // Use ML-based normals when available

        // Setup DOM elements needed by effects
        this._setupDOMElements();

        // Create app adapter that mimics old OrlumeApp interface
        this.appAdapter = this._createAppAdapter();

        // Initialize ML estimators
        this.depthEstimator = new DepthEstimator(this.appAdapter);
        this.normalEstimator = new NormalEstimator(this.appAdapter);
        this.segmentationEstimator = new SegmentationEstimator(this.appAdapter);
        this.materialEstimator = new MaterialEstimator(this.appAdapter);

        // Initialize fusion engine for combining depth + segmentation
        this.fusionEngine = new FusionEngine();

        // Additional outputs from fusion
        this.materialMap = null;
        this.pbrMaterialMap = null;  // Enhanced PBR material map from MaterialEstimator
        this.segmentationResult = null;


        // Initialize enhanced processors
        this.shadowProcessor = new RaymarchingShadowProcessor();
        this.hbaoProcessor = new HBAOProcessor();
        this.advancedShadowProcessor = new AdvancedShadowProcessor(); // Phase B: Advanced shadows

        // Initialize new PBR-based relighting engine
        this.relightingEngine = new RelightingEngine(this.appAdapter);
        this.albedoMap = null;  // Albedo (unlit color) from intrinsic decomposition
        this.shadowMap = null;  // Advanced shadow map (PCF + contact + color bleed)

        // Initialize other components with adapter
        this.relightingEffect = new RelightingEffect(this.appAdapter);
        this.parallaxEffect = new ParallaxEffect(this.appAdapter);
        this.sceneManager = new SceneManager(this.appAdapter);

        this._initUI();

        console.log('🔦 RelightingManager v5.0.0 initialized (PBR Relighting Engine)');
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

        // Compare all depth models button
        const btnCompare = document.getElementById('btn-compare-depth-models');
        if (btnCompare) {
            btnCompare.addEventListener('click', () => this.compareDepthModels());
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

        // Apply relighting button
        const btnApply = document.getElementById('btn-apply-relight');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.applyRelighting());
        }

        // Debug visualization buttons
        this._initVisualizationButtons();
    }

    /**
     * Initialize debug visualization buttons
     */
    _initVisualizationButtons() {
        const vizButtons = document.querySelectorAll('.viz-btn');
        const vizPreview = document.getElementById('viz-preview');
        const vizCanvas = document.getElementById('viz-canvas');
        const vizLabel = document.getElementById('viz-label');

        if (!vizButtons.length) return;

        vizButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const vizType = btn.dataset.viz;

                // Update active state
                vizButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Show visualization
                this._showVisualization(vizType, vizCanvas, vizLabel, vizPreview);
            });
        });
    }

    /**
     * Show a visualization on the debug canvas
     */
    _showVisualization(type, canvas, label, container) {
        if (!container) return;

        let sourceCanvas = null;
        let labelText = '';

        console.log(`🔍 Showing visualization: ${type}`);
        console.log('  depthMap:', this.depthMap ? `${this.depthMap.width}×${this.depthMap.height}` : 'null');
        console.log('  normalMap:', this.normalMap ? `${this.normalMap.width}×${this.normalMap.height}` : 'null');
        console.log('  materialMap:', this.materialMap ? `${this.materialMap.width}×${this.materialMap.height}` : 'null');

        switch (type) {
            case 'original':
                // Show original image
                if (this.app?.state?.originalImage) {
                    const img = this.app.state.originalImage;
                    sourceCanvas = document.createElement('canvas');
                    sourceCanvas.width = img.width;
                    sourceCanvas.height = img.height;
                    sourceCanvas.getContext('2d').drawImage(img, 0, 0);
                    labelText = '🖼️ Original Image';
                }
                break;

            case 'depth':
                sourceCanvas = this._getCanvasFromMap(this.depthMap);
                labelText = sourceCanvas ? '📊 Depth Map - Brighter = Further' : '📊 Depth Map - Not available';
                break;

            case 'normals':
                sourceCanvas = this._getCanvasFromMap(this.normalMap);
                labelText = sourceCanvas ? '🧭 Normal Map - RGB = XYZ' : '🧭 Normal Map - Not available';
                break;

            case 'materials':
                sourceCanvas = this._getCanvasFromMap(this.materialMap);
                labelText = sourceCanvas ? '🎨 Material Map - R:Rough G:Metal B:SSS' : '🎨 Material Map - Not available';
                break;

            case 'albedo':
                sourceCanvas = this._getCanvasFromMap(this.albedoMap);
                labelText = sourceCanvas ? '🌈 Albedo - True color (unlit)' : '🌈 Albedo - Not available';
                break;
        }

        // Always show container
        container.style.display = 'block';

        if (sourceCanvas) {
            canvas.width = sourceCanvas.width;
            canvas.height = sourceCanvas.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(sourceCanvas, 0, 0);
            console.log(`  ✅ Drew ${sourceCanvas.width}×${sourceCanvas.height}`);
        } else {
            // Show "not available" message
            canvas.width = 280;
            canvas.height = 80;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, 280, 80);
            ctx.fillStyle = '#888';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Map not available', 140, 40);
            ctx.fillText('Run "Estimate Depth" first', 140, 58);
        }

        if (label) {
            label.textContent = labelText;
        }
    }

    /**
     * Helper to extract canvas from various map formats
     */
    _getCanvasFromMap(map) {
        if (!map) return null;
        if (map instanceof HTMLCanvasElement) return map;
        if (map.canvas instanceof HTMLCanvasElement) return map.canvas;

        // Check for object with width, height, data (like normalMap from DepthEstimator)
        if (map.width && map.height && map.data) {
            const canvas = document.createElement('canvas');
            canvas.width = map.width;
            canvas.height = map.height;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.createImageData(map.width, map.height);

            // Check if data is already RGBA format (Uint8ClampedArray with length = w*h*4)
            if (map.data.length === map.width * map.height * 4) {
                // Direct copy - data is already in RGBA format
                imgData.data.set(map.data);
            } else if (map.data.length === map.width * map.height) {
                // Single channel data (grayscale) - expand to RGBA
                for (let i = 0; i < map.data.length; i++) {
                    const v = map.data[i] > 1 ? map.data[i] : Math.round(map.data[i] * 255);
                    imgData.data[i * 4] = v;
                    imgData.data[i * 4 + 1] = v;
                    imgData.data[i * 4 + 2] = v;
                    imgData.data[i * 4 + 3] = 255;
                }
            } else {
                console.warn('Unknown data format length:', map.data.length, 'expected:', map.width * map.height * 4);
                return null;
            }

            ctx.putImageData(imgData, 0, 0);
            return canvas;
        }

        console.warn('Unknown map format:', typeof map, map);
        return null;
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
     * 
     * v4.9.0: Multi-Modal Intelligence System
     * Runs depth estimation and semantic segmentation IN PARALLEL,
     * then fuses results for enhanced quality.
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
            if (btnEstimate) {
                btnEstimate.disabled = true;
                btnEstimate.textContent = 'Analyzing...';
            }

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

            const startTime = performance.now();
            console.log('🧠 Starting Multi-Modal Image Intelligence Analysis...');

            // =====================================================
            // PHASE 1: Run depth and segmentation IN PARALLEL
            // Note: ML normal models aren't available for browser,
            // so we generate high-quality normals from depth in Phase 2
            // =====================================================
            const analysisPromises = [
                this._runDepthEstimation(imageData),
            ];

            // Add segmentation if enabled
            if (this.useSegmentation) {
                analysisPromises.push(this._runSegmentation(img));
            }

            const results = await Promise.all(analysisPromises);

            // Parse results
            const rawDepthMap = results[0];
            const segmentationResult = this.useSegmentation ? results[1] : null;

            const phase1Time = performance.now() - startTime;
            console.log(`✅ Phase 1 complete: Depth + Segmentation (${phase1Time.toFixed(0)}ms)`);

            // =====================================================
            // PHASE 2: Fusion + High-Quality Normal Generation
            // =====================================================
            if (segmentationResult && this.fusionEngine) {
                console.log('🔀 Starting fusion...');
                const fusionStart = performance.now();

                try {
                    const fusionResult = await this.fusionEngine.fuse(
                        rawDepthMap,
                        segmentationResult,
                        { normalStrength: 3.0 }
                    );

                    // Use enhanced outputs
                    this.depthMap = fusionResult.refinedDepth;
                    this.materialMap = fusionResult.materialMap;
                    this.segmentationResult = segmentationResult;

                    // Generate high-quality segment-aware normals
                    const normalStart = performance.now();
                    if (fusionResult.segmentMask) {
                        // Use segment boundaries for sharper edges
                        this.normalMap = this.normalEstimator.generateSegmentAwareNormals(
                            this.depthMap,
                            fusionResult.segmentMask,
                            { normalStrength: 'auto', edgeSharpness: 1.5 }
                        );
                    } else {
                        this.normalMap = this.normalEstimator.generateNormals(this.depthMap, {
                            normalStrength: 'auto',
                            smoothKernel: 'scharr',
                            multiScale: true,
                            enhanceEdges: true
                        });
                    }
                    const normalTime = performance.now() - normalStart;
                    console.log(`✅ High-quality segment-aware normals generated (${normalTime.toFixed(0)}ms)`);

                    const fusionTime = performance.now() - fusionStart;
                    console.log(`✅ Fusion complete: Enhanced depth, materials (${fusionTime.toFixed(0)}ms)`);

                } catch (fusionError) {
                    console.warn('⚠️ Fusion failed, using raw depth:', fusionError.message);
                    this.depthMap = rawDepthMap;
                    this.normalMap = this.normalEstimator.generateNormals(rawDepthMap, {
                        normalStrength: 'auto',
                        smoothKernel: 'scharr',
                        multiScale: true,
                        enhanceEdges: true
                    });
                    this.materialMap = null;
                }
            } else {
                // No segmentation, use raw depth and generate normals
                this.depthMap = rawDepthMap;
                this.normalMap = this.normalEstimator.generateNormals(rawDepthMap, {
                    normalStrength: 'auto',
                    smoothKernel: 'scharr',
                    multiScale: true,
                    enhanceEdges: true
                });
                this.materialMap = null;
            }

            console.log(`✅ Depth map: ${this.depthMap.width}×${this.depthMap.height}`);
            console.log(`✅ Normal map: ${this.normalMap.width}×${this.normalMap.height}`);
            if (this.materialMap) {
                console.log('✅ Material map generated (150 classes)');
            }

            // =====================================================
            // PHASE 3: Generate HBAO ambient occlusion
            // =====================================================
            if (this.useHBAO) {
                try {
                    const aoCanvas = this.hbaoProcessor.compute(this.depthMap, {
                        u_radius: 0.03,
                        u_intensity: 1.5,
                        u_numDirections: 8,
                        u_numSteps: 6
                    });
                    this.aoMap = {
                        canvas: aoCanvas,
                        width: aoCanvas.width,
                        height: aoCanvas.height
                    };
                    console.log('✅ HBAO ambient occlusion generated');
                } catch (aoError) {
                    console.warn('⚠️ HBAO generation failed:', aoError.message);
                    this.aoMap = null;
                }
            }

            // =====================================================
            // PHASE 3.5: Advanced Shadow System (PCF + Contact + Color Bleed)
            // =====================================================
            console.log('🌑 Computing advanced shadows...');
            const shadowStart = performance.now();

            try {
                // Get image canvas for color bleeding
                const imageCanvas = this._getImageCanvas();

                // Compute advanced shadows for current primary light
                const primaryLight = this.relightingEffect?.lights?.[0] || { x: 0.5, y: 0.3, z: 0.8 };
                const lightPos = [
                    primaryLight.x || 0.5,
                    primaryLight.y || 0.3,
                    primaryLight.z || 0.8
                ];

                const shadowCanvas = this.advancedShadowProcessor.compute(
                    this.depthMap,
                    this.normalMap,
                    imageCanvas,
                    this.aoMap,
                    {
                        lightPos: lightPos,
                        lightRadius: 0.06,        // Soft penumbra
                        shadowIntensity: 0.85,    // Strong but not pitch black
                        contactDistance: 0.08,    // Contact shadow reach
                        pcfSamples: 8,            // Quality/performance balance
                        raymarchSteps: 16,        // Contact shadow quality
                        colorBleedAmount: 0.12    // Subtle GI approximation
                    }
                );

                this.shadowMap = {
                    canvas: shadowCanvas,
                    width: shadowCanvas.width,
                    height: shadowCanvas.height
                };

                const shadowTime = performance.now() - shadowStart;
                console.log(`✅ Advanced shadows computed (${shadowTime.toFixed(0)}ms) - PCF, Contact, Color Bleed`);
            } catch (shadowError) {
                console.warn('⚠️ Advanced shadow computation failed:', shadowError.message);
                this.shadowMap = null;
            }

            // =====================================================
            // PHASE 3.7: Generate PBR Material Map (roughness, metallic, SSS)
            // =====================================================
            if (this.segmentationResult) {
                console.log('🎨 Generating PBR material map...');
                const materialStart = performance.now();

                try {
                    this.pbrMaterialMap = this.materialEstimator.generateMaterialMap(
                        this.segmentationResult,
                        this.app.state.originalImage
                    );

                    const materialTime = performance.now() - materialStart;
                    const materials = Object.keys(this.pbrMaterialMap.classToMaterial || {});
                    console.log(`✅ PBR materials generated (${materialTime.toFixed(0)}ms) - ${materials.length} classes detected`);

                    // Log detected materials for debugging
                    if (materials.length <= 10) {
                        console.log('📦 Materials:', materials.join(', '));
                    }
                } catch (materialError) {
                    console.warn('⚠️ PBR material generation failed:', materialError.message);
                    this.pbrMaterialMap = null;
                }
            }
            // =====================================================
            // PHASE 4: Extract Albedo for PBR Relighting
            // =====================================================
            console.log('🎨 Extracting albedo (intrinsic decomposition)...');
            const albedoStart = performance.now();

            try {
                // Prepare scene for the new relighting engine
                const sceneResult = this.relightingEngine.prepareScene(
                    this.app.state.originalImage,
                    {
                        depthMap: this.depthMap,
                        normalMap: this.normalMap,
                        materialMap: this.materialMap
                    }
                );

                this.albedoMap = sceneResult.albedo;
                const albedoTime = performance.now() - albedoStart;
                console.log(`✅ Albedo extracted (${albedoTime.toFixed(0)}ms)`);
            } catch (albedoError) {
                console.warn('⚠️ Albedo extraction failed:', albedoError.message);
                this.albedoMap = null;
            }

            const totalTime = performance.now() - startTime;
            console.log(`🎉 Multi-Modal Analysis complete in ${(totalTime / 1000).toFixed(1)}s`);

            // Show relighting controls
            const controls = document.getElementById('relight-controls');
            if (controls) controls.style.display = 'block';

            // Show debug visualization controls
            const debugViz = document.getElementById('debug-viz-controls');
            if (debugViz) debugViz.style.display = 'block';

            // Enable relighting automatically
            this.enableRelight();

            // Update UI
            if (btnEstimate) {
                btnEstimate.textContent = 'Re-analyze Image';
                btnEstimate.disabled = false;
            }

            setTimeout(() => {
                if (progressContainer) progressContainer.hidden = true;
            }, 1000);

        } catch (error) {
            console.error('Multi-modal analysis failed:', error);
            if (progressContainer) progressContainer.hidden = true;
            if (btnEstimate) btnEstimate.disabled = false;
            alert('Analysis failed: ' + error.message);
        }
    }

    /**
     * Run depth estimation (internal helper)
     */
    async _runDepthEstimation(imageData) {
        console.log('📊 Running depth estimation...');
        const depthMap = await this.depthEstimator.estimate(imageData);
        console.log(`✅ Depth: ${depthMap.width}×${depthMap.height}`);
        return depthMap;
    }

    /**
     * Run semantic segmentation (internal helper)
     */
    async _runSegmentation(image) {
        console.log('🏷️ Running semantic segmentation...');
        const result = await this.segmentationEstimator.segment(image);
        console.log(`✅ Segmentation: ${result.segments.length} segments`);
        return result;
    }

    /**
     * Get original image as canvas for processing
     */
    _getImageCanvas() {
        const original = this.app.state.originalImage;
        if (original instanceof HTMLCanvasElement) {
            return original;
        }
        // Create canvas from image
        const canvas = document.createElement('canvas');
        canvas.width = original.width;
        canvas.height = original.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(original, 0, 0);
        return canvas;
    }

    /**
     * Update shadow map for new light position
     * Call this when light moves for dynamic shadows
     */
    updateShadowMap(lightPos) {
        if (!this.depthMap || !this.normalMap || !this.advancedShadowProcessor) {
            return;
        }

        // Throttle updates during drag for performance
        const now = Date.now();
        if (this._lastShadowUpdate && now - this._lastShadowUpdate < 50) {
            return; // Max 20fps for shadow updates
        }
        this._lastShadowUpdate = now;

        try {
            const imageCanvas = this._getImageCanvas();

            const shadowCanvas = this.advancedShadowProcessor.compute(
                this.depthMap,
                this.normalMap,
                imageCanvas,
                this.aoMap,
                {
                    lightPos: [lightPos.x, lightPos.y, lightPos.z || 0.8],
                    lightRadius: 0.08,         // Larger for more visible soft shadows
                    shadowIntensity: 0.95,     // Very strong shadows
                    contactDistance: 0.12,     // Larger contact shadow reach
                    pcfSamples: 8,
                    raymarchSteps: 20,         // More steps for quality
                    colorBleedAmount: 0.15
                }
            );

            this.shadowMap = {
                canvas: shadowCanvas,
                width: shadowCanvas.width,
                height: shadowCanvas.height
            };
        } catch (e) {
            console.warn('⚠️ Shadow update failed:', e.message);
        }
    }

    /**
     * Run ML-based normal estimation (internal helper)
     */
    async _runNormalEstimation(imageData) {
        console.log('🗺️ Running ML normal estimation...');
        try {
            const normalMap = await this.normalEstimator.estimate(imageData);
            console.log(`✅ ML Normals: ${normalMap.width}×${normalMap.height}`);
            return normalMap;
        } catch (error) {
            console.warn('⚠️ ML normal estimation failed, will use depth-derived:', error.message);
            return null;
        }
    }


    /**
     * Compare all available depth models on the current image
     * Downloads and runs each model, then exports all results for comparison
     */
    async compareDepthModels() {
        if (!this.app.state.hasImage) {
            alert('Please load an image first');
            return;
        }

        const btnCompare = document.getElementById('btn-compare-depth-models');
        const progressContainer = document.getElementById('depth-progress');
        const progressText = document.getElementById('depth-progress-text');
        const progressPercent = document.getElementById('depth-progress-percent');
        const progressBar = document.getElementById('depth-progress-bar');

        try {
            if (btnCompare) {
                btnCompare.disabled = true;
                btnCompare.textContent = '⏳ Running comparison...';
            }
            if (progressContainer) progressContainer.hidden = false;

            const comparison = new DepthModelComparison();
            const img = this.app.state.originalImage;

            console.log('🧪 Starting depth model comparison on all 6 models...');
            console.log(`Image size: ${img.width}×${img.height}`);
            console.log('This may take several minutes to download and run all models.\n');

            let currentModelIdx = 0;
            const totalModels = DEPTH_MODELS.length;

            const results = await comparison.runComparison(img, (modelId, status, progress) => {
                const modelInfo = DEPTH_MODELS.find(m => m.id === modelId);
                const modelName = modelInfo ? modelInfo.name : modelId;

                if (status === 'loading' && progress === 0) {
                    currentModelIdx++;
                }

                const overallProgress = ((currentModelIdx - 1) / totalModels * 100) + (progress / totalModels);

                if (progressText) progressText.textContent = `${modelName}: ${status}`;
                if (progressPercent) progressPercent.textContent = `${Math.round(overallProgress)}%`;
                if (progressBar) progressBar.style.width = `${overallProgress}%`;
            });

            // Show summary
            console.log('\n📊 COMPARISON RESULTS:');
            console.log('='.repeat(60));

            const successResults = results.filter(r => r.success);
            const failedResults = results.filter(r => !r.success);

            console.table(successResults.map(r => ({
                Model: r.model.name,
                Size: r.model.size,
                'Inference (ms)': r.inferenceTime.toFixed(0),
                'Total (ms)': r.totalTime.toFixed(0)
            })));

            if (failedResults.length > 0) {
                console.log('\n❌ Failed models:');
                failedResults.forEach(r => console.log(`  - ${r.model.name}: ${r.error}`));
            }

            // Export all results
            await comparison.exportResults();

            // Show comparison grid
            const grid = comparison.createComparisonGrid();
            if (grid) {
                const overlay = document.createElement('div');
                overlay.style.cssText = `
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.9); z-index: 10000;
                    display: flex; align-items: center; justify-content: center;
                    flex-direction: column; padding: 20px;
                `;

                grid.style.maxWidth = '95vw';
                grid.style.maxHeight = '80vh';
                grid.style.objectFit = 'contain';
                grid.style.borderRadius = '8px';

                const closeBtn = document.createElement('button');
                closeBtn.textContent = '✕ Close Comparison';
                closeBtn.style.cssText = `
                    margin-top: 20px; padding: 10px 24px; font-size: 14px;
                    background: #4a9eff; color: white; border: none; border-radius: 6px;
                    cursor: pointer;
                `;
                closeBtn.onclick = () => overlay.remove();

                const info = document.createElement('div');
                info.style.cssText = 'color: white; margin-bottom: 16px; font-size: 14px;';
                info.textContent = `Compared ${successResults.length}/${totalModels} models. Individual depth maps downloaded.`;

                overlay.appendChild(info);
                overlay.appendChild(grid);
                overlay.appendChild(closeBtn);
                document.body.appendChild(overlay);
            }

            alert(`Comparison complete!\n\n✅ ${successResults.length} models succeeded\n❌ ${failedResults.length} models failed\n\nDepth maps have been downloaded.`);

        } catch (error) {
            console.error('Comparison failed:', error);
            alert('Comparison failed: ' + error.message);
        } finally {
            if (btnCompare) {
                btnCompare.disabled = false;
                btnCompare.textContent = '🧪 Compare All Models';
            }
            if (progressContainer) {
                setTimeout(() => { progressContainer.hidden = true; }, 1000);
            }
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
     * Apply relighting effect permanently to the image
     * Bakes the current lighting into a new image
     * 
     * Uses PBR engine when available, falls back to old shading
     */
    async applyRelighting() {
        if (!this.relightingEffect || !this.relightingEffect.enabled) {
            console.warn('No relighting effect active');
            return;
        }

        const btnApply = document.getElementById('btn-apply-relight');
        const originalText = btnApply?.textContent;
        if (btnApply) {
            btnApply.textContent = '⏳ Rendering...';
            btnApply.disabled = true;
        }

        try {
            let exportCanvas;

            // WYSIWYG: Use the exact same canvas that the preview shows
            // This guarantees perfect match between preview and final output
            console.log('📋 Exporting preview canvas (WYSIWYG)...');
            exportCanvas = this.relightingEffect.getExportCanvas();

            if (!exportCanvas) {
                throw new Error('Could not get export canvas');
            }

            // Convert to data URL
            const dataURL = exportCanvas.toDataURL('image/png');

            // Disable relighting effect first
            this.disableRelight();

            // Reset depth map and related data since we're applying new image
            this.depthMap = null;
            this.normalMap = null;
            this.aoMap = null;
            this.albedoMap = null;
            this.materialMap = null;

            // Load the relit image as the new original
            await this.app.loadImageFromURL(dataURL);

            // Hide controls until new depth is estimated
            const controls = document.getElementById('relight-controls');
            if (controls) controls.style.display = 'none';

            const debugViz = document.getElementById('debug-viz-controls');
            if (debugViz) debugViz.style.display = 'none';

            // Update button
            const btnEstimate = document.getElementById('btn-estimate-depth');
            if (btnEstimate) btnEstimate.textContent = 'Estimate Depth';

            console.log('✅ Relighting applied successfully');

            if (btnApply) {
                btnApply.textContent = '✅ Applied!';
                setTimeout(() => {
                    btnApply.textContent = originalText;
                    btnApply.disabled = false;
                }, 2000);
            }

        } catch (error) {
            console.error('Failed to apply relighting:', error);
            alert('Failed to apply relighting: ' + error.message);

            if (btnApply) {
                btnApply.textContent = originalText;
                btnApply.disabled = false;
            }
        }
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
