/**
 * LightingSystem.js - Clean Lighting Engine
 * 
 * Stage 3 of Relighting 2.0
 * 
 * Features:
 * - Simple light management
 * - GPU-accelerated rendering via WebGL
 * - Real-time shadow calculation
 * - Works with pre-built 3D mesh
 * 
 * Usage:
 *   const lighting = new LightingSystem();
 *   lighting.init(canvas);
 *   lighting.setDepth(depthMap);
 *   lighting.setImage(imageData);
 *   lighting.addLight(0.5, 0.3, '#ffffff', 1.0);
 *   lighting.render();
 */

export class LightingSystem {
    constructor() {
        // Canvas & WebGL
        this.canvas = null;
        this.gl = null;
        this.program = null;

        // Textures
        this.imageTexture = null;
        this.depthTexture = null;
        this.normalTexture = null;

        // Lights (max 4 for performance)
        this.lights = [];
        this.maxLights = 4;

        // Settings
        this.settings = {
            ambient: 0.25,
            shadowStrength: 0.6,
            shadowSoftness: 0.5,
            brightness: 1.0,
            lightHeight: 0.5,
            specularIntensity: 0.3,
            ssaoStrength: 0.4
        };

        // Buffers
        this.positionBuffer = null;
        this.texCoordBuffer = null;

        // State
        this.isInitialized = false;
        this.needsRender = false;
    }

    /**
     * Initialize WebGL context
     */
    init(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl', {
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });

        if (!this.gl) {
            throw new Error('WebGL not supported');
        }

        this._initShaders();
        this._initBuffers();

        this.isInitialized = true;
        console.log('✅ LightingSystem initialized');
    }

    /**
     * Initialize shaders
     */
    _initShaders() {
        const gl = this.gl;

        // Compile shaders
        const vs = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
        const fs = this._compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error('Shader link failed: ' + gl.getProgramInfoLog(this.program));
        }

        // Get uniform locations
        this.uniforms = {
            u_image: gl.getUniformLocation(this.program, 'u_image'),
            u_depth: gl.getUniformLocation(this.program, 'u_depth'),
            u_normal: gl.getUniformLocation(this.program, 'u_normal'),
            u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            u_ambient: gl.getUniformLocation(this.program, 'u_ambient'),
            u_shadowStrength: gl.getUniformLocation(this.program, 'u_shadowStrength'),
            u_shadowSoftness: gl.getUniformLocation(this.program, 'u_shadowSoftness'),
            u_brightness: gl.getUniformLocation(this.program, 'u_brightness'),
            u_lightHeight: gl.getUniformLocation(this.program, 'u_lightHeight'),
            u_specularIntensity: gl.getUniformLocation(this.program, 'u_specularIntensity'),
            u_ssaoStrength: gl.getUniformLocation(this.program, 'u_ssaoStrength'),
            u_numLights: gl.getUniformLocation(this.program, 'u_numLights'),
            // Light arrays
            u_lightPos: gl.getUniformLocation(this.program, 'u_lightPos'),
            u_lightColor: gl.getUniformLocation(this.program, 'u_lightColor'),
            u_lightIntensity: gl.getUniformLocation(this.program, 'u_lightIntensity')
        };

        // Get attribute locations
        this.attributes = {
            a_position: gl.getAttribLocation(this.program, 'a_position'),
            a_texCoord: gl.getAttribLocation(this.program, 'a_texCoord')
        };
    }

    /**
     * Compile a shader
     */
    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader compile failed: ' + error);
        }

        return shader;
    }

    /**
     * Initialize geometry buffers
     */
    _initBuffers() {
        const gl = this.gl;

        // Fullscreen quad
        const positions = new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]);

        const texCoords = new Float32Array([
            0, 1, 1, 1, 0, 0,
            0, 0, 1, 1, 1, 0
        ]);

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    }

    /**
     * Upload image texture
     */
    setImage(imageData) {
        const gl = this.gl;

        if (this.imageTexture) {
            gl.deleteTexture(this.imageTexture);
        }

        this.imageTexture = this._createTexture(imageData);
        this.needsRender = true;
    }

    /**
     * Upload depth map
     */
    setDepth(depthData) {
        const gl = this.gl;

        if (this.depthTexture) {
            gl.deleteTexture(this.depthTexture);
        }

        this.depthTexture = this._createTexture(depthData);
        this.needsRender = true;
    }

    /**
     * Upload normal map
     */
    setNormals(normalData) {
        const gl = this.gl;

        if (this.normalTexture) {
            gl.deleteTexture(this.normalTexture);
        }

        this.normalTexture = this._createTexture(normalData);
        this.needsRender = true;
    }

    /**
     * Create texture from canvas or ImageData
     */
    _createTexture(source) {
        const gl = this.gl;

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Handle different source types
        if (source instanceof HTMLCanvasElement) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        } else if (source.canvas) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.canvas);
        } else if (source.data) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(source.data));
        }

        // Set filtering
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        return texture;
    }

    /**
     * Add a light
     * @param {number} x - X position (0-1)
     * @param {number} y - Y position (0-1)
     * @param {string} color - Hex color
     * @param {number} intensity - Intensity (0-2)
     * @returns {number} Light ID
     */
    addLight(x, y, color = '#ffffff', intensity = 1.0) {
        if (this.lights.length >= this.maxLights) {
            console.warn(`Max ${this.maxLights} lights reached`);
            return -1;
        }

        const id = Date.now();
        const rgb = this._hexToRgb(color);

        this.lights.push({
            id,
            x, y,
            color,
            r: rgb.r / 255,
            g: rgb.g / 255,
            b: rgb.b / 255,
            intensity
        });

        this.needsRender = true;
        return id;
    }

    /**
     * Remove a light
     */
    removeLight(id) {
        const index = this.lights.findIndex(l => l.id === id);
        if (index !== -1) {
            this.lights.splice(index, 1);
            this.needsRender = true;
        }
    }

    /**
     * Move a light
     */
    moveLight(id, x, y) {
        const light = this.lights.find(l => l.id === id);
        if (light) {
            light.x = x;
            light.y = y;
            this.needsRender = true;
        }
    }

    /**
     * Update light properties
     */
    updateLight(id, props) {
        const light = this.lights.find(l => l.id === id);
        if (light) {
            if (props.x !== undefined) light.x = props.x;
            if (props.y !== undefined) light.y = props.y;
            if (props.intensity !== undefined) light.intensity = props.intensity;
            if (props.color !== undefined) {
                light.color = props.color;
                const rgb = this._hexToRgb(props.color);
                light.r = rgb.r / 255;
                light.g = rgb.g / 255;
                light.b = rgb.b / 255;
            }
            this.needsRender = true;
        }
    }

    /**
     * Clear all lights
     */
    clearLights() {
        this.lights = [];
        this.needsRender = true;
    }

    /**
     * Set ambient light level
     */
    setAmbient(value) {
        this.settings.ambient = Math.max(0, Math.min(1, value));
        this.needsRender = true;
    }

    /**
     * Set shadow strength
     */
    setShadowStrength(value) {
        this.settings.shadowStrength = Math.max(0, Math.min(1, value));
        this.needsRender = true;
    }

    /**
     * Set shadow softness
     */
    setShadowSoftness(value) {
        this.settings.shadowSoftness = Math.max(0, Math.min(1, value));
        this.needsRender = true;
    }

    /**
     * Set brightness
     */
    setBrightness(value) {
        this.settings.brightness = Math.max(0.5, Math.min(2, value));
        this.needsRender = true;
    }

    /**
     * Set light height (Z position)
     */
    setLightHeight(value) {
        this.settings.lightHeight = Math.max(0.1, Math.min(1.0, value));
        this.needsRender = true;
    }

    /**
     * Set specular intensity
     */
    setSpecularIntensity(value) {
        this.settings.specularIntensity = Math.max(0, Math.min(1, value));
        this.needsRender = true;
    }

    /**
     * Set SSAO strength
     */
    setSSAOStrength(value) {
        this.settings.ssaoStrength = Math.max(0, Math.min(1, value));
        this.needsRender = true;
    }

    /**
     * Render the scene
     */
    render() {
        if (!this.isInitialized || !this.imageTexture) return null;

        const gl = this.gl;

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
        gl.uniform1i(this.uniforms.u_image, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture || this.imageTexture);
        gl.uniform1i(this.uniforms.u_depth, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.normalTexture || this.imageTexture);
        gl.uniform1i(this.uniforms.u_normal, 2);

        // Pass uniforms
        gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.u_ambient, this.settings.ambient);
        gl.uniform1f(this.uniforms.u_shadowStrength, this.settings.shadowStrength);
        gl.uniform1f(this.uniforms.u_shadowSoftness, this.settings.shadowSoftness);
        gl.uniform1f(this.uniforms.u_brightness, this.settings.brightness);
        gl.uniform1f(this.uniforms.u_lightHeight, this.settings.lightHeight);
        gl.uniform1f(this.uniforms.u_specularIntensity, this.settings.specularIntensity);
        gl.uniform1f(this.uniforms.u_ssaoStrength, this.settings.ssaoStrength);
        gl.uniform1i(this.uniforms.u_numLights, this.lights.length);

        // Pass light data as arrays
        const lightPos = new Float32Array(this.maxLights * 2);
        const lightColor = new Float32Array(this.maxLights * 3);
        const lightIntensity = new Float32Array(this.maxLights);

        for (let i = 0; i < this.lights.length; i++) {
            const light = this.lights[i];
            lightPos[i * 2] = light.x;
            lightPos[i * 2 + 1] = light.y;
            lightColor[i * 3] = light.r;
            lightColor[i * 3 + 1] = light.g;
            lightColor[i * 3 + 2] = light.b;
            lightIntensity[i] = light.intensity;
        }

        gl.uniform2fv(this.uniforms.u_lightPos, lightPos);
        gl.uniform3fv(this.uniforms.u_lightColor, lightColor);
        gl.uniform1fv(this.uniforms.u_lightIntensity, lightIntensity);

        // Bind buffers and draw
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.attributes.a_position);
        gl.vertexAttribPointer(this.attributes.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(this.attributes.a_texCoord);
        gl.vertexAttribPointer(this.attributes.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        this.needsRender = false;
        return this.canvas;
    }

    /**
     * Convert hex to RGB
     */
    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 255, b: 255 };
    }

    /**
     * Dispose resources
     */
    dispose() {
        const gl = this.gl;

        if (this.imageTexture) gl.deleteTexture(this.imageTexture);
        if (this.depthTexture) gl.deleteTexture(this.depthTexture);
        if (this.normalTexture) gl.deleteTexture(this.normalTexture);
        if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
        if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
        if (this.program) gl.deleteProgram(this.program);

        this.lights = [];
        this.isInitialized = false;
    }
}

// ============================================
// VERTEX SHADER
// ============================================
const VERTEX_SHADER = `
precision highp float;

attribute vec2 a_position;
attribute vec2 a_texCoord;

varying vec2 v_uv;

void main() {
    v_uv = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// ============================================
// FRAGMENT SHADER - Advanced lighting with SSAO, soft shadows, specular
// ============================================
const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_image;
uniform sampler2D u_depth;
uniform sampler2D u_normal;
uniform vec2 u_resolution;

uniform float u_ambient;
uniform float u_shadowStrength;
uniform float u_shadowSoftness;
uniform float u_brightness;
uniform float u_lightHeight;
uniform float u_specularIntensity;
uniform float u_ssaoStrength;

// Lights (max 4)
uniform int u_numLights;
uniform vec2 u_lightPos[4];
uniform vec3 u_lightColor[4];
uniform float u_lightIntensity[4];

varying vec2 v_uv;

// ============================================
// SSAO - Screen Space Ambient Occlusion
// ============================================
float calculateSSAO(vec2 uv, float depth) {
    if (u_ssaoStrength < 0.01) return 1.0;
    
    vec2 texel = 1.0 / u_resolution;
    float ao = 0.0;
    
    // 8-sample hemisphere around fragment
    const int SAMPLES = 8;
    vec2 offsets[8];
    offsets[0] = vec2(1.0, 0.0);
    offsets[1] = vec2(-1.0, 0.0);
    offsets[2] = vec2(0.0, 1.0);
    offsets[3] = vec2(0.0, -1.0);
    offsets[4] = vec2(0.707, 0.707);
    offsets[5] = vec2(-0.707, 0.707);
    offsets[6] = vec2(0.707, -0.707);
    offsets[7] = vec2(-0.707, -0.707);
    
    float radius = 8.0; // Sample radius in pixels
    
    for (int i = 0; i < 8; i++) {
        vec2 sampleUV = uv + offsets[i] * texel * radius;
        float sampleDepth = texture2D(u_depth, sampleUV).r;
        
        // Occlusion if nearby sample is in front of us
        float depthDiff = depth - sampleDepth;
        ao += smoothstep(0.0, 0.05, depthDiff);
    }
    
    ao /= float(SAMPLES);
    return 1.0 - ao * u_ssaoStrength;
}

// ============================================
// Sample normal with 9-tap Gaussian smoothing
// ============================================
vec3 sampleNormalSmooth(vec2 uv) {
    vec2 texel = 2.0 / u_resolution;
    
    vec3 n00 = texture2D(u_normal, uv + vec2(-texel.x, -texel.y)).rgb;
    vec3 n10 = texture2D(u_normal, uv + vec2(0.0, -texel.y)).rgb;
    vec3 n20 = texture2D(u_normal, uv + vec2(texel.x, -texel.y)).rgb;
    vec3 n01 = texture2D(u_normal, uv + vec2(-texel.x, 0.0)).rgb;
    vec3 n11 = texture2D(u_normal, uv).rgb;
    vec3 n21 = texture2D(u_normal, uv + vec2(texel.x, 0.0)).rgb;
    vec3 n02 = texture2D(u_normal, uv + vec2(-texel.x, texel.y)).rgb;
    vec3 n12 = texture2D(u_normal, uv + vec2(0.0, texel.y)).rgb;
    vec3 n22 = texture2D(u_normal, uv + vec2(texel.x, texel.y)).rgb;
    
    vec3 avgNormal = (
        n00 * 1.0 + n10 * 2.0 + n20 * 1.0 +
        n01 * 2.0 + n11 * 4.0 + n21 * 2.0 +
        n02 * 1.0 + n12 * 2.0 + n22 * 1.0
    ) / 16.0;
    
    return normalize(avgNormal * 2.0 - 1.0);
}

// ============================================
// Pseudo-random hash for dithering (breaks up banding)
// ============================================
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// ============================================
// Sample depth with 9-tap Gaussian blur (radius 3px) for smooth shadows
// ============================================
float sampleDepthSmooth(vec2 uv) {
    vec2 texel = 3.0 / u_resolution; // 3 pixel radius
    
    // 9-tap Gaussian kernel
    float d = texture2D(u_depth, uv).r * 0.25;
    d += texture2D(u_depth, uv + vec2(texel.x, 0.0)).r * 0.125;
    d += texture2D(u_depth, uv - vec2(texel.x, 0.0)).r * 0.125;
    d += texture2D(u_depth, uv + vec2(0.0, texel.y)).r * 0.125;
    d += texture2D(u_depth, uv - vec2(0.0, texel.y)).r * 0.125;
    d += texture2D(u_depth, uv + vec2(texel.x, texel.y)).r * 0.0625;
    d += texture2D(u_depth, uv - vec2(texel.x, texel.y)).r * 0.0625;
    d += texture2D(u_depth, uv + vec2(texel.x, -texel.y)).r * 0.0625;
    d += texture2D(u_depth, uv - vec2(texel.x, -texel.y)).r * 0.0625;
    return d;
}

// ============================================
// Soft Shadows - Dithered ray marching with gradient accumulation
// ============================================
float calculateSoftShadow(vec2 uv, vec2 lightPos, float lightHeight) {
    if (u_shadowStrength < 0.01) return 1.0;
    
    float ourDepth = sampleDepthSmooth(uv);
    vec2 toLight = lightPos - uv;
    vec2 dir = normalize(toLight);
    float dist = length(toLight);
    
    // Dither offset to break up banding (varies per pixel)
    float dither = hash(uv * u_resolution) * 0.5;
    
    // Accumulate shadow gradually instead of binary check
    float shadowAccum = 0.0;
    float totalWeight = 0.0;
    
    // More steps for smoother shadows (48 steps)
    const int MAX_STEPS = 48;
    float maxDist = min(dist, 0.5);
    
    for (int i = 0; i < MAX_STEPS; i++) {
        // Variable step size with dither offset
        float t = (float(i) + dither) / float(MAX_STEPS);
        if (t > 1.0) break;
        
        // Quadratic stepping - denser near origin, sparser far away
        float stepT = t * t;
        vec2 samplePos = uv + dir * stepT * maxDist;
        
        if (samplePos.x < 0.0 || samplePos.x > 1.0 || samplePos.y < 0.0 || samplePos.y > 1.0) break;
        
        // Sample with smooth depth
        float sampleDepth = sampleDepthSmooth(samplePos);
        
        // Height-aware expected depth along ray
        float expectedDepth = mix(ourDepth, 1.0, stepT * lightHeight);
        
        // Soft depth comparison with gradient (no sharp threshold)
        float depthDiff = expectedDepth - sampleDepth;
        float softBlock = smoothstep(0.0, 0.03 + u_shadowSoftness * 0.05, depthDiff);
        
        // Weight by distance from fragment (closer samples matter more)
        float weight = 1.0 - stepT;
        weight *= weight; // Quadratic falloff
        
        shadowAccum += softBlock * weight;
        totalWeight += weight;
    }
    
    // Normalize and apply softness
    float shadow = shadowAccum / max(totalWeight, 0.001);
    shadow = smoothstep(0.0, 0.5 + u_shadowSoftness * 0.5, shadow);
    
    // Invert (1 = fully lit, 0 = fully shadowed) and blend with strength
    return mix(1.0, 1.0 - shadow, u_shadowStrength);
}

// ============================================
// MAIN
// ============================================
void main() {
    vec4 color = texture2D(u_image, v_uv);
    vec3 normal = sampleNormalSmooth(v_uv);
    float depth = texture2D(u_depth, v_uv).r;
    
    // Calculate SSAO
    float ao = calculateSSAO(v_uv, depth);
    
    // Start with ambient light modulated by AO
    vec3 lighting = vec3(u_ambient) * ao;
    
    // Accumulate specular separately
    vec3 specularTotal = vec3(0.0);
    
    // View direction (camera looking at screen)
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    
    // Process each light
    for (int i = 0; i < 4; i++) {
        if (i >= u_numLights) break;
        
        vec2 lightPos = u_lightPos[i];
        vec3 lightColor = u_lightColor[i];
        float intensity = u_lightIntensity[i];
        
        // 3D light direction (using lightHeight for Z)
        vec2 toLight = lightPos - v_uv;
        float dist = length(toLight);
        vec3 lightDir = normalize(vec3(toLight * 2.0, u_lightHeight));
        
        // Diffuse lighting (Lambertian)
        float ndotl = max(dot(normal, lightDir), 0.0);
        ndotl = smoothstep(0.0, 1.0, ndotl); // Softened
        
        // Specular lighting (Blinn-Phong)
        vec3 halfDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
        
        // Distance falloff (inverse square with bias)
        float falloff = 1.0 / (1.0 + dist * dist * 3.0);
        
        // Soft shadow with height-aware ray marching
        float shadow = calculateSoftShadow(v_uv, lightPos, u_lightHeight);
        
        // Combine diffuse
        lighting += lightColor * intensity * ndotl * falloff * shadow;
        
        // Accumulate specular (not affected by AO)
        specularTotal += lightColor * spec * intensity * falloff * shadow * u_specularIntensity;
    }
    
    // Final color composition
    vec3 result = color.rgb * lighting * u_brightness;
    
    // Add specular highlights on top
    result += specularTotal;
    
    // Clamp
    result = clamp(result, 0.0, 1.0);
    
    gl_FragColor = vec4(result, color.a);
}
`;

// Singleton
export const lightingSystem = new LightingSystem();
