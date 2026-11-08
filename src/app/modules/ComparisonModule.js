/**
 * ComparisonModule - Before/After comparison slider
 * 
 * Handles:
 * - Comparison slider initialization and UI creation
 * - Slider drag handling
 * - Toggle comparison mode
 * - Original canvas clipping for split view
 */

export class ComparisonModule {
    constructor(editor) {
        this.editor = editor;
        this.state = editor.state;
        this.elements = editor.elements;

        // Comparison state
        this.comparison = {
            active: false,
            position: 50  // percentage from left
        };

        // Internal state
        this._isDragging = false;
    }

    /**
     * Initialize Before/After comparison slider
     */
    init() {
        const canvasContainer = document.querySelector('.canvas-container') || document.querySelector('.canvas-area');
        if (!canvasContainer) return;

        // Create comparison slider container inside canvasContainer for accurate split-alignment
        const slider = document.createElement('div');
        slider.className = 'comparison-slider';
        slider.id = 'comparison-slider';
        slider.style.display = 'none';
        slider.innerHTML = `
            <div class="comparison-line"></div>
            <div class="comparison-handle">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M8 5v14l-5-7zM16 5v14l5-7z"/>
                </svg>
            </div>
            <div class="comparison-label comparison-label-before">Before</div>
            <div class="comparison-label comparison-label-after">After</div>
        `;
        canvasContainer.appendChild(slider);

        // Create original canvas overlay for comparison
        const originalCanvas = document.createElement('canvas');
        originalCanvas.id = 'original-canvas';
        originalCanvas.className = 'original-canvas';
        originalCanvas.style.display = 'none';
        canvasContainer.appendChild(originalCanvas);

        // Slider drag handling - allow dragging anywhere on the slider line or handle
        const handle = slider.querySelector('.comparison-handle');
        const startDrag = (e) => {
            if (e.cancelable) e.preventDefault();
            this._isDragging = true;
        };

        handle?.addEventListener('mousedown', startDrag);
        slider.addEventListener('mousedown', startDrag);

        // Touch support for slider dragging
        handle?.addEventListener('touchstart', startDrag, { passive: false });
        slider.addEventListener('touchstart', startDrag, { passive: false });

        document.addEventListener('mousemove', (e) => {
            if (!this._isDragging || !this.comparison.active) return;

            const targetCanvas = this.elements.canvas || canvasContainer;
            const rect = targetCanvas.getBoundingClientRect();
            if (rect.width <= 0) return;
            const x = e.clientX - rect.left;
            this.comparison.position = Math.max(0, Math.min(100, (x / rect.width) * 100));
            this._updateSlider();
        });

        document.addEventListener('touchmove', (e) => {
            if (!this._isDragging || !this.comparison.active || !e.touches?.length) return;

            const targetCanvas = this.elements.canvas || canvasContainer;
            const rect = targetCanvas.getBoundingClientRect();
            if (rect.width <= 0) return;
            const x = e.touches[0].clientX - rect.left;
            this.comparison.position = Math.max(0, Math.min(100, (x / rect.width) * 100));
            this._updateSlider();
        }, { passive: true });

        document.addEventListener('mouseup', () => {
            this._isDragging = false;
        });

        document.addEventListener('touchend', () => {
            this._isDragging = false;
        });
        document.addEventListener('touchcancel', () => {
            this._isDragging = false;
        });

        // Before/After toggle button for accessibility
        const beforeAfterBtn = document.getElementById('btn-before-after');
        if (beforeAfterBtn) {
            beforeAfterBtn.addEventListener('click', () => {
                this.toggle();
            });
        }

        // Keep overlay and slider dimensions synced on window resize
        window.addEventListener('resize', () => {
            if (this.comparison.active) {
                this._updateSlider();
            }
        });

        // Sync with editor's comparison state
        this.editor.comparison = this.comparison;
    }

    /**
     * Toggle before/after comparison mode
     */
    toggle(show = !this.comparison.active) {
        this.comparison.active = show;

        const slider = document.getElementById('comparison-slider');
        const originalCanvas = document.getElementById('original-canvas');
        const mainCanvas = this.elements.canvas;

        if (show && this.state.hasImage) {
            // Copy original / pre-upscale baseline image to overlay canvas
            if (originalCanvas && mainCanvas) {
                const ctx = originalCanvas.getContext('2d');
                originalCanvas.width = mainCanvas.width;
                originalCanvas.height = mainCanvas.height;
                originalCanvas.style.width = `${mainCanvas.clientWidth}px`;
                originalCanvas.style.height = `${mainCanvas.clientHeight}px`;
                originalCanvas.style.borderRadius = getComputedStyle(mainCanvas).borderRadius;

                // Pick the untouched original image or pre-upscale image as the "Before" comparison baseline
                const beforeSource = this.state.preUpscaleImage || this.state.initialImage || this.state.originalImage;
                if (beforeSource) {
                    ctx.drawImage(beforeSource, 0, 0, originalCanvas.width, originalCanvas.height);
                }
                originalCanvas.style.display = 'block';
            }

            if (slider && mainCanvas) {
                slider.style.height = `${mainCanvas.clientHeight}px`;
                slider.style.display = 'flex';
            }
            this._updateSlider();
        } else {
            if (slider) slider.style.display = 'none';
            if (originalCanvas) originalCanvas.style.display = 'none';
        }

        // Sync the toggle button active state
        const beforeAfterBtn = document.getElementById('btn-before-after');
        if (beforeAfterBtn) {
            beforeAfterBtn.classList.toggle('active', this.comparison.active);
        }
        const mobileBtnBefore = document.getElementById('mobile-btn-before');
        if (mobileBtnBefore) {
            mobileBtnBefore.classList.toggle('active', this.comparison.active);
        }
    }

    /**
     * Update comparison slider position and clipping
     */
    _updateSlider() {
        const slider = document.getElementById('comparison-slider');
        const originalCanvas = document.getElementById('original-canvas');
        const mainCanvas = this.elements.canvas;

        if (!slider || !originalCanvas) return;

        if (mainCanvas && mainCanvas.clientWidth > 0) {
            originalCanvas.style.width = `${mainCanvas.clientWidth}px`;
            originalCanvas.style.height = `${mainCanvas.clientHeight}px`;
            slider.style.height = `${mainCanvas.clientHeight}px`;
        }

        const position = this.comparison.position;

        // Position the slider line and handle
        slider.style.left = `${position}%`;

        // Clip the original canvas to show only the left portion
        originalCanvas.style.clipPath = `inset(0 ${100 - position}% 0 0)`;
    }
}
