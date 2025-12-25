/**
 * TextLayer - Represents a single text object on the canvas
 * 
 * Text is a vector object, NOT image data.
 * It renders on top of images during display and export.
 */

let textIdCounter = 0;

export class TextLayer {
    constructor(options = {}) {
        this.id = `text-${++textIdCounter}-${Date.now()}`;

        // Content
        this.content = options.content || 'Add text';

        // Position (in image coordinates)
        this.x = options.x || 100;
        this.y = options.y || 100;

        // Transform
        this.rotation = options.rotation || 0; // degrees
        this.scale = options.scale || 1;

        // Typography
        this.fontFamily = options.fontFamily || 'Inter';
        this.fontSize = options.fontSize || 48;
        this.fontWeight = options.fontWeight || 400;
        this.fontStyle = options.fontStyle || 'normal'; // 'normal' | 'italic'
        this.lineHeight = options.lineHeight || 1.2;
        this.letterSpacing = options.letterSpacing || 0;
        this.textAlign = options.textAlign || 'left'; // 'left' | 'center' | 'right'

        // Appearance
        this.color = options.color || '#ffffff';
        this.opacity = options.opacity ?? 1;

        // Shadow (optional)
        this.shadow = options.shadow || {
            enabled: false,
            color: 'rgba(0,0,0,0.5)',
            blur: 4,
            offsetX: 2,
            offsetY: 2
        };

        // Background highlight (optional)
        this.background = options.background || {
            enabled: false,
            color: 'rgba(0,0,0,0.5)',
            padding: 8
        };

        // Layout mode
        this.autoWidth = options.autoWidth ?? true;
        this.fixedWidth = options.fixedWidth || null; // null = auto, number = fixed px

        // Calculated bounds (updated by measure())
        this._bounds = { width: 0, height: 0 };

        // State
        this.selected = false;
        this.editing = false;
    }

    /**
     * Measure text and update bounds
     * @param {CanvasRenderingContext2D} ctx - Canvas context for measuring
     */
    measure(ctx) {
        ctx.save();
        ctx.font = this.getCanvasFont();

        const lines = this.content.split('\n');
        let maxWidth = 0;

        for (const line of lines) {
            const metrics = ctx.measureText(line);
            maxWidth = Math.max(maxWidth, metrics.width);
        }

        const lineHeightPx = this.fontSize * this.lineHeight;
        const height = lines.length * lineHeightPx;

        this._bounds = {
            width: this.fixedWidth || maxWidth,
            height: height
        };

        ctx.restore();
        return this._bounds;
    }

    /**
     * Get CSS font string for canvas
     */
    getCanvasFont() {
        const style = this.fontStyle === 'italic' ? 'italic' : 'normal';
        return `${style} ${this.fontWeight} ${this.fontSize}px "${this.fontFamily}"`;
    }

    /**
     * Get bounding box in image coordinates
     */
    getBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this._bounds.width * this.scale,
            height: this._bounds.height * this.scale
        };
    }

    /**
     * Check if point is inside this text layer
     * @param {number} px - Point X in image coordinates
     * @param {number} py - Point Y in image coordinates
     */
    containsPoint(px, py) {
        const bounds = this.getBounds();

        // Simple AABB check (ignores rotation for now)
        return (
            px >= bounds.x &&
            px <= bounds.x + bounds.width &&
            py >= bounds.y &&
            py <= bounds.y + bounds.height
        );
    }

    /**
     * Clone this text layer
     */
    clone() {
        const copy = new TextLayer({
            content: this.content,
            x: this.x + 20,
            y: this.y + 20,
            rotation: this.rotation,
            scale: this.scale,
            fontFamily: this.fontFamily,
            fontSize: this.fontSize,
            fontWeight: this.fontWeight,
            fontStyle: this.fontStyle,
            lineHeight: this.lineHeight,
            letterSpacing: this.letterSpacing,
            textAlign: this.textAlign,
            color: this.color,
            opacity: this.opacity,
            shadow: { ...this.shadow },
            background: { ...this.background },
            autoWidth: this.autoWidth,
            fixedWidth: this.fixedWidth
        });
        return copy;
    }

    /**
     * Serialize to plain object
     */
    toJSON() {
        return {
            id: this.id,
            content: this.content,
            x: this.x,
            y: this.y,
            rotation: this.rotation,
            scale: this.scale,
            fontFamily: this.fontFamily,
            fontSize: this.fontSize,
            fontWeight: this.fontWeight,
            fontStyle: this.fontStyle,
            lineHeight: this.lineHeight,
            letterSpacing: this.letterSpacing,
            textAlign: this.textAlign,
            color: this.color,
            opacity: this.opacity,
            shadow: this.shadow,
            background: this.background,
            autoWidth: this.autoWidth,
            fixedWidth: this.fixedWidth
        };
    }

    /**
     * Create from plain object
     */
    static fromJSON(json) {
        const layer = new TextLayer(json);
        layer.id = json.id || layer.id;
        return layer;
    }
}

/**
 * Text Presets
 */
export const TextPresets = {
    heading: {
        content: 'Add a heading',
        fontSize: 64,
        fontWeight: 700
    },
    subheading: {
        content: 'Add a subheading',
        fontSize: 36,
        fontWeight: 500
    },
    body: {
        content: 'Add body text',
        fontSize: 24,
        fontWeight: 400
    },
    caption: {
        content: 'Add a caption',
        fontSize: 16,
        fontWeight: 400,
        color: '#cccccc'
    }
};
