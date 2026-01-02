/**
 * PresetLibrary - Lightroom-Quality Professional Presets
 * 
 * Meticulously crafted presets based on real film science, color theory,
 * and professional grading workflows. Each preset is designed to create
 * a specific mood and artistic look that photographers will love.
 * 
 * Based on: Real film emulation, Hollywood color grading, fashion editorial
 * looks, and professional portrait workflows.
 */

export const PresetCategories = [
    { id: 'film', name: 'Film Emulation', icon: '🎞️' },
    { id: 'cinematic', name: 'Cinematic', icon: '🎬' },
    { id: 'portrait', name: 'Portrait', icon: '👤' },
    { id: 'mood', name: 'Mood & Editorial', icon: '✨' },
    { id: 'bw', name: 'Black & White', icon: '⚫' },
    { id: 'creative', name: 'Creative & Bold', icon: '🎨' }
];

export const Presets = [
    // ============================================
    // FILM EMULATION - Real film color science
    // ============================================

    // Kodak Portra Series - The gold standard for portraits
    {
        id: 'portra-160',
        name: 'Portra 160',
        category: 'film',
        description: 'Fine grain portrait film with buttery skin tones',
        color: '#e8d4c4',
        adjustments: {
            // Portra's signature look: lifted shadows, muted greens, warm skin
            exposure: 0.12,
            contrast: -8,
            highlights: -15,
            shadows: 18,
            whites: 5,
            blacks: 12, // Lifted blacks - Portra signature
            temperature: 6,
            tint: 4,
            vibrance: -12,
            saturation: -8,
            clarity: -5,
            // HSL: Muted greens, warm oranges, soft blues
            hslHueOrange: 5, // Push orange towards red for skin
            hslSatOrange: -5, // Desaturate slightly for natural skin
            hslLumOrange: 8, // Brighten skin tones
            hslHueGreen: 15, // Shift greens towards yellow (Portra signature)
            hslSatGreen: -25, // Heavily muted greens
            hslLumGreen: 5,
            hslSatBlue: -15, // Muted blues
            hslSatAqua: -20
        }
    },
    {
        id: 'portra-400',
        name: 'Portra 400',
        category: 'film',
        description: 'Versatile portrait film with beautiful color rendering',
        color: '#f5e6d3',
        adjustments: {
            exposure: 0.15,
            contrast: -5,
            highlights: -12,
            shadows: 20,
            whites: 3,
            blacks: 15, // More lifted blacks
            temperature: 8,
            tint: 5,
            vibrance: -15,
            saturation: -10,
            clarity: -3,
            // Warmer than 160, more grain feeling
            hslHueOrange: 8,
            hslSatOrange: -3,
            hslLumOrange: 10,
            hslHueYellow: 10,
            hslSatYellow: -15,
            hslLumYellow: 5,
            hslHueGreen: 20,
            hslSatGreen: -30, // Very muted greens
            hslLumGreen: 3,
            hslSatBlue: -18,
            hslSatAqua: -25
        }
    },
    {
        id: 'portra-800',
        name: 'Portra 800',
        category: 'film',
        description: 'High ISO film with warm, grainy character',
        color: '#fce4d6',
        adjustments: {
            exposure: 0.18,
            contrast: -3,
            highlights: -8,
            shadows: 25,
            blacks: 18,
            temperature: 12,
            tint: 6,
            vibrance: -18,
            saturation: -12,
            clarity: -8,
            hslHueOrange: 10,
            hslSatOrange: -2,
            hslLumOrange: 12,
            hslHueGreen: 25,
            hslSatGreen: -35,
            hslSatBlue: -20,
            hslSatMagenta: -10
        }
    },

    // Kodak Kodachrome - Legendary vivid colors
    {
        id: 'kodachrome-64',
        name: 'Kodachrome 64',
        category: 'film',
        description: 'Iconic film with rich reds and deep blues',
        color: '#c94c40',
        adjustments: {
            // Kodachrome: High contrast, rich saturated colors, deep blacks
            exposure: 0.05,
            contrast: 18,
            highlights: -8,
            shadows: 5,
            whites: 3,
            blacks: -12, // Deep blacks
            temperature: 5,
            tint: -3,
            vibrance: 15,
            saturation: 8,
            clarity: 8,
            // HSL: Rich reds, deep blues, punchy yellows
            hslHueRed: -5,
            hslSatRed: 25,
            hslLumRed: -5,
            hslSatOrange: 15,
            hslLumOrange: 3,
            hslHueYellow: -5,
            hslSatYellow: 18,
            hslLumYellow: 5,
            hslHueBlue: 5,
            hslSatBlue: 20,
            hslLumBlue: -10
        }
    },
    {
        id: 'kodachrome-25',
        name: 'Kodachrome 25',
        category: 'film',
        description: 'Ultra-fine grain with legendary color punch',
        color: '#d85a4a',
        adjustments: {
            exposure: 0.03,
            contrast: 22,
            highlights: -5,
            shadows: 3,
            blacks: -15,
            temperature: 3,
            tint: -5,
            vibrance: 20,
            saturation: 12,
            clarity: 12,
            hslHueRed: -8,
            hslSatRed: 30,
            hslLumRed: -8,
            hslSatOrange: 18,
            hslSatYellow: 22,
            hslHueBlue: 8,
            hslSatBlue: 25,
            hslLumBlue: -12
        }
    },

    // Fujifilm Series
    {
        id: 'fuji-velvia-50',
        name: 'Velvia 50',
        category: 'film',
        description: 'Hyper-saturated slide film for landscapes',
        color: '#2e8b57',
        adjustments: {
            exposure: 0.08,
            contrast: 20,
            highlights: -10,
            shadows: 8,
            blacks: -8,
            temperature: -3,
            vibrance: 25,
            saturation: 15,
            clarity: 10,
            // Velvia: Punchy greens, vivid blues, rich reds
            hslSatRed: 20,
            hslLumRed: -5,
            hslHueGreen: -8,
            hslSatGreen: 30,
            hslLumGreen: -8,
            hslSatBlue: 25,
            hslLumBlue: -10,
            hslSatAqua: 22,
            hslLumAqua: -5
        }
    },
    {
        id: 'fuji-pro-400h',
        name: 'Pro 400H',
        category: 'film',
        description: 'Soft pastel tones with beautiful skin rendering',
        color: '#b8d4e3',
        adjustments: {
            exposure: 0.12,
            contrast: -12,
            highlights: -18,
            shadows: 22,
            blacks: 15,
            temperature: -5,
            tint: 3,
            vibrance: -8,
            saturation: -5,
            clarity: -8,
            // Pro 400H: Cool shadows, pastel tones, soft greens
            hslHueOrange: 3,
            hslSatOrange: -8,
            hslLumOrange: 8,
            hslHueGreen: 8,
            hslSatGreen: -18,
            hslLumGreen: 8,
            hslHueBlue: -10,
            hslSatBlue: -10,
            hslLumBlue: 10,
            hslSatAqua: 8,
            hslLumAqua: 5
        }
    },
    {
        id: 'fuji-superia-400',
        name: 'Superia 400',
        category: 'film',
        description: 'Consumer film with characteristic green shadows',
        color: '#8fbc8f',
        adjustments: {
            exposure: 0.08,
            contrast: 5,
            highlights: -10,
            shadows: 15,
            blacks: 10,
            temperature: -8,
            tint: -8, // Green tint in shadows
            vibrance: 5,
            saturation: 3,
            clarity: -3,
            hslHueGreen: -10,
            hslSatGreen: 10,
            hslLumGreen: 5,
            hslHueBlue: 10,
            hslSatBlue: 8,
            hslSatAqua: 12
        }
    },

    // Cinestill - Movie film
    {
        id: 'cinestill-800t',
        name: 'Cinestill 800T',
        category: 'film',
        description: 'Tungsten-balanced cinema film with halation',
        color: '#4a9eb8',
        adjustments: {
            exposure: 0.05,
            contrast: 8,
            highlights: 5, // Halation effect
            shadows: 15,
            blacks: 8,
            temperature: -15, // Tungsten balanced = cool
            tint: 5,
            vibrance: 10,
            saturation: 5,
            clarity: -5,
            hslHueRed: 15, // Red halation glow
            hslSatRed: 18,
            hslLumRed: 8,
            hslHueOrange: 10,
            hslSatOrange: 12,
            hslLumOrange: 5,
            hslSatBlue: 15,
            hslHueAqua: -15,
            hslSatAqua: 20
        }
    },

    // ============================================
    // CINEMATIC - Hollywood color grading
    // ============================================

    {
        id: 'teal-orange-blockbuster',
        name: 'Blockbuster',
        category: 'cinematic',
        description: 'Classic Hollywood teal & orange grade',
        color: '#008b8b',
        adjustments: {
            exposure: 0,
            contrast: 12,
            highlights: -15,
            shadows: 10,
            blacks: -5,
            temperature: 3,
            vibrance: 8,
            saturation: 5,
            clarity: 5,
            // Split toning via HSL
            hslHueOrange: 5,
            hslSatOrange: 25, // Punchy orange skin/highlights
            hslLumOrange: 5,
            hslHueYellow: 15, // Push yellow towards orange
            hslSatYellow: 10,
            hslHueGreen: 60, // Shift greens to teal
            hslSatGreen: -20,
            hslHueAqua: -10, // Enhance teals
            hslSatAqua: 30,
            hslLumAqua: -8,
            hslHueBlue: 15, // Push blues towards teal
            hslSatBlue: 20,
            hslLumBlue: -12
        }
    },
    {
        id: 'blade-runner',
        name: 'Neon Noir',
        category: 'cinematic',
        description: 'Cyberpunk inspired neon and shadow',
        color: '#ff1493',
        adjustments: {
            exposure: -0.08,
            contrast: 18,
            highlights: -10,
            shadows: -5,
            blacks: -15,
            temperature: -12,
            tint: 8,
            vibrance: 20,
            saturation: 8,
            clarity: 8,
            hslHueMagenta: 10,
            hslSatMagenta: 35,
            hslLumMagenta: 5,
            hslHueBlue: -15,
            hslSatBlue: 30,
            hslLumBlue: -10,
            hslHueAqua: -10,
            hslSatAqua: 25,
            hslSatOrange: 20,
            hslLumOrange: 3
        }
    },
    {
        id: 'david-fincher',
        name: 'Dark Grit',
        category: 'cinematic',
        description: 'Desaturated, cold, high-contrast thriller look',
        color: '#2f4f4f',
        adjustments: {
            exposure: -0.1,
            contrast: 20,
            highlights: -20,
            shadows: 5,
            blacks: -12,
            temperature: -10,
            tint: -5,
            vibrance: -25,
            saturation: -20,
            clarity: 15,
            hslSatRed: -15,
            hslSatOrange: -20,
            hslSatYellow: -25,
            hslSatGreen: -30,
            hslHueBlue: 5,
            hslSatBlue: -10,
            hslLumBlue: -10
        }
    },
    {
        id: 'wes-anderson',
        name: 'Pastel Whimsy',
        category: 'cinematic',
        description: 'Symmetrical pastels with vintage warmth',
        color: '#ffc0cb',
        adjustments: {
            exposure: 0.15,
            contrast: -10,
            highlights: -5,
            shadows: 18,
            blacks: 12,
            temperature: 8,
            tint: 5,
            vibrance: 8,
            saturation: 5,
            clarity: -5,
            hslHueRed: 10, // Push towards pink
            hslSatRed: 15,
            hslLumRed: 8,
            hslHueOrange: 5,
            hslSatOrange: -5,
            hslLumOrange: 10,
            hslHueYellow: -10, // More gold
            hslSatYellow: 8,
            hslLumYellow: 8,
            hslHueGreen: 10,
            hslSatGreen: -15,
            hslLumGreen: 5,
            hslHueBlue: -15,
            hslSatBlue: -10,
            hslLumBlue: 10
        }
    },
    {
        id: 'orange-teal-subtle',
        name: 'Indie Film',
        category: 'cinematic',
        description: 'Subtle orange & teal for natural scenes',
        color: '#e07020',
        adjustments: {
            exposure: 0.05,
            contrast: 8,
            highlights: -12,
            shadows: 12,
            blacks: 5,
            temperature: 5,
            vibrance: 5,
            saturation: 3,
            clarity: 3,
            hslSatOrange: 15,
            hslLumOrange: 3,
            hslHueGreen: 40,
            hslSatGreen: -10,
            hslHueAqua: -5,
            hslSatAqua: 15,
            hslLumAqua: -5,
            hslSatBlue: 10,
            hslLumBlue: -8
        }
    },
    {
        id: 'michael-bay',
        name: 'Explosive',
        category: 'cinematic',
        description: 'High contrast action movie look',
        color: '#ff6600',
        adjustments: {
            exposure: 0.08,
            contrast: 25,
            highlights: -5,
            shadows: 8,
            blacks: -10,
            temperature: 10,
            vibrance: 15,
            saturation: 10,
            clarity: 15,
            hslSatOrange: 30,
            hslLumOrange: 5,
            hslSatYellow: 20,
            hslSatRed: 15,
            hslHueAqua: -10,
            hslSatAqua: 20,
            hslLumAqua: -10
        }
    },
    {
        id: 'joker-2019',
        name: 'Gotham',
        category: 'cinematic',
        description: 'Dirty greens and yellows, gritty urban',
        color: '#9acd32',
        adjustments: {
            exposure: -0.05,
            contrast: 15,
            highlights: -15,
            shadows: 8,
            blacks: -8,
            temperature: -5,
            tint: -10, // Green cast
            vibrance: -5,
            saturation: -8,
            clarity: 10,
            hslHueYellow: 15, // Sickly yellow-green
            hslSatYellow: -10,
            hslLumYellow: -5,
            hslHueGreen: -15,
            hslSatGreen: 10,
            hslLumGreen: -5,
            hslSatOrange: -15,
            hslSatBlue: -20
        }
    },

    // ============================================
    // PORTRAIT - Professional portrait looks
    // ============================================

    {
        id: 'soft-luminous',
        name: 'Soft Light',
        category: 'portrait',
        description: 'Ethereal, dreamy portrait with glowing skin',
        color: '#ffe4e1',
        adjustments: {
            exposure: 0.18,
            contrast: -15,
            highlights: -20,
            shadows: 25,
            whites: 8,
            blacks: 15,
            temperature: 5,
            tint: 3,
            vibrance: -10,
            saturation: -5,
            clarity: -18,
            hslSatOrange: -8,
            hslLumOrange: 12,
            hslLumRed: 8,
            hslSatYellow: -10,
            hslLumYellow: 8
        }
    },
    {
        id: 'fashion-editorial',
        name: 'Editorial',
        category: 'portrait',
        description: 'High-fashion magazine style',
        color: '#c0c0c0',
        adjustments: {
            exposure: 0.1,
            contrast: 18,
            highlights: -8,
            shadows: 3,
            blacks: -5,
            temperature: -5,
            vibrance: 10,
            saturation: 5,
            clarity: 12,
            hslSatOrange: 5,
            hslLumOrange: 5,
            hslSatRed: 8,
            hslSatMagenta: 10,
            hslSatBlue: 8,
            hslLumBlue: -8
        }
    },
    {
        id: 'bronzed-beauty',
        name: 'Bronzed',
        category: 'portrait',
        description: 'Warm, sun-kissed golden skin',
        color: '#cd853f',
        adjustments: {
            exposure: 0.1,
            contrast: 8,
            highlights: -10,
            shadows: 12,
            temperature: 15,
            tint: 5,
            vibrance: 8,
            clarity: 5,
            hslHueOrange: 8,
            hslSatOrange: 12,
            hslLumOrange: 8,
            hslHueYellow: 5,
            hslSatYellow: 10,
            hslLumYellow: 5,
            hslHueRed: 5,
            hslSatRed: 8
        }
    },
    {
        id: 'clean-beauty',
        name: 'Clean Beauty',
        category: 'portrait',
        description: 'Bright, clean, commercial look',
        color: '#fffaf0',
        adjustments: {
            exposure: 0.12,
            contrast: 5,
            highlights: -5,
            shadows: 8,
            whites: 5,
            blacks: 5,
            temperature: 2,
            vibrance: 5,
            saturation: 3,
            clarity: 8,
            hslLumOrange: 5,
            hslLumRed: 3,
            hslSatOrange: 3
        }
    },
    {
        id: 'ivory-skin',
        name: 'Ivory',
        category: 'portrait',
        description: 'Pale, luminous porcelain skin',
        color: '#faebd7',
        adjustments: {
            exposure: 0.15,
            contrast: -5,
            highlights: 5,
            shadows: 15,
            whites: 10,
            blacks: 10,
            temperature: -3,
            tint: 5,
            vibrance: -15,
            saturation: -10,
            clarity: -10,
            hslSatOrange: -15,
            hslLumOrange: 15,
            hslSatRed: -10,
            hslLumRed: 10,
            hslSatYellow: -12,
            hslLumYellow: 8
        }
    },
    {
        id: 'moody-portrait',
        name: 'Moody Portrait',
        category: 'portrait',
        description: 'Dramatic, low-key emotional portrait',
        color: '#4a3c31',
        adjustments: {
            exposure: -0.08,
            contrast: 18,
            highlights: -18,
            shadows: 5,
            blacks: -10,
            temperature: 5,
            tint: 3,
            vibrance: -8,
            saturation: -5,
            clarity: 8,
            hslSatOrange: -5,
            hslLumOrange: 3,
            hslSatGreen: -20,
            hslSatBlue: -15,
            hslLumBlue: -10
        }
    },

    // ============================================
    // MOOD & EDITORIAL - Artistic looks
    // ============================================

    {
        id: 'golden-hour',
        name: 'Golden Hour',
        category: 'mood',
        description: 'Warm sunset light with lens warmth',
        color: '#ffa500',
        adjustments: {
            exposure: 0.12,
            contrast: 10,
            highlights: -15,
            shadows: 15,
            temperature: 25,
            tint: 8,
            vibrance: 12,
            saturation: 8,
            clarity: 5,
            hslHueOrange: 5,
            hslSatOrange: 20,
            hslLumOrange: 8,
            hslHueYellow: -5,
            hslSatYellow: 18,
            hslLumYellow: 5,
            hslHueRed: 5,
            hslSatRed: 15
        }
    },
    {
        id: 'blue-hour-twilight',
        name: 'Blue Hour',
        category: 'mood',
        description: 'Cool twilight with deep blues',
        color: '#1e3a5f',
        adjustments: {
            exposure: -0.05,
            contrast: 12,
            highlights: -12,
            shadows: 10,
            temperature: -25,
            tint: -5,
            vibrance: 15,
            saturation: 8,
            clarity: 5,
            hslHueBlue: -10,
            hslSatBlue: 25,
            hslLumBlue: -8,
            hslHueAqua: -15,
            hslSatAqua: 20,
            hslLumAqua: -5,
            hslSatOrange: 15, // Warm lights pop
            hslLumOrange: 5
        }
    },
    {
        id: 'faded-memories',
        name: 'Faded Memory',
        category: 'mood',
        description: 'Nostalgic, washed-out vintage feel',
        color: '#c9b896',
        adjustments: {
            exposure: 0.1,
            contrast: -12,
            highlights: -8,
            shadows: 18,
            blacks: 20,
            temperature: 8,
            tint: 5,
            vibrance: -20,
            saturation: -15,
            clarity: -10,
            hslSatRed: -15,
            hslSatOrange: -10,
            hslSatYellow: -12,
            hslSatGreen: -20,
            hslSatBlue: -15
        }
    },
    {
        id: 'dark-moody',
        name: 'Dark & Moody',
        category: 'mood',
        description: 'Deep shadows, rich tones',
        color: '#1a1a2e',
        adjustments: {
            exposure: -0.15,
            contrast: 20,
            highlights: -20,
            shadows: -5,
            blacks: -15,
            temperature: -5,
            vibrance: 8,
            saturation: 5,
            clarity: 10,
            hslLumRed: -5,
            hslLumOrange: -3,
            hslSatBlue: 10,
            hslLumBlue: -15,
            hslSatAqua: 8,
            hslLumAqua: -10
        }
    },
    {
        id: 'airy-light',
        name: 'Airy & Light',
        category: 'mood',
        description: 'Bright, fresh, open feeling',
        color: '#f0f8ff',
        adjustments: {
            exposure: 0.22,
            contrast: -15,
            highlights: 10,
            shadows: 25,
            whites: 10,
            blacks: 18,
            temperature: 3,
            vibrance: -8,
            saturation: -5,
            clarity: -10,
            hslLumOrange: 8,
            hslLumYellow: 8,
            hslLumGreen: 5,
            hslSatGreen: -10
        }
    },
    {
        id: 'forest-mood',
        name: 'Enchanted Forest',
        category: 'mood',
        description: 'Mysterious green forest atmosphere',
        color: '#228b22',
        adjustments: {
            exposure: -0.05,
            contrast: 10,
            highlights: -15,
            shadows: 15,
            temperature: -8,
            tint: -10, // Green cast
            vibrance: 12,
            saturation: 5,
            clarity: 8,
            hslHueGreen: -10,
            hslSatGreen: 20,
            hslLumGreen: -5,
            hslHueYellow: 15, // Push yellows to green
            hslSatYellow: 8,
            hslSatOrange: -10,
            hslSatBlue: -5
        }
    },
    {
        id: 'autumn-warmth',
        name: 'Autumn',
        category: 'mood',
        description: 'Rich fall colors with warm tones',
        color: '#d2691e',
        adjustments: {
            exposure: 0.08,
            contrast: 12,
            highlights: -10,
            shadows: 12,
            temperature: 15,
            tint: 5,
            vibrance: 18,
            saturation: 8,
            clarity: 5,
            hslHueOrange: -5,
            hslSatOrange: 25,
            hslLumOrange: 3,
            hslHueYellow: 10, // Push towards orange
            hslSatYellow: 20,
            hslHueRed: -5,
            hslSatRed: 20,
            hslHueGreen: 30, // Shift remaining greens warm
            hslSatGreen: -15
        }
    },

    // ============================================
    // BLACK & WHITE - Classic monochrome
    // ============================================

    {
        id: 'ansel-adams',
        name: 'Ansel Adams',
        category: 'bw',
        description: 'Zone system inspired, full tonal range',
        color: '#808080',
        adjustments: {
            exposure: 0,
            contrast: 18,
            highlights: -15,
            shadows: 15,
            whites: 8,
            blacks: -12,
            saturation: -100,
            clarity: 12,
            hslLumRed: 5,
            hslLumOrange: 10,
            hslLumYellow: 15,
            hslLumGreen: -5,
            hslLumBlue: -15,
            hslLumAqua: -10
        }
    },
    {
        id: 'high-contrast-bw',
        name: 'Punchy B&W',
        category: 'bw',
        description: 'Bold, graphic black and white',
        color: '#333333',
        adjustments: {
            exposure: 0.05,
            contrast: 30,
            highlights: -10,
            shadows: 0,
            blacks: -20,
            saturation: -100,
            clarity: 15,
            hslLumOrange: 8,
            hslLumRed: 5,
            hslLumBlue: -10
        }
    },
    {
        id: 'soft-bw',
        name: 'Soft B&W',
        category: 'bw',
        description: 'Gentle, low contrast monochrome',
        color: '#a9a9a9',
        adjustments: {
            exposure: 0.1,
            contrast: -10,
            highlights: -5,
            shadows: 15,
            blacks: 12,
            saturation: -100,
            clarity: -8,
            hslLumOrange: 12,
            hslLumYellow: 10
        }
    },
    {
        id: 'film-noir',
        name: 'Film Noir',
        category: 'bw',
        description: 'Dark, dramatic with deep shadows',
        color: '#1c1c1c',
        adjustments: {
            exposure: -0.1,
            contrast: 25,
            highlights: -15,
            shadows: -10,
            blacks: -20,
            saturation: -100,
            clarity: 10,
            hslLumOrange: 5,
            hslLumBlue: -15
        }
    },
    {
        id: 'sepia-vintage',
        name: 'Vintage Sepia',
        category: 'bw',
        description: 'Warm antique photograph feel',
        color: '#704214',
        adjustments: {
            exposure: 0.08,
            contrast: 8,
            highlights: -8,
            shadows: 12,
            blacks: 8,
            temperature: 30,
            tint: 8,
            saturation: -70,
            vibrance: -20,
            clarity: -5,
            hslLumOrange: 8
        }
    },
    {
        id: 'cold-bw',
        name: 'Cold B&W',
        category: 'bw',
        description: 'Cool-toned selenium print look',
        color: '#5f6a6a',
        adjustments: {
            exposure: 0.03,
            contrast: 15,
            highlights: -10,
            shadows: 8,
            blacks: -8,
            temperature: -15,
            tint: -5,
            saturation: -90,
            vibrance: -15,
            clarity: 8,
            hslLumBlue: 5
        }
    },

    // ============================================
    // CREATIVE & BOLD - Artistic effects
    // ============================================

    {
        id: 'cross-process',
        name: 'Cross Process',
        category: 'creative',
        description: 'Experimental color shifts like E-6 in C-41',
        color: '#9370db',
        adjustments: {
            exposure: 0.08,
            contrast: 15,
            highlights: 5,
            shadows: 8,
            temperature: -10,
            tint: 12,
            vibrance: 15,
            saturation: 8,
            clarity: 5,
            hslHueRed: 20,
            hslHueOrange: 15,
            hslHueYellow: -20,
            hslHueGreen: 25,
            hslHueBlue: -15,
            hslSatMagenta: 20
        }
    },
    {
        id: 'lomo',
        name: 'Lomo',
        category: 'creative',
        description: 'Saturated with vignette-like contrast',
        color: '#dc143c',
        adjustments: {
            exposure: 0.05,
            contrast: 20,
            highlights: 5,
            shadows: 3,
            blacks: -10,
            temperature: 5,
            vibrance: 20,
            saturation: 15,
            clarity: 8,
            hslSatRed: 15,
            hslSatOrange: 12,
            hslSatYellow: 15,
            hslSatGreen: 10,
            hslSatBlue: 18,
            hslLumBlue: -10
        }
    },
    {
        id: 'split-tone-warm',
        name: 'Warm Split',
        category: 'creative',
        description: 'Warm highlights, cool shadows',
        color: '#f4a460',
        adjustments: {
            exposure: 0.05,
            contrast: 10,
            highlights: -10,
            shadows: 10,
            temperature: 10,
            vibrance: 5,
            saturation: 3,
            // HSL split toning simulation
            hslHueOrange: 5,
            hslSatOrange: 15,
            hslLumOrange: 5,
            hslHueBlue: -10,
            hslSatBlue: 12,
            hslLumBlue: -8,
            hslHueAqua: -5,
            hslSatAqua: 10
        }
    },
    {
        id: 'infrared',
        name: 'Faux Infrared',
        category: 'creative',
        description: 'Dreamy infrared photography effect',
        color: '#ff69b4',
        adjustments: {
            exposure: 0.1,
            contrast: 8,
            highlights: 10,
            shadows: 15,
            temperature: -10,
            tint: 10,
            vibrance: 10,
            clarity: -10,
            hslHueGreen: -60, // Shift greens dramatically
            hslSatGreen: 15,
            hslLumGreen: 20,
            hslHueYellow: -30,
            hslLumYellow: 15,
            hslHueRed: 15,
            hslSatRed: 10
        }
    },
    {
        id: 'bleach-bypass',
        name: 'Bleach Bypass',
        category: 'creative',
        description: 'High contrast, desaturated film lab process',
        color: '#696969',
        adjustments: {
            exposure: 0.03,
            contrast: 25,
            highlights: -10,
            shadows: -5,
            blacks: -12,
            temperature: -3,
            vibrance: -30,
            saturation: -25,
            clarity: 15,
            hslSatRed: -20,
            hslSatOrange: -25,
            hslSatYellow: -20,
            hslSatGreen: -30,
            hslSatBlue: -20
        }
    },
    {
        id: 'duotone-purple',
        name: 'Purple Haze',
        category: 'creative',
        description: 'Dramatic purple duotone effect',
        color: '#9932cc',
        adjustments: {
            exposure: 0.05,
            contrast: 12,
            highlights: -5,
            shadows: 10,
            temperature: -8,
            tint: 15,
            vibrance: 15,
            saturation: 5,
            hslHueRed: 25, // Push towards magenta
            hslSatRed: 10,
            hslHueBlue: -20, // Pull towards purple
            hslSatBlue: 15,
            hslSatMagenta: 25,
            hslLumMagenta: 5,
            hslSatGreen: -30,
            hslSatYellow: -20
        }
    },
    {
        id: 'vintage-polaroid',
        name: 'Instant Film',
        category: 'creative',
        description: 'Polaroid instant film aesthetic',
        color: '#e6d5ac',
        adjustments: {
            exposure: 0.12,
            contrast: -8,
            highlights: -15,
            shadows: 12,
            blacks: 15,
            temperature: 10,
            tint: -5,
            vibrance: -15,
            saturation: -12,
            clarity: -8,
            hslHueOrange: 5,
            hslSatOrange: -8,
            hslLumOrange: 5,
            hslHueGreen: 15,
            hslSatGreen: -20,
            hslHueBlue: 10,
            hslSatBlue: -15
        }
    }
];

/**
 * Get presets by category
 */
export function getPresetsByCategory(categoryId) {
    return Presets.filter(p => p.category === categoryId);
}

/**
 * Get preset by ID
 */
export function getPresetById(presetId) {
    return Presets.find(p => p.id === presetId);
}

/**
 * Apply preset with intensity blending
 * Uses proper interpolation for authentic look at any intensity
 * @param {Object} preset - The preset to apply
 * @param {number} intensity - Blend intensity (0-100)
 * @returns {Object} - Blended adjustment values
 */
export function blendPreset(preset, intensity = 100) {
    const factor = intensity / 100;
    const blended = {};

    for (const [key, value] of Object.entries(preset.adjustments)) {
        // Proper interpolation from 0 to target value
        blended[key] = value * factor;
    }

    return blended;
}
