/**
 * CloneModule - Clone stamp tool integration for editor
 * 
 * Handles:
 * - Clone tool initialization and controls
 * - Alt+Click for source selection
 * - Mouse event handling for clone painting
 * - Brush cursor and source indicator overlay
 * - Apply/reset clone edits
 */

import { CloneTool } from '../../tools/CloneTool.js';

export class CloneModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.gpu = editor.gpu;
        this.elements = editor.elements;
        this.history = editor.history;

        // Clone tool instance
        this.cloneTool = null;
        this.cloneCanvas = null;
        this.cloneBrushCursor = null;
        this.sourceCrosshair = null;

        // Event handlers (stored for cleanup)
        this._cloneMouseDown = null;
        this._cloneMouseMove = null;
        this._cloneMouseUp = null;
        this._cloneKeyDown = null;
        this._cloneKeyUp = null;

        // Alt key state
        this.altPressed = false;
    }

    /**
     * Initialize clone controls and create overlay canvas
     */
    init() {
        // Create canvas for clone (overlay on main canvas)
        this.cloneCanvas = document.createElement('canvas');
        this.cloneCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            display: none;
        `;
        this.elements.canvas.parentElement.appendChild(this.cloneCanvas);

        // Create clone tool instance
        this.cloneTool = new CloneTool(this.cloneCanvas);

        // Size slider
        const sizeSlider = document.getElementById('clone-size');
        const sizeValue = document.getElementById('clone-size-value');
        if (sizeSlider) {
            sizeSlider.addEventListener('input', () => {
                const size = parseInt(sizeSlider.value);
                this.cloneTool.setBrushSize(size);
                if (sizeValue) sizeValue.textContent = `${size}px`;
                this._updateBrushCursor();
            });
        }

        // Hardness slider
        const hardnessSlider = document.getElementById('clone-hardness');
        const hardnessValue = document.getElementById('clone-hardness-value');
        if (hardnessSlider) {
            hardnessSlider.addEventListener('input', () => {
                const hardness = parseInt(hardnessSlider.value);
                this.cloneTool.setBrushHardness(hardness / 100);
                if (hardnessValue) hardnessValue.textContent = `${hardness}%`;
            });
        }

        // Opacity slider
        const opacitySlider = document.getElementById('clone-opacity');
        const opacityValue = document.getElementById('clone-opacity-value');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', () => {
                const opacity = parseInt(opacitySlider.value);
                this.cloneTool.setBrushOpacity(opacity / 100);
                if (opacityValue) opacityValue.textContent = `${opacity}%`;
            });
        }

        // Aligned toggle
        const alignedToggle = document.getElementById('clone-aligned');
        if (alignedToggle) {
            alignedToggle.addEventListener('change', () => {
                this.cloneTool.setAligned(alignedToggle.checked);
            });
        }

        // Reset Source button
        const btnResetSource = document.getElementById('btn-clone-reset-source');
        if (btnResetSource) {
            btnResetSource.addEventListener('click', () => {
                this.cloneTool.resetSource();
                this._updateSourceIndicator();
            });
        }

        // Apply button
        const btnApply = document.getElementById('btn-clone-apply');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.apply());
        }

        // Cancel button
        const btnCancel = document.getElementById('btn-clone-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                this.cloneTool.reset();
                this.deactivate();
                this.editor.setMode('develop');
            });
        }
    }

    /**
     * Activate clone tool
     */
    activate() {
        if (!this.state.hasImage) return;

        // Show clone canvas
        this.cloneCanvas.style.display = 'block';
        this.cloneCanvas.style.pointerEvents = 'auto';

        // Position canvas over the main canvas
        const rect = this.elements.canvas.getBoundingClientRect();
        this.cloneCanvas.style.width = rect.width + 'px';
        this.cloneCanvas.style.height = rect.height + 'px';

        // Set the image to clone - need to copy from GPU to a 2D canvas
        const imageData = this.gpu.toImageData();
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = this.gpu.width;
        sourceCanvas.height = this.gpu.height;
        const sourceCtx = sourceCanvas.getContext('2d');
        sourceCtx.putImageData(imageData, 0, 0);
        this.cloneTool.setImage(sourceCanvas);

        // Create clone brush cursor if it doesn't exist
        if (!this.cloneBrushCursor) {
            this.cloneBrushCursor = document.createElement('div');
            this.cloneBrushCursor.className = 'clone-brush-cursor';
            this.cloneBrushCursor.style.cssText = `
                position: fixed;
                pointer-events: none;
                border: 2px solid rgba(200, 100, 255, 0.8);
                border-radius: 50%;
                z-index: 10000;
                display: none;
                box-shadow: 0 0 10px rgba(200, 100, 255, 0.3);
            `;
            document.body.appendChild(this.cloneBrushCursor);
        }
        this.cloneBrushCursor.style.display = 'block';
        this._updateBrushCursor();

        // Create source crosshair indicator
        if (!this.sourceCrosshair) {
            this.sourceCrosshair = document.createElement('div');
            this.sourceCrosshair.className = 'clone-source-crosshair';
            this.sourceCrosshair.style.cssText = `
                position: fixed;
                pointer-events: none;
                width: 30px;
                height: 30px;
                z-index: 10001;
                display: none;
            `;
            this.sourceCrosshair.innerHTML = `
                <svg width="30" height="30" viewBox="0 0 30 30">
                    <circle cx="15" cy="15" r="5" fill="none" stroke="cyan" stroke-width="2"/>
                    <line x1="0" y1="15" x2="10" y2="15" stroke="cyan" stroke-width="2"/>
                    <line x1="20" y1="15" x2="30" y2="15" stroke="cyan" stroke-width="2"/>
                    <line x1="15" y1="0" x2="15" y2="10" stroke="cyan" stroke-width="2"/>
                    <line x1="15" y1="20" x2="15" y2="30" stroke="cyan" stroke-width="2"/>
                </svg>
            `;
            document.body.appendChild(this.sourceCrosshair);
        }

        // Add mouse event listeners
        this._cloneMouseDown = (e) => {
            const rect = this.cloneCanvas.getBoundingClientRect();
            const scaleX = this.cloneTool.imageWidth / rect.width;
            const scaleY = this.cloneTool.imageHeight / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;

            if (this.altPressed) {
                // Set source point
                this.cloneTool.setSource(x, y);
                this._updateSourceIndicator();
            } else {
                // Start cloning
                this.cloneTool.onMouseDown(x, y);
            }
        };

        this._cloneMouseMove = (e) => {
            // Update cursor position
            if (this.cloneBrushCursor) {
                const size = this.cloneTool.brushSize;
                const rect = this.cloneCanvas.getBoundingClientRect();
                const scaleX = rect.width / this.cloneTool.imageWidth;
                const displaySize = size * scaleX;

                this.cloneBrushCursor.style.width = displaySize + 'px';
                this.cloneBrushCursor.style.height = displaySize + 'px';
                this.cloneBrushCursor.style.left = (e.clientX - displaySize / 2) + 'px';
                this.cloneBrushCursor.style.top = (e.clientY - displaySize / 2) + 'px';

                // Change cursor style based on alt key
                if (this.altPressed) {
                    this.cloneBrushCursor.style.borderColor = 'rgba(0, 255, 255, 0.9)';
                    this.cloneBrushCursor.style.borderStyle = 'dashed';
                } else {
                    this.cloneBrushCursor.style.borderColor = 'rgba(200, 100, 255, 0.8)';
                    this.cloneBrushCursor.style.borderStyle = 'solid';
                }
            }

            // Apply clone if dragging
            if (this.cloneTool.isDrawing) {
                const rect = this.cloneCanvas.getBoundingClientRect();
                const scaleX = this.cloneTool.imageWidth / rect.width;
                const scaleY = this.cloneTool.imageHeight / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;
                this.cloneTool.onMouseMove(x, y);
                this._renderPreview();
            }

            // Update source indicator position (follows with offset)
            this._updateSourceIndicator(e.clientX, e.clientY);
        };

        this._cloneMouseUp = () => {
            this.cloneTool.onMouseUp();
            this._renderPreview();
        };

        this._cloneKeyDown = (e) => {
            if (e.key === 'Alt') {
                e.preventDefault();
                this.altPressed = true;
            }
        };

        this._cloneKeyUp = (e) => {
            if (e.key === 'Alt') {
                this.altPressed = false;
            }
        };

        this.cloneCanvas.addEventListener('mousedown', this._cloneMouseDown);
        document.addEventListener('mousemove', this._cloneMouseMove);
        document.addEventListener('mouseup', this._cloneMouseUp);
        document.addEventListener('keydown', this._cloneKeyDown);
        document.addEventListener('keyup', this._cloneKeyUp);

        // Initial render
        this._renderPreview();
    }

    /**
     * Update source indicator position
     */
    _updateSourceIndicator(mouseX, mouseY) {
        if (!this.sourceCrosshair || !this.cloneTool.hasSource()) {
            if (this.sourceCrosshair) {
                this.sourceCrosshair.style.display = 'none';
            }
            return;
        }

        const sourcePos = this.cloneTool.getSourcePosition();
        if (!sourcePos) {
            this.sourceCrosshair.style.display = 'none';
            return;
        }

        // Convert source position to screen coordinates
        const rect = this.cloneCanvas.getBoundingClientRect();
        const scaleX = rect.width / this.cloneTool.imageWidth;
        const scaleY = rect.height / this.cloneTool.imageHeight;

        const screenX = rect.left + sourcePos.x * scaleX;
        const screenY = rect.top + sourcePos.y * scaleY;

        this.sourceCrosshair.style.display = 'block';
        this.sourceCrosshair.style.left = (screenX - 15) + 'px';
        this.sourceCrosshair.style.top = (screenY - 15) + 'px';
    }

    /**
     * Update clone brush cursor size
     */
    _updateBrushCursor() {
        if (this.cloneBrushCursor && this.cloneTool) {
            const size = this.cloneTool.brushSize;
            const rect = this.cloneCanvas.getBoundingClientRect();
            const scaleX = rect.width / this.cloneTool.imageWidth;
            const displaySize = size * scaleX;
            this.cloneBrushCursor.style.width = displaySize + 'px';
            this.cloneBrushCursor.style.height = displaySize + 'px';
        }
    }

    /**
     * Render clone preview
     */
    _renderPreview() {
        if (!this.cloneTool) return;

        const previewCanvas = this.cloneTool.getPreviewCanvas();

        // Draw preview to clone canvas
        const ctx = this.cloneCanvas.getContext('2d');
        this.cloneCanvas.width = this.cloneTool.imageWidth;
        this.cloneCanvas.height = this.cloneTool.imageHeight;
        ctx.drawImage(previewCanvas, 0, 0);
    }

    /**
     * Deactivate clone tool
     */
    deactivate() {
        // Hide clone canvas
        this.cloneCanvas.style.display = 'none';
        this.cloneCanvas.style.pointerEvents = 'none';

        // Clear canvas content to prevent overlap
        const ctx = this.cloneCanvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, this.cloneCanvas.width, this.cloneCanvas.height);
        }

        // Hide cursor elements
        if (this.cloneBrushCursor) {
            this.cloneBrushCursor.style.display = 'none';
        }
        if (this.sourceCrosshair) {
            this.sourceCrosshair.style.display = 'none';
        }

        // Remove event listeners
        if (this._cloneMouseDown) {
            this.cloneCanvas.removeEventListener('mousedown', this._cloneMouseDown);
        }
        if (this._cloneMouseMove) {
            document.removeEventListener('mousemove', this._cloneMouseMove);
        }
        if (this._cloneMouseUp) {
            document.removeEventListener('mouseup', this._cloneMouseUp);
        }
        if (this._cloneKeyDown) {
            document.removeEventListener('keydown', this._cloneKeyDown);
        }
        if (this._cloneKeyUp) {
            document.removeEventListener('keyup', this._cloneKeyUp);
        }

        this.altPressed = false;
    }

    /**
     * Apply clone changes to the main canvas
     */
    async apply() {
        try {
            // Save state BEFORE clone for undo support
            const snapshot = this.editor._captureFullState();
            console.log('📸 Clone: Capturing state.');
            this.history.pushState(snapshot);

            // Get the result from the clone tool
            const cloneCanvas = this.cloneTool.getResultCanvas();

            // Update the GPU with the new image
            if (this.gpu.width !== cloneCanvas.width || this.gpu.height !== cloneCanvas.height) {
                this.gpu.resize(cloneCanvas.width, cloneCanvas.height);
            }

            // Load the new image into the GPU
            const dataUrl = cloneCanvas.toDataURL('image/png');
            const img = await this._loadImageAsync(dataUrl);

            // Update state with new image
            this.state.setImage(img);

            // Reload GPU processor with new image
            this.gpu.loadImage(img);

            // Store as new original for undo
            this.state.originalImage = img;

            // Update histogram
            setTimeout(() => this.editor.renderHistogram(), 100);

            console.log('✅ Clone applied successfully');

            // Reset clone tool for next use but stay in clone mode
            this.cloneTool.reset();

            // Re-initialize with new image
            if (this.state.currentTool === 'clone') {
                setTimeout(() => this.activate(), 100);
            }

        } catch (error) {
            console.error('Failed to apply clone:', error);
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
