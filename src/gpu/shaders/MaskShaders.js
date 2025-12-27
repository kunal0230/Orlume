/**
 * MaskShaders - WGSL shaders for mask rendering in WebGPU
 * 
 * Contains all shader code for mask operations:
 * - Brush stamp rendering
 * - Radial/linear gradients
 * - Mask overlay
 * - Masked adjustments
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
        _pad: f32,
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
        let dist = distance(texCoord, u.center);
        
        // Calculate falloff based on hardness
        let inner = u.radius * u.hardness;
        var alpha = 1.0 - smoothstep(inner, u.radius, dist);
        alpha *= u.opacity;
        
        // Output white with alpha (blending handled by pipeline)
        return vec4f(1.0, 1.0, 1.0, alpha);
    }
`;

// Radial gradient shader
export const radialGradientShader = /* wgsl */`
    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoord: vec2f,
    }

    struct RadialUniforms {
        center: vec2f,
        innerRadius: f32,
        outerRadius: f32,
        feather: f32,
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
        let dist = distance(texCoord, u.center);
        var alpha = smoothstep(u.innerRadius, u.outerRadius, dist);
        
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
        feather: f32,
        invert: f32,
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
        let dir = u.end - u.start;
        let len = length(dir);
        let norm = dir / len;
        
        let proj = dot(texCoord - u.start, norm);
        let t = proj / len;
        
        var alpha = smoothstep(0.0, u.feather / len, t) * 
                    (1.0 - smoothstep(1.0 - u.feather / len, 1.0, t));
        
        if (u.invert > 0.5) {
            alpha = 1.0 - alpha;
        }
        
        return vec4f(1.0, 1.0, 1.0, alpha);
    }
`;

// Mask overlay shader - shows mask as red overlay
export const maskOverlayShader = /* wgsl */`
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
        // Red overlay with mask alpha
        return vec4f(1.0, 0.3, 0.3, maskValue * 0.5);
    }
`;

// Masked adjustment shader - applies adjustments in masked areas
export const maskedAdjustmentShader = /* wgsl */`
    struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoord: vec2f,
    }

    struct AdjustmentUniforms {
        exposure: f32,
        contrast: f32,
        shadows: f32,
        temperature: f32,
        saturation: f32,
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
        let maskValue = textureSample(maskTex, texSampler, texCoord).a;
        
        if (maskValue < 0.001) {
            return base;
        }
        
        var color = base.rgb;
        
        // Exposure
        let expMult = pow(2.0, u.exposure);
        color *= expMult;
        
        // Contrast
        color = (color - 0.5) * (1.0 + u.contrast) + 0.5;
        
        // Shadows lift
        let lum = dot(color, vec3f(0.299, 0.587, 0.114));
        let shadowWeight = 1.0 - smoothstep(0.0, 0.3, lum);
        color += u.shadows * shadowWeight * 0.3;
        
        // Temperature
        color.r += u.temperature * 0.1;
        color.b -= u.temperature * 0.1;
        
        // Saturation
        let gray = dot(color, vec3f(0.299, 0.587, 0.114));
        color = mix(vec3f(gray), color, 1.0 + u.saturation);
        
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
