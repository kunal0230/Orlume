/**
 * LightingShader.js - WebGL2 shader for real-time relighting
 * 
 * Features:
 * - Lambertian diffuse lighting
 * - Blinn-Phong specular highlights
 * - Multiple blend modes (Soft Light, Additive, Screen, Multiply)
 * - Ambient lighting
 * - 60 FPS performance
 */

export class LightingShader {
    constructor(gl) {
        this.gl = gl;
        this.program = null;
        this.uniforms = {};
        this.attributes = {};

        // Textures
        this.normalTexture = null;
        this.depthTexture = null;
        this.albedoTexture = null;

        // Buffers
        this.vao = null;
        this.positionBuffer = null;
        this.texCoordBuffer = null;

        // Output canvas
        this.outputCanvas = null;
        this.outputCtx = null;

        // Framebuffer for rendering
        this.fbo = null;
        this.fboTexture = null;
    }

    /**
     * Initialize shader program
     */
    async init() {
        const gl = this.gl;

        // Create shader program
        const vertexShader = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
        const fragmentShader = this._compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);

        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Shader link error:', gl.getProgramInfoLog(this.program));
            return false;
        }

        // Get uniform locations
        gl.useProgram(this.program);
        this.uniforms = {
            uAlbedo: gl.getUniformLocation(this.program, 'uAlbedo'),
            uNormalMap: gl.getUniformLocation(this.program, 'uNormalMap'),
            uDepthMap: gl.getUniformLocation(this.program, 'uDepthMap'),
            uLightDir: gl.getUniformLocation(this.program, 'uLightDir'),
            uLightColor: gl.getUniformLocation(this.program, 'uLightColor'),
            uLightIntensity: gl.getUniformLocation(this.program, 'uLightIntensity'),
            uAmbient: gl.getUniformLocation(this.program, 'uAmbient'),
            uSpecularity: gl.getUniformLocation(this.program, 'uSpecularity'),
            uGlossiness: gl.getUniformLocation(this.program, 'uGlossiness'),
            uBlendMode: gl.getUniformLocation(this.program, 'uBlendMode'),
            uCompositeIntensity: gl.getUniformLocation(this.program, 'uCompositeIntensity'),
            uHasNormalMap: gl.getUniformLocation(this.program, 'uHasNormalMap'),
        };

        // Get attribute locations
        this.attributes = {
            aPosition: gl.getAttribLocation(this.program, 'aPosition'),
            aTexCoord: gl.getAttribLocation(this.program, 'aTexCoord'),
        };

        // Create VAO and buffers
        this._createBuffers();

        // Create output canvas
        this.outputCanvas = document.createElement('canvas');
        this.outputCtx = this.outputCanvas.getContext('2d');

        return true;
    }

    /**
     * Create vertex buffers
     */
    _createBuffers() {
        const gl = this.gl;

        // Create VAO
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        // Position buffer (full-screen quad)
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.attributes.aPosition);
        gl.vertexAttribPointer(this.attributes.aPosition, 2, gl.FLOAT, false, 0, 0);

        // Texture coordinate buffer
        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 1,
            1, 1,
            0, 0,
            1, 0,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.attributes.aTexCoord);
        gl.vertexAttribPointer(this.attributes.aTexCoord, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
    }

    /**
     * Compile shader source
     */
    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            console.error('Source:', source);
            return null;
        }

        return shader;
    }

    /**
     * Upload normal map texture
     */
    uploadNormalMap(normalData) {
        const gl = this.gl;

        if (this.normalTexture) {
            gl.deleteTexture(this.normalTexture);
        }

        this.normalTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, normalData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /**
     * Upload depth map texture  
     */
    uploadDepthMap(depthResult) {
        const gl = this.gl;

        if (this.depthTexture) {
            gl.deleteTexture(this.depthTexture);
        }

        const depthCanvas = depthResult.canvas || depthResult;

        this.depthTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depthCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /**
     * Render the lighting effect
     */
    render(params) {
        const gl = this.gl;
        const { albedo, light, composite, width, height } = params;

        // Ensure output canvas matches size
        if (this.outputCanvas.width !== width || this.outputCanvas.height !== height) {
            this.outputCanvas.width = width;
            this.outputCanvas.height = height;
            this._createFBO(width, height);
        }

        // Upload albedo (original image)
        this._uploadAlbedo(albedo);

        // Render to FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, width, height);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.albedoTexture);
        gl.uniform1i(this.uniforms.uAlbedo, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
        gl.uniform1i(this.uniforms.uNormalMap, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.uniform1i(this.uniforms.uDepthMap, 2);

        // Set uniforms
        gl.uniform3f(this.uniforms.uLightDir, light.direction.x, light.direction.y, light.direction.z);
        gl.uniform3f(this.uniforms.uLightColor, light.color.r, light.color.g, light.color.b);
        gl.uniform1f(this.uniforms.uLightIntensity, light.intensity);
        gl.uniform1f(this.uniforms.uAmbient, light.ambient);
        gl.uniform1f(this.uniforms.uSpecularity, light.specularity);
        gl.uniform1f(this.uniforms.uGlossiness, light.glossiness);
        gl.uniform1i(this.uniforms.uBlendMode, this._getBlendModeIndex(composite.mode));
        gl.uniform1f(this.uniforms.uCompositeIntensity, composite.intensity);
        gl.uniform1i(this.uniforms.uHasNormalMap, this.normalTexture ? 1 : 0);

        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Read pixels to output canvas
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Flip Y and put to output canvas
        const imageData = new ImageData(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIdx = ((height - 1 - y) * width + x) * 4;
                const dstIdx = (y * width + x) * 4;
                imageData.data[dstIdx] = pixels[srcIdx];
                imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
                imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
                imageData.data[dstIdx + 3] = pixels[srcIdx + 3];
            }
        }
        this.outputCtx.putImageData(imageData, 0, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindVertexArray(null);

        return this.outputCanvas;
    }

    /**
     * Upload albedo (original image) texture
     */
    _uploadAlbedo(source) {
        const gl = this.gl;

        if (this.albedoTexture) {
            gl.deleteTexture(this.albedoTexture);
        }

        this.albedoTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.albedoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /**
     * Create framebuffer for off-screen rendering
     */
    _createFBO(width, height) {
        const gl = this.gl;

        if (this.fbo) {
            gl.deleteFramebuffer(this.fbo);
            gl.deleteTexture(this.fboTexture);
        }

        this.fboTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.fboTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTexture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Get blend mode index for shader
     */
    _getBlendModeIndex(mode) {
        const modes = {
            'normal': 0,
            'softLight': 1,
            'additive': 2,
            'screen': 3,
            'multiply': 4,
        };
        return modes[mode] || 0;
    }

    /**
     * Cleanup resources
     */
    dispose() {
        const gl = this.gl;

        if (this.program) gl.deleteProgram(this.program);
        if (this.normalTexture) gl.deleteTexture(this.normalTexture);
        if (this.depthTexture) gl.deleteTexture(this.depthTexture);
        if (this.albedoTexture) gl.deleteTexture(this.albedoTexture);
        if (this.fbo) gl.deleteFramebuffer(this.fbo);
        if (this.fboTexture) gl.deleteTexture(this.fboTexture);
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
        if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
    }
}

// ===========================================
// GLSL Shader Sources
// ===========================================

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aTexCoord;

out vec2 vTexCoord;

void main() {
    vTexCoord = aTexCoord;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 vTexCoord;
out vec4 fragColor;

// Textures
uniform sampler2D uAlbedo;
uniform sampler2D uNormalMap;
uniform sampler2D uDepthMap;

// Light parameters
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uAmbient;
uniform float uSpecularity;
uniform float uGlossiness;

// Compositing
uniform int uBlendMode;
uniform float uCompositeIntensity;
uniform int uHasNormalMap;

// ===========================================
// Blend Mode Functions
// ===========================================

vec3 blendSoftLight(vec3 base, vec3 blend) {
    return mix(
        2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
        sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
        step(0.5, blend)
    );
}

vec3 blendScreen(vec3 base, vec3 blend) {
    return 1.0 - (1.0 - base) * (1.0 - blend);
}

vec3 blendMultiply(vec3 base, vec3 blend) {
    return base * blend;
}

vec3 blendAdditive(vec3 base, vec3 blend) {
    return min(base + blend, vec3(1.0));
}

vec3 applyBlendMode(vec3 base, vec3 lighting, int mode) {
    if (mode == 0) {
        // Normal: replace with lit result
        return lighting;
    } else if (mode == 1) {
        // Soft Light: preserves texture, subtle effect
        return blendSoftLight(base, lighting);
    } else if (mode == 2) {
        // Additive: brightens
        return blendAdditive(base, lighting - 0.5);
    } else if (mode == 3) {
        // Screen: lighter blend
        return blendScreen(base, lighting);
    } else if (mode == 4) {
        // Multiply: darker blend
        return blendMultiply(base, lighting + 0.5);
    }
    return lighting;
}

// ===========================================
// Main Shader
// ===========================================

void main() {
    // Sample textures
    vec4 albedoSample = texture(uAlbedo, vTexCoord);
    vec3 albedo = albedoSample.rgb;
    
    // Get normal from normal map
    vec3 normal;
    if (uHasNormalMap == 1) {
        vec3 normalSample = texture(uNormalMap, vTexCoord).rgb;
        // Decode from [0,1] to [-1,1]
        normal = normalize(normalSample * 2.0 - 1.0);
    } else {
        // Default: facing camera
        normal = vec3(0.0, 0.0, 1.0);
    }
    
    // Normalize light direction
    vec3 L = normalize(uLightDir);
    
    // View direction (assume camera at front)
    vec3 V = vec3(0.0, 0.0, 1.0);
    
    // ===========================================
    // Lighting Calculation
    // ===========================================
    
    // 1. Lambertian Diffuse
    float NdotL = max(dot(normal, L), 0.0);
    vec3 diffuse = albedo * uLightColor * NdotL * uLightIntensity;
    
    // 2. Blinn-Phong Specular
    vec3 H = normalize(L + V);  // Halfway vector
    float NdotH = max(dot(normal, H), 0.0);
    float specPower = pow(NdotH, uGlossiness);
    vec3 specular = uLightColor * specPower * uSpecularity * uLightIntensity;
    
    // 3. Ambient
    vec3 ambient = albedo * uAmbient;
    
    // 4. Combine lighting
    vec3 litColor = diffuse + specular + ambient;
    
    // Clamp to prevent over-bright
    litColor = clamp(litColor, 0.0, 1.0);
    
    // ===========================================
    // Compositing
    // ===========================================
    
    // Apply blend mode
    vec3 blended = applyBlendMode(albedo, litColor, uBlendMode);
    
    // Mix with original based on intensity
    vec3 result = mix(albedo, blended, uCompositeIntensity);
    
    // Gamma correction (optional, usually done in final output)
    // result = pow(result, vec3(1.0 / 2.2));
    
    fragColor = vec4(result, albedoSample.a);
}
`;

export default LightingShader;
