/**
 * MaskSystemWebGPU - WebGPU implementation of mask rendering
 * 
 * Provides mask operations using WebGPU for:
 * - Brush painting (isotropic aspect-ratio corrected)
 * - Radial/linear gradients (isotropic half-plane/circular falloff)
 * - Mask overlay visualization
 * - Masked adjustments
 * - Mask inversion
 */

import {
    brushStampShader,
    radialGradientShader,
    linearGradientShader,
    maskOverlayShader,
    maskInvertShader,
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

        // UI state
        this.showOverlay = false;
        this.isMaskMode = true;
        this._isPaintingOverlay = false;
        this.overlayColors = [
            { name: 'Red', rgb: [1.0, 0.25, 0.25], hex: '#ef4444' },
            { name: 'Green', rgb: [0.15, 0.9, 0.35], hex: '#22c55e' },
            { name: 'Blue', rgb: [0.25, 0.6, 1.0], hex: '#3b82f6' },
            { name: 'White', rgb: [1.0, 1.0, 1.0], hex: '#ffffff' },
            { name: 'Black', rgb: [0.08, 0.08, 0.08], hex: '#1f2937' }
        ];
        this.overlayColorIndex = 0;
        this._layerCounter = 0;
        this._pendingLayers = [];
    }

    /**
     * Initialize pipelines
     */
    async init() {
        await this._compilePipelines();
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
                    dstFactor: 'one-minus-src-alpha',
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

        // Mask invert pipeline
        this._createPipeline('maskInvert', maskInvertShader, {
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }
            ]
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
    }

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
    createLayer(type = 'brush', name = null) {
        const width = this.backend.width;
        const height = this.backend.height;

        if (width <= 0 || height <= 0) {
            this._pendingLayers.push({ type, name });
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

        this._layerCounter = (this._layerCounter || 0) + 1;
        const defaultName = name || `${type}_${this._layerCounter}`;

        const layer = {
            id: Date.now() + Math.random(),
            type,
            name: defaultName,
            maskTexture,
            width,
            height,
            adjustments: {
                density: 100,
                exposure: 0,
                contrast: 0,
                highlights: 0,
                shadows: 0,
                temperature: 0,
                tint: 0,
                saturation: 0,
                clarity: 0,
                lumMin: 0,
                lumMax: 100,
                lumFeather: 20,
                useLumRange: 0
            },
            shape: null,
            visible: true,
            strokes: []
        };

        this.layers.push(layer);
        this.activeLayerIndex = this.layers.length - 1;

        return layer;
    }

    createBrushLayer(name) {
        return this.createLayer('brush', name);
    }

    createRadialLayer(name) {
        return this.createLayer('radial', name);
    }

    createGradientLayer(name) {
        return this.createLayer('gradient', name);
    }

    createLinearLayer(name) {
        return this.createGradientLayer(name);
    }

    /**
     * Duplicate layer
     */
    duplicateLayer(index) {
        if (index < 0 || index >= this.layers.length) return null;
        const src = this.layers[index];
        const newLayer = this.createLayer(src.type, `${src.name} Copy`);
        if (!newLayer) return null;

        newLayer.adjustments = { ...src.adjustments };
        newLayer.shape = src.shape ? { ...src.shape } : null;
        newLayer.strokes = src.strokes ? JSON.parse(JSON.stringify(src.strokes)) : [];
        newLayer.visible = src.visible !== false;

        this.replayLayer(newLayer.id);
        return newLayer;
    }

    /**
     * Delete layer
     */
    deleteLayer(index) {
        if (index < 0 || index >= this.layers.length) return;

        const layer = this.layers[index];
        if (layer.maskTexture) {
            layer.maskTexture.destroy();
        }

        this.layers.splice(index, 1);
        if (this.activeLayerIndex === index) {
            this.activeLayerIndex = Math.min(index, this.layers.length - 1);
        } else if (this.activeLayerIndex > index) {
            this.activeLayerIndex--;
        }
    }

    /**
     * Toggle layer visibility
     */
    toggleLayerVisibility(index) {
        if (index >= 0 && index < this.layers.length) {
            this.layers[index].visible = !this.layers[index].visible;
            return this.layers[index].visible;
        }
        return false;
    }

    /**
     * Clear active mask
     */
    clearActiveMask() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        if (!layer || !layer.maskTexture) return;

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

        layer.strokes = [];
        layer.shape = null;
    }

    /**
     * Invert active mask
     */
    invertActiveMask() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;
        const layer = this.layers[this.activeLayerIndex];
        if (!layer || !layer.maskTexture) return;

        if (layer.shape && (layer.type === 'radial' || layer.type === 'gradient')) {
            layer.shape.invert = !layer.shape.invert;
            if (layer.type === 'radial') {
                const rx = layer.shape.radiusX || layer.shape.outerRadius || 100;
                const ry = layer.shape.radiusY || layer.shape.outerRadius || 100;
                const rot = layer.shape.angle || 0;
                const feat = layer.shape.feather !== undefined ? layer.shape.feather : 0.5;
                this.createRadialMask(
                    layer.shape.centerX,
                    layer.shape.centerY,
                    rx,
                    ry,
                    rot,
                    feat,
                    layer.shape.invert
                );
            } else {
                this.createLinearMask(
                    layer.shape.startX,
                    layer.shape.startY,
                    layer.shape.endX,
                    layer.shape.endY,
                    layer.shape.feather,
                    layer.shape.invert
                );
            }
            return;
        }

        const pipeline = this.pipelines.get('maskInvert');
        const bindGroupLayout = this.bindGroupLayouts.get('maskInvert');
        if (!pipeline || !bindGroupLayout) return;

        const width = this.backend.width;
        const height = this.backend.height;

        const tempTex = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
        });

        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: this.backend.sampler },
                { binding: 1, resource: layer.maskTexture.createView() }
            ]
        });

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: tempTex.createView(),
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

        layer.maskTexture.destroy();
        layer.maskTexture = tempTex;
    }

    /**
     * Called when image dimensions change
     */
    onImageDimensionsChanged() {
        const width = this.backend.width;
        const height = this.backend.height;

        if (width <= 0 || height <= 0) return;

        // Process pending layers
        if (this._pendingLayers && this._pendingLayers.length > 0) {
            const pending = [...this._pendingLayers];
            this._pendingLayers = [];
            for (const item of pending) {
                this.createLayer(item.type, item.name);
            }
        }

        // Recreate existing layer textures at new size and replay
        for (const layer of this.layers) {
            if (layer.width !== width || layer.height !== height) {
                if (layer.maskTexture) {
                    layer.maskTexture.destroy();
                }

                layer.maskTexture = this.device.createTexture({
                    size: [width, height],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING |
                        GPUTextureUsage.RENDER_ATTACHMENT |
                        GPUTextureUsage.COPY_DST
                });

                layer.width = width;
                layer.height = height;

                this.replayLayer(layer.id);
            }
        }

        // Reset ping-pong framebuffers
        if (this._pingFBO) {
            this.backend.deleteFramebuffer?.(this._pingFBO);
            this.backend.deleteFramebuffer?.(this._pongFBO);
            this._pingFBO = null;
            this._pongFBO = null;
        }
    }

    /**
     * Paint brush at coordinates
     */
    paintBrush(x, y, record = true) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        if (!layer || layer.type !== 'brush') return;

        if (record) {
            if (!layer.strokes) layer.strokes = [];
            layer.strokes.push({
                type: 'brush',
                x, y,
                settings: { ...this.brushSettings }
            });
        }

        const pipelineName = this.brushSettings.erase ? 'brushErase' : 'brushStamp';
        const pipeline = this.pipelines.get(pipelineName);
        const bindGroupLayout = this.bindGroupLayouts.get(pipelineName);

        const width = this.backend.width;
        const height = this.backend.height;
        if (width <= 0 || height <= 0) return;

        // If coordinates are normalized [0, 1] while image is > 10px, convert to image pixel coordinates
        if (x >= 0 && x <= 1.0 && y >= 0 && y <= 1.0 && width > 10 && height > 10) {
            x = x * width;
            y = y * height;
        }

        x = Math.max(0, Math.min(width, x));
        y = Math.max(0, Math.min(height, y));

        // WebGPU texCoords have y=0 at top -> NO Y-FLIP
        const centerX = x / width;
        const centerY = y / height;
        const aspect = width / height;
        const radius = (this.brushSettings.size * 0.5) / height;
        const opacity = (this.brushSettings.opacity / 100) * (this.brushSettings.flow / 100);

        const featherVal = this.brushSettings.hardness !== undefined ? this.brushSettings.hardness : 50;
        const hardness = Math.max(0.0, Math.min(1.0, (100 - featherVal) / 100));

        const uniformData = new Float32Array([
            centerX, centerY,
            radius,
            hardness,
            opacity,
            aspect,
            0, 0
        ]);

        const uniformBuffer = this.device.createBuffer({
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } }
            ]
        });

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
    paintStroke(x1, y1, x2, y2, record = true) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        if (!layer || layer.type !== 'brush') return;

        const width = this.backend.width;
        const height = this.backend.height;
        if (width <= 0 || height <= 0) return;

        if (x1 >= 0 && x1 <= 1.0 && y1 >= 0 && y1 <= 1.0 && width > 10 && height > 10) {
            x1 = x1 * width;
            y1 = y1 * height;
        }
        if (x2 >= 0 && x2 <= 1.0 && y2 >= 0 && y2 <= 1.0 && width > 10 && height > 10) {
            x2 = x2 * width;
            y2 = y2 * height;
        }

        x1 = Math.max(0, Math.min(width, x1));
        y1 = Math.max(0, Math.min(height, y1));
        x2 = Math.max(0, Math.min(width, x2));
        y2 = Math.max(0, Math.min(height, y2));

        if (record) {
            if (!layer.strokes) layer.strokes = [];
            layer.strokes.push({
                type: 'stroke',
                x1, y1, x2, y2,
                settings: { ...this.brushSettings }
            });
        }

        const spacing = Math.max(1, this.brushSettings.size * 0.12);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) {
            this.paintBrush(x2, y2, false);
            return;
        }

        const steps = Math.ceil(dist / spacing);
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            this.paintBrush(x1 + dx * t, y1 + dy * t, false);
        }
    }

    /**
     * Replay all strokes or redraw shape on a layer
     */
    replayLayer(layerId) {
        const layer = this.layers.find(l => l.id === layerId);
        if (!layer) return;

        const prevActiveIndex = this.activeLayerIndex;
        const prevSettings = { ...this.brushSettings };
        this.activeLayerIndex = this.layers.indexOf(layer);

        if (layer.type === 'radial' && layer.shape) {
            const rx = layer.shape.radiusX || layer.shape.outerRadius || 100;
            const ry = layer.shape.radiusY || layer.shape.outerRadius || 100;
            const rot = layer.shape.angle || 0;
            const feat = layer.shape.feather !== undefined ? layer.shape.feather : 0.5;
            this.createRadialMask(
                layer.shape.centerX,
                layer.shape.centerY,
                rx,
                ry,
                rot,
                feat,
                layer.shape.invert
            );
        } else if (layer.type === 'gradient' && layer.shape) {
            this.createLinearMask(
                layer.shape.startX,
                layer.shape.startY,
                layer.shape.endX,
                layer.shape.endY,
                layer.shape.feather,
                layer.shape.invert
            );
        } else {
            // Clear texture to transparent
            if (layer.maskTexture) {
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
        }

        // Replay brush strokes
        if (layer.strokes && layer.strokes.length > 0) {
            for (const op of layer.strokes) {
                this.brushSettings = { ...op.settings };
                if (op.type === 'brush') {
                    this.paintBrush(op.x, op.y, false);
                } else if (op.type === 'stroke') {
                    this.paintStroke(op.x1, op.y1, op.x2, op.y2, false);
                }
            }
        }

        this.activeLayerIndex = prevActiveIndex;
        this.brushSettings = prevSettings;
    }

    /**
     * Create radial mask (isotropic, Lightroom-style elliptical with angle & feather)
     */
    createRadialMask(centerX, centerY, radiusX, radiusY, angle = 0, feather = 0.5, invert = false) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        if (!layer) return;

        const pipeline = this.pipelines.get('radialGradient');
        const bindGroupLayout = this.bindGroupLayouts.get('radialGradient');

        const width = this.backend.width;
        const height = this.backend.height;
        if (width <= 0 || height <= 0) return;

        let rx = radiusX;
        let ry = radiusY;
        let rot = 0;
        let feat = 0.5;
        let inv = false;

        if (typeof angle === 'boolean') {
            inv = angle;
            const outerR = Math.max(1, radiusY);
            const innerR = Math.max(0, radiusX);
            rx = outerR;
            ry = outerR;
            feat = Math.max(0.01, (outerR - innerR) / outerR);
        } else {
            rot = angle || 0;
            feat = typeof feather === 'number' ? feather : 0.5;
            inv = Boolean(invert);
        }

        layer.shape = { centerX, centerY, radiusX: rx, radiusY: ry, angle: rot, feather: feat, invert: inv };

        const cx = centerX / width;
        const cy = centerY / height;
        const aspect = width / height;
        const rxNorm = rx / height;
        const ryNorm = ry / height;

        const uniformData = new Float32Array([cx, cy, rxNorm, ryNorm, rot, feat, aspect, inv ? 1 : 0]);
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
     * Create linear gradient mask (isotropic half-plane ramp, no inverted Y)
     */
    createLinearMask(startX, startY, endX, endY, feather = 0.5, invert = false) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        if (!layer) return;

        const pipeline = this.pipelines.get('linearGradient');
        const bindGroupLayout = this.bindGroupLayouts.get('linearGradient');

        const width = this.backend.width;
        const height = this.backend.height;
        if (width <= 0 || height <= 0) return;

        layer.shape = { startX, startY, endX, endY, feather, invert };

        const sx = startX / width;
        const sy = startY / height;
        const ex = endX / width;
        const ey = endY / height;
        const aspect = width / height;

        const uniformData = new Float32Array([sx, sy, ex, ey, aspect, invert ? 1 : 0, 0, 0]);
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
     * Check if a layer has any active non-neutral adjustments
     */
    _hasLayerAdjustments(adj) {
        if (!adj) return false;
        return (
            (adj.exposure && Math.abs(adj.exposure) > 0.001) ||
            (adj.contrast && Math.abs(adj.contrast) > 0.001) ||
            (adj.highlights && Math.abs(adj.highlights) > 0.001) ||
            (adj.shadows && Math.abs(adj.shadows) > 0.001) ||
            (adj.temperature && Math.abs(adj.temperature) > 0.001) ||
            (adj.tint && Math.abs(adj.tint) > 0.001) ||
            (adj.saturation && Math.abs(adj.saturation) > 0.001) ||
            (adj.clarity && Math.abs(adj.clarity) > 0.001) ||
            (adj.density !== undefined && adj.density < 99.9) ||
            (adj.useLumRange && (adj.lumMin > 0 || adj.lumMax < 100))
        );
    }

    /**
     * Check if active masks exist
     */
    hasActiveMasks() {
        return this.layers.length > 0 && this.layers.some(l => l.visible && this._hasLayerAdjustments(l.adjustments));
    }

    toggleOverlay() {
        this.showOverlay = !this.showOverlay;
        return this.showOverlay;
    }

    /**
     * Cycle through Photoshop/Lightroom overlay colors (Red, Green, Blue, White, Black)
     */
    cycleOverlayColor() {
        this.overlayColorIndex = (this.overlayColorIndex + 1) % this.overlayColors.length;
        return this.overlayColors[this.overlayColorIndex];
    }

    /**
     * Get current overlay color configuration
     */
    getCurrentOverlayColor() {
        return this.overlayColors[this.overlayColorIndex] || this.overlayColors[0];
    }

    shouldShowOverlay() {
        return Boolean(this.isMaskMode !== false && (this.showOverlay || this._isPaintingOverlay) && this.activeLayerIndex >= 0 && this.layers.length > 0);
    }

    getActiveAdjustments() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return null;
        return this.layers[this.activeLayerIndex].adjustments;
    }

    getActiveLayer() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return null;
        return this.layers[this.activeLayerIndex];
    }

    setAdjustment(name, value) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;
        this.layers[this.activeLayerIndex].adjustments[name] = value;
    }

    setActiveAdjustment(name, value) {
        this.setAdjustment(name, value);
    }

    /**
     * Render mask overlay
     */
    renderMaskOverlay() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        if (!layer || !layer.maskTexture) return;

        if (!this._overlayCanvasPipeline) {
            this._createCanvasOverlayPipeline();
        }

        const pipeline = this._overlayCanvasPipeline;
        const bindGroupLayout = this._overlayCanvasBindGroupLayout;

        const overlayColor = this.getCurrentOverlayColor();
        const uniformData = new Float32Array([
            overlayColor.rgb[0],
            overlayColor.rgb[1],
            overlayColor.rgb[2],
            0.5
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
                { binding: 1, resource: layer.maskTexture.createView() },
                { binding: 2, resource: { buffer: uniformBuffer } }
            ]
        });

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.backend.context.getCurrentTexture().createView(),
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

    _createCanvasOverlayPipeline() {
        const code = maskOverlayShader;
        const shaderModule = this.device.createShaderModule({ code });

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
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
                    format: this.backend.format,
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
                    format: this.backend.format
                }]
            },
            primitive: {
                topology: 'triangle-strip'
            }
        });
    }

    /**
     * Apply masked adjustments
     */
    applyMaskedAdjustments(baseTexture) {
        if (this.layers.length === 0 || !baseTexture) return baseTexture;

        const hasAdjustments = this.layers.some(layer =>
            layer.visible && this._hasLayerAdjustments(layer.adjustments)
        );
        if (!hasAdjustments) return baseTexture;

        if (!this._maskedAdjustmentCanvasPipeline) {
            this._createCanvasMaskedAdjustmentPipeline();
        }

        const pipeline = this._maskedAdjustmentCanvasPipeline;
        const bindGroupLayout = this._maskedAdjustmentCanvasBindGroupLayout;

        let currentTexture = baseTexture;

        if (!this._pingFBO || this._pingFBO.width !== this.backend.width || this._pingFBO.height !== this.backend.height) {
            if (this._pingFBO) this.backend.deleteFramebuffer?.(this._pingFBO);
            if (this._pongFBO) this.backend.deleteFramebuffer?.(this._pongFBO);
            this._pingFBO = this.backend.createFramebuffer(this.backend.width, this.backend.height);
            this._pongFBO = this.backend.createFramebuffer(this.backend.width, this.backend.height);
        }

        let usePing = true;

        for (const layer of this.layers) {
            if (!layer.visible) continue;

            const adj = layer.adjustments;
            if (Object.entries(adj).every(([k, v]) => k === 'density' ? v === 100 : v === 0)) continue;

            const outputFBO = usePing ? this._pingFBO : this._pongFBO;

            const uniformData = new Float32Array([
                adj.exposure || 0,
                (adj.contrast || 0) / 100,
                (adj.highlights || 0) / 100,
                (adj.shadows || 0) / 100,
                (adj.temperature || 0) / 100,
                (adj.tint || 0) / 100,
                (adj.saturation || 0) / 100,
                (adj.clarity || 0) / 100,
                adj.density !== undefined ? adj.density / 100 : 1.0,
                (adj.lumMin || 0) / 100,
                (adj.lumMax !== undefined ? adj.lumMax : 100) / 100,
                (adj.lumFeather !== undefined ? adj.lumFeather : 20) / 100,
                adj.useLumRange ? 1.0 : 0.0,
                0, 0, 0
            ]);

            const uniformBuffer = this.device.createBuffer({
                size: uniformData.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

            const rawCurrentTexture = (typeof GPUTexture !== 'undefined' && currentTexture instanceof GPUTexture)
                ? currentTexture
                : currentTexture?._internal;
            const outputTextureRaw = (typeof GPUTexture !== 'undefined' && outputFBO.texture instanceof GPUTexture)
                ? outputFBO.texture
                : outputFBO.texture?._internal;

            if (!rawCurrentTexture || !outputTextureRaw) continue;

            const bindGroup = this.device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: this.backend.sampler },
                    { binding: 1, resource: rawCurrentTexture.createView() },
                    { binding: 2, resource: layer.maskTexture.createView() },
                    { binding: 3, resource: { buffer: uniformBuffer } }
                ]
            });

            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: outputTextureRaw.createView(),
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

            currentTexture = outputFBO.texture;
            usePing = !usePing;
        }

        if (currentTexture === baseTexture) {
            return baseTexture;
        }

        if (typeof GPUTexture !== 'undefined' && baseTexture instanceof GPUTexture) {
            return currentTexture?._internal || currentTexture;
        }

        return currentTexture;
    }

    /**
     * Reset and dispose of all resources
     */
    reset() {
        for (const layer of this.layers) {
            if (layer.maskTexture) {
                layer.maskTexture.destroy();
            }
        }
        this.layers = [];
        this.activeLayerIndex = -1;
        this.showOverlay = false;

        if (this._pingFBO) {
            this.backend.deleteFramebuffer?.(this._pingFBO);
            this._pingFBO = null;
        }
        if (this._pongFBO) {
            this.backend.deleteFramebuffer?.(this._pongFBO);
            this._pongFBO = null;
        }
    }

    get gpu() {
        return {
            width: this.backend.width,
            height: this.backend.height
        };
    }
}
