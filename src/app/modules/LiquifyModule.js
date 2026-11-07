/**
 * LiquifyModule - Liquify/Warp tool functionality
 * 
 * Handles:
 * - Liquify tool initialization and controls
 * - Brush modes (push, bloat, pinch, swirl)
 * - Mouse event handling
 * - Brush cursor overlay
 * - Apply/reset liquify edits
 */

import { LiquifyTool } from '../../tools/LiquifyTool.js';

export class LiquifyModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.gpu = editor.gpu;
        this.elements = editor.elements;
        this.history = editor.history;

        // Liquify tool instance
        this.liquifyTool = null;
        this.liquifyCanvas = null;
        this.liquifyBrushCursor = null;

        // Event handlers (stored for cleanup)
        this._liquifyMouseDown = null;
        this._liquifyMouseMove = null;
        this._liquifyMouseUp = null;
    }

    /**
     * Initialize liquify controls and create overlay canvas
     */
    init() {
        // Create canvas for liquify (overlay on main canvas)
        this.liquifyCanvas = document.createElement('canvas');
        this.liquifyCanvas.style.cssText = `
            position: absolute;
            pointer-events: none;
            display: none;
        `;
        this.elements.canvas.parentElement.appendChild(this.liquifyCanvas);

        // Window resize listener to keep overlay synced with main canvas
        window.addEventListener('resize', () => {
            if (this.liquifyCanvas && this.liquifyCanvas.style.display !== 'none') {
                this._syncOverlayPosition();
            }
        });

        // Create liquify tool instance
        this.liquifyTool = new LiquifyTool(this.liquifyCanvas);
        this.liquifyTool.init();

        // Mode buttons
        document.querySelectorAll('.liquify-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.liquify-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const mode = btn.dataset.mode;
                this.liquifyTool.setMode(mode);

                // Update label
                const label = document.getElementById('liquify-mode-label');
                if (label) {
                    label.textContent = mode.toUpperCase().replace('SWIRLRIGHT', 'SWIRL RIGHT').replace('SWIRLLEFT', 'SWIRL LEFT');
                }
            });
        });

        // Size slider
        const sizeSlider = document.getElementById('liquify-size');
        const sizeValue = document.getElementById('liquify-size-value');
        if (sizeSlider) {
            sizeSlider.addEventListener('input', () => {
                const size = parseInt(sizeSlider.value);
                this.liquifyTool.setBrushSize(size);
                if (sizeValue) sizeValue.textContent = `${size}px`;
                this._updateBrushCursor();
            });
        }

        // Strength slider
        const strengthSlider = document.getElementById('liquify-strength');
        const strengthValue = document.getElementById('liquify-strength-value');
        if (strengthSlider) {
            strengthSlider.addEventListener('input', () => {
                const strength = parseInt(strengthSlider.value);
                this.liquifyTool.setBrushStrength(strength / 100);
                if (strengthValue) strengthValue.textContent = `${strength}%`;
            });
        }

        // Density slider
        const densitySlider = document.getElementById('liquify-density');
        const densityValue = document.getElementById('liquify-density-value');
        if (densitySlider) {
            densitySlider.addEventListener('input', () => {
                const density = parseInt(densitySlider.value);
                this.liquifyTool.setBrushDensity(density / 100);
                if (densityValue) densityValue.textContent = `${density}%`;
            });
        }

        // High quality toggle
        const hqToggle = document.getElementById('liquify-high-quality');
        if (hqToggle) {
            hqToggle.addEventListener('change', () => {
                this.liquifyTool.setHighQuality(hqToggle.checked);
            });
        }

        // Reset All button
        const btnReset = document.getElementById('btn-liquify-reset');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.liquifyTool.resetAll();
            });
        }

        // Apply button
        const btnApply = document.getElementById('btn-liquify-apply');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.apply());
        }

        // Cancel button
        const btnCancel = document.getElementById('btn-liquify-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                this.liquifyTool.resetAll();
                this.deactivate();
                this.editor.setMode('develop');
            });
        }
    }

    /**
     * Keep overlay canvas in exact alignment and size with main GPU canvas
     */
    _syncOverlayPosition() {
        const canvas = this.elements.canvas;
        if (!canvas || !this.liquifyCanvas) return;
        this.liquifyCanvas.style.position = 'absolute';
        this.liquifyCanvas.style.left = `${canvas.offsetLeft}px`;
        this.liquifyCanvas.style.top = `${canvas.offsetTop}px`;
        this.liquifyCanvas.style.width = `${canvas.offsetWidth}px`;
        this.liquifyCanvas.style.height = `${canvas.offsetHeight}px`;
    }

    /**
     * Activate liquify tool
     */
    activate() {
        if (!this.state.hasImage) return;

        // Show liquify canvas
        this.liquifyCanvas.style.display = 'block';
        this.liquifyCanvas.style.pointerEvents = 'auto';

        // Position overlay canvas directly over the main canvas
        this._syncOverlayPosition();

        // Capture developed image with all current color grading, curves, and adjustments
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = this.gpu.width;
        sourceCanvas.height = this.gpu.height;
        const sourceCtx = sourceCanvas.getContext('2d');

        const developedData = this.gpu.toImageData();
        if (developedData) {
            sourceCtx.putImageData(developedData, 0, 0);
        } else if (this.state.originalImage) {
            sourceCtx.drawImage(this.state.originalImage, 0, 0, this.gpu.width, this.gpu.height);
        }
        this.liquifyTool.setImage(sourceCanvas);

        // Create liquify brush cursor if it doesn't exist
        if (!this.liquifyBrushCursor) {
            this.liquifyBrushCursor = document.createElement('div');
            this.liquifyBrushCursor.className = 'liquify-brush-cursor';
            this.liquifyBrushCursor.style.cssText = `
                position: fixed;
                pointer-events: none;
                border: 2px solid rgba(0, 180, 255, 0.8);
                border-radius: 50%;
                z-index: 10000;
                display: none;
                box-shadow: 0 0 10px rgba(0, 180, 255, 0.3);
            `;
            document.body.appendChild(this.liquifyBrushCursor);
        }
        this.liquifyBrushCursor.style.display = 'block';
        this._updateBrushCursor();

        // Add mouse event listeners
        this._liquifyMouseDown = (e) => {
            const rect = this.liquifyCanvas.getBoundingClientRect();
            const scaleX = this.liquifyTool.imageWidth / rect.width;
            const scaleY = this.liquifyTool.imageHeight / rect.height;
            const rawX = (e.clientX - rect.left) * scaleX;
            const rawY = (e.clientY - rect.top) * scaleY;
            const x = Math.max(0, Math.min(this.liquifyTool.imageWidth, rawX));
            const y = Math.max(0, Math.min(this.liquifyTool.imageHeight, rawY));
            this.liquifyTool.onMouseDown(x, y);
        };

        this._liquifyMouseMove = (e) => {
            // Update cursor position
            if (this.liquifyBrushCursor) {
                const size = this.liquifyTool.brushSize;
                const rect = this.liquifyCanvas.getBoundingClientRect();
                const scaleX = rect.width / this.liquifyTool.imageWidth;
                const displaySize = size * scaleX;

                this.liquifyBrushCursor.style.width = displaySize + 'px';
                this.liquifyBrushCursor.style.height = displaySize + 'px';
                this.liquifyBrushCursor.style.left = (e.clientX - displaySize / 2) + 'px';
                this.liquifyBrushCursor.style.top = (e.clientY - displaySize / 2) + 'px';
            }

            // Apply liquify if dragging
            if (this.liquifyTool.isDragging) {
                const rect = this.liquifyCanvas.getBoundingClientRect();
                const scaleX = this.liquifyTool.imageWidth / rect.width;
                const scaleY = this.liquifyTool.imageHeight / rect.height;
                const rawX = (e.clientX - rect.left) * scaleX;
                const rawY = (e.clientY - rect.top) * scaleY;
                const x = Math.max(0, Math.min(this.liquifyTool.imageWidth, rawX));
                const y = Math.max(0, Math.min(this.liquifyTool.imageHeight, rawY));
                this.liquifyTool.onMouseMove(x, y);
            }
        };

        this._liquifyMouseUp = () => {
            this.liquifyTool.onMouseUp();
        };

        this.liquifyCanvas.addEventListener('mousedown', this._liquifyMouseDown);
        document.addEventListener('mousemove', this._liquifyMouseMove);
        document.addEventListener('mouseup', this._liquifyMouseUp);
    }

    /**
     * Update liquify brush cursor size
     */
    _updateBrushCursor() {
        if (this.liquifyBrushCursor && this.liquifyTool) {
            const size = this.liquifyTool.brushSize;
            const rect = this.liquifyCanvas.getBoundingClientRect();
            const scaleX = rect.width / this.liquifyTool.imageWidth;
            const displaySize = size * scaleX;
            this.liquifyBrushCursor.style.width = displaySize + 'px';
            this.liquifyBrushCursor.style.height = displaySize + 'px';
        }
    }

    /**
     * Deactivate liquify tool
     */
    deactivate() {
        // Hide liquify canvas
        this.liquifyCanvas.style.display = 'none';
        this.liquifyCanvas.style.pointerEvents = 'none';

        // Clear WebGL2 canvas content to prevent overlap
        const gl = this.liquifyTool?.gl || this.liquifyCanvas.getContext('webgl2');
        if (gl) {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        // Hide brush cursor
        if (this.liquifyBrushCursor) {
            this.liquifyBrushCursor.style.display = 'none';
        }

        // Remove event listeners
        if (this._liquifyMouseDown) {
            this.liquifyCanvas.removeEventListener('mousedown', this._liquifyMouseDown);
        }
        if (this._liquifyMouseMove) {
            document.removeEventListener('mousemove', this._liquifyMouseMove);
        }
        if (this._liquifyMouseUp) {
            document.removeEventListener('mouseup', this._liquifyMouseUp);
        }
    }

    /**
     * Apply liquify changes to the main canvas
     */
    async apply() {
        try {
            // Clear any pending debounced history push to avoid duplicates
            clearTimeout(this.editor._historyDebounceTimer);

            // Save state BEFORE liquify for undo support
            const snapshot = this.editor._captureFullState();
            this.history.pushState(snapshot);

            // Get warped result: warp clean originalImage if available so GPU adjustments re-apply cleanly
            let liquifyCanvas;
            if (this.state.originalImage && typeof this.liquifyTool.getResultWithImage === 'function') {
                liquifyCanvas = this.liquifyTool.getResultWithImage(this.state.originalImage);
            } else {
                liquifyCanvas = this.liquifyTool.getResultCanvas();
            }

            // Create an intermediate 2D canvas to transfer the image
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = liquifyCanvas.width;
            tempCanvas.height = liquifyCanvas.height;
            const tempCtx = tempCanvas.getContext('2d');

            // Draw the WebGL/result canvas onto the 2D canvas
            tempCtx.drawImage(liquifyCanvas, 0, 0);

            // Update the GPU with the new image
            // First, resize the GPU if needed
            if (this.gpu.width !== tempCanvas.width || this.gpu.height !== tempCanvas.height) {
                this.gpu.resize(tempCanvas.width, tempCanvas.height);
            }

            // Load the new image into the GPU - WAIT for it to complete
            const dataUrl = tempCanvas.toDataURL('image/png');
            const img = await this._loadImageAsync(dataUrl);

            // Update state with new image (like crop apply does)
            this.state.setImage(img);

            // Reload GPU processor with new image  
            this.gpu.loadImage(img);

            // Store the image (not ImageData) as new original for undo compatibility
            this.state.originalImage = img;

            // Update histogram
            setTimeout(() => this.editor.renderHistogram(), 100);

            // Detect and preserve transparency (checkerboard background)
            if (this.editor._detectAndShowTransparency) {
                this.editor._detectAndShowTransparency(img);
            }

            // Provide visual feedback
            this.editor.showToast?.('Liquify warp applied');

            // Reset liquify tool for next use but stay in liquify mode
            this.liquifyTool.resetAll();

            // Re-initialize the liquify tool with the new image
            if (this.state.currentTool === 'liquify') {
                this.deactivate();
                this.activate();
            }

        } catch (error) {
            console.error('Failed to apply liquify:', error);
        }
    }

    /**
     * Helper to load image as async/await
     */
    _loadImageAsync(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }
}
