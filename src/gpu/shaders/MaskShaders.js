/**
 * MaskShaders - WGSL shaders for mask rendering in WebGPU
 * 
 * Contains all shader code for mask operations:
 * - Brush stamp rendering
 * - Radial/linear gradients
 * - Mask overlay
 * - Masked adjustments
 * - Mask inversion
 */

// Shared vertex shader for all mask operations
export const maskVertexShader = /* wgsl */`
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
`;

// Brush stamp shader - renders a single brush dab
export const brushStampShader = /* wgsl */`
    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoord: vec2f,
    }

    struct BrushUniforms {
        center: vec2f,
        radius: f32,
        hardness: f32,
        opacity: f32,
        aspect: f32,
        _pad1: f32,
        _pad2: f32,
    }

    @vertex
    fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4f(pos, 0.0, 1.0);
        output.texCoord = texCoord;
        return output;
    }

    @group(0) @binding(0) var<uniform> u: BrushUniforms;

    @fragment
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        var diff = texCoord - u.center;
        diff.x *= u.aspect;
        let dist = length(diff);
        
        // Calculate falloff based on hardness
        let inner = u.radius * u.hardness;
        var alpha = 1.0 - smoothstep(inner, u.radius, dist);
        alpha *= u.opacity;
        
        // Output white with alpha (blending handled by pipeline)
        return vec4f(1.0, 1.0, 1.0, alpha);
    }
`;

// Radial gradient shader - Lightroom style elliptical with angle & feather
export const radialGradientShader = /* wgsl */`
    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoord: vec2f,
    }

    struct RadialUniforms {
        center: vec2f,
        radii: vec2f,
        angle: f32,
        feather: f32,
        aspect: f32,
        invert: f32,
    }

    @vertex
    fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4f(pos, 0.0, 1.0);
        output.texCoord = texCoord;
        return output;
    }

    @group(0) @binding(0) var<uniform> u: RadialUniforms;

    @fragment
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        var diff = texCoord - u.center;
        diff.x *= u.aspect;
        
        let cosA = cos(u.angle);
        let sinA = sin(u.angle);
        let rot = vec2f(
            diff.x * cosA + diff.y * sinA,
            -diff.x * sinA + diff.y * cosA
        );
        
        let r = max(u.radii, vec2f(0.0001, 0.0001));
        let dist = length(rot / r);
        
        let featherFrac = clamp(u.feather, 0.01, 1.0);
        let innerEdge = max(0.0, 1.0 - featherFrac);
        var alpha = 1.0 - smoothstep(innerEdge, 1.0, dist);
        
        if (u.invert > 0.5) {
            alpha = 1.0 - alpha;
        }
        
        return vec4f(1.0, 1.0, 1.0, alpha);
    }
`;

// Linear gradient shader
export const linearGradientShader = /* wgsl */`
    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoord: vec2f,
    }

    struct LinearUniforms {
        start: vec2f,
        end: vec2f,
        aspect: f32,
        invert: f32,
        _pad1: f32,
        _pad2: f32,
    }

    @vertex
    fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4f(pos, 0.0, 1.0);
        output.texCoord = texCoord;
        return output;
    }

    @group(0) @binding(0) var<uniform> u: LinearUniforms;

    @fragment
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        var p = texCoord;
        p.x *= u.aspect;
        var s = u.start;
        s.x *= u.aspect;
        var e = u.end;
        e.x *= u.aspect;
        
        let dir = e - s;
        let lenSq = dot(dir, dir);
        
        var alpha = 1.0;
        if (lenSq > 0.000001) {
            let t = clamp(dot(p - s, dir) / lenSq, 0.0, 1.0);
            alpha = 1.0 - smoothstep(0.0, 1.0, t);
        }
        
        if (u.invert > 0.5) {
            alpha = 1.0 - alpha;
        }
        
        return vec4f(1.0, 1.0, 1.0, alpha);
    }
`;

// Mask overlay shader - shows mask with customizable overlay color
export const maskOverlayShader = /* wgsl */`
    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoord: vec2f,
    }

    struct OverlayUniforms {
        color: vec3f,
        opacity: f32,
    }

    @vertex
    fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4f(pos, 0.0, 1.0);
        output.texCoord = texCoord;
        return output;
    }

    @group(0) @binding(0) var texSampler: sampler;
    @group(0) @binding(1) var maskTex: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> u: OverlayUniforms;

    @fragment
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        let maskValue = textureSample(maskTex, texSampler, texCoord).a;
        return vec4f(u.color, maskValue * u.opacity);
    }
`;

// Invert mask shader - inverts mask alpha channel
export const maskInvertShader = /* wgsl */`
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
    @group(0) @binding(1) var maskTex: texture_2d<f32>;

    @fragment
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        let maskValue = textureSample(maskTex, texSampler, texCoord).a;
        return vec4f(1.0, 1.0, 1.0, 1.0 - maskValue);
    }
`;

// Masked adjustment shader - applies adjustments in masked areas with Pro tonal controls
export const maskedAdjustmentShader = /* wgsl */`
    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoord: vec2f,
    }

    struct AdjustmentUniforms {
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        temperature: f32,
        tint: f32,
        saturation: f32,
        clarity: f32,
        density: f32,
        lumMin: f32,
        lumMax: f32,
        lumFeather: f32,
        useLumRange: f32,
        _pad1: f32,
        _pad2: f32,
        _pad3: f32,
    }

    @vertex
    fn vertexMain(@location(0) pos: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4f(pos, 0.0, 1.0);
        output.texCoord = texCoord;
        return output;
    }

    @group(0) @binding(0) var texSampler: sampler;
    @group(0) @binding(1) var baseTex: texture_2d<f32>;
    @group(0) @binding(2) var maskTex: texture_2d<f32>;
    @group(0) @binding(3) var<uniform> u: AdjustmentUniforms;

    @fragment
    fn fragmentMain(@location(0) texCoord: vec2f) -> @location(0) vec4f {
        let base = textureSample(baseTex, texSampler, texCoord);
        let rawMask = textureSample(maskTex, texSampler, texCoord).a;
        var maskValue = clamp(rawMask * u.density, 0.0, 1.0);
        
        // Luminance Range Qualification (Lightroom Style)
        if (u.useLumRange > 0.5) {
            let baseLum = dot(base.rgb, vec3f(0.2126, 0.7152, 0.0722));
            let feather = max(0.005, u.lumFeather);
            let lowWeight = smoothstep(u.lumMin - feather, u.lumMin, baseLum);
            let highWeight = 1.0 - smoothstep(u.lumMax, u.lumMax + feather, baseLum);
            maskValue = maskValue * lowWeight * highWeight;
        }

        if (maskValue < 0.001) {
            return base;
        }
        
        // Linear photometric conversion
        var lin = pow(max(base.rgb, vec3f(0.0)), vec3f(2.2));
        
        // White balance (Temperature & Tint) via chromatic adaptation
        if (u.temperature != 0.0 || u.tint != 0.0) {
            lin.r *= 1.0 + u.temperature * 0.25 + u.tint * 0.08;
            lin.g *= 1.0 - u.tint * 0.15;
            lin.b *= 1.0 - u.temperature * 0.25 + u.tint * 0.08;
            lin = max(vec3f(0.0), lin);
        }
        
        // Exposure
        if (u.exposure != 0.0) {
            lin *= pow(2.0, u.exposure);
        }
        
        // Highlights & Shadows (ratio-preserving luminance modulation)
        let luma = dot(lin, vec3f(0.2126, 0.7152, 0.0722));
        if (u.highlights != 0.0) {
            let hw = smoothstep(0.4, 1.0, luma);
            lin *= (1.0 + u.highlights * hw * 0.5);
        }
        if (u.shadows != 0.0) {
            let sw = 1.0 - smoothstep(0.0, 0.45, luma);
            lin *= (1.0 + u.shadows * sw * 0.5);
        }
        
        // Perceptual space for contrast, clarity, saturation
        var color = pow(max(lin, vec3f(0.0)), vec3f(1.0 / 2.2));
        
        // Contrast (ratio-preserving)
        if (u.contrast != 0.0) {
            let lumC = dot(color, vec3f(0.2126, 0.7152, 0.0722));
            let newLumC = clamp((lumC - 0.5) * (1.0 + u.contrast * 0.8) + 0.5, 0.0, 1.0);
            color *= (newLumC / max(0.0001, lumC));
        }
        
        // Clarity (Midtone contrast)
        if (u.clarity != 0.0) {
            let lumMid = dot(color, vec3f(0.2126, 0.7152, 0.0722));
            let midtoneWeight = 1.0 - abs(lumMid - 0.5) * 2.0;
            color += (color - vec3f(lumMid)) * u.clarity * max(0.0, midtoneWeight) * 0.5;
        }
        
        // Saturation
        if (u.saturation != 0.0) {
            let gray = dot(color, vec3f(0.2126, 0.7152, 0.0722));
            color = mix(vec3f(gray), color, max(0.0, 1.0 + u.saturation));
        }
        
        // Clamp
        color = clamp(color, vec3f(0.0), vec3f(1.0));
        
        // Blend based on mask
        return vec4f(mix(base.rgb, color, maskValue), base.a);
    }
`;

// Passthrough shader for blitting textures
export const passthroughShader = /* wgsl */`
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
