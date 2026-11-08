/**
 * WebGPUBackend - WebGPU implementation of GPUBackend
 * 
 * Uses the modern WebGPU API for high-performance GPU rendering.
 * Falls back to WebGL2 if WebGPU is not available.
 */

import { GPUBackend } from './GPUBackend.js';

export class WebGPUBackend extends GPUBackend {
    constructor(canvas) {
        super(canvas);
        this.device = null;
        this.context = null;
        this.format = null;
        this.pipelines = new Map();
        this.bindGroupLayouts = new Map();
        this.sampler = null;

        // Tone Curve Textures (WebGPU)
        this._curveLutTexRgb = null;
        this._curveLutTexRed = null;
        this._curveLutTexGreen = null;
        this._curveLutTexBlue = null;
        this._defaultLutTex = null; // Identity LUT for inactive curves

        // 3D LUT Textures (WebGPU)
        this._lut3dTex = null;
        this._defaultLut3dTex = null;
        this._lastLut3dData = null;
        this._lut3dSampler = null;

        // Vertex buffer for fullscreen quad
        this.vertexBuffer = null;
        this.texCoordBuffer = null;
    }

    /**
     * Check if WebGPU is supported
     */
    static async isSupported() {
        if (!navigator.gpu) {
            return false;
        }
        try {
            const adapter = await navigator.gpu.requestAdapter();
            return adapter !== null;
        } catch (e) {
            return false;
        }
    }

    getName() {
        return 'WebGPU';
    }

    /**
     * Initialize WebGPU context
     */
    async init() {
        if (!navigator.gpu) {
            console.warn('WebGPU not available');
            return false;
        }

        try {
            // Request adapter and device
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance'
            });

            if (!adapter) {
                console.warn('WebGPU adapter not available');
                return false;
            }

            this.device = await adapter.requestDevice({
                requiredFeatures: [],
                requiredLimits: {}
            });

            this.maxTextureSize = this.device.limits?.maxTextureDimension2D || 8192;

            // Configure canvas context
            this.context = this.canvas.getContext('webgpu');
            this.format = navigator.gpu.getPreferredCanvasFormat();

            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied'  // Support transparent PNG
            });

            // Create sampler
            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge'
            });

            this._lut3dSampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge'
            });

            // Create fullscreen quad geometry
            this._createQuadBuffers();

            // Compile shaders
            this._compileShaders();

            this.isReady = true;
            return true;
        } catch (e) {
            console.error('WebGPU initialization failed:', e);
            return false;
        }
    }

    /**
     * Set canvas size and reconfigure WebGPU context
     * This is critical - WebGPU context must be reconfigured when canvas dimensions change
     */
    setSize(width, height) {
        // Skip if dimensions haven't changed
        if (this.width === width && this.height === height) {
            return;
        }

        // Call parent to set canvas dimensions
        super.setSize(width, height);

        // Reconfigure the WebGPU context for the new canvas size
        if (this.context && this.device) {
            this.context.configure({
                device: this.device,
                format: this.format,
                alphaMode: 'premultiplied'  // Support transparent PNG
            });
        }
    }

    /**
     * Create vertex buffers for fullscreen quad
     */
    _createQuadBuffers() {
        // Positions (clip space)
        const positions = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        // Texture coordinates (flipped Y for correct orientation)
        const texCoords = new Float32Array([
            0, 1,
            1, 1,
            0, 0,
            1, 0
        ]);

        this.vertexBuffer = this.device.createBuffer({
            size: positions.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.vertexBuffer, 0, positions);

        this.texCoordBuffer = this.device.createBuffer({
            size: texCoords.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.texCoordBuffer, 0, texCoords);
    }

    /**
     * Compile WGSL shaders
     */
    _compileShaders() {
        // Passthrough shader
        const passthroughCode = /* wgsl */`
            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) texCoord: vec2f,
            }

            @vertex
            fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
                var output: VertexOutput;
                output.position = vec4f(pos, 0.0, 1.0);
                output.texCoord = texCoord;
                return output;
            }

            @group(0) @binding(0) var texSampler: sampler;
            @group(0) @binding(1) var tex: texture_2d<f32>;

            @fragment
            fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
                return textureSample(tex, texSampler, texCoord);
            }
        `;

        // Develop shader with all adjustments including HSL
        const developCode = /* wgsl */`
            struct VertexOutput {
                @builtin(position) position: vec4f,
                @location(0) texCoord: vec2f,
            }

            struct Uniforms {
                exposure: f32,
                contrast: f32,
                highlights: f32,
                shadows: f32,
                whites: f32,
                blacks: f32,
                temperature: f32,
                tint: f32,
                vibrance: f32,
                saturation: f32,
                clarity: f32,
                _pad1: f32,
                // HSL Per-Channel packed as vec4s for 16-byte alignment
                // Each array stores 8 values in 2 vec4s: [0-3] and [4-7]
                hslHue0: vec4f,    // Red, Orange, Yellow, Green
                hslHue1: vec4f,    // Aqua, Blue, Purple, Magenta
                hslSat0: vec4f,
                hslSat1: vec4f,
                hslLum0: vec4f,
                hslLum1: vec4f,
                // Tone Curve Flags
                hasRgbCurve: f32,
                hasRedCurve: f32,
                hasGreenCurve: f32,
                hasBlueCurve: f32,
                // Color Grading Uniforms (aligned to 16 bytes)
                shadowsColor: vec2f,
                midtonesColor: vec2f,
                highlightsColor: vec2f,
                shadowsLum: f32,
                midtonesLum: f32,
                highlightsLum: f32,
                colorBalance: f32,
                colorBlending: f32,
                showClipping: f32,
                clipShadows: f32,
                clipHighlights: f32,
                _padClipping0: f32,
                _padClipping1: f32,
                // 3D LUT Uniforms (aligned to 16 bytes)
                hasLut3d: f32,
                lut3dIntensity: f32,
                lut3dSize: f32,
                _padLut3d: f32,
            }

            @vertex
            fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
                var output: VertexOutput;
                output.position = vec4f(pos, 0.0, 1.0);
                output.texCoord = texCoord;
                return output;
            }

            @group(0) @binding(0) var texSampler: sampler;
            @group(0) @binding(1) var tex: texture_2d<f32>;
            @group(0) @binding(2) var<uniform> u: Uniforms;
            @group(0) @binding(3) var curveRgbTex: texture_2d<f32>;
            @group(0) @binding(4) var curveRedTex: texture_2d<f32>;
            @group(0) @binding(5) var curveGreenTex: texture_2d<f32>;
            @group(0) @binding(6) var curveBlueTex: texture_2d<f32>;
            @group(0) @binding(7) var lut3dSampler: sampler;
            @group(0) @binding(8) var lut3dTex: texture_3d<f32>;

            // Color center hues for HSL (in degrees)
            const COLOR_HUES = array<f32, 8>(0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);
            const COLOR_WIDTHS = array<f32, 8>(35.0, 35.0, 50.0, 60.0, 55.0, 45.0, 45.0, 40.0);

            // sRGB to Linear
            fn sRGBtoLinear(c: f32) -> f32 {
                if (c <= 0.04045) {
                    return c / 12.92;
                }
                return pow((c + 0.055) / 1.055, 2.4);
            }

            // Linear to sRGB
            fn linearToSRGB(c: f32) -> f32 {
                if (c <= 0.0031308) {
                    return c * 12.92;
                }
                return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
            }

            // Luminance (Rec. 709)
            fn luminance(c: vec3f) -> f32 {
                return dot(c, vec3f(0.2126, 0.7152, 0.0722));
            }

            // RGB to HSL
            fn rgbToHsl(rgb: vec3f) -> vec3f {
                let maxC = max(rgb.r, max(rgb.g, rgb.b));
                let minC = min(rgb.r, min(rgb.g, rgb.b));
                let l = (maxC + minC) * 0.5;
                
                if (maxC == minC) {
                    return vec3f(0.0, 0.0, l);
                }
                
                let d = maxC - minC;
                var s: f32;
                if (l > 0.5) {
                    s = d / (2.0 - maxC - minC);
                } else {
                    s = d / (maxC + minC);
                }
                
                var h: f32;
                if (maxC == rgb.r) {
                    var offset: f32 = 0.0;
                    if (rgb.g < rgb.b) { offset = 6.0; }
                    h = (rgb.g - rgb.b) / d + offset;
                } else if (maxC == rgb.g) {
                    h = (rgb.b - rgb.r) / d + 2.0;
                } else {
                    h = (rgb.r - rgb.g) / d + 4.0;
                }
                h = h / 6.0;
                
                return vec3f(h * 360.0, s, l);
            }

            // Helper for HSL to RGB
            fn hueToRgb(p: f32, q: f32, t_in: f32) -> f32 {
                var t = t_in;
                if (t < 0.0) { t = t + 1.0; }
                if (t > 1.0) { t = t - 1.0; }
                if (t < 1.0/6.0) { return p + (q - p) * 6.0 * t; }
                if (t < 1.0/2.0) { return q; }
                if (t < 2.0/3.0) { return p + (q - p) * (2.0/3.0 - t) * 6.0; }
                return p;
            }

            // HSL to RGB
            fn hslToRgb(hsl: vec3f) -> vec3f {
                let h = hsl.x / 360.0;
                let s = hsl.y;
                let l = hsl.z;
                
                if (s == 0.0) {
                    return vec3f(l, l, l);
                }
                
                var q: f32;
                if (l < 0.5) {
                    q = l * (1.0 + s);
                } else {
                    q = l + s - l * s;
                }
                let p = 2.0 * l - q;
                
                return vec3f(
                    hueToRgb(p, q, h + 1.0/3.0),
                    hueToRgb(p, q, h),
                    hueToRgb(p, q, h - 1.0/3.0)
                );
            }

            // Get weight for how much a hue belongs to a color channel
            fn getColorWeight(hue: f32, colorIndex: i32) -> f32 {
                let centerHue = COLOR_HUES[colorIndex];
                var dist = abs(hue - centerHue);
                if (dist > 180.0) { dist = 360.0 - dist; }
                let width = COLOR_WIDTHS[colorIndex];
                return smoothstep(width, 0.0, dist);
            }

            // Get HSL hue value for a color index (0-7)
            fn getHslHue(idx: i32) -> f32 {
                if (idx == 0) { return u.hslHue0.x; }
                if (idx == 1) { return u.hslHue0.y; }
                if (idx == 2) { return u.hslHue0.z; }
                if (idx == 3) { return u.hslHue0.w; }
                if (idx == 4) { return u.hslHue1.x; }
                if (idx == 5) { return u.hslHue1.y; }
                if (idx == 6) { return u.hslHue1.z; }
                return u.hslHue1.w;
            }
            
            fn getHslSat(idx: i32) -> f32 {
                if (idx == 0) { return u.hslSat0.x; }
                if (idx == 1) { return u.hslSat0.y; }
                if (idx == 2) { return u.hslSat0.z; }
                if (idx == 3) { return u.hslSat0.w; }
                if (idx == 4) { return u.hslSat1.x; }
                if (idx == 5) { return u.hslSat1.y; }
                if (idx == 6) { return u.hslSat1.z; }
                return u.hslSat1.w;
            }
            
            fn getHslLum(idx: i32) -> f32 {
                if (idx == 0) { return u.hslLum0.x; }
                if (idx == 1) { return u.hslLum0.y; }
                if (idx == 2) { return u.hslLum0.z; }
                if (idx == 3) { return u.hslLum0.w; }
                if (idx == 4) { return u.hslLum1.x; }
                if (idx == 5) { return u.hslLum1.y; }
                if (idx == 6) { return u.hslLum1.z; }
                return u.hslLum1.w;
            }

            // Apply HSL adjustments preserving angular falloff, near-neutral and shadow noise protection
            fn applyHSLAdjustments(hsl: vec3f, maxLinearChan: f32) -> vec3f {
                var hue = hsl.x;
                let sat = hsl.y;
                var lum = hsl.z;
                
                // Smooth fade for near-neutral and near-black pixels to prevent noise amplification
                let satFade = smoothstep(0.01, 0.06, sat);
                let blackFade = smoothstep(0.015, 0.08, maxLinearChan);
                let totalFade = satFade * blackFade;
                if (totalFade <= 0.0) { return hsl; }
                
                var totalHueShift: f32 = 0.0;
                var totalSatShift: f32 = 0.0;
                var totalLumShift: f32 = 0.0;
                var totalWeight: f32 = 0.0;
                
                for (var i: i32 = 0; i < 8; i = i + 1) {
                    let weight = getColorWeight(hue, i);
                    if (weight > 0.001) {
                        totalWeight = totalWeight + weight;
                        totalHueShift = totalHueShift + getHslHue(i) * 0.6 * weight;
                        totalSatShift = totalSatShift + (getHslSat(i) / 100.0) * weight;
                        totalLumShift = totalLumShift + (getHslLum(i) / 100.0) * 0.4 * weight;
                    }
                }
                
                if (totalWeight > 0.001) {
                    let normFactor = max(1.0, totalWeight);
                    let avgHueShift = (totalHueShift / normFactor) * totalFade;
                    let avgSatShift = (totalSatShift / normFactor) * totalFade;
                    let avgLumShift = (totalLumShift / normFactor) * totalFade;
                    
                    var newHue = hue + avgHueShift;
                    if (newHue < 0.0) { newHue = newHue + 360.0; }
                    if (newHue >= 360.0) { newHue = newHue - 360.0; }
                    
                    return vec3f(
                        newHue,
                        clamp(sat * max(0.0, 1.0 + avgSatShift), 0.0, 1.0),
                        clamp(lum + avgLumShift, 0.0, 1.0)
                    );
                }
                
                return hsl;
            }

            // Zone weights
            fn shadowWeight(L: f32) -> f32 {
                return smoothstep(0.3, 0.0, L);
            }

            fn midtoneWeight(L: f32) -> f32 {
                return exp(-pow((L - 0.5) / 0.25, 2.0) * 0.5);
            }

            fn highlightWeight(L: f32) -> f32 {
                return smoothstep(0.7, 1.0, L);
            }

            fn softShoulder(x: f32, knee: f32) -> f32 {
                if (x <= knee) { return x; }
                let over = x - knee;
                return knee + over / (1.0 + over * 2.0);
            }

            // RGB to OKLab
            fn linearRGBtoOKLab(rgb: vec3f) -> vec3f {
                let l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
                let m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
                let s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
                
                let l_ = pow(max(0.0, l), 1.0/3.0);
                let m_ = pow(max(0.0, m), 1.0/3.0);
                let s_ = pow(max(0.0, s), 1.0/3.0);
                
                return vec3f(
                    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
                    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
                    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
                );
            }

            // OKLab to RGB
            fn OKLabToLinearRGB(lab: vec3f) -> vec3f {
                let l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
                let m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
                let s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
                
                let l_ = l * l * l;
                let m_ = m * m * m;
                let s_ = s * s * s;
                
                return vec3f(
                    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
                    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
                    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_
                );
            }

            fn gamutCompressWGSL(c: vec3f) -> vec3f {
                let Y = max(0.0, luminance(c));
                let mx = max(c.r, max(c.g, c.b));
                let mn = min(c.r, min(c.g, c.b));
                var k: f32 = 1.0;
                if (mx > 1.0 && mx > Y) { k = min(k, (1.0 - Y) / (mx - Y)); }
                if (mn < 0.0 && Y > mn) { k = min(k, Y / (Y - mn)); }
                return Y + (c - Y) * max(0.0, k);
            }

            fn sampleCurve(tex: texture_2d<f32>, x: f32) -> f32 {
                let pos = clamp(x, 0.0, 1.0) * 255.0;
                let index = u32(floor(pos));
                let f = fract(pos);
                let v1 = textureLoad(tex, vec2u(index, 0), 0).r;
                let v2 = textureLoad(tex, vec2u(min(index + 1u, 255u), 0), 0).r;
                return mix(v1, v2, f);
            }

            // === Color Grading Helpers ===
            fn hueToRgbWGSL(p: f32, q: f32, t_in: f32) -> f32 {
                var t = t_in;
                if (t < 0.0) { t = t + 1.0; }
                if (t > 1.0) { t = t - 1.0; }
                if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
                if (t < 1.0 / 2.0) { return q; }
                if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
                return p;
            }

            fn hslToRgbNormWGSL(h: f32, s: f32, l: f32) -> vec3f {
                if (s <= 0.0) {
                    return vec3f(l, l, l);
                }
                var q: f32;
                if (l < 0.5) {
                    q = l * (1.0 + s);
                } else {
                    q = l + s - l * s;
                }
                let p = 2.0 * l - q;
                return vec3f(
                    hueToRgbWGSL(p, q, h + 1.0 / 3.0),
                    hueToRgbWGSL(p, q, h),
                    hueToRgbWGSL(p, q, h - 1.0 / 3.0)
                );
            }

            fn applyColorGradingWGSL(
                color: vec3f,
                shadows: vec2f,
                midtones: vec2f,
                highlights: vec2f,
                balance: f32,
                blending: f32,
                shadowsLum: f32,
                midtonesLum: f32,
                highlightsLum: f32
            ) -> vec3f {
                var lab = linearRGBtoOKLab(max(color, vec3f(0.0)));
                let L = lab.x;

                let mid = clamp(0.5 + balance * 0.25, 0.15, 0.85);
                let blend = 0.2 + blending * 0.3;

                let shadowWeight = 1.0 - smoothstep(0.0, mid + blend * 0.5, L);
                let highlightWeight = smoothstep(mid - blend * 0.5, 1.0, L);
                let midDist = (L - mid) / max(0.12, blend);
                let midtoneWeight = exp(-midDist * midDist * 2.0);

                let totalW = shadowWeight + midtoneWeight + highlightWeight;
                var sw = shadowWeight;
                var mw = midtoneWeight;
                var hw = highlightWeight;
                if (totalW > 1.0) {
                    sw = sw / totalW;
                    mw = mw / totalW;
                    hw = hw / totalW;
                }

                let shadowTaper = smoothstep(0.04, 0.26, L);
                let highlightTaper = 1.0 - smoothstep(0.85, 1.0, L) * 0.85;

                let maxChromaScale: f32 = 0.35;
                var deltaChroma = vec2f(0.0);

                if (shadows.y > 0.0) {
                    let ang = shadows.x * 6.283185307;
                    let chromaDir = vec2f(cos(ang), sin(ang));
                    deltaChroma += chromaDir * (shadows.y * maxChromaScale * sw * shadowTaper);
                }

                if (midtones.y > 0.0) {
                    let ang = midtones.x * 6.283185307;
                    let chromaDir = vec2f(cos(ang), sin(ang));
                    deltaChroma += chromaDir * (midtones.y * (maxChromaScale * 0.70) * mw);
                }

                if (highlights.y > 0.0) {
                    let ang = highlights.x * 6.283185307;
                    let chromaDir = vec2f(cos(ang), sin(ang));
                    deltaChroma += chromaDir * (highlights.y * maxChromaScale * hw * highlightTaper);
                }

                lab.y += deltaChroma.x;
                lab.z += deltaChroma.y;

                let curChroma = length(lab.yz);
                if (curChroma > 0.38) {
                    let scale = 0.38 / curChroma;
                    lab.y *= scale;
                    lab.z *= scale;
                }

                let lumShift = (shadowsLum * sw * shadowTaper +
                                midtonesLum * mw +
                                highlightsLum * hw * highlightTaper) * 0.25;
                lab.x = clamp(L + lumShift, 0.0, 1.0);

                let graded = OKLabToLinearRGB(lab);
                return max(graded, vec3f(0.0));
            }

            @fragment
            fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
                let pixel = textureSample(tex, texSampler, texCoord);
                var srgb = pixel.rgb;
                
                // Convert to linear
                var linear = vec3f(
                    sRGBtoLinear(srgb.r),
                    sRGBtoLinear(srgb.g),
                    sRGBtoLinear(srgb.b)
                );
                
                // === WHITE BALANCE (Chromatic Adaptation) ===
                if (u.temperature != 0.0 || u.tint != 0.0) {
                    linear.r *= 1.0 + u.temperature * 0.25 + u.tint * 0.08;
                    linear.g *= 1.0 - u.tint * 0.15;
                    linear.b *= 1.0 - u.temperature * 0.25 + u.tint * 0.08;
                    linear = max(linear, vec3f(0.0));
                }

                // === EXPOSURE (Photometric Gain) ===
                if (u.exposure != 0.0) {
                    let gain = pow(2.0, u.exposure);
                    linear *= gain;
                }
                
                // === HIGHLIGHTS & SHADOWS (Ratio-Preserving Tone Mapping) ===
                var luma = luminance(linear);
                if (u.highlights != 0.0) {
                    var targetH = luma;
                    if (u.highlights < 0.0) {
                        let strength = -u.highlights * 1.8;
                        let threshold: f32 = 0.35;
                        let overshoot = max(0.0, luma - threshold);
                        let compressed = threshold + overshoot / (1.0 + strength * overshoot);
                        targetH = mix(luma, compressed, smoothstep(threshold, 1.0, luma));
                    } else {
                        let strength = u.highlights * 0.4;
                        targetH = luma + strength * smoothstep(0.4, 1.0, luma) * (1.0 - smoothstep(1.2, 2.0, luma) * 0.5);
                    }
                    linear *= (targetH / max(0.0001, luma));
                }
                
                luma = luminance(linear);
                if (u.shadows != 0.0) {
                    let mask = 1.0 - smoothstep(0.0, 0.45, luma);
                    var shadowMult: f32;
                    if (u.shadows > 0.0) {
                        shadowMult = 1.0 + u.shadows * 0.85 * mask;
                    } else {
                        shadowMult = 1.0 + u.shadows * 0.55 * mask;
                    }
                    linear *= shadowMult;
                }
                
                // === WHITES & BLACKS (Endpoint Toe & Shoulder Control) ===
                luma = luminance(linear);
                if (u.whites != 0.0) {
                    let whiteMask = smoothstep(0.6, 1.0, luma);
                    var whiteMult: f32;
                    if (u.whites > 0.0) {
                        whiteMult = 1.0 + u.whites * 0.25 * whiteMask;
                    } else {
                        whiteMult = 1.0 + u.whites * 0.20 * whiteMask;
                    }
                    linear *= whiteMult;
                }
                
                if (u.blacks != 0.0) {
                    let blackMask = 1.0 - smoothstep(0.0, 0.22, luma);
                    if (u.blacks > 0.0) {
                        linear += vec3f(u.blacks * 0.04 * blackMask * blackMask);
                    } else {
                        linear *= (1.0 + u.blacks * 0.50 * blackMask);
                    }
                    linear = max(vec3f(0.0), linear);
                }

                // === CONTRAST (Ratio-Preserving Filmic S-Curve with Hermite Quintic) ===
                if (u.contrast != 0.0) {
                    let lumaC = luminance(linear);
                    let pLuma = pow(max(0.0001, lumaC), 1.0 / 2.2);
                    var sLuma: f32;
                    if (u.contrast >= 0.0) {
                        let cExp = exp(u.contrast * 0.85);
                        let x = clamp(pLuma, 0.0001, 0.9999);
                        let xc = pow(x, cExp);
                        let xinc = pow(1.0 - x, cExp);
                        sLuma = xc / (xc + xinc);
                    } else {
                        let s = exp(u.contrast * 0.85);
                        let t = pLuma - 0.5;
                        let t2 = t * t;
                        sLuma = clamp(0.5 + t * (s + (1.0 - s) * t2 * (8.0 - 16.0 * t2)), 0.0, 1.0);
                    }
                    let outLuma = pow(sLuma, 2.2);
                    if (u.contrast >= 0.0) {
                        linear *= (outLuma / max(0.0001, lumaC));
                    } else {
                        linear += vec3f(outLuma - lumaC);
                    }
                }

                // === HSL PER-CHANNEL ADJUSTMENTS (Evaluated post-contrast) ===
                var hasHSL = false;
                for (var i: i32 = 0; i < 8; i = i + 1) {
                    if (getHslHue(i) != 0.0 || getHslSat(i) != 0.0 || getHslLum(i) != 0.0) {
                        hasHSL = true;
                        break;
                    }
                }
                if (hasHSL) {
                    let maxChan = max(linear.r, max(linear.g, linear.b));
                    let hdrScale = max(1.0, maxChan);
                    let normLinear = linear / hdrScale;
                    var gammaRgb = vec3f(
                        linearToSRGB(clamp(normLinear.r, 0.0, 1.0)),
                        linearToSRGB(clamp(normLinear.g, 0.0, 1.0)),
                        linearToSRGB(clamp(normLinear.b, 0.0, 1.0))
                    );
                    var hsl = rgbToHsl(gammaRgb);
                    let adjHsl = applyHSLAdjustments(hsl, maxChan);
                    if (adjHsl.x != hsl.x || adjHsl.y != hsl.y || adjHsl.z != hsl.z) {
                        let adjGamma = hslToRgb(adjHsl);
                        let adjLinear = vec3f(sRGBtoLinear(adjGamma.r), sRGBtoLinear(adjGamma.g), sRGBtoLinear(adjGamma.b));
                        linear = adjLinear * hdrScale;
                    }
                }
                
                // === VIBRANCE / SATURATION (Smart Skin Protection in OKLab) ===
                if (u.vibrance != 0.0 || u.saturation != 0.0) {
                    var lab = linearRGBtoOKLab(linear);
                    let sat = length(lab.yz);
                    
                    if (u.vibrance != 0.0) {
                        let hue = atan2(lab.z, lab.y);
                        let hueDist = abs(hue - 0.84);
                        let skinWeight = exp(-pow(hueDist * 1.8, 2.0));
                        let curSatMask = 1.0 - smoothstep(0.04, 0.28, sat);
                        let protection = 0.55 * skinWeight;
                        let mask = curSatMask * (1.0 - protection);
                        let vibGain = max(0.0, 1.0 + u.vibrance * 1.2 * mask);
                        lab.y *= vibGain;
                        lab.z *= vibGain;
                    }
                    
                    if (u.saturation != 0.0) {
                        var satGain: f32;
                        if (u.saturation >= 0.0) {
                            satGain = 1.0 + u.saturation * 0.75;
                        } else {
                            satGain = max(0.0, 1.0 + u.saturation);
                        }
                        lab.y *= satGain;
                        lab.z *= satGain;
                    }
                    
                    linear = max(OKLabToLinearRGB(lab), vec3f(0.0));
                }
                
                // === COLOR GRADING (3-Way) ===
                if (u.shadowsColor.y > 0.0 || u.midtonesColor.y > 0.0 || u.highlightsColor.y > 0.0 ||
                    u.shadowsLum != 0.0 || u.midtonesLum != 0.0 || u.highlightsLum != 0.0) {
                    let balance = u.colorBalance * 0.01;
                    let blending = u.colorBlending * 0.01;
                    let sLum = u.shadowsLum * 0.01;
                    let mLum = u.midtonesLum * 0.01;
                    let hLum = u.highlightsLum * 0.01;

                    linear = applyColorGradingWGSL(
                        linear,
                        u.shadowsColor,
                        u.midtonesColor,
                        u.highlightsColor,
                        balance,
                        blending,
                        sLum,
                        mLum,
                        hLum
                    );
                }

                // Gamut compression before sRGB conversion
                linear = gamutCompressWGSL(linear);

                // Convert back to sRGB
                var finalSrgb = vec3f(
                    linearToSRGB(clamp(linear.r, 0.0, 1.0)),
                    linearToSRGB(clamp(linear.g, 0.0, 1.0)),
                    linearToSRGB(clamp(linear.b, 0.0, 1.0))
                );
                
                // === TONE CURVE ===
                if (u.hasRgbCurve > 0.5) {
                    let rVal = sampleCurve(curveRgbTex, finalSrgb.r);
                    let gVal = sampleCurve(curveRgbTex, finalSrgb.g);
                    let bVal = sampleCurve(curveRgbTex, finalSrgb.b);
                    finalSrgb = vec3f(rVal, gVal, bVal);
                }
                
                if (u.hasRedCurve > 0.5) {
                    finalSrgb.r = sampleCurve(curveRedTex, finalSrgb.r);
                }
                if (u.hasGreenCurve > 0.5) {
                    finalSrgb.g = sampleCurve(curveGreenTex, finalSrgb.g);
                }
                if (u.hasBlueCurve > 0.5) {
                    finalSrgb.b = sampleCurve(curveBlueTex, finalSrgb.b);
                }
                
                // === 3D LUT COLOR GRADING ===
                if (u.hasLut3d > 0.5) {
                    let lutCoord = (clamp(finalSrgb, vec3f(0.0), vec3f(1.0)) * (u.lut3dSize - 1.0) + 0.5) / u.lut3dSize;
                    let graded = textureSample(lut3dTex, lut3dSampler, lutCoord).rgb;
                    finalSrgb = mix(finalSrgb, graded, u.lut3dIntensity);
                }
                
                if (u.showClipping > 0.5) {
                    if (u.clipHighlights > 0.5 && finalSrgb.r >= 0.996 && finalSrgb.g >= 0.996 && finalSrgb.b >= 0.996) {
                        return vec4f(1.0, 0.0, 0.0, pixel.a);
                    }
                    if (u.clipShadows > 0.5 && finalSrgb.r <= 0.003 && finalSrgb.g <= 0.003 && finalSrgb.b <= 0.003) {
                        return vec4f(0.0, 0.35, 1.0, pixel.a);
                    }
                }
                
                return vec4f(finalSrgb, pixel.a);
            }
        `;

        // Create passthrough pipeline
        this._createPipeline('passthrough', passthroughCode, false);

        // Create develop pipeline
        this._createPipeline('develop', developCode, true);

    }

    /**
     * Create a render pipeline
     */
    _createPipeline(name, code, hasUniforms) {
        const shaderModule = this.device.createShaderModule({ code });

        const bindGroupLayoutEntries = [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }
        ];

        if (hasUniforms) {
            bindGroupLayoutEntries.push({
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' }
            });

            // Bindings for curve textures (3, 4, 5, 6)
            for (let i = 0; i < 4; i++) {
                bindGroupLayoutEntries.push({
                    binding: 3 + i,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: 'unfilterable-float', viewDimension: '2d' }
                });
            }

            // Bindings for 3D LUT sampler (7) and 3D LUT texture (8)
            bindGroupLayoutEntries.push({
                binding: 7,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: 'filtering' }
            });
            bindGroupLayoutEntries.push({
                binding: 8,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float', viewDimension: '3d' }
            });
        }

        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: bindGroupLayoutEntries
        });
        this.bindGroupLayouts.set(name, bindGroupLayout);

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        const pipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain',
                buffers: [
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
                    },
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }]
                    }
                ]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: [{ format: this.format }]
            },
            primitive: {
                topology: 'triangle-strip',
                stripIndexFormat: undefined
            }
        });

        this.pipelines.set(name, pipeline);
    }

    /**
     * Create texture from image source
     */
    createTextureFromSource(source) {
        const width = source.naturalWidth || source.width;
        const height = source.naturalHeight || source.height;

        const texture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.device.queue.copyExternalImageToTexture(
            { source },
            { texture },
            [width, height]
        );

        return {
            width,
            height,
            _internal: texture
        };
    }

    /**
     * Create empty texture
     */
    createTexture(width, height) {
        const texture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT
        });

        return {
            width,
            height,
            _internal: texture
        };
    }

    /**
     * Create or update a 1D LUT texture (WebGPU)
     */
    /**
     * Create or update a 1D LUT texture (WebGPU)
     */
    _updateLutTexture(existingTexture, lutData) {
        // Unwrap existing texture if it matches our wrapper format
        let texture = existingTexture && existingTexture._internal ? existingTexture._internal : existingTexture;

        // Create texture if needed
        if (!texture) {
            texture = this.device.createTexture({
                size: [256, 1],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });
        }

        // Upload data
        this.device.queue.writeTexture(
            { texture: texture },
            lutData,
            { bytesPerRow: 256 * 4 },
            { width: 256, height: 1 }
        );

        return { _internal: texture };
    }

    /**
     * Get or create a default identity LUT texture
     */
    _getOrCreateDefaultLut() {
        if (!this._defaultLutTex) {
            const texture = this.device.createTexture({
                size: [1, 1],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });

            // Upload 0.0 (or anything)
            const data = new Float32Array([0.0]);
            this.device.queue.writeTexture(
                { texture: texture },
                data,
                { bytesPerRow: 4 },
                { width: 1, height: 1 }
            );

            this._defaultLutTex = { _internal: texture };
        }
        return this._defaultLutTex;
    }

    /**
     * Get or create a 2x2x2 identity 3D LUT texture (WebGPU)
     */
    _getOrCreateDefaultLut3d() {
        if (!this._defaultLut3dTex) {
            const texture = this.device.createTexture({
                dimension: '3d',
                size: [2, 2, 2],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });

            const identity = new Uint8Array([
                0, 0, 0, 255,     255, 0, 0, 255,
                0, 255, 0, 255,   255, 255, 0, 255,
                0, 0, 255, 255,   255, 0, 255, 255,
                0, 255, 255, 255, 255, 255, 255, 255
            ]);

            this.device.queue.writeTexture(
                { texture: texture },
                identity,
                { bytesPerRow: 8, rowsPerImage: 2 },
                { width: 2, height: 2, depthOrArrayLayers: 2 }
            );

            this._defaultLut3dTex = { _internal: texture };
        }
        return this._defaultLut3dTex;
    }

    /**
     * Create or update a 3D LUT texture (WebGPU)
     */
    _updateLut3dTexture(existingTexture, lutInfo) {
        const size = lutInfo.size;
        let texture = existingTexture?._internal;

        if (!texture || texture.width !== size || texture.height !== size || texture.depthOrArrayLayers !== size) {
            if (texture) {
                texture.destroy();
            }
            texture = this.device.createTexture({
                dimension: '3d',
                size: [size, size, size],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            });
        }

        this.device.queue.writeTexture(
            { texture: texture },
            lutInfo.data,
            { bytesPerRow: size * 4, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: size }
        );

        return { _internal: texture };
    }

    /**
     * Render with develop pipeline
     */
    renderDevelop(inputTexture, uniforms, target = null, clippingOpts = null) {
        const pipeline = this.pipelines.get('develop');
        const bindGroupLayout = this.bindGroupLayouts.get('develop');

        // Create uniform buffer (12 base floats + 24 HSL floats = 36 floats)
        const uniformData = new Float32Array([
            uniforms.exposure || 0,
            (uniforms.contrast || 0) / 100,
            (uniforms.highlights || 0) / 100,
            (uniforms.shadows || 0) / 100,
            (uniforms.whites || 0) / 100,
            (uniforms.blacks || 0) / 100,
            (uniforms.temperature || 0) / 100,
            (uniforms.tint || 0) / 100,
            (uniforms.vibrance || 0) / 100,
            (uniforms.saturation || 0) / 100,
            (uniforms.clarity || 0) / 100,
            0, // padding
            // HSL Hue (8 floats) - Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta
            uniforms.hslHueRed || 0,
            uniforms.hslHueOrange || 0,
            uniforms.hslHueYellow || 0,
            uniforms.hslHueGreen || 0,
            uniforms.hslHueAqua || 0,
            uniforms.hslHueBlue || 0,
            uniforms.hslHuePurple || 0,
            uniforms.hslHueMagenta || 0,
            // HSL Saturation (8 floats)
            uniforms.hslSatRed || 0,
            uniforms.hslSatOrange || 0,
            uniforms.hslSatYellow || 0,
            uniforms.hslSatGreen || 0,
            uniforms.hslSatAqua || 0,
            uniforms.hslSatBlue || 0,
            uniforms.hslSatPurple || 0,
            uniforms.hslSatMagenta || 0,
            // HSL Luminance (8 floats)
            uniforms.hslLumRed || 0,
            uniforms.hslLumOrange || 0,
            uniforms.hslLumYellow || 0,
            uniforms.hslLumGreen || 0,
            uniforms.hslLumAqua || 0,
            uniforms.hslLumBlue || 0,
            uniforms.hslLumPurple || 0,
            uniforms.hslLumMagenta || 0,
            // Tone Curve Flags
            (uniforms.curveLutRgb && uniforms.curveLutRgb.length > 0) ? 1.0 : 0.0,
            (uniforms.curveLutRed && uniforms.curveLutRed.length > 0) ? 1.0 : 0.0,
            (uniforms.curveLutGreen && uniforms.curveLutGreen.length > 0) ? 1.0 : 0.0,
            (uniforms.curveLutBlue && uniforms.curveLutBlue.length > 0) ? 1.0 : 0.0,
            // Color Grading (12 floats)
            uniforms.shadowsHue || 0,
            uniforms.shadowsSat || 0,
            uniforms.midtonesHue || 0,
            uniforms.midtonesSat || 0,
            uniforms.highlightsHue || 0,
            uniforms.highlightsSat || 0,
            uniforms.shadowsLum || 0,
            uniforms.midtonesLum || 0,
            uniforms.highlightsLum || 0,
            uniforms.colorBalance || 0,
            uniforms.colorBlending !== undefined ? uniforms.colorBlending : 50,
            (clippingOpts && clippingOpts.show) ? 1.0 : 0.0,
            (clippingOpts && clippingOpts.shadows) ? 1.0 : 0.0,
            (clippingOpts && clippingOpts.highlights) ? 1.0 : 0.0,
            0.0, // _padClipping0
            0.0, // _padClipping1
            // 3D LUT (4 floats)
            (uniforms.lut3d && uniforms.lut3d.data && uniforms.lut3d.size > 0) ? 1.0 : 0.0,
            (uniforms.lut3dIntensity !== undefined ? uniforms.lut3dIntensity : 100) / 100,
            (uniforms.lut3d && uniforms.lut3d.size > 0) ? uniforms.lut3d.size : 2.0,
            0.0 // _padLut3d
        ]);

        // Process Tone Curve Textures
        const hasRgb = uniforms.curveLutRgb && uniforms.curveLutRgb.length > 0;
        const hasRed = uniforms.curveLutRed && uniforms.curveLutRed.length > 0;
        const hasGreen = uniforms.curveLutGreen && uniforms.curveLutGreen.length > 0;
        const hasBlue = uniforms.curveLutBlue && uniforms.curveLutBlue.length > 0;

        // Create/Update textures or use default
        let texRgb, texRed, texGreen, texBlue;

        if (hasRgb) {
            this._curveLutTexRgb = this._updateLutTexture(this._curveLutTexRgb, uniforms.curveLutRgb);
            texRgb = this._curveLutTexRgb._internal;
        } else {
            texRgb = this._getOrCreateDefaultLut()._internal;
        }

        if (hasRed) {
            this._curveLutTexRed = this._updateLutTexture(this._curveLutTexRed, uniforms.curveLutRed);
            texRed = this._curveLutTexRed._internal;
        } else {
            texRed = this._getOrCreateDefaultLut()._internal;
        }

        if (hasGreen) {
            this._curveLutTexGreen = this._updateLutTexture(this._curveLutTexGreen, uniforms.curveLutGreen);
            texGreen = this._curveLutTexGreen._internal;
        } else {
            texGreen = this._getOrCreateDefaultLut()._internal;
        }

        if (hasBlue) {
            this._curveLutTexBlue = this._updateLutTexture(this._curveLutTexBlue, uniforms.curveLutBlue);
            texBlue = this._curveLutTexBlue._internal;
        } else {
            texBlue = this._getOrCreateDefaultLut()._internal;
        }

        // Process 3D LUT Texture
        const hasLut3d = Boolean(uniforms.lut3d && uniforms.lut3d.data && uniforms.lut3d.size > 0);
        let texLut3d;
        if (hasLut3d) {
            if (this._lastLut3dData !== uniforms.lut3d) {
                this._lut3dTex = this._updateLut3dTexture(this._lut3dTex, uniforms.lut3d);
                this._lastLut3dData = uniforms.lut3d;
            }
            texLut3d = this._lut3dTex._internal;
        } else {
            texLut3d = this._getOrCreateDefaultLut3d()._internal;
        }

        const uniformBuffer = this.device.createBuffer({
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

        // Create bind group with all textures
        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: inputTexture._internal.createView() },
                { binding: 2, resource: { buffer: uniformBuffer } },
                { binding: 3, resource: texRgb.createView() },
                { binding: 4, resource: texRed.createView() },
                { binding: 5, resource: texGreen.createView() },
                { binding: 6, resource: texBlue.createView() },
                { binding: 7, resource: this._lut3dSampler },
                { binding: 8, resource: texLut3d.createView({ dimension: '3d' }) }
            ]
        });

        // Get render target - handle framebuffer structure
        let targetView;
        if (target) {
            // Framebuffer has texture property with _internal
            const targetTexture = target.texture ? target.texture._internal : target._internal;
            targetView = targetTexture.createView();
        } else {
            targetView = this.context.getCurrentTexture().createView();
        }

        // Create command encoder
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.texCoordBuffer);
        passEncoder.draw(4);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);

        // Store last render state for readback (toImageData)
        this._lastInputTexture = inputTexture;
        this._lastUniforms = uniforms;

        // Cleanup
        uniformBuffer.destroy();
    }

    /**
     * Render passthrough
     */
    renderPassthrough(inputTexture, target = null) {
        const pipeline = this.pipelines.get('passthrough');
        const bindGroupLayout = this.bindGroupLayouts.get('passthrough');

        const bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: inputTexture._internal.createView() }
            ]
        });

        // Handle framebuffer structure
        let targetView;
        if (target) {
            const targetTexture = target.texture ? target.texture._internal : target._internal;
            targetView = targetTexture.createView();
        } else {
            targetView = this.context.getCurrentTexture().createView();
        }

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: targetView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, this.vertexBuffer);
        passEncoder.setVertexBuffer(1, this.texCoordBuffer);
        passEncoder.draw(4);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    /**
     * Create framebuffer for render-to-texture operations
     * @param {number} width 
     * @param {number} height 
     * @returns {Object} Framebuffer handle with texture property
     */
    createFramebuffer(width, height) {
        // Create render target texture - IMPORTANT: use same format as canvas
        // to ensure pipeline compatibility (BGRA8Unorm on most systems)
        const texture = this.device.createTexture({
            size: [width, height],
            format: this.format, // Use canvas format, not hardcoded rgba8unorm
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.COPY_SRC
        });

        return {
            texture: {
                width,
                height,
                _internal: texture
            },
            _internal: texture,
            width,
            height
        };
    }

    /**
     * Read pixels from canvas (async operation in WebGPU)
     * Note: This is a synchronous stub that reads from the canvas context
     * @returns {Uint8Array} Pixel data in RGBA format
     */
    readPixels() {
        // WebGPU doesn't have synchronous readPixels like WebGL
        // Fall back to canvas 2D context for now
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.canvas.width = this.width;
        ctx.canvas.height = this.height;
        ctx.drawImage(this.canvas, 0, 0);
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        return new Uint8Array(imageData.data.buffer);
    }

    /**
     * Convert canvas to ImageData for histogram and other uses
     * Re-renders to a fresh texture since WebGPU clears backbuffer after presentation
     * @returns {ImageData}
     */
    toImageData() {
        // WebGPU clears the backbuffer after presenting, so drawImage returns black
        // We need to re-render to a fresh texture and read from there

        if (!this._lastInputTexture) {
            console.warn('No input texture available for toImageData');
            return new ImageData(this.width || 1, this.height || 1);
        }

        // Create a fresh framebuffer for readback
        const readFBO = this.createFramebuffer(this.width, this.height);

        // Re-render with last uniforms
        this.renderDevelop(this._lastInputTexture, this._lastUniforms || {}, readFBO);

        // Now render the FBO to canvas so we can read it
        this.renderPassthrough(readFBO.texture, null);

        // Read from canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.width;
        tempCanvas.height = this.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(this.canvas, 0, 0);

        // Cleanup FBO
        this.deleteFramebuffer(readFBO);

        return ctx.getImageData(0, 0, this.width, this.height);
    }

    /**
     * Delete framebuffer and its texture
     * @param {Object} framebuffer 
     */
    deleteFramebuffer(framebuffer) {
        if (framebuffer) {
            if (framebuffer._internal) {
                framebuffer._internal.destroy();
            }
            // Also destroy the texture wrapper if it exists separately
            if (framebuffer.texture && framebuffer.texture._internal !== framebuffer._internal) {
                framebuffer.texture._internal.destroy();
            }
        }
    }

    /**
     * Delete texture
     */
    deleteTexture(texture) {
        if (texture?._internal) {
            texture._internal.destroy();
        }
    }

    /**
     * Cleanup
     */
    dispose() {
        this.vertexBuffer?.destroy();
        this.texCoordBuffer?.destroy();
        this.pipelines.clear();
        this.bindGroupLayouts.clear();
        this.device = null;
        this.isReady = false;
    }
}
