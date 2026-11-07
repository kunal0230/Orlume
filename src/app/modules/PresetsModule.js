/**
 * PresetsModule - Minimalist, Pro-Grade Presets & Film Simulations Management
 * 
 * Elegant, clutter-free design inspired by Leica & Lightroom Classic:
 * - Unified dual-mode switcher: Film Stocks (14) & Presets (42)
 * - Quiet 1-line integrated slider (only visible when an adjustment is active)
 * - Lightroom Classic-style collapsible folders for both film stocks and presets
 * - Clean 2-column pills with authentic tonal dots and crisp typography
 * - Non-destructive instant hover preview on canvas
 * - Custom Adobe .CUBE LUT import with immediate live preview
 * - 100% contained within sidebar (strictly zero horizontal scroll)
 */

import { PresetCategories, Presets, getPresetsByCategory, getPresetById, blendPreset } from '../../presets/PresetLibrary.js';
import { BUILTIN_LUTS, CubeLutParser } from '../../utils/CubeLutParser.js';

// Clean Film Stock Categories
const FILM_STOCK_CATEGORIES = [
    { id: 'negative', name: 'Color Negative' },
    { id: 'slide', name: 'Color Slide' },
    { id: 'bw', name: 'Black & White' },
    { id: 'cinematic', name: 'Cinematic' }
];

export class PresetsModule {
    constructor(editorUI) {
        this.editorUI = editorUI;
        this.gpu = editorUI.gpu;
        this.state = editorUI.state;

        // View State
        this.currentTab = 'profiles'; // 'profiles' | 'presets'
        this.searchQuery = '';
        this.expandedFolders = new Set(['negative', 'film']); // Default first category in each mode open

        // Adjustment State
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
     * Render the minimalist Presets & Film Stocks UI
     */
    _renderMainUI() {
        const panel = document.getElementById('panel-presets');
        if (!panel) return;

        const isProfileActive = this.activeProfileId && this.activeProfileId !== 'none';
        const isPresetActive = Boolean(this.activePresetId);

        panel.innerHTML = `
            <div class="presets-module-container">
                <!-- Mode Switcher Tabs -->
                <div class="presets-nav-tabs">
                    <button class="presets-nav-tab ${this.currentTab === 'profiles' ? 'active' : ''}" data-tab="profiles">
                        <span>Film Stocks</span>
                        <span class="tab-badge">${BUILTIN_LUTS.length}</span>
                    </button>
                    <button class="presets-nav-tab ${this.currentTab === 'presets' ? 'active' : ''}" data-tab="presets">
                        <span>Presets</span>
                        <span class="tab-badge">${Presets.length}</span>
                    </button>
                </div>

                <!-- Quiet Search Input -->
                <div class="presets-search-wrap">
                    <svg class="presets-search-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input type="text" id="presets-search-input" class="presets-search-input" 
                        placeholder="Filter looks..." value="${this.searchQuery}" autocomplete="off" spellcheck="false">
                    <button id="presets-search-clear" class="presets-search-clear" title="Clear search" style="${this.searchQuery ? 'display: flex;' : 'display: none;'}">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>

                <!-- Minimal 1-Line Slider Bar (Profiles) -->
                <div id="profile-intensity-bar" class="minimal-slider-bar" style="${this.currentTab === 'profiles' && isProfileActive ? 'display: flex;' : 'display: none;'}">
                    <span class="minimal-slider-label">Amount</span>
                    <input type="range" id="slider-lut-intensity" min="0" max="100" step="1" value="${this.profileIntensity}">
                    <span id="val-lut-intensity" class="minimal-slider-val">${this.profileIntensity}%</span>
                    <button class="minimal-clear-btn" id="btn-clear-profile" title="Clear film stock">×</button>
                </div>

                <!-- Minimal 1-Line Slider Bar (Presets) -->
                <div id="preset-intensity-bar" class="minimal-slider-bar" style="${this.currentTab === 'presets' && isPresetActive ? 'display: flex;' : 'display: none;'}">
                    <span class="minimal-slider-label">Amount</span>
                    <input type="range" id="slider-preset-intensity" min="0" max="100" step="1" value="${this.presetIntensity}">
                    <span id="preset-intensity-value" class="minimal-slider-val">${this.presetIntensity}%</span>
                    <button class="minimal-clear-btn" id="btn-clear-preset" title="Reset preset">×</button>
                </div>

                <!-- Main Content Area -->
                <div id="presets-content-container">
                    ${this._renderContentHTML()}
                </div>

                <!-- Subtle Reset Footer -->
                <div class="presets-footer-reset">
                    <button id="btn-reset-all-looks" class="presets-footer-reset-btn">
                        Reset All Adjustments
                    </button>
                </div>

                <!-- Hidden elements for backward compatibility with LutModule -->
                <input type="file" id="input-lut-file" accept=".cube,.CUBE,text/plain" style="display: none;">
                <select id="select-lut" style="display: none;">
                    <option value="none">None</option>
                    ${BUILTIN_LUTS.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}
                    <option value="custom">Custom</option>
                </select>
                <button id="btn-import-lut" style="display: none;"></button>
            </div>
        `;
    }

    /**
     * Render content based on active tab and search query
     */
    _renderContentHTML() {
        if (this.searchQuery.trim()) {
            return this._renderSearchResultsHTML();
        }

        if (this.currentTab === 'profiles') {
            return this._renderFilmStocksHTML();
        }

        return this._renderPresetFoldersHTML();
    }

    /**
     * Render Film Stocks view with utility row & collapsible folders
     */
    _renderFilmStocksHTML() {
        const customLut = this.editorUI.lutModule?.customLut;
        const isCustomActive = this.activeProfileId === 'custom';
        const isStandardActive = !this.activeProfileId || this.activeProfileId === 'none';

        return `
            <div>
                <!-- Utility Row: Standard & Custom .CUBE -->
                <div class="presets-utility-row">
                    <button class="presets-utility-btn ${isStandardActive ? 'active' : ''}" data-profile="none" title="Camera standard colors (no simulation)">
                        <span class="utility-dot" style="background: #52525b;"></span>
                        <span>Standard (Natural)</span>
                        ${isStandardActive ? '<span class="preset-pill-active-dot"></span>' : ''}
                    </button>
                    <button class="presets-utility-btn ${isCustomActive ? 'active' : ''}" id="tile-custom-lut" data-profile="custom" title="Load custom Adobe .CUBE 3D LUT">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink: 0;">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        <span id="text-custom-lut-name">${customLut ? (customLut.title || 'Custom LUT') : 'Import .CUBE'}</span>
                        ${isCustomActive ? '<span class="preset-pill-active-dot"></span>' : ''}
                    </button>
                </div>

                <!-- Unified Collapsible Folders for Film Stocks -->
                <div class="preset-folders-list">
                    ${FILM_STOCK_CATEGORIES.map(cat => {
                        const stocks = BUILTIN_LUTS.filter(l => l.category === cat.id);
                        if (stocks.length === 0) return '';

                        const isExpanded = this.expandedFolders.has(cat.id);
                        const hasActive = stocks.some(l => l.id === this.activeProfileId);

                        return `
                            <div class="preset-folder ${isExpanded ? 'expanded' : ''}" data-folder="${cat.id}">
                                <div class="preset-folder-header" data-folder="${cat.id}">
                                    <div class="folder-header-left">
                                        <svg class="preset-folder-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <polyline points="9 18 15 12 9 6"/>
                                        </svg>
                                        <span class="folder-title ${hasActive ? 'has-active' : ''}">${cat.name}</span>
                                    </div>
                                    <span class="preset-folder-count">${stocks.length}</span>
                                </div>
                                <div class="preset-folder-items">
                                    ${stocks.map(lut => {
                                        const isActive = this.activeProfileId === lut.id;
                                        return `
                                            <div class="preset-item-pill ${isActive ? 'active' : ''}" data-profile="${lut.id}" title="${lut.name} • ${lut.description}">
                                                <div class="preset-pill-swatch" style="background: ${lut.gradient};"></div>
                                                <span class="preset-pill-name">${lut.tag || lut.name}</span>
                                                ${isActive ? '<div class="preset-pill-active-dot"></div>' : ''}
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render collapsible preset folders (Lightroom Classic style)
     */
    _renderPresetFoldersHTML() {
        return `
            <div class="preset-folders-list">
                ${PresetCategories.map(cat => {
                    const presets = getPresetsByCategory(cat.id);
                    if (presets.length === 0) return '';

                    const isExpanded = this.expandedFolders.has(cat.id);
                    const hasActivePreset = presets.some(p => p.id === this.activePresetId);

                    return `
                        <div class="preset-folder ${isExpanded ? 'expanded' : ''}" data-folder="${cat.id}">
                            <div class="preset-folder-header" data-folder="${cat.id}">
                                <div class="folder-header-left">
                                    <svg class="preset-folder-chevron" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5">
                                        <polyline points="9 18 15 12 9 6"/>
                                    </svg>
                                    <span class="folder-title ${hasActivePreset ? 'has-active' : ''}">${cat.name}</span>
                                </div>
                                <span class="preset-folder-count">${presets.length}</span>
                            </div>
                            <div class="preset-folder-items">
                                ${presets.map(p => {
                                    const isActive = this.activePresetId === p.id;
                                    return `
                                        <div class="preset-item-pill ${isActive ? 'active' : ''}" data-preset="${p.id}" title="${p.name} • ${p.description}">
                                            <div class="preset-pill-swatch" style="background: ${p.color};"></div>
                                            <span class="preset-pill-name">${p.name}</span>
                                            ${isActive ? '<div class="preset-pill-active-dot"></div>' : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    /**
     * Render search results in a clean 2-column grid
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

        const total = matchedProfiles.length + matchedPresets.length;

        if (total === 0) {
            return `
                <div class="presets-search-empty">
                    <p class="empty-title">No matching looks</p>
                    <p class="empty-sub">Try searching "Portra", "Velvia", "Warm", or "B&W"</p>
                </div>
            `;
        }

        return `
            <div class="presets-search-results">
                ${matchedProfiles.length > 0 ? `
                    <div class="search-category-title">
                        <span>Film Stocks</span>
                        <span class="search-category-count">${matchedProfiles.length}</span>
                    </div>
                    <div class="preset-folder-items" style="display: grid; padding: 4px 0 10px 0;">
                        ${matchedProfiles.map(lut => {
                            const isActive = this.activeProfileId === lut.id;
                            return `
                                <div class="preset-item-pill ${isActive ? 'active' : ''}" data-profile="${lut.id}" title="${lut.name} • ${lut.description}">
                                    <div class="preset-pill-swatch" style="background: ${lut.gradient};"></div>
                                    <span class="preset-pill-name">${lut.tag || lut.name}</span>
                                    ${isActive ? '<div class="preset-pill-active-dot"></div>' : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}

                ${matchedPresets.length > 0 ? `
                    <div class="search-category-title">
                        <span>Presets</span>
                        <span class="search-category-count">${matchedPresets.length}</span>
                    </div>
                    <div class="preset-folder-items" style="display: grid; padding: 4px 0 10px 0;">
                        ${matchedPresets.map(p => {
                            const isActive = this.activePresetId === p.id;
                            return `
                                <div class="preset-item-pill ${isActive ? 'active' : ''}" data-preset="${p.id}" title="${p.name} • ${p.description}">
                                    <div class="preset-pill-swatch" style="background: ${p.color};"></div>
                                    <span class="preset-pill-name">${p.name}</span>
                                    ${isActive ? '<div class="preset-pill-active-dot"></div>' : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Initialize all interactive listeners
     */
    _initEventListeners() {
        const panel = document.getElementById('panel-presets');
        if (!panel) return;

        // Click Handling via Event Delegation
        panel.addEventListener('click', (e) => {
            // Tab Switcher
            const tabBtn = e.target.closest('.presets-nav-tab');
            if (tabBtn) {
                const targetTab = tabBtn.dataset.tab;
                if (targetTab !== this.currentTab) {
                    this.currentTab = targetTab;
                    this._updateTabUI();
                }
                return;
            }

            // Folder Header (Expand / Collapse)
            const folderHeader = e.target.closest('.preset-folder-header');
            if (folderHeader) {
                const folderId = folderHeader.dataset.folder;
                const folder = folderHeader.closest('.preset-folder');
                if (this.expandedFolders.has(folderId)) {
                    this.expandedFolders.delete(folderId);
                    folder?.classList.remove('expanded');
                } else {
                    this.expandedFolders.add(folderId);
                    folder?.classList.add('expanded');
                }
                return;
            }

            // Film Stock Tile / Utility Click
            const stockTile = e.target.closest('[data-profile]');
            if (stockTile) {
                this._endHoverPreview();
                const profileId = stockTile.dataset.profile;
                if (profileId === 'custom') {
                    const input = document.getElementById('input-lut-file');
                    if (this.editorUI.lutModule?.customLut && this.activeProfileId !== 'custom') {
                        this._applyProfile('custom');
                    } else if (input) {
                        input.click();
                    }
                } else {
                    if (this.activeProfileId === profileId && profileId !== 'none') {
                        this._applyProfile('none');
                    } else {
                        this._applyProfile(profileId);
                    }
                }
                return;
            }

            // Preset Pill Click
            const presetPill = e.target.closest('.preset-item-pill[data-preset]');
            if (presetPill) {
                this._endHoverPreview();
                const presetId = presetPill.dataset.preset;
                if (this.activePresetId === presetId) {
                    this._resetPresets();
                } else {
                    this._applyPreset(presetId);
                }
                return;
            }

            // Clear Profile Button (x)
            if (e.target.closest('#btn-clear-profile')) {
                this._applyProfile('none');
                return;
            }

            // Clear Preset Button (x)
            if (e.target.closest('#btn-clear-preset')) {
                this._resetPresets();
                return;
            }

            // Reset All Adjustments
            if (e.target.closest('#btn-reset-all-looks')) {
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
                this._updateContentContainer();
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
                this._updateContentContainer();
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
                    this.gpu.requestRender();
                }

                this.state?.setAdjustment('lutIntensity', this.profileIntensity);
                this.editorUI.requestHistogramUpdate?.(false);
            });

            profileSlider.addEventListener('change', () => {
                this.editorUI.requestHistogramUpdate?.(true);
                this.editorUI._pushHistoryDebounced?.();
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
                this.editorUI.requestHistogramUpdate?.(false);
            });

            presetSlider.addEventListener('change', () => {
                this.editorUI.requestHistogramUpdate?.(true);
                this.editorUI._pushHistoryDebounced?.();
            });
        }

        // Non-destructive Hover Preview
        panel.addEventListener('pointerover', (e) => {
            const presetPill = e.target.closest('.preset-item-pill[data-preset]');
            if (presetPill) {
                this._startHoverPreview('preset', presetPill.dataset.preset);
                return;
            }

            const stockTile = e.target.closest('[data-profile]');
            if (stockTile && stockTile.dataset.profile !== 'custom') {
                this._startHoverPreview('profile', stockTile.dataset.profile);
                return;
            }
        });

        panel.addEventListener('pointerout', (e) => {
            const card = e.target.closest('.preset-item-pill, [data-profile]');
            if (card && (!e.relatedTarget || !card.contains(e.relatedTarget))) {
                this._endHoverPreview();
            }
        });
    }

    /**
     * Start live canvas preview
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
     * End live hover preview
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
     * Switch view tab
     */
    _updateTabUI() {
        document.querySelectorAll('.presets-nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === this.currentTab);
        });

        const isProfileActive = this.activeProfileId && this.activeProfileId !== 'none';
        const isPresetActive = Boolean(this.activePresetId);

        const profileBar = document.getElementById('profile-intensity-bar');
        const presetBar = document.getElementById('preset-intensity-bar');

        if (profileBar) {
            profileBar.style.display = (this.currentTab === 'profiles' && isProfileActive) ? 'flex' : 'none';
        }
        if (presetBar) {
            presetBar.style.display = (this.currentTab === 'presets' && isPresetActive) ? 'flex' : 'none';
        }

        this._updateContentContainer();
    }

    /**
     * Re-render content container
     */
    _updateContentContainer() {
        const container = document.getElementById('presets-content-container');
        if (container) {
            container.innerHTML = this._renderContentHTML();
        }
    }

    /**
     * Apply film stock profile
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
     * Update profile indicators and sliders
     */
    updateProfileUI(lutId, intensity) {
        this.activeProfileId = lutId || 'none';
        if (intensity !== undefined) {
            this.profileIntensity = intensity;
        }

        const isProfileActive = this.activeProfileId && this.activeProfileId !== 'none';
        const profileBar = document.getElementById('profile-intensity-bar');
        const profileSlider = document.getElementById('slider-lut-intensity');
        const profileVal = document.getElementById('val-lut-intensity');

        if (profileBar) {
            profileBar.style.display = (this.currentTab === 'profiles' && isProfileActive) ? 'flex' : 'none';
        }
        if (profileSlider) {
            profileSlider.value = `${this.profileIntensity}`;
        }
        if (profileVal) {
            profileVal.textContent = `${this.profileIntensity}%`;
        }

        // Highlight active profile buttons
        document.querySelectorAll('[data-profile]').forEach(tile => {
            const isMatch = tile.dataset.profile === this.activeProfileId;
            tile.classList.toggle('active', isMatch);
            let dot = tile.querySelector('.preset-pill-active-dot');
            if (isMatch && !dot) {
                tile.insertAdjacentHTML('beforeend', '<div class="preset-pill-active-dot"></div>');
            } else if (!isMatch && dot) {
                dot.remove();
            }
        });

        // Update custom LUT name if custom
        const customNameSpan = document.getElementById('text-custom-lut-name');
        if (customNameSpan && this.editorUI.lutModule?.customLut) {
            customNameSpan.textContent = this.editorUI.lutModule.customLut.title || 'Custom LUT';
        }

        // Sync hidden select
        const select = document.getElementById('select-lut');
        if (select && select.value !== this.activeProfileId) {
            select.value = this.activeProfileId;
        }
    }

    /**
     * Apply creative preset
     */
    _applyPreset(presetId, pushHistory = true) {
        const preset = getPresetById(presetId);
        if (!preset) return;

        this.activePresetId = presetId;
        const adjustments = blendPreset(preset, this.presetIntensity);

        this._resetParams();

        for (const [key, value] of Object.entries(adjustments)) {
            if (key in this.gpu.params) {
                this.gpu.params[key] = value;
            }
        }

        for (const key in this.gpu.params) {
            if (!key.startsWith('curveLut') && key !== 'lut3d' && key !== 'lut3dIntensity') {
                this.editorUI.state.setAdjustment(key, this.gpu.params[key]);
            }
        }

        this._syncSlidersToParams();
        this.gpu.render();

        this._updateActivePresetUI();

        if (pushHistory) {
            this.editorUI._pushHistoryDebounced?.();
        }
    }

    /**
     * Highlight active preset
     */
    _updateActivePresetUI() {
        document.querySelectorAll('.preset-item-pill[data-preset]').forEach(pill => {
            const isMatch = pill.dataset.preset === this.activePresetId;
            pill.classList.toggle('active', isMatch);
            let dot = pill.querySelector('.preset-pill-active-dot');
            if (isMatch && !dot) {
                pill.insertAdjacentHTML('beforeend', '<div class="preset-pill-active-dot"></div>');
            } else if (!isMatch && dot) {
                dot.remove();
            }
        });

        const presetBar = document.getElementById('preset-intensity-bar');
        if (presetBar) {
            presetBar.style.display = (this.currentTab === 'presets' && this.activePresetId) ? 'flex' : 'none';
        }

        // Highlight folder headers if active preset is within
        document.querySelectorAll('.preset-folder').forEach(folder => {
            const folderId = folder.dataset.folder;
            const presets = getPresetsByCategory(folderId);
            const hasActive = presets.some(p => p.id === this.activePresetId);
            const title = folder.querySelector('.folder-title');
            if (title) {
                title.classList.toggle('has-active', hasActive);
            }
        });
    }

    /**
     * Reset parameters to zero
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
     * Sync UI sliders
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

        const colors = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
        const hslTypes = ['hue', 'sat', 'lum'];

        for (const color of colors) {
            for (const type of hslTypes) {
                const paramName = `hsl${type.charAt(0).toUpperCase() + type.slice(1)}${color.charAt(0).toUpperCase() + color.slice(1)}`;
                const slider = document.getElementById(`slider-hsl-${type}-${color}`);
                const valueDisplay = document.getElementById(`hsl-${type}-${color}`);

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
     * Reset presets adjustments
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
     * Reset all looks (presets + film profile)
     */
    _resetAll() {
        this._resetPresets();
        this._applyProfile('none', false);
        this.editorUI._pushHistoryDebounced?.();
    }
}
