/**
 * Raymarching Shadow Shader
 * Implements Screen-Space Raymarching (2.5D Ray Tracing)
 * for realistic shadows based on depth map
 * 
 * Reference: Web Relighting Report - Section 5.2
 * "Screen-Space Raymarching for Shadows"
 */

export const RaymarchingShadowShader = {
    name: 'RaymarchingShadow',

    // Vertex shader - simple pass-through
    vertexShader: `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        varying vec2 v_texCoord;
        
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }
    `,

    // Fragment shader - raymarching implementation
    fragmentShader: `
        precision highp float;
        
        uniform sampler2D u_depthMap;
        uniform sampler2D u_image;
        uniform vec2 u_resolution;
        uniform vec3 u_lightPos;        // Light position in normalized coords (x, y, z)
        uniform float u_shadowStrength; // 0.0 - 1.0
        uniform float u_shadowSoftness; // Softness/blur of shadows
        uniform int u_numSteps;         // Ray march steps (quality)
        uniform float u_heightScale;    // Depth to world height conversion
        uniform float u_bias;           // Shadow bias to prevent acne
        
        varying vec2 v_texCoord;
        
        // Get depth value at UV coordinate
        float getDepth(vec2 uv) {
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                return 0.0;
            }
            return texture2D(u_depthMap, uv).r;
        }
        
        // Screen-space raymarching shadow computation
        float computeShadow(vec2 uv) {
            float originDepth = getDepth(uv);
            
            // Reconstruct 3D position from UV + depth
            vec3 origin = vec3(uv, originDepth * u_heightScale);
            
            // Light direction (pointing towards light)
            vec3 lightDir = normalize(u_lightPos - origin);
            
            // If light is behind surface, definitely in shadow
            if (lightDir.z < 0.0) {
                return 0.0;
            }
            
            // March along the light direction
            float stepSize = 1.0 / float(u_numSteps);
            float shadow = 1.0;
            float softShadow = 1.0;
            
            for (int i = 1; i <= 64; i++) {
                if (i > u_numSteps) break;
                
                // Current position along ray
                float t = stepSize * float(i);
                vec3 samplePos = origin + lightDir * t * 0.5; // Scale for reasonable ray length
                
                // Project back to screen coordinates
                vec2 sampleUV = samplePos.xy;
                
                // Out of bounds check
                if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
                    break;
                }
                
                // Get depth at sample position
                float mapDepth = getDepth(sampleUV) * u_heightScale;
                float rayDepth = samplePos.z;
                
                // Occlusion test: ray went behind geometry
                float heightDiff = mapDepth - rayDepth;
                
                if (heightDiff > u_bias && heightDiff < u_heightScale * 0.5) {
                    // In shadow - soft shadow based on distance
                    float shadowFactor = 1.0 - (heightDiff / (u_heightScale * 0.5));
                    softShadow = min(softShadow, shadowFactor * u_shadowSoftness + (1.0 - u_shadowSoftness));
                    shadow = 0.0;
                }
            }
            
            // Return soft shadow if enabled, otherwise hard shadow
            return mix(shadow, softShadow, u_shadowSoftness) * u_shadowStrength + (1.0 - u_shadowStrength);
        }
        
        void main() {
            // Get original color
            vec4 color = texture2D(u_image, v_texCoord);
            
            // Compute shadow
            float shadow = computeShadow(v_texCoord);
            
            // Apply shadow to color
            vec3 shadedColor = color.rgb * shadow;
            
            gl_FragColor = vec4(shadedColor, color.a);
        }
    `,

    // Default uniforms
    defaultUniforms: {
        u_lightPos: [0.5, 0.5, 1.0],
        u_shadowStrength: 0.7,
        u_shadowSoftness: 0.5,
        u_numSteps: 32,
        u_heightScale: 0.3,
        u_bias: 0.01
    }
};

/**
 * RaymarchingShadowProcessor - WebGL2 implementation
 * Handles GPU-accelerated shadow computation
 */
export class RaymarchingShadowProcessor {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.program = null;
        this.uniforms = {};
        this.initialized = false;
    }

    /**
     * Initialize WebGL2 context and compile shaders
     */
    init(width, height) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;

        this.gl = this.canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: false,
            preserveDrawingBuffer: true
        });

        if (!this.gl) {
            throw new Error('WebGL2 not supported');
        }

        this._compileShaders();
        this._setupGeometry();
        this.initialized = true;

        console.log('✅ Raymarching shadow processor initialized');
    }

    /**
     * Compile vertex and fragment shaders
     */
    _compileShaders() {
        const gl = this.gl;

        // Compile vertex shader
        const vertShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertShader, RaymarchingShadowShader.vertexShader);
        gl.compileShader(vertShader);

        if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
            throw new Error('Vertex shader: ' + gl.getShaderInfoLog(vertShader));
        }

        // Compile fragment shader
        const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragShader, RaymarchingShadowShader.fragmentShader);
        gl.compileShader(fragShader);

        if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
            throw new Error('Fragment shader: ' + gl.getShaderInfoLog(fragShader));
        }

        // Link program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertShader);
        gl.attachShader(this.program, fragShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error('Program linking: ' + gl.getProgramInfoLog(this.program));
        }

        // Get uniform locations
        gl.useProgram(this.program);
        this.uniforms = {
            u_depthMap: gl.getUniformLocation(this.program, 'u_depthMap'),
            u_image: gl.getUniformLocation(this.program, 'u_image'),
            u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            u_lightPos: gl.getUniformLocation(this.program, 'u_lightPos'),
            u_shadowStrength: gl.getUniformLocation(this.program, 'u_shadowStrength'),
            u_shadowSoftness: gl.getUniformLocation(this.program, 'u_shadowSoftness'),
            u_numSteps: gl.getUniformLocation(this.program, 'u_numSteps'),
            u_heightScale: gl.getUniformLocation(this.program, 'u_heightScale'),
            u_bias: gl.getUniformLocation(this.program, 'u_bias')
        };

        // Get attribute locations
        this.attribs = {
            a_position: gl.getAttribLocation(this.program, 'a_position'),
            a_texCoord: gl.getAttribLocation(this.program, 'a_texCoord')
        };
    }

    /**
     * Setup fullscreen quad geometry
     */
    _setupGeometry() {
        const gl = this.gl;

        // Fullscreen quad vertices
        const vertices = new Float32Array([
            -1, -1, 0, 0,
            1, -1, 1, 0,
            -1, 1, 0, 1,
            1, 1, 1, 1
        ]);

        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    }

    /**
     * Create texture from ImageData or canvas
     */
    _createTexture(source) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        } else if (source.data && source.width && source.height) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(source.data));
        }

        return texture;
    }

    /**
     * Compute shadows for image using depth map
     * @param {Object} imageData - Original image data
     * @param {Object} depthMap - Depth map from depth estimator
     * @param {Object} options - Shadow options (lightPos, strength, softness, etc)
     * @returns {HTMLCanvasElement} - Canvas with shadows applied
     */
    compute(imageData, depthMap, options = {}) {
        if (!this.initialized) {
            this.init(imageData.width || depthMap.width, imageData.height || depthMap.height);
        }

        const gl = this.gl;
        const opts = { ...RaymarchingShadowShader.defaultUniforms, ...options };

        // Resize if needed
        if (this.canvas.width !== depthMap.width || this.canvas.height !== depthMap.height) {
            this.canvas.width = depthMap.width;
            this.canvas.height = depthMap.height;
            gl.viewport(0, 0, depthMap.width, depthMap.height);
        }

        gl.useProgram(this.program);

        // Create textures
        const imageTexture = this._createTexture(imageData.canvas || imageData);
        const depthTexture = this._createTexture(depthMap.canvas || depthMap);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.uniform1i(this.uniforms.u_image, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, depthTexture);
        gl.uniform1i(this.uniforms.u_depthMap, 1);

        // Set uniforms
        gl.uniform2f(this.uniforms.u_resolution, depthMap.width, depthMap.height);
        gl.uniform3fv(this.uniforms.u_lightPos, opts.u_lightPos);
        gl.uniform1f(this.uniforms.u_shadowStrength, opts.u_shadowStrength);
        gl.uniform1f(this.uniforms.u_shadowSoftness, opts.u_shadowSoftness);
        gl.uniform1i(this.uniforms.u_numSteps, opts.u_numSteps);
        gl.uniform1f(this.uniforms.u_heightScale, opts.u_heightScale);
        gl.uniform1f(this.uniforms.u_bias, opts.u_bias);

        // Setup geometry
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.enableVertexAttribArray(this.attribs.a_position);
        gl.vertexAttribPointer(this.attribs.a_position, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(this.attribs.a_texCoord);
        gl.vertexAttribPointer(this.attribs.a_texCoord, 2, gl.FLOAT, false, 16, 8);

        // Render
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Cleanup textures
        gl.deleteTexture(imageTexture);
        gl.deleteTexture(depthTexture);

        return this.canvas;
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.gl && this.program) {
            this.gl.deleteProgram(this.program);
            this.gl.deleteBuffer(this.vbo);
        }
        this.initialized = false;
    }
}
