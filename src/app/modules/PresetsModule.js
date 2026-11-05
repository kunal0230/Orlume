/**
 * PresetsModule - Lightroom-Grade Presets & Film Profiles Management
 * 
 * Features:
 * - Dual Mode Switcher: Film Profiles (3D LUTs) & Creative Presets (Handcrafted packs)
 * - Real-time live search across 56+ film stocks, presets, and descriptions
 * - Dynamic category filter chips with live counts
 * - Smooth interactive hover preview on canvas before applying
 * - Dual intensity sliders (Profile Amount & Preset Strength) with real-time hardware blending
 * - Custom Adobe .CUBE LUT import and preview
 * - Preserves all history undo/redo and parameter synchronization contracts
 */

import { PresetCategories, Presets, getPresetsByCategory, getPresetById, blendPreset } from '../../presets/PresetLibrary.js';
import { BUILTIN_LUTS, CubeLutParser } from '../../utils/CubeLutParser.js';

export class PresetsModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.gpu = editorUI.gpu;
        this.state = editorUI.state;

        // Active View State
        this.currentTab = 'profiles'; // 'profiles' | 'presets'
        this.profileFilter = 'all';  // 'all' | 'negative' | 'slide' | 'bw' | 'cinematic'
        this.presetFilter = 'all';   // 'all' | category id
        this.searchQuery = '';

        // Selection State
        this.activePresetId = null;
        this.activeProfileId = 'none';
        this.presetIntensity = 100;
        this.profileIntensity = 100;

        // Hover Preview State
        this._hoverState = {
            isHovering: false,
            savedParams: null,
            savedLut: null,
            savedLutIntensity: 100
        };
    }

    /**
     * Initialize the module
     */
    init() {
        // Sync active state from EditorState if present
        if (this.state?.globalAdjustments?.lutPreset) {
            this.activeProfileId = this.state.globalAdjustments.lutPreset;
        }
        if (this.state?.globalAdjustments?.lutIntensity !== undefined) {
            this.profileIntensity = this.state.globalAdjustments.lutIntensity;
        }

        this._renderMainUI();
        this._initEventListeners();
    }

    /**
     * Render the complete presets & profiles user interface
     */
    _renderMainUI() {
        const panel = document.getElementById('panel-presets');
        if (!panel) return;

        panel.innerHTML = `
            <div class="presets-module-container">
                <!-- Mode Switcher Tabs -->
                <div class="presets-nav-tabs">
                    <button class="presets-nav-tab ${this.currentTab === 'profiles' ? 'active' : ''}" data-tab="profiles">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <line x1="7" y1="3" x2="7" y2="21"/>
                            <line x1="17" y1="3" x2="17" y2="21"/>
                            <line x1="3" y1="8" x2="7" y2="8"/>
                            <line x1="3" y1="12" x2="7" y2="12"/>
                            <line x1="3" y1="16" x2="7" y2="16"/>
                            <line x1="17" y1="8" x2="21" y2="8"/>
                            <line x1="17" y1="12" x2="21" y2="12"/>
                            <line x1="17" y1="16" x2="21" y2="16"/>
                        </svg>
                        <span>Film Simulations</span>
                        <span class="tab-badge">${BUILTIN_LUTS.length}</span>
                    </button>
                    <button class="presets-nav-tab ${this.currentTab === 'presets' ? 'active' : ''}" data-tab="presets">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0 0 15.3 8.5c.8-.5 1.2-1.4 1.2-2.3 0-1.1.9-2 2-2h.5A3.5 3.5 0 0 0 22 12.5C22 6.7 17.5 2 12 2z"/>
                            <circle cx="7.5" cy="10.5" r="1" fill="currentColor"/>
                            <circle cx="12" cy="7.5" r="1" fill="currentColor"/>
                            <circle cx="16.5" cy="10.5" r="1" fill="currentColor"/>
                        </svg>
                        <span>Creative Presets</span>
                        <span class="tab-badge">${Presets.length}</span>
                    </button>
                </div>

                <!-- Live Search Bar -->
                <div class="presets-search-wrap">
                    <svg class="presets-search-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input type="text" id="presets-search-input" class="presets-search-input" 
                        placeholder="Search film stocks & presets..." value="${this.searchQuery}" autocomplete="off" spellcheck="false">
                    <button id="presets-search-clear" class="presets-search-clear" title="Clear search" style="${this.searchQuery ? 'display: flex;' : 'display: none;'}">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>

                <!-- Dynamic Filter Chips -->
                <div id="presets-chips-container" class="presets-chips-row">
                    ${this._renderFilterChipsHTML()}
                </div>

                <!-- Profile Intensity Slider (visible when a profile is selected) -->
                <div id="profile-intensity-panel" class="presets-intensity-panel" style="${this.activeProfileId !== 'none' ? 'display: flex;' : 'display: none;'}">
                    <div class="presets-intensity-header">
                        <span class="presets-intensity-title">Simulation Intensity</span>
                        <span id="val-lut-intensity" class="presets-intensity-val">${this.profileIntensity}%</span>
                    </div>
                    <div class="control-group">
                        <input type="range" id="slider-lut-intensity" class="slider-lut-intensity" min="0" max="100" step="1" value="${this.profileIntensity}"
                            style="background: linear-gradient(to right, var(--bg-dark), var(--accent));">
                    </div>
                </div>

                <!-- Preset Intensity Slider (visible when a preset is selected) -->
                <div id="preset-intensity-panel" class="presets-intensity-panel" style="${this.activePresetId ? 'display: flex;' : 'display: none;'}">
                    <div class="presets-intensity-header">
                        <span class="presets-intensity-title">Preset Strength</span>
                        <span id="preset-intensity-value" class="presets-intensity-val">${this.presetIntensity}%</span>
                    </div>
                    <div class="control-group">
                        <input type="range" id="slider-preset-intensity" min="0" max="100" step="1" value="${this.presetIntensity}"
                            style="background: linear-gradient(to right, var(--bg-dark), var(--accent));">
                    </div>
                </div>

                <!-- Main Content Cards Area -->
                <div id="presets-content-container">
                    ${this._renderContentHTML()}
                </div>

                <!-- Reset Actions -->
                <div class="section" style="margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--border);">
                    <div style="display: flex; gap: 6px;">
                        <button class="btn btn-sm" id="btn-reset-current" style="flex: 1; font-size: 11px; padding: 7px 10px; display: flex; align-items: center; justify-content: center; gap: 5px;">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                                <path d="M3 3v5h5"/>
                            </svg>
                            <span>${this.currentTab === 'profiles' ? 'Reset Film Stock' : 'Reset Preset'}</span>
                        </button>
                        <button class="btn btn-sm" id="btn-reset-all-looks" style="flex: 1; font-size: 11px; padding: 7px 10px; background: rgba(239, 68, 68, 0.12); color: #f87171; border-color: rgba(239, 68, 68, 0.25);" title="Reset both film simulation and creative presets">
                            Reset All
                        </button>
                    </div>
                </div>

                <!-- Hidden file input & select for custom .CUBE support and LutModule compatibility -->
                <input type="file" id="input-lut-file" accept=".cube,.CUBE,text/plain" style="display: none;">
                <select id="select-lut" style="display: none;">
                    <option value="none">None</option>
                    ${BUILTIN_LUTS.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}
                    <option value="custom">Custom</option>
                </select>
                <!-- Hidden button for legacy bindings -->
                <button id="btn-import-lut" style="display: none;"></button>
            </div>
        `;
    }

    /**
     * Render the filter chips for the current tab
     */
    _renderFilterChipsHTML() {
        if (this.searchQuery.trim()) {
            return `
                <div class="presets-chip active" style="cursor: default;">
                    Results for "${this.searchQuery.trim()}"
                </div>
            `;
        }

        if (this.currentTab === 'profiles') {
            const categories = [
                { id: 'all', label: `All (${BUILTIN_LUTS.length})` },
                { id: 'negative', label: 'Color Negative' },
                { id: 'slide', label: 'Slide Film' },
                { id: 'bw', label: 'Black & White' },
                { id: 'cinematic', label: 'Cinematic' }
            ];

            return categories.map(cat => `
                <button class="presets-chip ${this.profileFilter === cat.id ? 'active' : ''}" data-filter="${cat.id}">
                    ${cat.label}
                </button>
            `).join('');
        }

        // Presets tab categories
        const allCount = Presets.length;
        const chips = [
            `<button class="presets-chip ${this.presetFilter === 'all' ? 'active' : ''}" data-filter="all">All (${allCount})</button>`,
            ...PresetCategories.map(cat => {
                const count = getPresetsByCategory(cat.id).length;
                return `
                    <button class="presets-chip ${this.presetFilter === cat.id ? 'active' : ''}" data-filter="${cat.id}">
                        ${cat.name} (${count})
                    </button>
                `;
            })
        ];

        return chips.join('');
    }

    /**
     * Render the main cards grid based on active tab and filters
     */
    _renderContentHTML() {
        if (this.searchQuery.trim()) {
            return this._renderSearchResultsHTML();
        }

        if (this.currentTab === 'profiles') {
            return this._renderProfilesHTML();
        }

        return this._renderPresetsHTML();
    }

    /**
     * Render the Film Profiles grid
     */
    _renderProfilesHTML() {
        const filtered = this.profileFilter === 'all'
            ? BUILTIN_LUTS
            : BUILTIN_LUTS.filter(l => l.category === this.profileFilter);

        const customLut = this.editorUI.lutModule?.customLut;
        const isCustomActive = this.activeProfileId === 'custom';
        const isStandardActive = this.activeProfileId === 'none' || !this.activeProfileId;

        return `
            <div class="presets-cards-grid">
                <!-- Standard / Natural Profile Tile -->
                <div class="profile-card ${isStandardActive ? 'active' : ''}" data-profile="none" title="Standard Camera Natural Profile">
                    <div class="profile-card-banner" style="background: linear-gradient(135deg, #25252a 0%, #3a3a44 100%);">
                        <span class="profile-card-tag">Natural</span>
                    </div>
                    <div class="profile-card-body">
                        <span class="profile-card-name">Standard Natural</span>
                        <span class="profile-card-desc">Original camera colors</span>
                    </div>
                    <div class="profile-card-check">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </div>
                </div>

                <!-- Custom .CUBE Import Card -->
                <div class="profile-card profile-card-custom ${isCustomActive ? 'active' : ''}" id="card-custom-lut" data-profile="custom" title="Load custom Adobe .CUBE 3D LUT">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span class="profile-card-custom-text">${customLut ? (customLut.title || 'Custom .CUBE') : 'Import .CUBE'}</span>
                    <span class="profile-card-custom-sub">${customLut ? 'Loaded LUT' : 'Adobe 3D LUT'}</span>
                    <div class="profile-card-check">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </div>
                </div>

                <!-- Builtin Film Profiles -->
                ${filtered.map(lut => this._renderProfileCardHTML(lut)).join('')}
            </div>
        `;
    }

    /**
     * Render a single film profile card
     */
    _renderProfileCardHTML(lut) {
        const isActive = this.activeProfileId === lut.id;

        return `
            <div class="profile-card ${isActive ? 'active' : ''}" data-profile="${lut.id}" title="${lut.name} - ${lut.description}">
                <div class="profile-card-banner" style="background: ${lut.gradient};">
                    <span class="profile-card-tag">${lut.tag}</span>
                </div>
                <div class="profile-card-body">
                    <span class="profile-card-name">${lut.name}</span>
                    <span class="profile-card-desc">${lut.description}</span>
                </div>
                <div class="profile-card-check">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
            </div>
        `;
    }

    /**
     * Render the Creative Presets grid
     */
    _renderPresetsHTML() {
        const categoriesToRender = this.presetFilter === 'all'
            ? PresetCategories
            : PresetCategories.filter(c => c.id === this.presetFilter);

        return categoriesToRender.map(cat => {
            const presets = getPresetsByCategory(cat.id);
            if (presets.length === 0) return '';

            return `
                <div class="presets-section-block" style="margin-bottom: 12px;">
                    <div class="presets-section-heading">
                        <span class="presets-section-title">
                            ${this._getCategoryIcon(cat.icon)}
                            <span>${cat.name}</span>
                        </span>
                        <span class="presets-section-count">${presets.length}</span>
                    </div>
                    <div class="presets-cards-grid" style="margin-top: 8px;">
                        ${presets.map(p => this._renderPresetCardHTML(p)).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Render a single creative preset card
     */
    _renderPresetCardHTML(preset) {
        const isActive = this.activePresetId === preset.id;

        return `
            <div class="preset-item-card ${isActive ? 'active' : ''}" data-preset="${preset.id}" title="${preset.description}">
                <div class="preset-item-swatch" style="background: ${preset.color};"></div>
                <div class="preset-item-info">
                    <span class="preset-item-name">${preset.name}</span>
                    <span class="preset-item-desc">${preset.description}</span>
                </div>
                <div class="preset-item-check">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
            </div>
        `;
    }

    /**
     * Render Search Results across both profiles and presets
     */
    _renderSearchResultsHTML() {
        const q = this.searchQuery.toLowerCase().trim();

        const matchedProfiles = BUILTIN_LUTS.filter(l =>
            l.name.toLowerCase().includes(q) ||
            l.description.toLowerCase().includes(q) ||
            l.tag.toLowerCase().includes(q) ||
            l.category.toLowerCase().includes(q)
        );

        const matchedPresets = Presets.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q)
        );

        const totalMatches = matchedProfiles.length + matchedPresets.length;

        if (totalMatches === 0) {
            return `
                <div style="text-align: center; padding: 32px 16px; color: var(--text-secondary);">
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 8px; opacity: 0.5;">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <p style="font-size: 12px; font-weight: 500; color: var(--text-primary); margin-bottom: 4px;">No matches found</p>
                    <p style="font-size: 11px;">Try searching for "Portra", "Velvia", "Warm", "B&W", or "Cinematic"</p>
                </div>
            `;
        }

        return `
            <div>
                ${matchedProfiles.length > 0 ? `
                    <div style="margin-bottom: 14px;">
                        <div class="presets-section-heading">
                            <span class="presets-section-title">Film Profiles</span>
                            <span class="presets-section-count">${matchedProfiles.length}</span>
                        </div>
                        <div class="presets-cards-grid" style="margin-top: 8px;">
                            ${matchedProfiles.map(l => this._renderProfileCardHTML(l)).join('')}
                        </div>
                    </div>
                ` : ''}

                ${matchedPresets.length > 0 ? `
                    <div style="margin-bottom: 14px;">
                        <div class="presets-section-heading">
                            <span class="presets-section-title">Creative Presets</span>
                            <span class="presets-section-count">${matchedPresets.length}</span>
                        </div>
                        <div class="presets-cards-grid" style="margin-top: 8px;">
                            ${matchedPresets.map(p => this._renderPresetCardHTML(p)).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Get clean SVG icon for category
     */
    _getCategoryIcon(iconId) {
        switch (iconId) {
            case 'film':
                return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/></svg>`;
            case 'cinematic':
                return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><polygon points="10 9 15 12 10 15" fill="currentColor"/></svg>`;
            case 'portrait':
                return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 20v-1.5a5.5 5.5 0 0 1 11 0V20"/></svg>`;
            case 'mood':
                return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/></svg>`;
            case 'bw':
                return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>`;
            case 'creative':
                return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0 0 15.3 8.5c.8-.5 1.2-1.4 1.2-2.3 0-1.1.9-2 2-2h.5A3.5 3.5 0 0 0 22 12.5C22 6.7 17.5 2 12 2z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor"/></svg>`;
            default:
                return '';
        }
    }

    /**
     * Initialize all interactive event listeners
     */
    _initEventListeners() {
        const panel = document.getElementById('panel-presets');
        if (!panel) return;

        // Nav Tab Switcher (Film Profiles vs Creative Presets)
        panel.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.presets-nav-tab');
            if (tabBtn) {
                const targetTab = tabBtn.dataset.tab;
                if (targetTab !== this.currentTab) {
                    this.currentTab = targetTab;
                    this._updateView();
                }
                return;
            }

            // Filter Chip Click
            const chip = e.target.closest('.presets-chip');
            if (chip && chip.dataset.filter) {
                const filter = chip.dataset.filter;
                if (this.currentTab === 'profiles') {
                    this.profileFilter = filter;
                } else {
                    this.presetFilter = filter;
                }
                this._updateFilterChipsAndContent();
                return;
            }

            // Profile Card Click
            const profileCard = e.target.closest('.profile-card');
            if (profileCard) {
                this._endHoverPreview();
                const profileId = profileCard.dataset.profile;
                if (profileId === 'custom') {
                    const input = document.getElementById('input-lut-file');
                    if (this.editorUI.lutModule?.customLut && this.activeProfileId !== 'custom') {
                        this._applyProfile('custom');
                    } else if (input) {
                        input.click();
                    }
                } else {
                    // Toggle off if clicking the active profile
                    if (this.activeProfileId === profileId) {
                        this._applyProfile('none');
                    } else {
                        this._applyProfile(profileId);
                    }
                }
                return;
            }

            // Preset Card Click
            const presetCard = e.target.closest('.preset-item-card');
            if (presetCard) {
                this._endHoverPreview();
                const presetId = presetCard.dataset.preset;
                this._applyPreset(presetId);
                return;
            }

            // Reset current tab button
            const resetCurrentBtn = e.target.closest('#btn-reset-current');
            if (resetCurrentBtn) {
                if (this.currentTab === 'profiles') {
                    this._applyProfile('none');
                } else {
                    this._resetPresets();
                }
                return;
            }

            // Reset All looks button
            const resetAllBtn = e.target.closest('#btn-reset-all-looks');
            if (resetAllBtn) {
                this._resetAll();
                return;
            }
        });

        // Search Input Handling
        const searchInput = document.getElementById('presets-search-input');
        const clearBtn = document.getElementById('presets-search-clear');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                if (clearBtn) {
                    clearBtn.style.display = this.searchQuery ? 'flex' : 'none';
                }
                this._updateFilterChipsAndContent();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.searchQuery = '';
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                }
                clearBtn.style.display = 'none';
                this._updateFilterChipsAndContent();
            });
        }

        // Preset Intensity Slider
        const presetSlider = document.getElementById('slider-preset-intensity');
        if (presetSlider) {
            presetSlider.addEventListener('input', () => {
                this.presetIntensity = parseInt(presetSlider.value, 10);
                const display = document.getElementById('preset-intensity-value');
                if (display) {
                    display.textContent = `${this.presetIntensity}%`;
                }

                if (this.activePresetId) {
                    this._applyPreset(this.activePresetId, false);
                }
            });

            presetSlider.addEventListener('change', () => {
                this.editorUI._pushHistoryDebounced?.();
            });
        }

        // Profile Intensity Slider
        const profileSlider = document.getElementById('slider-lut-intensity');
        if (profileSlider) {
            profileSlider.addEventListener('input', () => {
                this.profileIntensity = parseInt(profileSlider.value, 10);
                const display = document.getElementById('val-lut-intensity');
                if (display) {
                    display.textContent = `${this.profileIntensity}%`;
                }

                if (this.gpu) {
                    this.gpu.params.lut3dIntensity = this.profileIntensity;
                    this.gpu.render();
                }

                this.state?.setAdjustment('lutIntensity', this.profileIntensity);
            });

            profileSlider.addEventListener('change', () => {
                this.editorUI._pushHistoryDebounced?.();
            });
        }

        // Interactive Hover Preview on Cards
        panel.addEventListener('pointerover', (e) => {
            const presetCard = e.target.closest('.preset-item-card');
            if (presetCard) {
                this._startHoverPreview('preset', presetCard.dataset.preset);
                return;
            }

            const profileCard = e.target.closest('.profile-card');
            if (profileCard && profileCard.dataset.profile !== 'custom') {
                this._startHoverPreview('profile', profileCard.dataset.profile);
                return;
            }
        });

        panel.addEventListener('pointerout', (e) => {
            const card = e.target.closest('.preset-item-card, .profile-card');
            if (card && (!e.relatedTarget || !card.contains(e.relatedTarget))) {
                this._endHoverPreview();
            }
        });
    }

    /**
     * Start live hover preview on canvas
     */
    _startHoverPreview(type, id) {
        if (!this.gpu || !this.gpu.inputTexture) return;

        if (!this._hoverState.isHovering) {
            this._hoverState.isHovering = true;
            this._hoverState.savedParams = { ...this.gpu.params };
            this._hoverState.savedLut = this.gpu.params.lut3d;
            this._hoverState.savedLutIntensity = this.gpu.params.lut3dIntensity;
        }

        if (type === 'preset') {
            const preset = getPresetById(id);
            if (!preset) return;
            const adjustments = blendPreset(preset, this.presetIntensity);

            for (const key in this.gpu.params) {
                if (key.startsWith('curveLut')) {
                    this.gpu.params[key] = null;
                } else if (key === 'colorBlending') {
                    this.gpu.params[key] = 50;
                } else if (key in adjustments) {
                    this.gpu.params[key] = adjustments[key];
                } else if (key !== 'lut3d' && key !== 'lut3dIntensity') {
                    this.gpu.params[key] = 0;
                }
            }
            this.gpu.render();
        } else if (type === 'profile') {
            if (id === 'none') {
                this.gpu.setLut3d(null, this.profileIntensity);
            } else {
                const presetLut = CubeLutParser.getPreset(id);
                if (presetLut) {
                    this.gpu.setLut3d(presetLut, this.profileIntensity);
                }
            }
        }
    }

    /**
     * End live hover preview and restore saved state
     */
    _endHoverPreview() {
        if (!this._hoverState.isHovering || !this.gpu) return;

        if (this._hoverState.savedParams) {
            for (const key in this._hoverState.savedParams) {
                this.gpu.params[key] = this._hoverState.savedParams[key];
            }
        }

        if (this._hoverState.savedLut !== undefined) {
            this.gpu.setLut3d(this._hoverState.savedLut, this._hoverState.savedLutIntensity ?? 100);
        }

        this.gpu.render();
        this._hoverState.isHovering = false;
        this._hoverState.savedParams = null;
        this._hoverState.savedLut = null;
    }

    /**
     * Update view when tab changes
     */
    _updateView() {
        // Update nav tab buttons
        document.querySelectorAll('.presets-nav-tab').forEach(tab => {
            if (tab.dataset.tab === this.currentTab) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Update Reset Current button text
        const resetCurrentBtn = document.getElementById('btn-reset-current');
        if (resetCurrentBtn) {
            const label = resetCurrentBtn.querySelector('span');
            if (label) {
                label.textContent = this.currentTab === 'profiles' ? 'Reset Film Stock' : 'Reset Preset';
            }
        }

        this._updateFilterChipsAndContent();
    }

    /**
     * Update filter chips and content cards
     */
    _updateFilterChipsAndContent() {
        const chipsContainer = document.getElementById('presets-chips-container');
        if (chipsContainer) {
            chipsContainer.innerHTML = this._renderFilterChipsHTML();
        }

        const contentContainer = document.getElementById('presets-content-container');
        if (contentContainer) {
            contentContainer.innerHTML = this._renderContentHTML();
        }
    }

    /**
     * Apply a film profile (3D LUT)
     */
    _applyProfile(lutId, pushHistory = true) {
        this.activeProfileId = lutId || 'none';

        if (this.editorUI.lutModule) {
            if (lutId === 'custom') {
                if (this.editorUI.lutModule.customLut) {
                    this.editorUI.lutModule.applyLut(this.editorUI.lutModule.customLut, 'custom');
                } else if (this.editorUI.lutModule.inputLutFile) {
                    this.editorUI.lutModule.inputLutFile.click();
                    return;
                }
            } else {
                this.editorUI.lutModule.selectPreset(lutId);
            }
        }

        this.updateProfileUI(lutId, this.profileIntensity);

        if (pushHistory) {
            this.editorUI._pushHistoryDebounced?.();
        }
    }

    /**
     * Update profile UI indicators and sliders
     */
    updateProfileUI(lutId, intensity) {
        this.activeProfileId = lutId || 'none';
        if (intensity !== undefined) {
            this.profileIntensity = intensity;
        }

        const intensityPanel = document.getElementById('profile-intensity-panel');
        const intensitySlider = document.getElementById('slider-lut-intensity');
        const intensityVal = document.getElementById('val-lut-intensity');

        if (intensityPanel) {
            intensityPanel.style.display = this.activeProfileId !== 'none' ? 'flex' : 'none';
        }
        if (intensitySlider) {
            intensitySlider.value = `${this.profileIntensity}`;
        }
        if (intensityVal) {
            intensityVal.textContent = `${this.profileIntensity}%`;
        }

        // Update active class on profile cards
        document.querySelectorAll('.profile-card').forEach(card => {
            if (card.dataset.profile === this.activeProfileId) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });

        // Update custom LUT card text if loaded
        const customCard = document.getElementById('card-custom-lut');
        if (customCard) {
            const customLut = this.editorUI.lutModule?.customLut;
            const titleSpan = customCard.querySelector('.profile-card-custom-text');
            const subSpan = customCard.querySelector('.profile-card-custom-sub');
            if (titleSpan) {
                titleSpan.textContent = customLut ? (customLut.title || 'Custom .CUBE') : 'Import .CUBE';
            }
            if (subSpan) {
                subSpan.textContent = customLut ? 'Loaded LUT' : 'Adobe 3D LUT';
            }
        }

        // Sync hidden select if exists
        const select = document.getElementById('select-lut');
        if (select && select.value !== this.activeProfileId) {
            select.value = this.activeProfileId;
        }
    }

    /**
     * Apply a creative preset
     */
    _applyPreset(presetId, pushHistory = true) {
        const preset = getPresetById(presetId);
        if (!preset) return;

        this.activePresetId = presetId;
        const adjustments = blendPreset(preset, this.presetIntensity);

        // Reset all params to 0 (clean slate)
        this._resetParams();

        // Apply adjustments to GPU
        for (const [key, value] of Object.entries(adjustments)) {
            if (key in this.gpu.params) {
                this.gpu.params[key] = value;
            }
        }

        // Sync state back to EditorState
        for (const key in this.gpu.params) {
            if (!key.startsWith('curveLut') && key !== 'lut3d' && key !== 'lut3dIntensity') {
                this.editorUI.state.setAdjustment(key, this.gpu.params[key]);
            }
        }

        // Sync develop and HSL sliders
        this._syncSlidersToParams();

        // Render
        this.gpu.render();

        // Update active preset UI
        this._updateActivePresetUI();

        if (pushHistory) {
            this.editorUI._pushHistoryDebounced?.();
        }
    }

    /**
     * Update active preset card highlight
     */
    _updateActivePresetUI() {
        document.querySelectorAll('.preset-item-card').forEach(card => {
            if (card.dataset.preset === this.activePresetId) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });

        const presetIntensityPanel = document.getElementById('preset-intensity-panel');
        if (presetIntensityPanel) {
            presetIntensityPanel.style.display = this.activePresetId ? 'flex' : 'none';
        }
    }

    /**
     * Reset all parameters to zero / null
     */
    _resetParams() {
        for (const key in this.gpu.params) {
            if (key.startsWith('curveLut')) {
                this.gpu.params[key] = null;
            } else if (key === 'colorBlending') {
                this.gpu.params[key] = 50;
            } else if (key !== 'lut3d' && key !== 'lut3dIntensity') {
                this.gpu.params[key] = 0;
            }
        }
    }

    /**
     * Sync UI sliders to current GPU params
     */
    _syncSlidersToParams() {
        const globalSliders = [
            'exposure', 'contrast', 'highlights', 'shadows',
            'whites', 'blacks', 'temperature', 'tint',
            'vibrance', 'saturation', 'clarity', 'dehaze', 'structure'
        ];

        for (const param of globalSliders) {
            const slider = document.getElementById(`slider-${param}`);
            const valueDisplay = document.getElementById(`val-${param}`);

            if (slider) {
                let value = this.gpu.params[param] || 0;
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

        this.editorUI.colorGradingModule?.updateUIFromState();
    }

    /**
     * Reset creative preset adjustments
     */
    _resetPresets() {
        this._resetParams();

        for (const key in this.gpu.params) {
            if (!key.startsWith('curveLut') && key !== 'lut3d' && key !== 'lut3dIntensity') {
                this.editorUI.state.setAdjustment(key, this.gpu.params[key]);
            }
        }

        if (this.editorUI.hslModule?.reset) this.editorUI.hslModule.reset();
        if (this.editorUI.toneCurveModule?.reset) this.editorUI.toneCurveModule.reset();
        if (this.editorUI.colorGradingModule?.resetToDefaults) this.editorUI.colorGradingModule.resetToDefaults();

        this._syncSlidersToParams();
        this.gpu.render();

        this.activePresetId = null;
        this._updateActivePresetUI();

        this.editorUI._pushHistoryDebounced?.();
    }

    /**
     * Reset all adjustments (presets + film profile)
     */
    _resetAll() {
        this._resetPresets();
        this._applyProfile('none', false);
        this.editorUI._pushHistoryDebounced?.();
    }
}
