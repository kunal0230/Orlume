/**
 * WebGPUBackend - WebGPU implementation of GPUBackend
 * 
 * Uses the modern WebGPU API for high-performance GPU rendering.
 * Falls back to WebGL2 if WebGPU is not available.
 */

import { GPUBackend } from './GPUBackend.js';

export class WebGPUBackend extends GPUBackend {
    constructor(canvas) {
        super(canvas);
        this.device = null;
        this.context = null;
        this.format = null;
        this.pipelines = new Map();
        this.bindGroupLayouts = new Map();
        this.sampler = null;

        // Vertex buffer for fullscreen quad
        this.vertexBuffer = null;
        this.texCoordBuffer = null;
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
        } catch (e) {
            return false;
        }
    }

    getName() {
        return 'WebGPU';
    }

    /**
     * Initialize WebGPU context
     */
    async init() {
        if (!navigator.gpu) {
            console.warn('WebGPU not available');
            return false;
        }

        try {
            // Request adapter and device
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance'
            });

            if (!adapter) {
                console.warn('WebGPU adapter not available');
                return false;
            }

            this.device = await adapter.requestDevice({
                requiredFeatures: [],
                requiredLimits: {}
            });

            // Configure canvas context
            this.context = this.canvas.getContext('webgpu');
            this.format = navigator.gpu.getPreferredCanvasFormat();

            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied'  // Support transparent PNG
            });

            // Create sampler
            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge'
            });

            // Create fullscreen quad geometry
            this._createQuadBuffers();

            // Compile shaders
            this._compileShaders();

            this.isReady = true;
            console.log('🚀 WebGPU initialized');
            return true;
        } catch (e) {
            console.error('WebGPU initialization failed:', e);
            return false;
        }
    }

    /**
     * Set canvas size and reconfigure WebGPU context
     * This is critical - WebGPU context must be reconfigured when canvas dimensions change
     */
    setSize(width, height) {
        // Skip if dimensions haven't changed
        if (this.width === width && this.height === height) {
            return;
        }

        // Call parent to set canvas dimensions
        super.setSize(width, height);

        // Reconfigure the WebGPU context for the new canvas size
        if (this.context && this.device) {
            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied'  // Support transparent PNG
            });
            console.log(`📐 WebGPU context reconfigured: ${width}×${height}`);
        }
    }

    /**
     * Create vertex buffers for fullscreen quad
     */
    _createQuadBuffers() {
        // Positions (clip space)
        const positions = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        // Texture coordinates (flipped Y for correct orientation)
        const texCoords = new Float32Array([
            0, 1,
            1, 1,
            0, 0,
            1, 0
        ]);

        this.vertexBuffer = this.device.createBuffer({
            size: positions.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.vertexBuffer, 0, positions);

        this.texCoordBuffer = this.device.createBuffer({
            size: texCoords.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.texCoordBuffer, 0, texCoords);
    }

    /**
     * Compile WGSL shaders
     */
    _compileShaders() {
        // Passthrough shader
        const passthroughCode = /* wgsl */`
            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) texCoord: vec2f,
            }

            @vertex
            fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
                var output: VertexOutput;
                output.position = vec4f(pos, 0.0, 1.0);
                output.texCoord = texCoord;
                return output;
            }

            @group(0) @binding(0) var texSampler: sampler;
            @group(0) @binding(1) var tex: texture_2d<f32>;

            @fragment
            fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
                return textureSample(tex, texSampler, texCoord);
            }
        `;

        // Develop shader with all adjustments
        const developCode = /* wgsl */`
            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) texCoord: vec2f,
            }

            struct Uniforms {
                exposure: f32,
                contrast: f32,
                highlights: f32,
                shadows: f32,
                whites: f32,
                blacks: f32,
                temperature: f32,
                tint: f32,
                vibrance: f32,
                saturation: f32,
                clarity: f32,
                _pad: f32,
            }

            @vertex
            fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
                var output: VertexOutput;
                output.position = vec4f(pos, 0.0, 1.0);
                output.texCoord = texCoord;
                return output;
            }

            @group(0) @binding(0) var texSampler: sampler;
            @group(0) @binding(1) var tex: texture_2d<f32>;
            @group(0) @binding(2) var<uniform> u: Uniforms;

            // sRGB to Linear
            fn sRGBtoLinear(c: f32) -> f32 {
                if (c <= 0.04045) {
                    return c / 12.92;
                }
                return pow((c + 0.055) / 1.055, 2.4);
            }

            // Linear to sRGB
            fn linearToSRGB(c: f32) -> f32 {
                if (c <= 0.0031308) {
                    return c * 12.92;
                }
                return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
            }

            // Luminance (Rec. 709)
            fn luminance(c: vec3f) -> f32 {
                return dot(c, vec3f(0.2126, 0.7152, 0.0722));
            }

            // Zone weights
            fn shadowWeight(L: f32) -> f32 {
                return smoothstep(0.3, 0.0, L);
            }

            fn midtoneWeight(L: f32) -> f32 {
                return exp(-pow((L - 0.5) / 0.25, 2.0) * 0.5);
            }

            fn highlightWeight(L: f32) -> f32 {
                return smoothstep(0.7, 1.0, L);
            }

            fn softShoulder(x: f32, knee: f32) -> f32 {
                if (x <= knee) { return x; }
                let over = x - knee;
                return knee + over / (1.0 + over * 2.0);
            }

            // RGB to OKLab
            fn linearRGBtoOKLab(rgb: vec3f) -> vec3f {
                let l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
                let m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
                let s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
                
                let l_ = pow(max(0.0, l), 1.0/3.0);
                let m_ = pow(max(0.0, m), 1.0/3.0);
                let s_ = pow(max(0.0, s), 1.0/3.0);
                
                return vec3f(
                    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
                    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
                    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
                );
            }

            // OKLab to RGB
            fn OKLabToLinearRGB(lab: vec3f) -> vec3f {
                let l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
                let m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
                let s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
                
                let l_ = l * l * l;
                let m_ = m * m * m;
                let s_ = s * s * s;
                
                return vec3f(
                    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
                    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
                    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_
                );
            }

            @fragment
            fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
                let pixel = textureSample(tex, texSampler, texCoord);
                
                // Convert to linear
                var linear = vec3f(
                    sRGBtoLinear(pixel.r),
                    sRGBtoLinear(pixel.g),
                    sRGBtoLinear(pixel.b)
                );
                
                var L = luminance(linear);
                var midW = midtoneWeight(L);
                var shadowW = shadowWeight(L);
                var highlightW = highlightWeight(L);
                
                // === EXPOSURE ===
                if (u.exposure != 0.0) {
                    let gain = pow(2.0, u.exposure);
                    let effectiveGain = 1.0 + (gain - 1.0) * (0.5 + midW * 0.5);
                    linear *= effectiveGain;
                    
                    if (u.exposure > 0.0) {
                        let newL = luminance(linear);
                        if (newL > 0.7) {
                            let protectedL = softShoulder(newL, 0.7);
                            linear *= protectedL / max(newL, 0.001);
                        }
                    }
                }
                
                L = luminance(linear);
                midW = midtoneWeight(L);
                shadowW = shadowWeight(L);
                highlightW = highlightWeight(L);
                
                // === CONTRAST ===
                if (u.contrast != 0.0) {
                    var k: f32;
                    if (u.contrast > 0.0) {
                        k = pow(abs(u.contrast), 0.7) * 3.5;
                    } else {
                        k = -pow(abs(u.contrast), 0.7) * 0.6;
                    }
                    
                    let effectiveK = k * (0.3 + midW * 0.7);
                    let delta = L - 0.18;
                    var newL: f32;
                    
                    if (u.contrast > 0.0) {
                        let compressed = delta / (1.0 + abs(delta) * abs(effectiveK));
                        newL = 0.18 + compressed * (1.0 + abs(effectiveK) * 0.5);
                        
                        if (shadowW > 0.3) {
                            newL = L + (newL - L) * (1.0 - shadowW * 0.5);
                        }
                        if (highlightW > 0.3) {
                            newL = L + (newL - L) * (1.0 - highlightW * 0.4);
                        }
                    } else {
                        newL = L + (0.18 - L) * abs(effectiveK);
                    }
                    
                    linear *= max(newL, 0.0) / max(L, 0.001);
                }
                
                // === HIGHLIGHTS / SHADOWS ===
                L = luminance(linear);
                if (u.highlights != 0.0) {
                    let hw = highlightWeight(L);
                    let adjustment = 1.0 + u.highlights * hw * 0.5;
                    linear *= adjustment;
                }
                
                L = luminance(linear);
                if (u.shadows != 0.0) {
                    let sw = shadowWeight(L);
                    let adjustment = 1.0 + u.shadows * sw * 0.5;
                    linear *= adjustment;
                }
                
                // === WHITES ===
                L = luminance(linear);
                if (u.whites != 0.0) {
                    let whiteW = smoothstep(0.85, 1.0, L);
                    let adjustment = 1.0 + u.whites * whiteW * 0.4;
                    linear *= adjustment;
                }
                
                // === BLACKS ===
                L = luminance(linear);
                if (u.blacks != 0.0) {
                    let blackW = smoothstep(0.15, 0.0, L);
                    let adjustment = 1.0 + u.blacks * blackW * 0.4;
                    linear *= adjustment;
                }
                
                // === WHITE BALANCE ===
                if (u.temperature != 0.0 || u.tint != 0.0) {
                    linear.r *= 1.0 + u.temperature * 0.25;
                    linear.b *= 1.0 - u.temperature * 0.25;
                    linear.g *= 1.0 - u.tint * 0.15;
                    linear.r *= 1.0 + u.tint * 0.08;
                }
                
                // === VIBRANCE / SATURATION ===
                if (u.vibrance != 0.0 || u.saturation != 0.0) {
                    var lab = linearRGBtoOKLab(linear);
                    let chroma = length(lab.yz);
                    
                    if (u.vibrance != 0.0) {
                        let boost = 1.0 + u.vibrance * (1.0 - min(1.0, chroma / 0.2)) * 0.5;
                        lab = vec3f(lab.x, lab.y * boost, lab.z * boost);
                    }
                    
                    if (u.saturation != 0.0) {
                        lab = vec3f(lab.x, lab.y * (1.0 + u.saturation), lab.z * (1.0 + u.saturation));
                    }
                    
                    linear = OKLabToLinearRGB(lab);
                    linear = max(linear, vec3f(0.0));
                }
                
                // Convert back to sRGB
                let srgb = vec3f(
                    linearToSRGB(clamp(linear.r, 0.0, 1.0)),
                    linearToSRGB(clamp(linear.g, 0.0, 1.0)),
                    linearToSRGB(clamp(linear.b, 0.0, 1.0))
                );
                
                return vec4f(srgb, pixel.a);
            }
        `;

        // Create passthrough pipeline
        this._createPipeline('passthrough', passthroughCode, false);

        // Create develop pipeline
        this._createPipeline('develop', developCode, true);

        console.log('✅ WebGPU shaders compiled');
    }

    /**
     * Create a render pipeline
     */
    _createPipeline(name, code, hasUniforms) {
        const shaderModule = this.device.createShaderModule({ code });

        const bindGroupLayoutEntries = [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }
        ];

        if (hasUniforms) {
            bindGroupLayoutEntries.push({
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' }
            });
        }

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: bindGroupLayoutEntries
        });
        this.bindGroupLayouts.set(name, bindGroupLayout);

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        const pipeline = this.device.createRenderPipeline({
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
                targets: [{ format: this.format }]
            },
            primitive: {
                topology: 'triangle-strip',
                stripIndexFormat: undefined
            }
        });

        this.pipelines.set(name, pipeline);
    }

    /**
     * Create texture from image source
     */
    createTextureFromSource(source) {
        const width = source.naturalWidth || source.width;
        const height = source.naturalHeight || source.height;

        const texture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.device.queue.copyExternalImageToTexture(
            { source },
            { texture },
            [width, height]
        );

        return {
            width,
            height,
            _internal: texture
        };
    }

    /**
     * Create empty texture
     */
    createTexture(width, height) {
        const texture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT
        });

        return {
            width,
            height,
            _internal: texture
        };
    }

    /**
     * Render with develop pipeline
     */
    renderDevelop(inputTexture, uniforms, target = null) {
        const pipeline = this.pipelines.get('develop');
        const bindGroupLayout = this.bindGroupLayouts.get('develop');

        // Create uniform buffer
        const uniformData = new Float32Array([
            uniforms.exposure || 0,
            (uniforms.contrast || 0) / 100,
            (uniforms.highlights || 0) / 100,
            (uniforms.shadows || 0) / 100,
            (uniforms.whites || 0) / 100,
            (uniforms.blacks || 0) / 100,
            (uniforms.temperature || 0) / 100,
            (uniforms.tint || 0) / 100,
            (uniforms.vibrance || 0) / 100,
            (uniforms.saturation || 0) / 100,
            (uniforms.clarity || 0) / 100,
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
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: inputTexture._internal.createView() },
                { binding: 2, resource: { buffer: uniformBuffer } }
            ]
        });

        // Get render target - handle framebuffer structure
        let targetView;
        if (target) {
            // Framebuffer has texture property with _internal
            const targetTexture = target.texture ? target.texture._internal : target._internal;
            targetView = targetTexture.createView();
        } else {
            targetView = this.context.getCurrentTexture().createView();
        }

        // Create command encoder
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.texCoordBuffer);
        passEncoder.draw(4);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);

        // Store last render state for readback (toImageData)
        this._lastInputTexture = inputTexture;
        this._lastUniforms = uniforms;

        // Cleanup
        uniformBuffer.destroy();
    }

    /**
     * Render passthrough
     */
    renderPassthrough(inputTexture, target = null) {
        const pipeline = this.pipelines.get('passthrough');
        const bindGroupLayout = this.bindGroupLayouts.get('passthrough');

        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: inputTexture._internal.createView() }
            ]
        });

        // Handle framebuffer structure
        let targetView;
        if (target) {
            const targetTexture = target.texture ? target.texture._internal : target._internal;
            targetView = targetTexture.createView();
        } else {
            targetView = this.context.getCurrentTexture().createView();
        }

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.texCoordBuffer);
        passEncoder.draw(4);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    /**
     * Create framebuffer for render-to-texture operations
     * @param {number} width 
     * @param {number} height 
     * @returns {Object} Framebuffer handle with texture property
     */
    createFramebuffer(width, height) {
        // Create render target texture - IMPORTANT: use same format as canvas
        // to ensure pipeline compatibility (BGRA8Unorm on most systems)
        const texture = this.device.createTexture({
            size: [width, height],
            format: this.format, // Use canvas format, not hardcoded rgba8unorm
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.COPY_SRC
        });

        return {
            texture: {
                width,
                height,
                _internal: texture
            },
            _internal: texture,
            width,
            height
        };
    }

    /**
     * Read pixels from canvas (async operation in WebGPU)
     * Note: This is a synchronous stub that reads from the canvas context
     * @returns {Uint8Array} Pixel data in RGBA format
     */
    readPixels() {
        // WebGPU doesn't have synchronous readPixels like WebGL
        // Fall back to canvas 2D context for now
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.canvas.width = this.width;
        ctx.canvas.height = this.height;
        ctx.drawImage(this.canvas, 0, 0);
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        return new Uint8Array(imageData.data.buffer);
    }

    /**
     * Convert canvas to ImageData for histogram and other uses
     * Re-renders to a fresh texture since WebGPU clears backbuffer after presentation
     * @returns {ImageData}
     */
    toImageData() {
        // WebGPU clears the backbuffer after presenting, so drawImage returns black
        // We need to re-render to a fresh texture and read from there

        if (!this._lastInputTexture) {
            console.warn('No input texture available for toImageData');
            return new ImageData(this.width || 1, this.height || 1);
        }

        // Create a fresh framebuffer for readback
        const readFBO = this.createFramebuffer(this.width, this.height);

        // Re-render with last uniforms
        this.renderDevelop(this._lastInputTexture, this._lastUniforms || {}, readFBO);

        // Now render the FBO to canvas so we can read it
        this.renderPassthrough(readFBO.texture, null);

        // Read from canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.width;
        tempCanvas.height = this.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(this.canvas, 0, 0);

        // Cleanup FBO
        this.deleteFramebuffer(readFBO);

        return ctx.getImageData(0, 0, this.width, this.height);
    }

    /**
     * Delete framebuffer and its texture
     * @param {Object} framebuffer 
     */
    deleteFramebuffer(framebuffer) {
        if (framebuffer) {
            if (framebuffer._internal) {
                framebuffer._internal.destroy();
            }
            // Also destroy the texture wrapper if it exists separately
            if (framebuffer.texture && framebuffer.texture._internal !== framebuffer._internal) {
                framebuffer.texture._internal.destroy();
            }
        }
    }

    /**
     * Delete texture
     */
    deleteTexture(texture) {
        if (texture?._internal) {
            texture._internal.destroy();
        }
    }

    /**
     * Cleanup
     */
    dispose() {
        this.vertexBuffer?.destroy();
        this.texCoordBuffer?.destroy();
        this.pipelines.clear();
        this.bindGroupLayouts.clear();
        this.device = null;
        this.isReady = false;
    }
}
