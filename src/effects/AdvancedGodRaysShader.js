/**
 * AdvancedGodRaysShader.js - Professional Volumetric Crepuscular Rays
 * 
 * Implements GPU-accelerated volumetric lighting:
 * - Radial crepuscular ray marching with exponential attenuation
 * - Light emission mask from sun disc core + highlight luminance
 * - Depth-aware occlusion (foreground blockers cast realistic beam silhouettes)
 * - Atmospheric scattering & angular streak beam modulation
 * - Dithered sub-pixel jitter to prevent ray stepping rings
 * - Non-destructive photographic optical screen blend (100% color & tone preservation)
 */

// Shared vertex shader for full-screen quad
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
// VOLUMETRIC GOD RAYS FRAGMENT SHADER
// ============================================
export const ADVANCED_GODRAYS_SHADER = `
    precision highp float;
    
    uniform sampler2D u_image;
    uniform sampler2D u_depth;
    uniform int u_hasDepth;
    
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
    uniform float u_noise;       // Beam streakiness / atmospheric variation
    uniform float u_bloom;       // Sun core bloom intensity
    
    // Resolution for noise dither
    uniform vec2 u_resolution;
    
    varying vec2 v_uv;
    
    // Fast pseudo-random hash for sub-pixel jitter
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    
    // Extract volumetric light emission at UV
    float getLightEmission(vec2 uv) {
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            return 0.0;
        }
        
        vec4 col = texture2D(u_image, uv);
        
        // Rec.709 perceived luminance
        float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
        
        // Highlights above luminance threshold emit light
        float brightPass = smoothstep(u_lumThreshold - 0.15, u_lumThreshold + 0.15, luma);
        
        // If AI Depth map is present:
        // Depth Anything: near objects are bright (> threshold), far sky is dark (< threshold).
        // Foreground objects block the light; far sky/background allows rays through.
        if (u_hasDepth == 1) {
            float d = texture2D(u_depth, uv).r;
            float occluderMask = 1.0 - smoothstep(u_depthThreshold - 0.12, u_depthThreshold + 0.12, d);
            brightPass *= occluderMask;
        }
        
        // Direct sun disc emitter at light position
        float distToSun = length(uv - u_sunPosition);
        float sunDisc = 1.0 - smoothstep(0.0, u_sunRadius, distToSun);
        sunDisc = pow(sunDisc, 2.0);
        
        return max(brightPass, sunDisc * 1.5);
    }
    
    void main() {
        vec4 baseColor = texture2D(u_image, v_uv);
        vec3 original = baseColor.rgb;
        
        // Vector from current pixel towards the sun
        vec2 deltaUV = (u_sunPosition - v_uv);
        float distToSun = length(deltaUV);
        
        // Step size along the ray
        vec2 stepUV = deltaUV * (u_density / float(u_samples));
        
        // Sub-pixel dither jitter to eliminate stepping rings/banding
        float jitter = hash(v_uv * u_resolution) - 0.5;
        vec2 coord = v_uv + stepUV * jitter;
        
        // Ray angle for volumetric beam streakiness (cathedral sunbeam shafts)
        float rayAngle = atan(deltaUV.y, deltaUV.x);
        float streakNoise = 0.72 + 0.28 * (
            sin(rayAngle * 28.0) * 0.5 + 
            sin(rayAngle * 56.0 + 1.2) * 0.3 + 
            sin(rayAngle * 112.0 + 2.5) * 0.2
        );
        float beamModulation = mix(1.0, streakNoise, u_noise);
        
        // Accumulate volumetric illumination along the ray
        vec3 rayAccum = vec3(0.0);
        float weight = u_weight;
        
        for (int i = 0; i < 96; i++) {
            if (i >= u_samples) break;
            
            coord += stepUV;
            
            float emission = getLightEmission(coord);
            rayAccum += emission * weight;
            weight *= u_decay;
        }
        
        // Apply beam modulation and exposure
        rayAccum *= beamModulation * u_exposure;
        
        // Sun core bloom halo around the light source
        float sunGlow = 1.0 - smoothstep(0.0, u_sunRadius * 2.5, distToSun);
        sunGlow = pow(sunGlow, 2.0) * u_bloom;
        
        // Combine rays with sun core glow and apply chosen ray color & intensity
        vec3 totalRays = (rayAccum + sunGlow) * u_rayColor * u_intensity;
        
        // Non-destructive optical screen blend:
        // Illuminates atmosphere naturally without crushing dark shadows or burning base tones
        vec3 result = 1.0 - (1.0 - original) * (1.0 - clamp(totalRays, 0.0, 1.0));
        
        // Gentle edge fadeout so rays don't cut off abruptly at screen boundaries
        vec2 edgeDist = min(v_uv, 1.0 - v_uv);
        float edgeFade = smoothstep(0.0, 0.02, min(edgeDist.x, edgeDist.y));
        result = mix(original, result, edgeFade);
        
        gl_FragColor = vec4(clamp(result, 0.0, 1.0), baseColor.a);
    }
`;

export default {
    VERTEX_SHADER,
    ADVANCED_GODRAYS_SHADER
};
