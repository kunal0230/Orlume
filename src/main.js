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
        this.init();
    }

    async init() {
        await this.checkGPUSupport();

        this.components.uploader = new ImageUploader(this);
        this.components.toolbar = new Toolbar(this);
        this.components.controlPanel = new ControlPanel(this);
        this.components.canvas = new CanvasManager(this);
        this.components.depthEstimator = new DepthEstimator(this);
        this.components.scene = new SceneManager(this);
        this.components.parallax = new ParallaxEffect(this);
        this.components.relighting = new RelightingEffect(this);

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
    }

    setState(updates) {
        Object.assign(this.state, updates);
    }

    async loadImage(file) {
        this.showLoading('Loading image...');

        try {
            const image = await this.components.uploader.processFile(file);
            this.setState({ image, depthMap: null });

            document.getElementById('upload-screen').hidden = true;
            document.getElementById('editor-canvas').hidden = false;
            document.getElementById('btn-export').disabled = false;

            this.components.canvas.setImage(image);

            document.getElementById('info-size').textContent = `${image.width} × ${image.height}`;
            document.getElementById('info-format').textContent = file.type.split('/')[1].toUpperCase();

            this.hideLoading();
            this.setStatus(`Loaded: ${file.name}`);

            document.getElementById('depth-section').hidden = false;

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
        }
    }

    getToolName(tool) {
        const names = {
            select: 'Select Tool',
            depth: 'Depth Estimation',
            relight: 'Relighting',
            '3d': '3D View',
            parallax: 'Parallax Effect',
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
        const canvas = this.state.is3DMode
            ? document.getElementById('three-canvas')
            : document.getElementById('main-canvas');

        const link = document.createElement('a');
        link.download = `kilonova-export-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        this.setStatus('Image exported');
    }

    reset() {
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
