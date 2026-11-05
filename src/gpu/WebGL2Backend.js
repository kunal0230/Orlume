/**
 * WebGL2Backend - WebGL2 implementation of GPUBackend
 * 
 * Provides WebGL2 fallback for browsers that don't support WebGPU.
 * This is a refactored version of the original GPUProcessor.
 */

import { GPUBackend } from './GPUBackend.js';
import developShaderSrc from './shaders/develop.glsl?raw';
import blurShaderSrc from './shaders/blur.glsl?raw';
import commonShaderSrc from './shaders/modules/common.glsl?raw';
import colorGradingShaderSrc from './shaders/modules/color_grading.glsl?raw';

export class WebGL2Backend extends GPUBackend {
    constructor(canvas) {
        super(canvas);
        this.gl = null;
        this.gl = null;
        this.programs = new Map();

        // Buffers
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.texCoordBufferFBO = null;

        // Multi-pass FBOs
        this.blurFbo1 = null;
        this.blurFbo2 = null;

        // 3D LUT resources
        this._lut3dTex = null;
        this._defaultLut3dTex = null;
        this._lastLut3dData = null;
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
            alpha: true,  // Enable alpha for transparent PNG support
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

        // Enable blending for proper alpha compositing
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Create quad buffers
        this._createQuadBuffers();

        // Compile shaders
        const success = await this._compileShaders();
        if (!success) return false;

        this.isReady = true;
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
    async _compileShaders() {
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
            uniform bool u_showClipping;
            uniform bool u_clipShadows;
            uniform bool u_clipHighlights;
            out vec4 fragColor;
            
            void main() {
                vec4 col = texture(u_texture, v_texCoord);
                if (u_showClipping) {
                    if (u_clipHighlights && (col.r >= 0.996 && col.g >= 0.996 && col.b >= 0.996)) {
                        fragColor = vec4(1.0, 0.0, 0.0, col.a);
                        return;
                    }
                    if (u_clipShadows && (col.r <= 0.003 && col.g <= 0.003 && col.b <= 0.003)) {
                        fragColor = vec4(0.0, 0.35, 1.0, col.a);
                        return;
                    }
                }
                fragColor = col;
            }
        `;

        // Load develop and blur shaders from external file
        let developFragment, blurFragment;
        try {
            developFragment = await this._loadShader('develop.glsl');
            blurFragment = await this._loadShader('blur.glsl');
        } catch (e) {
            console.error('Failed to load shaders:', e);
            return false;
        }

        this.programs.set('passthrough', this._createProgram(vertexShader, passthroughFragment));
        this.programs.set('develop', this._createProgram(vertexShader, developFragment));
        this.programs.set('blur', this._createProgram(vertexShader, blurFragment));

        // Cache blur uniform locations
        const blur = this.programs.get('blur');
        if (blur) {
            const gl = this.gl;
            blur.u_direction = gl.getUniformLocation(blur, 'u_direction');
            blur.u_resolution = gl.getUniformLocation(blur, 'u_resolution');
        }

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
            dev.u_structure = gl.getUniformLocation(dev, 'u_structure');
            dev.u_dehaze = gl.getUniformLocation(dev, 'u_dehaze');
            dev.u_blurTexture = gl.getUniformLocation(dev, 'u_blurTexture');

            // HSL per-channel uniforms (arrays of 8 floats each)
            dev.u_hslHue = gl.getUniformLocation(dev, 'u_hslHue');
            dev.u_hslSat = gl.getUniformLocation(dev, 'u_hslSat');
            dev.u_hslLum = gl.getUniformLocation(dev, 'u_hslLum');

            // Tone curve LUT uniforms
            dev.u_hasCurveLut = gl.getUniformLocation(dev, 'u_hasCurveLut');
            dev.u_hasRgbCurve = gl.getUniformLocation(dev, 'u_hasRgbCurve');
            dev.u_curveLutTexRgb = gl.getUniformLocation(dev, 'u_curveLutTexRgb');
            dev.u_hasRedCurve = gl.getUniformLocation(dev, 'u_hasRedCurve');
            dev.u_curveLutTexRed = gl.getUniformLocation(dev, 'u_curveLutTexRed');
            dev.u_hasGreenCurve = gl.getUniformLocation(dev, 'u_hasGreenCurve');
            dev.u_curveLutTexGreen = gl.getUniformLocation(dev, 'u_curveLutTexGreen');
            dev.u_hasBlueCurve = gl.getUniformLocation(dev, 'u_hasBlueCurve');
            dev.u_curveLutTexBlue = gl.getUniformLocation(dev, 'u_curveLutTexBlue');

            // 3D LUT uniforms
            dev.u_hasLut3d = gl.getUniformLocation(dev, 'u_hasLut3d');
            dev.u_lut3dTexture = gl.getUniformLocation(dev, 'u_lut3dTexture');
            dev.u_lut3dIntensity = gl.getUniformLocation(dev, 'u_lut3dIntensity');
            dev.u_lut3dSize = gl.getUniformLocation(dev, 'u_lut3dSize');
        }

        return true;
    }

    /**
     * Load shader from imported strings and handle includes
     */
    async _loadShader(name) {
        // Map names to imported sources
        const shaderMap = {
            'develop.glsl': developShaderSrc,
            'blur.glsl': blurShaderSrc,
            'modules/common.glsl': commonShaderSrc,
            'modules/color_grading.glsl': colorGradingShaderSrc
        };

        let source = shaderMap[name];
        if (!source) throw new Error(`Shader not found: ${name}`);

        // Handle #include <path>
        // Note: Simple regex replacement, doesn't handle nested includes recursively yet
        // but supports multiple includes in the main file.
        const includeRegex = /#include\s+<(.+)>/g;
        const matches = [...source.matchAll(includeRegex)];

        for (const match of matches) {
            const includePath = match[1];
            // Resolve include from map
            const includeSrc = shaderMap[includePath];
            if (!includeSrc) {
                console.error(`Include not found: ${includePath}`);
                continue;
            }
            source = source.replace(match[0], includeSrc);
        }

        return source;
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
        if (!texture) return null;
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
        if (!texture) return null;
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
     * Helper to manage blur FBOs
     */
    _ensureBlurFbos(width, height) {
        if (!this.blurFbo1 || this.blurFbo1.texture.width !== width || this.blurFbo1.texture.height !== height) {
            this.deleteFramebuffer(this.blurFbo1);
            this.deleteFramebuffer(this.blurFbo2);
            this.blurFbo1 = this.createFramebuffer(width, height);
            this.blurFbo2 = this.createFramebuffer(width, height);
        }
    }

    /**
     * Render a blur pass
     */
    _renderBlurPass(inputTexture, outputFbo, direction) {
        const gl = this.gl;
        const program = this.programs.get('blur');
        const rawTexture = (typeof WebGLTexture !== 'undefined' && inputTexture instanceof WebGLTexture)
            ? inputTexture
            : inputTexture?._internal;
        if (!program || !rawTexture || typeof WebGLTexture === 'undefined' || !(rawTexture instanceof WebGLTexture)) return;
        try {
            if (!gl.isTexture(rawTexture)) return;
        } catch {
            return;
        }
        gl.useProgram(program);

        gl.uniform2f(program.u_direction, direction[0], direction[1]);
        gl.uniform2f(program.u_resolution, this.width, this.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rawTexture);
        gl.uniform1i(program.u_texture, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, outputFbo._internal);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Render develop
     */
    renderDevelop(inputTexture, uniforms, target = null, clippingOpts = null) {
        const gl = this.gl;

        // === MULTI-PASS PRE-PROCESSING ===
        let blurTexture = inputTexture; // Default fallback if no blur needed

        if ((uniforms.clarity && uniforms.clarity !== 0) || (uniforms.structure && uniforms.structure !== 0)) {

            this._ensureBlurFbos(this.width, this.height);

            // Pass 1: Horizontal Blur (Input -> FBO1)
            this._renderBlurPass(inputTexture, this.blurFbo1, [1.0, 0.0]);

            // Pass 2: Vertical Blur (FBO1 -> FBO2)
            this._renderBlurPass(this.blurFbo1.texture, this.blurFbo2, [0.0, 1.0]);

            blurTexture = this.blurFbo2.texture;
        } else {
            // No blur needed, blurTexture stays as inputTexture // FIXED: no-empty
        }

        // === FINAL PASS ===
        const program = this.programs.get('develop');
        const rawInput = (typeof WebGLTexture !== 'undefined' && inputTexture instanceof WebGLTexture)
            ? inputTexture
            : inputTexture?._internal;
        if (!program || !rawInput || typeof WebGLTexture === 'undefined' || !(rawInput instanceof WebGLTexture)) return;
        try {
            if (!gl.isTexture(rawInput)) return;
        } catch {
            return;
        }

        gl.useProgram(program);

        // Bind Blur Texture to Unit 5 (0-4 are used by main and LUTS)
        const rawBlur = (typeof WebGLTexture !== 'undefined' && blurTexture instanceof WebGLTexture)
            ? blurTexture
            : blurTexture?._internal;
        if (rawBlur && typeof WebGLTexture !== 'undefined' && (rawBlur instanceof WebGLTexture)) {
            let isValid = false;
            try { isValid = gl.isTexture(rawBlur); } catch { isValid = false; }
            if (isValid) {
                gl.activeTexture(gl.TEXTURE5);
                gl.bindTexture(gl.TEXTURE_2D, rawBlur);
                gl.uniform1i(program.u_blurTexture, 5);
            }
        }

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
        gl.uniform1f(program.u_structure, (uniforms.structure || 0) / 100);
        gl.uniform1f(program.u_dehaze, (uniforms.dehaze || 0) / 100);


        // Color Grading Uniforms
        gl.uniform2f(program.u_shadowsColor, uniforms.shadowsHue || 0, uniforms.shadowsSat || 0);
        gl.uniform2f(program.u_midtonesColor, uniforms.midtonesHue || 0, uniforms.midtonesSat || 0);
        gl.uniform2f(program.u_highlightsColor, uniforms.highlightsHue || 0, uniforms.highlightsSat || 0);
        gl.uniform1f(program.u_shadowsLum, uniforms.shadowsLum || 0);
        gl.uniform1f(program.u_midtonesLum, uniforms.midtonesLum || 0);
        gl.uniform1f(program.u_highlightsLum, uniforms.highlightsLum || 0);

        gl.uniform1f(program.u_colorBalance, (uniforms.colorBalance || 0));
        gl.uniform1f(program.u_colorBlending, (uniforms.colorBlending !== undefined ? uniforms.colorBlending : 50)); // Default blending 50

        // HSL per-channel uniforms (arrays of 8 floats)
        // Order: Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta
        const hslHue = new Float32Array([
            uniforms.hslHueRed || 0,
            uniforms.hslHueOrange || 0,
            uniforms.hslHueYellow || 0,
            uniforms.hslHueGreen || 0,
            uniforms.hslHueAqua || 0,
            uniforms.hslHueBlue || 0,
            uniforms.hslHuePurple || 0,
            uniforms.hslHueMagenta || 0
        ]);
        const hslSat = new Float32Array([
            uniforms.hslSatRed || 0,
            uniforms.hslSatOrange || 0,
            uniforms.hslSatYellow || 0,
            uniforms.hslSatGreen || 0,
            uniforms.hslSatAqua || 0,
            uniforms.hslSatBlue || 0,
            uniforms.hslSatPurple || 0,
            uniforms.hslSatMagenta || 0
        ]);
        const hslLum = new Float32Array([
            uniforms.hslLumRed || 0,
            uniforms.hslLumOrange || 0,
            uniforms.hslLumYellow || 0,
            uniforms.hslLumGreen || 0,
            uniforms.hslLumAqua || 0,
            uniforms.hslLumBlue || 0,
            uniforms.hslLumPurple || 0,
            uniforms.hslLumMagenta || 0
        ]);

        gl.uniform1fv(program.u_hslHue, hslHue);
        gl.uniform1fv(program.u_hslSat, hslSat);
        gl.uniform1fv(program.u_hslLum, hslLum);

        // Tone Curve LUT textures
        // Use length check instead of instanceof for robustness
        const hasRgbCurve = uniforms.curveLutRgb && uniforms.curveLutRgb.length > 0;
        const hasRedCurve = uniforms.curveLutRed && uniforms.curveLutRed.length > 0;
        const hasGreenCurve = uniforms.curveLutGreen && uniforms.curveLutGreen.length > 0;
        const hasBlueCurve = uniforms.curveLutBlue && uniforms.curveLutBlue.length > 0;
        const hasAnyCurve = hasRgbCurve || hasRedCurve || hasGreenCurve || hasBlueCurve;

        gl.uniform1i(program.u_hasCurveLut, hasAnyCurve ? 1 : 0);
        gl.uniform1i(program.u_hasRgbCurve, hasRgbCurve ? 1 : 0);
        gl.uniform1i(program.u_hasRedCurve, hasRedCurve ? 1 : 0);
        gl.uniform1i(program.u_hasGreenCurve, hasGreenCurve ? 1 : 0);
        gl.uniform1i(program.u_hasBlueCurve, hasBlueCurve ? 1 : 0);

        // Exposure clipping warning uniforms
        if (clippingOpts && clippingOpts.show) {
            gl.uniform1i(gl.getUniformLocation(program, 'u_showClipping'), 1);
            gl.uniform1i(gl.getUniformLocation(program, 'u_clipShadows'), clippingOpts.shadows ? 1 : 0);
            gl.uniform1i(gl.getUniformLocation(program, 'u_clipHighlights'), clippingOpts.highlights ? 1 : 0);
        } else {
            gl.uniform1i(gl.getUniformLocation(program, 'u_showClipping'), 0);
        }

        // Create/update LUT textures if needed
        if (hasRgbCurve) {
            this._curveLutTexRgb = this._updateLutTexture(this._curveLutTexRgb, uniforms.curveLutRgb);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this._curveLutTexRgb);
            gl.uniform1i(program.u_curveLutTexRgb, 1);
        }
        if (hasRedCurve) {
            this._curveLutTexRed = this._updateLutTexture(this._curveLutTexRed, uniforms.curveLutRed);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this._curveLutTexRed);
            gl.uniform1i(program.u_curveLutTexRed, 2);
        }
        if (hasGreenCurve) {
            this._curveLutTexGreen = this._updateLutTexture(this._curveLutTexGreen, uniforms.curveLutGreen);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this._curveLutTexGreen);
            gl.uniform1i(program.u_curveLutTexGreen, 3);
        }
        if (hasBlueCurve) {
            this._curveLutTexBlue = this._updateLutTexture(this._curveLutTexBlue, uniforms.curveLutBlue);
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, this._curveLutTexBlue);
            gl.uniform1i(program.u_curveLutTexBlue, 4);
        }

        // 3D LUT Color Grading
        const hasLut3d = Boolean(uniforms.lut3d && uniforms.lut3d.data && uniforms.lut3d.size > 0);
        const lutIntensity = (uniforms.lut3dIntensity !== undefined ? uniforms.lut3dIntensity : 100) / 100;

        gl.uniform1i(program.u_hasLut3d, hasLut3d ? 1 : 0);
        gl.uniform1f(program.u_lut3dIntensity, lutIntensity);
        gl.uniform1f(program.u_lut3dSize, hasLut3d ? uniforms.lut3d.size : 2.0);

        if (hasLut3d) {
            if (this._lastLut3dData !== uniforms.lut3d) {
                this._lut3dTex = this._updateLut3dTexture(this._lut3dTex, uniforms.lut3d);
                this._lastLut3dData = uniforms.lut3d;
            }
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_3D, this._lut3dTex);
            gl.uniform1i(program.u_lut3dTexture, 6);
        } else {
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_3D, this._getOrCreateDefaultLut3d());
            gl.uniform1i(program.u_lut3dTexture, 6);
        }

        // Bind main texture
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
     * Create or update a 1D LUT texture from Float32Array data
     */
    _updateLutTexture(existingTexture, lutData) {
        const gl = this.gl;
        const ext = gl.getExtension('OES_texture_float_linear');
        const filter = ext ? gl.LINEAR : gl.NEAREST;

        // Create texture if needed
        let texture = existingTexture;
        let isExistingValid = false;
        if (texture && typeof WebGLTexture !== 'undefined' && (texture instanceof WebGLTexture)) {
            try { isExistingValid = gl.isTexture(texture); } catch { isExistingValid = false; }
        }
        if (!isExistingValid) {
            texture = gl.createTexture();
            if (!texture) return null;
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        } else {
            gl.bindTexture(gl.TEXTURE_2D, texture);
        }

        // Upload LUT data as 256x1 R32F texture
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 1, 0, gl.RED, gl.FLOAT, lutData);

        return texture;
    }

    /**
     * Get or create a 2x2x2 identity 3D LUT texture
     */
    _getOrCreateDefaultLut3d() {
        const gl = this.gl;
        if (!this._defaultLut3dTex) {
            this._defaultLut3dTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_3D, this._defaultLut3dTex);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

            const identity = new Uint8Array([
                0, 0, 0, 255,     255, 0, 0, 255,
                0, 255, 0, 255,   255, 255, 0, 255,
                0, 0, 255, 255,   255, 0, 255, 255,
                0, 255, 255, 255, 255, 255, 255, 255
            ]);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 2, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, identity);
        }
        return this._defaultLut3dTex;
    }

    /**
     * Create or update a 3D LUT texture from RGBA Uint8Array
     */
    _updateLut3dTexture(existingTexture, lutInfo) {
        const gl = this.gl;
        const texture = existingTexture || gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, texture);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        const size = lutInfo.size;
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutInfo.data);
        return texture;
    }

    /**
     * Render passthrough
     */
    renderPassthrough(inputTexture, target = null, useFBOCoords = false, clippingOpts = null) {
        const gl = this.gl;
        const program = this.programs.get('passthrough');
        const rawTexture = (typeof WebGLTexture !== 'undefined' && inputTexture instanceof WebGLTexture)
            ? inputTexture
            : inputTexture?._internal;

        if (!program || !rawTexture || typeof WebGLTexture === 'undefined' || !(rawTexture instanceof WebGLTexture)) return;
        try {
            if (!gl.isTexture(rawTexture)) return;
        } catch {
            return;
        }

        gl.useProgram(program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rawTexture);
        gl.uniform1i(program.u_texture, 0);

        // Exposure clipping warning uniforms
        if (clippingOpts && clippingOpts.show) {
            gl.uniform1i(gl.getUniformLocation(program, 'u_showClipping'), 1);
            gl.uniform1i(gl.getUniformLocation(program, 'u_clipShadows'), clippingOpts.shadows ? 1 : 0);
            gl.uniform1i(gl.getUniformLocation(program, 'u_clipHighlights'), clippingOpts.highlights ? 1 : 0);
        } else {
            gl.uniform1i(gl.getUniformLocation(program, 'u_showClipping'), 0);
        }

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
