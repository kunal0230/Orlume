/**
 * WebGL2DeferredRenderer.js - v8 PRO Relighting
 * 
 * GPU-accelerated deferred rendering using WebGL2.
 * Implements PBR lighting with Lambertian diffuse and specular.
 */

export class WebGL2DeferredRenderer {
    constructor() {
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

        const { width, height, albedo, normals, depth } = gBuffer;
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

        // Draw fullscreen quad
        gl.bindVertexArray(this.quadVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);

        // Cleanup textures
        gl.deleteTexture(albedoTex);
        gl.deleteTexture(normalTex);
        gl.deleteTexture(depthTex);

        // Return result as canvas
        return this.canvas;
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

uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform float u_ambient;

// Shadow parameters
uniform float u_shadowIntensity;  // 0-1, how dark shadows are
uniform float u_shadowSoftness;   // 0-1, how soft/blurred shadows are
uniform vec2 u_resolution;

// sRGB to Linear conversion
vec3 sRGBToLinear(vec3 srgb) {
    vec3 low = srgb / 12.92;
    vec3 high = pow((srgb + 0.055) / 1.055, vec3(2.4));
    return mix(low, high, step(0.04045, srgb));
}

// Linear to sRGB conversion
vec3 linearToSRGB(vec3 linear) {
    vec3 low = linear * 12.92;
    vec3 high = 1.055 * pow(linear, vec3(1.0/2.4)) - 0.055;
    return mix(low, high, step(0.0031308, linear));
}

// SSAO - Screen Space Ambient Occlusion
float computeSSAO(vec2 uv, float centerDepth, vec3 normal) {
    const int SAMPLES = 8;
    float occlusion = 0.0;
    
    // Sample radius in UV space (adaptive based on softness)
    float radius = (u_shadowSoftness * 0.02 + 0.005);
    
    // Hemisphere sample kernel (in tangent space)
    vec2 kernel[8];
    kernel[0] = vec2( 0.7071,  0.7071);
    kernel[1] = vec2(-0.7071,  0.7071);
    kernel[2] = vec2( 0.7071, -0.7071);
    kernel[3] = vec2(-0.7071, -0.7071);
    kernel[4] = vec2( 1.0,  0.0);
    kernel[5] = vec2(-1.0,  0.0);
    kernel[6] = vec2( 0.0,  1.0);
    kernel[7] = vec2( 0.0, -1.0);
    
    for (int i = 0; i < SAMPLES; i++) {
        // Sample offset with noise-like variation
        float angle = float(i) * 0.785398 + uv.x * 12.9898 + uv.y * 78.233;
        vec2 offset = vec2(cos(angle), sin(angle)) * radius * (1.0 + float(i) * 0.15);
        
        vec2 sampleUV = uv + offset;
        float sampleDepth = texture(u_depth, sampleUV).r;
        
        // Check if sample is occluded (closer to camera = lower depth value)
        float depthDiff = centerDepth - sampleDepth;
        
        // Range check - only count nearby samples
        float rangeCheck = smoothstep(0.0, 0.1, abs(depthDiff));
        rangeCheck *= 1.0 - smoothstep(0.1, 0.3, abs(depthDiff));  // Falloff at distance
        
        // Accumulate occlusion for samples that are closer (occluding)
        occlusion += step(0.005, depthDiff) * rangeCheck;
    }
    
    occlusion = 1.0 - (occlusion / float(SAMPLES));
    return occlusion;
}

// Contact Shadows - trace along light direction in screen space
float computeContactShadow(vec2 uv, float centerDepth, vec3 lightDir) {
    const int STEPS = 12;
    float shadow = 0.0;
    
    // Project light direction to screen space
    vec2 lightDirSS = normalize(lightDir.xy) * (u_shadowSoftness * 0.03 + 0.01);
    
    // If light is behind/parallel to surface, no shadow
    if (lightDir.z < 0.1) {
        lightDirSS *= 0.5;  // Reduce shadow trace for grazing angles
    }
    
    float totalWeight = 0.0;
    
    for (int i = 1; i <= STEPS; i++) {
        float t = float(i) / float(STEPS);
        vec2 sampleUV = uv - lightDirSS * t;  // Trace backward from light direction
        
        // Bounds check
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            continue;
        }
        
        float sampleDepth = texture(u_depth, sampleUV).r;
        float heightDiff = sampleDepth - centerDepth;
        
        // If sample is closer (occluding) and within range
        float weight = 1.0 - t;  // Closer samples have more weight
        if (heightDiff > 0.01 && heightDiff < 0.3) {
            shadow += weight * smoothstep(0.01, 0.05, heightDiff);
        }
        totalWeight += weight;
    }
    
    if (totalWeight > 0.0) {
        shadow = shadow / totalWeight;
    }
    
    return 1.0 - clamp(shadow * u_shadowIntensity * 2.0, 0.0, 1.0);
}

void main() {
    // Sample G-Buffer
    vec4 albedoSample = texture(u_albedo, v_texCoord);
    vec4 normalSample = texture(u_normals, v_texCoord);
    float depth = texture(u_depth, v_texCoord).r;
    
    // Unpack albedo (sRGB to linear)
    vec3 albedo = sRGBToLinear(albedoSample.rgb);
    
    // Unpack normals from [0,1] to [-1,1]
    vec3 normal = normalize(normalSample.rgb * 2.0 - 1.0);
    
    // Normalize light direction
    vec3 lightDir = normalize(u_lightDir);
    
    // === Lambertian Diffuse ===
    float NdotL = max(dot(normal, lightDir), 0.0);
    vec3 diffuse = albedo * NdotL * u_lightColor * u_lightIntensity;
    
    // === Ambient ===
    vec3 ambient = albedo * u_ambient;
    
    // === Simple Specular (Blinn-Phong) ===
    vec3 viewDir = vec3(0.0, 0.0, 1.0); // Orthographic assumption
    vec3 halfDir = normalize(lightDir + viewDir);
    float NdotH = max(dot(normal, halfDir), 0.0);
    float specular = pow(NdotH, 32.0) * 0.3 * u_lightIntensity;
    
    // === SSAO (Ambient Occlusion) ===
    float ao = computeSSAO(v_texCoord, depth, normal);
    
    // === Contact Shadows (directional, follows light) ===
    float contactShadow = computeContactShadow(v_texCoord, depth, lightDir);
    
    // === Combine shadows ===
    float combinedShadow = min(ao, contactShadow);
    
    // Apply shadow to diffuse and specular (not ambient)
    vec3 lighting = ambient + (diffuse + vec3(specular)) * combinedShadow;
    
    // === Tone mapping (simple Reinhard) ===
    lighting = lighting / (lighting + vec3(1.0));
    
    // Convert back to sRGB
    vec3 finalColor = linearToSRGB(lighting);
    
    fragColor = vec4(finalColor, 1.0);
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
