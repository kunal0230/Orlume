/**
 * MaskSystem - Local Adjustment Masks for GPU Editor
 * 
 * Provides brush, radial, and gradient masks for localized adjustments.
 * Masks are rendered to a separate texture and composited during processing.
 */

export class MaskSystem {
    constructor(gpuProcessor) {
        this.gpu = gpuProcessor;
        this.gl = gpuProcessor.gl;

        // Active mask layers
        this.layers = [];

        // Currently selected layer for editing
        this.activeLayerIndex = -1;

        // Brush settings
        this.brushSettings = {
            size: 100,
            hardness: 50,  // 0 = soft, 100 = hard edge
            opacity: 100,
            flow: 50,      // How quickly opacity builds up
            erase: false   // true = eraser mode
        };

        // Compiled mask programs
        this.programs = new Map();

        this._init();
    }

    _init() {
        this._compilePrograms();
        console.log('🎭 MaskSystem initialized');
    }

    _compilePrograms() {
        const gl = this.gl;

        // Vertex shader (shared)
        const vertexShader = `#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            out vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        // Brush stamp shader - renders a single brush dab to mask texture
        const brushStampFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform vec2 u_center;      // Brush center in UV coords
            uniform float u_radius;     // Brush radius in UV coords
            uniform float u_hardness;   // 0-1 (soft to hard)
            uniform float u_opacity;    // 0-1
            uniform float u_erase;      // 0 or 1
            
            void main() {
                float dist = distance(v_texCoord, u_center);
                
                // Calculate falloff based on hardness
                float inner = u_radius * u_hardness;
                float alpha = 1.0 - smoothstep(inner, u_radius, dist);
                alpha *= u_opacity;
                
                if (u_erase > 0.5) {
                    // Eraser mode: output negative alpha to subtract
                    fragColor = vec4(0.0, 0.0, 0.0, -alpha);
                } else {
                    fragColor = vec4(1.0, 1.0, 1.0, alpha);
                }
            }
        `;

        // Radial gradient shader
        const radialGradientFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform vec2 u_center;      // Center in UV coords
            uniform vec2 u_radii;       // Inner and outer radii
            uniform float u_feather;    // Feather amount
            uniform float u_invert;     // 0 or 1
            
            void main() {
                float dist = distance(v_texCoord, u_center);
                float alpha = smoothstep(u_radii.x, u_radii.y, dist);
                
                if (u_invert > 0.5) {
                    alpha = 1.0 - alpha;
                }
                
                fragColor = vec4(1.0, 1.0, 1.0, alpha);
            }
        `;

        // Linear gradient shader
        const linearGradientFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform vec2 u_start;       // Start point in UV
            uniform vec2 u_end;         // End point in UV
            uniform float u_feather;
            uniform float u_invert;
            
            void main() {
                vec2 dir = u_end - u_start;
                float len = length(dir);
                vec2 norm = dir / len;
                
                float proj = dot(v_texCoord - u_start, norm);
                float t = proj / len;
                
                float alpha = smoothstep(0.0, u_feather / len, t) * 
                              (1.0 - smoothstep(1.0 - u_feather / len, 1.0, t));
                
                if (u_invert > 0.5) {
                    alpha = 1.0 - alpha;
                }
                
                fragColor = vec4(1.0, 1.0, 1.0, alpha);
            }
        `;

        // Mask composite shader - applies masked adjustments
        const maskCompositeFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform sampler2D u_base;       // Base processed image
            uniform sampler2D u_adjusted;   // Adjusted image
            uniform sampler2D u_mask;       // Mask texture
            
            void main() {
                vec4 base = texture(u_base, v_texCoord);
                vec4 adjusted = texture(u_adjusted, v_texCoord);
                float maskValue = texture(u_mask, v_texCoord).a;
                
                // Blend based on mask
                fragColor = mix(base, adjusted, maskValue);
            }
        `;

        // Compile programs
        this.programs.set('brushStamp', this._createProgram(vertexShader, brushStampFragment));
        this.programs.set('radialGradient', this._createProgram(vertexShader, radialGradientFragment));
        this.programs.set('linearGradient', this._createProgram(vertexShader, linearGradientFragment));
        this.programs.set('maskComposite', this._createProgram(vertexShader, maskCompositeFragment));

        console.log('✅ Mask shaders compiled');
    }

    _createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;

        const vertexShader = this._compileShader(gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this._compileShader(gl.FRAGMENT_SHADER, fragmentSource);

        if (!vertexShader || !fragmentShader) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Mask program link error:', gl.getProgramInfoLog(program));
            return null;
        }

        // Get attribute locations
        program.a_position = gl.getAttribLocation(program, 'a_position');
        program.a_texCoord = gl.getAttribLocation(program, 'a_texCoord');

        return program;
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Mask shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    /**
     * Create a new adjustment layer with mask
     */
    createLayer(type = 'brush') {
        const gl = this.gl;
        const width = this.gpu.width;
        const height = this.gpu.height;

        // Create mask texture (single channel would be ideal, using RGBA for compatibility)
        const maskTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, maskTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Create framebuffer for rendering to mask
        const maskFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, maskFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, maskTexture, 0);

        // Clear to transparent
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        const layer = {
            id: Date.now(),
            type: type,  // 'brush', 'radial', 'gradient'
            maskTexture: maskTexture,
            maskFramebuffer: maskFramebuffer,
            adjustments: {
                exposure: 0,
                contrast: 0,
                highlights: 0,
                shadows: 0,
                temperature: 0,
                tint: 0,
                saturation: 0,
                clarity: 0
            },
            // For radial/gradient types
            shape: null,
            visible: true
        };

        this.layers.push(layer);
        this.activeLayerIndex = this.layers.length - 1;

        console.log(`📝 Created ${type} layer #${layer.id}`);
        return layer;
    }

    /**
     * Paint a brush stroke at the given coordinates
     * @param {number} x - X coordinate in image pixels
     * @param {number} y - Y coordinate in image pixels
     */
    paintBrush(x, y) {
        if (this.activeLayerIndex < 0) return;

        const layer = this.layers[this.activeLayerIndex];
        if (layer.type !== 'brush') return;

        const gl = this.gl;
        const program = this.programs.get('brushStamp');
        if (!program) return;

        const width = this.gpu.width;
        const height = this.gpu.height;

        // Convert to UV coordinates
        const centerX = x / width;
        const centerY = 1.0 - (y / height); // Flip Y for WebGL
        const radiusX = this.brushSettings.size / width;
        const radiusY = this.brushSettings.size / height;
        const radius = Math.max(radiusX, radiusY);

        // Render to mask framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.viewport(0, 0, width, height);

        // Enable blending for additive brush strokes
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(program);

        // Set uniforms
        gl.uniform2f(gl.getUniformLocation(program, 'u_center'), centerX, centerY);
        gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), radius);
        gl.uniform1f(gl.getUniformLocation(program, 'u_hardness'), this.brushSettings.hardness / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), (this.brushSettings.opacity / 100) * (this.brushSettings.flow / 100));
        gl.uniform1f(gl.getUniformLocation(program, 'u_erase'), this.brushSettings.erase ? 1.0 : 0.0);

        // Draw full-screen quad
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
    }

    /**
     * Create a radial gradient mask
     */
    createRadialMask(centerX, centerY, innerRadius, outerRadius, invert = false) {
        if (this.activeLayerIndex < 0) return;

        const layer = this.layers[this.activeLayerIndex];
        const gl = this.gl;
        const program = this.programs.get('radialGradient');
        if (!program) return;

        const width = this.gpu.width;
        const height = this.gpu.height;

        // Store shape for editing
        layer.shape = { centerX, centerY, innerRadius, outerRadius, invert };

        // Convert to UV
        const cx = centerX / width;
        const cy = 1.0 - (centerY / height);
        const ir = innerRadius / Math.max(width, height);
        const or = outerRadius / Math.max(width, height);

        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(program);

        gl.uniform2f(gl.getUniformLocation(program, 'u_center'), cx, cy);
        gl.uniform2f(gl.getUniformLocation(program, 'u_radii'), ir, or);
        gl.uniform1f(gl.getUniformLocation(program, 'u_feather'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_invert'), invert ? 1.0 : 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Get the active layer's adjustments
     */
    getActiveAdjustments() {
        if (this.activeLayerIndex < 0) return null;
        return this.layers[this.activeLayerIndex].adjustments;
    }

    /**
     * Set adjustment on active layer
     */
    setAdjustment(name, value) {
        if (this.activeLayerIndex < 0) return;
        this.layers[this.activeLayerIndex].adjustments[name] = value;
    }

    /**
     * Delete a layer
     */
    deleteLayer(index) {
        if (index < 0 || index >= this.layers.length) return;

        const layer = this.layers[index];
        const gl = this.gl;

        gl.deleteTexture(layer.maskTexture);
        gl.deleteFramebuffer(layer.maskFramebuffer);

        this.layers.splice(index, 1);

        if (this.activeLayerIndex >= this.layers.length) {
            this.activeLayerIndex = this.layers.length - 1;
        }
    }

    /**
     * Clear the active layer's mask
     */
    clearActiveMask() {
        if (this.activeLayerIndex < 0) return;

        const layer = this.layers[this.activeLayerIndex];
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}
