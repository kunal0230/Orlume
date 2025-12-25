/**
 * Control Panel Component
 * Manages context-sensitive controls for each tool
 */

export class ControlPanel {
    constructor(app) {
        this.app = app;
        this.init();
    }

    init() {
        // Depth controls
        document.getElementById('btn-estimate-depth').addEventListener('click', () => {
            this.app.estimateDepth();
        });

        document.getElementById('depth-opacity').addEventListener('input', (e) => {
            const opacity = e.target.value / 100;
            this.app.components.canvas.setDepthOpacity(opacity);
        });

        document.getElementById('depth-invert').addEventListener('change', (e) => {
            this.app.components.canvas.setDepthInvert(e.target.checked);
        });

        document.getElementById('depth-colorize').addEventListener('change', (e) => {
            this.app.components.canvas.setDepthColorize(e.target.checked);
        });

        // Relight controls
        document.getElementById('light-intensity').addEventListener('input', (e) => {
            this.app.components.relighting.setIntensity(e.target.value / 100);
        });

        document.getElementById('light-color').addEventListener('input', (e) => {
            this.app.components.relighting.setColor(e.target.value);
        });

        // Color temperature slider
        document.getElementById('color-temp').addEventListener('input', (e) => {
            const kelvin = parseInt(e.target.value);
            this.app.components.relighting.setColorTemperature(kelvin);
            document.getElementById('temp-value').textContent = kelvin + 'K';
        });

        document.getElementById('ambient-intensity').addEventListener('input', (e) => {
            this.app.components.relighting.setAmbient(e.target.value / 100);
        });

        // Light softness slider
        document.getElementById('light-softness').addEventListener('input', (e) => {
            this.app.components.relighting.setLightSoftness(e.target.value / 100);
        });

        document.getElementById('brightness').addEventListener('input', (e) => {
            this.app.components.relighting.setBrightness(e.target.value / 100);
        });

        // Light mode toggle
        document.getElementById('mode-point').addEventListener('click', () => {
            this.app.components.relighting.setMode('point');
            document.getElementById('mode-point').classList.add('active');
            document.getElementById('mode-directional').classList.remove('active');
            document.getElementById('hint-point').style.display = '';
            document.getElementById('hint-directional').style.display = 'none';
        });

        document.getElementById('mode-directional').addEventListener('click', () => {
            this.app.components.relighting.setMode('directional');
            document.getElementById('mode-directional').classList.add('active');
            document.getElementById('mode-point').classList.remove('active');
            document.getElementById('hint-directional').style.display = '';
            document.getElementById('hint-point').style.display = 'none';
        });

        // Flat profile controls
        document.getElementById('flat-off').addEventListener('click', () => {
            this.app.components.relighting.setFlatProfile(false);
            document.getElementById('flat-off').classList.add('active');
            document.getElementById('flat-on').classList.remove('active');
            document.getElementById('flat-strength-group').style.display = 'none';
        });

        document.getElementById('flat-on').addEventListener('click', () => {
            this.app.components.relighting.setFlatProfile(true);
            document.getElementById('flat-on').classList.add('active');
            document.getElementById('flat-off').classList.remove('active');
            document.getElementById('flat-strength-group').style.display = '';
        });

        document.getElementById('flat-strength').addEventListener('input', (e) => {
            this.app.components.relighting.setFlatStrength(e.target.value / 100);
        });

        document.getElementById('btn-apply-relight').addEventListener('click', () => {
            this.app.applyRelighting();
        });

        document.getElementById('btn-cancel-relight').addEventListener('click', () => {
            this.app.components.relighting.resetLights();
        });

        // 3D View controls
        document.getElementById('depth-scale').addEventListener('input', (e) => {
            this.app.components.scene.setDepthScale(e.target.value / 100);
        });

        document.getElementById('mesh-quality').addEventListener('change', (e) => {
            this.app.components.scene.setMeshQuality(e.target.value);
        });

        document.getElementById('btn-reset-camera').addEventListener('click', () => {
            this.app.components.scene.resetCamera();
        });

        // Parallax controls
        document.getElementById('parallax-strength').addEventListener('input', (e) => {
            this.app.components.parallax.setStrength(e.target.value / 100);
        });

        document.getElementById('parallax-layers').addEventListener('input', (e) => {
            this.app.components.parallax.setLayers(parseInt(e.target.value));
        });

        // Zoom controls
        document.getElementById('zoom-in').addEventListener('click', () => {
            if (this.app.components.canvas) this.app.components.canvas.zoom(1.25);
        });

        document.getElementById('zoom-out').addEventListener('click', () => {
            if (this.app.components.canvas) this.app.components.canvas.zoom(0.8);
        });

        document.getElementById('zoom-fit').addEventListener('click', () => {
            if (this.app.components.canvas) this.app.components.canvas.fitToView();
        });

        // Transform Controls
        document.getElementById('crop-aspect').addEventListener('change', (e) => {
            this.app.components.transformTool?.setAspectRatio(e.target.value);
        });

        const rotateSlider = document.getElementById('rotate-slider');
        rotateSlider.addEventListener('input', (e) => {
            this.app.components.transformTool?.rotate(e.target.value);
        });
        rotateSlider.addEventListener('dblclick', () => {
            rotateSlider.value = 0;
            this.app.components.transformTool?.rotate(0);
        });

        document.getElementById('rotate-left').addEventListener('click', () => {
            this.app.components.transformTool?.rotateStep(-90);
        });

        document.getElementById('rotate-right').addEventListener('click', () => {
            this.app.components.transformTool?.rotateStep(90);
        });

        document.getElementById('flip-horizontal').addEventListener('click', () => {
            this.app.components.transformTool?.flip('horizontal');
        });

        document.getElementById('flip-vertical').addEventListener('click', () => {
            this.app.components.transformTool?.flip('vertical');
        });

        document.getElementById('btn-apply-transform').addEventListener('click', async () => {
            if (this.app.components.transformTool) {
                // Show loading
                document.getElementById('loading-overlay').hidden = false;

                try {
                    const { image: newImage, depthMap: newDepthMap } = await this.app.components.transformTool.apply();

                    // Update App State
                    this.app.setState({
                        image: newImage,
                        depthMap: newDepthMap
                    });

                    this.app.components.canvas.setImage(newImage);
                    if (newDepthMap) {
                        this.app.components.canvas.setDepthMap(newDepthMap);
                    }

                    // Push to history
                    this.app.pushHistory();

                    // Keep transform tool active and reset for next edit
                    this.app.components.transformTool.activate();
                } catch (err) {
                    console.error('Transform failed:', err);
                } finally {
                    document.getElementById('loading-overlay').hidden = true;
                }
            }
        });

        document.getElementById('btn-cancel-transform').addEventListener('click', () => {
            // Reset and stay in tool
            this.app.components.transformTool?.activate();
        });

        document.getElementById('btn-reset-transform').addEventListener('click', () => {
            this.app.components.transformTool?.activate(); // Re-activating resets state
        });

        // Develop Accordion
        document.querySelectorAll('.accordion-header').forEach(header => {
            header.addEventListener('click', () => {
                header.parentElement.classList.toggle('expanded');
            });
        });

        // Initialize Tone Curve controls
        this.initToneCurveControls();

        // ========================================
        // Develop Basics Controls
        // ========================================
        this._developDebounceTimer = null;

        // Profile selector
        document.querySelectorAll('.profile-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                const profile = e.target.dataset.profile;
                this.app.components.develop?.set('profile', profile);
                this._triggerDevelopPreview();
            });
        });

        // All develop sliders
        document.querySelectorAll('.develop-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const setting = slider.dataset.setting;
                const scale = parseFloat(slider.dataset.scale) || 1;
                const rawValue = parseFloat(e.target.value);
                const value = rawValue * scale;

                // Update value display
                const valueEl = document.getElementById(`dev-${setting}-val`);
                if (valueEl) {
                    valueEl.textContent = scale < 1 ? value.toFixed(2) : Math.round(value);
                }

                // Update develop component
                this.app.components.develop?.set(setting, value);
                this._triggerDevelopPreview();
            });

            // Double-click to reset
            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                const setting = slider.dataset.setting;
                const valueEl = document.getElementById(`dev-${setting}-val`);
                if (valueEl) valueEl.textContent = '0';
                this.app.components.develop?.set(setting, 0);
                this._triggerDevelopPreview();
            });
        });

        // Apply Develop
        document.getElementById('btn-apply-develop')?.addEventListener('click', () => {
            this.app.applyDevelopSettings();
        });

        // Reset Develop
        document.getElementById('btn-reset-develop')?.addEventListener('click', () => {
            this._resetDevelopSliders();
            this._resetColorMixer();
            this.app.components.develop?.reset();
            this._triggerDevelopPreview();
        });

        // ========================================
        // Color Mixer Controls
        // ========================================
        this._activeMixerBand = 'all';

        // Band selector buttons
        document.querySelectorAll('.color-band-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Update active state
                document.querySelectorAll('.color-band-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Set active band
                this._activeMixerBand = btn.dataset.band;

                // Update sliders to show current band values
                const band = this.app.components.develop?.colorMixer[this._activeMixerBand];
                if (band) {
                    document.getElementById('mixer-hue').value = band.hue;
                    document.getElementById('mixer-hue-val').textContent = band.hue;
                    document.getElementById('mixer-sat').value = band.sat;
                    document.getElementById('mixer-sat-val').textContent = band.sat;
                    document.getElementById('mixer-lum').value = band.lum;
                    document.getElementById('mixer-lum-val').textContent = band.lum;
                }
            });
        });

        // Mixer sliders
        ['hue', 'sat', 'lum'].forEach(prop => {
            const slider = document.getElementById(`mixer-${prop}`);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    document.getElementById(`mixer-${prop}-val`).textContent = value;
                    this.app.components.develop?.setColorMixer(this._activeMixerBand, prop, value);
                    this._triggerDevelopPreview();
                });

                // Double-click to reset
                slider.addEventListener('dblclick', () => {
                    slider.value = 0;
                    document.getElementById(`mixer-${prop}-val`).textContent = '0';
                    this.app.components.develop?.setColorMixer(this._activeMixerBand, prop, 0);
                    this._triggerDevelopPreview();
                });
            }
        });
    }

    /**
     * Trigger debounced develop preview
     */
    _triggerDevelopPreview() {
        clearTimeout(this._developDebounceTimer);
        this._developDebounceTimer = setTimeout(() => {
            this.app.updateDevelopPreview();
        }, 16); // ~60fps max
    }

    /**
     * Reset all develop sliders to 0
     */
    _resetDevelopSliders() {
        document.querySelectorAll('.develop-slider').forEach(slider => {
            slider.value = 0;
            const setting = slider.dataset.setting;
            const valueEl = document.getElementById(`dev-${setting}-val`);
            if (valueEl) valueEl.textContent = '0';
        });

        // Reset profile
        document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.profile-btn[data-profile="color"]')?.classList.add('active');
    }

    /**
     * Reset Color Mixer sliders and band selection
     */
    _resetColorMixer() {
        // Reset sliders
        ['hue', 'sat', 'lum'].forEach(prop => {
            const slider = document.getElementById(`mixer-${prop}`);
            if (slider) {
                slider.value = 0;
                document.getElementById(`mixer-${prop}-val`).textContent = '0';
            }
        });

        // Reset band selection to 'all'
        this._activeMixerBand = 'all';
        document.querySelectorAll('.color-band-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.color-band-btn[data-band="all"]')?.classList.add('active');
    }

    /**
     * Initialize Tone Curve controls
     */
    initToneCurveControls() {
        // Channel selector
        document.querySelectorAll('.curve-channel-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.curve-channel-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.app.components.toneCurve?.setChannel(btn.dataset.channel);
            });
        });

        // Region sliders
        document.querySelectorAll('.region-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const region = slider.dataset.region;
                const value = parseInt(e.target.value);

                // Update value display
                const valueEl = document.getElementById(`curve-${region}-val`);
                if (valueEl) valueEl.textContent = value;

                // Update tone curve
                this.app.components.toneCurve?.setRegion(region, value);
            });

            // Double-click to reset
            slider.addEventListener('dblclick', () => {
                slider.value = 0;
                const region = slider.dataset.region;
                const valueEl = document.getElementById(`curve-${region}-val`);
                if (valueEl) valueEl.textContent = '0';
                this.app.components.toneCurve?.setRegion(region, 0);
            });
        });



        // Reset curve button
        document.getElementById('btn-reset-curve')?.addEventListener('click', () => {
            this.app.components.toneCurve?.resetAll();
            this._resetCurveSliders();
        });

        this._bindDetailControls();
        this._bindEffectsControls();
    }

    /**
     * Bind Detail (Sharpening & Noise) sliders
     */
    _bindDetailControls() {
        // Track Alt key for Masking view
        let isAltDown = false;
        document.addEventListener('keydown', (e) => {
            if (e.altKey) isAltDown = true;
        });
        document.addEventListener('keyup', (e) => {
            if (!e.altKey) {
                isAltDown = false;
                if (this.app.components.develop?.previewMode) {
                    this.app.components.develop.setPreviewMode(null);
                    this.app.updateDevelopPreview();
                }
            }
        });

        const detailControls = [
            { id: 'detail-sharp-amount', type: 'sharpening', prop: 'amount' },
            { id: 'detail-sharp-radius', type: 'sharpening', prop: 'radius' },
            { id: 'detail-sharp-detail', type: 'sharpening', prop: 'detail' },
            { id: 'detail-sharp-masking', type: 'sharpening', prop: 'masking' },
            { id: 'detail-noise-lum', type: 'noise', prop: 'luminance' },
            { id: 'detail-noise-color', type: 'noise', prop: 'color' }
        ];

        detailControls.forEach(ctrl => {
            const input = document.getElementById(ctrl.id);
            if (!input) return;

            input.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);

                // Update label
                const label = document.getElementById(`${ctrl.id}-val`);
                if (label) label.textContent = val;

                // Handle Preview Mode (Alt key)
                if (ctrl.type === "sharpening" && isAltDown) {
                    this.app.components.develop?.setPreviewMode("sharpenMask");
                } else if (this.app.components.develop?.previewMode) {
                    this.app.components.develop.setPreviewMode(null);
                }
                // Update engine
                this.app.components.develop?.setDetail(ctrl.type, ctrl.prop, val);

                // Trigger preview
                this.app.updateDevelopPreview();
            });

            // Double click reset
            input.addEventListener('dblclick', () => {
                // Defaults
                let def = 0;
                if (ctrl.prop === 'radius') def = 1.0;
                if (ctrl.prop === 'detail' && ctrl.type === 'sharpening') def = 25;

                input.value = def;
                const label = document.getElementById(`${ctrl.id}-val`);
                if (label) label.textContent = def;

                this.app.components.develop?.setDetail(ctrl.type, ctrl.prop, def);
                this.app.updateDevelopPreview();
            });
        });
    }

    /**
     * Bind Effects (Vignette & Grain) sliders
     */
    _bindEffectsControls() {
        const effectsControls = [
            { id: 'effect-vig-amount', type: 'vignette', prop: 'amount', def: 0 },
            { id: 'effect-vig-midpoint', type: 'vignette', prop: 'midpoint', def: 50 },
            { id: 'effect-vig-roundness', type: 'vignette', prop: 'roundness', def: 0 },
            { id: 'effect-vig-feather', type: 'vignette', prop: 'feather', def: 50 },
            { id: 'effect-vig-highlights', type: 'vignette', prop: 'highlights', def: 0 },
            { id: 'effect-grain-amount', type: 'grain', prop: 'amount', def: 0 },
            { id: 'effect-grain-size', type: 'grain', prop: 'size', def: 25 },
            { id: 'effect-grain-roughness', type: 'grain', prop: 'roughness', def: 50 }
        ];

        effectsControls.forEach(ctrl => {
            const input = document.getElementById(ctrl.id);
            if (!input) return;

            input.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);

                // Update label
                const label = document.getElementById(`${ctrl.id}-val`);
                if (label) label.textContent = val;

                // Update engine
                this.app.components.develop?.setEffects(ctrl.type, ctrl.prop, val);

                // Trigger preview
                this.app.updateDevelopPreview();
            });

            // Double click reset
            input.addEventListener('dblclick', () => {
                const def = ctrl.def;
                input.value = def;
                const label = document.getElementById(`${ctrl.id}-val`);
                if (label) label.textContent = def;

                this.app.components.develop?.setEffects(ctrl.type, ctrl.prop, def);
                this.app.updateDevelopPreview();
            });
        });
    }

    /**
     * Reset all curve region sliders
     */
    _resetCurveSliders() {
        document.querySelectorAll('.region-slider').forEach(slider => {
            slider.value = 0;
            const region = slider.dataset.region;
            const valueEl = document.getElementById(`curve-${region}-val`);
            if (valueEl) valueEl.textContent = '0';
        });

        // Reset channel selector
        document.querySelectorAll('.curve-channel-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.curve-channel-btn[data-channel="rgb"]')?.classList.add('active');
    }
}
