/**
 * Geometry Panel Component
 * Handles Manual Transform controls (Vertical, Horizontal, Rotate, Aspect, Scale, Offset)
 * and Upright modes (placeholder for V2).
 */

import { GeometryMath } from '../core/GeometryMath.js';

export class GeometryPanel {
    constructor(app) {
        this.app = app;
        this.active = false;

        // Transform Parameters
        this.params = {
            vertical: 0,
            horizontal: 0,
            rotate: 0,
            aspect: 0,
            scale: 100,
            xOffset: 0,
            yOffset: 0
        };

        // Debounce timer
        this._updateTimer = null;

        // Container
        this.container = document.querySelector('.tool-panel[data-tool="geometry"]');
        if (!this.container) {
            // If container doesn't exist (not in HTML yet), we create it dynamically? 
            // Or assume user will add it? 
            // Ideally we should inject it if missing, or we added it to HTML?
            // "Geometry" button exists, but we need the panel HTML.
            // Let's inject basic panel structure if missing.
        }
    }

    init() {
        // Find or create panel UI
        this.renderPanel();
        this.bindEvents();
    }

    renderPanel() {
        // Check if panel container exists
        let panel = document.getElementById('geometry-section');
        if (!panel) {
            // Create sidebar panel
            panel = document.createElement('div');
            panel.id = 'geometry-section'; // Matches existing sections
            panel.className = 'panel-section'; // Matches existing CSS
            // panel.hidden = true; // Managed by main.js

            panel.innerHTML = `
                <div class="panel-header">
                    <h3 class="panel-title">Geometry</h3>
                    <button class="icon-btn" id="btn-reset-geometry" title="Reset All" style="background:none; border:none; cursor:pointer;">↺</button>
                </div>
                
                <!-- Upright (Future) -->
                <div class="control-group">
                    <label class="control-label">Upright</label>
                    <div class="btn-group" style="display:flex; gap:5px;">
                        <button class="btn-option active" data-upright="off">Off</button>
                        <button class="btn-option" data-upright="auto" disabled title="Coming Soon">Auto</button>
                        <button class="btn-option" data-upright="guided" disabled title="Coming Soon">Guided</button>
                    </div>
                </div>

                <div class="divider"></div>

                <!-- Transform Sliders -->
                <div class="control-group-header" style="margin-top:10px; margin-bottom:10px; font-weight:bold;">Transform</div>
                
                <div class="control-group">
                    <label class="control-label">Vertical</label>
                    <div class="slider-row">
                        <input type="range" class="slider geo-slider" data-param="vertical" min="-100" max="100" value="0">
                        <span class="slider-value" id="geo-vertical-val">0</span>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">Horizontal</label>
                    <div class="slider-row">
                        <input type="range" class="slider geo-slider" data-param="horizontal" min="-100" max="100" value="0">
                        <span class="slider-value" id="geo-horizontal-val">0</span>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">Rotate</label>
                    <div class="slider-row">
                        <input type="range" class="slider geo-slider" data-param="rotate" min="-45" max="45" step="0.1" value="0">
                        <span class="slider-value" id="geo-rotate-val">0.0</span>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">Aspect</label>
                    <div class="slider-row">
                        <input type="range" class="slider geo-slider" data-param="aspect" min="-100" max="100" value="0">
                        <span class="slider-value" id="geo-aspect-val">0</span>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">Scale</label>
                    <div class="slider-row">
                        <input type="range" class="slider geo-slider" data-param="scale" min="50" max="150" value="100">
                        <span class="slider-value" id="geo-scale-val">100</span>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">X Offset</label>
                    <div class="slider-row">
                        <input type="range" class="slider geo-slider" data-param="xOffset" min="-100" max="100" value="0">
                        <span class="slider-value" id="geo-xOffset-val">0</span>
                    </div>
                </div>

                <div class="control-group">
                    <label class="control-label">Y Offset</label>
                    <div class="slider-row">
                        <input type="range" class="slider geo-slider" data-param="yOffset" min="-100" max="100" value="0">
                        <span class="slider-value" id="geo-yOffset-val">0</span>
                    </div>
                </div>

                <div class="control-group" style="margin-top: 20px;">
                     <label class="checkbox-label">
                        <input type="checkbox" id="geo-constrain-crop">
                        <span>Constrain Crop</span>
                    </label>
                </div>
                
                <div class="panel-actions" style="margin-top:20px;">
                    <button class="btn btn-primary btn-full" id="btn-apply-geometry">Apply Transform</button>
                </div>
            `;

            // Append to .control-panel-content
            const contentContainer = document.querySelector('.control-panel-content');
            if (contentContainer) {
                contentContainer.appendChild(panel);
            } else {
                console.error('GeometryPanel: .control-panel-content not found');
            }
        }
    }

    bindEvents() {
        // Sliders
        const panel = document.getElementById('geometry-section');
        if (!panel) return;

        panel.querySelectorAll('.geo-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const param = slider.dataset.param;
                const val = parseFloat(e.target.value);
                this.params[param] = val;

                // Update Label
                const label = document.getElementById(`geo-${param}-val`);
                if (label) label.textContent = val;

                this.triggerUpdate();
            });

            // Double click reset
            slider.addEventListener('dblclick', () => {
                const param = slider.dataset.param;
                const def = param === 'scale' ? 100 : 0;
                slider.value = def;
                this.params[param] = def;
                const label = document.getElementById(`geo-${param}-val`);
                if (label) label.textContent = def;
                this.triggerUpdate();
            });
        });

        // Constrain Crop
        document.getElementById('geo-constrain-crop')?.addEventListener('change', (e) => {
            // TODO: Implement constrain crop logic (likely checking bounds)
            // For now, trigger update to re-evaluate
            this.triggerUpdate();
        });

        // Reset All
        document.getElementById('btn-reset-geometry')?.addEventListener('click', () => {
            this.resetAll();
        });

        // Apply (Commit to history?)
        document.getElementById('btn-apply-geometry')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-apply-geometry');
            const originalText = btn.textContent;
            btn.textContent = 'Applying...';
            btn.disabled = true;

            try {
                // 1. Compute Matrix
                const matrix = GeometryMath.createHomography(this.params);

                // 2. Commit to Proxy
                const newProxy = await this.app.imageProcessor.commitHomography(matrix);

                if (newProxy) {
                    // Update App State (this triggers CanvasManager update)
                    // Note: imageProcessor.proxy is already updated, but we need to tell App
                    // that the "Current Image" has changed.

                    // Actually, getting newProxy returns object with {element, canvas, ...}
                    // We should update app state.image to this new proxy
                    this.app.setState({
                        image: newProxy
                    });

                    this.app.components.canvas.setImage(newProxy);
                    this.app.pushHistory(); // Add to undo stack

                    // 3. Reset Sliders (since transform is now baked)
                    this.resetAll();
                }

            } catch (err) {
                console.error('Geometry Apply Failed:', err);
                alert('Failed to apply transform.');
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });
    }

    triggerUpdate() {
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(() => {
            this.updateEngine();
        }, 32); // ~30fps cap
    }

    async updateEngine() {
        // 1. Compute Matrix
        const matrix = GeometryMath.createHomography(this.params);

        // 2. Get Processing Context
        const processor = this.app.imageProcessor;
        const proxy = processor.proxy;
        if (!proxy) return;

        // 3. Apply Transform
        // Note: applyHomography returns a canvas
        const resultCanvas = processor.applyHomography(proxy, matrix);

        // 4. Update View
        // Pass a proper image object with canvas property
        this.app.components.canvas.setImage({
            canvas: resultCanvas,
            element: resultCanvas,
            width: resultCanvas.width,
            height: resultCanvas.height
        });
    }

    resetAll() {
        this.params = {
            vertical: 0, horizontal: 0, rotate: 0,
            aspect: 0, scale: 100, xOffset: 0, yOffset: 0
        };

        const panel = document.getElementById('geometry-section');
        if (panel) {
            panel.querySelectorAll('.geo-slider').forEach(slider => {
                const param = slider.dataset.param;
                const def = param === 'scale' ? 100 : 0;
                slider.value = def;
                const label = document.getElementById(`geo-${param}-val`);
                if (label) label.textContent = def;
            });
            const constrain = document.getElementById('geo-constrain-crop');
            if (constrain) constrain.checked = false;
        }

        this.triggerUpdate();
    }

    activate() {
        this.active = true;
        // Visibility is handled by main.js toggling .panel-section hidden attribute
        // We might want to trigger an initial update here if needed
    }

    deactivate() {
        this.active = false;
        // Visibility is handled by main.js
    }
}
