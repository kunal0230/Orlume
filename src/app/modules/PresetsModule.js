/**
 * PresetsModule - Professional preset management and UI
 * 
 * Handles preset category navigation, application with intensity blending,
 * and smooth UI transitions.
 */

import { PresetCategories, Presets, getPresetsByCategory, getPresetById, blendPreset } from '../../presets/PresetLibrary.js';

export class PresetsModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.gpu = editorUI.gpu;

        // Current state
        this.activePresetId = null;
        this.intensity = 100;
        this.expandedCategories = new Set(['portrait', 'landscape']); // Default expanded

        // Store original values for preview restoration
        this.originalValues = null;
    }

    /**
     * Initialize the presets module
     */
    init() {
        this._renderPresetsUI();
        this._initEventListeners();
    }

    /**
     * Get clean SVG icon for category
     */
    _getCategoryIcon(iconId) {
        switch (iconId) {
            case 'film':
                return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/></svg>`;
            case 'cinematic':
                return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><polygon points="10 9 15 12 10 15" fill="currentColor"/></svg>`;
            case 'portrait':
                return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 20v-1.5a5.5 5.5 0 0 1 11 0V20"/></svg>`;
            case 'mood':
                return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/></svg>`;
            case 'bw':
                return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>`;
            case 'creative':
                return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0 0 15.3 8.5c.8-.5 1.2-1.4 1.2-2.3 0-1.1.9-2 2-2h.5A3.5 3.5 0 0 0 22 12.5C22 6.7 17.5 2 12 2z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor"/></svg>`;
            default:
                return '';
        }
    }

    /**
     * Render the complete presets UI
     */
    _renderPresetsUI() {
        const container = document.getElementById('presets-library-container');
        const target = container || document.getElementById('panel-presets');
        if (!target) return;

        target.innerHTML = `
            <div class="presets-container">
                <!-- Section Header for Preset Packs -->
                <div class="section-header" style="margin-bottom: 8px;">Preset Packs</div>

                <!-- Category Sections -->
                ${PresetCategories.map(cat => this._renderCategory(cat)).join('')}
                
                <!-- Intensity Control -->
                <div class="section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);">
                    <div class="section-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Preset Intensity</span>
                        <span id="preset-intensity-value" style="color: var(--accent); font-weight: 600;">${this.intensity}%</span>
                    </div>
                    <div class="control-group" style="margin-top: 8px;">
                        <input type="range" id="slider-preset-intensity" min="0" max="100" step="1" value="${this.intensity}"
                            style="background: linear-gradient(to right, var(--bg-dark), var(--accent));">
                    </div>
                </div>
                
                <!-- Reset Button -->
                <div class="section" style="margin-top: 12px;">
                    <button class="btn" id="btn-preset-reset" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                            <path d="M3 3v5h5"/>
                        </svg>
                        Reset All Presets
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render a single category section
     */
    _renderCategory(category) {
        const presets = getPresetsByCategory(category.id);
        const isExpanded = this.expandedCategories.has(category.id);

        return `
            <div class="preset-category" data-category="${category.id}">
                <div class="preset-category-header" data-category="${category.id}" 
                    style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; 
                           background: var(--bg-dark); border-radius: 8px; cursor: pointer; margin-bottom: ${isExpanded ? '8px' : '4px'};
                           transition: all 0.2s ease;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="display: flex; align-items: center; color: var(--text-secondary);">${this._getCategoryIcon(category.icon)}</span>
                        <span style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${category.name}</span>
                        <span style="font-size: 10px; color: var(--text-secondary); background: var(--bg-panel); padding: 2px 6px; border-radius: 10px;">${presets.length}</span>
                    </div>
                    <svg class="category-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
                        style="transition: transform 0.2s ease; transform: rotate(${isExpanded ? '180deg' : '0deg'});">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </div>
                <div class="preset-category-content" data-category="${category.id}"
                    style="display: ${isExpanded ? 'grid' : 'none'}; grid-template-columns: repeat(2, 1fr); gap: 6px; padding: 0 0 12px 0;">
                    ${presets.map(preset => this._renderPresetCard(preset)).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render a single preset card
     */
    _renderPresetCard(preset) {
        const isActive = this.activePresetId === preset.id;

        return `
            <button class="preset-card ${isActive ? 'active' : ''}" data-preset="${preset.id}" title="${preset.description}"
                style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px; 
                       background: ${isActive ? 'var(--bg-hover)' : 'var(--bg-panel)'}; 
                       border: 1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}; 
                       border-radius: 8px; cursor: pointer; transition: all 0.15s ease;
                       ${isActive ? 'box-shadow: 0 0 0 1px var(--accent);' : ''}">
                <div class="preset-swatch" 
                    style="width: 100%; height: 24px; border-radius: 4px; 
                           background: ${preset.color}; 
                           box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1);"></div>
                <span style="font-size: 10px; color: var(--text-primary); font-weight: 500; text-align: center; line-height: 1.2;">
                    ${preset.name}
                </span>
            </button>
        `;
    }

    /**
     * Initialize event listeners
     */
    _initEventListeners() {
        const panel = document.getElementById('panel-presets');
        if (!panel) return;

        // Category header clicks (expand/collapse)
        panel.addEventListener('click', (e) => {
            const header = e.target.closest('.preset-category-header');
            if (header) {
                const categoryId = header.dataset.category;
                this._toggleCategory(categoryId);
            }

            // Preset card clicks
            const card = e.target.closest('.preset-card');
            if (card) {
                const presetId = card.dataset.preset;
                this._applyPreset(presetId);
            }
        });

        // Preset card hover (preview) - Optional, can be performance intensive
        panel.addEventListener('mouseenter', (e) => {
            const card = e.target.closest('.preset-card');
            if (card && this.editorUI.gpu.inputTexture) {
                // Store current values on first hover
                if (!this.originalValues) {
                    this.originalValues = { ...this.gpu.params };
                }
            }
        }, true);

        // Intensity slider
        const intensitySlider = document.getElementById('slider-preset-intensity');
        if (intensitySlider) {
            intensitySlider.addEventListener('input', () => {
                this.intensity = parseInt(intensitySlider.value);
                const valueDisplay = document.getElementById('preset-intensity-value');
                if (valueDisplay) {
                    valueDisplay.textContent = `${this.intensity}%`;
                }

                // Re-apply current preset with new intensity
                if (this.activePresetId) {
                    this._applyPreset(this.activePresetId, false);
                }
            });
        }

        // Reset button
        const resetBtn = document.getElementById('btn-preset-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this._resetAll();
            });
        }
    }

    /**
     * Toggle category expand/collapse
     */
    _toggleCategory(categoryId) {
        const content = document.querySelector(`.preset-category-content[data-category="${categoryId}"]`);
        const chevron = document.querySelector(`.preset-category-header[data-category="${categoryId}"] .category-chevron`);

        if (this.expandedCategories.has(categoryId)) {
            this.expandedCategories.delete(categoryId);
            if (content) content.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        } else {
            this.expandedCategories.add(categoryId);
            if (content) content.style.display = 'grid';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        }
    }

    /**
     * Apply a preset
     */
    _applyPreset(presetId, pushHistory = true) {
        const preset = getPresetById(presetId);
        if (!preset) return;

        // Get blended adjustments based on intensity
        const adjustments = blendPreset(preset, this.intensity);

        // First reset all params to 0 (clean slate)
        this._resetParams();

        // Apply each adjustment
        for (const [key, value] of Object.entries(adjustments)) {
            if (key in this.gpu.params) {
                this.gpu.params[key] = value;
            }
        }

        for (const key in this.gpu.params) {
            if (!key.startsWith('curveLut')) {
                this.editorUI.state.setAdjustment(key, this.gpu.params[key]);
            }
        }
        // FIXED: preset-state-sync

        // Update UI sliders to reflect new values
        this._syncSlidersToParams();

        // Render with new params
        this.gpu.render();

        // Update active state
        this.activePresetId = presetId;
        this._updateActivePresetUI();

        // Push to history
        if (pushHistory) {
            this.editorUI._pushHistoryDebounced?.();
        }

    }

    /**
     * Reset all params to zero
     */
    _resetParams() {
        for (const key in this.gpu.params) {
            // Curve LUT params must be null (identity), not 0
            if (key.startsWith('curveLut')) {
                this.gpu.params[key] = null;
            } else if (key === 'colorBlending') {
                this.gpu.params[key] = 50;
            } else {
                this.gpu.params[key] = 0;
            }
        }
    }

    /**
     * Sync UI sliders to current GPU params
     */
    _syncSlidersToParams() {
        // Global sliders
        const globalSliders = [
            'exposure', 'contrast', 'highlights', 'shadows',
            'whites', 'blacks', 'temperature', 'tint',
            'vibrance', 'saturation', 'clarity', 'dehaze', 'structure' // FIXED: texture-to-structure
        ];

        for (const param of globalSliders) {
            const slider = document.getElementById(`slider-${param}`);
            const valueDisplay = document.getElementById(`val-${param}`); // FIXED: preset-display-id

            if (slider) {
                let value = this.gpu.params[param] || 0;
                // Convert exposure from EV to slider value
                if (param === 'exposure') {
                    value = Math.round(value * 100) / 100;
                } else {
                    value = Math.round(value);
                }
                slider.value = value;
                if (valueDisplay) {
                    valueDisplay.textContent = value > 0 ? `+${value}` : value;
                }
            }
        }

        // HSL sliders
        const colors = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
        const hslTypes = ['hue', 'sat', 'lum'];

        for (const color of colors) {
            for (const type of hslTypes) {
                const paramName = `hsl${type.charAt(0).toUpperCase() + type.slice(1)}${color.charAt(0).toUpperCase() + color.slice(1)}`;
                const sliderId = `slider-hsl-${type}-${color}`;
                const valueId = `hsl-${type}-${color}`;

                const slider = document.getElementById(sliderId);
                const valueDisplay = document.getElementById(valueId);

                if (slider) {
                    const value = Math.round(this.gpu.params[paramName] || 0);
                    slider.value = value;
                    if (valueDisplay) {
                        valueDisplay.textContent = value > 0 ? `+${value}` : value;
                    }
                }
            }
        }

        // Color Grading wheels and sliders
        this.editorUI.colorGradingModule?.updateUIFromState();
    }

    /**
     * Update the active preset visual indicator
     */
    _updateActivePresetUI() {
        // Remove active class from all cards
        document.querySelectorAll('.preset-card').forEach(card => {
            card.classList.remove('active');
            card.style.background = 'var(--bg-panel)';
            card.style.border = '1px solid var(--border)';
            card.style.boxShadow = 'none';
        });

        // Add active class to current
        if (this.activePresetId) {
            const activeCard = document.querySelector(`.preset-card[data-preset="${this.activePresetId}"]`);
            if (activeCard) {
                activeCard.classList.add('active');
                activeCard.style.background = 'var(--bg-hover)';
                activeCard.style.border = '1px solid var(--accent)';
                activeCard.style.boxShadow = '0 0 0 1px var(--accent)';
            }
        }
    }

    /**
     * Reset all adjustments
     */
    _resetAll() {
        this._resetParams();

        // L5 FIX: Sync state so history captures correct 0 values
        for (const key in this.gpu.params) {
            this.editorUI.state.setAdjustment(key, this.gpu.params[key]);
        }

        // Also reset other modules to match global reset
        if (this.editorUI.lutModule?.reset) this.editorUI.lutModule.reset();
        if (this.editorUI.hslModule?.reset) this.editorUI.hslModule.reset();
        if (this.editorUI.toneCurveModule?.reset) this.editorUI.toneCurveModule.reset();
        if (this.editorUI.colorGradingModule?.resetToDefaults) this.editorUI.colorGradingModule.resetToDefaults();

        this._syncSlidersToParams();
        this.gpu.render();

        this.activePresetId = null;
        this._updateActivePresetUI();

        this.editorUI._pushHistoryDebounced?.();
    }
}
