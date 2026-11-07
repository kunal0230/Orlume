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

/**
 * Convert HSL Hue in degrees [0, 360] to normalized OKLab chromaticity direction (a, b)
 */
/**
 * Convert HSL Hue in degrees [0, 360] to normalized OKLab chromaticity direction (a, b).
 * In OKLab, perceptual hue is defined as atan2(b, a), so the correct unit-circle direction
 * for hue angle θ is simply (cos θ, sin θ). This avoids the up to 57.6° error introduced by
 * the previous RGB-intermediate approach (sRGB primaries are not evenly spaced in OKLab).
 */
function hslHueToOKLabChromaDir(hueDegrees) {
    if (hueDegrees === undefined || hueDegrees === null) return [0, 0];
    const rad = ((hueDegrees % 360) + 360) % 360 * (Math.PI / 180.0);
    return [Math.cos(rad), Math.sin(rad)];
}

/**
 * Accurate sRGB to Bradford LMS matrices for CPU precomputation
 */
const BRADFORD_SRGB_TO_LMS = [
    [0.422725, 0.491345, 0.027358],
    [0.055700, 0.961534, 0.023184],
    [0.021383, 0.087642, 0.980508]
];

const BRADFORD_LMS_TO_SRGB = [
    [ 2.538045, -1.293277, -0.040237],
    [-0.146004,  1.116648, -0.022329],
    [-0.042299, -0.071607,  1.022753]
];

function computeWhitebalanceMatrix(temperature = 0, tint = 0, outMatrix = null) {
    const target = outMatrix || new Float32Array(9);
    if (temperature === 0 && tint === 0) {
        target[0] = 1; target[1] = 0; target[2] = 0;
        target[3] = 0; target[4] = 1; target[5] = 0;
        target[6] = 0; target[7] = 0; target[8] = 1;
        return target;
    }
    const temp = temperature * 0.35;
    const t = tint * 0.35;
    const sL = (1.0 + temp) * (1.0 + t * 0.30);
    const sM = 1.0 - t * 0.65;
    const sS = (1.0 - temp) * (1.0 + t * 0.30);

    const M1 = BRADFORD_LMS_TO_SRGB;
    const M0 = BRADFORD_SRGB_TO_LMS;

    const M1_00 = M1[0][0] * sL, M1_01 = M1[0][1] * sM, M1_02 = M1[0][2] * sS;
    const M1_10 = M1[1][0] * sL, M1_11 = M1[1][1] * sM, M1_12 = M1[1][2] * sS;
    const M1_20 = M1[2][0] * sL, M1_21 = M1[2][1] * sM, M1_22 = M1[2][2] * sS;

    const R00 = M1_00*M0[0][0] + M1_01*M0[1][0] + M1_02*M0[2][0];
    const R01 = M1_00*M0[0][1] + M1_01*M0[1][1] + M1_02*M0[2][1];
    const R02 = M1_00*M0[0][2] + M1_01*M0[1][2] + M1_02*M0[2][2];

    const R10 = M1_10*M0[0][0] + M1_11*M0[1][0] + M1_12*M0[2][0];
    const R11 = M1_10*M0[0][1] + M1_11*M0[1][1] + M1_12*M0[2][1];
    const R12 = M1_10*M0[0][2] + M1_11*M0[1][2] + M1_12*M0[2][2];

    const R20 = M1_20*M0[0][0] + M1_21*M0[1][0] + M1_22*M0[2][0];
    const R21 = M1_20*M0[0][1] + M1_21*M0[1][1] + M1_22*M0[2][1];
    const R22 = M1_20*M0[0][2] + M1_21*M0[1][2] + M1_22*M0[2][2];

    target[0] = R00; target[1] = R10; target[2] = R20;
    target[3] = R01; target[4] = R11; target[5] = R21;
    target[6] = R02; target[7] = R12; target[8] = R22;
    return target;
}

export class WebGL2Backend extends GPUBackend {
    constructor(canvas) {
        super(canvas);
        this.gl = null;
        this.programs = new Map();

        // Buffers
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.texCoordBufferFBO = null;

        // Multi-pass FBOs
        this.blurFbo1 = null;
        this.blurFbo2 = null;
        this.baseFbo1 = null;
        this.baseFbo2 = null;
        this.clarityFbo1 = null;
        this.clarityFbo2 = null;

        // Base illumination caching
        this._cachedBaseInput = null;
        this._cachedBaseVersion = 0;
        this._cachedBaseWidth = 0;
        this._cachedBaseHeight = 0;
        this._cachedBaseValid = false;
        this._textureVersionCounter = 0;

        // 3D LUT resources
        this._lut3dTex = null;
        this._defaultLut3dTex = null;
        this._lastLut3dData = null;

        // Pre-allocated uniform caches for zero-allocation rendering
        this._wbMatrixCache = new Float32Array(9);
        this._lastWbTemp = null;
        this._lastWbTint = null;
        this._hslHueCache = new Float32Array(8);
        this._hslSatCache = new Float32Array(8);
        this._hslLumCache = new Float32Array(8);

        // 1D LUT caching
        this._curveLutTexRgb = null;
        this._curveLutTexRed = null;
        this._curveLutTexGreen = null;
        this._curveLutTexBlue = null;
        this._lastLutDataRgb = null;
        this._lastLutDataRed = null;
        this._lastLutDataGreen = null;
        this._lastLutDataBlue = null;

        // Ultra-fast histogram FBO & buffer
        this._histFbo = null;
        this._histPixelBuf = null;
        this._readPixelsBuffer = null;
        this._lastRenderFramebuffer = null;
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

        // Enable extensions and floating point buffer capabilities
        const extColorFloat = gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');
        this.supportsFloat = Boolean(extColorFloat);

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
            precision highp sampler2D;
            in vec2 v_texCoord;
            uniform sampler2D u_texture;
            uniform bool u_showClipping;
            uniform bool u_clipShadows;
            uniform bool u_clipHighlights;
            out vec4 fragColor;
            
            void main() {
                vec4 col = texture(u_texture, v_texCoord);
                if (u_showClipping) {
                    if (u_clipHighlights && (col.r >= 0.996 || col.g >= 0.996 || col.b >= 0.996)) {
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
            blur.u_radius = gl.getUniformLocation(blur, 'u_radius');
            blur.u_sigmaRange = gl.getUniformLocation(blur, 'u_sigmaRange');
            blur.u_isLinear = gl.getUniformLocation(blur, 'u_isLinear');
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
            dev.u_clarityTexture = gl.getUniformLocation(dev, 'u_clarityTexture');
            dev.u_isBaseLinear = gl.getUniformLocation(dev, 'u_isBaseLinear');
            dev.u_wbMatrix = gl.getUniformLocation(dev, 'u_wbMatrix');

            // Color grading uniforms
            dev.u_shadowsChromaDir = gl.getUniformLocation(dev, 'u_shadowsChromaDir');
            dev.u_midtonesChromaDir = gl.getUniformLocation(dev, 'u_midtonesChromaDir');
            dev.u_highlightsChromaDir = gl.getUniformLocation(dev, 'u_highlightsChromaDir');
            for (const n of [
                'u_shadowsColor', 'u_midtonesColor', 'u_highlightsColor',
                'u_shadowsLum', 'u_midtonesLum', 'u_highlightsLum',
                'u_colorBalance', 'u_colorBlending',
                'u_hasHSL', 'u_enableDither', 'u_hasBase',
                'u_showClipping', 'u_clipShadows', 'u_clipHighlights'
            ]) {
                dev[n] = gl.getUniformLocation(dev, n);
            }

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
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        const version = (this._textureVersionCounter = (this._textureVersionCounter || 0) + 1);
        return { width, height, _internal: texture, version };
    }

    /**
     * Create empty texture (supports RGBA16F float when requested and available)
     */
    createTexture(width, height, isFloat = false) {
        const gl = this.gl;
        const texture = gl.createTexture();
        if (!texture) return null;
        gl.bindTexture(gl.TEXTURE_2D, texture);

        if (isFloat && this.supportsFloat) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return { width, height, _internal: texture };
    }

    /**
     * Create framebuffer
     */
    createFramebuffer(width, height, isFloat = false) {
        const gl = this.gl;
        let texture = this.createTexture(width, height, isFloat);
        let fbo = gl.createFramebuffer();
        let actualFloat = isFloat;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture._internal, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE && isFloat) {
            console.warn('Float FBO unsupported on this hardware, falling back to RGBA8');
            this.deleteFramebuffer({ texture, _internal: fbo });
            texture = this.createTexture(width, height, false);
            fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture._internal, 0);
            actualFloat = false;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { texture, _internal: fbo, isFloat: actualFloat };
    }

    /**
     * Helper to manage multi-scale illumination FBOs (in RGBA16F for high dynamic range)
     */
    _ensureMultiScaleFbos(width, height) {
        const maxDim = Math.max(width, height);

        // Scale 1: Base illumination (Tone Base, ~3.0% of long edge)
        // Downsample so long edge is 256px
        const baseScale = Math.min(1.0, 256 / maxDim);
        const baseW = Math.max(32, Math.round(width * baseScale));
        const baseH = Math.max(32, Math.round(height * baseScale));

        if (!this.baseFbo1 || this.baseFbo1.texture.width !== baseW || this.baseFbo1.texture.height !== baseH) {
            this.deleteFramebuffer(this.baseFbo1);
            this.deleteFramebuffer(this.baseFbo2);
            this.baseFbo1 = this.createFramebuffer(baseW, baseH, true);
            this.baseFbo2 = this.createFramebuffer(baseW, baseH, true);
            this._cachedBaseValid = false;
        }

        // Scale 2: Mid-scale illumination (Clarity, ~0.86% of long edge)
        // Downsample so long edge is 1024px
        const clarityScale = Math.min(1.0, 1024 / maxDim);
        const clarityW = Math.max(64, Math.round(width * clarityScale));
        const clarityH = Math.max(64, Math.round(height * clarityScale));

        if (!this.clarityFbo1 || this.clarityFbo1.texture.width !== clarityW || this.clarityFbo1.texture.height !== clarityH) {
            this.deleteFramebuffer(this.clarityFbo1);
            this.deleteFramebuffer(this.clarityFbo2);
            this.clarityFbo1 = this.createFramebuffer(clarityW, clarityH, true);
            this.clarityFbo2 = this.createFramebuffer(clarityW, clarityH, true);
            this._cachedBaseValid = false;
        }
    }

    /**
     * Render a blur pass with resolution-relative radius and configurable sigma range
     */
    _renderBlurPass(inputTexture, outputFbo, direction, radius = 1.0, sigmaRange = 1.0, isLinear = false) {
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
        gl.uniform2f(program.u_resolution, outputFbo.texture.width, outputFbo.texture.height);
        gl.uniform1f(program.u_radius, radius);
        gl.uniform1f(program.u_sigmaRange, sigmaRange);
        gl.uniform1i(program.u_isLinear, isLinear ? 1 : 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rawTexture);
        gl.uniform1i(program.u_texture, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        // Disable alpha blending for intermediate FBO blur passes to prevent ghosting
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, outputFbo._internal);
        gl.viewport(0, 0, outputFbo.texture.width, outputFbo.texture.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.BLEND);
    }

    /**
     * Render develop
     */
    renderDevelop(inputTexture, uniforms, target = null, clippingOpts = null) {
        const gl = this.gl;

        const rawInput = (typeof WebGLTexture !== 'undefined' && inputTexture instanceof WebGLTexture)
            ? inputTexture
            : inputTexture?._internal;
        if (!rawInput || typeof WebGLTexture === 'undefined' || !(rawInput instanceof WebGLTexture)) return;
        try {
            if (!gl.isTexture(rawInput)) return;
        } catch {
            return;
        }

        // === MULTI-SCALE PRE-PROCESSING ===
        let baseTexture = inputTexture;
        let clarityTexture = inputTexture;

        // Trigger multi-scale passes when any local tone, detail, or dehaze control is active
        const needsBaseIllumination = Boolean(
            (uniforms.clarity && uniforms.clarity !== 0) ||
            (uniforms.structure && uniforms.structure !== 0) ||
            (uniforms.shadows && uniforms.shadows !== 0) ||
            (uniforms.highlights && uniforms.highlights !== 0) ||
            (uniforms.whites && uniforms.whites !== 0) ||
            (uniforms.blacks && uniforms.blacks !== 0) ||
            (uniforms.dehaze && uniforms.dehaze !== 0)
        );

        if (needsBaseIllumination) {
            this._ensureMultiScaleFbos(this.width, this.height);

            const inputVersion = inputTexture.version || 0;
            const isCacheValid = Boolean(
                this._cachedBaseValid &&
                this._cachedBaseInput === rawInput &&
                this._cachedBaseVersion === inputVersion &&
                this._cachedBaseWidth === this.width &&
                this._cachedBaseHeight === this.height
            );

            if (!isCacheValid) {
                // Generate mipmap on rawInput so downsampling uses pre-filtered mip levels (no aliasing/shimmer)
                gl.bindTexture(gl.TEXTURE_2D, rawInput);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

                // Pass 1 & 2: Base Illumination B (256px buffer, radius=3.5, sigmaRange=1.0 EV)
                // Pass 1: inputTexture (sRGB) -> baseFbo1 (Linear), isLinear = false
                this._renderBlurPass(inputTexture, this.baseFbo1, [1.0, 0.0], 3.5, 1.0, false);
                gl.bindTexture(gl.TEXTURE_2D, this.baseFbo1.texture._internal);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

                // Pass 2: baseFbo1 (Linear) -> baseFbo2 (Linear), isLinear = true
                this._renderBlurPass(this.baseFbo1.texture, this.baseFbo2, [0.0, 1.0], 3.5, 1.0, true);

                // Pass 3 & 4: Mid-scale Clarity Illumination M (1024px buffer, radius=4.0, sigmaRange=0.5 EV)
                // Pass 3: inputTexture (sRGB) -> clarityFbo1 (Linear), isLinear = false
                this._renderBlurPass(inputTexture, this.clarityFbo1, [1.0, 0.0], 4.0, 0.5, false);
                gl.bindTexture(gl.TEXTURE_2D, this.clarityFbo1.texture._internal);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

                // Pass 4: clarityFbo1 (Linear) -> clarityFbo2 (Linear), isLinear = true
                this._renderBlurPass(this.clarityFbo1.texture, this.clarityFbo2, [0.0, 1.0], 4.0, 0.5, true);

                // Keep mipmap min filter on source texture so textureLod can sample mips
                gl.bindTexture(gl.TEXTURE_2D, rawInput);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

                this._cachedBaseInput = rawInput;
                this._cachedBaseVersion = inputVersion;
                this._cachedBaseWidth = this.width;
                this._cachedBaseHeight = this.height;
                this._cachedBaseValid = true;
            }

            baseTexture = this.baseFbo2.texture;
            clarityTexture = this.clarityFbo2.texture;
        }

        // === FINAL PASS ===
        const program = this.programs.get('develop');
        if (!program) return;

        gl.useProgram(program);

        // Bind Base Illumination Texture to Unit 5
        const rawBlur = (typeof WebGLTexture !== 'undefined' && baseTexture instanceof WebGLTexture)
            ? baseTexture
            : baseTexture?._internal;
        if (rawBlur && typeof WebGLTexture !== 'undefined' && (rawBlur instanceof WebGLTexture)) {
            let isValid = false;
            try { isValid = gl.isTexture(rawBlur); } catch { isValid = false; }
            if (isValid) {
                gl.activeTexture(gl.TEXTURE5);
                gl.bindTexture(gl.TEXTURE_2D, rawBlur);
                gl.uniform1i(program.u_blurTexture, 5);
            }
        }

        // Bind Mid-scale Clarity Texture to Unit 7
        const rawClarity = (typeof WebGLTexture !== 'undefined' && clarityTexture instanceof WebGLTexture)
            ? clarityTexture
            : clarityTexture?._internal;
        if (rawClarity && typeof WebGLTexture !== 'undefined' && (rawClarity instanceof WebGLTexture)) {
            let isValid = false;
            try { isValid = gl.isTexture(rawClarity); } catch { isValid = false; }
            if (isValid) {
                gl.activeTexture(gl.TEXTURE7);
                gl.bindTexture(gl.TEXTURE_2D, rawClarity);
                gl.uniform1i(program.u_clarityTexture, 7);
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
        gl.uniform1i(program.u_isBaseLinear, needsBaseIllumination ? 1 : 0);
        gl.uniform1i(program.u_hasBase, needsBaseIllumination ? 1 : 0);

        const temp = (uniforms.temperature || 0) / 100;
        const tint = (uniforms.tint || 0) / 100;
        if (temp !== this._lastWbTemp || tint !== this._lastWbTint) {
            computeWhitebalanceMatrix(temp, tint, this._wbMatrixCache);
            this._lastWbTemp = temp;
            this._lastWbTint = tint;
        }
        gl.uniformMatrix3fv(program.u_wbMatrix, false, this._wbMatrixCache);

        gl.uniform1f(program.u_vibrance, (uniforms.vibrance || 0) / 100);
        gl.uniform1f(program.u_saturation, (uniforms.saturation || 0) / 100);
        gl.uniform1f(program.u_clarity, (uniforms.clarity || 0) / 100);
        gl.uniform1f(program.u_structure, (uniforms.structure || 0) / 100);
        gl.uniform1f(program.u_dehaze, (uniforms.dehaze || 0) / 100);


        // Color Grading Uniforms
        gl.uniform2f(program.u_shadowsColor, uniforms.shadowsHue || 0, uniforms.shadowsSat || 0);
        gl.uniform2f(program.u_midtonesColor, uniforms.midtonesHue || 0, uniforms.midtonesSat || 0);
        gl.uniform2f(program.u_highlightsColor, uniforms.highlightsHue || 0, uniforms.highlightsSat || 0);

        const shadowsDir = hslHueToOKLabChromaDir((uniforms.shadowsHue || 0) * 360);
        const midtonesDir = hslHueToOKLabChromaDir((uniforms.midtonesHue || 0) * 360);
        const highlightsDir = hslHueToOKLabChromaDir((uniforms.highlightsHue || 0) * 360);
        gl.uniform2f(program.u_shadowsChromaDir, shadowsDir[0], shadowsDir[1]);
        gl.uniform2f(program.u_midtonesChromaDir, midtonesDir[0], midtonesDir[1]);
        gl.uniform2f(program.u_highlightsChromaDir, highlightsDir[0], highlightsDir[1]);

        gl.uniform1f(program.u_shadowsLum, uniforms.shadowsLum || 0);
        gl.uniform1f(program.u_midtonesLum, uniforms.midtonesLum || 0);
        gl.uniform1f(program.u_highlightsLum, uniforms.highlightsLum || 0);

        gl.uniform1f(program.u_colorBalance, (uniforms.colorBalance || 0));
        gl.uniform1f(program.u_colorBlending, (uniforms.colorBlending !== undefined ? uniforms.colorBlending : 50)); // Default blending 50

        // HSL per-channel uniforms (reusing pre-allocated Float32Array caches to avoid GC pressure)
        // Order: Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta
        const hHue = this._hslHueCache;
        hHue[0] = uniforms.hslHueRed || 0;
        hHue[1] = uniforms.hslHueOrange || 0;
        hHue[2] = uniforms.hslHueYellow || 0;
        hHue[3] = uniforms.hslHueGreen || 0;
        hHue[4] = uniforms.hslHueAqua || 0;
        hHue[5] = uniforms.hslHueBlue || 0;
        hHue[6] = uniforms.hslHuePurple || 0;
        hHue[7] = uniforms.hslHueMagenta || 0;

        const hSat = this._hslSatCache;
        hSat[0] = uniforms.hslSatRed || 0;
        hSat[1] = uniforms.hslSatOrange || 0;
        hSat[2] = uniforms.hslSatYellow || 0;
        hSat[3] = uniforms.hslSatGreen || 0;
        hSat[4] = uniforms.hslSatAqua || 0;
        hSat[5] = uniforms.hslSatBlue || 0;
        hSat[6] = uniforms.hslSatPurple || 0;
        hSat[7] = uniforms.hslSatMagenta || 0;

        const hLum = this._hslLumCache;
        hLum[0] = uniforms.hslLumRed || 0;
        hLum[1] = uniforms.hslLumOrange || 0;
        hLum[2] = uniforms.hslLumYellow || 0;
        hLum[3] = uniforms.hslLumGreen || 0;
        hLum[4] = uniforms.hslLumAqua || 0;
        hLum[5] = uniforms.hslLumBlue || 0;
        hLum[6] = uniforms.hslLumPurple || 0;
        hLum[7] = uniforms.hslLumMagenta || 0;

        gl.uniform1fv(program.u_hslHue, hHue);
        gl.uniform1fv(program.u_hslSat, hSat);
        gl.uniform1fv(program.u_hslLum, hLum);

        let hasHSL = false;
        for (let i = 0; i < 8; i++) {
            if (hHue[i] !== 0 || hSat[i] !== 0 || hLum[i] !== 0) {
                hasHSL = true;
                break;
            }
        }
        gl.uniform1i(program.u_hasHSL, hasHSL ? 1 : 0);

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
            gl.uniform1i(program.u_showClipping, 1);
            gl.uniform1i(program.u_clipShadows, clippingOpts.shadows ? 1 : 0);
            gl.uniform1i(program.u_clipHighlights, clippingOpts.highlights ? 1 : 0);
        } else {
            gl.uniform1i(program.u_showClipping, 0);
        }

        // Create/update LUT textures only when curve data actually changes
        if (hasRgbCurve) {
            if (this._lastLutDataRgb !== uniforms.curveLutRgb) {
                this._curveLutTexRgb = this._updateLutTexture(this._curveLutTexRgb, uniforms.curveLutRgb);
                this._lastLutDataRgb = uniforms.curveLutRgb;
            }
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this._curveLutTexRgb);
            gl.uniform1i(program.u_curveLutTexRgb, 1);
        }
        if (hasRedCurve) {
            if (this._lastLutDataRed !== uniforms.curveLutRed) {
                this._curveLutTexRed = this._updateLutTexture(this._curveLutTexRed, uniforms.curveLutRed);
                this._lastLutDataRed = uniforms.curveLutRed;
            }
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this._curveLutTexRed);
            gl.uniform1i(program.u_curveLutTexRed, 2);
        }
        if (hasGreenCurve) {
            if (this._lastLutDataGreen !== uniforms.curveLutGreen) {
                this._curveLutTexGreen = this._updateLutTexture(this._curveLutTexGreen, uniforms.curveLutGreen);
                this._lastLutDataGreen = uniforms.curveLutGreen;
            }
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, this._curveLutTexGreen);
            gl.uniform1i(program.u_curveLutTexGreen, 3);
        }
        if (hasBlueCurve) {
            if (this._lastLutDataBlue !== uniforms.curveLutBlue) {
                this._curveLutTexBlue = this._updateLutTexture(this._curveLutTexBlue, uniforms.curveLutBlue);
                this._lastLutDataBlue = uniforms.curveLutBlue;
            }
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

        // Gate dithering: Only enabled when adjustments are active on final canvas/display target
        const hasAnyAdjustment = Boolean(
            (uniforms.exposure && uniforms.exposure !== 0) ||
            (uniforms.contrast && uniforms.contrast !== 0) ||
            (uniforms.highlights && uniforms.highlights !== 0) ||
            (uniforms.shadows && uniforms.shadows !== 0) ||
            (uniforms.whites && uniforms.whites !== 0) ||
            (uniforms.blacks && uniforms.blacks !== 0) ||
            (uniforms.temperature && uniforms.temperature !== 0) ||
            (uniforms.tint && uniforms.tint !== 0) ||
            (uniforms.vibrance && uniforms.vibrance !== 0) ||
            (uniforms.saturation && uniforms.saturation !== 0) ||
            (uniforms.clarity && uniforms.clarity !== 0) ||
            (uniforms.structure && uniforms.structure !== 0) ||
            (uniforms.dehaze && uniforms.dehaze !== 0) ||
            (uniforms.shadowsSat && uniforms.shadowsSat !== 0) ||
            (uniforms.midtonesSat && uniforms.midtonesSat !== 0) ||
            (uniforms.highlightsSat && uniforms.highlightsSat !== 0) ||
            (uniforms.shadowsLum && uniforms.shadowsLum !== 0) ||
            (uniforms.midtonesLum && uniforms.midtonesLum !== 0) ||
            (uniforms.highlightsLum && uniforms.highlightsLum !== 0) ||
            (uniforms.colorBalance && uniforms.colorBalance !== 0) ||
            (uniforms.colorBlending !== undefined && uniforms.colorBlending !== 50) ||
            hasHSL ||
            hasAnyCurve ||
            hasLut3d
        );
        gl.uniform1i(program.u_enableDither, (hasAnyAdjustment && !target) ? 1 : 0);

        // Bind main texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rawInput);
        gl.uniform1i(program.u_texture, 0);

        // Vertex attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        // Render (disable alpha blending during develop pass to avoid ghosting or double-composite)
        gl.disable(gl.BLEND);
        this._lastRenderFramebuffer = target?._internal || null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._lastRenderFramebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.BLEND);
    }

    /**
     * Invalidate cached base/clarity multi-scale textures
     */
    invalidateCache() {
        this._cachedBaseValid = false;
        this._cachedBaseInput = null;
        this._cachedBaseVersion = 0;
        this._lastLutDataRgb = null;
        this._lastLutDataRed = null;
        this._lastLutDataGreen = null;
        this._lastLutDataBlue = null;
        this._lastWbTemp = null;
        this._lastWbTint = null;
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
            gl.uniform1i(program.u_showClipping, 1);
            gl.uniform1i(program.u_clipShadows, clippingOpts.shadows ? 1 : 0);
            gl.uniform1i(program.u_clipHighlights, clippingOpts.highlights ? 1 : 0);
        } else {
            gl.uniform1i(program.u_showClipping, 0);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, useFBOCoords ? this.texCoordBufferFBO : this.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target?._internal || null);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.BLEND);
    }

    /**
     * Get downsampled histogram pixel data for ultra-fast (sub-millisecond) histogram calculation
     * @param {number} maxDimension - Target long-edge dimension (default 256px)
     * @returns {{ data: Uint8Array, count: number, width: number, height: number }|null}
     */
    getHistogramData(maxDimension = 256) {
        const gl = this.gl;
        if (!gl || !this.width || !this.height) return null;

        const maxDim = Math.max(this.width, this.height);
        const scale = Math.min(1.0, maxDimension / maxDim);
        const histW = Math.max(32, Math.round(this.width * scale));
        const histH = Math.max(32, Math.round(this.height * scale));

        // Manage small histogram FBO
        if (!this._histFbo || this._histFbo.texture.width !== histW || this._histFbo.texture.height !== histH) {
            if (this._histFbo) this.deleteFramebuffer(this._histFbo);
            this._histFbo = this.createFramebuffer(histW, histH, false);
            this._histPixelBuf = new Uint8Array(histW * histH * 4);
        }

        try {
            const srcFb = this._lastRenderFramebuffer || null;
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFb);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._histFbo._internal);
            gl.blitFramebuffer(
                0, 0, this.width, this.height,
                0, 0, histW, histH,
                gl.COLOR_BUFFER_BIT, gl.LINEAR
            );

            // Read the tiny buffer into the pre-allocated reusable buffer
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._histFbo._internal);
            gl.readPixels(0, 0, histW, histH, gl.RGBA, gl.UNSIGNED_BYTE, this._histPixelBuf);
            gl.bindFramebuffer(gl.FRAMEBUFFER, srcFb);

            return { data: this._histPixelBuf, count: histW * histH, width: histW, height: histH };
        } catch {
            return null;
        }
    }

    /**
     * Read pixels (with optional pre-allocated buffer reuse)
     */
    readPixels(targetBuffer = null) {
        const gl = this.gl;
        const totalBytes = this.width * this.height * 4;
        if (!targetBuffer) {
            if (!this._readPixelsBuffer || this._readPixelsBuffer.length !== totalBytes) {
                this._readPixelsBuffer = new Uint8Array(totalBytes);
            }
        }
        const pixels = targetBuffer || this._readPixelsBuffer;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
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
     * Set canvas and viewport dimensions
     */
    setSize(width, height) {
        if (this.width !== width || this.height !== height) {
            this.invalidateCache();
            if (this._histFbo) {
                this.deleteFramebuffer(this._histFbo);
                this._histFbo = null;
            }
            this._histPixelBuf = null;
            this._readPixelsBuffer = null;
        }
        super.setSize(width, height);
    }

    /**
     * Delete texture
     */
    deleteTexture(texture) {
        if (texture?._internal) {
            if (this._cachedBaseInput === texture._internal) {
                this.invalidateCache();
            }
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
            this.deleteFramebuffer(this.blurFbo1);
            this.deleteFramebuffer(this.blurFbo2);
            this.deleteFramebuffer(this.baseFbo1);
            this.deleteFramebuffer(this.baseFbo2);
            this.deleteFramebuffer(this.clarityFbo1);
            this.deleteFramebuffer(this.clarityFbo2);
            this.blurFbo1 = null;
            this.blurFbo2 = null;
            this.baseFbo1 = null;
            this.baseFbo2 = null;
            this.clarityFbo1 = null;
            this.clarityFbo2 = null;
            this._cachedBaseInput = null;
            this._cachedBaseValid = false;
        }
        this.programs.clear();
        this.isReady = false;
    }
}
