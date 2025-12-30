/**
 * AdvancedGodRaysShader.js - Professional Volumetric Lighting
 * 
 * Features:
 * - Smart light source detection from depth + luminance
 * - Chromatic aberration for realistic color fringing
 * - Noise-based variation for natural look
 * - Atmospheric scattering simulation
 * - Bloom halo around light sources
 * - ACES filmic tone mapping
 * - Depth-aware occlusion
 */

// Shared vertex shader
export const VERTEX_SHADER = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_uv;
    
    void main() {
        v_uv = a_texCoord;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

// ============================================
// ADVANCED VOLUMETRIC LIGHTING SHADER
// ============================================
export const ADVANCED_GODRAYS_SHADER = `
    precision highp float;
    
    uniform sampler2D u_image;
    uniform sampler2D u_depth;
    
    // Light source
    uniform vec2 u_sunPosition;
    uniform float u_sunRadius;
    
    // Ray parameters
    uniform float u_intensity;
    uniform float u_decay;
    uniform float u_density;
    uniform float u_weight;
    uniform int u_samples;
    
    // Thresholds
    uniform float u_lumThreshold;
    uniform float u_depthThreshold;
    
    // Color and style
    uniform vec3 u_rayColor;
    uniform float u_exposure;
    
    // Advanced parameters
    uniform float u_chromatic;      // Chromatic aberration strength
    uniform float u_noise;          // Noise variation
    uniform float u_bloom;          // Bloom intensity
    uniform float u_scatter;        // Atmospheric scatter
    uniform float u_toneMap;        // Tone mapping strength
    
    // Shadow casting parameters
    uniform float u_shadowIntensity;  // How dark shadows are
    uniform float u_shadowSoftness;   // Edge softness
    uniform float u_shadowLength;     // How far shadows extend
    
    // Resolution for noise
    uniform vec2 u_resolution;
    
    varying vec2 v_uv;
    
    // ========== UTILITY FUNCTIONS ==========
    
    // Simple hash for noise generation
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    
    // Smooth value noise
    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f); // Smooth interpolation
        
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    // ACES filmic tone mapping
    vec3 ACESFilm(vec3 x) {
        float a = 2.51;
        float b = 0.03;
        float c = 2.43;
        float d = 0.59;
        float e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    
    // ========== OCCLUSION CALCULATION ==========
    
    float getOcclusion(vec2 uv, float depthWeight) {
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            return 0.0;
        }
        
        vec4 color = texture2D(u_image, uv);
        float depth = texture2D(u_depth, uv).r;
        
        // Calculate perceived luminance
        float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
        
        // Soft brightness threshold with smooth falloff
        float lumRange = 0.2;
        float brightMask = smoothstep(u_lumThreshold - lumRange, u_lumThreshold + lumRange * 0.5, luminance);
        
        // Depth-based weighting (far = 1, near = 0)
        // Invert depth if needed (depth maps vary in convention)
        float normalizedDepth = 1.0 - depth;
        float depthFalloff = 0.15;
        float depthMask = smoothstep(u_depthThreshold - depthFalloff, u_depthThreshold + depthFalloff, normalizedDepth);
        
        // Combine: bright AND far pixels are light sources
        float occlusion = brightMask * depthMask;
        
        // Apply depth weight for softer depth influence
        occlusion = mix(brightMask * 0.3, occlusion, depthWeight);
        
        return occlusion;
    }
    
    // ========== SUN GLOW ==========
    
    vec3 getSunGlow(vec2 uv, vec2 sunPos) {
        float dist = length(uv - sunPos);
        
        // Multi-layer glow for realistic sun
        float innerGlow = 1.0 - smoothstep(0.0, u_sunRadius * 0.3, dist);
        float midGlow = 1.0 - smoothstep(0.0, u_sunRadius * 0.7, dist);
        float outerGlow = 1.0 - smoothstep(0.0, u_sunRadius * 1.5, dist);
        
        // Combine layers with different intensities
        float glow = innerGlow * 1.0 + midGlow * 0.5 + outerGlow * 0.2;
        glow = pow(glow, 1.5);
        
        return vec3(glow) * u_rayColor;
    }
    
    // ========== SHADOW CASTING (OPTIMIZED) ==========
    
    // Detect depth edges (silhouettes) - simplified
    float getDepthEdge(vec2 uv) {
        float pixelSize = 2.0 / u_resolution.x;  // Larger step for performance
        float center = texture2D(u_depth, uv).r;
        
        float right = texture2D(u_depth, uv + vec2(pixelSize, 0.0)).r;
        float up = texture2D(u_depth, uv + vec2(0.0, pixelSize)).r;
        
        return abs(right - center) + abs(up - center);
    }
    
    // Optimized shadow occlusion - fewer samples with noise jitter
    float getShadowOcclusion(vec2 uv, vec2 lightPos) {
        vec2 toLight = lightPos - uv;
        float distToLight = length(toLight);
        vec2 rayDir = normalize(toLight);
        
        float shadow = 0.0;
        float baseDepth = texture2D(u_depth, uv).r;
        
        // Use fewer samples with noise jitter to prevent banding
        float stepSize = min(distToLight, u_shadowLength) / 8.0;
        
        // Add noise offset to prevent banding
        float noiseOffset = noise(uv * u_resolution * 0.1) * 0.5;
        
        for (int i = 1; i <= 8; i++) {
            float jitter = 1.0 + (noiseOffset - 0.25) * 0.3;
            vec2 samplePos = uv + rayDir * stepSize * float(i) * jitter;
            
            if (samplePos.x < 0.0 || samplePos.x > 1.0 || samplePos.y < 0.0 || samplePos.y > 1.0) {
                break;
            }
            
            float sampleDepth = texture2D(u_depth, samplePos).r;
            float depthDiff = baseDepth - sampleDepth;
            
            if (depthDiff > 0.03) {
                // Smooth blocker contribution
                float blockerStrength = smoothstep(0.03, 0.2, depthDiff);
                float distFactor = 1.0 - (float(i) / 8.0);
                shadow += blockerStrength * distFactor * 0.25;
            }
        }
        
        // Smooth the shadow to reduce banding
        shadow = smoothstep(0.0, u_shadowSoftness + 0.2, shadow);
        
        return clamp(shadow * u_shadowIntensity, 0.0, 0.8);
    }
    
    // Simplified directional shadow - fewer samples
    float castDirectionalShadow(vec2 uv, vec2 lightPos) {
        vec2 awayFromLight = normalize(uv - lightPos);
        
        float shadow = 0.0;
        float stepSize = u_shadowLength * 0.08;
        
        // Add noise to prevent banding
        float noiseVal = noise(uv * u_resolution * 0.05);
        
        for (int i = 1; i <= 6; i++) {
            float jitter = 1.0 + (noiseVal - 0.5) * 0.4;
            vec2 samplePos = uv - awayFromLight * stepSize * float(i) * jitter;
            
            if (samplePos.x < 0.0 || samplePos.x > 1.0 || samplePos.y < 0.0 || samplePos.y > 1.0) {
                continue;
            }
            
            float sampleDepth = texture2D(u_depth, samplePos).r;
            float currentDepth = texture2D(u_depth, uv).r;
            
            if (sampleDepth < currentDepth - 0.04) {
                float contribution = (1.0 - float(i) / 6.0) * 0.2;
                shadow += contribution;
            }
        }
        
        return clamp(shadow * u_shadowIntensity, 0.0, 0.6);
    }
    
    // ========== CHROMATIC ABERRATION ==========
    
    vec3 sampleWithChromatic(vec2 uv, vec2 dir, float strength) {
        float offset = strength * 0.003;
        
        float r = getOcclusion(uv + dir * offset, 0.7);
        float g = getOcclusion(uv, 0.7);
        float b = getOcclusion(uv - dir * offset, 0.7);
        
        return vec3(r, g, b);
    }
    
    // ========== MAIN SHADER ==========
    
    void main() {
        vec3 original = texture2D(u_image, v_uv).rgb;
        float depth = texture2D(u_depth, v_uv).r;
        
        // Direction to sun
        vec2 toSun = u_sunPosition - v_uv;
        float distToSun = length(toSun);
        vec2 rayDir = normalize(toSun);
        
        // ===== RADIAL BLUR WITH ENHANCEMENTS =====
        
        vec3 accumulation = vec3(0.0);
        float totalWeight = 0.0;
        float currentWeight = u_weight;
        
        // Ray parameters
        float rayLength = distToSun * u_density;
        float stepSize = rayLength / float(u_samples);
        
        // Noise seed based on UV for variation
        float noiseSeed = noise(v_uv * u_resolution * 0.1);
        
        for (int i = 0; i < 128; i++) {
            if (i >= u_samples) break;
            
            float t = float(i) / float(u_samples);
            
            // Add noise-based jitter for natural look
            float jitter = 1.0 + (noise(v_uv * u_resolution * 0.05 + float(i) * 0.1) - 0.5) * u_noise;
            
            // Sample position along ray
            vec2 samplePos = v_uv + rayDir * stepSize * float(i) * jitter;
            
            // Sample with or without chromatic aberration
            vec3 occlusionSample;
            if (u_chromatic > 0.01) {
                occlusionSample = sampleWithChromatic(samplePos, rayDir, u_chromatic * t);
            } else {
                float occ = getOcclusion(samplePos, mix(0.5, 1.0, t));
                occlusionSample = vec3(occ);
            }
            
            // Add sun glow contribution at sample position
            float sampleDistToSun = length(samplePos - u_sunPosition);
            float sunInfluence = 1.0 - smoothstep(0.0, u_sunRadius * 2.0, sampleDistToSun);
            occlusionSample += vec3(sunInfluence) * 0.3;
            
            // Accumulate with decay
            accumulation += occlusionSample * currentWeight;
            totalWeight += currentWeight;
            
            currentWeight *= u_decay;
        }
        
        // Normalize
        vec3 rays = (totalWeight > 0.0) ? accumulation / totalWeight : vec3(0.0);
        
        // ===== SUN GLOW =====
        
        vec3 sunGlow = getSunGlow(v_uv, u_sunPosition);
        rays = max(rays, sunGlow * 0.6);
        
        // ===== ATMOSPHERIC SCATTERING =====
        
        // Rayleigh-like scattering - blue shift at distance
        vec3 scatterColor = mix(u_rayColor, vec3(0.7, 0.85, 1.0), u_scatter * distToSun);
        rays *= mix(vec3(1.0), scatterColor, u_scatter);
        
        // Distance-based density
        float atmosphericDensity = 1.0 - smoothstep(0.0, 1.5, distToSun * 0.8);
        rays *= mix(1.0, atmosphericDensity, u_scatter * 0.5);
        
        // ===== NOISE VARIATION =====
        
        float noiseVar = 1.0 + (noiseSeed - 0.5) * u_noise * 0.3;
        rays *= noiseVar;
        
        // ===== BLOOM EFFECT =====
        
        // Add bloom halo around bright areas
        float originalLum = dot(original, vec3(0.2126, 0.7152, 0.0722));
        float bloomMask = smoothstep(0.6, 1.0, originalLum);
        vec3 bloom = original * bloomMask * u_bloom;
        
        // ===== APPLY RAYS =====
        
        // Color and intensity
        vec3 coloredRays = rays * u_rayColor * u_intensity;
        
        // Exposure curve for natural falloff
        coloredRays = 1.0 - exp(-coloredRays * u_exposure);
        
        // ===== EDGE FADEOUT =====
        
        // Fade at screen edges
        vec2 edgeDist = min(v_uv, 1.0 - v_uv);
        float edgeFade = smoothstep(0.0, 0.08, min(edgeDist.x, edgeDist.y));
        coloredRays *= edgeFade;
        
        // Fade with distance from sun (optional, subtle)
        float distFade = 1.0 - smoothstep(0.0, 1.4, distToSun);
        coloredRays *= mix(1.0, distFade, 0.2);
        
        // ===== BLENDING =====
        
        // Screen blend for additive light effect
        vec3 screenBlend = 1.0 - (1.0 - original) * (1.0 - coloredRays);
        
        // Soft blend based on ray intensity
        float rayIntensity = dot(coloredRays, vec3(0.333));
        vec3 result = mix(original, screenBlend, smoothstep(0.0, 0.4, rayIntensity));
        
        // Add bloom
        result += bloom;
        
        // ===== SHADOW CASTING =====
        
        // Calculate shadows from blockers (trees, objects between pixel and light)
        float blockerShadow = 0.0;
        float directionalShadow = 0.0;
        
        if (u_shadowIntensity > 0.01) {
            // Check for objects blocking the light path
            blockerShadow = getShadowOcclusion(v_uv, u_sunPosition);
            
            // Cast directional shadows away from light
            directionalShadow = castDirectionalShadow(v_uv, u_sunPosition);
            
            // Combine both shadow types
            float totalShadow = max(blockerShadow, directionalShadow);
            
            // Apply shadow - darken the result
            // Don't shadow the bright light source area itself
            float nearLightMask = 1.0 - smoothstep(0.0, u_sunRadius * 2.0, distToSun);
            totalShadow *= (1.0 - nearLightMask);
            
            // Subtle shadow color (slightly cool/blue for realism)
            vec3 shadowColor = vec3(0.1, 0.12, 0.15);
            result = mix(result, result * (1.0 - totalShadow * 0.7) + shadowColor * totalShadow * 0.1, totalShadow);
        }
        
        // ===== TONE MAPPING =====
        
        // ACES filmic tone mapping for HDR look
        result = mix(result, ACESFilm(result), u_toneMap);
        
        // Preserve shadows - don't affect very dark areas
        float shadowMask = smoothstep(0.0, 0.15, originalLum);
        result = mix(original, result, shadowMask);
        
        // ===== COLOR GRADING =====
        
        // Subtle warm tint in highlights
        float highlightMask = smoothstep(0.5, 1.0, dot(result, vec3(0.333)));
        result += u_rayColor * highlightMask * 0.03;
        
        gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
    }
`;

export default {
    VERTEX_SHADER,
    ADVANCED_GODRAYS_SHADER
};
