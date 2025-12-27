/**
 * EditorApp - Main application entry point for the GPU Editor
 * Coordinates between state, UI, and GPU processing
 */
import { GPUProcessor } from '../gpu/GPUProcessor.js';
import { MaskSystem } from '../gpu/MaskSystem.js';
import { EditorState } from './EditorState.js';
import { EditorUI } from './EditorUI.js';
import { RelightingManager } from './RelightingManager.js';

export class EditorApp {
    constructor() {
        this.canvas = document.getElementById('gpu-canvas');
        this.gpu = null;
        this.masks = null;
        this.state = null;
        this.ui = null;
        this.relighting = null;
    }

    /**
     * Initialize the editor application
     */
    async init() {
        console.log('🚀 Initializing Orlume GPU Editor...');

        try {
            // Initialize GPU processor (async - detects WebGPU/WebGL2)
            this.gpu = new GPUProcessor(this.canvas);
            await this.gpu.init();

            // Initialize mask system
            this.masks = new MaskSystem(this.gpu);

            // Initialize state management
            this.state = new EditorState();

            // Initialize UI
            this.ui = new EditorUI(this.state, this.gpu, this.masks);

            // Initialize 3D Relighting
            this.relighting = new RelightingManager(this);

            // Give UI access to app for relighting control
            this.ui.app = this;

            // Subscribe to state events
            this._bindStateEvents();

            // Initial UI setup
            this.ui.updateBrushCursor();
            this.ui.updateBrushPreview();

            console.log('✅ GPU Editor initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize GPU Editor:', error);
            this._showError('Failed to initialize GPU processing. Your browser may not support WebGL2.');
            return false;
        }
    }

    /**
     * Bind state change events
     */
    _bindStateEvents() {
        // React to image load
        this.state.on('imageLoad', ({ image }) => {
            console.log(`📷 Image loaded: ${image.width}×${image.height}`);
        });

        // React to tool changes
        this.state.on('toolChange', ({ tool }) => {
            console.log(`🔧 Tool changed to: ${tool}`);
        });

        // React to reset
        this.state.on('reset', () => {
            console.log('🔄 Adjustments reset');
        });
    }

    /**
     * Show error message to user
     */
    _showError(message) {
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) {
            dropZone.innerHTML = `
                <div style="color: #ef4444; text-align: center; padding: 40px;">
                    <h3>⚠️ Error</h3>
                    <p>${message}</p>
                </div>
            `;
        }
    }

    /**
     * Get current state snapshot
     */
    getState() {
        return this.state.getSnapshot();
    }

    /**
     * Load an image from a URL
     */
    async loadImageFromURL(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.state.setImage(img);
                this.gpu.loadImage(img);
                document.getElementById('drop-zone')?.classList.add('hidden');
                document.getElementById('perf').textContent = `${img.width}×${img.height}`;
                setTimeout(() => this.ui.renderHistogram(), 100);
                resolve(img);
            };
            img.onerror = reject;
            img.src = url;
        });
    }
}

/**
 * Initialize app on DOM ready
 */
export async function initApp() {
    const app = new EditorApp();
    const success = await app.init();

    if (success) {
        // Expose app globally for debugging
        window.orlumeApp = app;
    }

    return app;
}
