/**
 * Displacement3DShader - True 3D Rendering with Vertex Displacement
 * 
 * TIER 3: The Ultimate Relighting System
 * 
 * Instead of rendering a flat 2D quad, this creates a high-density mesh
 * and displaces vertices based on the depth map. This enables:
 * 
 * 1. TRUE 3D GEOMETRY - The image becomes a 3D surface
 * 2. SELF-SHADOWING - A nose can cast shadows on a cheek
 * 3. PARALLAX - Moving the light reveals hidden surfaces
 * 4. REAL SHADOW MAPPING - GPU-accelerated shadow calculation
 * 
 * Grid Resolution: 256x256 = 65,536 vertices = 130,050 triangles
 */

export class Displacement3DShader {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.shadowProgram = null;  // For shadow map generation
        this.initialized = false;

        // Textures
        this.imageTexture = null;
        this.normalTexture = null;
        this.depthTexture = null;
        this.materialTexture = null;
        this.shadowMapTexture = null;  // Rendered shadow map
        this.shadowFramebuffer = null;

        // 3D Mesh Buffers
        this.vertexBuffer = null;
        this.indexBuffer = null;
        this.indexCount = 0;

        // Grid settings
        this.gridResolution = 256;  // 256x256 grid

        // Camera & Transformation
        this.projectionMatrix = new Float32Array(16);
        this.viewMatrix = new Float32Array(16);
        this.modelMatrix = new Float32Array(16);
        this.lightMatrix = new Float32Array(16);  // For shadow mapping

        // Settings
        this.extrusionDepth = 0.35;  // How much depth displaces vertices (increased for more 3D)
        this.shadowMapSize = 2048;   // High-res shadow map for sharp shadows

        this.maxLights = 8;
        this.uniforms = {};
        this.shadowUniforms = {};
    }

    /**
     * Initialize the 3D rendering system
     */
    init(canvas) {
        this.canvas = canvas;

        // MUST have WebGL2 for this
        this.gl = canvas.getContext('webgl2', {
            antialias: true,
            depth: true,
            stencil: false,
            alpha: true,
            preserveDrawingBuffer: true
        });

        if (!this.gl) {
            console.error('❌ WebGL2 required for 3D displacement');
            return false;
        }

        const gl = this.gl;
        console.log('🎮 Initializing 3D Displacement Shader...');

        // Enable depth testing for true 3D
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);

        // Enable face culling for performance
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);

        // Compile main program
        const mainVS = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_3D);
        const mainFS = this._compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_3D);
        if (!mainVS || !mainFS) return false;

        this.program = gl.createProgram();
        gl.attachShader(this.program, mainVS);
        gl.attachShader(this.program, mainFS);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Main program link failed:', gl.getProgramInfoLog(this.program));
            return false;
        }

        // Compile shadow map program
        const shadowVS = this._compileShader(gl.VERTEX_SHADER, SHADOW_VERTEX_SHADER);
        const shadowFS = this._compileShader(gl.FRAGMENT_SHADER, SHADOW_FRAGMENT_SHADER);
        if (!shadowVS || !shadowFS) return false;

        this.shadowProgram = gl.createProgram();
        gl.attachShader(this.shadowProgram, shadowVS);
        gl.attachShader(this.shadowProgram, shadowFS);
        gl.linkProgram(this.shadowProgram);

        if (!gl.getProgramParameter(this.shadowProgram, gl.LINK_STATUS)) {
            console.error('Shadow program link failed:', gl.getProgramInfoLog(this.shadowProgram));
            return false;
        }

        // Create the 3D mesh grid
        this._createMeshGrid();

        // Get uniform locations
        this._getUniformLocations();

        // Create textures
        this.imageTexture = this._createTexture();
        this.normalTexture = this._createTexture();
        this.depthTexture = this._createTexture();
        this.materialTexture = this._createTexture();

        // Create shadow map framebuffer
        this._createShadowMap();

        // Initialize matrices
        this._initMatrices();

        this.initialized = true;
        console.log(`✅ 3D Displacement initialized (${this.gridResolution}x${this.gridResolution} mesh, ${this.indexCount} triangles)`);
        return true;
    }

    /**
     * Create high-density mesh grid
     * Each vertex will be displaced by the depth map
     */
    _createMeshGrid() {
        const gl = this.gl;
        const res = this.gridResolution;

        // Generate vertex positions and UVs
        const vertices = [];
        for (let y = 0; y <= res; y++) {
            for (let x = 0; x <= res; x++) {
                // Position (x, y) in range [-1, 1]
                const px = (x / res) * 2 - 1;
                const py = -((y / res) * 2 - 1);  // Flip Y for WebGL

                // UV coordinates [0, 1]
                const u = x / res;
                const v = y / res;

                // x, y, z (z will be displaced in shader), u, v
                vertices.push(px, py, 0, u, v);
            }
        }

        // Generate indices for triangle strip
        const indices = [];
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const topLeft = y * (res + 1) + x;
                const topRight = topLeft + 1;
                const bottomLeft = (y + 1) * (res + 1) + x;
                const bottomRight = bottomLeft + 1;

                // Two triangles per quad
                indices.push(topLeft, bottomLeft, topRight);
                indices.push(topRight, bottomLeft, bottomRight);
            }
        }

        this.indexCount = indices.length;

        // Create and bind vertex buffer
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        // Create and bind index buffer
        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);

        console.log(`📐 Created ${res}x${res} mesh: ${vertices.length / 5} vertices, ${indices.length / 3} triangles`);
    }

    /**
     * Create shadow map framebuffer and texture
     */
    _createShadowMap() {
        const gl = this.gl;
        const size = this.shadowMapSize;

        // Create shadow map texture
        this.shadowMapTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.shadowMapTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, size, size, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

        // Create framebuffer
        this.shadowFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowMapTexture, 0);

        // No color attachment needed
        gl.drawBuffers([gl.NONE]);
        gl.readBuffer(gl.NONE);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.warn('⚠️ Shadow framebuffer incomplete:', status);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        console.log(`🌑 Shadow map created: ${size}x${size}`);
    }

    /**
     * Initialize camera matrices
     */
    _initMatrices() {
        // Identity matrices
        this._identity(this.modelMatrix);
        this._identity(this.viewMatrix);

        // Orthographic projection (for 2D-like look with 3D depth)
        this._ortho(this.projectionMatrix, -1, 1, -1, 1, 0.1, 10);

        // Camera looking at center from front
        this._lookAt(this.viewMatrix, [0, 0, 2], [0, 0, 0], [0, 1, 0]);
    }

    /**
     * Get all uniform locations for both programs
     */
    _getUniformLocations() {
        const gl = this.gl;

        // Main program uniforms
        gl.useProgram(this.program);
        this.uniforms = {
            u_projection: gl.getUniformLocation(this.program, 'u_projection'),
            u_view: gl.getUniformLocation(this.program, 'u_view'),
            u_model: gl.getUniformLocation(this.program, 'u_model'),
            u_lightMatrix: gl.getUniformLocation(this.program, 'u_lightMatrix'),
            u_image: gl.getUniformLocation(this.program, 'u_image'),
            u_depth: gl.getUniformLocation(this.program, 'u_depth'),
            u_normals: gl.getUniformLocation(this.program, 'u_normals'),
            u_materials: gl.getUniformLocation(this.program, 'u_materials'),
            u_shadowMap: gl.getUniformLocation(this.program, 'u_shadowMap'),
            u_extrusion: gl.getUniformLocation(this.program, 'u_extrusion'),
            u_lightPos: gl.getUniformLocation(this.program, 'u_lightPos'),
            u_lightColor: gl.getUniformLocation(this.program, 'u_lightColor'),
            u_lightIntensity: gl.getUniformLocation(this.program, 'u_lightIntensity'),
            u_ambient: gl.getUniformLocation(this.program, 'u_ambient'),
            u_brightness: gl.getUniformLocation(this.program, 'u_brightness'),
            u_shadowStrength: gl.getUniformLocation(this.program, 'u_shadowStrength'),
            u_cameraPos: gl.getUniformLocation(this.program, 'u_cameraPos'),
        };

        // Shadow program uniforms
        gl.useProgram(this.shadowProgram);
        this.shadowUniforms = {
            u_lightMatrix: gl.getUniformLocation(this.shadowProgram, 'u_lightMatrix'),
            u_depth: gl.getUniformLocation(this.shadowProgram, 'u_depth'),
            u_extrusion: gl.getUniformLocation(this.shadowProgram, 'u_extrusion'),
        };
    }

    /**
     * Upload image texture
     */
    uploadImage(imageData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
    }

    /**
     * Upload depth texture (as float for precision)
     */
    uploadDepth(depthData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, depthData);
    }

    /**
     * Upload normal texture
     */
    uploadNormals(normalData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, normalData);
    }

    /**
     * Upload material texture
     */
    uploadMaterials(materialData, width, height) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.materialTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, materialData);
    }

    /**
     * Render the 3D displaced scene
     */
    render(lights, settings = {}) {
        if (!this.initialized) return;

        const gl = this.gl;
        const light = lights[0] || { x: 0.5, y: 0.3, z: 0.8, color: '#ffffff', intensity: 1.0 };

        // Parse light color
        const lightColor = this._parseColor(light.color || '#ffffff');

        // Calculate light position in 3D space
        const lightPos = [
            (light.x - 0.5) * 2,  // X: -1 to 1
            -(light.y - 0.5) * 2, // Y: -1 to 1 (flipped)
            light.z || 0.8        // Z: height
        ];

        // ========================================
        // PASS 1: Render shadow map from light's POV
        // ========================================
        this._renderShadowMap(lightPos);

        // ========================================
        // PASS 2: Render final scene
        // ========================================
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind vertex buffer with stride
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        // Position attribute (x, y, z)
        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0);

        // UV attribute
        const uvLoc = gl.getAttribLocation(this.program, 'a_uv');
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12);

        // Set matrices
        gl.uniformMatrix4fv(this.uniforms.u_projection, false, this.projectionMatrix);
        gl.uniformMatrix4fv(this.uniforms.u_view, false, this.viewMatrix);
        gl.uniformMatrix4fv(this.uniforms.u_model, false, this.modelMatrix);
        gl.uniformMatrix4fv(this.uniforms.u_lightMatrix, false, this.lightMatrix);

        // Set light uniforms
        gl.uniform3fv(this.uniforms.u_lightPos, lightPos);
        gl.uniform3fv(this.uniforms.u_lightColor, lightColor);
        gl.uniform1f(this.uniforms.u_lightIntensity, light.intensity || 1.0);
        gl.uniform3fv(this.uniforms.u_cameraPos, [0, 0, 2]);

        // Set settings
        gl.uniform1f(this.uniforms.u_extrusion, settings.extrusion || this.extrusionDepth);
        gl.uniform1f(this.uniforms.u_ambient, settings.ambient || 0.15);
        gl.uniform1f(this.uniforms.u_brightness, settings.brightness || 1.0);
        gl.uniform1f(this.uniforms.u_shadowStrength, settings.shadowStrength || 0.8);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
        gl.uniform1i(this.uniforms.u_image, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.uniform1i(this.uniforms.u_depth, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.normalTexture);
        gl.uniform1i(this.uniforms.u_normals, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.materialTexture);
        gl.uniform1i(this.uniforms.u_materials, 3);

        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.shadowMapTexture);
        gl.uniform1i(this.uniforms.u_shadowMap, 4);

        // Draw the mesh
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    }

    /**
     * Render shadow map from light's perspective
     */
    _renderShadowMap(lightPos) {
        const gl = this.gl;

        // Bind shadow framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
        gl.viewport(0, 0, this.shadowMapSize, this.shadowMapSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        gl.useProgram(this.shadowProgram);

        // Create light view matrix (looking at center from light position)
        const lightView = new Float32Array(16);
        this._lookAt(lightView, lightPos, [0, 0, 0], [0, 1, 0]);

        // Create light projection (orthographic for directional-like shadows)
        const lightProj = new Float32Array(16);
        this._ortho(lightProj, -1.5, 1.5, -1.5, 1.5, 0.1, 5);

        // Combine into light matrix
        this._multiply(this.lightMatrix, lightProj, lightView);

        // Bind vertex data
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        const posLoc = gl.getAttribLocation(this.shadowProgram, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0);

        const uvLoc = gl.getAttribLocation(this.shadowProgram, 'a_uv');
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12);

        // Set uniforms
        gl.uniformMatrix4fv(this.shadowUniforms.u_lightMatrix, false, this.lightMatrix);
        gl.uniform1f(this.shadowUniforms.u_extrusion, this.extrusionDepth);

        // Bind depth texture for displacement
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        gl.uniform1i(this.shadowUniforms.u_depth, 0);

        // Draw to shadow map
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    }

    /**
     * Get rendered image data
     */
    getImageData() {
        const gl = this.gl;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Flip Y
        const imageData = new ImageData(width, height);
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            for (let x = 0; x < width * 4; x++) {
                imageData.data[dstRow + x] = pixels[srcRow + x];
            }
        }
        return imageData;
    }

    // ========================================
    // MATRIX UTILITIES
    // ========================================

    _identity(m) {
        m.fill(0);
        m[0] = m[5] = m[10] = m[15] = 1;
    }

    _ortho(m, left, right, bottom, top, near, far) {
        m.fill(0);
        m[0] = 2 / (right - left);
        m[5] = 2 / (top - bottom);
        m[10] = -2 / (far - near);
        m[12] = -(right + left) / (right - left);
        m[13] = -(top + bottom) / (top - bottom);
        m[14] = -(far + near) / (far - near);
        m[15] = 1;
    }

    _lookAt(m, eye, center, up) {
        const zAxis = this._normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
        const xAxis = this._normalize(this._cross(up, zAxis));
        const yAxis = this._cross(zAxis, xAxis);

        m[0] = xAxis[0]; m[1] = yAxis[0]; m[2] = zAxis[0]; m[3] = 0;
        m[4] = xAxis[1]; m[5] = yAxis[1]; m[6] = zAxis[1]; m[7] = 0;
        m[8] = xAxis[2]; m[9] = yAxis[2]; m[10] = zAxis[2]; m[11] = 0;
        m[12] = -this._dot(xAxis, eye);
        m[13] = -this._dot(yAxis, eye);
        m[14] = -this._dot(zAxis, eye);
        m[15] = 1;
    }

    _multiply(out, a, b) {
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                out[i * 4 + j] = 0;
                for (let k = 0; k < 4; k++) {
                    out[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
                }
            }
        }
    }

    _normalize(v) {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    _cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }

    _dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    _parseColor(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255];
        }
        return [1, 1, 1];
    }

    _createTexture() {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return texture;
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

    dispose() {
        if (this.gl) {
            const gl = this.gl;
            if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
            if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
            if (this.program) gl.deleteProgram(this.program);
            if (this.shadowProgram) gl.deleteProgram(this.shadowProgram);
        }
    }
}

// ========================================
// VERTEX SHADER - 3D DISPLACEMENT
// ========================================
const VERTEX_SHADER_3D = `#version 300 es
precision highp float;

in vec3 a_position;
in vec2 a_uv;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform mat4 u_lightMatrix;
uniform sampler2D u_depth;
uniform float u_extrusion;

out vec2 v_uv;
out vec3 v_worldPos;
out vec4 v_lightSpacePos;
out float v_depth;

void main() {
    // Sample depth and displace Z
    float depth = texture(u_depth, a_uv).r;
    v_depth = depth;
    
    // Displace vertex based on depth (closer = push forward)
    vec3 displaced = a_position;
    displaced.z = (1.0 - depth) * u_extrusion;  // Invert: 0=far, 1=close
    
    // World position for lighting
    v_worldPos = (u_model * vec4(displaced, 1.0)).xyz;
    
    // Position in light space for shadow mapping
    v_lightSpacePos = u_lightMatrix * vec4(displaced, 1.0);
    
    // UV for texture sampling
    v_uv = a_uv;
    
    gl_Position = u_projection * u_view * u_model * vec4(displaced, 1.0);
}
`;

// ========================================
// FRAGMENT SHADER - CINEMA QUALITY PBR
// ========================================
const FRAGMENT_SHADER_3D = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

in vec2 v_uv;
in vec3 v_worldPos;
in vec4 v_lightSpacePos;
in float v_depth;

uniform sampler2D u_image;
uniform sampler2D u_normals;
uniform sampler2D u_materials;
uniform sampler2DShadow u_shadowMap;

uniform vec3 u_lightPos;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform vec3 u_cameraPos;
uniform float u_ambient;
uniform float u_brightness;
uniform float u_shadowStrength;

out vec4 fragColor;

// Golden angle for Vogel disk
const float GOLDEN_ANGLE = 2.39996323;

// Vogel disk sample for soft shadows (16 samples)
vec2 vogelDisk(int sampleIndex, int sampleCount, float rotation) {
    float r = sqrt(float(sampleIndex) + 0.5) / sqrt(float(sampleCount));
    float theta = float(sampleIndex) * GOLDEN_ANGLE + rotation;
    return vec2(r * cos(theta), r * sin(theta));
}

// Cinema-quality PCF with Vogel disk (16 samples)
float calcShadowPCF(vec4 lightSpacePos, float shadowRadius) {
    vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
    projCoords = projCoords * 0.5 + 0.5;
    
    if (projCoords.z > 1.0 || projCoords.x < 0.0 || projCoords.x > 1.0 || 
        projCoords.y < 0.0 || projCoords.y > 1.0) return 1.0;
    
    float shadow = 0.0;
    float bias = 0.003;
    vec2 texelSize = vec2(1.0 / 2048.0);
    
    // 16-sample Vogel disk for smooth penumbra
    const int SAMPLES = 16;
    float rotation = fract(sin(dot(v_uv, vec2(12.9898, 78.233))) * 43758.5453) * 6.283;
    
    for (int i = 0; i < SAMPLES; i++) {
        vec2 offset = vogelDisk(i, SAMPLES, rotation) * shadowRadius * texelSize * 4.0;
        vec3 samplePos = vec3(projCoords.xy + offset, projCoords.z - bias);
        shadow += texture(u_shadowMap, samplePos);
    }
    
    return shadow / float(SAMPLES);
}

// Contact shadow approximation (screen-space)
float calcContactShadow(vec3 normal, vec3 lightDir, float depth) {
    float NdotL = dot(normal, lightDir);
    // Surfaces facing away get stronger contact shadows
    float contact = 1.0 - smoothstep(-0.1, 0.3, NdotL);
    // Closer objects (lower depth) cast more contact shadow
    contact *= (1.0 - depth) * 0.5;
    return 1.0 - contact;
}

// Smooth normal sampling (3x3 bilateral filter)
vec3 getSmoothNormal(sampler2D normalTex, vec2 uv) {
    vec2 texelSize = vec2(1.0 / 1024.0);
    vec3 centerNormal = texture(normalTex, uv).rgb * 2.0 - 1.0;
    vec3 smoothNormal = centerNormal * 4.0; // Center weight
    float totalWeight = 4.0;
    
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            if (x == 0 && y == 0) continue;
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec3 sampleN = texture(normalTex, uv + offset).rgb * 2.0 - 1.0;
            // Bilateral weight: similar normals get more weight
            float weight = max(0.0, dot(centerNormal, sampleN));
            smoothNormal += sampleN * weight;
            totalWeight += weight;
        }
    }
    
    return normalize(smoothNormal / totalWeight);
}

// GGX Normal Distribution Function
float D_GGX(float NdotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * denom * denom + 0.0001);
}

// Schlick-Fresnel
vec3 F_Schlick(float VdotH, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
}

// ACES Filmic Tone Mapping
vec3 acesToneMap(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    // ========================================
    // TEXTURE SAMPLING
    // ========================================
    vec4 albedo = texture(u_image, v_uv);
    vec3 normal = getSmoothNormal(u_normals, v_uv);
    vec4 material = texture(u_materials, v_uv);
    
    float roughness = max(0.04, material.r);
    float metallic = material.g;
    float subsurface = material.b;
    float emissive = material.a;
    
    // ========================================
    // SHADOW CALCULATION
    // ========================================
    // Shadow radius based on depth (distant = softer)
    float shadowRadius = mix(0.5, 2.0, v_depth);
    float shadow = calcShadowPCF(v_lightSpacePos, shadowRadius);
    
    // Add contact shadow
    vec3 lightDir = normalize(u_lightPos - v_worldPos);
    float contact = calcContactShadow(normal, lightDir, v_depth);
    shadow *= contact;
    
    // Apply strength
    shadow = mix(1.0, shadow, u_shadowStrength);
    
    // ========================================
    // PBR LIGHTING
    // ========================================
    vec3 viewDir = normalize(u_cameraPos - v_worldPos);
    vec3 halfDir = normalize(lightDir + viewDir);
    
    float NdotL = max(0.0, dot(normal, lightDir));
    float NdotH = max(0.0, dot(normal, halfDir));
    float NdotV = max(0.001, dot(normal, viewDir));
    float VdotH = max(0.0, dot(viewDir, halfDir));
    
    // Base reflectivity
    vec3 F0 = mix(vec3(0.04), albedo.rgb, metallic);
    
    // Specular (GGX)
    float D = D_GGX(NdotH, roughness);
    vec3 F = F_Schlick(VdotH, F0);
    vec3 specular = D * F * 0.25;
    
    // Diffuse (energy conserving)
    vec3 kD = (1.0 - F) * (1.0 - metallic);
    vec3 diffuse = kD * albedo.rgb / 3.14159265;
    
    // SSS for skin/organic
    float sssWrap = max(0.0, (dot(normal, lightDir) + 0.5) / 1.5);
    vec3 sssColor = albedo.rgb * vec3(1.1, 0.95, 0.9);
    diffuse = mix(diffuse, sssColor * sssWrap / 3.14159265, subsurface * 0.4);
    
    // ========================================
    // LIGHT ACCUMULATION
    // ========================================
    // Distance attenuation (smooth)
    float dist = length(u_lightPos - v_worldPos);
    float attenuation = 1.0 / (1.0 + dist * 2.0 + dist * dist * 3.0);
    
    // Light contribution (reduced from 5x to 2x to prevent over-brightness)
    vec3 lightRadiance = u_lightColor * u_lightIntensity * attenuation * 2.0;
    
    vec3 Lo = (diffuse + specular) * lightRadiance * NdotL * shadow;
    
    // Ambient: should show original image when no light
    // u_ambient controls how much of the original image shows through
    vec3 ambient = albedo.rgb * u_ambient;
    
    // Rim/Fresnel lighting (reduced)
    float fresnel = pow(1.0 - NdotV, 4.0) * 0.1;
    vec3 rim = albedo.rgb * fresnel * u_lightColor * attenuation * 0.5;
    
    // Emissive
    vec3 emit = albedo.rgb * emissive;
    
    // ========================================
    // FINAL COMPOSITION
    // ========================================
    vec3 finalColor = ambient + Lo + rim + emit;
    
    // Soft tone mapping (less aggressive than ACES)
    // Use x/(x+1) which preserves original more
    finalColor = finalColor / (finalColor + vec3(0.8));
    
    // Very slight saturation boost
    float lum = dot(finalColor, vec3(0.299, 0.587, 0.114));
    finalColor = mix(vec3(lum), finalColor, 1.05);
    
    // Gamma (less aggressive)
    finalColor = pow(finalColor, vec3(1.0));  // No gamma adjust - preserve original
    
    // Brightness
    finalColor *= u_brightness;
    
    fragColor = vec4(clamp(finalColor, 0.0, 1.0), albedo.a);
}
`;

// ========================================
// SHADOW MAP SHADERS
// ========================================
const SHADOW_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 a_position;
in vec2 a_uv;

uniform mat4 u_lightMatrix;
uniform sampler2D u_depth;
uniform float u_extrusion;

void main() {
    float depth = texture(u_depth, a_uv).r;
    vec3 displaced = a_position;
    displaced.z = (1.0 - depth) * u_extrusion;
    
    gl_Position = u_lightMatrix * vec4(displaced, 1.0);
}
`;

const SHADOW_FRAGMENT_SHADER = `#version 300 es
precision highp float;

out vec4 fragColor;

void main() {
    // Depth is written automatically, we just need a valid fragment
    fragColor = vec4(1.0);
}
`;

export default Displacement3DShader;
