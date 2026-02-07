
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
        // Zone: 'shadows', 'midtones', 'highlights'
        // Params: shadowsHue, shadowsSat, shadowsLum

        // Update GPU Params
        this.gpu.setParam(`${zone}Hue`, h);
        this.gpu.setParam(`${zone}Sat`, s);
        this.gpu.setParam(`${zone}Lum`, l);

        // Update State
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
        this.wheels.shadows.setValue(
            this.state.globalAdjustments.shadowsHue || 0,
            this.state.globalAdjustments.shadowsSat || 0,
            this.state.globalAdjustments.shadowsLum || 0
        );

        // Midtones
        this.wheels.midtones.setValue(
            this.state.globalAdjustments.midtonesHue || 0,
            this.state.globalAdjustments.midtonesSat || 0,
            this.state.globalAdjustments.midtonesLum || 0
        );

        // Highlights
        this.wheels.highlights.setValue(
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
