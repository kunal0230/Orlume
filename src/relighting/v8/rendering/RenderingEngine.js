/**
 * RenderingEngine.js - Abstract Rendering Interface
 *
 * Factory pattern for automatic backend selection:
 * - WebGPU (primary) - Chrome/Edge 113+
 * - WebGL2 (fallback) - All modern browsers
 *
 * Usage:
 *   const renderer = await RenderingEngine.create();
 *   const canvas = renderer.render(gBuffer, light);
 */

/**
 * Abstract interface all renderers must implement
 * @interface
 */
export class RenderingEngine {
    constructor() {
        if (new.target === RenderingEngine) {
            throw new Error('RenderingEngine is abstract - use RenderingEngine.create()');
        }

        this.isInitialized = false;
        this.canvas = null;
        this.backend = 'unknown';
    }

    /**
     * Initialize the renderer
     * @returns {Promise<boolean>} Success
     */
    async init() {
        throw new Error('init() must be implemented by subclass');
    }

    /**
     * Render with deferred lighting
     * @param {Object} gBuffer - G-Buffer with albedo, normals, depth
     * @param {Object} light - Light parameters
     * @returns {HTMLCanvasElement|OffscreenCanvas}
     */
    render(gBuffer, light) {
        throw new Error('render() must be implemented by subclass');
    }

    /**
     * Read pixels from rendered output
     * @returns {ImageData}
     */
    readPixels() {
        throw new Error('readPixels() must be implemented by subclass');
    }

    /**
     * Get renderer capabilities
     * @returns {Object} Capabilities info
     */
    getCapabilities() {
        return {
            backend: this.backend,
            maxTextureSize: 0,
            supportsFloat: false,
            supportsCompute: false,
            supportsPCSS: false,
        };
    }

    /**
     * Dispose of GPU resources
     */
    dispose() {
        throw new Error('dispose() must be implemented by subclass');
    }

    /**
     * Factory method - creates best available renderer
     * @returns {Promise<RenderingEngine>}
     */
    static async create() {
        // Try WebGPU first (best quality)
        if (await RenderingEngine.isWebGPUSupported()) {
            try {
                const { WebGPURenderer } = await import('./WebGPURenderer.js');
                const renderer = new WebGPURenderer();
                const success = await renderer.init();

                if (success) {
                    console.log('✓ Using WebGPU renderer (primary)');
                    return renderer;
                }
            } catch (error) {
                console.warn('WebGPU renderer failed to initialize:', error.message);
            }
        }

        // Fallback to WebGL2
        const { WebGL2DeferredRenderer } = await import('./WebGL2DeferredRenderer.js');
        const renderer = new WebGL2DeferredRenderer();
        const success = await renderer.init();

        if (success) {
            console.log('⚡ Using WebGL2 renderer (fallback)');
            return renderer;
        }

        throw new Error('No GPU renderer available');
    }

    /**
     * Check if WebGPU is supported
     * @returns {Promise<boolean>}
     */
    static async isWebGPUSupported() {
        if (!navigator.gpu) {
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                return false;
            }

            // Check for required features
            const device = await adapter.requestDevice();
            if (!device) {
                return false;
            }

            // Cleanup test device
            device.destroy();
            return true;
        } catch (error) {
            console.warn('WebGPU check failed:', error);
            return false;
        }
    }

    /**
     * Check if WebGL2 is supported
     * @returns {boolean}
     */
    static isWebGL2Supported() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2');
            return gl !== null;
        } catch {
            return false;
        }
    }
}

export default RenderingEngine;
