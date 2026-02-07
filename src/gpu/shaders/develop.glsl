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
// Multi-pass textures
uniform sampler2D u_blurTexture;

// Bradford Chromatic Adaptation Matrices (Column-Major for GLSL)
// M_BFD = [0.8951, 0.2664, -0.1614; -0.7502, 1.7135, 0.0367; 0.0389, -0.0685, 1.0296]
const mat3 RGB_TO_LMS_BRADFORD = mat3(
    0.8951, -0.7502, 0.0389,
    0.2664,  1.7135, -0.0685,
   -0.1614,  0.0367,  1.0296
);

const mat3 LMS_TO_RGB_BRADFORD = mat3(
    0.98699, 0.43231, -0.00853,
   -0.14705, 0.51836,  0.04004,
    0.15996, 0.04929,  0.96849
);

#include <modules/common.glsl>
#include <modules/color_grading.glsl>

// Color Grading Uniforms
uniform vec2 u_shadowsColor;      // x=Hue, y=Sat
uniform vec2 u_midtonesColor;
uniform vec2 u_highlightsColor;
uniform float u_shadowsLum;
uniform float u_midtonesLum;
uniform float u_highlightsLum;
uniform float u_colorBalance;     // -100 to 100
uniform float u_colorBlending;    // 0 to 100
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
    
    // --- 5. WHITE BALANCE (Bradford Adaptation) ---
    if (u_temperature != 0.0 || u_tint != 0.0) {
        // Temperature: LMS Space Adaptation
        if (u_temperature != 0.0) {
            vec3 lms = RGB_TO_LMS_BRADFORD * linear;
            // Warm (+): Boost Red (L), Cut Blue (S)
            // Cool (-): Cut Red (L), Boost Blue (S)
            // Very strong temperature boost (0.5x scaling)
            float temp = u_temperature * 0.5; 
            lms.x *= 1.0 + temp;      
            lms.z *= 1.0 - temp;      
            linear = LMS_TO_RGB_BRADFORD * lms;
        }

        // Tint: Green/Magenta (Simple Green Channel scaling applied in RGB)
        if (u_tint != 0.0) {
            // Very strong tint boost (0.5x scaling)
            float tint = u_tint * 0.5;
            linear.g *= 1.0 - tint; // +Tint = Magenta (Reduce Green), -Tint = Green
        }
    }
    
    // --- 6. VIBRANCE / SATURATION (Smart Skin Protection) ---
    if (u_vibrance != 0.0 || u_saturation != 0.0) {
        vec3 lab = linearRGBtoOKLab(linear);
        float sat = length(lab.yz);
        
        // Vibrance: Smart Saturation
        if (u_vibrance != 0.0) {
            // 1. Hue Detection (Skin Protection)
            float hue = atan(lab.z, lab.y); // Returns -PI to PI
            
            // Skin Tone Target: ~40 degrees (0.7 rad) 
            float skinHue = 0.7; 
            float hueDist = abs(hue - skinHue);
            float skinWeight = exp(-pow(hueDist * 2.5, 2.0)); 
            
            // 2. Saturation Mask (Pop low sat, protect high sat)
            float curSatMask = 1.0 - smoothstep(0.1, 0.6, sat); 
            
            // Combined Mask: 
            // Fix: Reduced skin protection from 0.7 to 0.5 to allow some warmth
            float protection = 0.5 * skinWeight; 
            float mask = curSatMask * (1.0 - protection);
            
            // Fix: Increased multiplier from 0.5 to 1.2
            lab.yz *= 1.0 + u_vibrance * 1.2 * mask;
        }
        
        // Saturation: Global boost
        if (u_saturation != 0.0) {
            lab.yz *= 1.0 + u_saturation;
        }
        
        // Restore
        linear = max(OKLabToLinearRGB(lab), vec3(0.0));
    }
    
    // --- 7. COLOR GRADING (3-Way) ---
    // Only apply if any grading is active (avoid math if not needed)
    if (u_shadowsColor.y > 0.0 || u_midtonesColor.y > 0.0 || u_highlightsColor.y > 0.0 || 
        u_shadowsLum != 0.0 || u_midtonesLum != 0.0 || u_highlightsLum != 0.0) {
        
        // Normalize params (UI sends -100 to 100, shader expects -1.0 to 1.0 or 0.0 to 1.0)
        float balance = u_colorBalance * 0.01;
        float blending = u_colorBlending * 0.01;
        float shadowsLum = u_shadowsLum * 0.01;
        float midtonesLum = u_midtonesLum * 0.01;
        float highlightsLum = u_highlightsLum * 0.01;
        
        linear = applyColorGrading(
            linear,
            u_shadowsColor,
            u_midtonesColor,
            u_highlightsColor,
            balance,
            blending,
            shadowsLum,
            midtonesLum,
            highlightsLum
        );
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
