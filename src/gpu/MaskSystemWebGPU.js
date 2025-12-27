/**
 * MaskSystemWebGPU - WebGPU implementation of mask rendering
 * 
 * Provides mask operations using WebGPU for:
 * - Brush painting
 * - Radial/linear gradients
 * - Mask overlay visualization
 * - Masked adjustments
 */

import {
    brushStampShader,
    radialGradientShader,
    linearGradientShader,
    maskOverlayShader,
    maskedAdjustmentShader,
    passthroughShader
} from './shaders/MaskShaders.js';

export class MaskSystemWebGPU {
    constructor(webgpuBackend) {
        this.backend = webgpuBackend;
        this.device = webgpuBackend.device;

        // Pipelines
        this.pipelines = new Map();
        this.bindGroupLayouts = new Map();

        // Active mask layers
        this.layers = [];
        this.activeLayerIndex = -1;

        // Brush settings
        this.brushSettings = {
            size: 100,
            hardness: 50,
            opacity: 100,
            flow: 50,
            erase: false
        };

        this._layerCounter = 0;
    }

    /**
     * Initialize pipelines
     */
    async init() {
        await this._compilePipelines();
        console.log('🎭 MaskSystemWebGPU initialized');
    }

    /**
     * Compile all mask pipelines
     */
    async _compilePipelines() {
        // Brush stamp pipeline (add mode)
        this._createPipeline('brushStamp', brushStampShader, {
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ],
            blend: {
                color: {
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add'
                },
                alpha: {
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add'
                }
            }
        });

        // Brush erase pipeline (subtract mode - erases from mask)
        this._createPipeline('brushErase', brushStampShader, {
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ],
            blend: {
                color: {
                    srcFactor: 'zero',
                    dstFactor: 'one',
                    operation: 'add'
                },
                alpha: {
                    srcFactor: 'zero',
                    dstFactor: 'one-minus-src-alpha',  // dst = dst * (1 - srcAlpha), effectively subtracting
                    operation: 'add'
                }
            }
        });

        // Radial gradient pipeline
        this._createPipeline('radialGradient', radialGradientShader, {
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        });

        // Linear gradient pipeline
        this._createPipeline('linearGradient', linearGradientShader, {
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        });

        // Mask overlay pipeline
        this._createPipeline('maskOverlay', maskOverlayShader, {
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }
            ],
            blend: {
                color: {
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add'
                },
                alpha: {
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add'
                }
            }
        });

        // Masked adjustment pipeline
        this._createPipeline('maskedAdjustment', maskedAdjustmentShader, {
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        });

        // Passthrough pipeline
        this._createPipeline('passthrough', passthroughShader, {
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }
            ]
        });

        console.log('✅ Mask shaders compiled (WebGPU)');
    }

    /**
     * Create a render pipeline
     */
    _createPipeline(name, code, options) {
        const shaderModule = this.device.createShaderModule({ code });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: options.entries
        });
        this.bindGroupLayouts.set(name, bindGroupLayout);

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        const pipelineDescriptor = {
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain',
                buffers: [
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
                    },
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }]
                    }
                ]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: 'rgba8unorm',
                    ...(options.blend ? { blend: options.blend } : {})
                }]
            },
            primitive: {
                topology: 'triangle-strip'
            }
        };

        const pipeline = this.device.createRenderPipeline(pipelineDescriptor);
        this.pipelines.set(name, pipeline);
    }

    /**
     * Create a new layer with mask texture
     */
    createLayer(type = 'brush') {
        const width = this.backend.width;
        const height = this.backend.height;

        // Validate dimensions - prevent zero-sized texture errors
        if (width <= 0 || height <= 0) {
            console.warn('⚠️ Cannot create layer: image dimensions not set yet (width/height is 0)');
            // Store pending layer creation for when image loads
            if (!this._pendingLayers) this._pendingLayers = [];
            this._pendingLayers.push(type);
            return null;
        }

        // Create mask texture
        const maskTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.COPY_DST
        });

        // Clear to transparent
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: maskTexture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);

        this._layerCounter++;
        const defaultName = `${type}_${this._layerCounter}`;

        const layer = {
            id: Date.now(),
            type,
            name: defaultName,
            maskTexture,
            width,
            height,
            adjustments: {
                exposure: 0,
                contrast: 0,
                highlights: 0,
                shadows: 0,
                temperature: 0,
                tint: 0,
                saturation: 0,
                clarity: 0
            },
            shape: null,
            visible: true
        };

        this.layers.push(layer);
        this.activeLayerIndex = this.layers.length - 1;

        console.log(`📝 Created ${type} layer #${layer.id} (WebGPU) at ${width}×${height}`);
        return layer;
    }

    /**
     * Called when image dimensions change - recreates layer textures
     */
    onImageDimensionsChanged() {
        const width = this.backend.width;
        const height = this.backend.height;

        if (width <= 0 || height <= 0) return;

        // Create any pending layers
        if (this._pendingLayers && this._pendingLayers.length > 0) {
            const pending = [...this._pendingLayers];
            this._pendingLayers = [];
            for (const type of pending) {
                this.createLayer(type);
            }
        }

        // Resize existing layers if needed
        for (const layer of this.layers) {
            if (layer.width !== width || layer.height !== height) {
                // Destroy old texture
                if (layer.maskTexture) {
                    layer.maskTexture.destroy();
                }

                // Create new texture at correct size
                layer.maskTexture = this.device.createTexture({
                    size: [width, height],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING |
                        GPUTextureUsage.RENDER_ATTACHMENT |
                        GPUTextureUsage.COPY_DST
                });

                // Clear to transparent
                const commandEncoder = this.device.createCommandEncoder();
                const passEncoder = commandEncoder.beginRenderPass({
                    colorAttachments: [{
                        view: layer.maskTexture.createView(),
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: 'clear',
                        storeOp: 'store'
                    }]
                });
                passEncoder.end();
                this.device.queue.submit([commandEncoder.finish()]);

                layer.width = width;
                layer.height = height;
                console.log(`🔄 Resized layer ${layer.name} to ${width}×${height}`);
            }
        }
    }

    /**
     * Paint brush at coordinates
     */
    paintBrush(x, y) {
        if (this.activeLayerIndex < 0) return;

        const layer = this.layers[this.activeLayerIndex];
        if (layer.type !== 'brush') return;

        // Select pipeline based on erase mode
        const pipelineName = this.brushSettings.erase ? 'brushErase' : 'brushStamp';
        const pipeline = this.pipelines.get(pipelineName);
        const bindGroupLayout = this.bindGroupLayouts.get(pipelineName);

        const width = this.backend.width;
        const height = this.backend.height;

        // Convert to UV coords (no Y-flip needed - texCoords already account for orientation)
        const centerX = x / width;
        const centerY = y / height;
        const radiusX = this.brushSettings.size / width;
        const radiusY = this.brushSettings.size / height;
        const radius = Math.max(radiusX, radiusY);

        // Always use positive opacity - blending handles add vs erase
        const opacity = (this.brushSettings.opacity / 100) * (this.brushSettings.flow / 100);

        // Create uniform buffer
        const uniformData = new Float32Array([
            centerX, centerY,
            radius,
            this.brushSettings.hardness / 100,
            opacity,  // Always positive
            0 // padding
        ]);

        const uniformBuffer = this.device.createBuffer({
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } }
            ]
        });

        // Render to mask texture
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: layer.maskTexture.createView(),
                loadOp: 'load',
                storeOp: 'store'
            }]
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.backend.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.backend.texCoordBuffer);
        passEncoder.draw(4);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);

        uniformBuffer.destroy();
    }

    /**
     * Paint stroke with interpolation
     */
    paintStroke(x1, y1, x2, y2) {
        if (this.activeLayerIndex < 0) return;

        const spacing = Math.max(2, this.brushSettings.size * 0.18);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) {
            this.paintBrush(x2, y2);
            return;
        }

        const steps = Math.ceil(dist / spacing);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            this.paintBrush(x1 + dx * t, y1 + dy * t);
        }
    }

    /**
     * Create radial mask
     */
    createRadialMask(centerX, centerY, innerRadius, outerRadius, invert = false) {
        if (this.activeLayerIndex < 0) return;

        const layer = this.layers[this.activeLayerIndex];
        const pipeline = this.pipelines.get('radialGradient');
        const bindGroupLayout = this.bindGroupLayouts.get('radialGradient');

        const width = this.backend.width;
        const height = this.backend.height;

        layer.shape = { centerX, centerY, innerRadius, outerRadius, invert };

        const cx = centerX / width;
        const cy = 1.0 - (centerY / height);
        const ir = innerRadius / Math.max(width, height);
        const or = outerRadius / Math.max(width, height);

        const uniformData = new Float32Array([cx, cy, ir, or, 0, invert ? 1 : 0]);
        const uniformBuffer = this.device.createBuffer({
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
        });

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: layer.maskTexture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.backend.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.backend.texCoordBuffer);
        passEncoder.draw(4);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
        uniformBuffer.destroy();
    }

    /**
     * Get active layer adjustments
     */
    getActiveAdjustments() {
        if (this.activeLayerIndex < 0) return null;
        return this.layers[this.activeLayerIndex].adjustments;
    }

    /**
     * Get active layer
     */
    getActiveLayer() {
        if (this.activeLayerIndex < 0) return null;
        return this.layers[this.activeLayerIndex];
    }

    /**
     * Set adjustment
     */
    setAdjustment(name, value) {
        if (this.activeLayerIndex < 0) return;
        this.layers[this.activeLayerIndex].adjustments[name] = value;
    }

    /**
     * Set active adjustment (alias)
     */
    setActiveAdjustment(name, value) {
        this.setAdjustment(name, value);
    }

    /**
     * Delete layer
     */
    deleteLayer(index) {
        if (index < 0 || index >= this.layers.length) return;

        const layer = this.layers[index];
        layer.maskTexture.destroy();

        this.layers.splice(index, 1);
        if (this.activeLayerIndex >= this.layers.length) {
            this.activeLayerIndex = this.layers.length - 1;
        }
    }

    /**
     * Clear active mask
     */
    clearActiveMask() {
        if (this.activeLayerIndex < 0) return;

        const layer = this.layers[this.activeLayerIndex];
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: layer.maskTexture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }

    /**
     * Render mask overlay - shows red semi-transparent overlay on painted areas
     */
    renderMaskOverlay() {
        if (this.activeLayerIndex < 0) return;

        const layer = this.layers[this.activeLayerIndex];
        if (!layer || !layer.maskTexture) return;

        // Get or create canvas-compatible overlay pipeline
        if (!this._overlayCanvasPipeline) {
            this._createCanvasOverlayPipeline();
        }

        const pipeline = this._overlayCanvasPipeline;
        const bindGroupLayout = this._overlayCanvasBindGroupLayout;

        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: this.backend.sampler },
                { binding: 1, resource: layer.maskTexture.createView() }
            ]
        });

        // Render overlay on top of current canvas content
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.backend.context.getCurrentTexture().createView(),
                loadOp: 'load',  // Keep existing content
                storeOp: 'store'
            }]
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.backend.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.backend.texCoordBuffer);
        passEncoder.draw(4);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    /**
     * Create canvas-compatible overlay pipeline (uses canvas format)
     */
    _createCanvasOverlayPipeline() {
        const code = maskOverlayShader;
        const shaderModule = this.device.createShaderModule({ code });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }
            ]
        });
        this._overlayCanvasBindGroupLayout = bindGroupLayout;

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        this._overlayCanvasPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain',
                buffers: [
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
                    },
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }]
                    }
                ]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: this.backend.format,  // Use canvas format for compatibility
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        }
                    }
                }]
            },
            primitive: {
                topology: 'triangle-strip'
            }
        });
    }

    /**
     * Create canvas-compatible masked adjustment pipeline (uses canvas format)
     */
    _createCanvasMaskedAdjustmentPipeline() {
        const code = maskedAdjustmentShader;
        const shaderModule = this.device.createShaderModule({ code });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
            ]
        });
        this._maskedAdjustmentCanvasBindGroupLayout = bindGroupLayout;

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        this._maskedAdjustmentCanvasPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain',
                buffers: [
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
                    },
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }]
                    }
                ]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: this.backend.format  // Use canvas format for compatibility
                }]
            },
            primitive: {
                topology: 'triangle-strip'
            }
        });
    }

    /**
     * Apply masked adjustments - applies per-layer adjustments based on mask
     */
    applyMaskedAdjustments(baseTexture) {
        if (this.layers.length === 0 || !baseTexture) return baseTexture;

        // Check if any layer has non-zero adjustments
        const hasAdjustments = this.layers.some(layer =>
            layer.visible && Object.values(layer.adjustments).some(v => v !== 0)
        );
        if (!hasAdjustments) return baseTexture;

        // Get or create canvas-compatible masked adjustment pipeline
        if (!this._maskedAdjustmentCanvasPipeline) {
            this._createCanvasMaskedAdjustmentPipeline();
        }

        const pipeline = this._maskedAdjustmentCanvasPipeline;
        const bindGroupLayout = this._maskedAdjustmentCanvasBindGroupLayout;

        // Use ping-pong buffers for multi-layer compositing
        let currentTexture = baseTexture;

        // Reusable framebuffers for ping-pong (using canvas format)
        if (!this._pingFBO || this._pingFBO.width !== this.backend.width) {
            if (this._pingFBO) this.backend.deleteFramebuffer?.(this._pingFBO);
            if (this._pongFBO) this.backend.deleteFramebuffer?.(this._pongFBO);
            this._pingFBO = this.backend.createFramebuffer(this.backend.width, this.backend.height);
            this._pongFBO = this.backend.createFramebuffer(this.backend.width, this.backend.height);
        }

        let usePing = true;

        for (const layer of this.layers) {
            if (!layer.visible) continue;

            // Skip if no adjustments
            const adj = layer.adjustments;
            if (Object.values(adj).every(v => v === 0)) continue;

            // Select output buffer
            const outputFBO = usePing ? this._pingFBO : this._pongFBO;

            // Create uniform buffer with adjustments
            const uniformData = new Float32Array([
                adj.exposure || 0,
                (adj.contrast || 0) / 100,
                (adj.shadows || 0) / 100,
                (adj.temperature || 0) / 100,
                (adj.saturation || 0) / 100,
                0, 0, 0  // padding
            ]);

            const uniformBuffer = this.device.createBuffer({
                size: uniformData.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

            const bindGroup = this.device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: this.backend.sampler },
                    { binding: 1, resource: currentTexture._internal.createView() },
                    { binding: 2, resource: layer.maskTexture.createView() },
                    { binding: 3, resource: { buffer: uniformBuffer } }
                ]
            });

            // Render to output
            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: outputFBO.texture._internal.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });

            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.setVertexBuffer(0, this.backend.vertexBuffer);
            passEncoder.setVertexBuffer(1, this.backend.texCoordBuffer);
            passEncoder.draw(4);
            passEncoder.end();

            this.device.queue.submit([commandEncoder.finish()]);
            uniformBuffer.destroy();

            // Swap buffers for next layer
            currentTexture = outputFBO.texture;
            usePing = !usePing;
        }

        return currentTexture;
    }

    /**
     * Get GPU reference (for compatibility)
     */
    get gpu() {
        return {
            width: this.backend.width,
            height: this.backend.height
        };
    }
}
