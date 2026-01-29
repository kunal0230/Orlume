/**
 * GPUBackend - Abstract interface for GPU rendering backends
 * 
 * This interface defines the contract that both WebGL2 and WebGPU
 * implementations must follow, enabling seamless fallback.
 */

/**
 * @typedef {Object} TextureHandle
 * @property {number} width
 * @property {number} height
 * @property {any} _internal - Backend-specific texture object
 */

/**
 * @typedef {Object} FramebufferHandle
 * @property {TextureHandle} texture
 * @property {any} _internal - Backend-specific framebuffer object
 */

/**
 * @typedef {Object} ShaderProgram
 * @property {string} name
 * @property {any} _internal - Backend-specific program/pipeline object
 */

/**
 * Abstract GPU Backend class
 * All GPU backends must implement these methods
 */
export class GPUBackend {
    constructor(canvas) {
        this.canvas = canvas;
        this.width = 0;
        this.height = 0;
        this.isReady = false;
    }

    /**
     * Initialize the GPU context
     * @returns {Promise<boolean>} True if initialization succeeded
     */
    async init() {
        throw new Error('GPUBackend.init() must be implemented by subclass');
    }

    /**
     * Check if this backend is supported in current environment
     * @returns {Promise<boolean>}
     */
    static async isSupported() {
        throw new Error('GPUBackend.isSupported() must be implemented by subclass');
    }

    /**
     * Get the backend name
     * @returns {string}
     */
    getName() {
        throw new Error('GPUBackend.getName() must be implemented by subclass');
    }

    /**
     * Create a texture from image data
     * @param {HTMLImageElement|ImageData|HTMLCanvasElement} source
     * @returns {TextureHandle}
     */
    createTextureFromSource(source) {
        throw new Error('GPUBackend.createTextureFromSource() must be implemented by subclass');
    }

    /**
     * Create an empty texture for rendering
     * @param {number} width
     * @param {number} height
     * @returns {TextureHandle}
     */
    createTexture(width, height) {
        throw new Error('GPUBackend.createTexture() must be implemented by subclass');
    }

    /**
     * Create a framebuffer with attached texture
     * @param {number} width
     * @param {number} height
     * @returns {FramebufferHandle}
     */
    createFramebuffer(width, height) {
        throw new Error('GPUBackend.createFramebuffer() must be implemented by subclass');
    }

    /**
     * Compile and create a shader program
     * @param {string} name - Program name for caching
     * @param {string} vertexCode - Vertex shader source
     * @param {string} fragmentCode - Fragment shader source
     * @returns {ShaderProgram}
     */
    createShaderProgram(name, vertexCode, fragmentCode) {
        throw new Error('GPUBackend.createShaderProgram() must be implemented by subclass');
    }

    /**
     * Set canvas size and viewport
     * @param {number} width
     * @param {number} height
     */
    setSize(width, height) {
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
    }

    /**
     * Render using a shader program
     * @param {ShaderProgram} program
     * @param {Object} uniforms - Uniform values
     * @param {TextureHandle[]} textures - Input textures
     * @param {FramebufferHandle|null} target - Render target (null = canvas)
     */
    render(program, uniforms, textures, target = null) {
        throw new Error('GPUBackend.render() must be implemented by subclass');
    }

    /**
     * Read pixels from canvas
     * @returns {Uint8Array}
     */
    readPixels() {
        throw new Error('GPUBackend.readPixels() must be implemented by subclass');
    }

    /**
     * Convert canvas to ImageData
     * @returns {ImageData}
     */
    toImageData() {
        throw new Error('GPUBackend.toImageData() must be implemented by subclass');
    }

    /**
     * Delete a texture
     * @param {TextureHandle} texture
     */
    deleteTexture(texture) {
        throw new Error('GPUBackend.deleteTexture() must be implemented by subclass');
    }

    /**
     * Delete a framebuffer
     * @param {FramebufferHandle} framebuffer
     */
    deleteFramebuffer(framebuffer) {
        throw new Error('GPUBackend.deleteFramebuffer() must be implemented by subclass');
    }

    /**
     * Cleanup all resources
     */
    dispose() {
        throw new Error('GPUBackend.dispose() must be implemented by subclass');
    }
}

/**
 * Detect and create the best available GPU backend
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<GPUBackend>}
 */
export async function createBestBackend(canvas) {
    // Try WebGPU first (now that MaskSystemWebGPU exists)
    // const { WebGPUBackend } = await import('./WebGPUBackend.js');
    // if (await WebGPUBackend.isSupported()) {
    //     const backend = new WebGPUBackend(canvas);
    //     if (await backend.init()) {
    //         return backend;
    //     }
    // }

    // Fall back to WebGL2
    const { WebGL2Backend } = await import('./WebGL2Backend.js');
    if (await WebGL2Backend.isSupported()) {
        const backend = new WebGL2Backend(canvas);
        if (await backend.init()) {
            return backend;
        }
    }

    throw new Error('No GPU backend available. WebGL2 or WebGPU required.');
}
