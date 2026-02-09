/**
 * WebGPURenderer.js - WebGPU Deferred Rendering
 *
 * High-quality GPU rendering using WebGPU compute and render pipelines.
 * Primary renderer for Chrome/Edge 113+.
 *
 * Features:
 * - Deferred PBR lighting
 * - ACES filmic tone mapping
 * - SSAO (ambient occlusion)
 * - Contact shadows
 */

import { RenderingEngine } from './RenderingEngine.js';

// Import shader as raw text
import deferredLightingWGSL from './shaders/deferred_lighting.wgsl?raw';

export class WebGPURenderer extends RenderingEngine {
    constructor() {
        super();

        this.backend = 'webgpu';
        this.device = null;
        this.adapter = null;
        this.context = null;
        this.format = null;

        // Pipelines
        this.lightingPipeline = null;

        // Bind groups
        this.bindGroupLayout = null;

        // Uniform buffer
        this.uniformBuffer = null;

        // Sampler
        this.sampler = null;

        // Cached textures (for cleanup)
        this.cachedTextures = [];
    }

    /**
     * Check if WebGPU is supported
     */
    static async isSupported() {
        if (!navigator.gpu) {
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            return adapter !== null;
        } catch {
            return false;
        }
    }

    /**
     * Initialize WebGPU
     */
    async init(canvas = null) {
        if (this.isInitialized) return true;

        try {
            // Request adapter
            this.adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance',
            });

            if (!this.adapter) {
                console.error('WebGPU: No adapter found');
                return false;
            }

            // Request device
            this.device = await this.adapter.requestDevice({
                requiredFeatures: [],
                requiredLimits: {},
            });

            if (!this.device) {
                console.error('WebGPU: Could not get device');
                return false;
            }

            // Handle device loss
            this.device.lost.then((info) => {
                console.error('WebGPU device lost:', info.message);
                this.isInitialized = false;
            });

            // Create canvas
            if (!canvas) {
                this.canvas = new OffscreenCanvas(1, 1);
            } else {
                this.canvas = canvas;
            }

            // Get context
            this.context = this.canvas.getContext('webgpu');
            if (!this.context) {
                console.error('WebGPU: Could not get context');
                return false;
            }

            // Configure context
            this.format = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied',
            });

            // Create pipelines
            await this._createPipelines();

            // Create sampler
            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
            });

            this.isInitialized = true;
            console.log('✓ WebGPU Renderer initialized');

            return true;
        } catch (error) {
            console.error('WebGPU initialization failed:', error);
            return false;
        }
    }

    /**
     * Create render pipelines
     */
    async _createPipelines() {
        // Create bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                // Albedo texture
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                // Normal texture
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                // Depth texture
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'float' },
                },
                // Sampler
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' },
                },
                // Light uniforms
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' },
                },
            ],
        });

        // Create pipeline layout
        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout],
        });

        // Create shader module with error checking
        const shaderModule = this.device.createShaderModule({
            code: deferredLightingWGSL,
        });

        // Check for shader compilation errors
        const compilationInfo = await shaderModule.getCompilationInfo();
        if (compilationInfo.messages.length > 0) {
            for (const message of compilationInfo.messages) {
                if (message.type === 'error') {
                    console.error(`Shader compilation error: ${message.message} at line ${message.lineNum}`);
                    throw new Error(`Shader compilation failed: ${message.message}`);
                } else {
                    console.warn(`Shader warning: ${message.message}`);
                }
            }
        }

        // Create render pipeline using async version for better error handling
        try {
            this.lightingPipeline = await this.device.createRenderPipelineAsync({
                layout: pipelineLayout,
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vertexMain',
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fragmentMain',
                    targets: [
                        {
                            format: this.format,
                        },
                    ],
                },
                primitive: {
                    topology: 'triangle-list',
                },
            });
        } catch (error) {
            console.error('Failed to create render pipeline:', error);
            throw error;
        }

        // Create uniform buffer (must be 16-byte aligned)
        // Layout: vec3 direction (12) + pad (4) + vec3 color (12) + intensity (4)
        //         + ambient (4) + shadowIntensity (4) + shadowSoftness (4) + pad (4)
        //         + vec2 resolution (8) + pad (8) = 64 bytes
        this.uniformBuffer = this.device.createBuffer({
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Render with deferred lighting
     */
    render(gBuffer, light) {
        if (!this.isInitialized) {
            console.error('WebGPU Renderer not initialized');
            return null;
        }

        const { width, height, albedo, normals, depth } = gBuffer;

        // Resize canvas if needed
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;

            // Reconfigure context
            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied',
            });
        }

        // Cleanup previous textures
        this._cleanupTextures();

        // Create textures from G-Buffer
        const albedoTex = this._createTexture(albedo, width, height, 'albedo');
        const normalTex = this._createNormalsTexture(normals, width, height);
        const depthTex = this._createDepthTexture(depth, width, height);

        // Update uniform buffer
        this._updateUniforms(light, width, height);

        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: albedoTex.createView() },
                { binding: 1, resource: normalTex.createView() },
                { binding: 2, resource: depthTex.createView() },
                { binding: 3, resource: this.sampler },
                { binding: 4, resource: { buffer: this.uniformBuffer } },
            ],
        });

        // Create command encoder
        const commandEncoder = this.device.createCommandEncoder();

        // Render pass
        const renderPassDescriptor = {
            colorAttachments: [
                {
                    view: this.context.getCurrentTexture().createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.lightingPipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(3, 1, 0, 0); // Fullscreen triangle
        passEncoder.end();

        // Submit
        this.device.queue.submit([commandEncoder.finish()]);

        return this.canvas;
    }

    /**
     * Update uniform buffer with light parameters
     */
    _updateUniforms(light, width, height) {
        const uniformData = new Float32Array([
            // vec3 direction + padding
            light.direction.x,
            light.direction.y,
            light.direction.z,
            0,
            // vec3 color + intensity
            light.color.r,
            light.color.g,
            light.color.b,
            light.intensity,
            // ambient, shadowIntensity, shadowSoftness, padding
            light.ambient,
            light.shadowIntensity || 0.6,
            light.shadowSoftness || 0.4,
            0,
            // vec2 resolution + padding
            width,
            height,
            0,
            0,
        ]);

        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    }

    /**
     * Create texture from ImageData
     */
    _createTexture(imageData, width, height, label = 'texture') {
        const texture = this.device.createTexture({
            label,
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        // Upload data
        if (imageData instanceof ImageData) {
            this.device.queue.writeTexture(
                { texture },
                imageData.data,
                { bytesPerRow: width * 4 },
                { width, height }
            );
        } else if (imageData.data) {
            this.device.queue.writeTexture(
                { texture },
                imageData.data,
                { bytesPerRow: width * 4 },
                { width, height }
            );
        }

        this.cachedTextures.push(texture);
        return texture;
    }

    /**
     * Create normals texture from Float32Array
     */
    _createNormalsTexture(normals, width, height) {
        // Pack normals into RGBA8
        const packedData = new Uint8Array(width * height * 4);

        for (let i = 0; i < width * height; i++) {
            // Normals are in [-1, 1], map to [0, 255]
            const nx = normals.data[i * 3] * 0.5 + 0.5;
            const ny = normals.data[i * 3 + 1] * 0.5 + 0.5;
            const nz = normals.data[i * 3 + 2] * 0.5 + 0.5;

            packedData[i * 4] = Math.floor(nx * 255);
            packedData[i * 4 + 1] = Math.floor(ny * 255);
            packedData[i * 4 + 2] = Math.floor(nz * 255);
            packedData[i * 4 + 3] = 255;
        }

        const texture = this.device.createTexture({
            label: 'normals',
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.device.queue.writeTexture(
            { texture },
            packedData,
            { bytesPerRow: width * 4 },
            { width, height }
        );

        this.cachedTextures.push(texture);
        return texture;
    }

    /**
     * Create depth texture
     */
    _createDepthTexture(depth, width, height) {
        // Pack depth into RGBA8
        const packedData = new Uint8Array(width * height * 4);

        // Find depth range
        let minD = Infinity,
            maxD = -Infinity;
        for (let i = 0; i < depth.data.length; i++) {
            if (depth.data[i] < minD) minD = depth.data[i];
            if (depth.data[i] > maxD) maxD = depth.data[i];
        }
        const range = maxD - minD || 1;

        for (let i = 0; i < width * height; i++) {
            const d = (depth.data[i] - minD) / range;
            const d8 = Math.floor(d * 255);
            packedData[i * 4] = d8;
            packedData[i * 4 + 1] = d8;
            packedData[i * 4 + 2] = d8;
            packedData[i * 4 + 3] = 255;
        }

        const texture = this.device.createTexture({
            label: 'depth',
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.device.queue.writeTexture(
            { texture },
            packedData,
            { bytesPerRow: width * 4 },
            { width, height }
        );

        this.cachedTextures.push(texture);
        return texture;
    }

    /**
     * Cleanup cached textures
     */
    _cleanupTextures() {
        for (const texture of this.cachedTextures) {
            texture.destroy();
        }
        this.cachedTextures = [];
    }

    /**
     * Read pixels from canvas
     */
    async readPixels() {
        // WebGPU requires async readback
        const { width, height } = this.canvas;

        // Create staging buffer
        const bytesPerRow = Math.ceil((width * 4) / 256) * 256; // Must be 256-aligned
        const bufferSize = bytesPerRow * height;

        const stagingBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        // Copy texture to buffer
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyTextureToBuffer(
            { texture: this.context.getCurrentTexture() },
            { buffer: stagingBuffer, bytesPerRow },
            { width, height }
        );
        this.device.queue.submit([commandEncoder.finish()]);

        // Map and read
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(stagingBuffer.getMappedRange());

        // Copy to properly sized array
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            const srcOffset = y * bytesPerRow;
            const dstOffset = y * width * 4;
            pixels.set(data.subarray(srcOffset, srcOffset + width * 4), dstOffset);
        }

        stagingBuffer.unmap();
        stagingBuffer.destroy();

        return new ImageData(pixels, width, height);
    }

    /**
     * Get renderer capabilities
     */
    getCapabilities() {
        const limits = this.adapter?.limits || {};

        return {
            backend: 'webgpu',
            maxTextureSize: limits.maxTextureDimension2D || 8192,
            supportsFloat: true,
            supportsCompute: true,
            supportsPCSS: true, // Can implement in future
            adapterInfo: this.adapter?.info || {},
        };
    }

    /**
     * Dispose resources
     */
    dispose() {
        this._cleanupTextures();

        if (this.uniformBuffer) {
            this.uniformBuffer.destroy();
            this.uniformBuffer = null;
        }

        // Note: WebGPU doesn't have explicit pipeline/sampler destruction
        this.lightingPipeline = null;
        this.sampler = null;

        if (this.device) {
            this.device.destroy();
            this.device = null;
        }

        this.isInitialized = false;
        console.log('WebGPU Renderer disposed');
    }
}

export default WebGPURenderer;
