/**
 * FilterPresets - Professional Filter Definitions
 * 
 * Filters are preset bundles of existing ImageDevelopment controls.
 * They define a starting look, not a final look.
 * 
 * Rule: If a filter touches everything, it's bad.
 *       If it touches 3-5 things intentionally, it's good.
 */

export const FilterPresets = {
    // ============================================================
    // NATURAL / FILMIC
    // Purpose: Subtle enhancement, film-like qualities
    // ============================================================

    'natural-soft': {
        id: 'natural-soft',
        name: 'Natural Soft',
        category: 'Natural',
        description: 'Gentle tones with lifted shadows',
        settings: {
            contrast: -8,
            highlights: -15,
            shadows: 25,
            blacks: 10,
            vibrance: 12,
            saturation: -5
        },
        colorGrading: {
            shadows: { angle: 40, strength: 0.03 },
            highlights: { angle: 55, strength: 0.02 }
        }
    },

    'film-neutral': {
        id: 'film-neutral',
        name: 'Film Neutral',
        category: 'Natural',
        description: 'Classic film look with muted greens',
        settings: {
            contrast: 5,
            highlights: -10,
            shadows: 15,
            blacks: 15,
            vibrance: 8,
            saturation: -8
        },
        colorMixer: {
            green: { h: -10, s: -20, l: 0 },
            yellow: { h: 5, s: -10, l: 0 }
        }
    },

    'portrait-clean': {
        id: 'portrait-clean',
        name: 'Portrait Clean',
        category: 'Natural',
        description: 'Flattering skin tones with smooth highlights',
        settings: {
            exposure: 0.1,
            contrast: -5,
            highlights: -20,
            shadows: 10,
            clarity: -10,
            vibrance: 5,
            saturation: -3
        },
        colorGrading: {
            midtones: { angle: 35, strength: 0.02 }
        }
    },

    'analog-warmth': {
        id: 'analog-warmth',
        name: 'Analog Warmth',
        category: 'Natural',
        description: 'Warm shadows with cooled highlights',
        settings: {
            temperature: 8,
            contrast: 8,
            highlights: -10,
            shadows: 15,
            blacks: 8
        },
        colorGrading: {
            shadows: { angle: 45, strength: 0.06 },
            highlights: { angle: 220, strength: 0.03 }
        }
    },

    // ============================================================
    // CINEMATIC
    // Purpose: Color separation, dramatic mood
    // ============================================================

    'cine-teal': {
        id: 'cine-teal',
        name: 'Cine Teal',
        category: 'Cinematic',
        description: 'Hollywood teal/orange color separation',
        settings: {
            contrast: 15,
            highlights: -20,
            shadows: -10,
            blacks: -15,
            vibrance: -5,
            saturation: -10
        },
        colorMixer: {
            orange: { h: 5, s: 15, l: 5 },
            yellow: { h: -10, s: -15, l: 0 },
            aqua: { h: 0, s: 10, l: -5 },
            blue: { h: -15, s: 5, l: -10 }
        },
        colorGrading: {
            shadows: { angle: 195, strength: 0.08 },
            highlights: { angle: 40, strength: 0.05 }
        }
    },

    'neo-noir': {
        id: 'neo-noir',
        name: 'Neo Noir',
        category: 'Cinematic',
        description: 'High contrast with cold undertones',
        settings: {
            contrast: 25,
            highlights: -25,
            shadows: -20,
            blacks: -25,
            whites: 10,
            vibrance: -20,
            saturation: -30
        },
        colorGrading: {
            shadows: { angle: 240, strength: 0.05 },
            midtones: { angle: 210, strength: 0.03 }
        }
    },

    'cold-night': {
        id: 'cold-night',
        name: 'Cold Night',
        category: 'Cinematic',
        description: 'Blue shadows with compressed highlights',
        settings: {
            temperature: -10,
            contrast: 10,
            highlights: -30,
            shadows: 5,
            vibrance: -10
        },
        colorGrading: {
            shadows: { angle: 230, strength: 0.10 },
            midtones: { angle: 220, strength: 0.04 },
            highlights: { angle: 200, strength: 0.02 }
        }
    },

    'golden-hour': {
        id: 'golden-hour',
        name: 'Golden Hour',
        category: 'Cinematic',
        description: 'Warm golden tones throughout',
        settings: {
            temperature: 15,
            tint: 5,
            contrast: 5,
            highlights: -15,
            shadows: 20,
            vibrance: 15
        },
        colorGrading: {
            shadows: { angle: 35, strength: 0.06 },
            midtones: { angle: 45, strength: 0.04 },
            highlights: { angle: 50, strength: 0.05 }
        }
    },

    // ============================================================
    // BLACK & WHITE
    // Purpose: Tonal control, luminance-based
    // ============================================================

    'bw-classic': {
        id: 'bw-classic',
        name: 'BW Classic',
        category: 'Black & White',
        description: 'Balanced black and white conversion',
        settings: {
            profile: 'bw',
            contrast: 10,
            highlights: -5,
            shadows: 5
        }
    },

    'bw-high-contrast': {
        id: 'bw-high-contrast',
        name: 'BW High Contrast',
        category: 'Black & White',
        description: 'Deep blacks and punchy whites',
        settings: {
            profile: 'bw',
            contrast: 35,
            highlights: 10,
            shadows: -15,
            blacks: -20,
            whites: 15,
            clarity: 15
        }
    },

    'bw-film': {
        id: 'bw-film',
        name: 'BW Film',
        category: 'Black & White',
        description: 'Soft film-like conversion with lifted blacks',
        settings: {
            profile: 'bw',
            contrast: -5,
            highlights: -10,
            shadows: 20,
            blacks: 25
        }
    },

    // ============================================================
    // CREATIVE
    // Purpose: Artistic but still usable
    // ============================================================

    'vintage-fade': {
        id: 'vintage-fade',
        name: 'Vintage Fade',
        category: 'Creative',
        description: 'Faded look with warm undertones',
        settings: {
            contrast: -15,
            highlights: -20,
            shadows: 30,
            blacks: 35,
            vibrance: -15,
            saturation: -20
        },
        colorGrading: {
            shadows: { angle: 45, strength: 0.08 },
            midtones: { angle: 40, strength: 0.03 },
            highlights: { angle: 50, strength: 0.04 }
        }
    },

    'muted-pastel': {
        id: 'muted-pastel',
        name: 'Muted Pastel',
        category: 'Creative',
        description: 'Soft desaturated pastels',
        settings: {
            exposure: 0.15,
            contrast: -20,
            highlights: -25,
            shadows: 25,
            blacks: 20,
            vibrance: -25,
            saturation: -30
        },
        colorGrading: {
            shadows: { angle: 280, strength: 0.04 },
            highlights: { angle: 60, strength: 0.03 }
        }
    },

    'warm-analog': {
        id: 'warm-analog',
        name: 'Warm Analog',
        category: 'Creative',
        description: 'Orange shadows with desaturated blues',
        settings: {
            temperature: 12,
            contrast: 8,
            highlights: -10,
            shadows: 15,
            vibrance: 5,
            saturation: -10
        },
        colorMixer: {
            blue: { h: 0, s: -30, l: -10 },
            aqua: { h: 10, s: -20, l: 0 }
        },
        colorGrading: {
            shadows: { angle: 30, strength: 0.08 }
        }
    }
};

/**
 * Get presets by category
 */
export function getPresetsByCategory(category) {
    return Object.values(FilterPresets).filter(p => p.category === category);
}

/**
 * Get all categories
 */
export function getCategories() {
    const cats = new Set(Object.values(FilterPresets).map(p => p.category));
    return Array.from(cats);
}

/**
 * Get preset by ID
 */
export function getPreset(id) {
    return FilterPresets[id] || null;
}

/**
 * Default settings (for intensity interpolation)
 */
export const DefaultSettings = {
    profile: 'color',
    temperature: 0,
    tint: 0,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vibrance: 0,
    saturation: 0
};

export const DefaultColorMixer = {
    all: { h: 0, s: 0, l: 0 },
    red: { h: 0, s: 0, l: 0 },
    orange: { h: 0, s: 0, l: 0 },
    yellow: { h: 0, s: 0, l: 0 },
    green: { h: 0, s: 0, l: 0 },
    aqua: { h: 0, s: 0, l: 0 },
    blue: { h: 0, s: 0, l: 0 },
    purple: { h: 0, s: 0, l: 0 },
    magenta: { h: 0, s: 0, l: 0 }
};

export const DefaultColorGrading = {
    shadows: { angle: 0, strength: 0 },
    midtones: { angle: 0, strength: 0 },
    highlights: { angle: 0, strength: 0 },
    blending: 50,
    balance: 0
};
