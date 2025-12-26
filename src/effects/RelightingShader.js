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

// Fragment Shader - Optimized lighting calculation
const FRAGMENT_SHADER = `
precision highp float;

varying vec2 v_texCoord;

uniform sampler2D u_image;
uniform sampler2D u_normals;
uniform sampler2D u_depth;

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

void main() {
    // Sample textures
    vec4 color = texture2D(u_image, v_texCoord);
    vec4 normalSample = texture2D(u_normals, v_texCoord);
    float depth = texture2D(u_depth, v_texCoord).r;
    
    // Decode normal from 0-1 to -1 to 1
    vec3 normal = normalize(normalSample.rgb * 2.0 - 1.0);
    
    // View direction (camera looking at screen)
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    
    // Start with ambient lighting to preserve original brightness
    vec3 finalLight = vec3(u_ambient);
    
    // Accumulate light contributions
    for (int i = 0; i < 8; i++) {
        if (i >= u_lightCount) break;
        
        Light light = u_lights[i];
        vec3 lightDir;
        float attenuation = 1.0;
        
        if (light.type == 1) {
            // Directional light
            lightDir = normalize(vec3(light.position.xy, 0.5));
        } else {
            // Point light
            vec3 toLight = vec3(light.position.xy - v_texCoord, light.position.z);
            float dist = length(toLight);
            lightDir = normalize(toLight);
            attenuation = 1.0 / (1.0 + dist * dist * 4.0);
        }
        
        // Diffuse (N dot L)
        float NdotL = max(0.0, dot(normal, lightDir));
        
        // Blinn-Phong specular
        vec3 halfDir = normalize(lightDir + viewDir);
        float NdotH = max(0.0, dot(normal, halfDir));
        float specular = pow(NdotH, 32.0) * 0.3;
        
        // Simple depth-based shadow approximation
        float shadow = 1.0 - (1.0 - depth) * u_shadowStrength * 0.3;
        
        // Combine
        float contribution = attenuation * light.intensity * shadow;
        vec3 lightContrib = (NdotL * contribution + specular * contribution * 0.5) * light.color;
        
        finalLight += lightContrib * 0.5;
    }
    
    // Apply lighting with exposure-style response
    // Use exp2() for vec3 exponent (equivalent to pow(2.0, x) but accepts vec3)
    vec3 exposedColor = color.rgb * exp2((finalLight - 1.0) * 0.5);
    
    // Soft highlight compression
    exposedColor = mix(exposedColor, vec3(1.0), smoothstep(0.8, 1.2, exposedColor) * 0.3);
    
    // Final brightness adjustment
    gl_FragColor = vec4(clamp(exposedColor * u_brightness, 0.0, 1.0), color.a);
}
`;
