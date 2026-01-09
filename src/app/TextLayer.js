/**
 * TextLayer - Individual text layer with full typography and effects
 * 
 * Represents a single text element on the canvas with:
 * - Text content and styling
 * - Position and transform
 * - Effects (shadow, outline, background)
 */

export class TextLayer {
    constructor(options = {}) {
        // Unique identifier
        this.id = options.id || `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Content
        this.text = options.text || 'Double-click to edit';

        // Position (canvas coordinates)
        this.x = options.x || 100;
        this.y = options.y || 100;

        // Dimensions (auto-calculated or fixed)
        this.width = options.width || null; // null = auto
        this.height = options.height || null;
        this.minWidth = 50;
        this.minHeight = 20;

        // Typography
        this.fontFamily = options.fontFamily || 'Inter';
        this.fontSize = options.fontSize || 48;
        this.fontWeight = options.fontWeight || 400; // 100-900
        this.fontStyle = options.fontStyle || 'normal'; // normal, italic
        this.lineHeight = options.lineHeight || 1.4;
        this.letterSpacing = options.letterSpacing || 0; // px
        this.textAlign = options.textAlign || 'left'; // left, center, right
        this.textDecoration = options.textDecoration || 'none'; // none, underline, line-through
        this.textTransform = options.textTransform || 'none'; // none, uppercase, lowercase, capitalize

        // Colors
        this.fillColor = options.fillColor || '#ffffff';
        this.fillOpacity = options.fillOpacity ?? 1;

        // Stroke/Outline
        this.strokeEnabled = options.strokeEnabled || false;
        this.strokeColor = options.strokeColor || '#000000';
        this.strokeWidth = options.strokeWidth || 2;

        // Background
        this.backgroundEnabled = options.backgroundEnabled || false;
        this.backgroundColor = options.backgroundColor || '#000000';
        this.backgroundOpacity = options.backgroundOpacity || 0.5;
        this.backgroundPadding = options.backgroundPadding || 8;
        this.backgroundRadius = options.backgroundRadius || 4;

        // Shadow
        this.shadowEnabled = options.shadowEnabled || false;
        this.shadowColor = options.shadowColor || '#000000';
        this.shadowOffsetX = options.shadowOffsetX || 4;
        this.shadowOffsetY = options.shadowOffsetY || 4;
        this.shadowBlur = options.shadowBlur || 8;
        this.shadowOpacity = options.shadowOpacity || 0.5;

        // Transform
        this.rotation = options.rotation || 0; // degrees
        this.scaleX = options.scaleX || 1;
        this.scaleY = options.scaleY || 1;
        this.flipX = options.flipX || false;
        this.flipY = options.flipY || false;

        // Layer properties
        this.opacity = options.opacity ?? 1;
        this.visible = options.visible ?? true;
        this.locked = options.locked || false;
        this.name = options.name || 'Text Layer';

        // Computed bounds (cached)
        this._bounds = null;
        this._needsUpdate = true;
    }

    /**
     * Get the full font string for canvas context
     */
    get font() {
        return `${this.fontStyle} ${this.fontWeight} ${this.fontSize}px "${this.fontFamily}"`;
    }

    /**
     * Get computed bounds of the text
     */
    getBounds(ctx) {
        if (!this._needsUpdate && this._bounds) {
            return this._bounds;
        }

        ctx.save();
        ctx.font = this.font;

        const lines = this.text.split('\n');
        let maxWidth = 0;

        lines.forEach(line => {
            const metrics = ctx.measureText(line);
            maxWidth = Math.max(maxWidth, metrics.width);
        });

        const lineHeightPx = this.fontSize * this.lineHeight;
        const totalHeight = lineHeightPx * lines.length;

        // Add letter spacing to width estimate
        const letterSpacingWidth = this.letterSpacing * (this.text.length - lines.length);
        maxWidth += letterSpacingWidth;

        // Use fixed dimensions if set, otherwise calculated
        const width = this.width || Math.max(maxWidth + 20, this.minWidth);
        const height = this.height || Math.max(totalHeight + 10, this.minHeight);

        ctx.restore();

        this._bounds = {
            x: this.x,
            y: this.y,
            width,
            height,
            textWidth: maxWidth,
            textHeight: totalHeight,
            lineHeight: lineHeightPx,
            lines: lines.length
        };

        this._needsUpdate = false;
        return this._bounds;
    }

    /**
     * Invalidate cached bounds
     */
    invalidate() {
        this._needsUpdate = true;
        this._bounds = null;
    }

    /**
     * Check if point is inside this layer
     */
    containsPoint(px, py, ctx) {
        const bounds = this.getBounds(ctx);

        // Apply inverse rotation if needed
        if (this.rotation !== 0) {
            const cx = bounds.x + bounds.width / 2;
            const cy = bounds.y + bounds.height / 2;
            const rad = -this.rotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const dx = px - cx;
            const dy = py - cy;
            px = cx + dx * cos - dy * sin;
            py = cy + dx * sin + dy * cos;
        }

        return px >= bounds.x && px <= bounds.x + bounds.width &&
            py >= bounds.y && py <= bounds.y + bounds.height;
    }

    /**
     * Get handle at point (for resize/rotate)
     * Returns: 'tl', 'tr', 'bl', 'br', 't', 'r', 'b', 'l', 'rotate', or null
     */
    getHandleAt(px, py, ctx, handleSize = 10) {
        const bounds = this.getBounds(ctx);
        const hs = handleSize / 2;

        // Transform point if rotated
        let checkX = px;
        let checkY = py;

        if (this.rotation !== 0) {
            const cx = bounds.x + bounds.width / 2;
            const cy = bounds.y + bounds.height / 2;
            const rad = -this.rotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const dx = px - cx;
            const dy = py - cy;
            checkX = cx + dx * cos - dy * sin;
            checkY = cy + dx * sin + dy * cos;
        }

        const x = bounds.x;
        const y = bounds.y;
        const w = bounds.width;
        const h = bounds.height;

        // Corner handles
        if (Math.abs(checkX - x) < hs && Math.abs(checkY - y) < hs) return 'tl';
        if (Math.abs(checkX - (x + w)) < hs && Math.abs(checkY - y) < hs) return 'tr';
        if (Math.abs(checkX - x) < hs && Math.abs(checkY - (y + h)) < hs) return 'bl';
        if (Math.abs(checkX - (x + w)) < hs && Math.abs(checkY - (y + h)) < hs) return 'br';

        // Edge handles
        if (Math.abs(checkX - (x + w / 2)) < hs && Math.abs(checkY - y) < hs) return 't';
        if (Math.abs(checkX - (x + w)) < hs && Math.abs(checkY - (y + h / 2)) < hs) return 'r';
        if (Math.abs(checkX - (x + w / 2)) < hs && Math.abs(checkY - (y + h)) < hs) return 'b';
        if (Math.abs(checkX - x) < hs && Math.abs(checkY - (y + h / 2)) < hs) return 'l';

        // Rotate handle (above top center)
        const rotateY = y - 30;
        if (Math.abs(checkX - (x + w / 2)) < hs && Math.abs(checkY - rotateY) < hs) return 'rotate';

        return null;
    }

    /**
     * Clone this layer
     */
    clone() {
        return new TextLayer({
            ...this.serialize(),
            id: undefined, // Generate new ID
            name: `${this.name} Copy`,
            x: this.x + 20,
            y: this.y + 20
        });
    }

    /**
     * Serialize to plain object
     */
    serialize() {
        return {
            id: this.id,
            text: this.text,
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            fontFamily: this.fontFamily,
            fontSize: this.fontSize,
            fontWeight: this.fontWeight,
            fontStyle: this.fontStyle,
            lineHeight: this.lineHeight,
            letterSpacing: this.letterSpacing,
            textAlign: this.textAlign,
            textDecoration: this.textDecoration,
            textTransform: this.textTransform,
            fillColor: this.fillColor,
            fillOpacity: this.fillOpacity,
            strokeEnabled: this.strokeEnabled,
            strokeColor: this.strokeColor,
            strokeWidth: this.strokeWidth,
            backgroundEnabled: this.backgroundEnabled,
            backgroundColor: this.backgroundColor,
            backgroundOpacity: this.backgroundOpacity,
            backgroundPadding: this.backgroundPadding,
            backgroundRadius: this.backgroundRadius,
            shadowEnabled: this.shadowEnabled,
            shadowColor: this.shadowColor,
            shadowOffsetX: this.shadowOffsetX,
            shadowOffsetY: this.shadowOffsetY,
            shadowBlur: this.shadowBlur,
            shadowOpacity: this.shadowOpacity,
            rotation: this.rotation,
            scaleX: this.scaleX,
            scaleY: this.scaleY,
            flipX: this.flipX,
            flipY: this.flipY,
            opacity: this.opacity,
            visible: this.visible,
            locked: this.locked,
            name: this.name
        };
    }

    /**
     * Create from serialized data
     */
    static deserialize(data) {
        return new TextLayer(data);
    }
}
