
// Color Grading Module
// Implements 3-Way Color Grading with Luminance Locking and Gaussian Weights

// Helper: Set Luminance of color to target (Luma Lock)
// Preserves the perceived brightness of the original pixel after tinting
vec3 setLuminance(vec3 color, float targetLuma) {
    float currentLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 diff = color - currentLuma;
    return targetLuma + diff;
}

vec3 applyColorGrading(
    vec3 color,
    vec2 u_shadows,   // Hue (0..1), Sat (0..1)
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
    float mid = 0.5 + u_balance * 0.25; 
    
    // Blending [0, 1] controls the width / overlap
    float blend = 0.2 + u_blending * 0.3;
    
    // Shadows: Low pass filter. 1.0 at 0, falling off toward mid + blend * 0.5.
    float shadowWeight = 1.0 - smoothstep(0.0, mid + blend * 0.5, luma);
    
    // Highlights: High pass filter. 0.0 below mid - blend * 0.5, rising to 1.0 at 1.0.
    float highlightWeight = smoothstep(mid - blend * 0.5, 1.0, luma);
    
    // Midtones: Gaussian bell curve centered at mid
    float midDist = (luma - mid) / max(0.15, blend);
    float midtoneWeight = exp(-midDist * midDist * 2.0);
    
    // 2. Prepare Tints
    // hslToRgb expects hue in degrees (0-360)
    vec3 shadowTint = hslToRgb(vec3(u_shadows.x * 360.0, 1.0, 0.5));
    vec3 midtoneTint = hslToRgb(vec3(u_midtones.x * 360.0, 1.0, 0.5));
    vec3 highlightTint = hslToRgb(vec3(u_highlights.x * 360.0, 1.0, 0.5));
    
    // 3. Apply Tinting
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
    vec3 graded = color + tintVector * 0.5;
    
    // 4. LUMINANCE LOCK
    // Crucially restore original luminance to prevent exposure shifts from tinting
    graded = setLuminance(graded, luma);
    
    // 5. Apply Per-Zone Luminance Adjustments
    // Now that tint luminance is locked, deliberate luminance shifts take effect
    float lumShift = u_shadowsLum * shadowWeight * 0.3
                   + u_midtonesLum * midtoneWeight * 0.3
                   + u_highlightsLum * highlightWeight * 0.3;
    graded += lumShift;
    
    return max(graded, vec3(0.0));
}
