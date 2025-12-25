/**
 * ColorMixer - OKLCh-based Color Mixer Component
 * Orlume Vision Labs
 * 
 * Features:
 * - 8 hue bands with smooth circular blending
 * - "All" mode with neutral protection
 * - Hue, Saturation, Luminance per band
 * - Gamut-aware processing
 */

export class ColorMixer {
    constructor(app) {
        this.app = app;
        this.activeBand = 'all';

        // Band definitions
        this.bands = ['all', 'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

        // Initialize after DOM is ready
        this._init();
    }

    _init() {
        try {
            this._bindBandSelector();
            this._bindSliders();
            console.log('🎨 ColorMixer initialized');
        } catch (err) {
            console.warn('ColorMixer init failed:', err);
        }
    }

    /**
     * Bind band selector buttons
     */
    _bindBandSelector() {
        const buttons = document.querySelectorAll('.color-band-btn');
        if (!buttons.length) {
            console.warn('ColorMixer: No band buttons found');
            return;
        }

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Set active band
                this.activeBand = btn.dataset.band;

                // Update sliders to show current band values
                this._updateSliders();
            });
        });
    }

    /**
     * Bind H/S/L sliders
     */
    _bindSliders() {
        ['hue', 'sat', 'lum'].forEach(prop => {
            const slider = document.getElementById(`mixer-${prop}`);
            const valueEl = document.getElementById(`mixer-${prop}-val`);

            if (!slider) {
                console.warn(`ColorMixer: slider mixer-${prop} not found`);
                return;
            }

            slider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (valueEl) valueEl.textContent = value;

                // Update develop component
                this.app.components.develop?.setColorMixer(this.activeBand, prop, value);
                this._triggerPreview();
            });

            // Double-click to reset
            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                if (valueEl) valueEl.textContent = '0';
                this.app.components.develop?.setColorMixer(this.activeBand, prop, 0);
                this._triggerPreview();
            });
        });
    }

    /**
     * Update sliders to show current band values
     */
    _updateSliders() {
        const develop = this.app.components.develop;
        if (!develop) return;

        // Use getColorMixer which returns UI-scale values (-100 to 100)
        ['hue', 'sat', 'lum'].forEach(prop => {
            const slider = document.getElementById(`mixer-${prop}`);
            const valueEl = document.getElementById(`mixer-${prop}-val`);
            const value = develop.getColorMixer(this.activeBand, prop);
            if (slider) slider.value = value;
            if (valueEl) valueEl.textContent = value;
        });
    }

    /**
     * Trigger develop preview
     */
    _triggerPreview() {
        // Use debounced preview from app
        if (this.app.updateDevelopPreview) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(() => {
                this.app.updateDevelopPreview();
            }, 16);
        }
    }

    /**
     * Reset all mixer values
     */
    reset() {
        this.activeBand = 'all';

        // Reset sliders
        ['hue', 'sat', 'lum'].forEach(prop => {
            const slider = document.getElementById(`mixer-${prop}`);
            const valueEl = document.getElementById(`mixer-${prop}-val`);
            if (slider) slider.value = 0;
            if (valueEl) valueEl.textContent = '0';
        });

        // Reset band selector
        document.querySelectorAll('.color-band-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.color-band-btn[data-band="all"]')?.classList.add('active');
    }
}
