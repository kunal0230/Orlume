/**
 * AdvancedGodRaysShader.js - Physics & Geometry-Driven Volumetric Crepuscular God Rays
 * 
 * Features:
 * - Henyey-Greenstein Mie atmospheric scattering phase function (authentic forward-scattering bloom)
 * - Image geometry silhouette detection (light shafts emerge organically from scene edges & contours)
 * - Depth-aware 3D occlusion & high-contrast 2D geometric shadow extinction
 * - Sub-pixel dither jitter eliminating stepping rings
 * - Wavelength extinction (Rayleigh / Mie atmospheric chromatic penetration)
 * - Non-destructive photographic optical screen blend
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
// GEOMETRY & PHYSICS VOLUMETRIC GOD RAYS SHADER
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
    uniform float u_noise;       // Image geometry edge influence / shaft contrast
    uniform float u_bloom;       // Sun core bloom intensity
    
    // Resolution for noise dither
    uniform vec2 u_resolution;
    
    varying vec2 v_uv;
    
    // Fast pseudo-random hash for sub-pixel jitter
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    
    // Henyey-Greenstein Mie Atmospheric Scattering Phase Function
    // Models physical forward-scattering through aerosols, humidity, and atmospheric dust
    float henyeyGreenstein(float cosTheta, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
    }
    
    // Evaluate geometric occlusion at coord
    // Returns 1.0 for transparent / illuminated sky, 0.0 for opaque silhouette blockers
    float evaluateOcclusion(vec2 coord) {
        if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) {
            return 0.0;
        }
        
        // 1. AI Depth Occlusion (when depth map is active)
        if (u_hasDepth == 1) {
            float depth = texture2D(u_depth, coord).r;
            // Foreground subjects (depth > threshold) physically occlude background rays
            float occluder = smoothstep(u_depthThreshold - 0.08, u_depthThreshold + 0.08, depth);
            return (1.0 - occluder);
        } else {
            // 2. Image Geometry Occlusion:
            // High-contrast silhouettes (cliffs, foliage, tree branches, window frames)
            // have lower luminance than the sky and act as physical blockers
            vec4 col = texture2D(u_image, coord);
            float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
            float transmittance = smoothstep(u_lumThreshold * 0.35, u_lumThreshold * 1.05, luma);
            return transmittance;
        }
    }
    
    void main() {
        vec4 baseColor = texture2D(u_image, v_uv);
        vec3 original = baseColor.rgb;
        
        // Vector from current pixel towards the sun
        vec2 deltaUV = (u_sunPosition - v_uv);
        float distToSun = length(deltaUV);
        vec2 rayDir = (distToSun > 0.0001) ? normalize(deltaUV) : vec2(0.0, 1.0);
        
        // Step size along the ray
        vec2 stepUV = deltaUV * (u_density / float(u_samples));
        
        // Sub-pixel dither jitter to eliminate stepping rings/banding
        float jitter = hash(v_uv * u_resolution) - 0.5;
        vec2 coord = v_uv + stepUV * jitter;
        
        // 1. Physical Mie Atmospheric Scattering Phase Function
        // Forward scattering intensifies when looking in the direction of the light source
        float cosTheta = clamp(1.0 - distToSun * 0.85, -1.0, 1.0);
        float miePhase = henyeyGreenstein(cosTheta, 0.72) * 12.5;
        
        // 2. Image Geometry Silhouette Modulation
        // Sample perpendicular image gradient to detect natural silhouette edges (branches, ridges)
        vec2 perp = vec2(-rayDir.y, rayDir.x) * (2.5 / u_resolution);
        float lumaLeft = dot(texture2D(u_image, v_uv + perp).rgb, vec3(0.2126, 0.7152, 0.0722));
        float lumaRight = dot(texture2D(u_image, v_uv - perp).rgb, vec3(0.2126, 0.7152, 0.0722));
        float edgeContrast = abs(lumaLeft - lumaRight);
        
        // Light shafts naturally conform to the geometry of scene blockers
        float geometryShaftMod = 1.0 + edgeContrast * 3.2 * u_noise;
        
        // 3. Volumetric In-Scattering Accumulation
        float rayTransmittance = 1.0;
        vec3 inScatter = vec3(0.0);
        float stepWeight = (1.0 / float(u_samples)) * 1.8;
        float currentWeight = stepWeight;
        
        for (int i = 0; i < 96; i++) {
            if (i >= u_samples) break;
            
            coord += stepUV;
            float visibility = evaluateOcclusion(coord);
            
            // Optical extinction along the ray
            rayTransmittance *= mix(1.0, visibility, 0.20);
            
            // Accumulate in-scattered light
            inScatter += visibility * currentWeight * rayTransmittance;
            currentWeight *= u_decay;
        }
        
        // 4. Natural Atmospheric Radial Density Falloff
        float falloffRate = mix(2.0, 0.75, clamp(u_density, 0.0, 1.0));
        float atmosphericFalloff = 1.0 / (1.0 + distToSun * falloffRate);
        
        // Combine volumetric in-scattering with Mie phase and scene geometry
        vec3 totalRayLight = inScatter * miePhase * geometryShaftMod * atmosphericFalloff * u_exposure;
        
        // 5. Sun Core Bloom Halo
        float sunGlow = pow(1.0 - smoothstep(0.0, u_sunRadius * 2.2, distToSun), 2.5) * u_bloom;
        totalRayLight += vec3(sunGlow);
        
        // 6. Atmospheric Wavelength Extinction
        // Warmer wavelengths penetrate deeper through atmospheric dust/haze
        vec3 atmosphereColor = u_rayColor;
        atmosphereColor.r = pow(atmosphereColor.r, 0.95);
        atmosphereColor.b = pow(atmosphereColor.b, 1.15);
        
        vec3 finalRays = totalRayLight * atmosphereColor * u_intensity;
        
        // 7. Non-Destructive Photographic Optical Screen Blend
        // Preserves 100% of underlying details, shadows, and natural color science
        vec3 result = 1.0 - (1.0 - original) * (1.0 - clamp(finalRays, 0.0, 1.0));
        
        // Gentle edge fadeout so rays don't abruptly clip at screen boundaries
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
