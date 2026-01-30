#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

// Basic adjustments
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
uniform float u_structure;
uniform float u_dehaze;

// HSL Per-Channel (8 colors × 3 channels = 24 uniforms)
uniform float u_hslHue[8];    // Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta
uniform float u_hslSat[8];
uniform float u_hslLum[8];

// Tone Curve LUT textures
uniform bool u_hasCurveLut;
uniform bool u_hasRgbCurve;
uniform sampler2D u_curveLutTexRgb;
uniform bool u_hasRedCurve;
uniform sampler2D u_curveLutTexRed;
uniform bool u_hasGreenCurve;
uniform sampler2D u_curveLutTexGreen;
uniform bool u_hasBlueCurve;
uniform sampler2D u_curveLutTexBlue;

// Multi-pass textures
uniform sampler2D u_blurTexture;

#include <modules/common.glsl>

// Apply per-channel HSL adjustments
// Apply per-channel HSL adjustments
vec3 applyHSLAdjustments(vec3 hsl) {
    float hue = hsl.x;
    float sat = hsl.y;
    float lum = hsl.z;
    
    // Skip if too desaturated (adjustments won't be visible)
    if (sat < 0.05) return hsl;
    
    float totalHueShift = 0.0;
    float satMultiplier = 1.0;
    float lumShift = 0.0;
    float totalWeight = 0.0;
    
    for (int i = 0; i < 8; i++) {
        float weight = getColorWeight(hue, i);
        if (weight > 0.001) {
            totalWeight += weight;
            
            // Hue shift: map -100..+100 to -60°..+60°
            totalHueShift += u_hslHue[i] * 0.6 * weight;
            
            // Saturation: map -100..+100 to 0..2 multiplier
            float satAdj = u_hslSat[i] / 100.0;
            satMultiplier += satAdj * weight;
            
            // Luminance: map -100..+100 to -0.5..+0.5
            lumShift += (u_hslLum[i] / 100.0) * 0.5 * weight;
        }
    }
    
    if (totalWeight > 0.001) {
        // Normalize adjustments by total weight
        totalHueShift /= totalWeight;
        
        // Apply hue shift
        hsl.x = mod(hue + totalHueShift, 360.0);
        
        // Apply saturation
        hsl.y = clamp(sat * satMultiplier, 0.0, 1.0);
        
        // Apply luminance
        hsl.z = clamp(lum + lumShift, 0.0, 1.0);
    }
    
    return hsl;
}


void main() {
    vec4 pixel = texture(u_texture, v_texCoord);
    vec3 srgb = pixel.rgb;
    
    // === CLARITY & TEXTURE (Frequency Separation) ===
    vec4 blurredPixel = texture(u_blurTexture, v_texCoord);
    vec3 blurredSrgb = blurredPixel.rgb;

    if (u_clarity != 0.0 || u_structure != 0.0) {
        // High Frequency = Original - Blurred
        vec3 highFreq = srgb - blurredSrgb;
        
        // Midtone Mask for Clarity (protect highlights/shadows)
        float lum = luminance(srgb);
        float mask = 1.0 - smoothstep(0.0, 0.4, abs(lum - 0.5)); 
        
        // Apply Clarity (masked)
        if (u_clarity != 0.0) {
            srgb += highFreq * u_clarity * mask;
        }

        // Apply Structure (unmasked, enhances all details)
        if (u_structure != 0.0) {
            srgb += highFreq * u_structure * 0.5; // Multiplier to keep it subtle
        }
    }
    
    // === STEP 1: Apply HSL per-channel adjustments (in sRGB/perceptual space) ===
    bool hasHSL = false;
    for (int i = 0; i < 8; i++) {
        if (u_hslHue[i] != 0.0 || u_hslSat[i] != 0.0 || u_hslLum[i] != 0.0) {
            hasHSL = true;
            break;
        }
    }
    
    if (hasHSL) {
        vec3 hsl = rgbToHsl(srgb);
        hsl = applyHSLAdjustments(hsl);
        srgb = hslToRgb(hsl);
    }
    
    // === STEP 2: Convert to linear for remaining adjustments ===
    vec3 linear = vec3(sRGBtoLinear(srgb.r), sRGBtoLinear(srgb.g), sRGBtoLinear(srgb.b));
    
    // --- 1. EXPOSURE (Gain) ---
    // Simple photometric exposure
    if (u_exposure != 0.0) {
        float gain = pow(2.0, u_exposure);
        linear *= gain;
    }

    // --- 2. CONTRAST (Filmic S-Curve) ---
    // Best applied in Perceptual/Gamma space to match human vision
    if (u_contrast != 0.0) {
        // Convert to Log/Gamma approximation for contrast
        vec3 logC = pow(max(linear, 0.0001), vec3(0.5)); // Approx Gamma 2.0
        
        // S-Curve centered at mid-gray (0.5 in Log space approx)
        // Fix: Invert logic. 
        // Higher contrast -> push away from 0.5 -> power < 1.0
        // Lower contrast -> pull towards 0.5 -> power > 1.0
        float c = 1.0 - u_contrast * 0.5; 
        
        // Polynomial S-Curve: x < 0.5 ? 0.5 * (2x)^c : 1.0 - 0.5 * (2(1-x))^c
        // Check for separate R/G/B to avoid saturation shifts? No, coupled is standard.
        vec3 centered = logC - 0.5;
        vec3 signs = sign(centered);
        vec3 mag = abs(centered) * 2.0; // 0..1 range
        
        // Apply power curve
        vec3 modified = 0.5 * signs * pow(max(mag, 0.0), vec3(c));
        logC = modified + 0.5;
        
        // Back to Linear
        linear = pow(max(logC, 0.0), vec3(2.0));
    }

    // --- 3. HIGHLIGHTS & SHADOWS (Tone Mapping) ---
    // Luma-based to protect color ratios
    float luma = luminance(linear);
    
    // Highlights: Reinhard-style compression for recovery, Gamma roll-off for boost
    if (u_highlights != 0.0) {
        float target = luma;
        if (u_highlights < 0.0) {
             // Recover: Compress highlights > 0.5
             // Formula: L_new = L / (1 + strength * max(0, L - threshold))
             float strength = -u_highlights * 2.0; // Scale 
             float threshold = 0.5; // Only affect highs
             float overshoot = max(0.0, luma - threshold);
             float compressed = luma / (1.0 + strength * overshoot);
             // Blend based on luminance to ensure continuity
             target = mix(luma, compressed, smoothstep(threshold, 1.0, luma) * 0.8);
        } else {
             // Boost: Soft shoulder push
             float strength = u_highlights * 0.5;
             target = luma + strength * smoothstep(0.5, 1.0, luma) * (1.0 - luma);
        }
        
        // Apply scaling to RGB
        linear *= (target / max(0.0001, luma));
    }
    
    // Shadows: Lift deep tones without lifting black point
    if (u_shadows != 0.0) {
         float target = luma;
         if (u_shadows > 0.0) {
             // Lift: Gamma-like lift constrained to shadows
             // Target Zone: 0.0 - 0.4
             float strength = u_shadows * 0.5;
             float mask = 1.0 - smoothstep(0.0, 0.5, luma);
             // Simple lift: L^(1-s)
             float lifted = pow(luma, 1.0 - strength);
             target = mix(luma, lifted, mask);
         } else {
             // Crush: Gamma-like drop
             float strength = -u_shadows * 0.5;
             float mask = 1.0 - smoothstep(0.0, 0.5, luma);
             float crushed = pow(luma, 1.0 + strength);
             target = mix(luma, crushed, mask);
         }
         linear *= (target / max(0.0001, luma));
    }

    // --- 4. WHITES & BLACKS (Dynamic Range Remapping) ---
    // Soft Clip: Shift endpoints
    if (u_whites != 0.0 || u_blacks != 0.0) {
        // Concept: Map Linear [0..1] range to new endpoints [Black..White]
        // Whites: Affects clipping point (1.0)
        // Blacks: Affects black point (0.0)
        
        // Calculate remapping curve
        float whitePt = 1.0;
        float blackPt = 0.0;
        
        if (u_whites > 0.0) {
             // Push whites up (clip later): divide by (1 - w)
             linear /= max(0.01, 1.0 - u_whites * 0.2); // Gentle scaling
        } else if (u_whites < 0.0) {
             // Pull whites down (grey out): multiply
             // Smart clipping: Soft knee at top
             float knee = 0.8 + u_whites * 0.2; // 0.6 to 0.8
             if (luma > knee) {
                  float over = luma - knee;
                  float compression = 1.0 / (1.0 + abs(u_whites) * 5.0 * over);
                  linear *= compression;
             }
        }
        
        if (u_blacks != 0.0) {
             // Offset black point
             float offset = u_blacks * 0.1; // +/- 0.1 shift
             linear += offset;
             // Ensure we don't invert (max(0)) but allow crushing
             linear = max(vec3(0.0), linear); 
        }
    }
    
    // White Balance
    if (u_temperature != 0.0 || u_tint != 0.0) {
        linear.r *= 1.0 + u_temperature * 0.25;
        linear.b *= 1.0 - u_temperature * 0.25;
        linear.g *= 1.0 - u_tint * 0.15;
        linear.r *= 1.0 + u_tint * 0.08;
    }

    // Dehaze (Approximation)
    if (u_dehaze != 0.0) {
        float dehaze = u_dehaze * 0.5; // Scale for usability
        
        // 1. Airlight Removal (darken shadows/blacks)
        // If removing haze (positive), we subtract; if adding haze (negative), we add.
        linear -= vec3(0.05 * dehaze);
        
        // 2. Contrast/Gamma compensation
        // Removing haze needs more contrast.
        float power = 1.0 + dehaze * 0.5;
        linear = pow(max(linear, vec3(0.0)), vec3(power));
        
        // 3. Saturation boost (removing haze reveals color)
        if (dehaze > 0.0) {
            vec3 luma = vec3(luminance(linear));
            linear = mix(luma, linear, 1.0 + dehaze * 0.4);
        } else {
            // Adding haze washes out color
            vec3 luma = vec3(luminance(linear));
            linear = mix(luma, linear, 1.0 + dehaze * 0.3); // dehaze is negative here
        }
    }
    
    // Vibrance/Saturation
    if (u_vibrance != 0.0 || u_saturation != 0.0) {
        vec3 lab = linearRGBtoOKLab(linear);
        float chroma = length(lab.yz);
        if (u_vibrance != 0.0) lab.yz *= 1.0 + u_vibrance * (1.0 - min(1.0, chroma / 0.2)) * 0.5;
        if (u_saturation != 0.0) lab.yz *= 1.0 + u_saturation;
        linear = max(OKLabToLinearRGB(lab), vec3(0.0));
    }
    
    // Convert to sRGB
    vec3 finalSrgb = vec3(linearToSRGB(clamp(linear.r, 0.0, 1.0)), linearToSRGB(clamp(linear.g, 0.0, 1.0)), linearToSRGB(clamp(linear.b, 0.0, 1.0)));
    
    // Apply Tone Curve (in sRGB space, after all adjustments)
    if (u_hasCurveLut) {
        // RGB composite curve
        if (u_hasRgbCurve) {
            float rVal = texture(u_curveLutTexRgb, vec2(finalSrgb.r, 0.5)).r;
            float gVal = texture(u_curveLutTexRgb, vec2(finalSrgb.g, 0.5)).r;
            float bVal = texture(u_curveLutTexRgb, vec2(finalSrgb.b, 0.5)).r;
            finalSrgb = vec3(rVal, gVal, bVal);
        }
        
        // Per-channel curves
        if (u_hasRedCurve) {
            finalSrgb.r = texture(u_curveLutTexRed, vec2(finalSrgb.r, 0.5)).r;
        }
        if (u_hasGreenCurve) {
            finalSrgb.g = texture(u_curveLutTexGreen, vec2(finalSrgb.g, 0.5)).r;
        }
        if (u_hasBlueCurve) {
            finalSrgb.b = texture(u_curveLutTexBlue, vec2(finalSrgb.b, 0.5)).r;
        }
    }
    
    fragColor = vec4(clamp(finalSrgb, 0.0, 1.0), pixel.a);
}
