/**
 * ResolutionManager.js - v8 Relighting System
 * 
 * Manages image resolution to optimize performance and quality.
 * Max supported: 4K (3840×2160) - models don't benefit from higher.
 * 
 * Key features:
 * - Auto-detect oversized images
 * - Multi-step high-quality downsampling
 * - User permission modal for resize
 * - "Don't ask again" preference
 */

export class ResolutionManager {
    constructor(options = {}) {
        this.MAX_WIDTH = options.maxWidth || 3840;
        this.MAX_HEIGHT = options.maxHeight || 2160;
        this.MAX_PIXELS = this.MAX_WIDTH * this.MAX_HEIGHT; // 8.3MP

        // User preferences
        this.autoResize = localStorage.getItem('relight_autoResize4K') === 'true';

        // UI callbacks
        this.onModalShow = options.onModalShow || null;
        this.onModalHide = options.onModalHide || null;
    }

    /**
     * Check if image needs resizing and handle it
     * @param {HTMLImageElement|ImageBitmap} image - Input image
     * @param {Object} options - Options
     * @returns {Promise<{image: HTMLImageElement, wasResized: boolean, originalDimensions: Object}>}
     */
    async checkAndResize(image, options = {}) {
        const { width, height } = this._getImageDimensions(image);
        const pixels = width * height;

        const result = {
            image: image,
            wasResized: false,
            originalDimensions: { width, height, pixels }
        };

        // Check if resize needed
        if (pixels <= this.MAX_PIXELS &&
            width <= this.MAX_WIDTH &&
            height <= this.MAX_HEIGHT) {
            console.log(`✓ Image size OK: ${width}×${height} (${(pixels / 1e6).toFixed(1)}MP)`);
            return result;
        }

        // Image too large
        console.warn(`⚠ Image too large: ${width}×${height} (${(pixels / 1e6).toFixed(1)}MP)`);

        // Calculate target dimensions (preserve aspect ratio)
        const targetDims = this._calculateTargetSize(width, height);

        // Check auto-resize preference
        if (!this.autoResize && !options.forceResize) {
            const userChoice = await this._requestUserPermission(
                width, height,
                targetDims.width, targetDims.height
            );

            if (userChoice.cancelled) {
                throw new UserCancelledError('User declined resize');
            }

            if (userChoice.rememberChoice) {
                this.enableAutoResize();
            }

            // Show resize progress in the modal (don't close yet)
            if (userChoice.modal) {
                this._showResizeProgress(userChoice.modal);
                // Yield TWO frames so the browser can paint the spinner + progress bar
                // before the heavy canvas resize blocks the main thread.
                // One rAF queues paint, second ensures it's flushed.
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }
        }

        // Perform resize with progress callback
        const resized = await this._resizeImage(
            image,
            targetDims.width,
            targetDims.height,
            (step, totalSteps) => {
                this._updateResizeProgress(step, totalSteps);
            }
        );

        // Now close the modal
        this._closeResizeProgressModal();

        console.log(`✓ Resized: ${width}×${height} → ${targetDims.width}×${targetDims.height}`);

        return {
            image: resized,
            wasResized: true,
            originalDimensions: { width, height, pixels },
            newDimensions: {
                width: targetDims.width,
                height: targetDims.height,
                pixels: targetDims.width * targetDims.height
            }
        };
    }

    /**
     * Calculate target size maintaining aspect ratio
     */
    _calculateTargetSize(width, height) {
        const aspectRatio = width / height;

        let targetWidth = width;
        let targetHeight = height;

        // Check width constraint
        if (targetWidth > this.MAX_WIDTH) {
            targetWidth = this.MAX_WIDTH;
            targetHeight = Math.round(targetWidth / aspectRatio);
        }

        // Check height constraint
        if (targetHeight > this.MAX_HEIGHT) {
            targetHeight = this.MAX_HEIGHT;
            targetWidth = Math.round(targetHeight * aspectRatio);
        }

        // Check total pixels constraint (for unusual aspect ratios)
        const targetPixels = targetWidth * targetHeight;
        if (targetPixels > this.MAX_PIXELS) {
            const scale = Math.sqrt(this.MAX_PIXELS / targetPixels);
            targetWidth = Math.round(targetWidth * scale);
            targetHeight = Math.round(targetHeight * scale);
        }

        return { width: targetWidth, height: targetHeight };
    }

    /**
     * Get image dimensions from various input types
     */
    _getImageDimensions(image) {
        if (image instanceof HTMLImageElement) {
            return {
                width: image.naturalWidth || image.width,
                height: image.naturalHeight || image.height
            };
        }
        if (image instanceof ImageBitmap) {
            return { width: image.width, height: image.height };
        }
        if (image instanceof HTMLCanvasElement) {
            return { width: image.width, height: image.height };
        }
        throw new Error('Unknown image type');
    }

    /**
     * Request user permission via modal
     */
    async _requestUserPermission(origWidth, origHeight, newWidth, newHeight) {
        const origMP = (origWidth * origHeight / 1e6).toFixed(1);
        const newMP = (newWidth * newHeight / 1e6).toFixed(1);
        const speedup = this._estimateSpeedup(origWidth * origHeight, newWidth * newHeight);

        return new Promise((resolve) => {
            // Create modal HTML
            const modal = this._createModal({
                title: 'Image Resolution Too Large',
                message: `
                    <p>Your image is <strong>${origWidth}×${origHeight}</strong> (${origMP}MP).</p>
                    <p>For optimal performance, we recommend resizing to 
                    <strong>${newWidth}×${newHeight}</strong> (${newMP}MP).</p>
                    <div class="resize-benefits">
                        <div class="benefit">⚡ ${speedup}× faster processing</div>
                        <div class="benefit">💾 ${speedup}× less memory</div>
                        <div class="benefit">✨ Same visual quality (models max at 4K)</div>
                    </div>
                `,
                checkbox: {
                    id: 'resize-remember',
                    label: "Don't ask again, always resize large images"
                },
                buttons: [
                    {
                        label: 'Resize to 4K (Recommended)',
                        primary: true,
                        action: () => {
                            const remember = document.getElementById('resize-remember')?.checked;
                            // Don't close the modal — keep it open for progress
                            resolve({ cancelled: false, rememberChoice: remember, modal });
                        }
                    },
                    {
                        label: 'Cancel',
                        action: () => {
                            this._closeModal(modal);
                            resolve({ cancelled: true, rememberChoice: false });
                        }
                    }
                ]
            });

            document.body.appendChild(modal);
            if (this.onModalShow) this.onModalShow();
        });
    }

    /**
     * Transform the modal into a resize progress indicator
     */
    _showResizeProgress(modal) {
        this._activeResizeModal = modal;
        const modalBody = modal.querySelector('.resolution-modal-body');
        const modalButtons = modal.querySelector('.resolution-modal-buttons');
        const modalCheckbox = modal.querySelector('.resolution-modal-checkbox');
        const modalHeader = modal.querySelector('.resolution-modal-header');

        if (modalHeader) {
            modalHeader.textContent = 'Resizing Image...';
        }

        if (modalCheckbox) {
            modalCheckbox.style.display = 'none';
        }

        if (modalButtons) {
            modalButtons.style.display = 'none';
        }

        if (modalBody) {
            modalBody.innerHTML = `
                <div style="text-align: center; padding: 20px 0;">
                    <div class="resize-spinner"></div>
                    <div id="resize-progress-text" style="
                        margin-top: 16px;
                        font-size: 14px;
                        color: rgba(255,255,255,0.9);
                        font-weight: 500;
                    ">Preparing resize...</div>
                    <div id="resize-progress-bar-container" style="
                        margin-top: 12px;
                        width: 100%;
                        height: 4px;
                        background: rgba(255,255,255,0.1);
                        border-radius: 2px;
                        overflow: hidden;
                    ">
                        <div id="resize-progress-bar" style="
                            width: 0%;
                            height: 100%;
                            background: linear-gradient(90deg, #667eea, #764ba2);
                            border-radius: 2px;
                            transition: width 0.3s ease;
                        "></div>
                    </div>
                    <div id="resize-progress-step" style="
                        margin-top: 8px;
                        font-size: 11px;
                        color: rgba(255,255,255,0.5);
                    "></div>
                </div>
            `;
        }

        // Inject spinner CSS if not present
        if (!document.getElementById('resize-spinner-styles')) {
            const style = document.createElement('style');
            style.id = 'resize-spinner-styles';
            style.textContent = `
                .resize-spinner {
                    width: 36px;
                    height: 36px;
                    margin: 0 auto;
                    border: 3px solid rgba(255,255,255,0.1);
                    border-top: 3px solid #667eea;
                    border-radius: 50%;
                    animation: resize-spin 0.8s linear infinite;
                }
                @keyframes resize-spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Update resize progress in the modal
     */
    _updateResizeProgress(step, totalSteps) {
        const progressBar = document.getElementById('resize-progress-bar');
        const progressText = document.getElementById('resize-progress-text');
        const progressStep = document.getElementById('resize-progress-step');

        const percent = Math.round((step / totalSteps) * 100);

        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
        if (progressText) {
            progressText.textContent = step >= totalSteps
                ? 'Resize complete!'
                : `Resizing image... ${percent}%`;
        }
        if (progressStep) {
            progressStep.textContent = `Step ${step} of ${totalSteps}`;
        }
    }

    /**
     * Close the resize progress modal
     */
    _closeResizeProgressModal() {
        if (this._activeResizeModal) {
            this._closeModal(this._activeResizeModal);
            this._activeResizeModal = null;
        }
    }

    /**
     * Create modal element
     */
    _createModal({ title, message, checkbox, buttons }) {
        const overlay = document.createElement('div');
        overlay.className = 'resolution-modal-overlay';
        overlay.innerHTML = `
            <div class="resolution-modal">
                <div class="resolution-modal-header">${title}</div>
                <div class="resolution-modal-body">${message}</div>
                ${checkbox ? `
                    <div class="resolution-modal-checkbox">
                        <label>
                            <input type="checkbox" id="${checkbox.id}">
                            <span>${checkbox.label}</span>
                        </label>
                    </div>
                ` : ''}
                <div class="resolution-modal-buttons"></div>
            </div>
        `;

        // Add button handlers
        const buttonContainer = overlay.querySelector('.resolution-modal-buttons');
        for (const btn of buttons) {
            const button = document.createElement('button');
            button.className = btn.primary ? 'modal-btn-primary' : 'modal-btn-secondary';
            button.textContent = btn.label;
            button.onclick = btn.action;
            buttonContainer.appendChild(button);
        }

        // Add styles
        this._injectModalStyles();

        return overlay;
    }

    _closeModal(modal) {
        modal.remove();
        if (this.onModalHide) this.onModalHide();
    }

    _injectModalStyles() {
        if (document.getElementById('resolution-modal-styles')) return;

        const style = document.createElement('style');
        style.id = 'resolution-modal-styles';
        style.textContent = `
            .resolution-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                backdrop-filter: blur(4px);
            }
            .resolution-modal {
                background: var(--bg-primary, #1a1a2e);
                border-radius: 12px;
                padding: 24px;
                max-width: 480px;
                width: 90%;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                color: var(--text-primary, #fff);
            }
            .resolution-modal-header {
                font-size: 18px;
                font-weight: 600;
                margin-bottom: 16px;
                color: var(--text-primary, #fff);
            }
            .resolution-modal-body {
                font-size: 14px;
                line-height: 1.6;
                color: var(--text-secondary, #aaa);
                margin-bottom: 16px;
            }
            .resolution-modal-body p {
                margin: 0 0 12px 0;
            }
            .resize-benefits {
                background: rgba(102, 126, 234, 0.1);
                border-radius: 8px;
                padding: 12px;
                margin-top: 12px;
            }
            .resize-benefits .benefit {
                padding: 4px 0;
                font-size: 13px;
            }
            .resolution-modal-checkbox {
                margin: 16px 0;
                font-size: 13px;
            }
            .resolution-modal-checkbox label {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
            }
            .resolution-modal-checkbox input[type="checkbox"] {
                width: 16px;
                height: 16px;
                accent-color: var(--accent-color, #667eea);
            }
            .resolution-modal-buttons {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
                margin-top: 20px;
            }
            .modal-btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .modal-btn-primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            }
            .modal-btn-secondary {
                background: transparent;
                color: var(--text-secondary, #aaa);
                border: 1px solid var(--border-color, #333);
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                cursor: pointer;
                transition: background 0.2s;
            }
            .modal-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.05);
            }
        `;
        document.head.appendChild(style);
    }

    _estimateSpeedup(origPixels, newPixels) {
        return (origPixels / newPixels).toFixed(1);
    }

    /**
     * High-quality image resize using multi-step downsampling
     */
    async _resizeImage(image, targetWidth, targetHeight, progressCallback = null) {
        const { width: origWidth, height: origHeight } = this._getImageDimensions(image);

        // For very large downscales, use multi-step for better quality
        if (this._needsMultiStepResize(origWidth, origHeight, targetWidth, targetHeight)) {
            return await this._multiStepResize(image, targetWidth, targetHeight, progressCallback);
        }

        // Single-step resize
        if (progressCallback) progressCallback(1, 1);
        return await this._singleStepResize(image, targetWidth, targetHeight);
    }

    _needsMultiStepResize(origWidth, origHeight, targetWidth, targetHeight) {
        const scaleX = origWidth / targetWidth;
        const scaleY = origHeight / targetHeight;
        return Math.max(scaleX, scaleY) > 2.0;
    }

    async _multiStepResize(image, finalWidth, finalHeight, progressCallback = null) {
        let current = image;
        let currentWidth = this._getImageDimensions(image).width;
        let currentHeight = this._getImageDimensions(image).height;

        console.log(`Multi-step resize: ${currentWidth}×${currentHeight} → ${finalWidth}×${finalHeight}`);

        // Calculate total steps first for progress reporting
        let totalSteps = 1; // final resize step
        let tempW = currentWidth, tempH = currentHeight;
        while (tempW > finalWidth * 2 || tempH > finalHeight * 2) {
            tempW = Math.max(finalWidth, Math.round(tempW / 2));
            tempH = Math.max(finalHeight, Math.round(tempH / 2));
            totalSteps++;
        }

        let step = 0;

        // Each step reduces by max 2×
        while (currentWidth > finalWidth * 2 || currentHeight > finalHeight * 2) {
            const stepWidth = Math.max(finalWidth, Math.round(currentWidth / 2));
            const stepHeight = Math.max(finalHeight, Math.round(currentHeight / 2));

            step++;
            if (progressCallback) progressCallback(step, totalSteps);

            // Yield to let the UI update before the next heavy canvas operation
            await new Promise(resolve => setTimeout(resolve, 0));

            current = await this._singleStepResize(current, stepWidth, stepHeight);
            currentWidth = stepWidth;
            currentHeight = stepHeight;

            console.log(`  Step ${step}/${totalSteps}: ${stepWidth}×${stepHeight}`);
        }

        // Final resize to exact dimensions
        step++;
        if (progressCallback) progressCallback(step, totalSteps);
        await new Promise(resolve => setTimeout(resolve, 0));

        return await this._singleStepResize(current, finalWidth, finalHeight);
    }

    async _singleStepResize(image, targetWidth, targetHeight) {
        // Use OffscreenCanvas if available (better performance)
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(targetWidth, targetHeight)
            : document.createElement('canvas');

        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        // Convert to ImageBitmap for efficiency
        if (typeof createImageBitmap !== 'undefined') {
            return await createImageBitmap(canvas);
        }

        // Fallback: convert to image element using non-blocking Blob URL
        return new Promise((resolve, reject) => {
            if (canvas instanceof OffscreenCanvas) {
                canvas.convertToBlob({ type: 'image/png' })
                    .then(blob => {
                        const img = new Image();
                        img.onload = () => {
                            URL.revokeObjectURL(img.src);
                            resolve(img);
                        };
                        img.onerror = reject;
                        img.src = URL.createObjectURL(blob);
                    })
                    .catch(reject);
            } else {
                // Use toBlob instead of toDataURL to avoid synchronous base64 encoding
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Failed to create blob from canvas'));
                        return;
                    }
                    const img = new Image();
                    img.onload = () => {
                        URL.revokeObjectURL(img.src);
                        resolve(img);
                    };
                    img.onerror = reject;
                    img.src = URL.createObjectURL(blob);
                }, 'image/png');
            }
        });
    }

    // Preference methods
    enableAutoResize() {
        this.autoResize = true;
        localStorage.setItem('relight_autoResize4K', 'true');
    }

    disableAutoResize() {
        this.autoResize = false;
        localStorage.removeItem('relight_autoResize4K');
    }

    getAutoResizePreference() {
        return this.autoResize;
    }
}

/**
 * Custom error for user cancellation
 */
export class UserCancelledError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UserCancelledError';
    }
}

export default ResolutionManager;
