#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_direction;   // (1.0, 0.0) for Horizontal, (0.0, 1.0) for Vertical
uniform vec2 u_resolution;  // Width, Height of current destination FBO
uniform float u_radius;     // Resolution-relative spatial radius scale
uniform float u_sigmaRange; // Edge-preserving range sigma in EV stops
uniform bool u_isLinear;    // True if input is already linear float FBO

out vec4 fragColor;

// 13-tap bilateral kernel with Gaussian spatial weights (sigma approx 2.2 taps)
const float spatialWeight[7] = float[](0.196, 0.175, 0.125, 0.075, 0.038, 0.015, 0.005);

vec3 toLinear(vec3 c) {
    return u_isLinear ? c : pow(max(c, vec3(0.0)), vec3(2.2));
}

// Photometric log2 luminance (EV stops) from linear RGB
float getLogLuma(vec3 cLin) {
    float linearLuma = dot(cLin, vec3(0.2126, 0.7152, 0.0722));
    return log2(max(linearLuma, 1e-4));
}

void main() {
    vec2 ratio = vec2(textureSize(u_texture, 0)) / u_resolution;
    float lod = log2(max(1.0, u_radius * dot(ratio, abs(u_direction))));
    vec2 tex_offset = (1.0 / u_resolution) * max(0.5, u_radius);
    
    vec3 center = textureLod(u_texture, v_texCoord, lod).rgb;
    vec3 centerLin = toLinear(center);
    float centerLogLuma = getLogLuma(centerLin);
    
    vec3 accum = centerLin * spatialWeight[0];
    float totalWeight = spatialWeight[0];
    
    // Range sigma in EV stops (e.g. ~1.0 EV for base, ~0.5 EV for clarity)
    float sigmaR = max(0.05, u_sigmaRange);
    float twoSigmaRSq = 2.0 * sigmaR * sigmaR;
    
    for (int i = 1; i < 7; ++i) {
        vec2 offset = vec2(float(i)) * tex_offset * u_direction;
        
        // Positive offset sample (with mipmap LOD to prevent undersampling)
        vec3 sPos = textureLod(u_texture, v_texCoord + offset, lod).rgb;
        vec3 sPosLin = toLinear(sPos);
        float diffPos = getLogLuma(sPosLin) - centerLogLuma;
        float rWeightPos = exp(-(diffPos * diffPos) / twoSigmaRSq);
        float wPos = spatialWeight[i] * rWeightPos;
        accum += sPosLin * wPos;
        totalWeight += wPos;
        
        // Negative offset sample
        vec3 sNeg = textureLod(u_texture, v_texCoord - offset, lod).rgb;
        vec3 sNegLin = toLinear(sNeg);
        float diffNeg = getLogLuma(sNegLin) - centerLogLuma;
        float rWeightNeg = exp(-(diffNeg * diffNeg) / twoSigmaRSq);
        float wNeg = spatialWeight[i] * rWeightNeg;
        accum += sNegLin * wNeg;
        totalWeight += wNeg;
    }
    
    vec3 result = accum / max(0.0001, totalWeight);
    fragColor = vec4(result, 1.0);
}
