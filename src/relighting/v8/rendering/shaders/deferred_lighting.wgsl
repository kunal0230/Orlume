// Deferred Lighting Shader for WebGPU
// Implements PBR lighting with SSAO and soft shadows

// === Vertex Shader ===
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    // Fullscreen triangle positions
    var positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    
    var texCoords = array<vec2f, 3>(
        vec2f(0.0, 1.0),
        vec2f(2.0, 1.0),
        vec2f(0.0, -1.0)
    );
    
    var output: VertexOutput;
    output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
    output.texCoord = texCoords[vertexIndex];
    return output;
}

// === Fragment Shader ===

struct LightUniforms {
    direction: vec3f,
    _pad0: f32,
    color: vec3f,
    intensity: f32,
    ambient: f32,
    shadowIntensity: f32,
    shadowSoftness: f32,
    _pad1: f32,
    resolution: vec2f,
    _pad2: vec2f,
}

@group(0) @binding(0) var albedoTexture: texture_2d<f32>;
@group(0) @binding(1) var normalTexture: texture_2d<f32>;
@group(0) @binding(2) var depthTexture: texture_2d<f32>;
@group(0) @binding(3) var textureSampler: sampler;
@group(0) @binding(4) var<uniform> light: LightUniforms;

// sRGB to Linear conversion
fn sRGBToLinear(srgb: vec3f) -> vec3f {
    let low = srgb / 12.92;
    let high = pow((srgb + 0.055) / 1.055, vec3f(2.4));
    return select(low, high, srgb > vec3f(0.04045));
}

// Linear to sRGB conversion  
fn linearToSRGB(linear: vec3f) -> vec3f {
    let low = linear * 12.92;
    let high = 1.055 * pow(linear, vec3f(1.0 / 2.4)) - 0.055;
    return select(low, high, linear > vec3f(0.0031308));
}

// ACES Filmic Tone Mapping
fn ACESFilm(x: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

// SSAO - Screen Space Ambient Occlusion
fn computeSSAO(uv: vec2f, centerDepth: f32, normal: vec3f) -> f32 {
    let SAMPLES = 8;
    var occlusion = 0.0;
    
    // Sample radius in UV space
    let radius = light.shadowSoftness * 0.02 + 0.005;
    
    // Hemisphere sample kernel
    var kernel = array<vec2f, 8>(
        vec2f(0.7071, 0.7071),
        vec2f(-0.7071, 0.7071),
        vec2f(0.7071, -0.7071),
        vec2f(-0.7071, -0.7071),
        vec2f(1.0, 0.0),
        vec2f(-1.0, 0.0),
        vec2f(0.0, 1.0),
        vec2f(0.0, -1.0)
    );
    
    for (var i = 0; i < SAMPLES; i++) {
        // Sample offset with noise-like variation
        let angle = f32(i) * 0.785398 + uv.x * 12.9898 + uv.y * 78.233;
        let offset = vec2f(cos(angle), sin(angle)) * radius * (1.0 + f32(i) * 0.15);
        
        let sampleUV = uv + offset;
        let sampleDepth = textureSampleLevel(depthTexture, textureSampler, sampleUV, 0.0).r;
        
        // Check if sample is occluded
        let depthDiff = centerDepth - sampleDepth;
        
        // Range check
        var rangeCheck = smoothstep(0.0, 0.1, abs(depthDiff));
        rangeCheck *= 1.0 - smoothstep(0.1, 0.3, abs(depthDiff));
        
        // Accumulate occlusion
        occlusion += step(0.005, depthDiff) * rangeCheck;
    }
    
    return 1.0 - (occlusion / f32(SAMPLES));
}

// Contact Shadows
fn computeContactShadow(uv: vec2f, centerDepth: f32, lightDir: vec3f) -> f32 {
    let STEPS = 12;
    var shadow = 0.0;
    
    // Project light direction to screen space
    var lightDirSS = normalize(lightDir.xy) * (light.shadowSoftness * 0.03 + 0.01);
    
    if (lightDir.z < 0.1) {
        lightDirSS *= 0.5;
    }
    
    var totalWeight = 0.0;
    
    for (var i = 1; i <= STEPS; i++) {
        let t = f32(i) / f32(STEPS);
        let sampleUV = uv + lightDirSS * t;
        
        // Bounds check
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            continue;
        }
        
        let sampleDepth = textureSampleLevel(depthTexture, textureSampler, sampleUV, 0.0).r;
        let heightDiff = sampleDepth - centerDepth;
        
        let weight = 1.0 - t;
        if (heightDiff > 0.01 && heightDiff < 0.3) {
            shadow += weight * smoothstep(0.01, 0.05, heightDiff);
        }
        totalWeight += weight;
    }
    
    if (totalWeight > 0.0) {
        shadow = shadow / totalWeight;
    }
    
    return 1.0 - clamp(shadow * light.shadowIntensity * 2.0, 0.0, 1.0);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    // Sample G-Buffer (using explicit LOD for consistency)
    let albedoSample = textureSampleLevel(albedoTexture, textureSampler, input.texCoord, 0.0);
    let normalSample = textureSampleLevel(normalTexture, textureSampler, input.texCoord, 0.0);
    let depth = textureSampleLevel(depthTexture, textureSampler, input.texCoord, 0.0).r;
    
    // Unpack albedo (sRGB to linear)
    let albedo = sRGBToLinear(albedoSample.rgb);
    
    // Unpack normals from [0,1] to [-1,1]
    let normal = normalize(normalSample.rgb * 2.0 - 1.0);
    
    // Normalize light direction
    let lightDir = normalize(light.direction);
    
    // === Lambertian Diffuse ===
    let NdotL = max(dot(normal, lightDir), 0.0);
    let diffuse = albedo * NdotL * light.color * light.intensity;
    
    // === Ambient ===
    let ambient = albedo * light.ambient;
    
    // === Blinn-Phong Specular ===
    let viewDir = vec3f(0.0, 0.0, 1.0);
    let halfDir = normalize(lightDir + viewDir);
    let NdotH = max(dot(normal, halfDir), 0.0);
    let specular = pow(NdotH, 32.0) * 0.3 * light.intensity;
    
    // === SSAO ===
    let ao = computeSSAO(input.texCoord, depth, normal);
    
    // === Contact Shadows ===
    let contactShadow = computeContactShadow(input.texCoord, depth, lightDir);
    
    // === Combine shadows ===
    let combinedShadow = min(ao, contactShadow);
    
    // Apply shadow to diffuse and specular
    var lighting = ambient + (diffuse + vec3f(specular)) * combinedShadow;
    
    // === ACES Tone Mapping ===
    lighting = ACESFilm(lighting);
    
    // Convert back to sRGB
    let finalColor = linearToSRGB(lighting);
    
    return vec4f(finalColor, 1.0);
}
