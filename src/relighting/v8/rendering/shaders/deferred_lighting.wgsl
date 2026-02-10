// Scene-Aware Deferred Lighting Shader for WebGPU
// Implements: Ratio Image Relighting, SH Lighting, Cook-Torrance GGX,
//             Per-Material BRDF, Curvature-Aware Lighting, Depth-Driven Transport
// ================================================================================

// === Vertex Shader ===
struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0)       uv       : vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
    // Fullscreen triangle
    var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f( 3.0, -1.0),
        vec2f(-1.0,  3.0)
    );
    var uv = array<vec2f, 3>(
        vec2f(0.0, 1.0),
        vec2f(2.0, 1.0),
        vec2f(0.0, -1.0)
    );
    var output : VertexOutput;
    output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
    output.uv = uv[vertexIndex];
    return output;
}

// === Fragment Shader ===

// G-Buffer textures
@group(0) @binding(0) var albedoTex   : texture_2d<f32>;
@group(0) @binding(1) var normalTex   : texture_2d<f32>;
@group(0) @binding(2) var depthTex    : texture_2d<f32>;
@group(0) @binding(3) var texSampler  : sampler;
@group(0) @binding(4) var<uniform> u  : LightUniforms;
@group(0) @binding(5) var sceneMapTex : texture_2d<f32>;

struct LightUniforms {
    direction      : vec3f,       // 0-11 + pad 12-15
    pad0           : f32,
    color          : vec3f,       // 16-27
    intensity      : f32,         // 28-31
    ambient        : f32,         // 32
    shadowIntensity: f32,         // 36
    shadowSoftness : f32,         // 40
    roughnessBase  : f32,         // 44
    resolution     : vec2f,       // 48-55
    origLightX     : f32,         // 56
    origLightY     : f32,         // 60
    shNew0         : vec4f,       // 64-79
    shNew4         : vec4f,       // 80-95
    shNew8_origSh0 : vec4f,       // 96-111
    origSh3        : vec4f,       // 112-127
};

const PI : f32 = 3.14159265359;

// ==================== Color Space ====================

fn sRGBToLinear(srgb: vec3f) -> vec3f {
    let low  = srgb / 12.92;
    let high = pow((srgb + 0.055) / 1.055, vec3f(2.4));
    return select(low, high, srgb > vec3f(0.04045));
}

fn linearToSRGB(lin: vec3f) -> vec3f {
    let c = max(lin, vec3f(0.0));
    let low  = c * 12.92;
    let high = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
    return select(low, high, c > vec3f(0.0031308));
}

fn linearToOKLAB(rgb: vec3f) -> vec3f {
    let l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    let m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    let s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
    let l_ = pow(max(l, 0.0), 1.0 / 3.0);
    let m_ = pow(max(m, 0.0), 1.0 / 3.0);
    let s_ = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3f(
        0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
        1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
        0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
    );
}

fn OKLABToLinear(lab: vec3f) -> vec3f {
    let l_ = lab.x + 0.3963377774*lab.y + 0.2158037573*lab.z;
    let m_ = lab.x - 0.1055613458*lab.y - 0.0638541728*lab.z;
    let s_ = lab.x - 0.0894841775*lab.y - 1.2914855480*lab.z;
    return vec3f(
         4.0767416621*l_*l_*l_ - 3.3077115913*m_*m_*m_ + 0.2309699292*s_*s_*s_,
        -1.2684380046*l_*l_*l_ + 2.6097574011*m_*m_*m_ - 0.3413193965*s_*s_*s_,
        -0.0041960863*l_*l_*l_ - 0.7034186147*m_*m_*m_ + 1.7076147010*s_*s_*s_
    );
}

// ==================== Spherical Harmonics ====================

fn evaluateSH9(n: vec3f) -> f32 {
    return max(
        u.shNew0.x * 0.282095 +
        u.shNew0.y * 0.488603 * n.y +
        u.shNew0.z * 0.488603 * n.z +
        u.shNew0.w * 0.488603 * n.x +
        u.shNew4.x * 1.092548 * n.x * n.y +
        u.shNew4.y * 1.092548 * n.y * n.z +
        u.shNew4.z * 0.315392 * (3.0 * n.z * n.z - 1.0) +
        u.shNew4.w * 1.092548 * n.x * n.z +
        u.shNew8_origSh0.x * 0.546274 * (n.x * n.x - n.y * n.y),
        0.0
    );
}

fn evaluateOrigSH(n: vec3f) -> f32 {
    return max(
        u.shNew8_origSh0.y * 0.282095 +
        u.shNew8_origSh0.z * 0.488603 * n.y +
        u.shNew8_origSh0.w * 0.488603 * n.z +
        u.origSh3.x * 0.488603 * n.x +
        u.origSh3.y * 1.092548 * n.x * n.y +
        u.origSh3.z * 1.092548 * n.y * n.z +
        u.origSh3.w * 0.315392 * (3.0 * n.z * n.z - 1.0),
        0.05
    );
}

// ==================== PBR Functions ====================

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
    let a  = roughness * roughness;
    let a2 = a * a;
    let d  = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d + 0.0001);
}

fn geometrySmith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
    let r = roughness + 1.0;
    let k = (r * r) / 8.0;
    let gv = NdotV / (NdotV * (1.0 - k) + k + 0.0001);
    let gl = NdotL / (NdotL * (1.0 - k) + k + 0.0001);
    return gv * gl;
}

fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
    let t = clamp(1.0 - cosTheta, 0.0, 1.0);
    let t2 = t * t;
    return F0 + (1.0 - F0) * (t2 * t2 * t);
}

// ==================== Shadows & AO ====================

fn computeSSAO(uv: vec2f, centerDepth: f32, curvature: f32) -> f32 {
    var occlusion : f32 = 0.0;
    // Curvature-adaptive radius: concave regions get wider AO sampling
    let curvFactor = mix(1.5, 0.5, curvature); // concave=wider, convex=tighter
    let radius = (u.shadowSoftness * 0.025 + 0.005) * curvFactor;

    for (var i : i32 = 0; i < 8; i++) {
        let fi = f32(i);
        let angle = fi * 0.785398 + uv.x * 12.9898 + uv.y * 78.233;
        let offset = vec2f(cos(angle), sin(angle)) * radius * (1.0 + fi * 0.15);
        let sd = textureSample(depthTex, texSampler, uv + offset).r;
        let dd = centerDepth - sd;
        let rc = smoothstep(0.0, 0.08, abs(dd)) * (1.0 - smoothstep(0.08, 0.25, abs(dd)));
        occlusion += step(0.003, dd) * rc;
    }
    return 1.0 - occlusion / 8.0;
}

fn computeShadow(uv: vec2f, centerDepth: f32, lightDir: vec3f, depthLayer: f32) -> f32 {
    var shadow : f32 = 0.0;
    let lightDirSS = normalize(lightDir.xy) * (u.shadowSoftness * 0.04 + 0.012);
    let heightStep = lightDir.z * 0.02;
    var totalWeight : f32 = 0.0;

    // Depth-adaptive shadow reach: foreground objects cast longer shadows
    let reachScale = mix(0.5, 1.8, depthLayer);

    for (var i : i32 = 1; i <= 16; i++) {
        let t = f32(i) / 16.0;
        let ps = reachScale;
        let suv = uv + lightDirSS * t * ps;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) { continue; }
        let sd = textureSample(depthTex, texSampler, suv).r;
        let ed = centerDepth + heightStep * t;
        let hd = sd - ed;
        let pen = 1.0 + t * 3.0;
        let w = (1.0 - t) * (1.0 - t);
        if (hd > 0.005 && hd < 0.35) {
            shadow += w * smoothstep(0.005, 0.02 * pen, hd);
        }
        totalWeight += w;
    }
    if (totalWeight > 0.0) { shadow /= totalWeight; }
    return 1.0 - clamp(shadow * u.shadowIntensity * 2.5, 0.0, 1.0);
}

// ==================== Per-Material BRDF ====================

// Subsurface scattering approximation for skin
fn computeSSS(normal: vec3f, lightDir: vec3f, viewDir: vec3f, depth: f32) -> f32 {
    // Wrap lighting: light wraps around the surface for translucent materials
    let wrapNdotL = (dot(normal, lightDir) + 0.5) / 1.5;
    let scatter = max(wrapNdotL, 0.0);

    // View-dependent back-scatter (light through ears, fingers, etc.)
    let backScatter = max(dot(-normal, lightDir), 0.0) * 0.3;

    // Transmission based on thin areas (high curvature in depth)
    return (scatter * 0.4 + backScatter) * 0.5;
}

// Anisotropic highlight for hair
fn computeHairSpecular(normal: vec3f, lightDir: vec3f, viewDir: vec3f) -> f32 {
    // Kajiya-Kay style anisotropic highlight
    let H = normalize(lightDir + viewDir);
    let NdotH = max(dot(normal, H), 0.0);

    // Primary highlight (shifted)
    let spec1 = pow(NdotH, 80.0) * 0.4;
    // Secondary highlight (broader, shifted further)
    let spec2 = pow(NdotH, 20.0) * 0.15;

    return spec1 + spec2;
}

// ==================== Main Fragment Shader ====================

@fragment
fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
    let uv = input.uv;

    // === Sample G-Buffer ===
    let originalColor = textureSample(albedoTex, texSampler, uv).rgb;
    let depth         = textureSample(depthTex, texSampler, uv).r;
    let normal        = normalize(textureSample(normalTex, texSampler, uv).rgb * 2.0 - 1.0);
    let scene         = textureSample(sceneMapTex, texSampler, uv);

    // === Decode Scene Map ===
    let materialType = scene.r;   // 0=bg, 0.25=skin, 0.5=hair, 0.75=fabric, 1.0=metal
    let roughness    = scene.g;   // Per-pixel roughness from scene analysis
    let curvature    = scene.b;   // 0=concave, 0.5=flat, 1.0=convex
    let depthLayer   = scene.a;   // 0=far, 1=near

    // === Setup vectors ===
    let linearOriginal = sRGBToLinear(originalColor);
    let lightDir = normalize(u.direction);
    let viewDir  = vec3f(0.0, 0.0, 1.0);
    let H = normalize(lightDir + viewDir);

    let NdotL = max(dot(normal, lightDir), 0.0);
    let NdotV = max(dot(normal, viewDir), 0.001);
    let NdotH = max(dot(normal, H), 0.0);
    let HdotV = max(dot(H, viewDir), 0.0);

    // ================================================================
    // RATIO IMAGE RELIGHTING — core technique
    // output = original × (newLighting / originalLighting)
    // ================================================================
    let newSH  = evaluateSH9(normal);
    let origSH = evaluateOrigSH(normal);
    let shadingRatio = newSH / max(origSH, 0.08);
    let smoothRatio  = mix(1.0, shadingRatio, u.intensity);

    // ================================================================
    // PER-MATERIAL SPECULAR — scene-aware BRDF
    // ================================================================

    // Determine F0 (reflectance at normal incidence) by material
    // Skin: 0.028 (low), Hair: 0.046, Fabric: 0.04, Metal: 0.6+ (tinted)
    var F0 : vec3f;
    var specScale : f32;

    // Skin range: materialType ≈ 0.25
    let isSkin   = smoothstep(0.15, 0.25, materialType) * (1.0 - smoothstep(0.25, 0.35, materialType));
    // Hair range: materialType ≈ 0.5
    let isHair   = smoothstep(0.4, 0.5, materialType)  * (1.0 - smoothstep(0.5, 0.6, materialType));
    // Fabric range: materialType ≈ 0.75
    let isFabric = smoothstep(0.65, 0.75, materialType) * (1.0 - smoothstep(0.75, 0.85, materialType));
    // Metal range: materialType ≈ 1.0
    let isMetal  = smoothstep(0.9, 1.0, materialType);
    // Background
    let isBg     = 1.0 - smoothstep(0.0, 0.1, materialType);

    // Blend F0 based on material
    F0 = vec3f(0.04); // Default dielectric
    F0 = mix(F0, vec3f(0.028), isSkin);
    F0 = mix(F0, vec3f(0.046), isHair);
    F0 = mix(F0, vec3f(0.04), isFabric);
    F0 = mix(F0, linearOriginal * 0.8, isMetal); // Metals tint their reflections

    // Specular intensity varies by material
    specScale = 0.5;
    specScale = mix(specScale, 0.25, isSkin);   // Subtle spec on skin
    specScale = mix(specScale, 0.6, isHair);    // Hair has strong highlights
    specScale = mix(specScale, 0.15, isFabric); // Fabric is mostly diffuse
    specScale = mix(specScale, 1.2, isMetal);   // Metal is very specular
    specScale = mix(specScale, 0.0, isBg);      // No spec on background

    // GGX specular with per-pixel roughness
    let D = distributionGGX(NdotH, roughness);
    let G = geometrySmith(NdotV, NdotL, roughness);
    let F = fresnelSchlick(HdotV, F0);
    let spec = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);
    var specContrib = spec * NdotL * u.intensity * u.color * specScale;

    // Hair: replace GGX with anisotropic
    let hairSpec = computeHairSpecular(normal, lightDir, viewDir);
    specContrib = mix(specContrib, vec3f(hairSpec) * u.color * u.intensity, isHair);

    // ================================================================
    // SUBSURFACE SCATTERING — skin only
    // ================================================================
    let sss = computeSSS(normal, lightDir, viewDir, depth);
    let sssColor = vec3f(1.0, 0.4, 0.25) * sss * u.intensity * isSkin;

    // ================================================================
    // CURVATURE-AWARE LIGHTING
    // ================================================================
    // Convex surfaces (nose, cheek) catch more light, boost slightly
    // Concave surfaces (eye sockets, creases) trap light, darken
    let curvatureBoost = mix(0.85, 1.15, curvature);

    // ================================================================
    // FRESNEL RIM LIGHTING — material-dependent
    // ================================================================
    let fresnel = pow(1.0 - NdotV, 4.0);
    var rimStrength : f32 = 0.12;
    rimStrength = mix(rimStrength, 0.18, isSkin);   // Skin glows at edges
    rimStrength = mix(rimStrength, 0.08, isHair);   // Hair has subtle rim
    rimStrength = mix(rimStrength, 0.05, isFabric); // Fabric minimal rim
    rimStrength = mix(rimStrength, 0.35, isMetal);  // Metal strong rim
    rimStrength = mix(rimStrength, 0.0, isBg);      // No rim on background

    let rimLight = fresnel * u.intensity * rimStrength * max(dot(normal, lightDir) + 0.3, 0.0);

    // ================================================================
    // DEPTH-DRIVEN 3D LIGHT TRANSPORT
    // ================================================================
    // Light attenuates more for surfaces further from the light source
    // Foreground objects are closer to the virtual light → brighter
    let depthAttenuation = mix(0.7, 1.0, depthLayer);

    // ================================================================
    // SHADOWS — curvature and depth-aware
    // ================================================================
    let ao     = computeSSAO(uv, depth, curvature);
    let shadow = computeShadow(uv, depth, lightDir, depthLayer);
    var combinedShadow = min(ao, shadow);

    // Concave regions accumulate more shadow naturally
    combinedShadow *= mix(0.75, 1.0, curvature);

    // ================================================================
    // COMPOSE — bring it all together
    // ================================================================
    // Base: ratio image relighting (preserves all original detail)
    var result = linearOriginal * smoothRatio;

    // Apply curvature-aware modulation
    result *= curvatureBoost;

    // Apply depth-driven attenuation
    result *= depthAttenuation;

    // Apply shadows
    result *= mix(1.0, combinedShadow, 0.7);

    // Apply light color tint
    result *= mix(vec3f(1.0), u.color, 0.6);

    // Add specular highlights
    result += specContrib * combinedShadow;

    // Add rim lighting
    result += vec3f(rimLight) * u.color * combinedShadow;

    // Add SSS for skin
    result += sssColor * combinedShadow;

    // Background: minimal change, preserve original
    result = mix(result, linearOriginal * mix(0.95, 1.05, smoothRatio * 0.1), isBg);

    // ================================================================
    // OKLAB TONE PRESERVATION
    // ================================================================
    let origLAB = linearToOKLAB(max(linearOriginal, vec3f(0.001)));
    let newLAB  = linearToOKLAB(max(result, vec3f(0.001)));
    // Keep original chrominance, use new luminance
    let finalLAB = vec3f(
        newLAB.x,
        mix(origLAB.y, newLAB.y, 0.3),
        mix(origLAB.z, newLAB.z, 0.3)
    );
    var finalLinear = OKLABToLinear(finalLAB);

    // Gentle S-curve contrast
    finalLinear = (finalLinear - 0.5) * 1.05 + 0.5;

    return vec4f(linearToSRGB(clamp(finalLinear, vec3f(0.0), vec3f(1.0))), 1.0);
}
