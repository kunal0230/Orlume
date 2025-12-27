/**
 * WebGL2Backend - WebGL2 implementation of GPUBackend
 * 
 * Provides WebGL2 fallback for browsers that don't support WebGPU.
 * This is a refactored version of the original GPUProcessor.
 */

import { GPUBackend } from './GPUBackend.js';

export class WebGL2Backend extends GPUBackend {
    constructor(canvas) {
        super(canvas);
        this.gl = null;
        this.programs = new Map();

        // Buffers
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.texCoordBufferFBO = null;
    }

    /**
     * Check if WebGL2 is supported
     */
    static async isSupported() {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl2');
        return gl !== null;
    }

    getName() {
        return 'WebGL2';
    }

    /**
     * Initialize WebGL2 context
     */
    async init() {
        this.gl = this.canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: true,
            premultipliedAlpha: false
        });

        if (!this.gl) {
            console.warn('WebGL2 not available');
            return false;
        }

        const gl = this.gl;

        // Enable extensions
        gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');

        // Create quad buffers
        this._createQuadBuffers();

        // Compile shaders
        this._compileShaders();

        this.isReady = true;
        console.log('🎮 WebGL2 initialized');
        return true;
    }

    /**
     * Create vertex buffers for fullscreen quad
     */
    _createQuadBuffers() {
        const gl = this.gl;

        const positions = new Float32Array([
            -1, -1, 1, -1, -1, 1, 1, 1
        ]);

        const texCoords = new Float32Array([
            0, 1, 1, 1, 0, 0, 1, 0
        ]);

        const texCoordsFBO = new Float32Array([
            0, 0, 1, 0, 0, 1, 1, 1
        ]);

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        this.texCoordBufferFBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBufferFBO);
        gl.bufferData(gl.ARRAY_BUFFER, texCoordsFBO, gl.STATIC_DRAW);
    }

    /**
     * Compile GLSL shaders
     */
    _compileShaders() {
        const vertexShader = `#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            out vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        const passthroughFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            uniform sampler2D u_texture;
            out vec4 fragColor;
            
            void main() {
                fragColor = texture(u_texture, v_texCoord);
            }
        `;

        const developFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            uniform sampler2D u_texture;
            out vec4 fragColor;
            
            uniform float u_exposure;
            uniform float u_contrast;
            uniform float u_highlights;
            uniform float u_shadows;
            uniform float u_whites;
            uniform float u_blacks;
            uniform float u_temperature;
            uniform float u_tint;
            uniform float u_vibrance;
            uniform float u_saturation;
            uniform float u_clarity;
            
            float sRGBtoLinear(float c) {
                return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
            }
            
            float linearToSRGB(float c) {
                return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
            }
            
            float luminance(vec3 c) {
                return dot(c, vec3(0.2126, 0.7152, 0.0722));
            }
            
            float shadowWeight(float L) { return smoothstep(0.3, 0.0, L); }
            float midtoneWeight(float L) { return exp(-pow((L - 0.5) / 0.25, 2.0) * 0.5); }
            float highlightWeight(float L) { return smoothstep(0.7, 1.0, L); }
            
            float softShoulder(float x, float knee) {
                if (x <= knee) return x;
                float over = x - knee;
                return knee + over / (1.0 + over * 2.0);
            }
            
            vec3 linearRGBtoOKLab(vec3 rgb) {
                float l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
                float m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
                float s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
                l = pow(max(0.0, l), 1.0/3.0);
                m = pow(max(0.0, m), 1.0/3.0);
                s = pow(max(0.0, s), 1.0/3.0);
                return vec3(
                    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
                );
            }
            
            vec3 OKLabToLinearRGB(vec3 lab) {
                float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
                float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
                float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
                l = l * l * l; m = m * m * m; s = s * s * s;
                return vec3(
                    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
                );
            }
            
            void main() {
                vec4 pixel = texture(u_texture, v_texCoord);
                vec3 linear = vec3(sRGBtoLinear(pixel.r), sRGBtoLinear(pixel.g), sRGBtoLinear(pixel.b));
                
                float L = luminance(linear);
                float midW = midtoneWeight(L);
                float shadowW = shadowWeight(L);
                float highlightW = highlightWeight(L);
                
                // Exposure
                if (u_exposure != 0.0) {
                    float gain = pow(2.0, u_exposure);
                    float effectiveGain = 1.0 + (gain - 1.0) * (0.5 + midW * 0.5);
                    linear *= effectiveGain;
                    if (u_exposure > 0.0) {
                        float newL = luminance(linear);
                        if (newL > 0.7) linear *= softShoulder(newL, 0.7) / max(newL, 0.001);
                    }
                }
                
                L = luminance(linear);
                midW = midtoneWeight(L);
                shadowW = shadowWeight(L);
                highlightW = highlightWeight(L);
                
                // Contrast
                if (u_contrast != 0.0) {
                    float k = u_contrast > 0.0 ? pow(abs(u_contrast), 0.7) * 3.5 : -pow(abs(u_contrast), 0.7) * 0.6;
                    float effectiveK = k * (0.3 + midW * 0.7);
                    float delta = L - 0.18;
                    float newL;
                    if (u_contrast > 0.0) {
                        float compressed = delta / (1.0 + abs(delta) * abs(effectiveK));
                        newL = 0.18 + compressed * (1.0 + abs(effectiveK) * 0.5);
                        if (shadowW > 0.3) newL = L + (newL - L) * (1.0 - shadowW * 0.5);
                        if (highlightW > 0.3) newL = L + (newL - L) * (1.0 - highlightW * 0.4);
                    } else {
                        newL = L + (0.18 - L) * abs(effectiveK);
                    }
                    linear *= max(newL, 0.0) / max(L, 0.001);
                }
                
                // Highlights/Shadows
                L = luminance(linear);
                if (u_highlights != 0.0) linear *= 1.0 + u_highlights * highlightWeight(L) * 0.5;
                L = luminance(linear);
                if (u_shadows != 0.0) linear *= 1.0 + u_shadows * shadowWeight(L) * 0.5;
                
                // Whites/Blacks
                L = luminance(linear);
                if (u_whites != 0.0) linear *= 1.0 + u_whites * smoothstep(0.85, 1.0, L) * 0.4;
                L = luminance(linear);
                if (u_blacks != 0.0) linear *= 1.0 + u_blacks * smoothstep(0.15, 0.0, L) * 0.4;
                
                // White Balance
                if (u_temperature != 0.0 || u_tint != 0.0) {
                    linear.r *= 1.0 + u_temperature * 0.25;
                    linear.b *= 1.0 - u_temperature * 0.25;
                    linear.g *= 1.0 - u_tint * 0.15;
                    linear.r *= 1.0 + u_tint * 0.08;
                }
                
                // Vibrance/Saturation
                if (u_vibrance != 0.0 || u_saturation != 0.0) {
                    vec3 lab = linearRGBtoOKLab(linear);
                    float chroma = length(lab.yz);
                    if (u_vibrance != 0.0) lab.yz *= 1.0 + u_vibrance * (1.0 - min(1.0, chroma / 0.2)) * 0.5;
                    if (u_saturation != 0.0) lab.yz *= 1.0 + u_saturation;
                    linear = max(OKLabToLinearRGB(lab), vec3(0.0));
                }
                
                vec3 srgb = vec3(linearToSRGB(clamp(linear.r, 0.0, 1.0)), linearToSRGB(clamp(linear.g, 0.0, 1.0)), linearToSRGB(clamp(linear.b, 0.0, 1.0)));
                fragColor = vec4(srgb, pixel.a);
            }
        `;

        this.programs.set('passthrough', this._createProgram(vertexShader, passthroughFragment));
        this.programs.set('develop', this._createProgram(vertexShader, developFragment));

        // Cache develop uniform locations
        const dev = this.programs.get('develop');
        if (dev) {
            const gl = this.gl;
            dev.u_exposure = gl.getUniformLocation(dev, 'u_exposure');
            dev.u_contrast = gl.getUniformLocation(dev, 'u_contrast');
            dev.u_highlights = gl.getUniformLocation(dev, 'u_highlights');
            dev.u_shadows = gl.getUniformLocation(dev, 'u_shadows');
            dev.u_whites = gl.getUniformLocation(dev, 'u_whites');
            dev.u_blacks = gl.getUniformLocation(dev, 'u_blacks');
            dev.u_temperature = gl.getUniformLocation(dev, 'u_temperature');
            dev.u_tint = gl.getUniformLocation(dev, 'u_tint');
            dev.u_vibrance = gl.getUniformLocation(dev, 'u_vibrance');
            dev.u_saturation = gl.getUniformLocation(dev, 'u_saturation');
            dev.u_clarity = gl.getUniformLocation(dev, 'u_clarity');
        }

        console.log('✅ WebGL2 shaders compiled');
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    _createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;
        const vs = this._compileShader(gl.VERTEX_SHADER, vertexSource);
        const fs = this._compileShader(gl.FRAGMENT_SHADER, fragmentSource);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }

        program.a_position = gl.getAttribLocation(program, 'a_position');
        program.a_texCoord = gl.getAttribLocation(program, 'a_texCoord');
        program.u_texture = gl.getUniformLocation(program, 'u_texture');

        return program;
    }

    /**
     * Create texture from source
     */
    createTextureFromSource(source) {
        const gl = this.gl;
        const width = source.naturalWidth || source.width;
        const height = source.naturalHeight || source.height;

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        return { width, height, _internal: texture };
    }

    /**
     * Create empty texture
     */
    createTexture(width, height) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return { width, height, _internal: texture };
    }

    /**
     * Create framebuffer
     */
    createFramebuffer(width, height) {
        const gl = this.gl;
        const texture = this.createTexture(width, height);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture._internal, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { texture, _internal: fbo };
    }

    /**
     * Render develop
     */
    renderDevelop(inputTexture, uniforms, target = null) {
        const gl = this.gl;
        const program = this.programs.get('develop');
        if (!program) return;

        gl.useProgram(program);

        // Set uniforms
        gl.uniform1f(program.u_exposure, uniforms.exposure || 0);
        gl.uniform1f(program.u_contrast, (uniforms.contrast || 0) / 100);
        gl.uniform1f(program.u_highlights, (uniforms.highlights || 0) / 100);
        gl.uniform1f(program.u_shadows, (uniforms.shadows || 0) / 100);
        gl.uniform1f(program.u_whites, (uniforms.whites || 0) / 100);
        gl.uniform1f(program.u_blacks, (uniforms.blacks || 0) / 100);
        gl.uniform1f(program.u_temperature, (uniforms.temperature || 0) / 100);
        gl.uniform1f(program.u_tint, (uniforms.tint || 0) / 100);
        gl.uniform1f(program.u_vibrance, (uniforms.vibrance || 0) / 100);
        gl.uniform1f(program.u_saturation, (uniforms.saturation || 0) / 100);
        gl.uniform1f(program.u_clarity, (uniforms.clarity || 0) / 100);

        // Bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture._internal);
        gl.uniform1i(program.u_texture, 0);

        // Vertex attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        // Render
        gl.bindFramebuffer(gl.FRAMEBUFFER, target?._internal || null);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Render passthrough
     */
    renderPassthrough(inputTexture, target = null, useFBOCoords = false) {
        const gl = this.gl;
        const program = this.programs.get('passthrough');
        if (!program) return;

        gl.useProgram(program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture._internal);
        gl.uniform1i(program.u_texture, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, useFBOCoords ? this.texCoordBufferFBO : this.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, target?._internal || null);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Read pixels
     */
    readPixels() {
        const gl = this.gl;
        const pixels = new Uint8Array(this.width * this.height * 4);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
    }

    /**
     * To ImageData
     */
    toImageData() {
        const pixels = this.readPixels();
        const flipped = new Uint8ClampedArray(this.width * this.height * 4);
        const rowSize = this.width * 4;
        for (let y = 0; y < this.height; y++) {
            const srcRow = (this.height - 1 - y) * rowSize;
            const dstRow = y * rowSize;
            flipped.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
        }
        return new ImageData(flipped, this.width, this.height);
    }

    /**
     * Delete texture
     */
    deleteTexture(texture) {
        if (texture?._internal) {
            this.gl.deleteTexture(texture._internal);
        }
    }

    /**
     * Delete framebuffer
     */
    deleteFramebuffer(framebuffer) {
        if (framebuffer) {
            this.gl.deleteFramebuffer(framebuffer._internal);
            this.deleteTexture(framebuffer.texture);
        }
    }

    /**
     * Dispose
     */
    dispose() {
        const gl = this.gl;
        if (gl) {
            this.programs.forEach(p => gl.deleteProgram(p));
            if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
            if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
            if (this.texCoordBufferFBO) gl.deleteBuffer(this.texCoordBufferFBO);
        }
        this.programs.clear();
        this.isReady = false;
    }
}
