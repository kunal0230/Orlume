/**
 * DeferredLightingShader.js - WebGL2 Deferred Shading Pipeline v6
 * 
 * Enhanced DaVinci Resolve-Quality Implementation:
 * - GPU-based raymarched shadows (PCSS)
 * - Screen-space ambient occlusion (SSAO)
 * - Optional PBR lighting (Cook-Torrance)
 * - Tunable attenuation: 1/(Kc + Kl*d + Kq*d²)
 * - Contrast/Gamma control for terminator sharpness
 * - Overlay blend mode (preserves texture)
 * - Point light support with proper distance falloff
 */

export class DeferredLightingShader {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;

        this.albedoTexture = null;
        this.normalTexture = null;
        this.depthTexture = null;
        this.shadowTexture = null;  // Shadow map texture (fallback)
        this.noiseTexture = null;   // Random noise for SSAO

        this.quadVAO = null;
        this.uniforms = {};

        this.isReady = false;
    }

    async init() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 1024;

        this.gl = this.canvas.getContext('webgl2', {
            antialias: false,
            alpha: true,
            premultipliedAlpha: false,
        });

        if (!this.gl) {
            console.error('DeferredLightingShader: WebGL2 not supported');
            return false;
        }

        const vertShader = this._compileShader(this.gl.VERTEX_SHADER, VERTEX_SHADER);
        const fragShader = this._compileShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

        if (!vertShader || !fragShader) return false;

        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertShader);
        this.gl.attachShader(this.program, fragShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            console.error('Shader link error:', this.gl.getProgramInfoLog(this.program));
            return false;
        }

        this.gl.useProgram(this.program);
        this._getUniformLocations();
        this._createQuad();
        this._createTextures();
        this._createNoiseTexture();

        this.isReady = true;
        return true;
    }

    render(params) {
        const { gl } = this;
        const {
            albedo,
            normalMap,
            depthMap,
            shadowMap,
            light,
            width,
            height
        } = params;

        if (!this.isReady) return null;

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        this._uploadTexture(this.albedoTexture, albedo, 0, 'u_albedo');
        this._uploadTexture(this.normalTexture, normalMap, 1, 'u_normals');
        if (depthMap) {
            this._uploadTexture(this.depthTexture, depthMap, 2, 'u_depth');
        }

        // Upload shadow map if provided (fallback CPU shadows)
        if (shadowMap) {
            this._uploadTexture(this.shadowTexture, shadowMap, 3, 'u_shadow');
            gl.uniform1i(this.uniforms.u_shadowEnabled, 1);
        } else {
            gl.uniform1i(this.uniforms.u_shadowEnabled, 0);
        }

        // Noise texture for SSAO
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture);
        gl.uniform1i(this.uniforms.u_noise, 4);

        gl.uniform2f(this.uniforms.u_resolution, width, height);

        // Light position (normalized 0-1 to screen space)
        gl.uniform2f(this.uniforms.u_lightPos,
            light.position.x * width,
            light.position.y * height
        );

        // Light direction (for directional mode)
        const dir = light.direction;
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        gl.uniform3f(this.uniforms.u_lightDir, dir.x / len, dir.y / len, dir.z / len);

        gl.uniform3f(this.uniforms.u_lightColor, light.color.r, light.color.g, light.color.b);
        gl.uniform1f(this.uniforms.u_lightIntensity, light.intensity);
        gl.uniform1f(this.uniforms.u_ambient, light.ambient);
        gl.uniform1f(this.uniforms.u_specularity, light.specularity || 0);
        gl.uniform1f(this.uniforms.u_glossiness, light.glossiness || 32);

        // DaVinci-style parameters
        gl.uniform1f(this.uniforms.u_reach, light.reach || 200.0);
        gl.uniform1f(this.uniforms.u_contrast, light.contrast || 1.0);
        gl.uniform1i(this.uniforms.u_directional, light.directional ? 1 : 0);
        gl.uniform1i(this.uniforms.u_blendMode, light.blendMode || 0);
        gl.uniform1f(this.uniforms.u_lightHeight, light.lightHeight || 0.5);

        // Rim lighting parameters
        gl.uniform1f(this.uniforms.u_rimIntensity, light.rimIntensity || 0.0);
        gl.uniform3f(this.uniforms.u_rimColor,
            light.rimColor?.r || 1.0,
            light.rimColor?.g || 1.0,
            light.rimColor?.b || 1.0
        );
        gl.uniform1f(this.uniforms.u_rimWidth, light.rimWidth || 0.5);

        // Spotlight parameters
        gl.uniform1i(this.uniforms.u_isSpotlight, light.isSpotlight ? 1 : 0);
        gl.uniform1f(this.uniforms.u_spotAngle, (light.spotAngle || 30.0) * Math.PI / 180.0);
        gl.uniform1f(this.uniforms.u_spotSoftness, light.spotSoftness || 0.3);

        // SSS parameters
        gl.uniform1f(this.uniforms.u_sssIntensity, light.sssIntensity || 0.0);
        gl.uniform3f(this.uniforms.u_sssColor,
            light.sssColor?.r || 1.0,
            light.sssColor?.g || 0.4,
            light.sssColor?.b || 0.3
        );

        // NEW: Shadow parameters
        gl.uniform1f(this.uniforms.u_shadowIntensity, light.shadowIntensity || 0.7);
        gl.uniform1f(this.uniforms.u_shadowSoftness, light.shadowSoftness || 0.5);
        gl.uniform3f(this.uniforms.u_shadowColor,
            light.shadowColor?.r || 0.0,
            light.shadowColor?.g || 0.0,
            light.shadowColor?.b || 0.1
        );
        gl.uniform1i(this.uniforms.u_gpuShadows, light.gpuShadows !== false ? 1 : 0);

        // NEW: SSAO parameters
        gl.uniform1f(this.uniforms.u_aoIntensity, light.aoIntensity || 0.0);
        gl.uniform1f(this.uniforms.u_aoRadius, light.aoRadius || 10.0);

        // NEW: PBR parameters
        gl.uniform1f(this.uniforms.u_roughness, light.roughness || 0.5);
        gl.uniform1f(this.uniforms.u_metallic, light.metallic || 0.0);
        gl.uniform1i(this.uniforms.u_usePBR, light.usePBR ? 1 : 0);

        gl.bindVertexArray(this.quadVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);

        return this.canvas;
    }

    getImageData() {
        const { gl, canvas } = this;
        const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        const rowSize = canvas.width * 4;
        const flipped = new Uint8ClampedArray(pixels.length);

        for (let y = 0; y < canvas.height; y++) {
            const srcRow = (canvas.height - 1 - y) * rowSize;
            const dstRow = y * rowSize;
            flipped.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
        }

        return new ImageData(flipped, canvas.width, canvas.height);
    }

    _compileShader(type, source) {
        const { gl } = this;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            return null;
        }
        return shader;
    }

    _getUniformLocations() {
        const { gl, program } = this;
        const uniforms = [
            'u_albedo', 'u_normals', 'u_depth', 'u_shadow', 'u_noise', 'u_resolution',
            'u_lightPos', 'u_lightDir', 'u_lightColor', 'u_lightIntensity',
            'u_lightHeight', 'u_ambient', 'u_specularity', 'u_glossiness',
            'u_reach', 'u_contrast', 'u_directional', 'u_blendMode',
            'u_rimIntensity', 'u_rimColor', 'u_rimWidth',
            'u_shadowEnabled', 'u_shadowIntensity', 'u_shadowSoftness', 'u_shadowColor', 'u_gpuShadows',
            'u_isSpotlight', 'u_spotAngle', 'u_spotSoftness',
            'u_sssIntensity', 'u_sssColor',
            'u_aoIntensity', 'u_aoRadius',
            'u_roughness', 'u_metallic', 'u_usePBR'
        ];

        uniforms.forEach(name => {
            this.uniforms[name] = gl.getUniformLocation(program, name);
        });
    }

    _createQuad() {
        const { gl } = this;

        const vertices = new Float32Array([
            -1, -1, 0, 0,
            1, -1, 1, 0,
            -1, 1, 0, 1,
            1, 1, 1, 1,
        ]);

        this.quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.quadVAO);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

        const uvLoc = gl.getAttribLocation(this.program, 'a_uv');
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

        gl.bindVertexArray(null);
    }

    _createTextures() {
        const { gl } = this;

        this.albedoTexture = gl.createTexture();
        this.normalTexture = gl.createTexture();
        this.depthTexture = gl.createTexture();
        this.shadowTexture = gl.createTexture();

        [this.albedoTexture, this.normalTexture, this.depthTexture, this.shadowTexture].forEach(tex => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        });
    }

    _createNoiseTexture() {
        const { gl } = this;
        const size = 4;
        const noiseData = new Uint8Array(size * size * 4);

        // Generate random rotation noise for SSAO
        for (let i = 0; i < size * size; i++) {
            const angle = Math.random() * Math.PI * 2;
            noiseData[i * 4] = Math.floor((Math.cos(angle) * 0.5 + 0.5) * 255);
            noiseData[i * 4 + 1] = Math.floor((Math.sin(angle) * 0.5 + 0.5) * 255);
            noiseData[i * 4 + 2] = Math.floor(Math.random() * 255);
            noiseData[i * 4 + 3] = 255;
        }

        this.noiseTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    _uploadTexture(texture, source, unit, uniformName) {
        const { gl } = this;

        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);

        if (source instanceof ImageData) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
        } else if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }

        gl.uniform1i(this.uniforms[uniformName], unit);
    }

    dispose() {
        const { gl } = this;
        if (!gl) return;

        if (this.program) gl.deleteProgram(this.program);
        if (this.albedoTexture) gl.deleteTexture(this.albedoTexture);
        if (this.normalTexture) gl.deleteTexture(this.normalTexture);
        if (this.depthTexture) gl.deleteTexture(this.depthTexture);
        if (this.shadowTexture) gl.deleteTexture(this.shadowTexture);
        if (this.noiseTexture) gl.deleteTexture(this.noiseTexture);
        if (this.quadVAO) gl.deleteVertexArray(this.quadVAO);

        this.isReady = false;
    }
}

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_uv;

out vec2 v_uv;

void main() {
    v_uv = vec2(a_uv.x, 1.0 - a_uv.y);
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Enhanced Fragment Shader with GPU Shadows, SSAO, and PBR
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_albedo;
uniform sampler2D u_normals;
uniform sampler2D u_depth;
uniform sampler2D u_shadow;   // CPU shadow map (fallback)
uniform sampler2D u_noise;    // Random noise for SSAO

uniform vec2 u_resolution;
uniform vec2 u_lightPos;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform float u_ambient;
uniform float u_specularity;
uniform float u_glossiness;
uniform float u_reach;
uniform float u_contrast;
uniform float u_lightHeight;
uniform int u_directional;
uniform int u_blendMode;

// Rim lighting
uniform float u_rimIntensity;
uniform vec3 u_rimColor;
uniform float u_rimWidth;

// Shadow parameters
uniform int u_shadowEnabled;
uniform float u_shadowIntensity;
uniform float u_shadowSoftness;
uniform vec3 u_shadowColor;
uniform int u_gpuShadows;

// Spotlight
uniform int u_isSpotlight;
uniform float u_spotAngle;
uniform float u_spotSoftness;

// Subsurface scattering
uniform float u_sssIntensity;
uniform vec3 u_sssColor;

// SSAO parameters
uniform float u_aoIntensity;
uniform float u_aoRadius;

// PBR parameters
uniform float u_roughness;
uniform float u_metallic;
uniform int u_usePBR;

// ============================================
// CONSTANTS
// ============================================
const float PI = 3.14159265359;
const int SHADOW_SAMPLES = 16;
const int AO_SAMPLES = 12;

// Poisson disk samples for shadow/AO
const vec2 poissonDisk[16] = vec2[](
    vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725),
    vec2(-0.094184101, -0.92938870), vec2(0.34495938, 0.29387760),
    vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464),
    vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
    vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420),
    vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
    vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590),
    vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790)
);

// ============================================
// BLEND MODES
// ============================================
vec3 overlayBlend(vec3 base, float blend) {
    vec3 result;
    for (int i = 0; i < 3; i++) {
        float b = base[i];
        if (b < 0.5) {
            result[i] = 2.0 * b * blend;
        } else {
            result[i] = 1.0 - 2.0 * (1.0 - b) * (1.0 - blend);
        }
    }
    return result;
}

vec3 softLightBlend(vec3 base, float blend) {
    vec3 result;
    for (int i = 0; i < 3; i++) {
        float b = base[i];
        if (blend < 0.5) {
            result[i] = b - (1.0 - 2.0 * blend) * b * (1.0 - b);
        } else {
            float d = (b <= 0.25) ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
            result[i] = b + (2.0 * blend - 1.0) * (d - b);
        }
    }
    return result;
}

// ============================================
// SMOOTH NORMAL SAMPLING
// ============================================
vec3 sampleSmoothNormal(vec2 uv) {
    vec2 texelSize = 1.0 / u_resolution;
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 offset = vec2(float(x), float(y)) * texelSize * 2.0;
            float dist = length(vec2(x, y));
            float w = exp(-dist * dist / 4.0);
            sum += texture(u_normals, uv + offset).rgb * w;
            weight += w;
        }
    }
    
    vec3 smoothNormal = sum / weight;
    vec3 flatNormal = vec3(0.5, 0.5, 1.0);
    float flatBlend = 0.25;
    
    return mix(smoothNormal, flatNormal, flatBlend);
}

// ============================================
// GPU-BASED RAYMARCHED SHADOWS (PCSS)
// ============================================
float calculateGPUShadow(vec2 uv, float currentDepth) {
    if (u_gpuShadows == 0) return 1.0;
    
    vec2 texelSize = 1.0 / u_resolution;
    
    // Light direction in screen space
    vec2 lightPosNorm = u_lightPos / u_resolution;
    vec2 toLightDir = normalize(lightPosNorm - uv);
    
    float shadow = 1.0;
    float penumbraSize = u_shadowSoftness * 0.02;
    
    // Raymarch toward light
    for (int i = 1; i <= SHADOW_SAMPLES; i++) {
        float t = float(i) / float(SHADOW_SAMPLES);
        float marchDist = t * 0.15; // Max march distance
        
        vec2 sampleUV = uv + toLightDir * marchDist;
        
        // Bounds check
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) break;
        
        // Sample depth with Poisson jitter for soft shadows
        float jitterScale = penumbraSize * (1.0 - t);
        vec2 jitter = poissonDisk[i % 16] * jitterScale;
        float sampleDepth = texture(u_depth, sampleUV + jitter).r;
        
        // Height difference check
        float heightDiff = sampleDepth - currentDepth;
        float expectedHeight = marchDist * 0.5;
        
        if (heightDiff > 0.02 + expectedHeight) {
            // PCSS: softer shadows for distant occluders
            float occlusionStrength = smoothstep(0.0, 0.1, heightDiff - 0.02);
            float distanceFactor = 1.0 - t; // Closer occluders = harder shadows
            shadow = min(shadow, mix(1.0 - u_shadowIntensity, 1.0, 1.0 - occlusionStrength * distanceFactor));
        }
    }
    
    return shadow;
}

// ============================================
// SCREEN-SPACE AMBIENT OCCLUSION (SSAO)
// ============================================
float calculateSSAO(vec2 uv, vec3 normal, float depth) {
    if (u_aoIntensity <= 0.0) return 1.0;
    
    vec2 texelSize = 1.0 / u_resolution;
    vec2 noiseScale = u_resolution / 4.0;
    vec2 noiseUV = uv * noiseScale;
    vec3 randomVec = texture(u_noise, noiseUV).xyz * 2.0 - 1.0;
    
    // Create TBN matrix for hemisphere orientation
    vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    
    float occlusion = 0.0;
    float radius = u_aoRadius * texelSize.x;
    
    for (int i = 0; i < AO_SAMPLES; i++) {
        // Hemisphere sample
        vec2 sampleOffset = poissonDisk[i] * radius;
        
        // Rotate by random angle
        float angle = randomVec.z * PI * 2.0;
        float c = cos(angle);
        float s = sin(angle);
        sampleOffset = vec2(
            sampleOffset.x * c - sampleOffset.y * s,
            sampleOffset.x * s + sampleOffset.y * c
        );
        
        vec2 sampleUV = uv + sampleOffset;
        float sampleDepth = texture(u_depth, sampleUV).r;
        
        // Range check and occlusion
        float rangeCheck = smoothstep(0.0, 1.0, radius / abs(depth - sampleDepth + 0.001));
        float depthDiff = depth - sampleDepth;
        
        // Only occlude if sample is "in front" (closer to camera)
        if (depthDiff < 0.0 && depthDiff > -0.1) {
            occlusion += rangeCheck * smoothstep(-0.1, -0.01, depthDiff);
        }
    }
    
    occlusion = 1.0 - (occlusion / float(AO_SAMPLES)) * u_aoIntensity;
    return clamp(occlusion, 0.0, 1.0);
}

// ============================================
// PBR FUNCTIONS (Cook-Torrance BRDF)
// ============================================
float DistributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    
    float num = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    
    return num / max(denom, 0.0001);
}

float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    
    float num = NdotV;
    float denom = NdotV * (1.0 - k) + k;
    
    return num / max(denom, 0.0001);
}

float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2 = GeometrySchlickGGX(NdotV, roughness);
    float ggx1 = GeometrySchlickGGX(NdotL, roughness);
    
    return ggx1 * ggx2;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 calculatePBR(vec3 albedo, vec3 N, vec3 V, vec3 L, vec3 lightColor, float lightIntensity) {
    vec3 H = normalize(V + L);
    
    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 0.0);
    float HdotV = max(dot(H, V), 0.0);
    
    // Base reflectivity
    vec3 F0 = vec3(0.04);
    F0 = mix(F0, albedo, u_metallic);
    
    // Cook-Torrance BRDF
    float D = DistributionGGX(N, H, u_roughness);
    float G = GeometrySmith(N, V, L, u_roughness);
    vec3 F = fresnelSchlick(HdotV, F0);
    
    vec3 numerator = D * G * F;
    float denominator = 4.0 * NdotV * NdotL + 0.0001;
    vec3 specular = numerator / denominator;
    
    // Energy conservation
    vec3 kS = F;
    vec3 kD = vec3(1.0) - kS;
    kD *= 1.0 - u_metallic;
    
    // Final radiance
    vec3 radiance = lightColor * lightIntensity;
    vec3 Lo = (kD * albedo / PI + specular) * radiance * NdotL;
    
    return Lo;
}

// ============================================
// ATTENUATION
// ============================================
float calculateAttenuation(float distance) {
    float reachScale = 100.0 / max(u_reach, 1.0);
    
    float Kc = 1.0;
    float Kl = 0.05 * reachScale;
    float Kq = 0.001 * reachScale * reachScale;
    
    return 1.0 / (Kc + Kl * distance + Kq * distance * distance);
}

// ============================================
// MAIN
// ============================================
void main() {
    vec4 albedo = texture(u_albedo, v_uv);
    vec3 normalEncoded = sampleSmoothNormal(v_uv);
    vec3 N = normalize(normalEncoded * 2.0 - 1.0);
    float depth = texture(u_depth, v_uv).r;
    
    // Calculate light vector
    vec3 L;
    float attenuation = 1.0;
    
    if (u_directional == 1) {
        L = normalize(u_lightDir);
    } else {
        vec2 pixelPos = v_uv * u_resolution;
        vec2 lightVec2D = u_lightPos - pixelPos;
        float lightZ = u_reach * u_lightHeight;
        
        vec3 lightVec = vec3(lightVec2D, lightZ);
        float dist = length(lightVec);
        L = normalize(lightVec);
        
        attenuation = calculateAttenuation(dist);
    }
    
    // Diffuse
    float NdotL = dot(N, L);
    float diffuse = max(NdotL, 0.0);
    diffuse = pow(diffuse, u_contrast);

    // Spotlight cone
    if (u_isSpotlight == 1) {
        vec2 fragPos = v_uv;
        vec2 lightPosNorm = u_lightPos / u_resolution;
        float distFromLight = length(fragPos - lightPosNorm);
        float coneRadius = tan(u_spotAngle) * 0.5;
        float outerRadius = coneRadius * (1.0 + u_spotSoftness);
        float spotAttenuation = 1.0 - smoothstep(coneRadius * 0.5, outerRadius, distFromLight);
        diffuse *= spotAttenuation;
        attenuation *= spotAttenuation;
    }
    
    // Specular
    float specular = 0.0;
    vec3 pbrResult = vec3(0.0);
    vec3 V = vec3(0.0, 0.0, 1.0);
    
    if (u_usePBR == 1) {
        pbrResult = calculatePBR(albedo.rgb, N, V, L, u_lightColor, u_lightIntensity);
    } else if (u_specularity > 0.0 && NdotL > 0.0) {
        vec3 H = normalize(L + V);
        float NdotH = max(dot(N, H), 0.0);
        specular = pow(NdotH, u_glossiness) * u_specularity;
    }

    // Rim lighting
    float rimLight = 0.0;
    if (u_rimIntensity > 0.0) {
        float NdotV = max(dot(N, V), 0.0);
        float fresnelPower = mix(2.0, 6.0, u_rimWidth);
        rimLight = pow(1.0 - NdotV, fresnelPower) * u_rimIntensity;
    }

    // SSS
    vec3 sssContribution = vec3(0.0);
    if (u_sssIntensity > 0.0) {
        float backLighting = max(0.0, dot(-N, L));
        float wrapLighting = max(0.0, NdotL + 0.3) / 1.3;
        float sss = backLighting * 0.5 + (1.0 - NdotL) * wrapLighting * 0.5;
        sss = pow(sss, 1.5) * u_sssIntensity;
        sssContribution = sss * u_sssColor * albedo.rgb;
    }
    
    // SHADOW - GPU or CPU fallback
    float shadowFactor = 1.0;
    if (u_shadowEnabled == 1) {
        if (u_gpuShadows == 1) {
            shadowFactor = calculateGPUShadow(v_uv, depth);
        } else {
            shadowFactor = texture(u_shadow, v_uv).r;
        }
    }
    
    // SSAO
    float aoFactor = calculateSSAO(v_uv, N, depth);
    
    // Combine lighting
    vec3 litColor;
    float effectiveIntensity = min(u_lightIntensity, 2.0);
    float lightDelta = (diffuse - 0.5) * 2.0;
    lightDelta *= effectiveIntensity * attenuation * shadowFactor;
    
    if (u_usePBR == 1) {
        // PBR path
        vec3 ambientPBR = vec3(u_ambient) * albedo.rgb * aoFactor;
        litColor = ambientPBR + pbrResult * shadowFactor * attenuation;
    } else {
        // Legacy blend modes
        if (u_blendMode == 0) {
            vec3 lightContrib = lightDelta * u_lightColor * 0.3;
            litColor = albedo.rgb + lightContrib;
            if (lightDelta < 0.0) {
                litColor = albedo.rgb * (1.0 + lightDelta * 0.2);
            }
        } else if (u_blendMode == 1) {
            vec3 lightContrib = lightDelta * u_lightColor * 0.5;
            litColor = albedo.rgb + lightContrib;
            float shadowDarken = max(0.0, -lightDelta) * (1.0 - u_ambient);
            litColor = litColor * (1.0 - shadowDarken * 0.4);
        } else if (u_blendMode == 2) {
            vec3 lightContrib = max(0.0, lightDelta) * u_lightColor * 0.5;
            litColor = albedo.rgb + lightContrib;
        } else if (u_blendMode == 3) {
            float brightAmount = max(0.0, lightDelta);
            vec3 screenVal = brightAmount * u_lightColor;
            litColor = 1.0 - (1.0 - albedo.rgb) * (1.0 - screenVal * 0.3);
        } else if (u_blendMode == 4) {
            float darkAmount = (1.0 - diffuse) * effectiveIntensity;
            litColor = albedo.rgb * (1.0 - darkAmount * 0.4 * (1.0 - u_ambient));
        } else {
            vec3 lightContrib = lightDelta * u_lightColor * 0.5;
            litColor = albedo.rgb + lightContrib;
        }
        
        // Apply AO
        litColor *= aoFactor;
        
        // Add specular
        litColor += specular * u_lightColor * attenuation;
    }

    // Add rim lighting
    litColor += rimLight * u_rimColor;

    // Add SSS
    litColor += sssContribution;
    
    // Apply shadow color tint in shadowed areas
    if (shadowFactor < 1.0) {
        float shadowAmount = 1.0 - shadowFactor;
        litColor = mix(litColor, litColor + u_shadowColor * shadowAmount * 0.3, shadowAmount * 0.5);
    }
    
    litColor = clamp(litColor, 0.0, 1.0);
    
    fragColor = vec4(litColor, 1.0);
}
`;

export default DeferredLightingShader;
