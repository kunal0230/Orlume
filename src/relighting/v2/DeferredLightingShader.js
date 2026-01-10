/**
 * DeferredLightingShader.js - WebGL2 Deferred Shading Pipeline v5
 * 
 * DaVinci Resolve-Quality Implementation:
 * - Tunable attenuation: 1/(Kc + Kl*d + Kq*d²)
 * - Contrast/Gamma control for terminator sharpness
 * - Overlay blend mode (preserves texture)
 * - Point light support with proper distance falloff
 * - Smooth normal sampling for artifact-free lighting
 */

export class DeferredLightingShader {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;

        this.albedoTexture = null;
        this.normalTexture = null;
        this.depthTexture = null;
        this.shadowTexture = null;  // Shadow map texture

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

        this.isReady = true;
        return true;
    }

    render(params) {
        const { gl } = this;
        const {
            albedo,
            normalMap,
            depthMap,
            shadowMap,  // NEW: Shadow map from ShadowCaster
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

        // Upload shadow map if provided
        if (shadowMap) {
            this._uploadTexture(this.shadowTexture, shadowMap, 3, 'u_shadow');
            gl.uniform1i(this.uniforms.u_shadowEnabled, 1);
        } else {
            gl.uniform1i(this.uniforms.u_shadowEnabled, 0);
        }

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

        // New DaVinci-style parameters
        gl.uniform1f(this.uniforms.u_reach, light.reach || 200.0);
        gl.uniform1f(this.uniforms.u_contrast, light.contrast || 1.0);
        gl.uniform1i(this.uniforms.u_directional, light.directional ? 1 : 0);
        gl.uniform1i(this.uniforms.u_blendMode, light.blendMode || 0);

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
            'u_albedo', 'u_normals', 'u_depth', 'u_shadow', 'u_resolution',
            'u_lightPos', 'u_lightDir', 'u_lightColor', 'u_lightIntensity',
            'u_ambient', 'u_specularity', 'u_glossiness',
            'u_reach', 'u_contrast', 'u_directional', 'u_blendMode',
            'u_rimIntensity', 'u_rimColor', 'u_rimWidth',
            'u_shadowEnabled',
            'u_isSpotlight', 'u_spotAngle', 'u_spotSoftness',
            'u_sssIntensity', 'u_sssColor' // Subsurface scattering
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

        [this.albedoTexture, this.normalTexture, this.depthTexture].forEach(tex => {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        });
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

// DaVinci Resolve-Quality Fragment Shader
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_albedo;
uniform sampler2D u_normals;
uniform sampler2D u_depth;
uniform sampler2D u_shadow;   // Shadow map from ShadowCaster

uniform vec2 u_resolution;
uniform vec2 u_lightPos;      // Screen space position (for point light)
uniform vec3 u_lightDir;      // Direction (for directional light)
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform float u_ambient;
uniform float u_specularity;
uniform float u_glossiness;
uniform float u_reach;        // Controls falloff distance
uniform float u_contrast;     // Terminator sharpness (gamma)
uniform int u_directional;    // 1 = directional, 0 = point light
uniform int u_blendMode;      // 0=softLight, 1=normal, 2=additive, 3=screen, 4=multiply

// Rim lighting (backlight/edge glow)
uniform float u_rimIntensity;
uniform vec3 u_rimColor;
uniform float u_rimWidth;

// Shadow support
uniform int u_shadowEnabled;

// Spotlight
uniform int u_isSpotlight;
uniform float u_spotAngle;
uniform float u_spotSoftness;

// Subsurface scattering
uniform float u_sssIntensity; // 0 = off, 1 = full translucency
uniform vec3 u_sssColor;      // Warm skin-like color

// ============================================
// OVERLAY BLEND MODE (DaVinci-style)
// Preserves texture while applying lighting
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

// Soft light blend (even more subtle)
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
// Heavily smoothed to avoid creating visible texture
// We only need broad lighting direction, not fine detail
// ============================================
vec3 sampleSmoothNormal(vec2 uv) {
    vec2 texelSize = 1.0 / u_resolution;
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    
    // 5x5 Gaussian-weighted sample for heavy smoothing
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 offset = vec2(float(x), float(y)) * texelSize * 2.0;  // 2x spacing for broader blur
            float dist = length(vec2(x, y));
            float w = exp(-dist * dist / 4.0);  // Gaussian falloff
            sum += texture(u_normals, uv + offset).rgb * w;
            weight += w;
        }
    }
    
    vec3 smoothNormal = sum / weight;
    
    // Blend towards flat normal to reduce texture artifacts
    // But keep enough detail for proper lighting direction (face curvature, etc.)
    vec3 flatNormal = vec3(0.5, 0.5, 1.0);
    float flatBlend = 0.25;  // 25% flat, 75% detail - preserves lighting direction
    
    return mix(smoothNormal, flatNormal, flatBlend);
}

// ============================================
// TUNABLE ATTENUATION (DaVinci-style)
// 1 / (Kc + Kl*d + Kq*d²)
// ============================================
float calculateAttenuation(float distance) {
    // Scale coefficients based on u_reach
    float reachScale = 100.0 / max(u_reach, 1.0);
    
    float Kc = 1.0;                    // Constant
    float Kl = 0.05 * reachScale;      // Linear
    float Kq = 0.001 * reachScale * reachScale;  // Quadratic
    
    return 1.0 / (Kc + Kl * distance + Kq * distance * distance);
}

void main() {
    // === SAMPLE TEXTURES ===
    vec4 albedo = texture(u_albedo, v_uv);
    
    // Use smoothed normals to avoid texture artifacts
    vec3 normalEncoded = sampleSmoothNormal(v_uv);
    vec3 N = normalize(normalEncoded * 2.0 - 1.0);
    
    // === CALCULATE LIGHT VECTOR ===
    vec3 L;
    float attenuation = 1.0;
    
    if (u_directional == 1) {
        // Directional light: constant direction
        L = normalize(u_lightDir);
    } else {
        // Point light: calculate per-pixel direction
        vec2 pixelPos = v_uv * u_resolution;
        vec2 lightVec2D = u_lightPos - pixelPos;
        float lightZ = u_reach * 0.5;  // Light height based on reach
        
        vec3 lightVec = vec3(lightVec2D, lightZ);
        float dist = length(lightVec);
        L = normalize(lightVec);
        
        // Apply tunable attenuation
        attenuation = calculateAttenuation(dist);
    }
    
    // === LAMBERTIAN DIFFUSE ===
    float NdotL = dot(N, L);
    float diffuse = max(NdotL, 0.0);
    
    // Apply contrast/gamma (terminator sharpness)
    // Higher contrast = sharper transition from lit to shadow
    diffuse = pow(diffuse, u_contrast);

    // === SPOTLIGHT CONE ATTENUATION ===
    if (u_isSpotlight == 1) {
        // Calculate distance from light center in screen space (normalized 0-1)
        vec2 fragPos = v_uv;
        vec2 lightPosNorm = u_lightPos / u_resolution;
        
        // Distance from light center (0 = at light, 1 = at edge of screen)
        float distFromLight = length(fragPos - lightPosNorm);
        
        // Convert cone angle to normalized screen distance
        // Larger angle = larger cone = more screen coverage
        float coneRadius = tan(u_spotAngle) * 0.5;  // Scale to reasonable screen space
        float outerRadius = coneRadius * (1.0 + u_spotSoftness);
        
        // Smooth falloff from center to edge of cone
        float spotAttenuation = 1.0 - smoothstep(coneRadius * 0.5, outerRadius, distFromLight);
        diffuse *= spotAttenuation;
        attenuation *= spotAttenuation;
    }
    
    // === SPECULAR (Blinn-Phong) ===
    float specular = 0.0;
    if (u_specularity > 0.0 && NdotL > 0.0) {
        vec3 V = vec3(0.0, 0.0, 1.0);  // View direction (camera)
        vec3 H = normalize(L + V);     // Half vector
        float NdotH = max(dot(N, H), 0.0);
        specular = pow(NdotH, u_glossiness) * u_specularity;
    }

    // === RIM LIGHTING (Fresnel-based backlight) ===
    float rimLight = 0.0;
    if (u_rimIntensity > 0.0) {
        vec3 V = vec3(0.0, 0.0, 1.0);  // View direction
        float NdotV = max(dot(N, V), 0.0);
        // Fresnel effect: stronger at edges where normal is perpendicular to view
        float fresnelPower = mix(2.0, 6.0, u_rimWidth);
        rimLight = pow(1.0 - NdotV, fresnelPower) * u_rimIntensity;
    }

    // === SUBSURFACE SCATTERING (Skin Translucency) ===
    vec3 sssContribution = vec3(0.0);
    if (u_sssIntensity > 0.0) {
        // SSS occurs when light passes through thin materials
        // Approximation: light bleeding through from behind the surface
        float backLighting = max(0.0, dot(-N, L));  // Light from opposite side
        float wrapLighting = max(0.0, NdotL + 0.3) / 1.3;  // Wrapped diffuse (softer terminator)
        
        // Combine back lighting and wrap for translucency
        float sss = backLighting * 0.5 + (1.0 - NdotL) * wrapLighting * 0.5;
        sss = pow(sss, 1.5) * u_sssIntensity;
        
        // Apply warm skin-like color
        sssContribution = sss * u_sssColor * albedo.rgb;
    }
    
    // === COMBINE LIGHTING ===
    // Note: Shadow is handled in the additive lighting section below
    
    // === APPLY BLEND MODE ===
    vec3 litColor;
    
    // Clamp intensity contribution to prevent artifacts
    float effectiveIntensity = min(u_lightIntensity, 2.0);
    
    // === ADDITIVE LIGHTING MODEL ===
    // Preserve original brightness, add/subtract light based on angle
    // diffuse ranges from 0 (shadow) to 1 (fully lit)
    // We want 0.5 to be neutral (no change), <0.5 darken, >0.5 brighten
    
    float lightDelta = (diffuse - 0.5) * 2.0;  // -1 to +1 range
    lightDelta *= effectiveIntensity * attenuation;
    
    // Apply shadow factor
    float shadowFactor = 1.0;
    if (u_shadowEnabled == 1) {
        shadowFactor = texture(u_shadow, v_uv).r;
        lightDelta *= shadowFactor;
    }
    
    if (u_blendMode == 0) {
        // Soft Light (Natural) - very subtle relighting
        vec3 lightContrib = lightDelta * u_lightColor * 0.3;
        litColor = albedo.rgb + lightContrib;
        // Darken shadows slightly
        if (lightDelta < 0.0) {
            litColor = albedo.rgb * (1.0 + lightDelta * 0.2);
        }
        
    } else if (u_blendMode == 1) {
        // Normal (Replace) - full additive lighting
        vec3 lightContrib = lightDelta * u_lightColor * 0.5;
        litColor = albedo.rgb + lightContrib;
        // Apply ambient-controlled shadow darkening
        float shadowDarken = max(0.0, -lightDelta) * (1.0 - u_ambient);
        litColor = litColor * (1.0 - shadowDarken * 0.4);
        
    } else if (u_blendMode == 2) {
        // Additive (Bright) - only brighten, never darken
        vec3 lightContrib = max(0.0, lightDelta) * u_lightColor * 0.5;
        litColor = albedo.rgb + lightContrib;
        
    } else if (u_blendMode == 3) {
        // Screen (Lighter) - screen blend for bright areas
        float brightAmount = max(0.0, lightDelta);
        vec3 screenVal = brightAmount * u_lightColor;
        litColor = 1.0 - (1.0 - albedo.rgb) * (1.0 - screenVal * 0.3);
        
    } else if (u_blendMode == 4) {
        // Multiply (Darker) - darken shadow areas more
        float darkAmount = (1.0 - diffuse) * effectiveIntensity;
        litColor = albedo.rgb * (1.0 - darkAmount * 0.4 * (1.0 - u_ambient));
        
    } else {
        vec3 lightContrib = lightDelta * u_lightColor * 0.5;
        litColor = albedo.rgb + lightContrib;
    }
    
    // Add specular on top
    litColor += specular * u_lightColor * attenuation;

    // Add rim lighting (backlight glow)
    litColor += rimLight * u_rimColor;

    // Add SSS contribution (skin translucency)
    litColor += sssContribution;
    
    // Clamp to valid range
    litColor = clamp(litColor, 0.0, 1.0);
    
    fragColor = vec4(litColor, 1.0);
}
`;

export default DeferredLightingShader;
