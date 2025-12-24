/**
 * Kilonova Photo Editor - Main Entry Point
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

class KilonovaApp {
    constructor() {
        this.state = {
            image: null,
            depthMap: null,
            currentTool: 'select',
            isProcessing: false,
            is3DMode: false,
        };

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

        this.bindEvents();

        console.log('🌟 Kilonova Photo Editor initialized');
    }

    async checkGPUSupport() {
        const statusGpu = document.getElementById('status-gpu');
        const indicator = statusGpu.querySelector('.gpu-indicator');

        if (!navigator.gpu) {
            statusGpu.innerHTML = '<span class="gpu-indicator error"></span> WebGPU not supported';
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) throw new Error('No GPU adapter');

            await adapter.requestDevice();
            indicator.classList.add('active');
            statusGpu.innerHTML = '<span class="gpu-indicator active"></span> WebGPU Ready';
            return true;
        } catch (e) {
            indicator.classList.add('error');
            statusGpu.innerHTML = '<span class="gpu-indicator error"></span> GPU Error';
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

    setState(updates) {
        Object.assign(this.state, updates);
    }

    async loadImage(file) {
        this.showLoading('Loading image...');

        try {
            // Use ImageProcessor for proxy-based loading
            const proxy = await this.imageProcessor.processFile(file);
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
        }
    }

    getToolName(tool) {
        const names = {
            select: 'Select Tool',
            depth: 'Depth Estimation',
            relight: 'Relighting',
            '3d': '3D View',
            parallax: 'Parallax Effect',
            transform: 'Crop & Transform' // Added better name
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

        const link = document.createElement('a');
        link.download = `kilonova-export-${Date.now()}.png`;
        link.href = canvasToExport.toDataURL('image/png');
        link.click();
        this.setStatus('Image exported');
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
    window.kilonova = new KilonovaApp();
});
