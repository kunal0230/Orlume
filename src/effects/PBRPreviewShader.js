/**
 * PBRPreviewShader - WebGL-based Real-Time PBR Preview
 * 
 * GPU-accelerated version of PBRShader for 60fps interactive preview.
 * Uses WebGL2 for proper shader support.
 */

export class PBRPreviewShader {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.textures = {};
        this.ready = false;
        this.uniforms = {};
    }

    /**
     * Initialize WebGL context and compile shaders
     */
    init(width, height) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;

        this.gl = this.canvas.getContext('webgl2', {
            antialias: false,
            preserveDrawingBuffer: true
        });

        if (!this.gl) {
            console.warn('WebGL2 not available, falling back to software rendering');
            return false;
        }

        // Compile shaders
        const vertexShader = this._compileShader(this.gl.VERTEX_SHADER, VERTEX_SHADER);
        const fragmentShader = this._compileShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

        if (!vertexShader || !fragmentShader) {
            return false;
        }

        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            console.error('Shader program link failed:', this.gl.getProgramInfoLog(this.program));
            return false;
        }

        // Setup geometry (fullscreen quad)
        this._setupGeometry();

        // Get uniform locations
        this._getUniformLocations();

        this.ready = true;
        console.log('🎮 PBR Preview Shader initialized');
        return true;
    }

    /**
     * Upload textures to GPU
     */
    uploadTextures(albedoCanvas, normalMap, depthCanvas, materialCanvas = null) {
        if (!this.gl) return;

        const gl = this.gl;

        // Albedo texture
        this.textures.albedo = this._createTexture(albedoCanvas);

        // Normal texture (handle different formats)
        if (normalMap instanceof HTMLCanvasElement) {
            this.textures.normal = this._createTexture(normalMap);
        } else if (normalMap && normalMap.data) {
            // Create canvas from data
            const canvas = this._dataToCanvas(normalMap);
            this.textures.normal = this._createTexture(canvas);
        }

        // Depth texture
        this.textures.depth = this._createTexture(depthCanvas);

        // Material texture (optional)
        if (materialCanvas) {
            this.textures.material = this._createTexture(materialCanvas);
        }

        console.log('📦 Textures uploaded to GPU');
    }

    /**
     * Render frame with current light positions
     * 
     * @param {Array} lights - Array of { x, y, z, color, intensity }
     * @param {Object} options - Rendering options
     * @returns {HTMLCanvasElement}
     */
    render(lights, options = {}) {
        if (!this.ready || !this.gl) {
            console.warn('PBR Preview not ready');
            return null;
        }

        const gl = this.gl;
        const {
            ambientIntensity = 0.3,
            ambientColor = [0.1, 0.1, 0.15]
        } = options;

        gl.useProgram(this.program);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        // Bind textures
        this._bindTexture(0, this.textures.albedo, 'u_albedo');
        this._bindTexture(1, this.textures.normal, 'u_normal');
        this._bindTexture(2, this.textures.depth, 'u_depth');
        if (this.textures.material) {
            this._bindTexture(3, this.textures.material, 'u_material');
        }

        // Set uniforms
        gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
        gl.uniform3fv(this.uniforms.u_ambientColor, ambientColor);
        gl.uniform1f(this.uniforms.u_ambientIntensity, ambientIntensity);

        // Set light data (max 4 lights for simplicity)
        const numLights = Math.min(lights.length, 4);
        const lightPositions = new Float32Array(12); // 4 lights × 3 components
        const lightColors = new Float32Array(12);
        const lightIntensities = new Float32Array(4);

        for (let i = 0; i < numLights; i++) {
            const light = lights[i];
            lightPositions[i * 3] = light.x / this.canvas.width;
            lightPositions[i * 3 + 1] = light.y / this.canvas.height;
            lightPositions[i * 3 + 2] = light.z || 0.5;

            const color = light.color || [1, 1, 1];
            lightColors[i * 3] = color[0];
            lightColors[i * 3 + 1] = color[1];
            lightColors[i * 3 + 2] = color[2];

            lightIntensities[i] = light.intensity || 1.0;
        }

        gl.uniform1i(this.uniforms.u_numLights, numLights);
        gl.uniform3fv(this.uniforms.u_lightPositions, lightPositions);
        gl.uniform3fv(this.uniforms.u_lightColors, lightColors);
        gl.uniform1fv(this.uniforms.u_lightIntensities, lightIntensities);

        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        return this.canvas;
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

    _setupGeometry() {
        const gl = this.gl;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        // Fullscreen quad: position (xy) + texCoord (uv)
        const vertices = new Float32Array([
            -1, -1, 0, 1,
            1, -1, 1, 1,
            -1, 1, 0, 0,
            1, 1, 1, 0
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');

        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
    }

    _getUniformLocations() {
        const gl = this.gl;
        const names = [
            'u_albedo', 'u_normal', 'u_depth', 'u_material',
            'u_resolution', 'u_ambientColor', 'u_ambientIntensity',
            'u_numLights', 'u_lightPositions', 'u_lightColors', 'u_lightIntensities'
        ];

        for (const name of names) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
    }

    _createTexture(source) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
    }

    _bindTexture(unit, texture, uniformName) {
        if (!texture) return;
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this.uniforms[uniformName], unit);
    }

    _dataToCanvas(map) {
        const canvas = document.createElement('canvas');
        canvas.width = map.width;
        canvas.height = map.height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(map.width, map.height);
        imgData.data.set(map.data);
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    dispose() {
        if (this.gl) {
            // Clean up textures
            for (const tex of Object.values(this.textures)) {
                if (tex) this.gl.deleteTexture(tex);
            }
            if (this.program) this.gl.deleteProgram(this.program);
        }
        this.ready = false;
    }
}

// ============================================
// GLSL Shaders
// ============================================

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_albedo;
uniform sampler2D u_normal;
uniform sampler2D u_depth;
uniform sampler2D u_material;

uniform vec2 u_resolution;
uniform vec3 u_ambientColor;
uniform float u_ambientIntensity;

uniform int u_numLights;
uniform vec3 u_lightPositions[4];
uniform vec3 u_lightColors[4];
uniform float u_lightIntensities[4];

const float PI = 3.14159265359;

// Decode normal from texture
vec3 decodeNormal(vec4 normalTex) {
    return normalize(normalTex.rgb * 2.0 - 1.0);
}

// GGX Distribution
float D_GGX(float NdotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom + 0.0001);
}

// Geometry function (Smith GGX)
float G_Smith(float NdotV, float NdotL, float roughness) {
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float G1V = NdotV / (NdotV * (1.0 - k) + k);
    float G1L = NdotL / (NdotL * (1.0 - k) + k);
    return G1V * G1L;
}

// Fresnel-Schlick
vec3 F_Schlick(float VdotH, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
}

void main() {
    vec4 albedoTex = texture(u_albedo, v_texCoord);
    vec4 normalTex = texture(u_normal, v_texCoord);
    vec4 depthTex = texture(u_depth, v_texCoord);
    vec4 materialTex = texture(u_material, v_texCoord);
    
    vec3 albedo = albedoTex.rgb;
    vec3 N = decodeNormal(normalTex);
    float depth = depthTex.r;
    
    // Material properties from texture or defaults
    float roughness = materialTex.r > 0.0 ? materialTex.r : 0.5;
    float metallic = materialTex.g;
    
    // Pixel position in normalized space
    vec3 pixelPos = vec3(v_texCoord, depth);
    
    // View direction (camera looking at screen)
    vec3 V = normalize(vec3(0.5 - v_texCoord.x, 0.5 - v_texCoord.y, -1.0));
    
    // Base reflectivity
    vec3 F0 = mix(vec3(0.04), albedo, metallic);
    
    // Accumulate lighting
    vec3 Lo = vec3(0.0);
    
    for (int i = 0; i < 4; i++) {
        if (i >= u_numLights) break;
        
        vec3 lightPos = u_lightPositions[i];
        vec3 lightColor = u_lightColors[i];
        float intensity = u_lightIntensities[i];
        
        // Light direction
        vec3 L = normalize(vec3(lightPos.xy - v_texCoord, lightPos.z - depth));
        vec3 H = normalize(V + L);
        
        // Dot products
        float NdotL = max(dot(N, L), 0.0);
        float NdotV = max(dot(N, V), 0.001);
        float NdotH = max(dot(N, H), 0.0);
        float VdotH = max(dot(V, H), 0.0);
        
        // Skip if facing away
        if (NdotL <= 0.0) continue;
        
        // Distance attenuation
        vec2 diff = lightPos.xy - v_texCoord;
        float dist = length(vec3(diff, lightPos.z - depth));
        float attenuation = 1.0 / (1.0 + dist * dist * 4.0);
        
        // PBR terms
        float D = D_GGX(NdotH, roughness);
        float G = G_Smith(NdotV, NdotL, roughness);
        vec3 F = F_Schlick(VdotH, F0);
        
        // Specular BRDF
        vec3 specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);
        
        // Diffuse (non-metals only)
        vec3 kD = (1.0 - F) * (1.0 - metallic);
        vec3 diffuse = kD * albedo / PI;
        
        // Add to total
        Lo += (diffuse + specular) * lightColor * intensity * NdotL * attenuation;
    }
    
    // Ambient
    vec3 ambient = u_ambientColor * u_ambientIntensity * albedo;
    
    // Final color
    vec3 color = ambient + Lo;
    
    // Simple tone mapping
    color = color / (color + vec3(1.0));
    
    fragColor = vec4(color, 1.0);
}
`;
