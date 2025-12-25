/**
 * Orlume Vision Labs - Main Entry Point
 */

import { ImageUploader } from './components/ImageUploader.js';
import { Toolbar } from './components/Toolbar.js';
import { ControlPanel } from './components/ControlPanel.js';
import { CanvasManager } from './renderer/CanvasManager.js';
import { DepthEstimator } from './ml/DepthEstimator.js';
import { SceneManager } from './renderer/SceneManager.js';
import { ParallaxEffect } from './effects/ParallaxEffect.js';
import { RelightingEffect } from './effects/RelightingEffect.js';
import { ImageProcessor } from './core/ImageProcessor.js';

import { TransformTool } from './components/TransformTool.js';

import { HistoryManager } from './core/HistoryManager.js';
import { Histogram } from './components/Histogram.js';
import { ImageDevelopment } from './core/ImageDevelopment.js';
import { ToneCurve } from './components/ToneCurve.js';
import { ColorMixer } from './components/ColorMixer.js';
import { ColorGrading } from './components/ColorGrading.js';
import { GeometryPanel } from './components/GeometryPanel.js';
import { TextManager } from './core/TextManager.js';
import { TextTool } from './components/TextTool.js';
import { TextPanel } from './components/TextPanel.js';

class OrlumeApp {
    constructor() {
        this.state = {
            image: null,
            depthMap: null,
            currentTool: 'select',
            isProcessing: false,
            is3DMode: false,
        };

        // Cache original image data for non-destructive develop adjustments
        this.originalImageData = null;

        // Preview resolution system for fast live edits
        this.previewImageData = null;  // Downscaled for instant response
        this.previewScale = 1;          // Scale factor for preview
        this.previewPending = false;    // RAF flag for smooth updates

        this.components = {};
        this.imageProcessor = new ImageProcessor();
        this.init();
    }

    async init() {
        await this.checkGPUSupport();

        this.history = new HistoryManager(this);
        this.components.uploader = new ImageUploader(this);
        this.components.toolbar = new Toolbar(this);
        this.components.canvas = new CanvasManager(this);
        this.components.transformTool = new TransformTool(this, this.components.canvas);
        this.components.depthEstimator = new DepthEstimator(this);
        this.components.scene = new SceneManager(this);
        this.components.parallax = new ParallaxEffect(this);
        this.components.relighting = new RelightingEffect(this);
        this.components.controlPanel = new ControlPanel(this);
        this.components.histogram = new Histogram('histogram-canvas');
        this.components.develop = new ImageDevelopment();
        this.components.toneCurve = new ToneCurve('tone-curve-canvas');
        this.components.colorMixer = new ColorMixer(this);
        this.components.colorMixer = new ColorMixer(this);
        this.components.colorGrading = new ColorGrading(this);

        // Geometry Engine
        this.components.geometryPanel = new GeometryPanel(this);
        this.components.geometryPanel.init();

        // Text Tool System
        this.textManager = new TextManager(this);
        this.components.textTool = new TextTool(this);
        this.components.textPanel = new TextPanel(this);
        this.components.textPanel.init();

        // Connect tone curve to develop pipeline
        this.components.toneCurve.onChange = (luts) => {
            this.components.develop.setCurveLUTs(luts);
            this.updateDevelopPreview();
        };

        this.bindEvents();

        console.log('🌟 Orlume Vision Labs initialized');
    }

    async checkGPUSupport() {
        const statusGpu = document.getElementById('status-gpu');
        const indicator = statusGpu.querySelector('.gpu-indicator');

        if (!navigator.gpu) {
            statusGpu.innerHTML = '<span class="gpu-indicator error"></span> WebGPU not supported (using CPU)';
            return false;
        }

        // Timeout wrapper to prevent infinite hang
        const timeout = (ms) => new Promise((_, reject) =>
            setTimeout(() => reject(new Error('GPU check timed out')), ms)
        );

        try {
            const adapter = await Promise.race([
                navigator.gpu.requestAdapter(),
                timeout(3000) // 3 second timeout
            ]);
            if (!adapter) throw new Error('No GPU adapter');

            await Promise.race([
                adapter.requestDevice(),
                timeout(3000)
            ]);
            indicator.classList.add('active');
            statusGpu.innerHTML = '<span class="gpu-indicator active"></span> WebGPU Ready';
            return true;
        } catch (e) {
            console.warn('WebGPU not available:', e.message);
            indicator.classList.add('error');
            statusGpu.innerHTML = '<span class="gpu-indicator error"></span> CPU Mode';
            return false;
        }
    }

    bindEvents() {
        document.getElementById('btn-new').addEventListener('click', () => this.reset());
        document.getElementById('btn-export').addEventListener('click', () => this.exportImage());
        document.getElementById('btn-undo').addEventListener('click', () => this.handleUndo());
        document.getElementById('btn-redo').addEventListener('click', () => this.handleRedo());
    }

    handleUndo() {
        const state = this.history.undo();
        if (state) this.restoreState(state);
    }

    handleRedo() {
        const state = this.history.redo();
        if (state) this.restoreState(state);
    }

    restoreState(state) {
        this.state.image = state.image;
        this.state.depthMap = state.depthMap;

        // Restore canvas
        this.components.canvas.setImage(state.image);
        if (state.depthMap) {
            this.components.canvas.setDepthMap(state.depthMap);

            // Respect tool visibility rules
            const showDepthOverlay = ['depth', 'relight', 'parallax'].includes(this.state.currentTool);
            this.components.canvas.setDepthVisible(showDepthOverlay);

            if (this.state.currentTool === 'depth') {
                document.getElementById('depth-section').hidden = false;
            }
        } else {
            document.getElementById('depth-section').hidden = true;
            this.components.canvas.clearDepth();
        }

        // Refresh active views
        if (this.state.is3DMode) {
            this.components.scene.createMesh();
        }

        // If relighting is active
        if (this.components.relighting && this.components.relighting.enabled) {
            this.components.relighting.updateCanvasSize();
            this.components.relighting.render(true);
        }

        // If Transform tool is active, re-initialize it
        if (this.state.currentTool === 'transform') {
            this.components.transformTool.activate();
        }
    }

    pushHistory() {
        this.history.push({
            image: this.state.image,
            depthMap: this.state.depthMap
        });
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };

        // Update Histogram if image changed
        if (newState.image) {
            console.log('[App] Image state changed, updating histogram...');
            if (this.components.histogram) {
                this.components.histogram.update(newState.image);
            } else {
                console.warn('[App] Histogram component not active');
            }
        }

        // Notify components of state change if needed
        if (newState.image) {
            // ...
        }
    }

    async loadImage(file) {
        this.showLoading('Loading image...');

        try {
            // Use ImageProcessor for proxy-based loading
            const proxy = await this.imageProcessor.processFile(file);
            this.originalImageData = null; // Clear develop cache for new image
            this.previewImageData = null;  // Clear preview cache
            this.setState({ image: proxy, depthMap: null });

            // Initial History Push
            this.pushHistory();

            document.getElementById('upload-screen').hidden = true;
            document.getElementById('editor-canvas').hidden = false;
            document.getElementById('btn-export').disabled = false;

            this.components.canvas.setImage(proxy);

            // Show image info with proxy indicator
            const info = this.imageProcessor.getInfo();
            const sizeText = info.isProxy
                ? `${info.originalWidth} × ${info.originalHeight} (editing at ${info.proxyWidth}×${info.proxyHeight})`
                : `${info.originalWidth} × ${info.originalHeight}`;
            document.getElementById('info-size').textContent = sizeText;
            document.getElementById('info-format').textContent = file.type.split('/')[1].toUpperCase();

            this.hideLoading();

            if (info.isProxy) {
                this.setStatus(`Loaded: ${file.name} (using optimized proxy for editing)`);
            } else {
                this.setStatus(`Loaded: ${file.name}`);
            }

            // Start with Select tool (default)
            this.setTool('select');

        } catch (error) {
            console.error('Failed to load image:', error);
            this.hideLoading();
            this.setStatus('Error loading image');
        }
    }

    async estimateDepth() {
        if (!this.state.image) return;

        this.setState({ isProcessing: true });

        try {
            const depthMap = await this.components.depthEstimator.estimate(this.state.image);
            this.setState({ depthMap, isProcessing: false });

            // Push history after depth estimation
            this.pushHistory();

            document.getElementById('depth-controls').hidden = false;
            this.components.canvas.setDepthMap(depthMap);

            this.setStatus('Depth estimation complete');

        } catch (error) {
            console.error('Depth estimation failed:', error);
            this.setState({ isProcessing: false });
            this.setStatus('Depth estimation failed');
        }
    }

    setTool(tool) {
        this.setState({ currentTool: tool });
        document.getElementById('status-tool').textContent = this.getToolName(tool);

        document.querySelectorAll('.panel-section').forEach(section => {
            if (section.id !== 'info-section') section.hidden = true;
        });

        // Manage Depth Overlay Visibility
        const showDepthOverlay = ['depth', 'relight'].includes(tool);
        if (showDepthOverlay && this.state.depthMap) {
            this.components.canvas.setDepthVisible(true);
        } else {
            this.components.canvas.setDepthVisible(false);
        }

        switch (tool) {
            case 'depth':
                document.getElementById('depth-section').hidden = false;
                break;
            case 'relight':
                if (this.state.depthMap) {
                    document.getElementById('relight-section').hidden = false;
                    this.components.relighting.enable();
                } else {
                    this.setStatus('Estimate depth first');
                }
                break;
            case '3d':
                if (this.state.depthMap) {
                    document.getElementById('view3d-section').hidden = false;
                    this.toggle3DMode(true);
                } else {
                    this.setStatus('Estimate depth first');
                }
                break;
            case 'parallax':
                if (this.state.depthMap) {
                    document.getElementById('parallax-section').hidden = false;
                    this.components.parallax.enable();
                } else {
                    this.setStatus('Estimate depth first');
                }
                break;
            case 'transform':
                if (this.state.image) {
                    document.getElementById('transform-section').hidden = false;
                    this.components.transformTool.activate();
                }
                break;
            case 'develop':
                document.getElementById('develop-section').hidden = false;
                break;
            case 'geometry':
                if (this.state.image) {
                    document.getElementById('geometry-section').hidden = false;
                    this.components.geometryPanel.activate();
                }
                break;
            case 'text':
                if (this.state.image) {
                    document.getElementById('text-section').hidden = false;
                    this.components.textTool.activate();
                    this.components.textPanel.activate();
                }
                break;
        }
    }

    getToolName(tool) {
        const names = {
            select: 'Select Tool',
            depth: 'Depth Estimation',
            relight: 'Relighting',
            '3d': '3D View',
            parallax: 'Parallax Effect',
            transform: 'Crop & Transform',
            geometry: 'Geometry',
            text: 'Text',
            develop: 'Develop'
        };
        return names[tool] || 'Unknown';
    }

    toggle3DMode(enabled) {
        this.setState({ is3DMode: enabled });

        if (enabled) {
            this.components.scene.enable();
            document.getElementById('three-canvas').classList.add('visible');
            document.getElementById('main-canvas').style.display = 'none';
            document.getElementById('depth-canvas').style.display = 'none';
        } else {
            this.components.scene.disable();
            document.getElementById('three-canvas').classList.remove('visible');
            document.getElementById('main-canvas').style.display = 'block';
            document.getElementById('depth-canvas').style.display = 'block';
        }
    }

    async exportImage() {
        const info = this.imageProcessor.getInfo();

        // Strict WYSIWYG Export
        // We export exactly what is on the canvas to avoid alignment issues with the proxy/full-res mismatch.

        let canvasToExport = document.getElementById('main-canvas');

        if (this.state.is3DMode) {
            canvasToExport = document.getElementById('three-canvas');
        } else if (this.components.relighting && this.components.relighting.enabled) {
            // Relighting effect is active
            // Get clean canvas without UI indicators
            canvasToExport = this.components.relighting.getExportCanvas();

            // Re-render immediately after to restore indicators
            setTimeout(() => {
                this.components.relighting.render();
            }, 50);
        }

        // Use blob-based approach for reliable downloads
        canvasToExport.toBlob((blob) => {
            if (!blob) {
                this.setStatus('Export failed - could not create image');
                return;
            }

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `orlume-export-${Date.now()}.png`;

            // Append to body, click, then remove (more reliable)
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up blob URL after download starts
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            this.setStatus('Image exported');
        }, 'image/png');
    }

    async applyRelighting() {
        if (!this.components.relighting.enabled) return;

        this.showLoading('Applying lighting...');

        try {
            // 1. Get the relit canvas
            const relitCanvas = this.components.relighting.getExportCanvas();

            if (!relitCanvas) {
                console.warn('No relit canvas available');
                this.hideLoading();
                return;
            }

            // 2. Push history state BEFORE modifying the image
            this.pushHistory();

            // 3. Create a new image from the canvas content
            const newDataUrl = relitCanvas.toDataURL('image/png');
            const newImage = new Image();

            newImage.onload = () => {
                try {
                    // 3b. Generate ImageData (Critical for effects like Relighting/Parallax)
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = newImage.width;
                    tempCanvas.height = newImage.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(newImage, 0, 0);
                    const newImageData = tempCtx.getImageData(0, 0, newImage.width, newImage.height);

                    // 4. Update Application State - Create a proxy-like object for consistency
                    const newProxy = {
                        width: newImage.width,
                        height: newImage.height,
                        canvas: newImage,
                        imageData: newImageData, // Added missing ImageData
                        ctx: tempCtx, // Store context just in case
                        isProxy: this.state.image.isProxy,
                        originalWidth: this.state.image.originalWidth,
                        originalHeight: this.state.image.originalHeight
                    };

                    this.state.image = newProxy;

                    // 5. Update Visuals
                    this.components.canvas.setImage(newProxy);

                    // 6. Reset Relighting Effect (clear lights)
                    this.components.relighting.resetLights();

                    this.setStatus('Relighting applied');
                } catch (err) {
                    console.error('Error applying relighting state:', err);
                    this.setStatus('Error applying lighting');
                } finally {
                    this.hideLoading();
                }
            };

            newImage.onerror = (err) => {
                console.error('Failed to load relit image:', err);
                this.setStatus('Error processing lighting result');
                this.hideLoading();
            };

            newImage.src = newDataUrl;

        } catch (error) {
            console.error('applyRelighting error:', error);
            this.setStatus('Error applying lighting');
            this.hideLoading();
        }
    }

    /**
     * Update develop preview (non-destructive, real-time)
     * Uses preview resolution for instant response
     */
    updateDevelopPreview() {
        if (!this.state.image || !this.components.develop) return;

        // Use RAF to prevent frame drops
        if (this.previewPending) return;
        this.previewPending = true;

        requestAnimationFrame(() => {
            this._doPreviewUpdate();
            this.previewPending = false;
        });
    }

    /**
     * Internal preview update - processes at preview resolution
     */
    _doPreviewUpdate() {
        const img = this.state.image;

        // Create/cache preview resolution image (max 600px for instant response)
        if (!this.previewImageData) {
            const MAX_PREVIEW_SIZE = 600;
            const maxDim = Math.max(img.width, img.height);

            if (maxDim > MAX_PREVIEW_SIZE) {
                this.previewScale = MAX_PREVIEW_SIZE / maxDim;
                const pw = Math.round(img.width * this.previewScale);
                const ph = Math.round(img.height * this.previewScale);

                // Downscale for preview
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = pw;
                tempCanvas.height = ph;
                const ctx = tempCanvas.getContext('2d');
                ctx.drawImage(img.canvas || img, 0, 0, pw, ph);
                this.previewImageData = ctx.getImageData(0, 0, pw, ph);
            } else {
                this.previewScale = 1;
                // Use original resolution
                if (img.imageData) {
                    this.previewImageData = new ImageData(
                        new Uint8ClampedArray(img.imageData.data),
                        img.imageData.width,
                        img.imageData.height
                    );
                } else {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = img.width;
                    tempCanvas.height = img.height;
                    const ctx = tempCanvas.getContext('2d');
                    ctx.drawImage(img.canvas || img, 0, 0);
                    this.previewImageData = ctx.getImageData(0, 0, img.width, img.height);
                }
            }
        }

        // Cache full-res original for Apply (lazy load)
        if (!this.originalImageData) {
            if (img.imageData) {
                this.originalImageData = new ImageData(
                    new Uint8ClampedArray(img.imageData.data),
                    img.imageData.width,
                    img.imageData.height
                );
            } else {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                const ctx = tempCanvas.getContext('2d');
                ctx.drawImage(img.canvas || img, 0, 0);
                this.originalImageData = ctx.getImageData(0, 0, img.width, img.height);
            }
        }

        // Process at preview resolution (fast!)
        const processedData = this.components.develop.apply(this.previewImageData);

        // Scale up for display
        const displayCanvas = document.createElement('canvas');
        displayCanvas.width = img.width;
        displayCanvas.height = img.height;
        const ctx = displayCanvas.getContext('2d');

        // Draw processed preview, scaled up
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = processedData.width;
        previewCanvas.height = processedData.height;
        previewCanvas.getContext('2d').putImageData(processedData, 0, 0);

        // Scale up with smooth interpolation
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(previewCanvas, 0, 0, img.width, img.height);

        // Create proxy for display
        const previewProxy = {
            width: img.width,
            height: img.height,
            canvas: displayCanvas,
            imageData: ctx.getImageData(0, 0, img.width, img.height),
            isProxy: img.isProxy,
            originalWidth: img.originalWidth,
            originalHeight: img.originalHeight
        };

        // Update canvas display
        this.components.canvas.setImage(previewProxy);

        // Update histogram
        this.components.histogram?.update(previewProxy);
    }

    /**
     * Apply develop settings permanently
     */
    applyDevelopSettings() {
        if (!this.originalImageData || !this.components.develop) return;
        if (!this.components.develop.hasChanges()) {
            this.setStatus('No changes to apply');
            return;
        }

        this.showLoading('Applying adjustments...');

        try {
            // Apply final adjustments
            const processedData = this.components.develop.apply(this.originalImageData);

            // Create permanent canvas
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = processedData.width;
            finalCanvas.height = processedData.height;
            const ctx = finalCanvas.getContext('2d');
            ctx.putImageData(processedData, 0, 0);

            // Push history BEFORE applying
            this.pushHistory();

            // Create new proxy
            const newProxy = {
                width: finalCanvas.width,
                height: finalCanvas.height,
                canvas: finalCanvas,
                imageData: processedData,
                isProxy: this.state.image.isProxy,
                originalWidth: this.state.image.originalWidth,
                originalHeight: this.state.image.originalHeight
            };

            // Update state
            this.state.image = newProxy;
            this.originalImageData = null; // Clear cache to use new image as base
            this.previewImageData = null;  // Clear preview cache

            // Update canvas
            this.components.canvas.setImage(newProxy);

            // Reset develop sliders and component
            this.components.develop.reset();
            this.components.controlPanel._resetDevelopSliders();

            // Update histogram
            this.components.histogram?.update(newProxy);

            this.setStatus('Adjustments applied');
        } catch (error) {
            console.error('Apply develop error:', error);
            this.setStatus('Error applying adjustments');
        } finally {
            this.hideLoading();
        }
    }

    reset() {
        this.history.undoStack = []; // Clear history
        this.history.redoStack = [];
        this.history.updateUI();

        this.setState({
            image: null,
            depthMap: null,
            currentTool: 'select',
            is3DMode: false,
        });

        document.getElementById('upload-screen').hidden = false;
        document.getElementById('editor-canvas').hidden = true;
        document.getElementById('btn-export').disabled = true;
        document.getElementById('depth-section').hidden = true;
        document.getElementById('depth-controls').hidden = true;

        this.components.canvas.clear();
        this.components.scene.disable();

        this.setStatus('Ready');
    }

    showLoading(text = 'Processing...') {
        document.getElementById('loading-text').textContent = text;
        document.getElementById('loading-overlay').hidden = false;
    }

    hideLoading() {
        document.getElementById('loading-overlay').hidden = true;
    }

    setStatus(message) {
        document.getElementById('status-message').textContent = message;
        setTimeout(() => {
            document.getElementById('status-message').textContent = '';
        }, 3000);
    }

    updateProgress(percent, text) {
        document.getElementById('depth-progress-fill').style.width = `${percent}%`;
        document.getElementById('depth-progress-text').textContent = text;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.orlume = new OrlumeApp();

    // Panel resize functionality
    const panel = document.getElementById('control-panel');
    const handle = document.getElementById('panel-resize-handle');

    if (panel && handle) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        // Restore saved width
        const savedWidth = localStorage.getItem('orlume-panel-width');
        if (savedWidth) {
            panel.style.width = savedWidth + 'px';
        }

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            handle.classList.add('active');
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            // Calculate new width (dragging left = increase width)
            const deltaX = startX - e.clientX;
            const newWidth = Math.min(500, Math.max(280, startWidth + deltaX));

            panel.style.width = newWidth + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                handle.classList.remove('active');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';

                // Save width preference
                localStorage.setItem('orlume-panel-width', panel.offsetWidth);
            }
        });
    }
});
