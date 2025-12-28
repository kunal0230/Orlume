/**
 * HBAO (Horizon-Based Ambient Occlusion) Shader
 * Implements screen-space ambient occlusion for soft shadow in crevices
 * 
 * Reference: Web Relighting Report - Section 5.3
 * "Horizon-Based Ambient Occlusion (HBAO)"
 * 
 * HBAO determines the "horizon angle" at each pixel by marching rays
 * in multiple directions to calculate how much sky is visible.
 */

export const HBAOShader = {
    name: 'HBAO',

    // Vertex shader
    vertexShader: `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        varying vec2 v_texCoord;
        
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }
    `,

    // Fragment shader - HBAO implementation
    fragmentShader: `
        precision highp float;
        
        uniform sampler2D u_depthMap;
        uniform vec2 u_resolution;
        uniform float u_radius;         // AO sample radius
        uniform float u_intensity;      // AO intensity
        uniform float u_bias;           // Angle bias
        uniform int u_numDirections;    // Number of sampling directions
        uniform int u_numSteps;         // Steps per direction
        uniform float u_depthScale;     // Depth to world scale
        
        varying vec2 v_texCoord;
        
        const float PI = 3.14159265359;
        const float TWO_PI = 6.28318530718;
        
        // Random angle offset based on position (to reduce banding)
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        
        // Get depth value
        float getDepth(vec2 uv) {
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                return 1.0; // Far depth for out of bounds
            }
            return texture2D(u_depthMap, uv).r;
        }
        
        // Convert depth to view-space Z
        float depthToZ(float depth) {
            return depth * u_depthScale;
        }
        
        // Reconstruct position from UV and depth
        vec3 getPosition(vec2 uv, float depth) {
            return vec3(uv, depthToZ(depth));
        }
        
        // Compute horizon angle for a direction
        float computeHorizonAngle(vec2 uv, vec2 direction, float centerDepth) {
            float maxHorizon = -1.0;
            float stepSize = u_radius / float(u_numSteps);
            
            vec3 centerPos = getPosition(uv, centerDepth);
            
            for (int i = 1; i <= 16; i++) {
                if (i > u_numSteps) break;
                
                float t = float(i) * stepSize;
                vec2 sampleUV = uv + direction * t;
                
                if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || 
                    sampleUV.y < 0.0 || sampleUV.y > 1.0) {
                    break;
                }
                
                float sampleDepth = getDepth(sampleUV);
                vec3 samplePos = getPosition(sampleUV, sampleDepth);
                
                // Vector from center to sample
                vec3 diff = samplePos - centerPos;
                float dist = length(diff.xy);
                
                if (dist > 0.001) {
                    // Horizon angle = atan(height_diff / dist)
                    float horizon = diff.z / dist;
                    maxHorizon = max(maxHorizon, horizon);
                }
            }
            
            return maxHorizon;
        }
        
        void main() {
            float centerDepth = getDepth(v_texCoord);
            
            // Skip background (very close to 1.0)
            if (centerDepth > 0.99) {
                gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
                return;
            }
            
            // Random angle offset to reduce banding
            float randomAngle = hash(v_texCoord * u_resolution) * TWO_PI;
            
            float occlusion = 0.0;
            float angleStep = TWO_PI / float(u_numDirections);
            
            // Sample in multiple directions
            for (int i = 0; i < 16; i++) {
                if (i >= u_numDirections) break;
                
                float angle = float(i) * angleStep + randomAngle;
                vec2 direction = vec2(cos(angle), sin(angle)) / u_resolution;
                
                float horizon = computeHorizonAngle(v_texCoord, direction, centerDepth);
                
                // Convert horizon to occlusion (higher horizon = more occluded)
                // Bias prevents self-occlusion
                float ao = max(0.0, horizon - u_bias);
                occlusion += ao;
            }
            
            // Normalize by number of directions
            occlusion /= float(u_numDirections);
            
            // Apply intensity and invert (darker = more occluded)
            float ao = 1.0 - clamp(occlusion * u_intensity, 0.0, 1.0);
            
            gl_FragColor = vec4(ao, ao, ao, 1.0);
        }
    `,

    // Blur pass for softer AO
    blurFragmentShader: `
        precision highp float;
        
        uniform sampler2D u_aoMap;
        uniform vec2 u_resolution;
        uniform vec2 u_direction; // (1,0) for horizontal, (0,1) for vertical
        uniform float u_blurRadius;
        
        varying vec2 v_texCoord;
        
        void main() {
            vec2 texelSize = 1.0 / u_resolution;
            float result = 0.0;
            float weightSum = 0.0;
            
            // Gaussian weights (approximation)
            for (int i = -4; i <= 4; i++) {
                float offset = float(i);
                vec2 sampleUV = v_texCoord + u_direction * offset * texelSize * u_blurRadius;
                
                // Gaussian weight
                float weight = exp(-0.5 * (offset * offset) / 4.0);
                
                result += texture2D(u_aoMap, sampleUV).r * weight;
                weightSum += weight;
            }
            
            result /= weightSum;
            gl_FragColor = vec4(result, result, result, 1.0);
        }
    `,

    // Default uniforms
    defaultUniforms: {
        u_radius: 0.03,
        u_intensity: 2.0,
        u_bias: 0.05,
        u_numDirections: 8,
        u_numSteps: 8,
        u_depthScale: 1.0,
        u_blurRadius: 2.0
    }
};

/**
 * HBAOProcessor - WebGL2 implementation for ambient occlusion
 */
export class HBAOProcessor {
    constructor() {
        this.canvas = null;
        this.gl = null;
        this.aoProgram = null;
        this.blurProgram = null;
        this.initialized = false;

        // Framebuffers for multi-pass rendering
        this.aoFBO = null;
        this.aoTexture = null;
        this.blurFBO = null;
        this.blurTexture = null;
    }

    /**
     * Initialize WebGL2 and compile shaders
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

        this._compilePrograms();
        this._setupGeometry();
        this._setupFramebuffers(width, height);
        this.initialized = true;

        console.log('✅ HBAO processor initialized');
    }

    /**
     * Compile AO and blur shaders
     */
    _compilePrograms() {
        const gl = this.gl;

        // Compile AO program
        this.aoProgram = this._createProgram(
            HBAOShader.vertexShader,
            HBAOShader.fragmentShader
        );

        this.aoUniforms = {
            u_depthMap: gl.getUniformLocation(this.aoProgram, 'u_depthMap'),
            u_resolution: gl.getUniformLocation(this.aoProgram, 'u_resolution'),
            u_radius: gl.getUniformLocation(this.aoProgram, 'u_radius'),
            u_intensity: gl.getUniformLocation(this.aoProgram, 'u_intensity'),
            u_bias: gl.getUniformLocation(this.aoProgram, 'u_bias'),
            u_numDirections: gl.getUniformLocation(this.aoProgram, 'u_numDirections'),
            u_numSteps: gl.getUniformLocation(this.aoProgram, 'u_numSteps'),
            u_depthScale: gl.getUniformLocation(this.aoProgram, 'u_depthScale')
        };

        // Compile blur program
        this.blurProgram = this._createProgram(
            HBAOShader.vertexShader,
            HBAOShader.blurFragmentShader
        );

        this.blurUniforms = {
            u_aoMap: gl.getUniformLocation(this.blurProgram, 'u_aoMap'),
            u_resolution: gl.getUniformLocation(this.blurProgram, 'u_resolution'),
            u_direction: gl.getUniformLocation(this.blurProgram, 'u_direction'),
            u_blurRadius: gl.getUniformLocation(this.blurProgram, 'u_blurRadius')
        };

        // Get attribute locations
        this.attribs = {
            a_position: gl.getAttribLocation(this.aoProgram, 'a_position'),
            a_texCoord: gl.getAttribLocation(this.aoProgram, 'a_texCoord')
        };
    }

    /**
     * Create shader program
     */
    _createProgram(vertSource, fragSource) {
        const gl = this.gl;

        const vertShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertShader, vertSource);
        gl.compileShader(vertShader);
        if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
            throw new Error('Vertex: ' + gl.getShaderInfoLog(vertShader));
        }

        const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragShader, fragSource);
        gl.compileShader(fragShader);
        if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
            throw new Error('Fragment: ' + gl.getShaderInfoLog(fragShader));
        }

        const program = gl.createProgram();
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('Linking: ' + gl.getProgramInfoLog(program));
        }

        return program;
    }

    /**
     * Setup fullscreen quad
     */
    _setupGeometry() {
        const gl = this.gl;
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
     * Setup framebuffers for multi-pass rendering
     */
    _setupFramebuffers(width, height) {
        const gl = this.gl;

        // Create AO framebuffer
        this.aoTexture = this._createRenderTexture(width, height);
        this.aoFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.aoTexture, 0);

        // Create blur framebuffer
        this.blurTexture = this._createRenderTexture(width, height);
        this.blurFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurTexture, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Create render texture for FBO
     */
    _createRenderTexture(width, height) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return texture;
    }

    /**
     * Create texture from source
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
     * Compute HBAO for depth map
     * @param {Object} depthMap - Depth map from depth estimator
     * @param {Object} options - HBAO options
     * @returns {HTMLCanvasElement} - Canvas with AO map
     */
    compute(depthMap, options = {}) {
        if (!this.initialized) {
            this.init(depthMap.width, depthMap.height);
        }

        const gl = this.gl;
        const opts = { ...HBAOShader.defaultUniforms, ...options };

        // Resize if needed
        if (this.canvas.width !== depthMap.width || this.canvas.height !== depthMap.height) {
            this.canvas.width = depthMap.width;
            this.canvas.height = depthMap.height;
            this._setupFramebuffers(depthMap.width, depthMap.height);
        }

        const depthTexture = this._createTexture(depthMap.canvas || depthMap);

        // Pass 1: Compute raw AO
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoFBO);
        gl.viewport(0, 0, depthMap.width, depthMap.height);
        gl.useProgram(this.aoProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, depthTexture);
        gl.uniform1i(this.aoUniforms.u_depthMap, 0);
        gl.uniform2f(this.aoUniforms.u_resolution, depthMap.width, depthMap.height);
        gl.uniform1f(this.aoUniforms.u_radius, opts.u_radius);
        gl.uniform1f(this.aoUniforms.u_intensity, opts.u_intensity);
        gl.uniform1f(this.aoUniforms.u_bias, opts.u_bias);
        gl.uniform1i(this.aoUniforms.u_numDirections, opts.u_numDirections);
        gl.uniform1i(this.aoUniforms.u_numSteps, opts.u_numSteps);
        gl.uniform1f(this.aoUniforms.u_depthScale, opts.u_depthScale);

        this._drawQuad();

        // Pass 2: Horizontal blur
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO);
        gl.useProgram(this.blurProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.aoTexture);
        gl.uniform1i(this.blurUniforms.u_aoMap, 0);
        gl.uniform2f(this.blurUniforms.u_resolution, depthMap.width, depthMap.height);
        gl.uniform2f(this.blurUniforms.u_direction, 1.0, 0.0);
        gl.uniform1f(this.blurUniforms.u_blurRadius, opts.u_blurRadius);

        this._drawQuad();

        // Pass 3: Vertical blur (to screen)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, depthMap.width, depthMap.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.blurTexture);
        gl.uniform2f(this.blurUniforms.u_direction, 0.0, 1.0);

        this._drawQuad();

        // Cleanup
        gl.deleteTexture(depthTexture);

        return this.canvas;
    }

    /**
     * Draw fullscreen quad
     */
    _drawQuad() {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.enableVertexAttribArray(this.attribs.a_position);
        gl.vertexAttribPointer(this.attribs.a_position, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(this.attribs.a_texCoord);
        gl.vertexAttribPointer(this.attribs.a_texCoord, 2, gl.FLOAT, false, 16, 8);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.gl) {
            this.gl.deleteProgram(this.aoProgram);
            this.gl.deleteProgram(this.blurProgram);
            this.gl.deleteBuffer(this.vbo);
            this.gl.deleteTexture(this.aoTexture);
            this.gl.deleteTexture(this.blurTexture);
            this.gl.deleteFramebuffer(this.aoFBO);
            this.gl.deleteFramebuffer(this.blurFBO);
        }
        this.initialized = false;
    }
}
