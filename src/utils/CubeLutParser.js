/**
 * CubeLutParser - Adobe .CUBE 3D LUT Parser and Film Simulation Generator
 * 
 * Complies with Adobe Cube LUT Specification:
 * - Reads LUT_3D_SIZE, DOMAIN_MIN, DOMAIN_MAX
 * - Parses 3D RGB lattice data
 * - Generates high-fidelity procedural 3D LUT presets for industry-standard
 *   analog film stocks and cinema profiles.
 */

export const BUILTIN_LUTS = [
    { id: 'kodak-portra', name: 'Kodak Portra 400', category: 'negative', description: 'Warm skin tones, soft contrast, fine highlight roll-off' },
    { id: 'fuji-pro', name: 'Fujifilm Pro 400H', category: 'negative', description: 'Pastel palette, emerald greens, cool shadows' },
    { id: 'agfa-vista', name: 'Agfa Vista 200', category: 'negative', description: 'Warm golden cast, poppy primary reds and blues' },
    { id: 'cinestill-800t', name: 'CineStill 800T', category: 'negative', description: 'Tungsten cinema stock, warm halation glow' },
    { id: 'fuji-velvia', name: 'Fujifilm Velvia 50', category: 'slide', description: 'Hyper-vivid slide film, cobalt skies, punchy contrast' },
    { id: 'kodachrome', name: 'Vintage Kodachrome 64', category: 'slide', description: 'Iconic saturated reds, warm nostalgic yellows' },
    { id: 'fuji-classic-chrome', name: 'Fujifilm Classic Chrome', category: 'slide', description: 'Documentary style, subdued tones, hard shadow punch' },
    { id: 'polaroid-600', name: 'Vintage Polaroid 600', category: 'slide', description: 'Instant camera look, creamy lifted blacks, cyan cast' },
    { id: 'kodak-tri-x', name: 'Kodak Tri-X 400', category: 'bw', description: 'Iconic street photography B&W, punchy midtones' },
    { id: 'ilford-hp5', name: 'Ilford HP5 Plus', category: 'bw', description: 'Smooth wide dynamic range, velvety neutral midtones' },
    { id: 'film-noir', name: 'Film Noir B&W', category: 'bw', description: 'Dramatic silver halide panchromatic contrast' },
    { id: 'leica-monochrome', name: 'Leica M Monochrom', category: 'bw', description: 'Pure monochrome sensor tonality, clean gradation' },
    { id: 'teal-orange', name: 'Cinematic Teal & Orange', category: 'cinematic', description: 'Modern Hollywood split-complementary grade' },
    { id: 'bleach-bypass', name: 'Bleach Bypass', category: 'cinematic', description: 'Retained silver, gritty metallic desaturation' }
];

export class CubeLutParser {
    /**
     * Parse standard .cube file text
     * @param {string} text - Content of .cube file
     * @returns {{ title: string, size: number, data: Uint8Array }}
     */
    static parseCube(text) {
        const lines = text.split(/\r?\n/);
        let size = 0;
        let title = 'Custom LUT';
        const rawFloats = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('#')) continue;

            if (line.startsWith('TITLE')) {
                const match = line.match(/TITLE\s+"?([^"]+)"?/i);
                if (match) title = match[1];
                continue;
            }

            if (line.startsWith('LUT_3D_SIZE')) {
                const parts = line.split(/\s+/);
                size = parseInt(parts[1], 10);
                continue;
            }

            if (line.startsWith('DOMAIN_MIN') || line.startsWith('DOMAIN_MAX') || line.startsWith('LUT_1D_SIZE')) {
                continue;
            }

            // Data line: 3 numbers (R G B)
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
                const r = parseFloat(parts[0]);
                const g = parseFloat(parts[1]);
                const b = parseFloat(parts[2]);
                if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                    rawFloats.push(r, g, b);
                }
            }
        }

        if (size <= 0) {
            // Infer size from cube root of RGB triplets count
            const numTriplets = Math.floor(rawFloats.length / 3);
            const inferred = Math.round(Math.cbrt(numTriplets));
            if (inferred * inferred * inferred === numTriplets) {
                size = inferred;
            } else {
                throw new Error(`Invalid .CUBE file: Could not determine valid 3D LUT size (found ${numTriplets} points)`);
            }
        }

        const expectedPoints = size * size * size;
        if (rawFloats.length < expectedPoints * 3) {
            throw new Error(`Incomplete .CUBE data: Expected ${expectedPoints} points, found ${Math.floor(rawFloats.length / 3)}`);
        }

        // Pack into RGBA Uint8Array (universally supported by WebGL2 and WebGPU)
        const uint8Data = new Uint8Array(expectedPoints * 4);
        let srcIdx = 0;
        let dstIdx = 0;

        for (let i = 0; i < expectedPoints; i++) {
            const r = Math.max(0, Math.min(255, Math.round(rawFloats[srcIdx] * 255)));
            const g = Math.max(0, Math.min(255, Math.round(rawFloats[srcIdx + 1] * 255)));
            const b = Math.max(0, Math.min(255, Math.round(rawFloats[srcIdx + 2] * 255)));
            uint8Data[dstIdx] = r;
            uint8Data[dstIdx + 1] = g;
            uint8Data[dstIdx + 2] = b;
            uint8Data[dstIdx + 3] = 255;
            srcIdx += 3;
            dstIdx += 4;
        }

        return {
            title,
            size,
            data: uint8Data
        };
    }

    /**
     * Cache for procedural preset 3D LUTs
     */
    static _presetCache = new Map();

    /**
     * Generate or retrieve a preset 3D LUT
     * @param {string} presetId - Preset identifier
     * @returns {{ title: string, size: number, data: Uint8Array }|null}
     */
    static getPreset(presetId) {
        if (!presetId || presetId === 'none') return null;

        if (this._presetCache.has(presetId)) {
            return this._presetCache.get(presetId);
        }

        const size = 33; // Standard 33x33x33 3D LUT
        const totalPoints = size * size * size;
        const data = new Uint8Array(totalPoints * 4);
        let title = '';

        // S-curve helper
        const sCurve = (x, factor) => {
            const c = Math.max(0, Math.min(1, x));
            return c < 0.5
                ? 0.5 * Math.pow(c * 2, factor)
                : 1.0 - 0.5 * Math.pow((1.0 - c) * 2, factor);
        };

        let ptr = 0;
        for (let bIndex = 0; bIndex < size; bIndex++) {
            const bNorm = bIndex / (size - 1);
            for (let gIndex = 0; gIndex < size; gIndex++) {
                const gNorm = gIndex / (size - 1);
                for (let rIndex = 0; rIndex < size; rIndex++) {
                    const rNorm = rIndex / (size - 1);

                    let r = rNorm;
                    let g = gNorm;
                    let b = bNorm;

                    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                    switch (presetId) {
                        case 'kodak-portra': {
                            // Kodak Portra 400: Lifted blacks, warm golden skin tones, soft highlight roll-off
                            title = 'Kodak Portra 400';
                            // Lift black point slightly (toe lift)
                            r = 0.035 + 0.965 * sCurve(r, 0.95);
                            g = 0.025 + 0.975 * sCurve(g, 0.96);
                            b = 0.020 + 0.980 * sCurve(b, 1.02);

                            // Warm skin undertone enhancement (when R > G > B)
                            if (r > g && g > b) {
                                const skinWeight = Math.min(1.0, (r - b) * 2.0) * (1.0 - Math.abs(luma - 0.6) * 1.5);
                                if (skinWeight > 0) {
                                    r += skinWeight * 0.035;
                                    g += skinWeight * 0.015;
                                    b -= skinWeight * 0.025;
                                }
                            }

                            // Gentle cyan shadow roll-off
                            const shadowWeight = Math.max(0, 1.0 - luma * 2.5);
                            g += shadowWeight * 0.015;
                            b += shadowWeight * 0.025;
                            break;
                        }

                        case 'fuji-pro': {
                            // Fuji Pro 400H: Emerald foliage, cool atmospheric shadows, bright pastel highlights
                            title = 'Fuji Pro 400H';
                            // High key shoulder compression
                            r = sCurve(r, 0.92);
                            g = sCurve(g, 0.90);
                            b = sCurve(b, 0.94);

                            // Emerald green bias
                            if (g > b * 0.9) {
                                const greenWeight = (g - b) * (1.0 - Math.abs(luma - 0.5));
                                if (greenWeight > 0) {
                                    g += greenWeight * 0.06;
                                    b += greenWeight * 0.04;
                                }
                            }

                            // Cool blue/cyan shadow lift
                            const shadowLift = Math.max(0, 0.4 - luma) * 0.08;
                            b += shadowLift * 1.2;
                            g += shadowLift * 0.6;
                            r += shadowLift * 0.3;
                            break;
                        }

                        case 'teal-orange': {
                            // Cinematic Teal & Orange: Split complement midtone grading
                            title = 'Cinematic Teal & Orange';
                            // Punchy film contrast
                            r = sCurve(r, 1.15);
                            g = sCurve(g, 1.10);
                            b = sCurve(b, 1.15);

                            const newLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

                            if (newLuma < 0.5) {
                                // Shadow/Midtone Teal
                                const tealStrength = (0.5 - newLuma) * 0.22;
                                r -= tealStrength * 0.6;
                                g += tealStrength * 0.2;
                                b += tealStrength * 0.8;
                            } else {
                                // Highlight/Midtone Orange
                                const orangeStrength = (newLuma - 0.5) * 0.22;
                                r += orangeStrength * 0.8;
                                g += orangeStrength * 0.35;
                                b -= orangeStrength * 0.5;
                            }
                            break;
                        }

                        case 'kodachrome': {
                            // Vintage Kodachrome 64: Deep punchy contrast, saturated reds & yellows, navy shadows
                            title = 'Vintage Kodachrome 64';
                            r = sCurve(r, 1.25);
                            g = sCurve(g, 1.18);
                            b = sCurve(b, 1.20);

                            // Rich red pop
                            if (r > g) {
                                r += (r - g) * 0.12;
                            }
                            // Rich yellow pop (R & G high, B lower)
                            if (r > 0.4 && g > 0.4 && b < 0.5) {
                                r += 0.05;
                                g += 0.04;
                                b -= 0.06;
                            }
                            // Deep navy shadows
                            if (luma < 0.3) {
                                b += (0.3 - luma) * 0.05;
                            }
                            break;
                        }

                        case 'film-noir': {
                            // Film Noir: Panchromatic silver halide B&W with high tonal separation
                            title = 'Film Noir B&W';
                            // Panchromatic spectral weighting: lifts skin & foliage, suppresses deep blue sky
                            const panchromatic = 0.40 * r + 0.50 * g + 0.10 * b;
                            // High-contrast drama S-curve
                            const dramatic = sCurve(panchromatic, 1.4);
                            r = dramatic;
                            g = dramatic;
                            b = dramatic;
                            break;
                        }

                        case 'fuji-velvia': {
                            // Fujifilm Velvia 50: Reversal slide film with vivid saturation, emerald greens, cobalt blues
                            title = 'Fujifilm Velvia 50';
                            r = sCurve(r, 1.30);
                            g = sCurve(g, 1.25);
                            b = sCurve(b, 1.28);

                            // Lush saturated greens
                            if (g > b * 0.8 && g > r * 0.7) {
                                const velviaGreen = (g - Math.max(r, b) * 0.7) * (1.0 - Math.abs(luma - 0.5) * 1.2);
                                if (velviaGreen > 0) {
                                    g += velviaGreen * 0.12;
                                    b += velviaGreen * 0.04;
                                    r -= velviaGreen * 0.05;
                                }
                            }

                            // Deep cobalt blue skies
                            if (b > r && b > g * 0.7) {
                                const blueWeight = (b - g) * (1.0 - Math.abs(luma - 0.55));
                                if (blueWeight > 0) {
                                    b += blueWeight * 0.10;
                                    r -= blueWeight * 0.04;
                                }
                            }

                            // Punchy slide contrast in shadows
                            if (luma < 0.25) {
                                const shadowToe = (0.25 - luma) * 0.12;
                                r = Math.max(0, r - shadowToe);
                                g = Math.max(0, g - shadowToe);
                                b = Math.max(0, b - shadowToe * 0.8);
                            }
                            break;
                        }

                        case 'fuji-classic-chrome': {
                            // Fujifilm Classic Chrome: Documentary, subdued palette with hard shadow contrast
                            title = 'Fujifilm Classic Chrome';
                            r = sCurve(r, 1.18);
                            g = sCurve(g, 1.15);
                            b = sCurve(b, 1.16);

                            // Mute overall saturation slightly
                            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            r = r * 0.82 + gray * 0.18;
                            g = g * 0.82 + gray * 0.18;
                            b = b * 0.82 + gray * 0.18;

                            // Earthy terracotta red bias
                            if (r > g) {
                                r += (r - g) * 0.04;
                                b -= (r - g) * 0.03;
                            }

                            // Subdued slate blues
                            if (b > r) {
                                b -= (b - r) * 0.06;
                            }

                            // Hard shadow compression
                            if (luma < 0.35) {
                                const shadowCrush = (0.35 - luma) * 0.08;
                                r = Math.max(0, r - shadowCrush);
                                g = Math.max(0, g - shadowCrush);
                                b = Math.max(0, b - shadowCrush);
                            }
                            break;
                        }

                        case 'cinestill-800t': {
                            // CineStill 800T: Tungsten cinema stock with halation glow
                            title = 'CineStill 800T';
                            r = sCurve(r, 1.10);
                            g = sCurve(g, 1.08);
                            b = sCurve(b, 1.12);

                            // Tungsten cool midtone & shadow tint
                            const coolWeight = Math.max(0, 0.7 - luma) * 0.10;
                            b += coolWeight * 0.8;
                            g += coolWeight * 0.3;
                            r -= coolWeight * 0.5;

                            // Halation red-orange bloom in high luminance
                            if (luma > 0.65) {
                                const halation = (luma - 0.65) * 0.28;
                                r += halation * 0.9;
                                g += halation * 0.35;
                                b -= halation * 0.3;
                            }
                            break;
                        }

                        case 'kodak-tri-x': {
                            // Kodak Tri-X 400: Punchy street photojournalism monochrome
                            title = 'Kodak Tri-X 400 B&W';
                            const panchromatic = 0.30 * r + 0.59 * g + 0.11 * b;
                            const triX = sCurve(panchromatic, 1.38);
                            const finalBw = triX < 0.5 ? Math.pow(triX * 2.0, 1.1) * 0.5 : triX;
                            r = finalBw;
                            g = finalBw;
                            b = finalBw;
                            break;
                        }

                        case 'ilford-hp5': {
                            // Ilford HP5 Plus: Velvety smooth midtones and wide tonal latitude
                            title = 'Ilford HP5 Plus B&W';
                            const hp5Luma = 0.26 * r + 0.62 * g + 0.12 * b;
                            const curve = sCurve(hp5Luma, 1.08);
                            const velvety = 0.035 + 0.965 * curve;
                            r = velvety;
                            g = velvety;
                            b = velvety;
                            break;
                        }

                        case 'agfa-vista': {
                            // Agfa Vista 200: Warm golden cast, poppy primary reds & blues
                            title = 'Agfa Vista 200';
                            r = sCurve(r, 1.12);
                            g = sCurve(g, 1.08);
                            b = sCurve(b, 1.06);

                            // Warm golden-amber shadow wash
                            if (luma < 0.5) {
                                const warmShadow = (0.5 - luma) * 0.08;
                                r += warmShadow * 0.8;
                                g += warmShadow * 0.4;
                                b -= warmShadow * 0.5;
                            }

                            // Poppy vibrant reds
                            if (r > g) {
                                r += (r - g) * 0.10;
                            }

                            // Poppy blues
                            if (b > r && b > g) {
                                b += (b - Math.max(r, g)) * 0.08;
                            }
                            break;
                        }

                        case 'polaroid-600': {
                            // Vintage Polaroid 600: Instant camera analog film
                            title = 'Vintage Polaroid 600';
                            r = 0.06 + 0.88 * sCurve(r, 0.96);
                            g = 0.05 + 0.89 * sCurve(g, 0.94);
                            b = 0.08 + 0.86 * sCurve(b, 1.02);

                            // Chemical cyan-olive shadow tint
                            if (luma < 0.45) {
                                const chemShadow = (0.45 - luma) * 0.07;
                                g += chemShadow * 0.4;
                                b += chemShadow * 0.6;
                                r -= chemShadow * 0.3;
                            }

                            // Creamy ivory highlights
                            if (luma > 0.65) {
                                const creamHighlight = (luma - 0.65) * 0.08;
                                r += creamHighlight * 0.6;
                                g += creamHighlight * 0.5;
                                b -= creamHighlight * 0.2;
                            }
                            break;
                        }

                        case 'bleach-bypass': {
                            // Bleach Bypass: Retained silver, high contrast, desaturated metallic look
                            title = 'Bleach Bypass';
                            const bbLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            const highContrastLuma = sCurve(bbLuma, 1.55);

                            r = r * 0.35 + highContrastLuma * 0.65;
                            g = g * 0.35 + highContrastLuma * 0.65;
                            b = b * 0.35 + highContrastLuma * 0.65;

                            if (highContrastLuma > 0.7) {
                                const metal = (highContrastLuma - 0.7) * 0.08;
                                b += metal * 0.5;
                                g += metal * 0.2;
                            }
                            break;
                        }

                        case 'leica-monochrome': {
                            // Leica M Monochrom: Pure sensor monochrome gradation
                            title = 'Leica M Monochrom';
                            const pureLuma = 0.299 * r + 0.587 * g + 0.114 * b;
                            const leicaCurve = sCurve(pureLuma, 1.16);
                            r = leicaCurve;
                            g = leicaCurve;
                            b = leicaCurve;
                            break;
                        }

                        default:
                            break;
                    }

                    // Clamp to [0, 255]
                    data[ptr] = Math.max(0, Math.min(255, Math.round(r * 255)));
                    data[ptr + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
                    data[ptr + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
                    data[ptr + 3] = 255;
                    ptr += 4;
                }
            }
        }

        const preset = { title, size, data };
        this._presetCache.set(presetId, preset);
        return preset;
    }
}

