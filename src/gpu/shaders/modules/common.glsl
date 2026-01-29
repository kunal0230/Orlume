
// Color center hues (in degrees out of 360)
const float COLOR_HUES[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0);

float sRGBtoLinear(float c) {
    return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

float linearToSRGB(float c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

float luminance(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// RGB to HSL conversion
vec3 rgbToHsl(vec3 rgb) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float l = (maxC + minC) * 0.5;
    
    if (maxC == minC) {
        return vec3(0.0, 0.0, l); // Achromatic
    }
    
    float d = maxC - minC;
    float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    
    float h;
    if (maxC == rgb.r) {
        h = (rgb.g - rgb.b) / d + (rgb.g < rgb.b ? 6.0 : 0.0);
    } else if (maxC == rgb.g) {
        h = (rgb.b - rgb.r) / d + 2.0;
    } else {
        h = (rgb.r - rgb.g) / d + 4.0;
    }
    h /= 6.0;
    
    return vec3(h * 360.0, s, l); // H in degrees, S and L in 0-1
}

// Helper function for HSL to RGB (must be outside main function in GLSL)
float hueToRgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}

// HSL to RGB conversion
vec3 hslToRgb(vec3 hsl) {
    float h = hsl.x / 360.0; // Convert back to 0-1
    float s = hsl.y;
    float l = hsl.z;
    
    if (s == 0.0) {
        return vec3(l, l, l); // Achromatic
    }
    
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    
    return vec3(
        hueToRgb(p, q, h + 1.0/3.0),
        hueToRgb(p, q, h),
        hueToRgb(p, q, h - 1.0/3.0)
    );
}

// Get weight for how much a given hue belongs to a color channel
float getColorWeight(float hue, int colorIndex) {
    float centerHue = COLOR_HUES[colorIndex];
    float dist = abs(hue - centerHue);
    
    // Handle wraparound (e.g., red at 0° and 360°)
    if (dist > 180.0) dist = 360.0 - dist;
    
    // Smooth falloff - each color affects ~45° range
    float width = 30.0;
    return smoothstep(width, 0.0, dist);
}

vec3 linearRGBtoOKLab(vec3 rgb) {
    float l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    float m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    float s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
    l = pow(max(0.0, l), 1.0/3.0);
    m = pow(max(0.0, m), 1.0/3.0);
    s = pow(max(0.0, s), 1.0/3.0);
    return vec3(
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    );
}

vec3 OKLabToLinearRGB(vec3 lab) {
    float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    l = l * l * l; m = m * m * m; s = s * s * s;
    return vec3(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}

// Tone mapping helpers
float shadowWeight(float L) { return smoothstep(0.3, 0.0, L); }
float midtoneWeight(float L) { return exp(-pow((L - 0.5) / 0.25, 2.0) * 0.5); }
float highlightWeight(float L) { return smoothstep(0.7, 1.0, L); }

float softShoulder(float x, float knee) {
    if (x <= knee) return x;
    float over = x - knee;
    return knee + over / (1.0 + over * 2.0);
}
