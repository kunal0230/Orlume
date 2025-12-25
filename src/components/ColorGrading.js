/**
 * ColorGrading - Shadows/Midtones/Highlights color wheels
 * Orlume Vision Labs
 * 
 * Features:
 * - Three color wheels with drag handling
 * - Angle = hue direction, Distance = strength
 * - Balance and Blending sliders
 */

export class ColorGrading {
    constructor(app) {
        this.app = app;
        this.isDragging = false;
        this.activeWheel = null;

        // Wheel size (must match CSS)
        this.wheelSize = 80;
        this.wheelRadius = this.wheelSize / 2;
        this.handleRadius = 8;

        this._init();
    }

    _init() {
        try {
            this._bindWheels();
            this._bindSliders();
            console.log('🎨 ColorGrading initialized');
        } catch (err) {
            console.warn('ColorGrading init failed:', err);
        }
    }

    /**
     * Bind color wheel drag handling
     */
    _bindWheels() {
        const wheels = ['shadows', 'midtones', 'highlights'];

        wheels.forEach(wheelName => {
            const wheel = document.getElementById(`wheel-${wheelName}`);
            const handle = wheel?.querySelector('.wheel-handle');

            if (!wheel || !handle) return;

            // Mouse down on handle or wheel
            wheel.addEventListener('mousedown', (e) => {
                this.isDragging = true;
                this.activeWheel = wheelName;
                this._updateWheelFromEvent(e, wheel, handle, wheelName);
            });

            // Double-click to reset
            wheel.addEventListener('dblclick', () => {
                this._resetWheel(wheelName, handle);
            });
        });

        // Global mouse move/up
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging || !this.activeWheel) return;

            const wheel = document.getElementById(`wheel-${this.activeWheel}`);
            const handle = wheel?.querySelector('.wheel-handle');
            if (wheel && handle) {
                this._updateWheelFromEvent(e, wheel, handle, this.activeWheel);
            }
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.activeWheel = null;
        });
    }

    /**
     * Update wheel from mouse event
     */
    _updateWheelFromEvent(e, wheel, handle, wheelName) {
        const rect = wheel.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;

        // Mouse position relative to center
        const x = e.clientX - rect.left - cx;
        const y = e.clientY - rect.top - cy;

        // Calculate angle and distance
        let angle = Math.atan2(y, x) * 180 / Math.PI + 90; // 0° at top
        angle = ((angle % 360) + 360) % 360;

        const distance = Math.sqrt(x * x + y * y);
        const maxDistance = cx - this.handleRadius;
        const strength = Math.min(1, distance / maxDistance);

        // Update handle position
        const clampedDist = Math.min(distance, maxDistance);
        const hx = (clampedDist / maxDistance) * maxDistance * Math.sin(angle * Math.PI / 180);
        const hy = -(clampedDist / maxDistance) * maxDistance * Math.cos(angle * Math.PI / 180);

        handle.style.transform = `translate(${hx}px, ${hy}px)`;

        // Update handle color based on angle
        handle.style.background = `hsl(${angle}, 70%, 50%)`;

        // Update value display (Angle° / Strength)
        const valueDisplay = document.getElementById(`${wheelName}-values`);
        if (valueDisplay) {
            valueDisplay.textContent = `${Math.round(angle)}° / ${Math.round(strength * 100)}`;
        }

        // Update develop component
        this.app.components.develop?.setColorGrading(wheelName, 'angle', angle);
        this.app.components.develop?.setColorGrading(wheelName, 'strength', strength * 100);

        this._triggerPreview();
    }

    /**
     * Reset wheel to center
     */
    _resetWheel(wheelName, handle) {
        handle.style.transform = 'translate(0, 0)';
        handle.style.background = 'white';

        const valueDisplay = document.getElementById(`${wheelName}-values`);
        if (valueDisplay) {
            valueDisplay.textContent = '0° / 0';
        }

        this.app.components.develop?.setColorGrading(wheelName, 'angle', 0);
        this.app.components.develop?.setColorGrading(wheelName, 'strength', 0);
        this._triggerPreview();
    }

    /**
     * Bind Blending and Balance sliders
     */
    _bindSliders() {
        // Blending
        const blendingSlider = document.getElementById('grading-blending');
        const blendingVal = document.getElementById('grading-blending-val');
        if (blendingSlider) {
            blendingSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (blendingVal) blendingVal.textContent = value;
                this.app.components.develop?.setColorGrading('blending', null, value);
                this._triggerPreview();
            });
            blendingSlider.addEventListener('dblclick', () => {
                blendingSlider.value = 50;
                if (blendingVal) blendingVal.textContent = '50';
                this.app.components.develop?.setColorGrading('blending', null, 50);
                this._triggerPreview();
            });
        }

        // Balance
        const balanceSlider = document.getElementById('grading-balance');
        const balanceVal = document.getElementById('grading-balance-val');
        if (balanceSlider) {
            balanceSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (balanceVal) balanceVal.textContent = value;
                this.app.components.develop?.setColorGrading('balance', null, value);
                this._triggerPreview();
            });
            balanceSlider.addEventListener('dblclick', () => {
                balanceSlider.value = 0;
                if (balanceVal) balanceVal.textContent = '0';
                this.app.components.develop?.setColorGrading('balance', null, 0);
                this._triggerPreview();
            });
        }
    }

    /**
     * Trigger develop preview
     */
    _triggerPreview() {
        if (this.app.updateDevelopPreview) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(() => {
                this.app.updateDevelopPreview();
            }, 16);
        }
    }

    /**
     * Reset all grading values
     */
    reset() {
        ['shadows', 'midtones', 'highlights'].forEach(wheelName => {
            const handle = document.querySelector(`#wheel-${wheelName} .wheel-handle`);
            if (handle) {
                handle.style.transform = 'translate(0, 0)';
                handle.style.background = 'white';
            }
            const valueDisplay = document.getElementById(`${wheelName}-values`);
            if (valueDisplay) {
                valueDisplay.textContent = '0° / 0';
            }
        });

        const blendingSlider = document.getElementById('grading-blending');
        const blendingVal = document.getElementById('grading-blending-val');
        const balanceSlider = document.getElementById('grading-balance');
        const balanceVal = document.getElementById('grading-balance-val');

        if (blendingSlider) blendingSlider.value = 50;
        if (blendingVal) blendingVal.textContent = '50';
        if (balanceSlider) balanceSlider.value = 0;
        if (balanceVal) balanceVal.textContent = '0';
    }
}
