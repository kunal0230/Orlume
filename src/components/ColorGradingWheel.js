
export class ColorGradingWheel {
    constructor(container, label, onChange) {
        this.container = container;
        this.label = label;
        this.onChange = onChange;

        // State
        this.hue = 0; // 0-1
        this.sat = 0; // 0-1
        this.lum = 0; // -100 to 100

        this.isDragging = false;
        this.dragMode = 'both'; // 'both', 'hue', 'sat'

        this._init();
    }

    _init() {
        // Container element
        this.element = document.createElement('div');
        this.element.className = 'color-grade-wheel';
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.element.style.alignItems = 'center';
        this.element.style.width = '100%';
        this.element.style.marginBottom = '10px';

        // Label
        const labelEl = document.createElement('div');
        labelEl.textContent = this.label;
        labelEl.style.fontSize = '12px';
        labelEl.style.color = '#aaa';
        labelEl.style.marginBottom = '8px';
        labelEl.style.fontWeight = '500';
        this.element.appendChild(labelEl);

        // Canvas Container (relative for overlay)
        const canvasWrap = document.createElement('div');
        canvasWrap.style.position = 'relative';
        canvasWrap.style.width = '120px';
        canvasWrap.style.height = '120px';
        canvasWrap.style.cursor = 'crosshair';
        this.element.appendChild(canvasWrap);

        // Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = 120;
        this.canvas.height = 120;
        this.canvas.style.width = '120px';
        this.canvas.style.height = '120px';
        this.canvas.style.borderRadius = '50%';
        canvasWrap.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        // Events
        this.canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
        window.addEventListener('mousemove', this._onMouseMove.bind(this)); // Window for drag outside
        window.addEventListener('mouseup', this._onMouseUp.bind(this));

        this.canvas.addEventListener('dblclick', () => {
            this.hue = 0;
            this.sat = 0;
            this._draw();
            this.onChange(this.hue, this.sat, this.lum);
        });

        // Luminance Slider
        const lumContainer = document.createElement('div');
        lumContainer.style.width = '120px';
        lumContainer.style.marginTop = '8px';
        lumContainer.style.display = 'flex';
        lumContainer.style.alignItems = 'center';

        this.lumSlider = document.createElement('input');
        this.lumSlider.type = 'range';
        this.lumSlider.min = '-100';
        this.lumSlider.max = '100';
        this.lumSlider.value = '0';
        this.lumSlider.style.width = '100%';
        this.lumSlider.style.height = '4px';
        this.lumSlider.style.accentColor = '#888'; // Neural color

        this.lumSlider.addEventListener('input', (e) => {
            this.lum = parseFloat(e.target.value);
            this.onChange(this.hue, this.sat, this.lum);
        });
        this.lumSlider.addEventListener('dblclick', () => {
            this.lum = 0;
            this.lumSlider.value = 0;
            this.onChange(this.hue, this.sat, this.lum);
        });

        lumContainer.appendChild(this.lumSlider);
        this.element.appendChild(lumContainer);

        this.container.appendChild(this.element);

        this._draw();
    }

    _onMouseDown(e) {
        this.isDragging = true;

        // Check modifiers
        if (e.shiftKey) {
            // Determine if mostly radial (Sat) or tangential (Hue) movement intent?
            // For now, let's just default to 'both' and handle constraints in logic if needed.
            // Simplified: Shift locks Hue (changes Sat only).
            // Actually, Lightroom uses Shift to lock Line (Hue).
            // Let's implement interaction:
            // Just update position immediately.
        }

        this._updateFromEvent(e);
    }

    _onMouseMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this._updateFromEvent(e);
    }

    _onMouseUp(e) {
        this.isDragging = false;
    }

    _updateFromEvent(e) {
        const rect = this.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        // Mouse pos relative to center
        let dx = (e.clientX - rect.left) - centerX;
        let dy = (e.clientY - rect.top) - centerY;

        // Convert to Polar
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = rect.width / 2;

        // Calculate Saturation (Distance / Radius)
        let newSat = Math.min(1.0, dist / radius);

        // Calculate Hue (Angle)
        // atan2 returns -PI to PI. We want 0-1.
        let angle = Math.atan2(dy, dx); // radians
        let newHue = (angle / (Math.PI * 2)) + 0.5; // 0 to 1
        // Shift hue so Red (0) is at top? Standard color wheel: Red is usually at 0 deg (Right) or -90 deg (Top).
        // CSS/HSL: 0 deg = Red.
        // atan2(0, 1) = 0 (Right).
        // If we want Red at Top: Rotate -90deg.

        // Shift modifier logic
        if (e.shiftKey) {
            // Lock Hue to current hue, only change Sat
            newHue = this.hue;
        }

        this.hue = newHue;
        this.sat = newSat;

        this._draw();
        this.onChange(this.hue, this.sat, this.lum);
    }

    setValue(hue, sat, lum) {
        this.hue = hue;
        this.sat = sat;
        if (lum !== undefined) {
            this.lum = lum;
            this.lumSlider.value = lum;
        }
        this._draw();
    }

    _draw() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = w / 2;

        this.ctx.clearRect(0, 0, w, h);

        // 1. Draw Color Wheel
        // Create offscreen buffer if perf is bad, but for small canvas it's fine.
        // Actually, rendering pixel-by-pixel in JS is slow.
        // Better: Pre-render wheel image or use conic gradient.

        if (!this._wheelImage) {
            this._createWheelImage(w, h);
        }
        this.ctx.drawImage(this._wheelImage, 0, 0);

        // 2. Draw Handle
        // Convert polar to cartesian
        // Hue 0 (Right) -> Hue 0.25 (Down) with our math?
        // Math.atan2(dy, dx).
        // angle = (hue - 0.5) * PI * 2 ?
        const angle = (this.hue - 0.5) * Math.PI * 2;
        const r = this.sat * radius; // full radius

        // Clamp r to radius - padding
        const handleR = Math.min(r, radius - 4);

        const hx = cx + Math.cos(angle) * handleR;
        const hy = cy + Math.sin(angle) * handleR;

        // Draw Handle Circle
        this.ctx.beginPath();
        this.ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.fillStyle = `hsl(${this.hue * 360}, 100%, 50%)`;
        this.ctx.fill();
        this.ctx.stroke();

        // Draw center crosshair (faint)
        this.ctx.beginPath();
        this.ctx.moveTo(cx - 2, cy);
        this.ctx.lineTo(cx + 2, cy);
        this.ctx.moveTo(cx, cy - 2);
        this.ctx.lineTo(cx, cy + 2);
        this.ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }

    _createWheelImage(w, h) {
        const buffer = document.createElement('canvas');
        buffer.width = w;
        buffer.height = h;
        const ctx = buffer.getContext('2d');

        const cx = w / 2;
        const cy = h / 2;
        const radius = w / 2;

        const imageData = ctx.createImageData(w, h);
        const data = imageData.data;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const index = (y * w + x) * 4;
                const dx = x - cx;
                const dy = y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > radius) {
                    data[index + 3] = 0; // Transparent
                    continue;
                }

                // Angle
                const angle = Math.atan2(dy, dx);
                const hue = (angle / (Math.PI * 2)) + 0.5;

                // Saturation gradient (white center -> color edge)
                const sat = dist / radius;

                // HSL to RGB conversion helper
                const [r, g, b] = this._hslToRgb(hue, sat, 0.5 + (1.0 - sat) * 0.5); // Lighter center?
                // Standard color wheel usually goes to white or gray in center.
                // Or just: H=hue, S=sat, L=0.5.
                // Let's use standard grading wheel look: Sat 0 = Gray (L=0.5).

                const rgb = this._hslToRgb(hue, sat, 0.5);

                data[index] = rgb[0];
                data[index + 1] = rgb[1];
                data[index + 2] = rgb[2];
                data[index + 3] = 255;

                // Antialias edge
                if (dist > radius - 1) {
                    data[index + 3] = 255 * (radius - dist);
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
        this._wheelImage = buffer; // Cache it
    }

    _hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return [r * 255, g * 255, b * 255];
    }
}
