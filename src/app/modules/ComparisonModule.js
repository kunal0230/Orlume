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
        const canvasArea = document.querySelector('.canvas-area');
        if (!canvasArea) return;

        // Create comparison slider container
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
        canvasArea.appendChild(slider);

        // Create original canvas overlay for comparison
        const originalCanvas = document.createElement('canvas');
        originalCanvas.id = 'original-canvas';
        originalCanvas.className = 'original-canvas';
        originalCanvas.style.display = 'none';
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer) {
            canvasContainer.appendChild(originalCanvas);
        }

        // Slider drag handling
        const handle = slider.querySelector('.comparison-handle');

        handle?.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this._isDragging = true;
        });

        document.addEventListener('mousemove', (e) => {
            if (!this._isDragging || !this.comparison.active) return;

            const rect = canvasArea.getBoundingClientRect();
            const x = e.clientX - rect.left;
            this.comparison.position = Math.max(5, Math.min(95, (x / rect.width) * 100));
            this._updateSlider();
        });

        document.addEventListener('mouseup', () => {
            this._isDragging = false;
        });

        // Before/After toggle button for accessibility
        const beforeAfterBtn = document.getElementById('btn-before-after');
        if (beforeAfterBtn) {
            beforeAfterBtn.addEventListener('click', () => {
                this.toggle();
                beforeAfterBtn.classList.toggle('active', this.comparison.active);
            });
        }

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

        if (show && this.state.hasImage) {
            // Copy original image to overlay canvas
            if (originalCanvas) {
                const ctx = originalCanvas.getContext('2d');
                const mainCanvas = this.elements.canvas;
                originalCanvas.width = mainCanvas.width;
                originalCanvas.height = mainCanvas.height;

                // Draw original image
                if (this.state.originalImage) {
                    ctx.drawImage(this.state.originalImage, 0, 0, originalCanvas.width, originalCanvas.height);
                }
                originalCanvas.style.display = 'block';
            }

            if (slider) {
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
    }

    /**
     * Update comparison slider position and clipping
     */
    _updateSlider() {
        const slider = document.getElementById('comparison-slider');
        const originalCanvas = document.getElementById('original-canvas');

        if (!slider || !originalCanvas) return;

        const position = this.comparison.position;

        // Position the slider line and handle
        slider.style.left = `${position}%`;

        // Clip the original canvas to show only the left portion
        originalCanvas.style.clipPath = `inset(0 ${100 - position}% 0 0)`;
    }
}
