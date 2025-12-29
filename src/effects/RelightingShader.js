/**
 * RelightingShader - GPU-accelerated relighting using WebGL
 * Provides 60fps performance for real-time light manipulation
 */

export class RelightingShader {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.initialized = false;

        // Textures
        this.imageTexture = null;
        this.normalTexture = null;
        this.depthTexture = null;
        this.shadowTexture = null;  // Advanced shadow map
        this.materialTexture = null;  // PBR material map

        // Geometry
        this.positionBuffer = null;
        this.texCoordBuffer = null;

        // Uniforms locations
        this.uniforms = {};

        // Max lights supported
        this.maxLights = 8;
    }

    /**
     * Initialize WebGL context and shaders
     */
    init(canvas) {
        this.canvas = canvas;

        // Try to get WebGL2, fall back to WebGL1
        this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

        if (!this.gl) {
            console.warn('WebGL not available, falling back to CPU');
            return false;
        }

        const gl = this.gl;

        // Compile shaders
        const vertexShader = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
        const fragmentShader = this._compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

        if (!vertexShader || !fragmentShader) {
            return false;
        }

        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Shader program failed:', gl.getProgramInfoLog(this.program));
            return false;
        }

        gl.useProgram(this.program);

        // Setup geometry (full-screen quad)
        this._setupGeometry();

        // Get uniform locations
        this._getUniformLocations();

        // Create textures
        this.imageTexture = this._createTexture();
        this.normalTexture = this._createTexture();
        this.depthTexture = this._createTexture();
        this.shadowTexture = this._createTexture();  // Advanced shadow map
        this.materialTexture = this._createTexture();  // PBR material map

        this.initialized = true;
        console.log('🚀 GPU Relighting initialized');
        return true;
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

        // Position buffer (full-screen quad)
        const positions = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        // Texture coordinates
        const texCoords = new Float32Array([
            0, 1,
            1, 1,
            0, 0,
            1, 0
        ]);

        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        // Setup vertex attributes
        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    }

    _getUniformLocations() {
        const gl = this.gl;

        this.uniforms = {
            u_image: gl.getUniformLocation(this.program, 'u_image'),
            u_normals: gl.getUniformLocation(this.program, 'u_normals'),
            u_depth: gl.getUniformLocation(this.program, 'u_depth'),
            u_shadowMap: gl.getUniformLocation(this.program, 'u_shadowMap'),
            u_useShadowMap: gl.getUniformLocation(this.program, 'u_useShadowMap'),
            u_materialMap: gl.getUniformLocation(this.program, 'u_materialMap'),
            u_useMaterialMap: gl.getUniformLocation(this.program, 'u_useMaterialMap'),
            u_lightCount: gl.getUniformLocation(this.program, 'u_lightCount'),
            u_brightness: gl.getUniformLocation(this.program, 'u_brightness'),
            u_shadowStrength: gl.getUniformLocation(this.program, 'u_shadowStrength'),
            u_ambient: gl.getUniformLocation(this.program, 'u_ambient')
        };

        // Light array uniforms
        for (let i = 0; i < this.maxLights; i++) {
            this.uniforms[`u_lights[${i}].position`] = gl.getUniformLocation(this.program, `u_lights[${i}].position`);
            this.uniforms[`u_lights[${i}].color`] = gl.getUniformLocation(this.program, `u_lights[${i}].color`);
            this.uniforms[`u_lights[${i}].intensity`] = gl.getUniformLocation(this.program, `u_lights[${i}].intensity`);
            this.uniforms[`u_lights[${i}].type`] = gl.getUniformLocation(this.program, `u_lights[${i}].type`);
        }
    }

    _createTexture() {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Set texture parameters for non-power-of-two textures
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        return texture;
    }

    /**
     * Upload image data to GPU texture
     */
    uploadImage(imageData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
    }

    /**
     * Upload normal map to GPU texture
     */
    uploadNormals(normalData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, normalData);
    }

    /**
     * Upload depth map to GPU texture
     */
    uploadDepth(depthData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, depthData);
    }

    /**
     * Upload advanced shadow map to GPU texture
     */
    uploadShadowMap(shadowData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, shadowData);
    }

    /**
     * Upload PBR material map to GPU texture
     * R=roughness, G=metallic, B=subsurface, A=emissive
     */
    uploadMaterialMap(materialData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.materialTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, materialData);
    }

    /**
     * Render with current settings
     */
    render(lights, settings) {
        if (!this.initialized) return;

        const gl = this.gl;

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
        gl.uniform1i(this.uniforms.u_image, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
        gl.uniform1i(this.uniforms.u_normals, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.uniform1i(this.uniforms.u_depth, 2);

        // Bind advanced shadow map (optional)
        const useShadowMap = settings.useShadowMap && this.shadowTexture;
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        gl.uniform1i(this.uniforms.u_shadowMap, 3);
        gl.uniform1i(this.uniforms.u_useShadowMap, useShadowMap ? 1 : 0);

        // Bind PBR material map (optional)
        const useMaterialMap = settings.useMaterialMap && this.materialTexture;
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.materialTexture);
        gl.uniform1i(this.uniforms.u_materialMap, 4);
        gl.uniform1i(this.uniforms.u_useMaterialMap, useMaterialMap ? 1 : 0);

        // Set global uniforms
        gl.uniform1f(this.uniforms.u_brightness, settings.brightness || 1.0);
        gl.uniform1f(this.uniforms.u_shadowStrength, settings.shadowStrength || 0.5);
        gl.uniform1f(this.uniforms.u_ambient, settings.ambient || 0.8);
        gl.uniform1i(this.uniforms.u_lightCount, Math.min(lights.length, this.maxLights));

        // Set light uniforms
        for (let i = 0; i < Math.min(lights.length, this.maxLights); i++) {
            const light = lights[i];
            const isDirectional = light.type === 'directional';

            gl.uniform3f(
                this.uniforms[`u_lights[${i}].position`],
                isDirectional ? light.dirX : light.x,
                isDirectional ? light.dirY : light.y,
                light.z || 0.5
            );

            gl.uniform3f(
                this.uniforms[`u_lights[${i}].color`],
                light.color.r / 255,
                light.color.g / 255,
                light.color.b / 255
            );

            gl.uniform1f(this.uniforms[`u_lights[${i}].intensity`], light.intensity);
            gl.uniform1i(this.uniforms[`u_lights[${i}].type`], isDirectional ? 1 : 0);
        }

        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Get rendered image as ImageData
     */
    getImageData() {
        if (!this.initialized) return null;

        const gl = this.gl;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const pixels = new Uint8Array(width * height * 4);

        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Flip Y axis (WebGL has inverted Y)
        const flipped = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            flipped.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow);
        }

        return new ImageData(flipped, width, height);
    }

    /**
     * Cleanup GPU resources
     */
    dispose() {
        if (!this.gl) return;

        const gl = this.gl;

        if (this.imageTexture) gl.deleteTexture(this.imageTexture);
        if (this.normalTexture) gl.deleteTexture(this.normalTexture);
        if (this.depthTexture) gl.deleteTexture(this.depthTexture);
        if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
        if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
        if (this.program) gl.deleteProgram(this.program);

        this.initialized = false;
    }
}

// Vertex Shader
const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

// Fragment Shader - Full PBR with Materials and SSS
const FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_image;
uniform sampler2D u_normals;
uniform sampler2D u_depth;
uniform sampler2D u_shadowMap;
uniform sampler2D u_materialMap;  // R=roughness, G=metallic, B=subsurface, A=emissive
uniform bool u_useShadowMap;
uniform bool u_useMaterialMap;

uniform int u_lightCount;
uniform float u_brightness;
uniform float u_shadowStrength;
uniform float u_ambient;

struct Light {
    vec3 position;
    vec3 color;
    float intensity;
    int type; // 0 = point, 1 = directional
};

uniform Light u_lights[8];

// GGX/Trowbridge-Reitz NDF
float D_GGX(float NdotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * denom * denom + 0.0001);
}

// Schlick-GGX geometry function
float G_SchlickGGX(float NdotV, float roughness) {
    float k = roughness * roughness / 2.0;
    return NdotV / (NdotV * (1.0 - k) + k + 0.0001);
}

// Fresnel-Schlick approximation
vec3 F_Schlick(float VdotH, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
}

// SSS approximation
vec3 subsurfaceScattering(vec3 albedo, vec3 lightDir, vec3 normal, float sss) {
    float wrap = 0.5;
    float NdotL = dot(normal, lightDir);
    float wrappedNdotL = max(0.0, (NdotL + wrap) / (1.0 + wrap));
    float transmit = exp(-2.0 * (1.0 - wrappedNdotL));
    vec3 sssColor = albedo * vec3(1.2, 0.9, 0.7);
    return mix(albedo, sssColor * transmit, sss * 0.5);
}

// ========================================
// TIER 2: Smooth Normal Sampling (3x3)
// ========================================
vec3 getSmoothNormal(sampler2D normalTex, vec2 uv, vec2 texelSize) {
    vec3 n = vec3(0.0);
    
    // Sample 3x3 neighborhood
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec4 sample = texture2D(normalTex, uv + offset);
            n += sample.rgb * 2.0 - 1.0;
        }
    }
    
    return normalize(n / 9.0);
}

void main() {
    // ========================================
    // TEXTURE SAMPLING
    // ========================================
    vec4 originalColor = texture2D(u_image, v_texCoord);
    float depth = texture2D(u_depth, v_texCoord).r;
    
    // Shadow map
    vec4 shadowSample = u_useShadowMap ? texture2D(u_shadowMap, v_texCoord) : vec4(1.0);
    float pcfShadow = shadowSample.r;
    float contactShadow = shadowSample.g;
    float ao = shadowSample.b;
    
    // Material properties
    vec4 materialSample = u_useMaterialMap ? texture2D(u_materialMap, v_texCoord) : vec4(0.5, 0.0, 0.0, 0.0);
    float roughness = max(0.04, materialSample.r);
    float metallic = materialSample.g;
    float subsurface = materialSample.b;
    float emissive = materialSample.a;
    
    // ========================================
    // TIER 2: Smooth Normals (3x3 sampling)
    // ========================================
    vec2 texelSize = vec2(1.0 / 1024.0);  // Approximate texel size
    vec3 normal = getSmoothNormal(u_normals, v_texCoord, texelSize);
    
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float NdotV = max(0.001, dot(normal, viewDir));
    
    // ========================================
    // TIER 1: ALBEDO (Intrinsic Reflectance)
    // ========================================
    // The albedo is the "true color" of the surface without lighting
    // In a full system, this would come from intrinsic decomposition
    // For now, we approximate: albedo ≈ originalColor (assumes neutral original lighting)
    vec3 albedo = originalColor.rgb;
    
    // Base reflectivity (F0) - metals use albedo, dielectrics use 0.04
    vec3 F0 = mix(vec3(0.04), albedo, metallic);
    
    // Fresnel for rim lighting
    float fresnel = pow(1.0 - NdotV, 4.0) * 0.3;
    
    // ========================================
    // TIER 1: VERY LOW AMBIENT (0.15)
    // ========================================
    // This creates dark shadows for contrast
    float ambientStrength = 0.15;  // Was 0.8, now 0.15!
    vec3 ambientLight = albedo * ambientStrength * ao;
    
    // ========================================
    // ACCUMULATE LIGHT (Multiplicative PBR)
    // ========================================
    vec3 totalDiffuse = vec3(0.0);
    vec3 totalSpecular = vec3(0.0);
    
    for (int i = 0; i < 8; i++) {
        if (i >= u_lightCount) break;
        
        Light light = u_lights[i];
        vec3 lightDir;
        float attenuation = 1.0;
        
        if (light.type == 1) {
            // Directional light
            lightDir = normalize(vec3(light.position.xy, 0.5));
        } else {
            // Point light with realistic falloff
            vec3 toLight = vec3(light.position.xy - v_texCoord, light.position.z);
            float dist = length(toLight);
            lightDir = normalize(toLight);
            // Inverse square falloff (physically accurate)
            attenuation = 1.0 / (1.0 + dist * 3.0 + dist * dist * 8.0);
        }
        
        // Core lighting calculations
        float NdotL = max(0.0, dot(normal, lightDir));
        vec3 halfDir = normalize(lightDir + viewDir);
        float NdotH = max(0.0, dot(normal, halfDir));
        float VdotH = max(0.0, dot(viewDir, halfDir));
        
        // ========================================
        // SHADOW CALCULATION
        // ========================================
        float shadow = 1.0;
        
        // Normal-based shadow (facing away = dark)
        float normalShadow = smoothstep(-0.1, 0.3, NdotL);
        
        // Depth-based shadow (further objects receive less direct light)
        float depthShadow = 1.0 - (1.0 - depth) * u_shadowStrength * 0.8;
        
        // PCF + Contact shadows from shadow map
        if (u_useShadowMap) {
            shadow = pcfShadow * contactShadow;
            shadow = mix(1.0, shadow, u_shadowStrength);
        }
        
        // Combine all shadow factors
        shadow *= normalShadow * depthShadow;
        
        // ========================================
        // PBR BRDF (Cook-Torrance)
        // ========================================
        // Specular
        float D = D_GGX(NdotH, roughness);
        float G = G_SchlickGGX(NdotV, roughness) * G_SchlickGGX(NdotL, roughness);
        vec3 F = F_Schlick(VdotH, F0);
        vec3 specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.001);
        
        // Diffuse (Lambert with energy conservation)
        vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);
        vec3 diffuse = kD * albedo / 3.14159265;
        
        // SSS for skin/organic
        if (subsurface > 0.0) {
            diffuse = subsurfaceScattering(diffuse, lightDir, normal, subsurface);
        }
        
        // ========================================
        // LIGHT POWER (reduced from 4x to 2x to prevent over-brightness)
        // ========================================
        float lightPower = 2.0;  // Was 4.0, now 2.0!
        
        vec3 lightContrib = light.color * light.intensity * attenuation * shadow * lightPower;
        totalDiffuse += diffuse * NdotL * lightContrib;
        totalSpecular += specular * NdotL * lightContrib;
    }
    
    // ========================================
    // MULTIPLICATIVE PBR BLEND
    // ========================================
    // Final = Ambient + (Albedo * Diffuse) + Specular
    vec3 finalColor = ambientLight + totalDiffuse + totalSpecular;
    
    // Add rim lighting (reduced)
    finalColor += albedo * fresnel * ao * 0.2;
    
    // Add emissive
    finalColor += albedo * emissive;
    
    // ========================================
    // SOFT TONE MAPPING x/(x+0.8) - preserves original better
    // ========================================
    finalColor = finalColor / (finalColor + vec3(0.8));
    
    // Minimal gamma correction
    finalColor = pow(finalColor, vec3(0.98));
    
    // Apply brightness control
    finalColor *= u_brightness;
    
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), originalColor.a);
}
`;
