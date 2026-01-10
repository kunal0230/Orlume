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
            
            void main() {
                float dist = distance(v_texCoord, u_center);
                
                // Calculate falloff based on hardness
                float inner = u_radius * u_hardness;
                float alpha = 1.0 - smoothstep(inner, u_radius, dist);
                alpha *= u_opacity;
                
                // Output white with alpha - blending handles add/erase
                fragColor = vec4(1.0, 1.0, 1.0, alpha);
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

        // Mask overlay shader - shows mask as red overlay for visual feedback
        const maskOverlayFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform sampler2D u_mask;
            
            void main() {
                float maskValue = texture(u_mask, v_texCoord).a;
                // Red overlay with mask alpha
                fragColor = vec4(1.0, 0.3, 0.3, maskValue * 0.5);
            }
        `;

        // Masked adjustment shader - applies adjustments only in masked areas
        const maskedAdjustmentFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform sampler2D u_base;       // Current image
            uniform sampler2D u_mask;       // Mask texture
            
            // Local adjustments
            uniform float u_exposure;
            uniform float u_contrast;
            uniform float u_shadows;
            uniform float u_temperature;
            uniform float u_saturation;
            
            void main() {
                vec4 base = texture(u_base, v_texCoord);
                float maskValue = texture(u_mask, v_texCoord).a;
                
                if (maskValue < 0.001) {
                    fragColor = base;
                    return;
                }
                
                vec3 color = base.rgb;
                
                // Exposure
                float expMult = pow(2.0, u_exposure);
                color *= expMult;
                
                // Contrast
                color = (color - 0.5) * (1.0 + u_contrast) + 0.5;
                
                // Shadows lift
                float lum = dot(color, vec3(0.299, 0.587, 0.114));
                float shadowWeight = 1.0 - smoothstep(0.0, 0.3, lum);
                color += u_shadows * shadowWeight * 0.3;
                
                // Temperature
                color.r += u_temperature * 0.1;
                color.b -= u_temperature * 0.1;
                
                // Saturation
                float gray = dot(color, vec3(0.299, 0.587, 0.114));
                color = mix(vec3(gray), color, 1.0 + u_saturation);
                
                // Clamp
                color = clamp(color, 0.0, 1.0);
                
                // Blend based on mask
                fragColor = vec4(mix(base.rgb, color, maskValue), base.a);
            }
        `;

        // Compile programs
        this.programs.set('brushStamp', this._createProgram(vertexShader, brushStampFragment));
        this.programs.set('radialGradient', this._createProgram(vertexShader, radialGradientFragment));
        this.programs.set('linearGradient', this._createProgram(vertexShader, linearGradientFragment));
        this.programs.set('maskComposite', this._createProgram(vertexShader, maskCompositeFragment));
        this.programs.set('maskOverlay', this._createProgram(vertexShader, maskOverlayFragment));
        this.programs.set('maskedAdjustment', this._createProgram(vertexShader, maskedAdjustmentFragment));

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

        // Generate sequential layer name
        this._layerCounter = (this._layerCounter || 0) + 1;
        const defaultName = `${type}_${this._layerCounter}`;

        const layer = {
            id: Date.now(),
            type: type,  // 'brush', 'radial', 'gradient'
            name: defaultName,  // Editable layer name
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

        // Convert to UV coordinates for FBO rendering
        // Screen coords: y=0 at top, y=height at bottom
        // FBO coords (texCoordBufferFBO): y=0 at bottom, y=1 at top
        // So we flip Y: when user clicks at top (y≈0), centerY should be ≈1
        const centerX = x / width;
        const centerY = 1.0 - (y / height);  // Flip Y for FBO coordinate system
        const radiusX = this.brushSettings.size / width;
        const radiusY = this.brushSettings.size / height;
        const radius = Math.max(radiusX, radiusY);

        // Render to mask framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.viewport(0, 0, width, height);

        // Set up blending based on add/erase mode
        gl.enable(gl.BLEND);
        if (this.brushSettings.erase) {
            // Erase mode: subtract source alpha from destination
            gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
            gl.blendFunc(gl.ONE, gl.ONE);
        } else {
            // Add mode: blend source onto destination
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }

        gl.useProgram(program);

        // Set uniforms (no u_erase - blending handles it)
        gl.uniform2f(gl.getUniformLocation(program, 'u_center'), centerX, centerY);
        gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), radius);
        gl.uniform1f(gl.getUniformLocation(program, 'u_hardness'), this.brushSettings.hardness / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), (this.brushSettings.opacity / 100) * (this.brushSettings.flow / 100));

        // Draw full-screen quad
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        // Use FBO texture coords - consistent with WebGL FBO orientation
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Reset blend state
        gl.blendEquation(gl.FUNC_ADD);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
    }

    /**
     * Paint a stroke from one point to another with interpolation
     * This creates smooth, natural strokes by placing dabs at regular intervals
     * @param {number} x1 - Start X in image pixels
     * @param {number} y1 - Start Y in image pixels
     * @param {number} x2 - End X in image pixels
     * @param {number} y2 - End Y in image pixels
     */
    paintStroke(x1, y1, x2, y2) {
        if (this.activeLayerIndex < 0) return;

        // Spacing as percentage of brush size (15-25% gives natural results)
        const spacing = Math.max(2, this.brushSettings.size * 0.18);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) {
            // Points are essentially the same, just paint one dab
            this.paintBrush(x2, y2);
            return;
        }

        const steps = Math.ceil(dist / spacing);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + dx * t;
            const y = y1 + dy * t;
            this.paintBrush(x, y);
        }
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

        // Convert to UV with Y-flip for FBO coordinate system
        // Screen coords: y=0 at top; FBO coords: y=0 at bottom
        const cx = centerX / width;
        const cy = 1.0 - (centerY / height);  // Flip Y for FBO coords
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

        // Use FBO texture coords for consistency
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
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
     * Get the active layer object
     */
    getActiveLayer() {
        if (this.activeLayerIndex < 0) return null;
        return this.layers[this.activeLayerIndex];
    }

    /**
     * Set adjustment on active layer
     */
    setAdjustment(name, value) {
        if (this.activeLayerIndex < 0) return;
        this.layers[this.activeLayerIndex].adjustments[name] = value;
    }

    /**
     * Set adjustment on active layer (alias for UI compatibility)
     */
    setActiveAdjustment(name, value) {
        this.setAdjustment(name, value);
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

    /**
     * Render the active mask as a red overlay for visual feedback during painting
     */
    renderMaskOverlay() {
        if (this.activeLayerIndex < 0) return;

        const layer = this.layers[this.activeLayerIndex];
        const gl = this.gl;
        const program = this.programs.get('maskOverlay');
        if (!program) return;

        const width = this.gpu.width;
        const height = this.gpu.height;

        // Enable blending to overlay on existing canvas content
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(program);

        // Bind mask texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, layer.maskTexture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 0);

        // Draw full-screen quad
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        // Use FBO texture coords to match mask coordinate system
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disable(gl.BLEND);
    }

    /**
     * Apply all layer adjustments composited with masks.
     * Uses ping-pong buffers to properly chain multiple layer effects.
     * @param {WebGLTexture} baseTexture - The base processed image texture
     */
    applyMaskedAdjustments(baseTexture) {
        if (this.layers.length === 0 || !baseTexture) return baseTexture;

        const gl = this.gl;
        const program = this.programs.get('maskedAdjustment');
        if (!program) return baseTexture;

        const width = this.gpu.width;
        const height = this.gpu.height;

        // Initialize ping-pong buffers if needed
        if (!this._pingPongA || this._pingPongWidth !== width || this._pingPongHeight !== height) {
            // Clean up old resources
            if (this._pingPongA) gl.deleteTexture(this._pingPongA);
            if (this._pingPongB) gl.deleteTexture(this._pingPongB);
            if (this._pingPongFboA) gl.deleteFramebuffer(this._pingPongFboA);
            if (this._pingPongFboB) gl.deleteFramebuffer(this._pingPongFboB);

            this._pingPongWidth = width;
            this._pingPongHeight = height;

            // Create texture A
            this._pingPongA = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this._pingPongA);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            this._pingPongFboA = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._pingPongFboA);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._pingPongA, 0);

            // Create texture B
            this._pingPongB = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this._pingPongB);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            this._pingPongFboB = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._pingPongFboB);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._pingPongB, 0);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        let readTexture = baseTexture;
        let writeTexture = this._pingPongA;
        let writeFbo = this._pingPongFboA;
        let useA = true;

        // For each layer with adjustments, apply them
        for (const layer of this.layers) {
            if (!layer.visible) continue;

            // Check if any adjustments are non-zero
            const adj = layer.adjustments;
            if (adj.exposure === 0 && adj.contrast === 0 && adj.shadows === 0 &&
                adj.temperature === 0 && adj.saturation === 0) {
                continue;
            }

            // Apply masked adjustments
            gl.useProgram(program);

            // Bind base texture (current state)
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readTexture);
            gl.uniform1i(gl.getUniformLocation(program, 'u_base'), 0);

            // Bind mask texture
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, layer.maskTexture);
            gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 1);

            // Set adjustment uniforms
            gl.uniform1f(gl.getUniformLocation(program, 'u_exposure'), adj.exposure || 0);
            gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), (adj.contrast || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_shadows'), (adj.shadows || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_temperature'), (adj.temperature || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), (adj.saturation || 0) / 100);

            // Draw full-screen quad
            gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
            gl.enableVertexAttribArray(program.a_position);
            gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
            gl.enableVertexAttribArray(program.a_texCoord);
            gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

            // Render to output framebuffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
            gl.viewport(0, 0, width, height);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // Swap ping-pong buffers
            readTexture = writeTexture;
            if (useA) {
                writeTexture = this._pingPongB;
                writeFbo = this._pingPongFboB;
            } else {
                writeTexture = this._pingPongA;
                writeFbo = this._pingPongFboA;
            }
            useA = !useA;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);

        return readTexture;
    }
}
