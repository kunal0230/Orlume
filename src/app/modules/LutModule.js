/**
 * LutModule - 3D LUT (.CUBE) Color Grading & Film Simulation Module
 * 
 * Provides:
 * - Built-in film simulations (Kodak Portra, Fuji Pro, Cinematic Teal & Orange, Kodachrome, Film Noir)
 * - Custom Adobe .CUBE file upload and parsing
 * - Real-time intensity blend control (0-100%)
 * - Non-destructive hardware-accelerated 3D texture grading in WebGL2 and WebGPU
 */

import { CubeLutParser } from '../../utils/CubeLutParser.js';

export class LutModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.gpu = editorUI.gpu;
        this.state = editorUI.state;

        this.customLut = null;
        this.currentPresetId = 'none';

        // DOM elements
        this.selectLut = null;
        this.btnImportLut = null;
        this.inputLutFile = null;
        this.intensityGroup = null;
        this.sliderIntensity = null;
        this.valIntensity = null;
    }

    /**
     * Initialize LutModule and event listeners
     */
    init() {
        this.selectLut = document.getElementById('select-lut');
        this.btnImportLut = document.getElementById('btn-import-lut');
        this.inputLutFile = document.getElementById('input-lut-file');
        this.intensityGroup = document.getElementById('lut-intensity-group');
        this.sliderIntensity = document.getElementById('slider-lut-intensity');
        this.valIntensity = document.getElementById('val-lut-intensity');

        if (!this.selectLut) return;

        // Preset dropdown change
        this.selectLut.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'custom') {
                if (this.customLut) {
                    this.applyLut(this.customLut, 'custom');
                } else if (this.inputLutFile) {
                    this.inputLutFile.click();
                }
            } else {
                this.selectPreset(val);
            }
            this.editorUI._pushHistoryDebounced?.();
        });

        // Import .CUBE button
        if (this.btnImportLut && this.inputLutFile) {
            this.btnImportLut.addEventListener('click', () => {
                this.inputLutFile.click();
            });
        }

        // File input for .CUBE files
        if (this.inputLutFile) {
            this.inputLutFile.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const content = event.target.result;
                        const parsed = CubeLutParser.parseCube(content);
                        this.customLut = parsed;

                        // Update or add custom option
                        let customOption = this.selectLut?.querySelector('option[value="custom"]');
                        if (customOption) {
                            customOption.textContent = `Custom: ${parsed.title || file.name}`;
                        }

                        if (this.selectLut) {
                            this.selectLut.value = 'custom';
                        }

                        this.applyLut(parsed, 'custom');
                        this.editorUI._pushHistoryDebounced?.();
                    } catch (err) {
                        console.error('Failed to parse .CUBE file:', err);
                        alert(`Could not load LUT file: ${err.message || 'Invalid format'}`);
                    }
                };
                reader.readAsText(file);
                // Reset file input so re-selecting same file fires change event
                this.inputLutFile.value = '';
            });
        }

        // Intensity slider
        if (this.sliderIntensity) {
            this.sliderIntensity.addEventListener('input', (e) => {
                const intensity = parseInt(e.target.value, 10);
                if (this.valIntensity) {
                    this.valIntensity.textContent = `${intensity}%`;
                }

                if (this.gpu) {
                    this.gpu.params.lut3dIntensity = intensity;
                    this.gpu.render();
                }

                this.state?.setAdjustment('lutIntensity', intensity);
            });

            this.sliderIntensity.addEventListener('change', () => {
                this.editorUI._pushHistoryDebounced?.();
            });
        }
    }

    /**
     * Select a preset or 'none'
     * @param {string} presetId 
     */
    selectPreset(presetId) {
        this.currentPresetId = presetId;

        if (!presetId || presetId === 'none') {
            if (this.gpu) {
                this.gpu.setLut3d(null);
            }
            if (this.intensityGroup) {
                this.intensityGroup.style.display = 'none';
            }
            this.state?.setAdjustment('lutPreset', 'none');
            return;
        }

        const preset = CubeLutParser.getPreset(presetId);
        if (preset) {
            this.applyLut(preset, presetId);
        }
    }

    /**
     * Apply a LUT (preset or custom) to GPU
     * @param {Object} lutInfo - { size, data, title }
     * @param {string} identifier - Preset id or 'custom'
     */
    applyLut(lutInfo, identifier) {
        this.currentPresetId = identifier;

        const intensity = this.sliderIntensity ? parseInt(this.sliderIntensity.value, 10) : 100;

        if (this.intensityGroup) {
            this.intensityGroup.style.display = 'block';
        }

        if (this.valIntensity) {
            this.valIntensity.textContent = `${intensity}%`;
        }

        if (this.gpu) {
            this.gpu.setLut3d(lutInfo, intensity);
        }

        this.state?.setAdjustment('lutPreset', identifier);
        this.state?.setAdjustment('lutIntensity', intensity);
    }

    /**
     * Synchronize UI from EditorState
     */
    syncUI() {
        const preset = this.state?.globalAdjustments?.lutPreset || 'none';
        const intensity = this.state?.globalAdjustments?.lutIntensity ?? 100;

        if (this.selectLut && this.selectLut.value !== preset) {
            this.selectLut.value = preset;
        }

        if (this.sliderIntensity) {
            this.sliderIntensity.value = `${intensity}`;
        }

        if (this.valIntensity) {
            this.valIntensity.textContent = `${intensity}%`;
        }

        if (this.intensityGroup) {
            this.intensityGroup.style.display = preset === 'none' ? 'none' : 'block';
        }

        if (preset === 'none') {
            if (this.gpu && this.gpu.params.lut3d) {
                this.gpu.setLut3d(null);
            }
        } else if (preset === 'custom') {
            if (this.customLut && this.gpu) {
                this.gpu.setLut3d(this.customLut, intensity);
            }
        } else {
            const presetLut = CubeLutParser.getPreset(preset);
            if (presetLut && this.gpu) {
                this.gpu.setLut3d(presetLut, intensity);
            }
        }
    }

    /**
     * Reset module to defaults
     */
    reset() {
        this.currentPresetId = 'none';
        if (this.selectLut) {
            this.selectLut.value = 'none';
        }
        if (this.sliderIntensity) {
            this.sliderIntensity.value = '100';
        }
        if (this.valIntensity) {
            this.valIntensity.textContent = '100%';
        }
        if (this.intensityGroup) {
            this.intensityGroup.style.display = 'none';
        }
        if (this.gpu) {
            this.gpu.setLut3d(null, 100);
        }
    }
}
