/**
 * GodRaysShader.js - GLSL Shaders for Volumetric Lighting Effect
 * 
 * Three-pass rendering pipeline:
 * 1. Occlusion Pass - Creates light source mask
 * 2. Radial Blur Pass - Blurs toward sun with decay
 * 3. Composite Pass - Blends rays onto original image
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
// PASS 1: OCCLUSION MASK SHADER
// ============================================
// Creates a high-contrast mask showing only the light source
// White = bright + far (sky/sun), Black = dark or near (blockers)
export const OCCLUSION_FRAGMENT_SHADER = `
    precision highp float;
    
    uniform sampler2D u_image;
    uniform sampler2D u_depth;
    uniform float u_lumThreshold;      // Brightness threshold (0.7 default)
    uniform float u_depthThreshold;    // Depth threshold (0.8 default)
    uniform vec2 u_sunPosition;        // Where the sun is
    uniform float u_sunRadius;         // Sun glow radius
    
    varying vec2 v_uv;
    
    void main() {
        vec4 color = texture2D(u_image, v_uv);
        float depth = texture2D(u_depth, v_uv).r;
        
        // Calculate luminance
        float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        
        // Is this pixel bright enough to be a light source?
        float isBright = step(u_lumThreshold, luminance);
        
        // Is this pixel far enough (sky/background)?
        float isFar = step(u_depthThreshold, 1.0 - depth); // Invert if depth=1 is near
        
        // Light source = bright AND far
        float isLight = isBright * isFar;
        
        // Add sun glow at sun position
        float distToSun = length(v_uv - u_sunPosition);
        float sunGlow = 1.0 - smoothstep(0.0, u_sunRadius, distToSun);
        
        // Combine: either detected light or sun glow
        float lightMask = max(isLight, sunGlow * 0.8);
        
        gl_FragColor = vec4(vec3(lightMask), 1.0);
    }
`;

// ============================================
// PASS 2: RADIAL BLUR SHADER
// ============================================
// Samples toward sun position with exponential decay
// This creates the "god ray" streaks
export const RADIAL_BLUR_FRAGMENT_SHADER = `
    precision highp float;
    
    uniform sampler2D u_occlusionMask;
    uniform vec2 u_sunPosition;
    uniform float u_density;    // How far to blur (0.5 default)
    uniform float u_decay;      // Falloff per sample (0.95 default)
    uniform float u_weight;     // Initial sample weight (0.5 default)
    uniform float u_exposure;   // Final brightness multiplier
    uniform int u_samples;      // Number of samples (64 default)
    
    varying vec2 v_uv;
    
    void main() {
        vec2 uv = v_uv;
        
        // Direction from pixel toward sun
        vec2 deltaUV = (uv - u_sunPosition) * u_density / float(u_samples);
        
        // Accumulate light samples
        float illumination = 0.0;
        float currentDecay = 1.0;
        
        for (int i = 0; i < 128; i++) {
            if (i >= u_samples) break;
            
            // Sample the occlusion mask
            float sample = texture2D(u_occlusionMask, uv).r;
            
            // Accumulate with decay
            illumination += sample * currentDecay * u_weight;
            
            // Move toward sun
            uv -= deltaUV;
            
            // Apply decay
            currentDecay *= u_decay;
        }
        
        // Apply exposure
        illumination *= u_exposure;
        
        gl_FragColor = vec4(vec3(illumination), 1.0);
    }
`;

// ============================================
// PASS 3: COMPOSITE SHADER
// ============================================
// Blends the god rays onto the original image
export const COMPOSITE_FRAGMENT_SHADER = `
    precision highp float;
    
    uniform sampler2D u_original;
    uniform sampler2D u_rays;
    uniform float u_intensity;
    uniform vec3 u_rayColor;
    uniform float u_blend;  // 0 = additive, 1 = screen blend
    
    varying vec2 v_uv;
    
    void main() {
        vec3 original = texture2D(u_original, v_uv).rgb;
        float rayStrength = texture2D(u_rays, v_uv).r;
        
        // Color the rays
        vec3 coloredRays = rayStrength * u_rayColor * u_intensity;
        
        // Blend modes
        vec3 additive = original + coloredRays;
        vec3 screen = 1.0 - (1.0 - original) * (1.0 - coloredRays);
        
        vec3 result = mix(additive, screen, u_blend);
        
        // Clamp to prevent over-brightness
        result = clamp(result, 0.0, 1.0);
        
        gl_FragColor = vec4(result, 1.0);
    }
`;

// ============================================
// ENHANCED SINGLE-PASS GOD RAYS
// ============================================
// Smooth, high-quality god rays with better controls
export const SINGLE_PASS_FRAGMENT_SHADER = `
    precision highp float;
    
    uniform sampler2D u_image;
    uniform sampler2D u_depth;
    uniform vec2 u_sunPosition;
    uniform float u_intensity;
    uniform float u_decay;
    uniform float u_density;
    uniform float u_weight;
    uniform float u_lumThreshold;
    uniform float u_depthThreshold;
    uniform vec3 u_rayColor;
    uniform int u_samples;
    uniform float u_sunRadius;      // NEW: Sun glow radius
    uniform float u_exposure;       // NEW: Exposure control
    uniform float u_softness;       // NEW: Edge softness
    
    varying vec2 v_uv;
    
    // Smooth step function for softer transitions
    float smoothOcclusion(vec2 uv) {
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            return 0.0;
        }
        
        vec4 color = texture2D(u_image, uv);
        float depth = texture2D(u_depth, uv).r;
        
        // Calculate luminance
        float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        
        // Soft threshold for brightness (smoothstep instead of step)
        float lumRange = 0.15; // Transition width
        float isBright = smoothstep(u_lumThreshold - lumRange, u_lumThreshold + lumRange, luminance);
        
        // Soft threshold for depth
        float depthRange = 0.1;
        float isFar = smoothstep(u_depthThreshold - depthRange, u_depthThreshold + depthRange, 1.0 - depth);
        
        return isBright * isFar;
    }
    
    void main() {
        vec3 original = texture2D(u_image, v_uv).rgb;
        
        // Distance from current pixel to sun
        float distToSun = length(v_uv - u_sunPosition);
        
        // Sun glow - smooth circular gradient
        float sunGlow = 1.0 - smoothstep(0.0, u_sunRadius, distToSun);
        sunGlow = pow(sunGlow, 2.0); // Make it more concentrated
        
        // Radial blur toward sun with higher sample count
        vec2 uv = v_uv;
        vec2 toSun = u_sunPosition - v_uv;
        float rayLength = length(toSun) * u_density;
        vec2 rayDir = normalize(toSun);
        
        float illumination = 0.0;
        float currentWeight = u_weight;
        float totalWeight = 0.0;
        
        // Sample count based on distance (closer = more samples)
        int sampleCount = u_samples;
        float stepSize = rayLength / float(sampleCount);
        
        for (int i = 0; i < 128; i++) {
            if (i >= sampleCount) break;
            
            // Progress along ray (0 to 1)
            float t = float(i) / float(sampleCount);
            
            // Sample position with slight jitter for smoothness
            vec2 samplePos = v_uv + rayDir * stepSize * float(i);
            
            // Get occlusion with smooth threshold
            float occlusion = smoothOcclusion(samplePos);
            
            // Add sun glow influence at sample position
            float sampleDistToSun = length(samplePos - u_sunPosition);
            float sampleSunGlow = 1.0 - smoothstep(0.0, u_sunRadius * 2.0, sampleDistToSun);
            occlusion = max(occlusion, sampleSunGlow * 0.5);
            
            // Accumulate with exponential decay
            illumination += occlusion * currentWeight;
            totalWeight += currentWeight;
            
            // Apply decay
            currentWeight *= u_decay;
        }
        
        // Normalize
        if (totalWeight > 0.0) {
            illumination /= totalWeight;
        }
        
        // Add direct sun glow
        illumination = max(illumination, sunGlow * 0.8);
        
        // Apply exposure curve (soft knee)
        illumination = 1.0 - exp(-illumination * u_exposure);
        
        // Soft edge falloff at screen edges
        vec2 edgeDist = min(v_uv, 1.0 - v_uv);
        float edgeFade = smoothstep(0.0, 0.1, min(edgeDist.x, edgeDist.y));
        illumination *= edgeFade;
        
        // Distance-based falloff (rays fade at distance from sun)
        float distanceFade = 1.0 - smoothstep(0.0, 1.2, distToSun);
        illumination *= mix(1.0, distanceFade, 0.3);
        
        // Color the rays with subtle warm-to-cool gradient
        vec3 rays = illumination * u_rayColor * u_intensity;
        
        // High-quality screen blend
        vec3 blended = 1.0 - (1.0 - original) * (1.0 - rays);
        
        // Preserve original colors in dark areas
        float originalLum = dot(original, vec3(0.299, 0.587, 0.114));
        vec3 result = mix(original, blended, smoothstep(0.0, 0.3, illumination));
        
        // Subtle color grading - warm highlights
        result += rays * 0.1 * (1.0 - originalLum);
        
        gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
    }
`;


export default {
    VERTEX_SHADER,
    OCCLUSION_FRAGMENT_SHADER,
    RADIAL_BLUR_FRAGMENT_SHADER,
    COMPOSITE_FRAGMENT_SHADER,
    SINGLE_PASS_FRAGMENT_SHADER
};
