/**
 * HealingModule - AI-powered healing and restoration tool
 * 
 * Handles:
 * - Healing tool initialization and controls
 * - Brush-based mask painting
 * - AI inpainting via LaMa model
 * - Face enhancement via GFPGAN
 * - Background removal via rembg
 * - API token management
 */

import { HealingTool } from '../../tools/HealingTool.js';
import { replicateService } from '../../services/ReplicateService.js';

export class HealingModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.gpu = editor.gpu;
        this.elements = editor.elements;
        this.history = editor.history;

        // Healing tool instance
        this.healingTool = null;
        this.healingCanvas = null;
        this.healingBrushCursor = null;
        this.healedImage = null;

        // Replicate service reference
        this.replicate = replicateService;

        // Event handlers (stored for cleanup)
        this._healingMouseDown = null;
        this._healingMouseMove = null;
        this._healingMouseUp = null;
    }

    /**
     * Initialize healing controls
     */
    init() {
        // Create healing canvas (overlay on main canvas)
        this.healingCanvas = document.createElement('canvas');
        this.healingCanvas.style.cssText = `
            position: absolute;
            pointer-events: none;
            display: none;
        `;
        this.elements.canvas.parentElement.appendChild(this.healingCanvas);

        // Window resize listener to keep overlay synced with main canvas
        window.addEventListener('resize', () => {
            if (this.healingCanvas && this.healingCanvas.style.display !== 'none') {
                this._syncOverlayPosition();
            }
        });

        // Create healing tool instance
        this.healingTool = new HealingTool(this.healingCanvas);

        // Load saved API token
        const tokenInput = document.getElementById('replicate-api-token');
        if (tokenInput && this.replicate.hasApiToken()) {
            tokenInput.value = this.replicate.getApiToken();
            const status = document.getElementById('api-status');
            if (status) {
                status.textContent = '✅ Token loaded from storage';
                status.style.color = 'var(--accent)';
            }
        }

        // API Token input
        tokenInput?.addEventListener('change', () => {
            this.replicate.setApiToken(tokenInput.value);
            const status = document.getElementById('api-status');
            if (status) {
                status.textContent = '💾 Token saved';
                status.style.color = 'var(--accent)';
            }
        });

        // Test API button
        document.getElementById('btn-test-api')?.addEventListener('click', async () => {
            const status = document.getElementById('api-status');
            if (status) {
                status.textContent = '🔄 Testing connection...';
                status.style.color = 'var(--text-secondary)';
            }

            const result = await this.replicate.testConnection();
            if (status) {
                if (result.success) {
                    status.textContent = '✅ Connection successful!';
                    status.style.color = 'var(--accent)';
                } else {
                    status.textContent = `❌ ${result.error}`;
                    status.style.color = 'var(--text-error)';
                }
            }
        });

        // Size slider
        const sizeSlider = document.getElementById('healing-size');
        const sizeValue = document.getElementById('healing-size-value');
        sizeSlider?.addEventListener('input', () => {
            const size = parseInt(sizeSlider.value);
            this.healingTool.setBrushSize(size);
            if (sizeValue) sizeValue.textContent = `${size}px`;
            this._updateBrushCursor();
        });

        // Hardness slider
        const hardnessSlider = document.getElementById('healing-hardness');
        const hardnessValue = document.getElementById('healing-hardness-value');
        hardnessSlider?.addEventListener('input', () => {
            const hardness = parseInt(hardnessSlider.value);
            this.healingTool.setBrushHardness(hardness / 100);
            if (hardnessValue) hardnessValue.textContent = `${hardness}%`;
        });

        // Heal button
        document.getElementById('btn-heal')?.addEventListener('click', () => this.performHealing());

        // Clear mask button
        document.getElementById('btn-clear-mask')?.addEventListener('click', () => {
            this.healingTool.clearMask();
            this._renderPreview();
        });

        // Apply button
        document.getElementById('btn-healing-apply')?.addEventListener('click', () => this.applyHealing());

        // Cancel button
        document.getElementById('btn-healing-cancel')?.addEventListener('click', () => {
            this.healingTool.reset();
            this.deactivate();
            this.editor.setMode('develop');
        });

        // Face enhance button
        document.getElementById('btn-enhance-face')?.addEventListener('click', () => this.enhanceFace());

        // Remove background button
        document.getElementById('btn-remove-bg')?.addEventListener('click', () => this.removeBackground());
    }

    /**
     * Keep overlay canvas in exact alignment and size with main GPU canvas
     */
    _syncOverlayPosition() {
        const canvas = this.elements.canvas;
        if (!canvas || !this.healingCanvas) return;
        this.healingCanvas.style.position = 'absolute';
        this.healingCanvas.style.left = `${canvas.offsetLeft}px`;
        this.healingCanvas.style.top = `${canvas.offsetTop}px`;
        this.healingCanvas.style.width = `${canvas.offsetWidth}px`;
        this.healingCanvas.style.height = `${canvas.offsetHeight}px`;
    }

    /**
     * Activate healing tool
     */
    activate() {
        if (!this.state.hasImage) return;

        // Show healing canvas
        this.healingCanvas.style.display = 'block';
        this.healingCanvas.style.pointerEvents = 'auto';

        // Position overlay canvas directly over the main canvas
        this._syncOverlayPosition();
        this.healingCanvas.width = this.gpu.width;
        this.healingCanvas.height = this.gpu.height;

        // Create 2D canvas copy (prefer clean originalImage so adjustments are not doubled)
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = this.gpu.width;
        sourceCanvas.height = this.gpu.height;
        const sourceCtx = sourceCanvas.getContext('2d');

        if (this.state.originalImage) {
            sourceCtx.drawImage(this.state.originalImage, 0, 0, this.gpu.width, this.gpu.height);
        } else {
            const imageData = this.gpu.toImageData();
            if (imageData) sourceCtx.putImageData(imageData, 0, 0);
        }

        // Set the image to heal
        this.healingTool.setImage(sourceCanvas);

        // Create healing brush cursor if it doesn't exist
        if (!this.healingBrushCursor) {
            this.healingBrushCursor = document.createElement('div');
            this.healingBrushCursor.className = 'healing-brush-cursor';
            this.healingBrushCursor.style.cssText = `
                position: fixed;
                pointer-events: none;
                border: 2px solid rgba(255, 100, 100, 0.8);
                border-radius: 50%;
                z-index: 10000;
                display: none;
                box-shadow: 0 0 10px rgba(255, 100, 100, 0.3);
            `;
            document.body.appendChild(this.healingBrushCursor);
        }
        this.healingBrushCursor.style.display = 'block';
        this._updateBrushCursor();

        // Add mouse event listeners
        this._healingMouseDown = (e) => {
            const rect = this.healingCanvas.getBoundingClientRect();
            const scaleX = this.healingTool.imageWidth / rect.width;
            const scaleY = this.healingTool.imageHeight / rect.height;
            const rawX = (e.clientX - rect.left) * scaleX;
            const rawY = (e.clientY - rect.top) * scaleY;
            const x = Math.max(0, Math.min(this.healingTool.imageWidth, rawX));
            const y = Math.max(0, Math.min(this.healingTool.imageHeight, rawY));
            this.healingTool.onMouseDown(x, y);
            this._renderPreview();
        };

        this._healingMouseMove = (e) => {
            // Update cursor position
            if (this.healingBrushCursor) {
                const size = this.healingTool.brushSize;
                const rect = this.healingCanvas.getBoundingClientRect();
                const scale = rect.width / this.healingTool.imageWidth;
                const displaySize = size * scale;
                this.healingBrushCursor.style.width = displaySize + 'px';
                this.healingBrushCursor.style.height = displaySize + 'px';
                this.healingBrushCursor.style.left = (e.clientX - displaySize / 2) + 'px';
                this.healingBrushCursor.style.top = (e.clientY - displaySize / 2) + 'px';
            }

            const rect = this.healingCanvas.getBoundingClientRect();
            const scaleX = this.healingTool.imageWidth / rect.width;
            const scaleY = this.healingTool.imageHeight / rect.height;
            const rawX = (e.clientX - rect.left) * scaleX;
            const rawY = (e.clientY - rect.top) * scaleY;
            const x = Math.max(0, Math.min(this.healingTool.imageWidth, rawX));
            const y = Math.max(0, Math.min(this.healingTool.imageHeight, rawY));
            this.healingTool.onMouseMove(x, y);

            if (this.healingTool.isDrawing) {
                this._renderPreview();
            }
        };

        this._healingMouseUp = () => {
            this.healingTool.onMouseUp();
        };

        this._healingTouchStart = (e) => {
            if (e.touches.length === 1) {
                if (e.cancelable) e.preventDefault();
                this._healingMouseDown(e.touches[0]);
            }
        };
        this._healingTouchMove = (e) => {
            if (e.touches.length === 1) {
                if (e.cancelable) e.preventDefault();
                this._healingMouseMove(e.touches[0]);
            }
        };
        this._healingTouchEnd = (e) => {
            if (e.cancelable) e.preventDefault();
            this._healingMouseUp();
        };

        this.healingCanvas.addEventListener('mousedown', this._healingMouseDown);
        this.healingCanvas.addEventListener('mousemove', this._healingMouseMove);
        this.healingCanvas.addEventListener('mouseup', this._healingMouseUp);
        this.healingCanvas.addEventListener('mouseleave', this._healingMouseUp);
        this.healingCanvas.addEventListener('touchstart', this._healingTouchStart, { passive: false });
        this.healingCanvas.addEventListener('touchmove', this._healingTouchMove, { passive: false });
        this.healingCanvas.addEventListener('touchend', this._healingTouchEnd, { passive: false });

        // Initial render
        this._renderPreview();

    }

    /**
     * Deactivate healing tool
     */
    deactivate() {
        if (this.healingCanvas) {
            this.healingCanvas.style.display = 'none';
            this.healingCanvas.style.pointerEvents = 'none';

            // Clear canvas content to prevent overlap
            const ctx = this.healingCanvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, this.healingCanvas.width, this.healingCanvas.height);
            }

            // Remove event listeners
            if (this._healingMouseDown) {
                this.healingCanvas.removeEventListener('mousedown', this._healingMouseDown);
                this.healingCanvas.removeEventListener('mousemove', this._healingMouseMove);
                this.healingCanvas.removeEventListener('mouseup', this._healingMouseUp);
                this.healingCanvas.removeEventListener('mouseleave', this._healingMouseUp);
            }
            if (this._healingTouchStart) {
                this.healingCanvas.removeEventListener('touchstart', this._healingTouchStart);
                this.healingCanvas.removeEventListener('touchmove', this._healingTouchMove);
                this.healingCanvas.removeEventListener('touchend', this._healingTouchEnd);
            }
        }

        // Hide cursor
        if (this.healingBrushCursor) {
            this.healingBrushCursor.style.display = 'none';
        }

    }

    /**
     * Update healing brush cursor size
     */
    _updateBrushCursor() {
        if (!this.healingBrushCursor || !this.healingTool) return;
        const size = this.healingTool.brushSize;
        const rect = this.healingCanvas?.getBoundingClientRect();
        if (!rect) return;
        const scale = rect.width / (this.healingTool.imageWidth || 1);
        const displaySize = size * scale;
        this.healingBrushCursor.style.width = displaySize + 'px';
        this.healingBrushCursor.style.height = displaySize + 'px';
    }

    /**
     * Render healing preview with mask overlay
     */
    _renderPreview() {
        if (!this.healingTool) return;
        const previewCanvas = this.healingTool.getPreviewCanvas();
        const ctx = this.healingCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.healingCanvas.width, this.healingCanvas.height);
        ctx.drawImage(previewCanvas, 0, 0, this.healingCanvas.width, this.healingCanvas.height);
    }

    /**
     * Perform AI healing using LaMa
     */
    async performHealing() {
        const btn = document.getElementById('btn-heal');
        if (btn?.disabled) {
            alert('AI Spot Healing is currently down for scheduled maintenance.');
            return;
        }

        if (!this.healingTool.hasMaskDrawn()) {
            alert('Please paint over the area you want to heal first.');
            return;
        }

        if (!this.replicate.hasApiToken()) {
            alert('Please enter your Replicate API token first.');
            return;
        }

        const originalText = btn.textContent;
        btn.textContent = '⏳ Healing...';
        btn.disabled = true;

        try {
            const imageDataUrl = this.healingTool.getImageDataUrl();
            const maskDataUrl = this.healingTool.getMaskDataUrl();

            // Store original alpha channel before sending to API
            const originalAlpha = this._extractAlphaChannel();

            const result = await this.replicate.inpaint(imageDataUrl, maskDataUrl);

            if (!result) {
                throw new Error('No result received from API');
            }


            // Load the result image
            const healedImg = await this._loadImageAsync(result);

            // Restore original alpha channel (LaMa doesn't preserve transparency)
            this.healedImage = await this._restoreAlphaChannel(healedImg, originalAlpha);

            // Show result on canvas
            const ctx = this.healingCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.healingCanvas.width, this.healingCanvas.height);
            ctx.drawImage(this.healedImage, 0, 0, this.healingCanvas.width, this.healingCanvas.height);

            // Clear the mask
            this.healingTool.clearMask();

            btn.textContent = '✅ Done! Click Apply';

        } catch (error) {
            console.error('Healing failed:', error);
            alert(`Healing failed: ${error.message}`);
            btn.textContent = originalText;

            // Re-render the preview to show the original image (don't lose the image)
            this._renderPreview();
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * Extract alpha channel from current image
     */
    _extractAlphaChannel() {
        const imageData = this.gpu.toImageData();
        if (!imageData) return null;

        const alpha = new Uint8Array(imageData.width * imageData.height);
        for (let i = 0; i < alpha.length; i++) {
            alpha[i] = imageData.data[i * 4 + 3];
        }
        return { alpha, width: imageData.width, height: imageData.height };
    }

    /**
     * Restore alpha channel to healed image
     */
    async _restoreAlphaChannel(healedImg, originalAlpha) {
        if (!originalAlpha) return healedImg;

        const canvas = document.createElement('canvas');
        canvas.width = originalAlpha.width;
        canvas.height = originalAlpha.height;
        const ctx = canvas.getContext('2d');

        // Draw healed image
        ctx.drawImage(healedImg, 0, 0, canvas.width, canvas.height);

        // Restore alpha channel
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < originalAlpha.alpha.length; i++) {
            imageData.data[i * 4 + 3] = originalAlpha.alpha[i];
        }
        ctx.putImageData(imageData, 0, 0);

        // Convert back to image - wait for it to load
        return await this._loadImageAsync(canvas.toDataURL('image/png'));
    }

    /**
     * Apply healed result to main canvas
     */
    async applyHealing() {
        if (!this.healedImage && this.healingTool.hasMaskDrawn()) {
            await this.performHealing();
        }

        if (!this.healedImage) {
            alert('No healed image to apply. Please paint over the area to heal.');
            return;
        }

        try {
            // Clear debounce and save state for undo
            clearTimeout(this.editor._historyDebounceTimer);
            const snapshot = this.editor._captureFullState();
            this.history.pushState(snapshot);

            // Update state and GPU
            this.state.setImage(this.healedImage);
            this.gpu.loadImage(this.healedImage);
            this.state.originalImage = this.healedImage;

            // Clear healed image reference
            this.healedImage = null;

            // Update histogram
            setTimeout(() => this.editor.renderHistogram(), 100);

            // Detect and preserve transparency (checkerboard background)
            if (this.editor._detectAndShowTransparency) {
                this.editor._detectAndShowTransparency(this.state.originalImage);
            }

            // Visual toast confirmation
            this.editor.showToast?.('Healing applied');

            // Hide the healing overlay canvas so GPU canvas is visible
            if (this.healingCanvas) {
                const ctx = this.healingCanvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, this.healingCanvas.width, this.healingCanvas.height);
                }
            }

            // Reinitialize healing tool with new image for next use
            // Prefer clean originalImage so adjustments are not doubled
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = this.gpu.width;
            sourceCanvas.height = this.gpu.height;
            const sourceCtx = sourceCanvas.getContext('2d');

            if (this.state.originalImage) {
                sourceCtx.drawImage(this.state.originalImage, 0, 0, this.gpu.width, this.gpu.height);
            } else {
                const imageData = this.gpu.toImageData();
                if (imageData) sourceCtx.putImageData(imageData, 0, 0);
            }
            this.healingTool.setImage(sourceCanvas);
            this.healingTool.clearMask();


        } catch (error) {
            console.error('Failed to apply healing:', error);
        }
    }

    /**
     * Enhance face using GFPGAN
     */
    async enhanceFace() {
        if (!this.state.hasImage) return;

        if (!this.replicate.hasApiToken()) {
            alert('Please enter your Replicate API token first.');
            return;
        }

        const btn = document.getElementById('btn-enhance-face');
        const originalText = btn.textContent;
        btn.textContent = '⏳ Enhancing...';
        btn.disabled = true;

        try {
            // Capture current image from clean originalImage or gpu.toImageData() (Law 7)
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.gpu.width;
            tempCanvas.height = this.gpu.height;
            const ctx = tempCanvas.getContext('2d');
            if (this.state.originalImage) {
                ctx.drawImage(this.state.originalImage, 0, 0, this.gpu.width, this.gpu.height);
            } else {
                const imageData = this.gpu.toImageData();
                if (imageData) ctx.putImageData(imageData, 0, 0);
            }
            const imageDataUrl = tempCanvas.toDataURL('image/png');

            const result = await this.replicate.enhanceFace(imageDataUrl);


            // Save state for undo
            clearTimeout(this.editor._historyDebounceTimer);
            const snapshot = this.editor._captureFullState();
            this.history.pushState(snapshot);

            // Load and apply the result
            const enhancedImage = await this._loadImageAsync(result);
            this.state.setImage(enhancedImage);
            this.gpu.loadImage(enhancedImage);
            this.state.originalImage = enhancedImage;

            // Update UI
            setTimeout(() => this.editor.renderHistogram(), 100);

            btn.textContent = '✅ Enhanced!';
            setTimeout(() => { btn.textContent = originalText; }, 2000);

        } catch (error) {
            console.error('Face enhancement failed:', error);
            alert(`Face enhancement failed: ${error.message}`);
            btn.textContent = originalText;
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * Remove background using rembg
     */
    async removeBackground() {
        if (!this.state.hasImage) return;

        if (!this.replicate.hasApiToken()) {
            alert('Please enter your Replicate API token first.');
            return;
        }

        const btn = document.getElementById('btn-remove-bg');
        const originalText = btn.textContent;
        btn.textContent = '⏳ Removing...';
        btn.disabled = true;

        try {
            // Capture current image from clean originalImage or gpu.toImageData() (Law 7)
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.gpu.width;
            tempCanvas.height = this.gpu.height;
            const ctx = tempCanvas.getContext('2d');
            if (this.state.originalImage) {
                ctx.drawImage(this.state.originalImage, 0, 0, this.gpu.width, this.gpu.height);
            } else {
                const imageData = this.gpu.toImageData();
                if (imageData) ctx.putImageData(imageData, 0, 0);
            }
            const imageDataUrl = tempCanvas.toDataURL('image/png');

            const result = await this.replicate.removeBackground(imageDataUrl);


            // Save state for undo
            clearTimeout(this.editor._historyDebounceTimer);
            const snapshot = this.editor._captureFullState();
            this.history.pushState(snapshot);

            // Load and apply the result
            const resultImage = await this._loadImageAsync(result);
            this.state.setImage(resultImage);
            this.gpu.loadImage(resultImage);
            this.state.originalImage = resultImage;

            // Update UI
            setTimeout(() => this.editor.renderHistogram(), 100);

            btn.textContent = '✅ Removed!';
            setTimeout(() => { btn.textContent = originalText; }, 2000);

        } catch (error) {
            console.error('Background removal failed:', error);
            alert(`Background removal failed: ${error.message}`);
            btn.textContent = originalText;
        } finally {
            btn.disabled = false;
        }
    }

    /**
     * Helper to load image as async/await
     */
    _loadImageAsync(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            // Required for cross-origin images with COEP headers
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }
}
