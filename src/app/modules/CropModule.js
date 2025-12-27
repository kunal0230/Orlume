/**
 * CropModule - Crop and Transform functionality
 * 
 * Handles:
 * - Crop tool initialization and controls
 * - Aspect ratio selection
 * - Rotation with preview
 * - Flip horizontal/vertical
 * - Crop apply/cancel
 */

import { CropTool } from '../../tools/CropTool.js';

export class CropModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.gpu = editor.gpu;
        this.masks = editor.masks;
        this.elements = editor.elements;
        this.history = editor.history;

        // Crop tool instance
        this.cropTool = null;

        // Applied crop state (persists across mode changes)
        this.appliedCrop = null;

        // Transform states
        this.cropRotation = 0;
        this.cropFlipH = false;
        this.cropFlipV = false;
    }

    /**
     * Initialize crop controls
     */
    init() {
        // Aspect ratio buttons
        document.querySelectorAll('.aspect-ratio-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                document.querySelectorAll('.aspect-ratio-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Set aspect ratio on crop tool
                const ratioStr = btn.dataset.ratio;
                let ratio = null;

                if (ratioStr === '1:1') ratio = 1;
                else if (ratioStr === '4:3') ratio = 4 / 3;
                else if (ratioStr === '3:2') ratio = 3 / 2;
                else if (ratioStr === '16:9') ratio = 16 / 9;
                else if (ratioStr === '2:1') ratio = 2;
                else if (ratioStr === '5:4') ratio = 5 / 4;
                else if (ratioStr === '9:16') ratio = 9 / 16;
                else if (ratioStr === '2:3') ratio = 2 / 3;
                // 'free' = null

                this.cropTool?.setAspectRatio(ratio);
            });
        });

        // Grid toggle
        const gridToggle = document.getElementById('crop-grid-toggle');
        if (gridToggle) {
            gridToggle.addEventListener('change', () => {
                this.cropTool?.toggleGrid(gridToggle.checked);
            });
        }

        // Apply crop button
        const btnApply = document.getElementById('btn-crop-apply');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.applyCrop());
        }

        // Cancel crop button
        const btnCancel = document.getElementById('btn-crop-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => this.cancelCrop());
        }

        // Editable dimensions input
        this._initCropDimensionsInput();

        // Rotation slider - with real-time preview
        const rotationSlider = document.getElementById('slider-crop-rotation');
        const rotationValue = document.getElementById('val-crop-rotation');
        if (rotationSlider && rotationValue) {
            rotationSlider.addEventListener('input', () => {
                const angle = parseFloat(rotationSlider.value);
                rotationValue.textContent = `${angle}°`;
                this.cropRotation = angle;
                this._applyTransformPreview();
                // Sync crop overlay with canvas rotation
                this.cropTool?.setRotation(angle);
            });

            rotationSlider.addEventListener('dblclick', () => {
                rotationSlider.value = 0;
                rotationValue.textContent = '0°';
                this.cropRotation = 0;
                this._applyTransformPreview();
                this.cropTool?.setRotation(0);
            });
        }

        // Rotation increment/decrement buttons for accessibility
        const btnRotateMinus = document.getElementById('btn-rotate-minus');
        const btnRotatePlus = document.getElementById('btn-rotate-plus');

        const updateRotation = (delta) => {
            if (!rotationSlider || !rotationValue) return;
            let newValue = parseFloat(rotationSlider.value) + delta;
            // Clamp to slider bounds
            newValue = Math.max(-180, Math.min(180, newValue));
            rotationSlider.value = newValue;
            rotationValue.textContent = `${newValue}°`;
            this.cropRotation = newValue;
            this._applyTransformPreview();
            this.cropTool?.setRotation(newValue);
        };

        if (btnRotateMinus) {
            btnRotateMinus.addEventListener('click', () => updateRotation(-1));
        }

        if (btnRotatePlus) {
            btnRotatePlus.addEventListener('click', () => updateRotation(1));
        }

        // Flip buttons - with real-time preview
        const btnFlipH = document.getElementById('btn-flip-h');
        const btnFlipV = document.getElementById('btn-flip-v');

        if (btnFlipH) {
            btnFlipH.addEventListener('click', () => {
                this.cropFlipH = !this.cropFlipH;
                btnFlipH.classList.toggle('active', this.cropFlipH);
                this._applyTransformPreview();
            });
        }

        if (btnFlipV) {
            btnFlipV.addEventListener('click', () => {
                this.cropFlipV = !this.cropFlipV;
                btnFlipV.classList.toggle('active', this.cropFlipV);
                this._applyTransformPreview();
            });
        }

        // Reset transform button - with real-time preview
        const btnReset = document.getElementById('btn-reset-transform');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                // Reset rotation
                if (rotationSlider) {
                    rotationSlider.value = 0;
                    rotationValue.textContent = '0°';
                }
                this.cropRotation = 0;

                // Reset flips
                this.cropFlipH = false;
                this.cropFlipV = false;
                btnFlipH?.classList.remove('active');
                btnFlipV?.classList.remove('active');

                this._applyTransformPreview();
                this.cropTool?.setRotation(0);
            });
        }
    }

    /**
     * Apply real-time CSS transform preview for rotation and flip
     */
    _applyTransformPreview() {
        const canvas = this.elements.canvas;
        if (!canvas) return;

        const transforms = [];

        // Apply rotation
        if (this.cropRotation && this.cropRotation !== 0) {
            transforms.push(`rotate(${this.cropRotation}deg)`);
        }

        // Apply flip
        const scaleX = this.cropFlipH ? -1 : 1;
        const scaleY = this.cropFlipV ? -1 : 1;
        if (scaleX !== 1 || scaleY !== 1) {
            transforms.push(`scale(${scaleX}, ${scaleY})`);
        }

        canvas.style.transform = transforms.length > 0 ? transforms.join(' ') : '';
        canvas.style.transformOrigin = 'center center';
    }

    /**
     * Clear transform preview (reset CSS transform)
     */
    _clearTransformPreview() {
        const canvas = this.elements.canvas;
        if (canvas) {
            canvas.style.transform = '';
        }
    }

    /**
     * Initialize editable crop dimensions input
     */
    _initCropDimensionsInput() {
        const display = document.getElementById('crop-dimensions-display');
        const input = document.getElementById('crop-dimensions-input');

        if (!display || !input) return;

        // Click on display to show input
        display.addEventListener('click', () => {
            if (!this.cropTool) return;

            const pixels = this.cropTool.getCropPixels();
            input.value = `${pixels.width}x${pixels.height}`;
            display.style.display = 'none';
            input.style.display = 'block';
            input.focus();
            input.select();
        });

        // Handle input submission
        const applyCustomDimensions = () => {
            const value = input.value.trim();
            // Parse formats: "800x600", "800*600", "800 600"
            const match = value.match(/^(\d+)\s*[x×*\s]\s*(\d+)$/i);

            if (match) {
                const width = parseInt(match[1]);
                const height = parseInt(match[2]);

                if (width > 0 && height > 0 && this.cropTool) {
                    this.cropTool.setCustomDimensions(width, height);
                }
            }

            // Hide input, show display
            input.style.display = 'none';
            display.style.display = 'inline';
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyCustomDimensions();
            } else if (e.key === 'Escape') {
                input.style.display = 'none';
                display.style.display = 'inline';
            }
        });

        input.addEventListener('blur', () => {
            // Hide input on blur
            input.style.display = 'none';
            display.style.display = 'inline';
        });
    }

    /**
     * Activate crop tool and show overlay
     */
    activate() {
        if (!this.state.hasImage) {
            console.warn('No image loaded for cropping');
            return;
        }

        // Create crop tool if not exists
        if (!this.cropTool) {
            const canvasArea = document.querySelector('.canvas-area');
            this.cropTool = new CropTool(canvasArea, this.elements.canvas);
        }

        // Activate with callback for dimension updates
        this.cropTool.onUpdate = () => {
            this._updateCropDimensionsDisplay();
        };

        this.cropTool.activate();
        this._updateCropDimensionsDisplay();
    }

    /**
     * Deactivate crop tool
     */
    deactivate() {
        this.cropTool?.deactivate();
    }

    /**
     * Apply crop to image
     */
    applyCrop() {
        if (!this.cropTool) return;

        // Save state BEFORE crop for undo support
        const snapshot = this.editor._captureFullState();
        this.history.pushState(snapshot);

        const cropData = this.cropTool.apply();
        if (!cropData || cropData.width <= 0 || cropData.height <= 0) {
            console.warn('Invalid crop region');
            return;
        }

        // Store the crop data for export
        this.appliedCrop = cropData;

        // Add rotation and flip data
        cropData.rotation = this.cropRotation || 0;
        cropData.flipH = this.cropFlipH || false;
        cropData.flipV = this.cropFlipV || false;

        // Apply the crop to the image
        this._performCrop(cropData);

        // Stay in crop mode - don't switch to develop mode
        // The crop tool will be reactivated after the image is loaded

        console.log(`✅ Crop applied: ${cropData.width}×${cropData.height}${cropData.rotation ? ` @ ${cropData.rotation}°` : ''}`);
    }

    /**
     * Cancel crop and reset (stay in crop mode)
     */
    cancelCrop() {
        this.cropTool?.cancel();

        // Reset rotation and flip UI
        const rotationSlider = document.getElementById('slider-crop-rotation');
        const rotationValue = document.getElementById('val-crop-rotation');
        if (rotationSlider && rotationValue) {
            rotationSlider.value = 0;
            rotationValue.textContent = '0°';
        }
        this.cropRotation = 0;
        this.cropFlipH = false;
        this.cropFlipV = false;
        document.getElementById('btn-flip-h')?.classList.remove('active');
        document.getElementById('btn-flip-v')?.classList.remove('active');

        // Clear real-time transform preview
        this._clearTransformPreview();

        // Reactivate crop tool instead of switching mode
        if (this.state.hasImage) {
            this.cropTool?.activate();
            this._updateCropDimensionsDisplay();
        }
    }

    /**
     * Perform the actual crop operation with rotation and flip
     */
    _performCrop(cropData) {
        // Read current canvas pixels using backend-agnostic method
        const fullWidth = this.gpu.width;
        const fullHeight = this.gpu.height;

        // Use the abstracted toImageData() which works for both WebGL2 and WebGPU
        const imageData = this.gpu.toImageData();
        if (!imageData) {
            console.error('Failed to read canvas data for crop');
            return;
        }

        // Create canvas from ImageData
        const fullTempCanvas = document.createElement('canvas');
        fullTempCanvas.width = fullWidth;
        fullTempCanvas.height = fullHeight;
        const fullTempCtx = fullTempCanvas.getContext('2d');
        fullTempCtx.putImageData(imageData, 0, 0);

        // Calculate output dimensions based on rotation
        const radians = (cropData.rotation || 0) * Math.PI / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));

        // If rotated, the bounding box changes
        let outputWidth, outputHeight;
        if (cropData.rotation && cropData.rotation !== 0) {
            outputWidth = Math.ceil(cropData.width * cos + cropData.height * sin);
            outputHeight = Math.ceil(cropData.height * cos + cropData.width * sin);
        } else {
            outputWidth = cropData.width;
            outputHeight = cropData.height;
        }

        // Create output canvas with proper dimensions
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = outputWidth;
        outputCanvas.height = outputHeight;
        const outputCtx = outputCanvas.getContext('2d');

        // Apply transformations
        outputCtx.save();
        outputCtx.translate(outputWidth / 2, outputHeight / 2);

        // Apply rotation
        if (cropData.rotation) {
            outputCtx.rotate(radians);
        }

        // Apply flip
        const scaleX = cropData.flipH ? -1 : 1;
        const scaleY = cropData.flipV ? -1 : 1;
        outputCtx.scale(scaleX, scaleY);

        // Draw cropped region centered
        outputCtx.drawImage(
            fullTempCanvas,
            cropData.x, cropData.y, cropData.width, cropData.height,
            -cropData.width / 2, -cropData.height / 2, cropData.width, cropData.height
        );
        outputCtx.restore();

        // Create new image from output canvas and reload
        const croppedImage = new Image();
        croppedImage.onload = () => {
            // Update state
            this.state.setImage(croppedImage);

            // Reload GPU processor with cropped image
            this.gpu.loadImage(croppedImage);

            // Clear any masks (they no longer align)
            this.masks.layers = [];
            this.masks.activeLayerIndex = -1;
            this.editor.updateLayersList();

            // Update UI
            this.elements.perfIndicator.textContent = `${croppedImage.width}×${croppedImage.height}`;
            setTimeout(() => this.editor.renderHistogram(), 100);

            // Clear applied crop (it's been applied)
            this.appliedCrop = null;

            // Reset rotation and flip UI after successful crop
            const rotationSlider = document.getElementById('slider-crop-rotation');
            const rotationValue = document.getElementById('val-crop-rotation');
            if (rotationSlider && rotationValue) {
                rotationSlider.value = 0;
                rotationValue.textContent = '0°';
            }
            this.cropRotation = 0;
            this.cropFlipH = false;
            this.cropFlipV = false;
            document.getElementById('btn-flip-h')?.classList.remove('active');
            document.getElementById('btn-flip-v')?.classList.remove('active');

            // Clear CSS transform preview (rotation/flip is now baked into image)
            this._clearTransformPreview();

            // Reactivate crop tool for the new image (stay in crop mode)
            setTimeout(() => {
                if (this.state.currentTool === 'crop') {
                    this.cropTool?.deactivate();
                    this.activate();
                }
            }, 150);
        };
        croppedImage.src = outputCanvas.toDataURL('image/png');
    }

    /**
     * Update crop dimensions display in panel
     */
    _updateCropDimensionsDisplay() {
        const display = document.getElementById('crop-dimensions-display');
        if (display && this.cropTool) {
            const pixels = this.cropTool.getCropPixels();
            display.textContent = `${pixels.width} × ${pixels.height}`;
        }
    }
}
