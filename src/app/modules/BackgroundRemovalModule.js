/**
 * BackgroundRemovalModule - AI-powered background removal tool
 * 
 * Handles:
 * - Background removal using 851-labs/background-remover API
 * - Background replacement options (transparent, solid, gradient, custom image)
 * - Preview and apply workflow
 */

import { replicateService } from '../../services/ReplicateService.js';

export class BackgroundRemovalModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.gpu = editor.gpu;
        this.elements = editor.elements;
        this.history = editor.history;

        // Replicate service reference
        this.replicate = replicateService;

        // State
        this.removedBgImage = null;  // Image with transparent background
        this.originalImage = null;   // Original image backup
        this.selectedBackground = 'transparent';
        this.customColor = '#ffffff';
        this.customGradient = { start: '#ff6b6b', end: '#4ecdc4', angle: 135 };
        this.uploadedBackground = null;
        this.isProcessing = false;

        // Transform state for the extracted object
        this.transform = {
            x: 0,           // X position offset
            y: 0,           // Y position offset
            scale: 1,       // Scale factor
            rotation: 0     // Rotation in degrees
        };

        // Interaction state
        this.isDragging = false;
        this.isResizing = false;
        this.isRotating = false;
        this.dragStart = { x: 0, y: 0 };
        this.activeHandle = null;

        // Overlay canvas for interaction
        this.overlayCanvas = null;
        this.overlayCtx = null;
    }

    /**
     * Initialize background removal controls
     */
    init() {
        // Remove Background button
        document.getElementById('btn-remove-background')?.addEventListener('click', () => this.removeBackground());

        // Background option buttons
        document.querySelectorAll('.bg-option-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const bgType = btn.dataset.bg;
                this._selectBackgroundOption(bgType, btn);
            });
        });

        // Cancel button
        document.getElementById('btn-bg-remove-cancel')?.addEventListener('click', () => this.cancel());

        // Apply button
        document.getElementById('btn-bg-remove-apply')?.addEventListener('click', () => this.apply());

        // Transform control sliders
        document.getElementById('bg-scale-slider')?.addEventListener('input', (e) => {
            this.transform.scale = parseFloat(e.target.value);
            document.getElementById('bg-scale-value').textContent = `${Math.round(this.transform.scale * 100)}%`;
            this._showPreview();
        });

        document.getElementById('bg-rotation-slider')?.addEventListener('input', (e) => {
            this.transform.rotation = parseFloat(e.target.value);
            document.getElementById('bg-rotation-value').textContent = `${this.transform.rotation}°`;
            this._showPreview();
        });

        document.getElementById('btn-bg-reset-transform')?.addEventListener('click', () => this._resetTransform());

        console.log('🎭 BackgroundRemovalModule initialized');
    }

    /**
     * Create the transform overlay canvas
     */
    _createOverlayCanvas() {
        // Remove existing overlay if any
        this._removeOverlayCanvas();

        const canvasContainer = document.querySelector('.canvas-container');
        if (!canvasContainer) return;

        // Create overlay canvas
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.id = 'bg-transform-overlay';
        this.overlayCanvas.width = this.gpu.width;
        this.overlayCanvas.height = this.gpu.height;
        this.overlayCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: auto;
            cursor: move;
            z-index: 100;
        `;
        canvasContainer.appendChild(this.overlayCanvas);
        this.overlayCtx = this.overlayCanvas.getContext('2d');

        // Create bound event handlers (stored for proper removal)
        this._boundMouseDown = (e) => this._onMouseDown(e);
        this._boundMouseMove = (e) => this._onMouseMove(e);
        this._boundMouseUp = (e) => this._onMouseUp(e);

        // Bind mouse events using stored references
        this.overlayCanvas.addEventListener('mousedown', this._boundMouseDown);
        this.overlayCanvas.addEventListener('mousemove', this._boundMouseMove);
        this.overlayCanvas.addEventListener('mouseup', this._boundMouseUp);
        this.overlayCanvas.addEventListener('mouseleave', this._boundMouseUp);

        console.log('🎭 Transform overlay created');
    }

    /**
     * Remove the overlay canvas
     */
    _removeOverlayCanvas() {
        if (this.overlayCanvas) {
            // Remove event listeners first
            this.overlayCanvas.removeEventListener('mousedown', this._boundMouseDown);
            this.overlayCanvas.removeEventListener('mousemove', this._boundMouseMove);
            this.overlayCanvas.removeEventListener('mouseup', this._boundMouseUp);
            this.overlayCanvas.removeEventListener('mouseleave', this._boundMouseUp);

            // Remove from DOM
            this.overlayCanvas.remove();
            this.overlayCanvas = null;
            this.overlayCtx = null;
            console.log('🎭 Transform overlay removed');
        }
    }

    /**
     * Mouse down handler for transform
     */
    _onMouseDown(e) {
        if (!this.removedBgImage) return;

        const rect = this.overlayCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (this.overlayCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (this.overlayCanvas.height / rect.height);

        // Check if clicking on rotation handle
        const handle = this._hitTestHandles(x, y);
        if (handle === 'rotate') {
            this.isRotating = true;
            this.overlayCanvas.style.cursor = 'grabbing';
        } else if (handle) {
            this.isResizing = true;
            this.activeHandle = handle;
            this.overlayCanvas.style.cursor = 'nwse-resize';
        } else {
            // Start dragging
            this.isDragging = true;
            this.overlayCanvas.style.cursor = 'grabbing';
        }

        this.dragStart = { x, y };
    }

    /**
     * Mouse move handler for transform
     */
    _onMouseMove(e) {
        if (!this.removedBgImage || !this.overlayCanvas) return;

        const rect = this.overlayCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (this.overlayCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (this.overlayCanvas.height / rect.height);

        if (this.isDragging) {
            const dx = x - this.dragStart.x;
            const dy = y - this.dragStart.y;
            this.transform.x += dx;
            this.transform.y += dy;
            this.dragStart = { x, y };
            this._showPreview();
        } else if (this.isResizing) {
            const centerX = this.overlayCanvas.width / 2 + this.transform.x;
            const centerY = this.overlayCanvas.height / 2 + this.transform.y;
            const startDist = Math.hypot(this.dragStart.x - centerX, this.dragStart.y - centerY);
            const currentDist = Math.hypot(x - centerX, y - centerY);
            const scaleFactor = currentDist / startDist;
            this.transform.scale = Math.max(0.1, Math.min(3, this.transform.scale * scaleFactor));
            this.dragStart = { x, y };

            // Update slider
            const slider = document.getElementById('bg-scale-slider');
            if (slider) slider.value = this.transform.scale;
            const valueEl = document.getElementById('bg-scale-value');
            if (valueEl) valueEl.textContent = `${Math.round(this.transform.scale * 100)}%`;

            this._showPreview();
        } else if (this.isRotating) {
            const centerX = this.overlayCanvas.width / 2 + this.transform.x;
            const centerY = this.overlayCanvas.height / 2 + this.transform.y;
            const startAngle = Math.atan2(this.dragStart.y - centerY, this.dragStart.x - centerX);
            const currentAngle = Math.atan2(y - centerY, x - centerX);
            const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);
            this.transform.rotation += deltaAngle;
            this.dragStart = { x, y };

            // Update slider
            const slider = document.getElementById('bg-rotation-slider');
            if (slider) slider.value = this.transform.rotation % 360;
            const valueEl = document.getElementById('bg-rotation-value');
            if (valueEl) valueEl.textContent = `${Math.round(this.transform.rotation)}°`;

            this._showPreview();
        } else {
            // Update cursor based on hover
            const handle = this._hitTestHandles(x, y);
            if (handle === 'rotate') {
                this.overlayCanvas.style.cursor = 'crosshair';
            } else if (handle) {
                this.overlayCanvas.style.cursor = 'nwse-resize';
            } else {
                this.overlayCanvas.style.cursor = 'move';
            }
        }
    }

    /**
     * Mouse up handler
     */
    _onMouseUp(e) {
        const wasInteracting = this.isDragging || this.isResizing || this.isRotating;

        this.isDragging = false;
        this.isResizing = false;
        this.isRotating = false;
        this.activeHandle = null;

        if (this.overlayCanvas) {
            this.overlayCanvas.style.cursor = 'move';
            // Clear overlay so GPU canvas is visible
            if (this.overlayCtx) {
                this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            }
        }

        // If we were interacting, force GPU update now
        if (wasInteracting) {
            clearTimeout(this._gpuUpdateTimer);
            this._showPreview();
        }
    }

    /**
     * Hit test for transform handles
     */
    _hitTestHandles(x, y) {
        if (!this.removedBgImage) return null;

        const imgWidth = this.removedBgImage.width * this.transform.scale;
        const imgHeight = this.removedBgImage.height * this.transform.scale;
        const centerX = this.overlayCanvas.width / 2 + this.transform.x;
        const centerY = this.overlayCanvas.height / 2 + this.transform.y;

        const handleSize = 15;
        const handles = [
            { name: 'nw', x: centerX - imgWidth / 2, y: centerY - imgHeight / 2 },
            { name: 'ne', x: centerX + imgWidth / 2, y: centerY - imgHeight / 2 },
            { name: 'sw', x: centerX - imgWidth / 2, y: centerY + imgHeight / 2 },
            { name: 'se', x: centerX + imgWidth / 2, y: centerY + imgHeight / 2 },
            { name: 'rotate', x: centerX, y: centerY - imgHeight / 2 - 30 }
        ];

        for (const handle of handles) {
            if (Math.abs(x - handle.x) < handleSize && Math.abs(y - handle.y) < handleSize) {
                return handle.name;
            }
        }
        return null;
    }

    /**
     * Reset transform to default
     */
    _resetTransform() {
        this.transform = { x: 0, y: 0, scale: 1, rotation: 0 };

        // Update sliders
        const scaleSlider = document.getElementById('bg-scale-slider');
        if (scaleSlider) scaleSlider.value = 1;
        const scaleValue = document.getElementById('bg-scale-value');
        if (scaleValue) scaleValue.textContent = '100%';

        const rotSlider = document.getElementById('bg-rotation-slider');
        if (rotSlider) rotSlider.value = 0;
        const rotValue = document.getElementById('bg-rotation-value');
        if (rotValue) rotValue.textContent = '0°';

        this._showPreview();
    }

    /**
     * Remove background from current image using AI
     */
    async removeBackground() {
        if (!this.state.hasImage) {
            alert('Please load an image first.');
            return;
        }

        if (!this.replicate.hasApiToken()) {
            alert('Please enter your Replicate API token in Settings.');
            return;
        }

        if (this.isProcessing) return;

        const btn = document.getElementById('btn-remove-background');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span> Removing...';
        btn.disabled = true;
        this.isProcessing = true;

        try {
            // Backup original image
            this.originalImage = this._getCurrentImage();

            // Capture current image as data URL
            // Use the original image from state, NOT the WebGPU canvas (which can't be read directly)
            const sourceImage = this.state.originalImage;
            if (!sourceImage) {
                throw new Error('No image loaded');
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = sourceImage.width;
            tempCanvas.height = sourceImage.height;
            const ctx = tempCanvas.getContext('2d');

            // Fill with white background first (in case source has transparency)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            // Draw the actual image data (not from GPU canvas)
            ctx.drawImage(sourceImage, 0, 0);

            // Export as PNG and convert to octet-stream format as per Replicate docs
            const pngDataUrl = tempCanvas.toDataURL('image/png');

            // Convert to the format Replicate expects: data:application/octet-stream;base64,...
            // Extract base64 data and re-wrap with correct MIME type
            const base64Data = pngDataUrl.split(',')[1];
            const imageDataUrl = `data:application/octet-stream;base64,${base64Data}`;

            console.log('🎭 Image format: PNG as octet-stream, base64 length:', base64Data.length);

            console.log('🎭 Sending to background removal API...');
            const resultUrl = await this.replicate.removeBackground(imageDataUrl);

            console.log('🎭 Background removal result received:', resultUrl);

            // Fetch the result image via proxy to bypass CORS
            let imageDataForLoad;
            if (typeof resultUrl === 'string' && resultUrl.startsWith('http')) {
                // Fetch the image via our proxy to bypass CORS
                imageDataForLoad = await this.replicate.fetchImageAsDataUrl(resultUrl);
            } else {
                imageDataForLoad = resultUrl;
            }

            // Load the result image (transparent PNG)
            this.removedBgImage = await this._loadImageAsync(imageDataForLoad);

            console.log('🎭 Loaded image dimensions:', this.removedBgImage.width, 'x', this.removedBgImage.height);

            // Reset transform for new image
            this._resetTransform();

            // Create overlay canvas for interactive transforms
            this._createOverlayCanvas();

            // Show preview with selected background
            this._showPreview();

            // Enable background options
            this._enableBackgroundOptions(true);

            btn.innerHTML = '✅ Done! Select background';

            // Reset button after 3 seconds
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 3000);

        } catch (error) {
            console.error('Background removal failed:', error);
            alert(`Background removal failed: ${error.message}`);
            btn.innerHTML = originalText;
        } finally {
            btn.disabled = false;
            this.isProcessing = false;
        }
    }

    /**
     * Get current canvas as image
     */
    _getCurrentImage() {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.gpu.width;
        tempCanvas.height = this.gpu.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(this.elements.canvas, 0, 0);

        const img = new Image();
        img.src = tempCanvas.toDataURL('image/png');
        return img;
    }

    /**
     * Select a background option
     */
    _selectBackgroundOption(bgType, btn) {
        if (!this.removedBgImage) {
            alert('Please remove the background first.');
            return;
        }

        // Update button states
        document.querySelectorAll('.bg-option-btn').forEach(b => {
            b.style.border = '1px solid var(--border)';
        });
        btn.style.border = '2px solid var(--accent)';

        this.selectedBackground = bgType;

        // Toggle checkerboard background for transparency indication
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            if (bgType === 'transparent') {
                canvasContainer.classList.add('transparency-bg');
            } else {
                canvasContainer.classList.remove('transparency-bg');
            }
        }

        // Handle custom color/gradient selection
        if (bgType === 'custom') {
            this._showColorPicker();
        } else if (bgType === 'gradient') {
            this._showGradientPicker();
        } else if (bgType === 'upload') {
            this._showUploadDialog();
        }

        // Update preview
        this._showPreview();
    }

    /**
     * Show preview with selected background
     */
    _showPreview() {
        if (!this.removedBgImage) return;

        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = this.gpu.width;
        previewCanvas.height = this.gpu.height;
        const ctx = previewCanvas.getContext('2d');

        // Draw background first
        switch (this.selectedBackground) {
            case 'transparent':
                // Draw checkerboard pattern to show transparency
                this._drawCheckerboard(ctx, previewCanvas.width, previewCanvas.height);
                break;

            case 'white':
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
                break;

            case 'black':
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
                break;

            case 'custom':
                ctx.fillStyle = this.customColor;
                ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
                break;

            case 'gradient':
                const gradient = ctx.createLinearGradient(0, 0, previewCanvas.width, previewCanvas.height);
                gradient.addColorStop(0, this.customGradient.start);
                gradient.addColorStop(1, this.customGradient.end);
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
                break;

            case 'upload':
                if (this.uploadedBackground) {
                    ctx.drawImage(this.uploadedBackground, 0, 0, previewCanvas.width, previewCanvas.height);
                }
                break;
        }

        // Draw the foreground (removed background image) with transforms
        const imgWidth = this.removedBgImage.width;
        const imgHeight = this.removedBgImage.height;
        const centerX = previewCanvas.width / 2 + this.transform.x;
        const centerY = previewCanvas.height / 2 + this.transform.y;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(this.transform.rotation * Math.PI / 180);
        ctx.scale(this.transform.scale, this.transform.scale);
        ctx.drawImage(
            this.removedBgImage,
            -imgWidth / 2,
            -imgHeight / 2,
            imgWidth,
            imgHeight
        );
        ctx.restore();

        // Draw transform handles for visual feedback
        this._drawTransformHandles(ctx, centerX, centerY, imgWidth * this.transform.scale, imgHeight * this.transform.scale);

        // During interactive transforms (drag/resize/rotate), render to overlay canvas
        // The WebGPU canvas doesn't support getContext('2d'), so we use the overlay
        if (this.isDragging || this.isResizing || this.isRotating) {
            // Draw to overlay canvas for immediate feedback
            if (this.overlayCanvas && this.overlayCtx) {
                this.overlayCanvas.width = previewCanvas.width;
                this.overlayCanvas.height = previewCanvas.height;
                this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
                this.overlayCtx.drawImage(previewCanvas, 0, 0);
            }

            // Debounce the GPU update
            clearTimeout(this._gpuUpdateTimer);
            this._gpuUpdateTimer = setTimeout(() => {
                if (!this.isDragging && !this.isResizing && !this.isRotating) {
                    this._updateGPUCanvas(previewCanvas);
                    // Clear overlay after GPU is updated
                    if (this.overlayCtx) {
                        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
                    }
                }
            }, 100);
        } else {
            // Not actively transforming - update GPU immediately  
            this._updateGPUCanvas(previewCanvas);
        }
    }

    /**
     * Update GPU canvas with preview image
     */
    _updateGPUCanvas(previewCanvas) {
        const previewImage = new Image();
        previewImage.onload = () => {
            this.gpu.loadImage(previewImage);
        };
        previewImage.src = previewCanvas.toDataURL('image/png');
    }

    /**
     * Draw transform handles on the preview
     */
    _drawTransformHandles(ctx, centerX, centerY, width, height) {
        const handleSize = 8;
        const handleColor = '#00aaff';
        const lineColor = 'rgba(0, 170, 255, 0.5)';

        // Draw bounding box
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
            centerX - width / 2,
            centerY - height / 2,
            width,
            height
        );
        ctx.setLineDash([]);

        // Draw corner handles
        const handles = [
            { x: centerX - width / 2, y: centerY - height / 2 },
            { x: centerX + width / 2, y: centerY - height / 2 },
            { x: centerX - width / 2, y: centerY + height / 2 },
            { x: centerX + width / 2, y: centerY + height / 2 }
        ];

        ctx.fillStyle = handleColor;
        handles.forEach(h => {
            ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        });

        // Draw rotation handle
        const rotHandleY = centerY - height / 2 - 30;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - height / 2);
        ctx.lineTo(centerX, rotHandleY);
        ctx.strokeStyle = lineColor;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, rotHandleY, handleSize, 0, Math.PI * 2);
        ctx.fillStyle = '#ff6b6b';
        ctx.fill();
    }

    /**
     * Draw checkerboard pattern for transparency preview
     */
    _drawCheckerboard(ctx, width, height) {
        const size = 16;
        for (let y = 0; y < height; y += size) {
            for (let x = 0; x < width; x += size) {
                ctx.fillStyle = ((x + y) / size) % 2 === 0 ? '#ffffff' : '#cccccc';
                ctx.fillRect(x, y, size, size);
            }
        }
    }

    /**
     * Show color picker for custom background
     */
    _showColorPicker() {
        // Create a simple color input
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.customColor;
        colorInput.style.position = 'absolute';
        colorInput.style.visibility = 'hidden';
        document.body.appendChild(colorInput);

        colorInput.addEventListener('input', (e) => {
            this.customColor = e.target.value;
            // Update the custom button color
            const customBtn = document.querySelector('[data-bg="custom"]');
            if (customBtn) {
                customBtn.style.background = this.customColor;
            }
            this._showPreview();
        });

        colorInput.addEventListener('change', () => {
            document.body.removeChild(colorInput);
        });

        colorInput.click();
    }

    /**
     * Show gradient picker
     */
    _showGradientPicker() {
        // For now, use a simple prompt - could be enhanced with a modal
        const start = prompt('Enter start color (hex):', this.customGradient.start);
        if (start) this.customGradient.start = start;

        const end = prompt('Enter end color (hex):', this.customGradient.end);
        if (end) this.customGradient.end = end;

        this._showPreview();
    }

    /**
     * Show upload dialog for custom background
     */
    _showUploadDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        this.uploadedBackground = img;
                        this._showPreview();
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            }
        });

        input.click();
    }

    /**
     * Enable/disable background options
     */
    _enableBackgroundOptions(enabled) {
        document.querySelectorAll('.bg-option-btn').forEach(btn => {
            btn.disabled = !enabled;
            btn.style.opacity = enabled ? '1' : '0.5';
            btn.style.pointerEvents = enabled ? 'auto' : 'none';
        });

        const applyBtn = document.getElementById('btn-bg-remove-apply');
        if (applyBtn) {
            applyBtn.disabled = !enabled;
        }
    }

    /**
     * Apply the background removal result
     */
    async apply() {
        if (!this.removedBgImage) {
            alert('Please remove the background first.');
            return;
        }

        try {
            // Save state for undo
            clearTimeout(this.editor._historyDebounceTimer);
            const snapshot = this.editor._captureFullState();
            this.history.pushState(snapshot);

            // Create final image with selected background
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = this.gpu.width;
            finalCanvas.height = this.gpu.height;
            const ctx = finalCanvas.getContext('2d');

            // Draw background
            switch (this.selectedBackground) {
                case 'transparent':
                    // Keep transparent
                    break;

                case 'white':
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
                    break;

                case 'black':
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
                    break;

                case 'custom':
                    ctx.fillStyle = this.customColor;
                    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
                    break;

                case 'gradient':
                    const gradient = ctx.createLinearGradient(0, 0, finalCanvas.width, finalCanvas.height);
                    gradient.addColorStop(0, this.customGradient.start);
                    gradient.addColorStop(1, this.customGradient.end);
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
                    break;

                case 'upload':
                    if (this.uploadedBackground) {
                        ctx.drawImage(this.uploadedBackground, 0, 0, finalCanvas.width, finalCanvas.height);
                    }
                    break;
            }

            // Draw foreground with transforms
            const imgWidth = this.removedBgImage.width;
            const imgHeight = this.removedBgImage.height;
            const centerX = finalCanvas.width / 2 + this.transform.x;
            const centerY = finalCanvas.height / 2 + this.transform.y;

            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(this.transform.rotation * Math.PI / 180);
            ctx.scale(this.transform.scale, this.transform.scale);
            ctx.drawImage(
                this.removedBgImage,
                -imgWidth / 2,
                -imgHeight / 2,
                imgWidth,
                imgHeight
            );
            ctx.restore();

            // Load final image
            const finalImage = await this._loadImageAsync(finalCanvas.toDataURL('image/png'));

            // Update state and GPU
            this.state.setImage(finalImage);
            this.gpu.loadImage(finalImage);
            this.state.originalImage = finalImage;

            // Update histogram
            setTimeout(() => this.editor.renderHistogram(), 100);

            // Detect and show transparency if applying transparent background
            if (this.editor._detectAndShowTransparency) {
                this.editor._detectAndShowTransparency(finalImage);
            }

            // Reset module state (but don't remove checkerboard - that's handled above)
            this._reset();

            // Switch back to develop mode
            this.editor.setMode('develop');

            console.log('✅ Background removal applied successfully');

        } catch (error) {
            console.error('Failed to apply background removal:', error);
            alert(`Failed to apply: ${error.message}`);
        }
    }

    /**
     * Cancel and revert
     */
    cancel() {
        if (this.originalImage) {
            this.gpu.loadImage(this.originalImage);
        }
        this._reset();
        this.editor.setMode('develop');
    }

    /**
     * Deactivate the module (called when switching to another mode)
     */
    deactivate() {
        // Remove overlay canvas
        this._removeOverlayCanvas();

        // Clear any pending GPU update timers
        clearTimeout(this._gpuUpdateTimer);

        // Reset interaction state
        this.isDragging = false;
        this.isResizing = false;
        this.isRotating = false;
    }

    /**
     * Reset module state
     */
    _reset() {
        this.removedBgImage = null;
        this.originalImage = null;
        this.selectedBackground = 'transparent';
        this.uploadedBackground = null;
        this._enableBackgroundOptions(false);

        // Remove overlay canvas so other tools can work
        this._removeOverlayCanvas();

        // Remove checkerboard background only if image doesn't have transparency
        // (transparency detection sets this flag after apply)
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer && !this.state.hasTransparency) {
            canvasContainer.classList.remove('transparency-bg');
        }

        // Reset transform
        this.transform = { x: 0, y: 0, scale: 1, rotation: 0 };

        // Reset sliders
        const scaleSlider = document.getElementById('bg-scale-slider');
        if (scaleSlider) scaleSlider.value = 1;
        const scaleValue = document.getElementById('bg-scale-value');
        if (scaleValue) scaleValue.textContent = '100%';
        const rotSlider = document.getElementById('bg-rotation-slider');
        if (rotSlider) rotSlider.value = 0;
        const rotValue = document.getElementById('bg-rotation-value');
        if (rotValue) rotValue.textContent = '0°';

        // Reset button states
        document.querySelectorAll('.bg-option-btn').forEach((btn, index) => {
            btn.style.border = index === 0 ? '2px solid var(--accent)' : '1px solid var(--border)';
        });
    }

    /**
     * Helper to load image as async/await
     * Fetches as blob first to bypass CORS restrictions
     */
    async _loadImageAsync(src) {
        // If it's already a data URL, load directly
        if (src.startsWith('data:')) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = src;
            });
        }

        // For remote URLs, fetch as blob first to bypass CORS
        console.log('🎭 Fetching image as blob to bypass CORS...');
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            const dataUrl = await this._blobToDataUrl(blob);
            console.log('🎭 Converted to data URL, length:', dataUrl.length);

            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = dataUrl;
            });
        } catch (error) {
            console.error('🎭 Blob fetch failed, trying direct load:', error);
            // Fallback to direct load
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = src;
            });
        }
    }

    /**
     * Convert blob to data URL
     */
    _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}
