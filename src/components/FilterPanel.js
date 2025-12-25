/**
 * FilterPanel - Sidebar UI for Filters
 * 
 * Features:
 * - Category tabs (Natural, Cinematic, BW, Creative)
 * - Filter grid with names
 * - Intensity slider (0-100%)
 * - Reset button
 */

import { FilterPresets, getCategories, getPresetsByCategory, DefaultSettings, DefaultColorMixer, DefaultColorGrading } from '../core/FilterPresets.js';

export class FilterPanel {
    constructor(app) {
        this.app = app;
        this.active = false;

        // Current state
        this.currentFilter = null;
        this.intensity = 100;
        this.activeCategory = 'Natural';
    }

    init() {
        this.renderPanel();
        this.bindEvents();
    }

    renderPanel() {
        let panel = document.getElementById('filters-section');
        if (panel) return;

        panel = document.createElement('div');
        panel.id = 'filters-section';
        panel.className = 'panel-section';
        panel.hidden = true;

        const categories = getCategories();

        panel.innerHTML = `
            <h3 class="panel-title">Filters</h3>
            
            <!-- Category Tabs -->
            <div class="control-group">
                <div class="filter-tabs">
                    ${categories.map(cat => `
                        <button class="filter-tab ${cat === this.activeCategory ? 'active' : ''}" data-category="${cat}">
                            ${cat === 'Black & White' ? 'B&W' : cat}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- Filter Grid -->
            <div class="control-group">
                <div class="filter-grid" id="filter-grid">
                    ${this._renderFilterGrid(this.activeCategory)}
                </div>
            </div>

            <div class="divider"></div>

            <!-- Intensity Slider -->
            <div class="control-group" id="filter-intensity-group" style="display: none;">
                <label class="control-label">Intensity</label>
                <div class="slider-row">
                    <input type="range" class="slider" id="filter-intensity" min="0" max="100" value="100">
                    <span class="slider-value" id="filter-intensity-val">100%</span>
                </div>
            </div>

            <!-- Current Filter Info -->
            <div class="control-group" id="filter-info" style="display: none;">
                <div class="filter-current">
                    <span class="filter-current-label">Active:</span>
                    <span class="filter-current-name" id="current-filter-name">None</span>
                </div>
            </div>

            <!-- Reset Button -->
            <div class="control-group">
                <button class="btn btn-secondary btn-full" id="btn-filter-reset">
                    Reset Filter
                </button>
            </div>

            <style>
                .filter-tabs {
                    display: flex;
                    gap: 4px;
                    margin-bottom: 12px;
                }
                .filter-tab {
                    flex: 1;
                    padding: 8px 4px;
                    background: var(--surface-hover);
                    border: none;
                    border-radius: 6px;
                    color: var(--text-secondary);
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .filter-tab:hover {
                    background: var(--surface-active);
                    color: var(--text-primary);
                }
                .filter-tab.active {
                    background: var(--accent);
                    color: white;
                }
                .filter-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 8px;
                    max-height: 300px;
                    overflow-y: auto;
                }
                .filter-item {
                    padding: 12px 8px;
                    background: var(--surface-hover);
                    border: 2px solid transparent;
                    border-radius: 8px;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .filter-item:hover {
                    background: var(--surface-active);
                    border-color: var(--border-color);
                }
                .filter-item.active {
                    background: var(--accent-bg);
                    border-color: var(--accent);
                }
                .filter-item-name {
                    font-size: 11px;
                    color: var(--text-primary);
                    font-weight: 500;
                }
                .filter-item-desc {
                    font-size: 9px;
                    color: var(--text-secondary);
                    margin-top: 4px;
                    line-height: 1.2;
                }
                .filter-current {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: var(--surface-hover);
                    border-radius: 6px;
                }
                .filter-current-label {
                    color: var(--text-secondary);
                    font-size: 11px;
                }
                .filter-current-name {
                    color: var(--accent);
                    font-weight: 500;
                    font-size: 12px;
                }
            </style>
        `;

        const contentContainer = document.querySelector('.control-panel-content');
        if (contentContainer) {
            contentContainer.appendChild(panel);
        }
    }

    _renderFilterGrid(category) {
        const presets = getPresetsByCategory(category);
        return presets.map(preset => `
            <div class="filter-item ${this.currentFilter === preset.id ? 'active' : ''}" 
                 data-filter="${preset.id}">
                <div class="filter-item-name">${preset.name}</div>
            </div>
        `).join('');
    }

    bindEvents() {
        // Category tabs
        document.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.activeCategory = e.target.dataset.category;

                // Update tab active state
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');

                // Re-render grid
                document.getElementById('filter-grid').innerHTML = this._renderFilterGrid(this.activeCategory);
                this._bindFilterItems();
            });
        });

        // Initial filter item binding
        this._bindFilterItems();

        // Intensity slider
        document.getElementById('filter-intensity')?.addEventListener('input', (e) => {
            this.intensity = parseInt(e.target.value);
            document.getElementById('filter-intensity-val').textContent = `${this.intensity}%`;
            this._applyCurrentFilter();
        });

        // Reset button
        document.getElementById('btn-filter-reset')?.addEventListener('click', () => {
            this.resetFilter();
        });
    }

    _bindFilterItems() {
        document.querySelectorAll('.filter-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const filterId = e.currentTarget.dataset.filter;
                this.selectFilter(filterId);
            });
        });
    }

    selectFilter(filterId) {
        const preset = FilterPresets[filterId];
        if (!preset) return;

        this.currentFilter = filterId;
        this.intensity = 100;

        // Update UI
        document.querySelectorAll('.filter-item').forEach(item => {
            item.classList.toggle('active', item.dataset.filter === filterId);
        });

        document.getElementById('filter-intensity').value = 100;
        document.getElementById('filter-intensity-val').textContent = '100%';
        document.getElementById('filter-intensity-group').style.display = 'block';
        document.getElementById('filter-info').style.display = 'block';
        document.getElementById('current-filter-name').textContent = preset.name;

        // Apply the filter
        this._applyCurrentFilter();
    }

    _applyCurrentFilter() {
        if (!this.currentFilter) return;

        const preset = FilterPresets[this.currentFilter];
        if (!preset) return;

        const develop = this.app.components.develop;
        if (!develop) return;

        const t = this.intensity / 100;

        // Apply settings with intensity interpolation
        if (preset.settings) {
            for (const [key, value] of Object.entries(preset.settings)) {
                if (key === 'profile') {
                    // Profile is not interpolated
                    develop.set(key, t > 0.5 ? value : 'color');
                } else {
                    const defaultVal = DefaultSettings[key] || 0;
                    const blendedVal = defaultVal + (value - defaultVal) * t;
                    develop.set(key, blendedVal);
                }
            }
        }

        // Apply color mixer with intensity
        if (preset.colorMixer) {
            for (const [band, values] of Object.entries(preset.colorMixer)) {
                const defaults = DefaultColorMixer[band] || { h: 0, s: 0, l: 0 };
                if (values.h !== undefined) {
                    const blended = defaults.h + (values.h - defaults.h) * t;
                    develop.setColorMixer(band, 'hue', blended / 30 * 100); // Convert to UI scale
                }
                if (values.s !== undefined) {
                    const blended = defaults.s + (values.s - defaults.s) * t;
                    develop.setColorMixer(band, 'sat', blended);
                }
                if (values.l !== undefined) {
                    const blended = defaults.l + (values.l - defaults.l) * t;
                    develop.setColorMixer(band, 'lum', blended / 0.3 * 100);
                }
            }
        }

        // Apply color grading with intensity
        if (preset.colorGrading) {
            for (const [wheel, values] of Object.entries(preset.colorGrading)) {
                if (wheel === 'blending' || wheel === 'balance') continue;

                const defaults = DefaultColorGrading[wheel] || { angle: 0, strength: 0 };
                if (values.angle !== undefined) {
                    develop.setColorGrading(wheel, 'angle', values.angle);
                }
                if (values.strength !== undefined) {
                    const blended = defaults.strength + (values.strength - defaults.strength) * t;
                    develop.setColorGrading(wheel, 'strength', blended * 100);
                }
            }
        }

        // Trigger preview update
        this.app.updateDevelopPreview?.();
    }

    resetFilter() {
        this.currentFilter = null;
        this.intensity = 100;

        // Reset UI
        document.querySelectorAll('.filter-item').forEach(item => {
            item.classList.remove('active');
        });
        document.getElementById('filter-intensity-group').style.display = 'none';
        document.getElementById('filter-info').style.display = 'none';

        // Reset develop settings
        const develop = this.app.components.develop;
        if (develop) {
            develop.reset();
        }

        // Trigger preview update
        this.app.updateDevelopPreview?.();
    }

    activate() {
        this.active = true;
    }

    deactivate() {
        this.active = false;
    }
}
