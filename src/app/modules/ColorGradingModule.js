
import { ColorGradingWheel } from '../../components/ColorGradingWheel.js';

export class ColorGradingModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.gpu = editorUI.gpu;
        this.state = editorUI.state;

        this.wheels = {};
    }

    init() {
        const container = document.getElementById('color-grading-container');
        if (!container) {
            console.warn('Color grading container not found');
            return;
        }

        // Clear previous
        container.innerHTML = '';

        // Create 3 wheels
        this.wheels.shadows = new ColorGradingWheel(container, 'Shadows', (h, s, l) => this.updateGrade('shadows', h, s, l));
        this.wheels.midtones = new ColorGradingWheel(container, 'Midtones', (h, s, l) => this.updateGrade('midtones', h, s, l));
        this.wheels.highlights = new ColorGradingWheel(container, 'Highlights', (h, s, l) => this.updateGrade('highlights', h, s, l));

        // Global Controls
        this._createGlobalControls(container);

        // Initialize values from state
        this.updateUIFromState();
    }

    updateGrade(zone, h, s, l) {
        // H5 FIX: Batch param updates — set directly on params, render once
        this.gpu.params[`${zone}Hue`] = h;
        this.gpu.params[`${zone}Sat`] = s;
        this.gpu.params[`${zone}Lum`] = l;
        this.gpu.render();

        // Update State (doesn't trigger render)
        this.state.setAdjustment(`${zone}Hue`, h);
        this.state.setAdjustment(`${zone}Sat`, s);
        this.state.setAdjustment(`${zone}Lum`, l);
    }

    updateGlobal(param, value) {
        this.gpu.setParam(param, value);
        this.state.setAdjustment(param, value);
    }

    updateUIFromState() {
        // Read from state or GPU params
        // Shadows
        this.wheels.shadows?.setValue(
            this.state.globalAdjustments.shadowsHue || 0,
            this.state.globalAdjustments.shadowsSat || 0,
            this.state.globalAdjustments.shadowsLum || 0
        );

        // Midtones
        this.wheels.midtones?.setValue(
            this.state.globalAdjustments.midtonesHue || 0,
            this.state.globalAdjustments.midtonesSat || 0,
            this.state.globalAdjustments.midtonesLum || 0
        );

        // Highlights
        this.wheels.highlights?.setValue(
            this.state.globalAdjustments.highlightsHue || 0,
            this.state.globalAdjustments.highlightsSat || 0,
            this.state.globalAdjustments.highlightsLum || 0
        );

        // Globals
        const balanceSlider = document.getElementById('grading-balance');
        if (balanceSlider) balanceSlider.value = this.state.globalAdjustments.colorBalance || 0;

        const blendingSlider = document.getElementById('grading-blending');
        if (blendingSlider) blendingSlider.value = this.state.globalAdjustments.colorBlending ?? 50;
    }

    /**
     * H6 FIX: Get current state for history/undo support
     */
    getState() {
        return {
            shadowsHue: this.state.globalAdjustments.shadowsHue || 0,
            shadowsSat: this.state.globalAdjustments.shadowsSat || 0,
            shadowsLum: this.state.globalAdjustments.shadowsLum || 0,
            midtonesHue: this.state.globalAdjustments.midtonesHue || 0,
            midtonesSat: this.state.globalAdjustments.midtonesSat || 0,
            midtonesLum: this.state.globalAdjustments.midtonesLum || 0,
            highlightsHue: this.state.globalAdjustments.highlightsHue || 0,
            highlightsSat: this.state.globalAdjustments.highlightsSat || 0,
            highlightsLum: this.state.globalAdjustments.highlightsLum || 0,
            colorBalance: this.state.globalAdjustments.colorBalance || 0,
            colorBlending: this.state.globalAdjustments.colorBlending ?? 50
        };
    }

    /**
     * H6 FIX: Set state from history/undo
     */
    setState(savedState) {
        if (!savedState) return;

        // Restore all color grading params
        const params = ['shadowsHue', 'shadowsSat', 'shadowsLum',
                        'midtonesHue', 'midtonesSat', 'midtonesLum',
                        'highlightsHue', 'highlightsSat', 'highlightsLum',
                        'colorBalance', 'colorBlending'];

        for (const param of params) {
            if (param in savedState) {
                this.gpu.params[param] = savedState[param];
                this.state.setAdjustment(param, savedState[param]);
            }
        }

        // Update UI wheels
        this.updateUIFromState();
        this.gpu.render();
    }

    /**
     * Reset all color grading to defaults
     */
    resetToDefaults() {
        const zones = ['shadows', 'midtones', 'highlights'];
        const aspects = ['Hue', 'Sat', 'Lum'];

        for (const zone of zones) {
            for (const aspect of aspects) {
                const param = `${zone}${aspect}`;
                this.gpu.params[param] = 0;
                this.state.setAdjustment(param, 0);
            }
        }

        this.gpu.params.colorBalance = 0;
        this.gpu.params.colorBlending = 50;
        this.state.setAdjustment('colorBalance', 0);
        this.state.setAdjustment('colorBlending', 50);

        this.updateUIFromState();
        this.gpu.render();
    }

    _createGlobalControls(container) {
        const controls = document.createElement('div');
        controls.style.marginTop = '15px';
        controls.style.width = '100%';
        controls.style.padding = '0 10px';

        // Blending
        this._createSlider(controls, 'Blending', 'grading-blending', 0, 100, 50, (v) => this.updateGlobal('colorBlending', v));

        // Balance
        this._createSlider(controls, 'Balance', 'grading-balance', -100, 100, 0, (v) => this.updateGlobal('colorBalance', v));

        container.appendChild(controls);
    }

    _createSlider(parent, label, id, min, max, def, onChange) {
        const wrap = document.createElement('div');
        wrap.style.marginBottom = '10px';

        const labelEl = document.createElement('div');
        labelEl.textContent = label;
        labelEl.style.fontSize = '12px';
        labelEl.style.marginBottom = '4px';
        labelEl.style.color = '#ccc';

        const input = document.createElement('input');
        input.type = 'range';
        input.id = id;
        input.min = min;
        input.max = max;
        input.value = def;
        input.style.width = '100%';

        input.addEventListener('input', (e) => onChange(parseFloat(e.target.value)));

        wrap.appendChild(labelEl);
        wrap.appendChild(input);
        parent.appendChild(wrap);
    }
}

