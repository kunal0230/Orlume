/**
 * LayersModule - Mask layer management
 * 
 * Handles:
 * - Layer list UI rendering
 * - Layer selection and activation
 * - Layer renaming (inline double-click)
 * - Layer deletion with confirmation
 * - Syncing slider UI with active layer adjustments
 */

export class LayersModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.masks = editor.masks;
        this.maskSliders = editor.maskSliders;
    }

    /**
     * Update layers list in UI
     */
    updateList() {
        const container = document.getElementById('mask-layers');
        if (!container) return;

        if (this.masks.layers.length === 0) {
            container.innerHTML = `
                <div style="color: var(--text-secondary); font-size: 12px; text-align: center; padding: 20px;">
                    No adjustment layers yet.<br>Select a tool to create one.
                </div>`;
            return;
        }

        container.innerHTML = this.masks.layers.map((layer, i) => `
            <div class="mask-layer ${i === this.masks.activeLayerIndex ? 'active' : ''}" data-index="${i}">
                <div class="mask-layer-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                    </svg>
                </div>
                <div class="mask-layer-name" data-layer-index="${i}">${layer.name}</div>
                <span class="mask-layer-delete" data-delete="${i}" title="Delete layer">×</span>
            </div>
        `).join('');

        this._bindEvents(container);
    }

    /**
     * Bind layer list events
     */
    _bindEvents(container) {
        // Layer selection
        container.querySelectorAll('.mask-layer').forEach(el => {
            el.addEventListener('click', (e) => {
                if (!e.target.classList.contains('mask-layer-delete') &&
                    !e.target.classList.contains('mask-layer-name') &&
                    e.target.tagName !== 'INPUT') {
                    this.masks.activeLayerIndex = parseInt(el.dataset.index);
                    this.updateList();
                    this.syncUI();
                }
            });
        });

        // Single click on name selects layer (only if different layer)
        container.querySelectorAll('.mask-layer-name').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const index = parseInt(el.dataset.layerIndex);
                if (this.masks.activeLayerIndex !== index) {
                    this.masks.activeLayerIndex = index;
                    this.updateList();
                    this.syncUI();
                }
            });

            // Double-click for inline rename
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const index = parseInt(el.dataset.layerIndex);
                const layer = this.masks.layers[index];

                const input = document.createElement('input');
                input.type = 'text';
                input.value = layer.name;
                input.style.cssText = `
                    width: 100%;
                    background: var(--bg-tertiary);
                    border: 1px solid var(--accent-primary);
                    border-radius: 4px;
                    color: var(--text-primary);
                    font-size: 12px;
                    padding: 2px 6px;
                    outline: none;
                    box-sizing: border-box;
                `;

                el.textContent = '';
                el.appendChild(input);
                input.focus();
                input.select();

                let saved = false;
                const saveRename = () => {
                    if (saved) return;
                    saved = true;
                    const newName = input.value.trim();
                    if (newName) {
                        layer.name = newName;
                    }
                    this.updateList();
                };

                input.addEventListener('blur', saveRename);
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        input.blur();
                    } else if (ev.key === 'Escape') {
                        saved = true;
                        this.updateList();
                    }
                });
            });
        });

        // Delete layer with confirmation
        container.querySelectorAll('.mask-layer-delete').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(el.dataset.delete);
                const layer = this.masks.layers[index];
                if (confirm(`Delete "${layer.name}"?`)) {
                    this.masks.deleteLayer(index);
                    this.updateList();
                    this.syncUI();
                    this.editor.renderWithMask(false);
                }
            });
        });
    }

    /**
     * Sync layer UI with active layer
     */
    syncUI() {
        const adj = this.masks.getActiveAdjustments();
        this.maskSliders.forEach(name => {
            const slider = document.getElementById(`slider-mask-${name}`);
            const valueDisplay = document.getElementById(`val-mask-${name}`);
            const value = adj ? (adj[name] || 0) : 0;
            if (slider) slider.value = value;
            if (valueDisplay) valueDisplay.textContent = name === 'exposure' ? value.toFixed(2) : Math.round(value);
        });
    }
}
