
// Color Grading Module
// Implements 3-Way Color Grading with Luminance Locking and Gaussian Weights

// Helper: Set Luminance of color to target (Luma Lock)
// Preserves the perceived brightness of the original pixel after tinting
vec3 setLuminance(vec3 color, float targetLuma) {
    float currentLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 diff = color - currentLuma;
    return targetLuma + diff;
}

// Helper: Gaussian function for smooth weight distribution
float gaussian(float x, float sigma) {
    return exp(-(x * x) / (2.0 * sigma * sigma));
}

// Convert HSL to RGB (Helper if not already in common.glsl, but it likely is. 
// If common.glsl is included, we might have it. Let's assume common.glsl defines HSLtoRGB or similar.
// develop.glsl includes common.glsl. common.glsl usually has hsl2rgb.
// Checking common.glsl content in memory... it has `hsl2rgb`.
// But wait, the previous plan used `HSLtoRGB`. I should check common.glsl to be sure of the function name.
// For safety, I'll use the one from common.glsl or define a local one if needed. 
// actually, I'll stick to standard mix logic first.

vec3 applyColorGrading(
    vec3 color,
    vec2 u_shadows,   // Hue, Sat
    vec2 u_midtones,
    vec2 u_highlights,
    float u_balance,  // -1 to 1
    float u_blending, // 0 to 1
    float u_shadowsLum,
    float u_midtonesLum,
    float u_highlightsLum
) {
    // 0. Calculate original luminance
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    
    // 1. Calculate Zone Weights with Smooth Falloff
    
    // Balance [-1, 1] shifts the midpoint
    // Default midpoint is 0.5. Balance shifts it +/- 0.25 (range 0.25 to 0.75)
    float midpoint = 0.5 + u_balance * 0.25; 
    
    // Blending [0, 1] controls the width (sigma) / overlap
    // Low blending = sharp transitions. High blending = broad overlap.
    float smoothRange = 0.15 + u_blending * 0.5;
    
    // Shadows: Low pass filter. 1.0 at 0, falling off.
    float shadowWeight = 1.0 - smoothstep(midpoint - smoothRange, midpoint + smoothRange, luma);
    
    // Highlights: High pass filter. 0.0 at 0, rising.
    float highlightWeight = smoothstep(midpoint - smoothRange, midpoint + smoothRange, luma);
    
    // Midtones: The remaining weight (Band pass)
    float midtoneWeight = 1.0 - shadowWeight - highlightWeight;
    
    // 2. Prepare Tints
    // Assuming hsl2rgb(vec3(h, s, l)) is available from common.glsl
    // We want pure color at 50% lightness for the tint vector
    vec3 shadowTint = hslToRgb(vec3(u_shadows.x, 1.0, 0.5));
    vec3 midtoneTint = hslToRgb(vec3(u_midtones.x, 1.0, 0.5));
    vec3 highlightTint = hslToRgb(vec3(u_highlights.x, 1.0, 0.5));
    
    // 3. Apply Tinting
    // We calculate a tint vector which is the deviation from gray.
    // (Tint - 0.5) gives us a push vector in RGB space.
    // We scale this by the user's saturation (strength) and the zone weight.
    
    vec3 tintVector = vec3(0.0);
    
    // Shadow tint
    if (u_shadows.y > 0.0) {
        tintVector += (shadowTint - 0.5) * 2.0 * shadowWeight * u_shadows.y;
    }
    
    // Midtone tint
    if (u_midtones.y > 0.0) {
        tintVector += (midtoneTint - 0.5) * 2.0 * midtoneWeight * u_midtones.y;
    }
    
    // Highlight tint
    if (u_highlights.y > 0.0) {
        tintVector += (highlightTint - 0.5) * 2.0 * highlightWeight * u_highlights.y;
    }
    
    // Apply tint vector efficiently
    vec3 graded = color + tintVector * 0.5; // Scale for manageable strength
    
    // 4. Apply Per-Zone Luminance Adjustments
    // This allows lifting shadows or dimming highlights independently
    graded += u_shadowsLum * shadowWeight * 0.2;
    graded += u_midtonesLum * midtoneWeight * 0.2;
    graded += u_highlightsLum * highlightWeight * 0.2;
    
    // 5. LUMINANCE LOCK
    // Crucially restore original luminance to prevent exposure shifts from tinting
    graded = setLuminance(graded, luma);
    
    return graded;
}
