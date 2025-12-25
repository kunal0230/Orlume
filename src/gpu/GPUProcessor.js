/**
 * GPUProcessor - WebGL2 Image Processing Pipeline
 * 
 * Core GPU-accelerated image processing with:
 * - Texture management (input/output/ping-pong buffers)
 * - Shader compilation and caching
 * - Frame buffer chaining for multi-pass effects
 * - Real-time parameter updates via uniforms
 */

export class GPUProcessor {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;

        // Textures
        this.inputTexture = null;
        this.outputTexture = null;

        // Ping-pong buffers for chained effects
        this.bufferA = null;
        this.bufferB = null;
        this.textureA = null;
        this.textureB = null;

        // Shader programs cache
        this.programs = new Map();

        // Current image dimensions
        this.width = 0;
        this.height = 0;

        // Adjustment parameters (uniforms)
        this.params = {
            exposure: 0,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            temperature: 0,
            tint: 0,
            vibrance: 0,
            saturation: 0,
            clarity: 0,
            texture: 0
        };

        this._init();
    }

    _init() {
        // Get WebGL2 context
        this.gl = this.canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: true,
            premultipliedAlpha: false
        });

        if (!this.gl) {
            throw new Error('WebGL2 not supported');
        }

        const gl = this.gl;

        // Enable required extensions
        gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');

        // Create full-screen quad for rendering
        this._createQuad();

        // Compile base shaders
        this._compileShaders();

        console.log('🎮 GPUProcessor initialized (WebGL2)');
    }

    _createQuad() {
        const gl = this.gl;

        // Vertex positions for full-screen quad
        const positions = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        // Texture coordinates (Y flipped for correct orientation)
        // WebGL origin is bottom-left, but textures load from top-left
        const texCoords = new Float32Array([
            0, 1,   // bottom-left vertex → top of texture
            1, 1,   // bottom-right vertex → top of texture  
            0, 0,   // top-left vertex → bottom of texture
            1, 0    // top-right vertex → bottom of texture
        ]);

        // Position buffer
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        // Texture coordinate buffer
        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
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
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }

        // Get attribute and uniform locations
        program.a_position = gl.getAttribLocation(program, 'a_position');
        program.a_texCoord = gl.getAttribLocation(program, 'a_texCoord');
        program.u_texture = gl.getUniformLocation(program, 'u_texture');

        return program;
    }

    _compileShaders() {
        // Common vertex shader (used by all fragment shaders)
        const vertexShader = `#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            out vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        // Passthrough shader (identity)
        const passthroughFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            uniform sampler2D u_texture;
            out vec4 fragColor;
            
            void main() {
                fragColor = texture(u_texture, v_texCoord);
            }
        `;

        // Full develop pipeline shader (all adjustments combined)
        const developFragment = `#version 300 es
            precision highp float;
            in vec2 v_texCoord;
            uniform sampler2D u_texture;
            out vec4 fragColor;
            
            // Adjustment uniforms
            uniform float u_exposure;
            uniform float u_contrast;
            uniform float u_highlights;
            uniform float u_shadows;
            uniform float u_whites;
            uniform float u_blacks;
            uniform float u_temperature;
            uniform float u_tint;
            uniform float u_vibrance;
            uniform float u_saturation;
            uniform float u_clarity;
            
            // sRGB to Linear
            float sRGBtoLinear(float c) {
                return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
            }
            
            // Linear to sRGB
            float linearToSRGB(float c) {
                return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
            }
            
            // Luminance (Rec. 709)
            float luminance(vec3 c) {
                return dot(c, vec3(0.2126, 0.7152, 0.0722));
            }
            
            // Zone weights
            float shadowWeight(float L) {
                return smoothstep(0.3, 0.0, L);
            }
            
            float midtoneWeight(float L) {
                return exp(-pow((L - 0.5) / 0.25, 2.0) * 0.5);
            }
            
            float highlightWeight(float L) {
                return smoothstep(0.7, 1.0, L);
            }
            
            // Soft shoulder for highlight protection
            float softShoulder(float x, float knee) {
                if (x <= knee) return x;
                float over = x - knee;
                return knee + over / (1.0 + over * 2.0);
            }
            
            // RGB to OKLab
            vec3 linearRGBtoOKLab(vec3 rgb) {
                float l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
                float m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
                float s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
                
                l = pow(max(0.0, l), 1.0/3.0);
                m = pow(max(0.0, m), 1.0/3.0);
                s = pow(max(0.0, s), 1.0/3.0);
                
                return vec3(
                    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
                );
            }
            
            // OKLab to RGB
            vec3 OKLabToLinearRGB(vec3 lab) {
                float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
                float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
                float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
                
                l = l * l * l;
                m = m * m * m;
                s = s * s * s;
                
                return vec3(
                    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
                );
            }
            
            void main() {
                vec4 pixel = texture(u_texture, v_texCoord);
                
                // Convert to linear
                vec3 linear = vec3(
                    sRGBtoLinear(pixel.r),
                    sRGBtoLinear(pixel.g),
                    sRGBtoLinear(pixel.b)
                );
                
                float L = luminance(linear);
                float midW = midtoneWeight(L);
                float shadowW = shadowWeight(L);
                float highlightW = highlightWeight(L);
                
                // === EXPOSURE (zone-weighted with soft shoulder) ===
                if (u_exposure != 0.0) {
                    float gain = pow(2.0, u_exposure);
                    float effectiveGain = 1.0 + (gain - 1.0) * (0.5 + midW * 0.5);
                    linear *= effectiveGain;
                    
                    // Soft shoulder for highlight protection
                    if (u_exposure > 0.0) {
                        float newL = luminance(linear);
                        if (newL > 0.7) {
                            float protectedL = softShoulder(newL, 0.7);
                            linear *= protectedL / max(newL, 0.001);
                        }
                    }
                }
                
                // Recalculate luminance after exposure
                L = luminance(linear);
                midW = midtoneWeight(L);
                shadowW = shadowWeight(L);
                highlightW = highlightWeight(L);
                
                // === CONTRAST (zone-weighted S-curve) ===
                if (u_contrast != 0.0) {
                    float k = u_contrast > 0.0 
                        ? pow(abs(u_contrast), 0.7) * 3.5 
                        : -pow(abs(u_contrast), 0.7) * 0.6;
                    
                    float effectiveK = k * (0.3 + midW * 0.7);
                    float delta = L - 0.18;
                    float newL;
                    
                    if (u_contrast > 0.0) {
                        float compressed = delta / (1.0 + abs(delta) * abs(effectiveK));
                        newL = 0.18 + compressed * (1.0 + abs(effectiveK) * 0.5);
                        
                        // Shadow protection
                        if (shadowW > 0.3) {
                            newL = L + (newL - L) * (1.0 - shadowW * 0.5);
                        }
                        // Highlight protection
                        if (highlightW > 0.3) {
                            newL = L + (newL - L) * (1.0 - highlightW * 0.4);
                        }
                    } else {
                        newL = L + (0.18 - L) * abs(effectiveK);
                    }
                    
                    linear *= max(newL, 0.0) / max(L, 0.001);
                }
                
                // === HIGHLIGHTS / SHADOWS ===
                L = luminance(linear);
                if (u_highlights != 0.0) {
                    float hw = highlightWeight(L);
                    float adjustment = 1.0 + u_highlights * hw * 0.5;
                    linear *= adjustment;
                }
                
                L = luminance(linear);
                if (u_shadows != 0.0) {
                    float sw = shadowWeight(L);
                    float adjustment = 1.0 + u_shadows * sw * 0.5;
                    linear *= adjustment;
                }
                
                // === WHITES (extreme highlights) ===
                L = luminance(linear);
                if (u_whites != 0.0) {
                    float whiteW = smoothstep(0.85, 1.0, L);
                    float adjustment = 1.0 + u_whites * whiteW * 0.4;
                    linear *= adjustment;
                }
                
                // === BLACKS (deep shadows) ===
                L = luminance(linear);
                if (u_blacks != 0.0) {
                    float blackW = smoothstep(0.15, 0.0, L);
                    float adjustment = 1.0 + u_blacks * blackW * 0.4;
                    linear *= adjustment;
                }
                
                // === WHITE BALANCE (zone-aware with stronger effect) ===
                if (u_temperature != 0.0 || u_tint != 0.0) {
                    // Stronger multipliers for more noticeable effect
                    linear.r *= 1.0 + u_temperature * 0.25;
                    linear.b *= 1.0 - u_temperature * 0.25;
                    linear.g *= 1.0 - u_tint * 0.15;
                    linear.r *= 1.0 + u_tint * 0.08; // Tint also affects red slightly
                }
                
                // === VIBRANCE / SATURATION (OKLab) ===
                if (u_vibrance != 0.0 || u_saturation != 0.0) {
                    vec3 lab = linearRGBtoOKLab(linear);
                    float chroma = length(lab.yz);
                    
                    // Vibrance: boost low-saturated colors more
                    if (u_vibrance != 0.0) {
                        float boost = 1.0 + u_vibrance * (1.0 - min(1.0, chroma / 0.2)) * 0.5;
                        lab.yz *= boost;
                    }
                    
                    // Saturation: global chroma scaling
                    if (u_saturation != 0.0) {
                        lab.yz *= 1.0 + u_saturation;
                    }
                    
                    linear = OKLabToLinearRGB(lab);
                    linear = max(linear, vec3(0.0));
                }
                
                // Convert back to sRGB
                vec3 srgb = vec3(
                    linearToSRGB(clamp(linear.r, 0.0, 1.0)),
                    linearToSRGB(clamp(linear.g, 0.0, 1.0)),
                    linearToSRGB(clamp(linear.b, 0.0, 1.0))
                );
                
                fragColor = vec4(srgb, pixel.a);
            }
        `;

        // Store programs
        this.programs.set('passthrough', this._createProgram(vertexShader, passthroughFragment));
        this.programs.set('develop', this._createProgram(vertexShader, developFragment));

        // Cache uniform locations for develop shader
        const developProgram = this.programs.get('develop');
        if (developProgram) {
            developProgram.u_exposure = this.gl.getUniformLocation(developProgram, 'u_exposure');
            developProgram.u_contrast = this.gl.getUniformLocation(developProgram, 'u_contrast');
            developProgram.u_highlights = this.gl.getUniformLocation(developProgram, 'u_highlights');
            developProgram.u_shadows = this.gl.getUniformLocation(developProgram, 'u_shadows');
            developProgram.u_whites = this.gl.getUniformLocation(developProgram, 'u_whites');
            developProgram.u_blacks = this.gl.getUniformLocation(developProgram, 'u_blacks');
            developProgram.u_temperature = this.gl.getUniformLocation(developProgram, 'u_temperature');
            developProgram.u_tint = this.gl.getUniformLocation(developProgram, 'u_tint');
            developProgram.u_vibrance = this.gl.getUniformLocation(developProgram, 'u_vibrance');
            developProgram.u_saturation = this.gl.getUniformLocation(developProgram, 'u_saturation');
            developProgram.u_clarity = this.gl.getUniformLocation(developProgram, 'u_clarity');
        }

        console.log('✅ Shaders compiled');
    }

    /**
     * Load image into GPU texture
     */
    loadImage(imageElement) {
        const gl = this.gl;

        this.width = imageElement.naturalWidth || imageElement.width;
        this.height = imageElement.naturalHeight || imageElement.height;

        // Resize canvas to match
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        gl.viewport(0, 0, this.width, this.height);

        // Create input texture
        if (this.inputTexture) {
            gl.deleteTexture(this.inputTexture);
        }

        this.inputTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageElement);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        console.log(`📷 Image loaded: ${this.width}x${this.height}`);

        // Initial render
        this.render();
    }

    /**
     * Update adjustment parameter
     */
    setParam(name, value) {
        if (name in this.params) {
            this.params[name] = value;
            this.render();
        }
    }

    /**
     * Get current parameter value
     */
    getParam(name) {
        return this.params[name] ?? 0;
    }

    /**
     * Reset all parameters
     */
    /**
     * Render original image (for before/after)
     */
    renderOriginal() {
        if (!this.inputTexture) return;

        const gl = this.gl;
        const program = this.programs.get('passthrough');

        if (!program) return;

        gl.useProgram(program);

        // Bind input texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
        gl.uniform1i(program.u_texture, 0);

        // Set up vertex attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        // Render to canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    reset() {
        for (const key in this.params) {
            this.params[key] = 0;
        }
        this.render();
    }

    /**
     * Render with current adjustments
     */
    render() {
        if (!this.inputTexture) return;

        const gl = this.gl;
        const program = this.programs.get('develop');

        if (!program) return;

        // Use develop program
        gl.useProgram(program);

        // Set uniforms
        gl.uniform1f(program.u_exposure, this.params.exposure);
        gl.uniform1f(program.u_contrast, this.params.contrast / 100);
        gl.uniform1f(program.u_highlights, this.params.highlights / 100);
        gl.uniform1f(program.u_shadows, this.params.shadows / 100);
        gl.uniform1f(program.u_whites, this.params.whites / 100);
        gl.uniform1f(program.u_blacks, this.params.blacks / 100);
        gl.uniform1f(program.u_temperature, this.params.temperature / 100);
        gl.uniform1f(program.u_tint, this.params.tint / 100);
        gl.uniform1f(program.u_vibrance, this.params.vibrance / 100);
        gl.uniform1f(program.u_saturation, this.params.saturation / 100);
        gl.uniform1f(program.u_clarity, this.params.clarity / 100);

        // Bind input texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
        gl.uniform1i(program.u_texture, 0);

        // Set up vertex attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(program.a_position);
        gl.vertexAttribPointer(program.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(program.a_texCoord);
        gl.vertexAttribPointer(program.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        // Render to canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Export as ImageData
     */
    toImageData() {
        const gl = this.gl;
        const pixels = new Uint8Array(this.width * this.height * 4);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Flip Y (WebGL is bottom-up)
        const flipped = new Uint8ClampedArray(this.width * this.height * 4);
        const rowSize = this.width * 4;
        for (let y = 0; y < this.height; y++) {
            const srcRow = (this.height - 1 - y) * rowSize;
            const dstRow = y * rowSize;
            flipped.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
        }

        return new ImageData(flipped, this.width, this.height);
    }

    /**
     * Export as Blob
     */
    toBlob(type = 'image/jpeg', quality = 0.92) {
        return new Promise(resolve => {
            this.canvas.toBlob(resolve, type, quality);
        });
    }
}
