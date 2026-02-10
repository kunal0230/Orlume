/**
 * WebGL2DeferredRenderer.js - v8 PRO Relighting
 * 
 * GPU-accelerated deferred rendering using WebGL2.
 * Implements PBR lighting with Lambertian diffuse and specular.
 * 
 * Fallback renderer for browsers without WebGPU support.
 */

import { RenderingEngine } from './RenderingEngine.js';

export class WebGL2DeferredRenderer extends RenderingEngine {
    constructor() {
        super();

        this.backend = 'webgl2';
        this.canvas = null;
        this.gl = null;
        this.programs = {};
        this.textures = {};
        this.framebuffers = {};
        this.isInitialized = false;

        // Uniforms cache
        this.uniforms = {};

        // Full-screen quad for deferred passes
        this.quadVAO = null;
    }

    /**
     * Check if WebGL2 is supported
     */
    static isSupported() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2');
            return gl !== null;
        } catch {
            return false;
        }
    }

    /**
     * Get renderer capabilities
     */
    getCapabilities() {
        const gl = this.gl;
        if (!gl) {
            return {
                backend: 'webgl2',
                maxTextureSize: 0,
                supportsFloat: false,
                supportsCompute: false,
                supportsPCSS: false
            };
        }

        return {
            backend: 'webgl2',
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            supportsFloat: !!gl.getExtension('EXT_color_buffer_float'),
            supportsCompute: false, // WebGL2 doesn't have compute shaders
            supportsPCSS: false,     // Limited shadow quality
            renderer: gl.getParameter(gl.RENDERER),
            vendor: gl.getParameter(gl.VENDOR)
        };
    }

    /**
     * Initialize WebGL2 context
     */
    async init(canvas = null) {
        if (this.isInitialized) return true;

        // Create offscreen canvas if none provided
        if (!canvas) {
            this.canvas = new OffscreenCanvas(1, 1);
        } else {
            this.canvas = canvas;
        }

        // Get WebGL2 context
        this.gl = this.canvas.getContext('webgl2', {
            alpha: true,
            antialias: false, // We do our own AA
            depth: true,
            failIfMajorPerformanceCaveat: false,
            powerPreference: 'high-performance',
            premultipliedAlpha: true,
            preserveDrawingBuffer: true,
            stencil: false
        });

        if (!this.gl) {
            console.error('WebGL2 not supported');
            return false;
        }

        const gl = this.gl;

        // Enable required extensions
        const ext = gl.getExtension('EXT_color_buffer_float');
        if (!ext) {
            console.warn('EXT_color_buffer_float not supported, using fallback');
        }

        // Create shader programs
        this._createPrograms();

        // Create fullscreen quad
        this._createFullscreenQuad();

        this.isInitialized = true;
        console.log('✓ WebGL2 Deferred Renderer initialized');

        return true;
    }

    /**
     * Create all shader programs
     */
    _createPrograms() {
        // Deferred lighting program (PBR)
        this.programs.lighting = this._createProgram(
            VERTEX_SHADER_FULLSCREEN,
            FRAGMENT_SHADER_DEFERRED_LIGHTING
        );

        // Simple output program
        this.programs.output = this._createProgram(
            VERTEX_SHADER_FULLSCREEN,
            FRAGMENT_SHADER_OUTPUT
        );
    }

    /**
     * Create shader program from source
     */
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

        // Cache uniform locations
        const uniforms = {};
        const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const info = gl.getActiveUniform(program, i);
            uniforms[info.name] = gl.getUniformLocation(program, info.name);
        }

        return { program, uniforms };
    }

    /**
     * Compile shader
     */
    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            console.error('Source:', source);
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    /**
     * Create fullscreen quad for deferred passes
     */
    _createFullscreenQuad() {
        const gl = this.gl;

        const positions = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        const texCoords = new Float32Array([
            0, 1,  // bottom-left corner samples from top of image
            1, 1,  // bottom-right corner samples from top of image
            0, 0,  // top-left corner samples from bottom of image
            1, 0   // top-right corner samples from bottom of image
        ]);

        this.quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.quadVAO);

        // Position buffer
        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // TexCoord buffer
        const texBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }

    /**
     * Create texture from image data or array
     */
    createTexture(data, width, height, options = {}) {
        const gl = this.gl;

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Determine format
        const isFloat = options.float || false;
        const channels = options.channels || 4;

        let internalFormat, format, type;

        if (isFloat) {
            internalFormat = channels === 1 ? gl.R32F :
                channels === 3 ? gl.RGB32F : gl.RGBA32F;
            format = channels === 1 ? gl.RED :
                channels === 3 ? gl.RGB : gl.RGBA;
            type = gl.FLOAT;
        } else {
            internalFormat = channels === 1 ? gl.R8 :
                channels === 3 ? gl.RGB8 : gl.RGBA8;
            format = channels === 1 ? gl.RED :
                channels === 3 ? gl.RGB : gl.RGBA;
            type = gl.UNSIGNED_BYTE;
        }

        // Upload data
        if (data instanceof ImageData) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, data);
        } else if (data instanceof HTMLImageElement || data instanceof HTMLCanvasElement) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, data);
        } else if (data) {
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
        }

        // Set filtering
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_2D, null);

        return texture;
    }

    /**
     * Render with deferred lighting
     * @param {Object} gBuffer - Contains albedo, normals, depth
     * @param {Object} light - Light parameters
     * @returns {HTMLCanvasElement}
     */
    render(gBuffer, light) {
        if (!this.isInitialized) {
            console.error('Renderer not initialized');
            return null;
        }

        const { width, height, albedo, normals, depth, sceneMap } = gBuffer;
        const gl = this.gl;

        // Resize canvas if needed
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        gl.viewport(0, 0, width, height);

        // Create/update textures
        const albedoTex = this.createTexture(albedo, width, height);
        const normalTex = this._createNormalsTexture(normals, width, height);
        const depthTex = this._createDepthTexture(depth, width, height);

        // Clear
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Render deferred lighting pass
        const prog = this.programs.lighting;
        gl.useProgram(prog.program);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, albedoTex);
        gl.uniform1i(prog.uniforms.u_albedo, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, normalTex);
        gl.uniform1i(prog.uniforms.u_normals, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, depthTex);
        gl.uniform1i(prog.uniforms.u_depth, 2);

        // Scene map texture
        const sceneMapTex = this.createTexture(sceneMap, width, height);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, sceneMapTex);
        gl.uniform1i(prog.uniforms.u_sceneMap, 3);

        // Set light uniforms
        gl.uniform3f(prog.uniforms.u_lightDir,
            light.direction.x,
            light.direction.y,
            light.direction.z
        );
        gl.uniform3f(prog.uniforms.u_lightColor,
            light.color.r,
            light.color.g,
            light.color.b
        );
        gl.uniform1f(prog.uniforms.u_lightIntensity, light.intensity);
        gl.uniform1f(prog.uniforms.u_ambient, light.ambient);

        // Set shadow uniforms
        gl.uniform1f(prog.uniforms.u_shadowIntensity, light.shadowIntensity || 0.6);
        gl.uniform1f(prog.uniforms.u_shadowSoftness, light.shadowSoftness || 0.5);
        gl.uniform2f(prog.uniforms.u_resolution, width, height);

        // Set roughness
        gl.uniform1f(prog.uniforms.u_roughness, light.roughness || 0.5);

        // Compute and set SH coefficients
        const dir = light.direction;
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        const nx = dir.x / len, ny = dir.y / len, nz = dir.z / len;
        const newSH = this._computeSHCoefficients(nx, ny, nz, light.intensity * 2.0);

        const origLightX = light.originalLightDir?.x || 0.3;
        const origLightY = light.originalLightDir?.y || -0.5;
        const origLen = Math.sqrt(origLightX * origLightX + origLightY * origLightY + 0.36);
        const ox = origLightX / origLen, oy = origLightY / origLen, oz = 0.6 / origLen;
        const origSH = this._computeSHCoefficients(ox, oy, oz, 1.0);

        // Pass SH arrays — WebGL2 uses u_sh[0] naming for array elements
        const shLoc = gl.getUniformLocation(prog.program, 'u_sh');
        if (shLoc) gl.uniform1fv(shLoc, new Float32Array(newSH));

        const origShLoc = gl.getUniformLocation(prog.program, 'u_origSh');
        if (origShLoc) gl.uniform1fv(origShLoc, new Float32Array(origSH.slice(0, 7)));

        // Draw fullscreen quad
        gl.bindVertexArray(this.quadVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);

        // Cleanup textures
        gl.deleteTexture(albedoTex);
        gl.deleteTexture(normalTex);
        gl.deleteTexture(depthTex);
        gl.deleteTexture(sceneMapTex);

        // Return result as canvas
        return this.canvas;
    }

    /**
     * Compute SH coefficients from a direction (shared with WebGPU renderer)
     */
    _computeSHCoefficients(dirX, dirY, dirZ, intensity) {
        const x = dirX, y = dirY, z = dirZ;
        return [
            0.282095 * intensity,
            0.488603 * y * intensity,
            0.488603 * z * intensity,
            0.488603 * x * intensity,
            1.092548 * x * y * intensity,
            1.092548 * y * z * intensity,
            0.315392 * (3 * z * z - 1) * intensity,
            1.092548 * x * z * intensity,
            0.546274 * (x * x - y * y) * intensity,
        ];
    }

    /**
     * Create normals texture from Float32Array
     */
    _createNormalsTexture(normals, width, height) {
        const gl = this.gl;

        // Pack normals into RGB texture
        const packedData = new Uint8Array(width * height * 4);

        for (let i = 0; i < width * height; i++) {
            // Normals are in [-1, 1] range, map to [0, 255]
            const nx = normals.data[i * 3] * 0.5 + 0.5;
            const ny = normals.data[i * 3 + 1] * 0.5 + 0.5;
            const nz = normals.data[i * 3 + 2] * 0.5 + 0.5;

            packedData[i * 4] = Math.floor(nx * 255);
            packedData[i * 4 + 1] = Math.floor(ny * 255);
            packedData[i * 4 + 2] = Math.floor(nz * 255);
            packedData[i * 4 + 3] = 255;
        }

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, packedData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        return texture;
    }

    /**
     * Create depth texture from depth data
     */
    _createDepthTexture(depth, width, height) {
        const gl = this.gl;

        // Pack depth into R channel
        const packedData = new Uint8Array(width * height * 4);

        // Find depth range
        let minD = Infinity, maxD = -Infinity;
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

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, packedData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        return texture;
    }

    /**
     * Read pixels from current framebuffer
     */
    readPixels() {
        const gl = this.gl;
        const { width, height } = this.canvas;

        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Flip Y
        const flipped = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            for (let x = 0; x < width * 4; x++) {
                flipped[dstRow + x] = pixels[srcRow + x];
            }
        }

        return new ImageData(new Uint8ClampedArray(flipped.buffer), width, height);
    }

    /**
     * Dispose resources
     */
    dispose() {
        const gl = this.gl;
        if (!gl) return;

        // Delete programs
        Object.values(this.programs).forEach(prog => {
            if (prog?.program) gl.deleteProgram(prog.program);
        });

        // Delete textures
        Object.values(this.textures).forEach(tex => {
            if (tex) gl.deleteTexture(tex);
        });

        // Delete framebuffers
        Object.values(this.framebuffers).forEach(fb => {
            if (fb) gl.deleteFramebuffer(fb);
        });

        this.programs = {};
        this.textures = {};
        this.framebuffers = {};
        this.isInitialized = false;
    }
}

// === GLSL Shaders ===

const VERTEX_SHADER_FULLSCREEN = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

const FRAGMENT_SHADER_DEFERRED_LIGHTING = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_albedo;
uniform sampler2D u_normals;
uniform sampler2D u_depth;
uniform sampler2D u_sceneMap;

uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform float u_ambient;
uniform float u_shadowIntensity;
uniform float u_shadowSoftness;
uniform vec2 u_resolution;

// SH coefficients
uniform float u_sh[9];
uniform float u_origSh[7];
uniform float u_roughness;

const float PI = 3.14159265359;

// sRGB conversions
vec3 sRGBToLinear(vec3 srgb) {
    vec3 low = srgb / 12.92;
    vec3 high = pow((srgb + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(0.04045, srgb));
}
vec3 linearToSRGB(vec3 linear) {
    vec3 low = linear * 12.92;
    vec3 high = 1.055 * pow(max(linear, vec3(0.0)), vec3(1.0/2.4)) - 0.055;
    return mix(low, high, step(0.0031308, linear));
}

// OKLAB conversions
vec3 linearToOKLAB(vec3 rgb) {
    float l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    float m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    float s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
    float l_ = pow(max(l, 0.0), 1.0/3.0);
    float m_ = pow(max(m, 0.0), 1.0/3.0);
    float s_ = pow(max(s, 0.0), 1.0/3.0);
    return vec3(
        0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
        1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
        0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
    );
}
vec3 OKLABToLinear(vec3 lab) {
    float l_ = lab.x + 0.3963377774*lab.y + 0.2158037573*lab.z;
    float m_ = lab.x - 0.1055613458*lab.y - 0.0638541728*lab.z;
    float s_ = lab.x - 0.0894841775*lab.y - 1.2914855480*lab.z;
    return vec3(
         4.0767416621*l_*l_*l_ - 3.3077115913*m_*m_*m_ + 0.2309699292*s_*s_*s_,
        -1.2684380046*l_*l_*l_ + 2.6097574011*m_*m_*m_ - 0.3413193965*s_*s_*s_,
        -0.0041960863*l_*l_*l_ - 0.7034186147*m_*m_*m_ + 1.7076147010*s_*s_*s_
    );
}

// Spherical Harmonics evaluation (order 2, 9 coefficients)
float evaluateSH9(vec3 n) {
    return max(
        u_sh[0] * 0.282095 +
        u_sh[1] * 0.488603 * n.y +
        u_sh[2] * 0.488603 * n.z +
        u_sh[3] * 0.488603 * n.x +
        u_sh[4] * 1.092548 * n.x * n.y +
        u_sh[5] * 1.092548 * n.y * n.z +
        u_sh[6] * 0.315392 * (3.0 * n.z * n.z - 1.0) +
        u_sh[7] * 1.092548 * n.x * n.z +
        u_sh[8] * 0.546274 * (n.x * n.x - n.y * n.y),
        0.0
    );
}

// Original SH evaluation (7 coefficients)
float evaluateOrigSH(vec3 n) {
    return max(
        u_origSh[0] * 0.282095 +
        u_origSh[1] * 0.488603 * n.y +
        u_origSh[2] * 0.488603 * n.z +
        u_origSh[3] * 0.488603 * n.x +
        u_origSh[4] * 1.092548 * n.x * n.y +
        u_origSh[5] * 1.092548 * n.y * n.z +
        u_origSh[6] * 0.315392 * (3.0 * n.z * n.z - 1.0),
        0.05
    );
}

// GGX Normal Distribution
float distributionGGX(float NdotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d + 0.0001);
}

// Smith-GGX Geometry
float geometrySmith(float NdotV, float NdotL, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    float gv = NdotV / (NdotV * (1.0 - k) + k + 0.0001);
    float gl = NdotL / (NdotL * (1.0 - k) + k + 0.0001);
    return gv * gl;
}

// Schlick Fresnel
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    float t = clamp(1.0 - cosTheta, 0.0, 1.0);
    float t2 = t * t;
    return F0 + (1.0 - F0) * (t2 * t2 * t);
}

// SSS Approximation
float computeSSS(vec3 normal, vec3 lightDir, vec3 viewDir, float depth) {
    float wrapNdotL = (dot(normal, lightDir) + 0.5) / 1.5;
    float scatter = max(wrapNdotL, 0.0);
    float backScatter = max(dot(-normal, lightDir), 0.0) * 0.3;
    return (scatter * 0.4 + backScatter) * 0.5;
}

// Hair Specular (Anisotropic)
float computeHairSpecular(vec3 normal, vec3 lightDir, vec3 viewDir) {
    vec3 H = normalize(lightDir + viewDir);
    float NdotH = max(dot(normal, H), 0.0);
    float spec1 = pow(NdotH, 80.0) * 0.4;
    float spec2 = pow(NdotH, 20.0) * 0.15;
    return spec1 + spec2;
}

// SSAO with curvature awareness
float computeSSAO(vec2 uv, float centerDepth, float curvature) {
    float occlusion = 0.0;
    float curvFactor = mix(1.5, 0.5, curvature);
    float radius = (u_shadowSoftness * 0.025 + 0.005) * curvFactor;
    for (int i = 0; i < 8; i++) {
        float angle = float(i) * 0.785398 + uv.x * 12.9898 + uv.y * 78.233;
        vec2 offset = vec2(cos(angle), sin(angle)) * radius * (1.0 + float(i) * 0.15);
        float sd = texture(u_depth, uv + offset).r;
        float dd = centerDepth - sd;
        float rc = smoothstep(0.0, 0.08, abs(dd)) * (1.0 - smoothstep(0.08, 0.25, abs(dd)));
        occlusion += step(0.003, dd) * rc;
    }
    return 1.0 - occlusion / 8.0;
}

// Contact Shadows with depth awareness
float computeShadow(vec2 uv, float centerDepth, vec3 lightDir, float depthLayer) {
    float shadow = 0.0;
    vec2 lightDirSS = normalize(lightDir.xy) * (u_shadowSoftness * 0.04 + 0.012);
    float heightStep = lightDir.z * 0.02;
    float totalWeight = 0.0;
    
    float reachScale = mix(0.5, 1.8, depthLayer);

    for (int i = 1; i <= 16; i++) {
        float t = float(i) / 16.0;
        float ps = reachScale; // Vary step size by depth layer
        vec2 suv = uv + lightDirSS * t * ps;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
        float sd = texture(u_depth, suv).r;
        float ed = centerDepth + heightStep * t;
        float hd = sd - ed;
        float pen = 1.0 + t * 3.0;
        float w = (1.0 - t) * (1.0 - t);
        if (hd > 0.005 && hd < 0.35) shadow += w * smoothstep(0.005, 0.02 * pen, hd);
        totalWeight += w;
    }
    if (totalWeight > 0.0) shadow /= totalWeight;
    return 1.0 - clamp(shadow * u_shadowIntensity * 2.5, 0.0, 1.0);
}

void main() {
    vec3 originalColor = texture(u_albedo, v_texCoord).rgb;
    float depth = texture(u_depth, v_texCoord).r;
    vec3 normal = normalize(texture(u_normals, v_texCoord).rgb * 2.0 - 1.0);
    vec4 scene = texture(u_sceneMap, v_texCoord);
    
    // Decode scene map
    float materialType = scene.r;
    float roughness = scene.g;
    float curvature = scene.b;
    float depthLayer = scene.a;

    vec3 linearOriginal = sRGBToLinear(originalColor);
    vec3 lightDir = normalize(u_lightDir);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(lightDir + viewDir);

    float NdotL = max(dot(normal, lightDir), 0.0);
    float NdotV = max(dot(normal, viewDir), 0.001);
    float NdotH = max(dot(normal, H), 0.0);
    float HdotV = max(dot(H, viewDir), 0.0);

    // Ratio Image Relighting
    float newSH = evaluateSH9(normal);
    float origSH = evaluateOrigSH(normal);
    float shadingRatio = newSH / max(origSH, 0.08);
    float smoothRatio = mix(1.0, shadingRatio, u_lightIntensity);

    // Material Classification
    float isSkin = smoothstep(0.15, 0.25, materialType) * (1.0 - smoothstep(0.25, 0.35, materialType));
    float isHair = smoothstep(0.4, 0.5, materialType) * (1.0 - smoothstep(0.5, 0.6, materialType));
    float isFabric = smoothstep(0.65, 0.75, materialType) * (1.0 - smoothstep(0.75, 0.85, materialType));
    float isMetal = smoothstep(0.9, 1.0, materialType);
    float isBg = 1.0 - smoothstep(0.0, 0.1, materialType);

    // F0 and Specular Scale
    vec3 F0 = vec3(0.04);
    F0 = mix(F0, vec3(0.028), isSkin);
    F0 = mix(F0, vec3(0.046), isHair);
    F0 = mix(F0, vec3(0.04), isFabric);
    F0 = mix(F0, linearOriginal * 0.8, isMetal);

    float specScale = 0.5;
    specScale = mix(specScale, 0.25, isSkin);
    specScale = mix(specScale, 0.6, isHair);
    specScale = mix(specScale, 0.15, isFabric);
    specScale = mix(specScale, 1.2, isMetal);
    specScale = mix(specScale, 0.0, isBg);

    // Specular Calculation
    float D = distributionGGX(NdotH, roughness);
    float G = geometrySmith(NdotV, NdotL, roughness);
    vec3 F = fresnelSchlick(HdotV, F0);
    vec3 spec = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);
    vec3 specContrib = spec * NdotL * u_lightIntensity * u_lightColor * specScale;

    // Hair Anisotropic Specular
    float hairSpec = computeHairSpecular(normal, lightDir, viewDir);
    specContrib = mix(specContrib, vec3(hairSpec) * u_lightColor * u_lightIntensity, isHair);

    // SSS
    float sss = computeSSS(normal, lightDir, viewDir, depth);
    vec3 sssColor = vec3(1.0, 0.4, 0.25) * sss * u_lightIntensity * isSkin;

    // Curvature & Depth Modulation
    float curvatureBoost = mix(0.85, 1.15, curvature);
    float depthAttenuation = mix(0.7, 1.0, depthLayer);

    // Rim Light
    float fresnelVal = pow(1.0 - NdotV, 4.0);
    float rimStrength = 0.12;
    rimStrength = mix(rimStrength, 0.18, isSkin);
    rimStrength = mix(rimStrength, 0.08, isHair);
    rimStrength = mix(rimStrength, 0.05, isFabric);
    rimStrength = mix(rimStrength, 0.35, isMetal);
    rimStrength = mix(rimStrength, 0.0, isBg);
    float rimLight = fresnelVal * u_lightIntensity * rimStrength * max(dot(normal, lightDir) + 0.3, 0.0);

    // Shadows
    float ao = computeSSAO(v_texCoord, depth, curvature);
    float shadow = computeShadow(v_texCoord, depth, lightDir, depthLayer);
    float combinedShadow = min(ao, shadow);
    combinedShadow *= mix(0.75, 1.0, curvature);

    // Multi Scattering Compensation
    vec3 msComp = vec3(1.0) + F0 * (roughness * roughness) * 0.5;
    specContrib *= msComp;

    // Composition
    vec3 result = linearOriginal * smoothRatio;
    result *= curvatureBoost;
    result *= depthAttenuation;
    result *= mix(1.0, combinedShadow, 0.7);
    result *= mix(vec3(1.0), u_lightColor, 0.6);
    result += specContrib * combinedShadow;
    result += vec3(rimLight) * u_lightColor * combinedShadow;
    result += sssColor * combinedShadow;
    result = mix(result, linearOriginal * mix(0.95, 1.05, smoothRatio * 0.1), isBg);

    // OKLAB Tone Mapping
    vec3 origLAB = linearToOKLAB(max(linearOriginal, vec3(0.001)));
    vec3 newLAB = linearToOKLAB(max(result, vec3(0.001)));
    vec3 finalLAB = vec3(newLAB.x, mix(origLAB.y, newLAB.y, 0.3), mix(origLAB.z, newLAB.z, 0.3));
    vec3 finalLinear = OKLABToLinear(finalLAB);
    
    finalLinear = (finalLinear - 0.5) * 1.05 + 0.5;

    // Soft-Knee Gamut Mapping
    float maxComp = max(finalLinear.r, max(finalLinear.g, finalLinear.b));
    if (maxComp > 0.8) {
        float overshoot = maxComp - 0.8;
        float compressed = 0.8 + 0.2 * tanh(overshoot * 2.0);
        finalLinear *= (compressed / maxComp);
    }

    fragColor = vec4(linearToSRGB(max(vec3(0.0), finalLinear)), 1.0);
}
`;

const FRAGMENT_SHADER_OUTPUT = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_input;

void main() {
    fragColor = texture(u_input, v_texCoord);
}
`;

export default WebGL2DeferredRenderer;
