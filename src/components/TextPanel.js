/**
 * TextPanel - Sidebar UI for Text Tool
 * 
 * Provides:
 * - Add text buttons (Heading, Subheading, Body)
 * - Typography controls (font, size, weight)
 * - Color picker
 * - Alignment buttons
 * - Opacity slider
 * - Layer ordering
 */

export class TextPanel {
    constructor(app) {
        this.app = app;
        this.active = false;
    }

    init() {
        this.renderPanel();
        this.bindEvents();
    }

    renderPanel() {
        let panel = document.getElementById('text-section');
        if (panel) return; // Already exists

        panel = document.createElement('div');
        panel.id = 'text-section';
        panel.className = 'panel-section';
        panel.hidden = true;

        panel.innerHTML = `
            <h3 class="panel-title">Text</h3>
            
            <!-- Add Text Buttons -->
            <div class="control-group">
                <label class="control-label">Add Text</label>
                <div class="text-presets">
                    <button class="btn btn-secondary btn-full" id="btn-add-heading" style="margin-bottom: 6px;">
                        <span style="font-size: 18px; font-weight: bold;">Heading</span>
                    </button>
                    <button class="btn btn-secondary btn-full" id="btn-add-subheading" style="margin-bottom: 6px;">
                        <span style="font-size: 14px; font-weight: 500;">Subheading</span>
                    </button>
                    <button class="btn btn-secondary btn-full" id="btn-add-body">
                        <span style="font-size: 12px;">Body text</span>
                    </button>
                </div>
            </div>

            <div class="divider"></div>

            <!-- Typography Controls (shown when text selected) -->
            <div id="text-typography-controls" style="display: none;">
                <div class="control-group">
                    <label class="control-label">Font</label>
                    <select class="select" id="text-font">
                        <option value="Inter">Inter</option>
                        <option value="Arial">Arial</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Courier New">Courier New</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Impact">Impact</option>
                    </select>
                </div>

                <div class="control-group">
                    <label class="control-label">Size</label>
                    <div class="slider-row">
                        <input type="range" class="slider" id="text-size" min="12" max="200" value="48">
                        <span class="slider-value" id="text-size-val">48</span>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">Weight</label>
                    <select class="select" id="text-weight">
                        <option value="300">Light</option>
                        <option value="400" selected>Regular</option>
                        <option value="500">Medium</option>
                        <option value="600">Semibold</option>
                        <option value="700">Bold</option>
                        <option value="900">Black</option>
                    </select>
                </div>

                <div class="control-group">
                    <label class="control-label">Style</label>
                    <div class="toggle-group">
                        <button class="toggle-btn active" id="text-style-normal" data-style="normal">Normal</button>
                        <button class="toggle-btn" id="text-style-italic" data-style="italic">Italic</button>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">Color</label>
                    <input type="color" class="color-picker" id="text-color" value="#ffffff">
                </div>

                <div class="control-group">
                    <label class="control-label">Align</label>
                    <div class="toggle-group">
                        <button class="toggle-btn active" id="text-align-left" data-align="left">◀</button>
                        <button class="toggle-btn" id="text-align-center" data-align="center">▬</button>
                        <button class="toggle-btn" id="text-align-right" data-align="right">▶</button>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">Opacity</label>
                    <div class="slider-row">
                        <input type="range" class="slider" id="text-opacity" min="0" max="100" value="100">
                        <span class="slider-value" id="text-opacity-val">100%</span>
                    </div>
                </div>

                <div class="divider"></div>

                <div class="control-group">
                    <label class="control-label">Layer Order</label>
                    <div class="toggle-group" style="flex-wrap: wrap;">
                        <button class="btn btn-secondary" id="btn-text-forward" title="Bring Forward">↑</button>
                        <button class="btn btn-secondary" id="btn-text-backward" title="Send Backward">↓</button>
                        <button class="btn btn-secondary" id="btn-text-front" title="Bring to Front">⤒</button>
                        <button class="btn btn-secondary" id="btn-text-back" title="Send to Back">⤓</button>
                    </div>
                </div>

                <div class="control-group" style="margin-top: 16px;">
                    <button class="btn btn-secondary btn-full" id="btn-text-duplicate">
                        Duplicate
                    </button>
                    <button class="btn btn-danger btn-full" id="btn-text-delete" style="margin-top: 6px;">
                        Delete
                    </button>
                </div>
            </div>

            <!-- No Selection Message -->
            <div id="text-no-selection" class="panel-hint">
                Click on text to select, or add new text above.
            </div>
        `;

        const contentContainer = document.querySelector('.control-panel-content');
        if (contentContainer) {
            contentContainer.appendChild(panel);
        }
    }

    bindEvents() {
        // Add text buttons
        document.getElementById('btn-add-heading')?.addEventListener('click', () => {
            this.app.textManager?.addHeading();
        });

        document.getElementById('btn-add-subheading')?.addEventListener('click', () => {
            this.app.textManager?.addSubheading();
        });

        document.getElementById('btn-add-body')?.addEventListener('click', () => {
            this.app.textManager?.addBody();
        });

        // Font select
        document.getElementById('text-font')?.addEventListener('change', (e) => {
            this.app.textManager?.updateSelected({ fontFamily: e.target.value });
        });

        // Size slider
        document.getElementById('text-size')?.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('text-size-val').textContent = val;
            this.app.textManager?.updateSelected({ fontSize: val });
        });

        // Weight select
        document.getElementById('text-weight')?.addEventListener('change', (e) => {
            this.app.textManager?.updateSelected({ fontWeight: parseInt(e.target.value) });
        });

        // Style buttons
        document.querySelectorAll('[data-style]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-style]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.app.textManager?.updateSelected({ fontStyle: btn.dataset.style });
            });
        });

        // Color picker
        document.getElementById('text-color')?.addEventListener('input', (e) => {
            this.app.textManager?.updateSelected({ color: e.target.value });
        });

        // Align buttons
        document.querySelectorAll('[data-align]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-align]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.app.textManager?.updateSelected({ textAlign: btn.dataset.align });
            });
        });

        // Opacity slider
        document.getElementById('text-opacity')?.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('text-opacity-val').textContent = `${val}%`;
            this.app.textManager?.updateSelected({ opacity: val / 100 });
        });

        // Layer ordering
        document.getElementById('btn-text-forward')?.addEventListener('click', () => {
            const id = this.app.textManager?.selectedId;
            if (id) this.app.textManager.bringForward(id);
        });

        document.getElementById('btn-text-backward')?.addEventListener('click', () => {
            const id = this.app.textManager?.selectedId;
            if (id) this.app.textManager.sendBackward(id);
        });

        document.getElementById('btn-text-front')?.addEventListener('click', () => {
            const id = this.app.textManager?.selectedId;
            if (id) this.app.textManager.bringToFront(id);
        });

        document.getElementById('btn-text-back')?.addEventListener('click', () => {
            const id = this.app.textManager?.selectedId;
            if (id) this.app.textManager.sendToBack(id);
        });

        // Duplicate & Delete
        document.getElementById('btn-text-duplicate')?.addEventListener('click', () => {
            this.app.textManager?.duplicate();
        });

        document.getElementById('btn-text-delete')?.addEventListener('click', () => {
            this.app.textManager?.removeSelected();
        });
    }

    activate() {
        this.active = true;
        this.updateUI();
    }

    deactivate() {
        this.active = false;
    }

    /**
     * Update UI to reflect current selection
     */
    updateUI() {
        const selected = this.app.textManager?.getSelected();
        const typographyControls = document.getElementById('text-typography-controls');
        const noSelection = document.getElementById('text-no-selection');

        if (selected) {
            typographyControls.style.display = 'block';
            noSelection.style.display = 'none';

            // Sync controls with selection
            document.getElementById('text-font').value = selected.fontFamily;
            document.getElementById('text-size').value = selected.fontSize;
            document.getElementById('text-size-val').textContent = selected.fontSize;
            document.getElementById('text-weight').value = selected.fontWeight;
            document.getElementById('text-color').value = selected.color;
            document.getElementById('text-opacity').value = selected.opacity * 100;
            document.getElementById('text-opacity-val').textContent = `${Math.round(selected.opacity * 100)}%`;

            // Style
            document.querySelectorAll('[data-style]').forEach(b => {
                b.classList.toggle('active', b.dataset.style === selected.fontStyle);
            });

            // Align
            document.querySelectorAll('[data-align]').forEach(b => {
                b.classList.toggle('active', b.dataset.align === selected.textAlign);
            });
        } else {
            typographyControls.style.display = 'none';
            noSelection.style.display = 'block';
        }
    }
}
