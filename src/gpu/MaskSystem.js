/**
 * MaskSystem - Local Adjustment Masks for GPU Editor (WebGL2)
 * 
 * Provides brush, radial, and linear gradient masks for localized adjustments.
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

        // UI state
        this.showOverlay = false;
        this.isMaskMode = true;
        this._isPaintingOverlay = false;
        this.overlayColors = [
            { name: 'Red', rgb: [1.0, 0.25, 0.25], hex: '#ef4444' },
            { name: 'Green', rgb: [0.15, 0.9, 0.35], hex: '#22c55e' },
            { name: 'Blue', rgb: [0.25, 0.6, 1.0], hex: '#3b82f6' },
            { name: 'White', rgb: [1.0, 1.0, 1.0], hex: '#ffffff' },
            { name: 'Black', rgb: [0.08, 0.08, 0.08], hex: '#1f2937' }
        ];
        this.overlayColorIndex = 0;
        this._layerCounter = 0;
        this._pendingLayers = [];

        // Compiled mask programs
        this.programs = new Map();

        this._init();
    }

    _init() {
        this._compilePrograms();
    }

    _compilePrograms() {
        const gl = this.gl;
        if (!gl) return;

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

        // Brush stamp shader - isotropic aspect ratio correction
        const brushStampFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform vec2 u_center;      // Brush center in UV coords
            uniform float u_radius;     // Brush radius in height-normalized coords
            uniform float u_hardness;   // 0-1 (soft to hard)
            uniform float u_opacity;    // 0-1
            uniform float u_aspect;     // width / height
            
            void main() {
                vec2 diff = v_texCoord - u_center;
                diff.x *= u_aspect;
                float dist = length(diff);
                
                // Calculate falloff based on hardness
                float inner = u_radius * u_hardness;
                float alpha = 1.0 - smoothstep(inner, u_radius, dist);
                alpha *= u_opacity;
                
                // Output white with alpha - blending handles add/erase
                fragColor = vec4(1.0, 1.0, 1.0, alpha);
            }
        `;

        // Radial gradient shader - isotropic, default inside out
        const radialGradientFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform vec2 u_center;      // Center in UV coords
            uniform vec2 u_radii;       // Inner and outer radii (height-normalized)
            uniform float u_aspect;     // width / height
            uniform float u_invert;     // 0 or 1
            
            void main() {
                vec2 diff = v_texCoord - u_center;
                diff.x *= u_aspect;
                float dist = length(diff);
                
                float maxR = max(u_radii.y, u_radii.x + 0.0001);
                float alpha = 1.0 - smoothstep(u_radii.x, maxR, dist);
                
                if (u_invert > 0.5) {
                    alpha = 1.0 - alpha;
                }
                
                fragColor = vec4(1.0, 1.0, 1.0, alpha);
            }
        `;

        // Linear gradient shader - isotropic half-plane ramp
        const linearGradientFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform vec2 u_start;       // Start point in UV
            uniform vec2 u_end;         // End point in UV
            uniform float u_aspect;     // width / height
            uniform float u_invert;
            
            void main() {
                vec2 p = v_texCoord;
                p.x *= u_aspect;
                vec2 s = u_start;
                s.x *= u_aspect;
                vec2 e = u_end;
                e.x *= u_aspect;
                
                vec2 dir = e - s;
                float lenSq = dot(dir, dir);
                
                float alpha = 1.0;
                if (lenSq > 0.000001) {
                    float t = clamp(dot(p - s, dir) / lenSq, 0.0, 1.0);
                    alpha = 1.0 - smoothstep(0.0, 1.0, t);
                }
                
                if (u_invert > 0.5) {
                    alpha = 1.0 - alpha;
                }
                
                fragColor = vec4(1.0, 1.0, 1.0, alpha);
            }
        `;

        // Mask invert shader
        const maskInvertFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform sampler2D u_mask;
            
            void main() {
                float maskValue = texture(u_mask, v_texCoord).a;
                fragColor = vec4(1.0, 1.0, 1.0, 1.0 - maskValue);
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

        // Mask overlay shader - shows mask with customizable overlay color
        const maskOverlayFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform sampler2D u_mask;
            uniform vec3 u_overlayColor;
            uniform float u_overlayOpacity;
            
            void main() {
                float maskValue = texture(u_mask, v_texCoord).a;
                fragColor = vec4(u_overlayColor, maskValue * u_overlayOpacity);
            }
        `;

        // Masked adjustment shader - applies adjustments only in masked areas with Pro tonal controls
        const maskedAdjustmentFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            out vec4 fragColor;
            
            uniform sampler2D u_base;       // Current image
            uniform sampler2D u_mask;       // Mask texture
            
            // Local adjustments
            uniform float u_exposure;
            uniform float u_contrast;
            uniform float u_highlights;
            uniform float u_shadows;
            uniform float u_temperature;
            uniform float u_tint;
            uniform float u_saturation;
            uniform float u_clarity;
            uniform float u_density;
            uniform float u_lumMin;
            uniform float u_lumMax;
            uniform float u_lumFeather;
            uniform float u_useLumRange;
            
            void main() {
                vec4 base = texture(u_base, v_texCoord);
                float rawMask = texture(u_mask, v_texCoord).a;
                float maskValue = clamp(rawMask * u_density, 0.0, 1.0);
                
                // Luminance range qualification (Lightroom style)
                if (u_useLumRange > 0.5) {
                    float baseLum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
                    float feather = max(0.005, u_lumFeather);
                    float lowWeight = smoothstep(u_lumMin - feather, u_lumMin, baseLum);
                    float highWeight = 1.0 - smoothstep(u_lumMax, u_lumMax + feather, baseLum);
                    maskValue = maskValue * lowWeight * highWeight;
                }
                
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
                
                // Luminance for tonal weighting
                float lum = dot(color, vec3(0.299, 0.587, 0.114));
                
                // Shadows lift / drop
                float shadowWeight = 1.0 - smoothstep(0.0, 0.35, lum);
                color += u_shadows * shadowWeight * 0.3;
                
                // Highlights recovery / boost
                float highlightWeight = smoothstep(0.65, 1.0, lum);
                color += u_highlights * highlightWeight * 0.3;
                
                // White balance (Temperature & Tint)
                color.r += u_temperature * 0.1;
                color.b -= u_temperature * 0.1;
                color.g -= u_tint * 0.08;
                color.r += u_tint * 0.04;
                color.b += u_tint * 0.04;
                
                // Clarity (Midtone contrast)
                float midtoneWeight = 1.0 - abs(lum - 0.5) * 2.0;
                color += (color - vec3(lum)) * u_clarity * midtoneWeight * 0.6;
                
                // Saturation
                float gray = dot(color, vec3(0.299, 0.587, 0.114));
                color = mix(vec3(gray), color, 1.0 + u_saturation);
                
                // Clamp
                color = clamp(color, 0.0, 1.0);
                
                // Blend based on effective maskValue
                fragColor = vec4(mix(base.rgb, color, maskValue), base.a);
            }
        `;

        // Compile programs
        this.programs.set('brushStamp', this._createProgram(vertexShader, brushStampFragment));
        this.programs.set('radialGradient', this._createProgram(vertexShader, radialGradientFragment));
        this.programs.set('linearGradient', this._createProgram(vertexShader, linearGradientFragment));
        this.programs.set('maskInvert', this._createProgram(vertexShader, maskInvertFragment));
        this.programs.set('maskComposite', this._createProgram(vertexShader, maskCompositeFragment));
        this.programs.set('maskOverlay', this._createProgram(vertexShader, maskOverlayFragment));
        this.programs.set('maskedAdjustment', this._createProgram(vertexShader, maskedAdjustmentFragment));
    }

    _createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;
        if (!gl) return null;

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
        if (!gl) return null;
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
     * @param {string} type - 'brush' | 'radial' | 'gradient'
     * @param {string} [name] - Optional custom name
     */
    createLayer(type = 'brush', name = null) {
        const gl = this.gl;
        const width = this.gpu?.width || 0;
        const height = this.gpu?.height || 0;

        // If dimensions not yet set (no image loaded), queue layer for creation on load
        if (width <= 0 || height <= 0 || !gl) {
            this._pendingLayers.push({ type, name });
            return null;
        }

        // Create mask texture
        const maskTexture = gl.createTexture();
        if (!maskTexture) return null;
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
        const defaultName = name || `${type}_${this._layerCounter}`;

        const layer = {
            id: Date.now() + Math.random(),
            type: type,  // 'brush', 'radial', 'gradient'
            name: defaultName,
            maskTexture: maskTexture,
            maskFramebuffer: maskFramebuffer,
            width: width,
            height: height,
            adjustments: {
                density: 100,
                exposure: 0,
                contrast: 0,
                highlights: 0,
                shadows: 0,
                temperature: 0,
                tint: 0,
                saturation: 0,
                clarity: 0,
                lumMin: 0,
                lumMax: 100,
                lumFeather: 20,
                useLumRange: 0
            },
            shape: null,
            visible: true,
            strokes: [] // History of brush strokes for this layer
        };

        this.layers.push(layer);
        this.activeLayerIndex = this.layers.length - 1;

        return layer;
    }

    /**
     * Create a brush mask layer (alias)
     */
    createBrushLayer(name) {
        return this.createLayer('brush', name);
    }

    /**
     * Create a radial mask layer (alias)
     */
    createRadialLayer(name) {
        return this.createLayer('radial', name);
    }

    /**
     * Create a gradient/linear mask layer (alias)
     */
    createGradientLayer(name) {
        return this.createLayer('gradient', name);
    }

    createLinearLayer(name) {
        return this.createGradientLayer(name);
    }

    /**
     * Duplicate a layer
     */
    duplicateLayer(index) {
        if (index < 0 || index >= this.layers.length) return null;
        const src = this.layers[index];
        const newLayer = this.createLayer(src.type, `${src.name} Copy`);
        if (!newLayer) return null;

        newLayer.adjustments = { ...src.adjustments };
        newLayer.shape = src.shape ? { ...src.shape } : null;
        newLayer.strokes = src.strokes ? JSON.parse(JSON.stringify(src.strokes)) : [];
        newLayer.visible = src.visible !== false;

        this.replayLayer(newLayer.id);
        return newLayer;
    }

    /**
     * Delete a layer
     */
    deleteLayer(index) {
        if (index < 0 || index >= this.layers.length) return;

        const layer = this.layers[index];
        const gl = this.gl;

        if (layer.maskTexture) gl.deleteTexture(layer.maskTexture);
        if (layer.maskFramebuffer) gl.deleteFramebuffer(layer.maskFramebuffer);

        this.layers.splice(index, 1);

        if (this.activeLayerIndex === index) {
            this.activeLayerIndex = Math.min(index, this.layers.length - 1);
        } else if (this.activeLayerIndex > index) {
            this.activeLayerIndex--;
        }
    }

    /**
     * Toggle layer visibility
     */
    toggleLayerVisibility(index) {
        if (index >= 0 && index < this.layers.length) {
            this.layers[index].visible = !this.layers[index].visible;
            return this.layers[index].visible;
        }
        return false;
    }

    /**
     * Clear the active layer's mask
     */
    clearActiveMask() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        const gl = this.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        layer.strokes = [];
        layer.shape = null;
    }

    /**
     * Invert the active layer's mask
     */
    invertActiveMask() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;
        const layer = this.layers[this.activeLayerIndex];
        if (!layer) return;

        if (layer.shape && (layer.type === 'radial' || layer.type === 'gradient')) {
            layer.shape.invert = !layer.shape.invert;
            if (layer.type === 'radial') {
                this.createRadialMask(
                    layer.shape.centerX,
                    layer.shape.centerY,
                    layer.shape.innerRadius,
                    layer.shape.outerRadius,
                    layer.shape.invert
                );
            } else {
                this.createLinearMask(
                    layer.shape.startX,
                    layer.shape.startY,
                    layer.shape.endX,
                    layer.shape.endY,
                    layer.shape.feather,
                    layer.shape.invert
                );
            }
            return;
        }

        const gl = this.gl;
        const program = this.programs.get('maskInvert');
        if (!program || !layer.maskTexture) return;

        const width = this.gpu.width;
        const height = this.gpu.height;

        // Render inverted mask to a temp texture, then swap
        const tempTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tempTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        const tempFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tempTex, 0);

        gl.viewport(0, 0, width, height);
        gl.useProgram(program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, layer.maskTexture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Swap textures
        gl.deleteTexture(layer.maskTexture);
        layer.maskTexture = tempTex;

        // Re-bind to layer framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer.maskTexture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(tempFBO);
    }

    /**
     * Paint a brush stroke at the given coordinates
     * @param {number} x - X coordinate in image pixels
     * @param {number} y - Y coordinate in image pixels
     * @param {boolean} record - Whether to record this stroke in history
     */
    paintBrush(x, y, record = true) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;
        const layer = this.layers[this.activeLayerIndex];
        if (!layer) return;

        // Record stroke
        if (record) {
            if (!layer.strokes) layer.strokes = [];
            layer.strokes.push({
                type: 'brush',
                x, y,
                settings: { ...this.brushSettings }
            });
        }

        if (layer.type !== 'brush') return;

        const gl = this.gl;
        const program = this.programs.get('brushStamp');
        if (!program) return;

        const width = this.gpu.width;
        const height = this.gpu.height;
        if (width <= 0 || height <= 0) return;

        // FBO coords: y=0 at bottom, y=1 at top -> Flip Y
        const centerX = x / width;
        const centerY = 1.0 - (y / height);
        const aspect = width / height;
        const radius = this.brushSettings.size / height;

        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.viewport(0, 0, width, height);

        gl.enable(gl.BLEND);
        if (this.brushSettings.erase) {
            gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
            gl.blendFunc(gl.ONE, gl.ONE);
        } else {
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }

        gl.useProgram(program);

        gl.uniform2f(gl.getUniformLocation(program, 'u_center'), centerX, centerY);
        gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), radius);
        gl.uniform1f(gl.getUniformLocation(program, 'u_hardness'), this.brushSettings.hardness / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), (this.brushSettings.opacity / 100) * (this.brushSettings.flow / 100));
        gl.uniform1f(gl.getUniformLocation(program, 'u_aspect'), aspect);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.blendEquation(gl.FUNC_ADD);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
    }

    /**
     * Paint a stroke from one point to another with interpolation
     */
    paintStroke(x1, y1, x2, y2, record = true) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;
        const layer = this.layers[this.activeLayerIndex];
        if (!layer) return;

        if (record) {
            if (!layer.strokes) layer.strokes = [];
            layer.strokes.push({
                type: 'stroke',
                x1, y1, x2, y2,
                settings: { ...this.brushSettings }
            });
        }

        const spacing = Math.max(2, this.brushSettings.size * 0.18);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) {
            this.paintBrush(x2, y2, false);
            return;
        }

        const steps = Math.ceil(dist / spacing);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            this.paintBrush(x1 + dx * t, y1 + dy * t, false);
        }
    }

    /**
     * Replay all strokes or redraw shape on a layer
     */
    replayLayer(layerId) {
        const layer = this.layers.find(l => l.id === layerId);
        if (!layer) return;

        const prevActiveIndex = this.activeLayerIndex;
        const prevSettings = { ...this.brushSettings };
        this.activeLayerIndex = this.layers.indexOf(layer);

        if (layer.type === 'radial' && layer.shape) {
            this.createRadialMask(
                layer.shape.centerX,
                layer.shape.centerY,
                layer.shape.innerRadius,
                layer.shape.outerRadius,
                layer.shape.invert
            );
        } else if (layer.type === 'gradient' && layer.shape) {
            this.createLinearMask(
                layer.shape.startX,
                layer.shape.startY,
                layer.shape.endX,
                layer.shape.endY,
                layer.shape.feather,
                layer.shape.invert
            );
        } else {
            // Clear the mask
            const gl = this.gl;
            if (layer.maskFramebuffer) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            }
        }

        // Replay brush strokes if present
        if (layer.strokes && layer.strokes.length > 0) {
            for (const op of layer.strokes) {
                this.brushSettings = { ...op.settings };
                if (op.type === 'brush') {
                    this.paintBrush(op.x, op.y, false);
                } else if (op.type === 'stroke') {
                    this.paintStroke(op.x1, op.y1, op.x2, op.y2, false);
                }
            }
        }

        this.brushSettings = prevSettings;
        this.activeLayerIndex = prevActiveIndex;
    }

    /**
     * Create a radial gradient mask
     */
    createRadialMask(centerX, centerY, innerRadius, outerRadius, invert = false) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        const gl = this.gl;
        const program = this.programs.get('radialGradient');
        if (!program || !layer) return;

        const width = this.gpu.width;
        const height = this.gpu.height;
        if (width <= 0 || height <= 0) return;

        layer.shape = { centerX, centerY, innerRadius, outerRadius, invert };

        const cx = centerX / width;
        const cy = 1.0 - (centerY / height);
        const aspect = width / height;
        const ir = innerRadius / height;
        const or = outerRadius / height;

        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(program);

        gl.uniform2f(gl.getUniformLocation(program, 'u_center'), cx, cy);
        gl.uniform2f(gl.getUniformLocation(program, 'u_radii'), ir, or);
        gl.uniform1f(gl.getUniformLocation(program, 'u_aspect'), aspect);
        gl.uniform1f(gl.getUniformLocation(program, 'u_invert'), invert ? 1.0 : 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Create a linear gradient mask
     */
    createLinearMask(startX, startY, endX, endY, feather = 0.5, invert = false) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        const gl = this.gl;
        const program = this.programs.get('linearGradient');
        if (!program || !layer) return;

        const width = this.gpu.width;
        const height = this.gpu.height;
        if (width <= 0 || height <= 0) return;

        layer.shape = { startX, startY, endX, endY, feather, invert };

        const sx = startX / width;
        const sy = 1.0 - (startY / height);
        const ex = endX / width;
        const ey = 1.0 - (endY / height);
        const aspect = width / height;

        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(program);

        gl.uniform2f(gl.getUniformLocation(program, 'u_start'), sx, sy);
        gl.uniform2f(gl.getUniformLocation(program, 'u_end'), ex, ey);
        gl.uniform1f(gl.getUniformLocation(program, 'u_aspect'), aspect);
        gl.uniform1f(gl.getUniformLocation(program, 'u_invert'), invert ? 1.0 : 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Called when image dimensions change
     */
    onImageDimensionsChanged() {
        const gl = this.gl;
        const width = this.gpu.width;
        const height = this.gpu.height;
        if (width <= 0 || height <= 0 || !gl) return;

        // Process any queued layers
        if (this._pendingLayers && this._pendingLayers.length > 0) {
            const pending = [...this._pendingLayers];
            this._pendingLayers = [];
            for (const item of pending) {
                this.createLayer(item.type, item.name);
            }
        }

        // Recreate textures and framebuffers for existing layers
        for (const layer of this.layers) {
            if (layer.width !== width || layer.height !== height) {
                if (layer.maskTexture) gl.deleteTexture(layer.maskTexture);
                if (layer.maskFramebuffer) gl.deleteFramebuffer(layer.maskFramebuffer);

                layer.maskTexture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, layer.maskTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

                layer.maskFramebuffer = gl.createFramebuffer();
                gl.bindFramebuffer(gl.FRAMEBUFFER, layer.maskFramebuffer);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer.maskTexture, 0);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                layer.width = width;
                layer.height = height;

                this.replayLayer(layer.id);
            }
        }

        // Clean up ping-pong buffers so they resize
        if (this._pingPongA) {
            gl.deleteTexture(this._pingPongA);
            gl.deleteTexture(this._pingPongB);
            gl.deleteFramebuffer(this._pingPongFboA);
            gl.deleteFramebuffer(this._pingPongFboB);
            this._pingPongA = null;
            this._pingPongB = null;
            this._pingPongFboA = null;
            this._pingPongFboB = null;
        }
    }

    /**
     * Check if active masks exist with non-zero adjustments
     */
    hasActiveMasks() {
        return this.layers.length > 0 && this.layers.some(l => l.visible && l.adjustments && Object.entries(l.adjustments).some(([k, v]) => k === 'density' ? v < 100 : v !== 0));
    }

    /**
     * Toggle mask overlay
     */
    toggleOverlay() {
        this.showOverlay = !this.showOverlay;
        return this.showOverlay;
    }

    /**
     * Cycle through Photoshop/Lightroom overlay colors (Red, Green, Blue, White, Black)
     */
    cycleOverlayColor() {
        this.overlayColorIndex = (this.overlayColorIndex + 1) % this.overlayColors.length;
        return this.overlayColors[this.overlayColorIndex];
    }

    /**
     * Get current overlay color configuration
     */
    getCurrentOverlayColor() {
        return this.overlayColors[this.overlayColorIndex] || this.overlayColors[0];
    }

    shouldShowOverlay() {
        return Boolean(this.isMaskMode !== false && (this.showOverlay || this._isPaintingOverlay) && this.activeLayerIndex >= 0 && this.layers.length > 0);
    }

    /**
     * Get active layer adjustments
     */
    getActiveAdjustments() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return null;
        return this.layers[this.activeLayerIndex].adjustments;
    }

    /**
     * Get the active layer object
     */
    getActiveLayer() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return null;
        return this.layers[this.activeLayerIndex];
    }

    /**
     * Set adjustment on active layer
     */
    setAdjustment(name, value) {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;
        this.layers[this.activeLayerIndex].adjustments[name] = value;
    }

    setActiveAdjustment(name, value) {
        this.setAdjustment(name, value);
    }

    _getRawTexture(tex) {
        if (!tex) return null;
        if (typeof WebGLTexture !== 'undefined' && tex instanceof WebGLTexture) {
            return tex;
        }
        if (tex._internal && typeof WebGLTexture !== 'undefined' && tex._internal instanceof WebGLTexture) {
            return tex._internal;
        }
        return null;
    }

    _isValidTexture(tex) {
        if (!tex || typeof WebGLTexture === 'undefined') return false;
        const raw = (tex instanceof WebGLTexture) ? tex : tex?._internal;
        if (!raw || !(raw instanceof WebGLTexture)) return false;
        try {
            return !!this.gl?.isTexture(raw);
        } catch {
            return false;
        }
    }

    /**
     * Render the active mask as a red overlay
     */
    renderMaskOverlay() {
        if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) return;

        const layer = this.layers[this.activeLayerIndex];
        const gl = this.gl;
        if (!layer || !this._isValidTexture(layer.maskTexture)) return;
        const program = this.programs.get('maskOverlay');
        if (!program) return;

        const width = this.gpu.width;
        const height = this.gpu.height;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, layer.maskTexture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 0);

        const overlayColor = this.getCurrentOverlayColor();
        gl.uniform3f(gl.getUniformLocation(program, 'u_overlayColor'), overlayColor.rgb[0], overlayColor.rgb[1], overlayColor.rgb[2]);
        gl.uniform1f(gl.getUniformLocation(program, 'u_overlayOpacity'), 0.5);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disable(gl.BLEND);
    }

    /**
     * Apply all layer adjustments composited with masks
     */
    applyMaskedAdjustments(baseTexture) {
        if (this.layers.length === 0 || !baseTexture) return baseTexture;

        const rawBase = this._getRawTexture(baseTexture);
        if (!rawBase || !this._isValidTexture(rawBase)) return baseTexture;

        const hasAdjustments = this.layers.some(layer =>
            layer.visible && layer.adjustments && Object.entries(layer.adjustments).some(([k, v]) => k === 'density' ? v < 100 : v !== 0)
        );
        if (!hasAdjustments) return baseTexture;

        const gl = this.gl;
        const program = this.programs.get('maskedAdjustment');
        if (!program) return baseTexture;

        const width = this.gpu.width;
        const height = this.gpu.height;

        // Initialize ping-pong buffers
        if (!this._pingPongA || this._pingPongWidth !== width || this._pingPongHeight !== height) {
            if (this._pingPongA) gl.deleteTexture(this._pingPongA);
            if (this._pingPongB) gl.deleteTexture(this._pingPongB);
            if (this._pingPongFboA) gl.deleteFramebuffer(this._pingPongFboA);
            if (this._pingPongFboB) gl.deleteFramebuffer(this._pingPongFboB);

            this._pingPongWidth = width;
            this._pingPongHeight = height;

            this._pingPongA = gl.createTexture();
            if (!this._pingPongA) return baseTexture;
            gl.bindTexture(gl.TEXTURE_2D, this._pingPongA);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            this._pingPongFboA = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._pingPongFboA);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._pingPongA, 0);

            this._pingPongB = gl.createTexture();
            if (!this._pingPongB) {
                gl.deleteTexture(this._pingPongA);
                this._pingPongA = null;
                return baseTexture;
            }
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

        let readTexture = rawBase;
        let writeTexture = this._pingPongA;
        let writeFbo = this._pingPongFboA;
        let useA = true;

        for (const layer of this.layers) {
            if (!layer.visible) continue;

            const adj = layer.adjustments;
            if (!adj || Object.entries(adj).every(([k, v]) => k === 'density' ? v === 100 : v === 0)) {
                continue;
            }

            gl.useProgram(program);

            if (!this._isValidTexture(readTexture)) {
                return baseTexture;
            }
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, readTexture);
            gl.uniform1i(gl.getUniformLocation(program, 'u_base'), 0);

            if (!this._isValidTexture(layer.maskTexture)) {
                continue;
            }
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, layer.maskTexture);
            gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 1);

            gl.uniform1f(gl.getUniformLocation(program, 'u_exposure'), adj.exposure || 0);
            gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), (adj.contrast || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_highlights'), (adj.highlights || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_shadows'), (adj.shadows || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_temperature'), (adj.temperature || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_tint'), (adj.tint || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), (adj.saturation || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_clarity'), (adj.clarity || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_density'), adj.density !== undefined ? adj.density / 100 : 1.0);
            gl.uniform1f(gl.getUniformLocation(program, 'u_lumMin'), (adj.lumMin || 0) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_lumMax'), (adj.lumMax !== undefined ? adj.lumMax : 100) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_lumFeather'), (adj.lumFeather !== undefined ? adj.lumFeather : 20) / 100);
            gl.uniform1f(gl.getUniformLocation(program, 'u_useLumRange'), adj.useLumRange ? 1.0 : 0.0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.positionBuffer);
            gl.enableVertexAttribArray(program.a_position);
            gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.gpu.texCoordBufferFBO);
            gl.enableVertexAttribArray(program.a_texCoord);
            gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

            gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
            gl.viewport(0, 0, width, height);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

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

        if (readTexture === rawBase) {
            return baseTexture;
        }

        if (baseTexture && typeof baseTexture === 'object' && ('_internal' in baseTexture)) {
            return {
                width: baseTexture.width || width,
                height: baseTexture.height || height,
                _internal: readTexture
            };
        }

        return readTexture;
    }

    /**
     * Reset and dispose of all layers and resources
     */
    reset() {
        const gl = this.gl;
        for (const layer of this.layers) {
            if (layer.maskTexture) gl.deleteTexture(layer.maskTexture);
            if (layer.maskFramebuffer) gl.deleteFramebuffer(layer.maskFramebuffer);
        }
        this.layers = [];
        this.activeLayerIndex = -1;
        this.showOverlay = false;

        if (this._pingPongA) {
            gl.deleteTexture(this._pingPongA);
            gl.deleteTexture(this._pingPongB);
            gl.deleteFramebuffer(this._pingPongFboA);
            gl.deleteFramebuffer(this._pingPongFboB);
            this._pingPongA = null;
            this._pingPongB = null;
            this._pingPongFboA = null;
            this._pingPongFboB = null;
        }
    }
}
