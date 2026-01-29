/**
 * HSLModule - Per-channel Hue/Saturation/Luminance color grading
 * 
 * Provides Lightroom-level color control with 8 color channels:
 * Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta
 * 
 * Each channel can have independent adjustments for:
 * - Hue shift (-100 to +100, maps to ±60°)
 * - Saturation (-100 to +100, desaturate to oversaturate)
 * - Luminance (-100 to +100, darken to brighten)
 */

export class HSLModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.gpu = editorUI.gpu;

        // Color channels (matches shader order)
        this.colors = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

        // Track active tab
        this.activeTab = 'hue';

        // State tracking
        this.state = {};
        this._initDefaultState();
    }

    _initDefaultState() {
        this.colors.forEach(color => {
            const capColor = color.charAt(0).toUpperCase() + color.slice(1);
            this.state[`hslHue${capColor}`] = 0;
            this.state[`hslSat${capColor}`] = 0;
            this.state[`hslLum${capColor}`] = 0;
        });
    }

    /**
     * Initialize HSL module
     */
    init() {
        this._initTabSwitching();
        this._initSliders();
    }

    /**
     * Initialize Hue/Saturation/Luminance tab switching
     */
    _initTabSwitching() {
        const tabs = document.querySelectorAll('.hsl-tab');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Update tab UI
                tabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.color = 'var(--text-secondary)';
                    t.style.borderBottom = 'none';
                });

                tab.classList.add('active');
                tab.style.color = 'var(--accent)';
                tab.style.borderBottom = '2px solid var(--accent)';

                // Get the tab type
                const tabType = tab.dataset.tab;
                this.activeTab = tabType;

                // Show/hide sections
                this._showSection(tabType);
            });
        });
    }

    /**
     * Show the appropriate section based on tab
     */
    _showSection(tabType) {
        // Get all HSL sections by their proper IDs
        const hueSection = document.getElementById('hsl-hue-section');
        const satSection = document.getElementById('hsl-saturation-section');
        const lumSection = document.getElementById('hsl-luminance-section');

        // Hide all
        if (hueSection) hueSection.style.display = 'none';
        if (satSection) satSection.style.display = 'none';
        if (lumSection) lumSection.style.display = 'none';

        // Show selected
        switch (tabType) {
            case 'hue':
                if (hueSection) hueSection.style.display = 'block';
                break;
            case 'saturation':
                if (satSection) satSection.style.display = 'block';
                break;
            case 'luminance':
                if (lumSection) lumSection.style.display = 'block';
                break;
        }
    }

    /**
     * Initialize all HSL sliders (8 colors × 3 channels = 24 sliders)
     */
    _initSliders() {
        // Hue sliders
        this.colors.forEach(color => {
            this._initSlider('hue', color, 'hslHue');
        });

        // Saturation sliders
        this.colors.forEach(color => {
            this._initSlider('sat', color, 'hslSat');
        });

        // Luminance sliders  
        this.colors.forEach(color => {
            this._initSlider('lum', color, 'hslLum');
        });
    }

    /**
     * Initialize a single HSL slider
     * @param {string} type - 'hue', 'sat', or 'lum'
     * @param {string} color - Color name (red, orange, etc.)
     * @param {string} paramPrefix - Parameter prefix (hslHue, hslSat, hslLum)
     */
    _initSlider(type, color, paramPrefix) {
        // Slider ID format: slider-hsl-{type}-{color} (e.g., slider-hsl-hue-red)
        const sliderId = `slider-hsl-${type}-${color}`;
        const slider = document.getElementById(sliderId);

        // Value display ID format: hsl-{type}-{color} (e.g., hsl-hue-red)
        const valueId = `hsl-${type}-${color}`;
        const valueDisplay = document.getElementById(valueId);

        if (!slider) {
            console.warn(`HSL slider not found: ${sliderId}`);
            return;
        }

        // Parameter name format: hslHue{Color} (e.g., hslHueRed)
        const paramName = `${paramPrefix}${this._capitalize(color)}`;

        // Input event - realtime updates
        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);

            // Update value display
            if (valueDisplay) {
                valueDisplay.textContent = value > 0 ? `+${value}` : value;
            }

            // Update GPU parameter
            this.gpu.setParam(paramName, value);

            // Update local state
            this.state[paramName] = value;
        });

        // Double-click to reset
        slider.addEventListener('dblclick', () => {
            slider.value = 0;
            if (valueDisplay) valueDisplay.textContent = '0';
            this.gpu.setParam(paramName, 0);
        });

        // Push to history when slider is released
        slider.addEventListener('change', () => {
            this.editorUI._pushHistoryDebounced?.();
        });
    }

    /**
     * Capitalize first letter of a string
     */
    _capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Reset all HSL values to 0
     */
    reset() {
        this.colors.forEach(color => {
            ['hue', 'sat', 'lum'].forEach(type => {
                const sliderId = `slider-hsl-${type}-${color}`;
                const slider = document.getElementById(sliderId);
                const valueId = `hsl-${type}-${color}`;
                const valueDisplay = document.getElementById(valueId);

                if (slider) slider.value = 0;
                if (valueDisplay) valueDisplay.textContent = '0';
            });

            // Reset GPU params
            this.gpu.setParam(`hslHue${this._capitalize(color)}`, 0);
            this.gpu.setParam(`hslSat${this._capitalize(color)}`, 0);
            this.gpu.setParam(`hslLum${this._capitalize(color)}`, 0);
        });
    }
    /**
     * Get current state for history
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Set state from history
     */
    setState(state) {
        if (!state) return;

        this.state = { ...state };

        // Restore all values
        for (const [param, value] of Object.entries(this.state)) {
            // Update GPU
            this.gpu.setParam(param, value);

            // Derive UI ID from parameter name
            // param: hslHueRed -> hue, red
            // ID: slider-hsl-hue-red

            // Extract type and color
            let type = '';
            let colorCap = '';

            if (param.startsWith('hslHue')) {
                type = 'hue';
                colorCap = param.replace('hslHue', '');
            } else if (param.startsWith('hslSat')) {
                type = 'sat';
                colorCap = param.replace('hslSat', '');
            } else if (param.startsWith('hslLum')) {
                type = 'lum';
                colorCap = param.replace('hslLum', '');
            }

            if (type && colorCap) {
                const color = colorCap.toLowerCase();
                const sliderId = `slider-hsl-${type}-${color}`;
                const valueId = `hsl-${type}-${color}`;

                const slider = document.getElementById(sliderId);
                const valueDisplay = document.getElementById(valueId);

                if (slider) {
                    slider.value = value;
                }
                if (valueDisplay) {
                    valueDisplay.textContent = value > 0 ? `+${value}` : value;
                }
            }
        }
    }
}
