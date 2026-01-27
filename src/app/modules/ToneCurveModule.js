/**
 * ToneCurveModule - Lightroom-quality Tone Curve integration
 * 
 * Integrates the ToneCurveEditor component into EditorUI,
 * connecting curve adjustments to the GPU processing pipeline.
 */

import { ToneCurveEditor } from '../../components/ToneCurveEditor.js';

export class ToneCurveModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.gpu = editorUI.gpu;

        // Tone curve editor instance
        this.curveEditor = null;

        // Track if curve has adjustments
        this._hasAdjustments = false;
    }

    /**
     * Initialize the tone curve module
     */
    init() {
        const container = document.getElementById('tone-curve-container');
        if (!container) {
            console.warn('ToneCurveModule: Container #tone-curve-container not found');
            return;
        }

        // Create the curve editor
        this.curveEditor = new ToneCurveEditor(container, {
            width: 268,  // Panel width - padding
            height: 200,
            onChange: (luts) => this._onCurveChanged(luts)
        });

        // Initialize section toggle
        this._initSectionToggle();
    }

    /**
     * Initialize section collapse/expand toggle
     */
    _initSectionToggle() {
        const toggle = document.getElementById('tone-curve-toggle');
        const section = document.getElementById('tone-curve-section');

        if (toggle && section) {
            toggle.addEventListener('click', () => {
                section.classList.toggle('collapsed');
            });
        }
    }

    /**
     * Handle curve changes from editor
     * @param {Object} luts - Object containing Float32Array LUTs for each channel
     */
    _onCurveChanged(luts) {
        // Check if any curve has actual adjustments
        this._hasAdjustments = this.curveEditor?.hasAdjustments() ?? false;

        if (this._hasAdjustments) {
            // Update GPU params with curve LUTs
            this.gpu.params.curveLutRgb = luts.rgb;
            this.gpu.params.curveLutRed = this._hasChannelAdjustment('red') ? luts.red : null;
            this.gpu.params.curveLutGreen = this._hasChannelAdjustment('green') ? luts.green : null;
            this.gpu.params.curveLutBlue = this._hasChannelAdjustment('blue') ? luts.blue : null;
        } else {
            // Clear curve LUTs
            this.gpu.params.curveLutRgb = null;
            this.gpu.params.curveLutRed = null;
            this.gpu.params.curveLutGreen = null;
            this.gpu.params.curveLutBlue = null;
        }

        // Trigger render
        this.gpu.render();

        // Update histogram
        requestAnimationFrame(() => this.editorUI.renderHistogram?.());
    }

    /**
     * Check if a specific channel has adjustments
     */
    _hasChannelAdjustment(channel) {
        if (!this.curveEditor) return false;
        const points = this.curveEditor.curves[channel];
        if (!points) return false;

        // Check if any point is off the diagonal or more than 2 points
        if (points.length > 2) return true;
        for (const p of points) {
            if (Math.abs(p.x - p.y) > 0.001) return true;
        }
        return false;
    }

    /**
     * Set histogram data for the curve editor background
     * @param {Object} data - Histogram data with luminosity/rgb/red/green/blue arrays
     */
    setHistogramData(data) {
        this.curveEditor?.setHistogramData(data);
    }

    /**
     * Reset all curves to default (linear)
     */
    reset() {
        this.curveEditor?.resetAllCurves();
    }

    /**
     * Get current curve state for saving
     */
    getCurveState() {
        return this.curveEditor?.getCurves() ?? null;
    }

    /**
     * Set curve state from saved data
     */
    setCurveState(curves) {
        if (curves && this.curveEditor) {
            this.curveEditor.setCurves(curves);
        }
    }

    /**
     * Check if there are any curve adjustments
     */
    hasAdjustments() {
        return this._hasAdjustments;
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.curveEditor?.dispose();
        this.curveEditor = null;
    }
}
