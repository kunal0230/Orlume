/**
 * EditState - Stores all edits as resolution-independent operations
 * All positions are normalized (0-1) for scaling to any resolution
 */

export class EditState {
    constructor() {
        this.reset();
    }

    reset() {
        // Light settings
        this.lights = [];
        this.lightIntensity = 1.0;
        this.lightColor = '#ffffff';
        this.ambientIntensity = 0.3;

        // Image adjustments
        this.brightness = 1.0;

        // Flat profile
        this.flatProfileEnabled = false;
        this.flatStrength = 0.5;

        // Shadow settings
        this.shadowStrength = 0.5;
    }

    // Add a point light (normalized coordinates)
    addPointLight(x, y, color, intensity) {
        this.lights.push({
            id: Date.now(),
            type: 'point',
            x: x,  // 0-1 normalized
            y: y,  // 0-1 normalized
            z: 0.5,
            color: color,
            intensity: intensity
        });
    }

    // Add a directional light
    addDirectionalLight(startX, startY, endX, endY, color, intensity) {
        const dx = endX - startX;
        const dy = endY - startY;
        const len = Math.sqrt(dx * dx + dy * dy);

        this.lights.push({
            id: Date.now(),
            type: 'directional',
            dirX: dx / len,
            dirY: dy / len,
            startX, startY, endX, endY,
            color: color,
            intensity: intensity
        });
    }

    // Remove a light by ID
    removeLight(id) {
        this.lights = this.lights.filter(l => l.id !== id);
    }

    // Update light position (for dragging)
    updateLightPosition(id, x, y) {
        const light = this.lights.find(l => l.id === id);
        if (light && light.type === 'point') {
            light.x = x;
            light.y = y;
        }
    }

    // Get serializable state for storage/export
    serialize() {
        return {
            lights: [...this.lights],
            lightIntensity: this.lightIntensity,
            lightColor: this.lightColor,
            ambientIntensity: this.ambientIntensity,
            brightness: this.brightness,
            flatProfileEnabled: this.flatProfileEnabled,
            flatStrength: this.flatStrength,
            shadowStrength: this.shadowStrength
        };
    }

    // Restore from serialized state
    deserialize(state) {
        Object.assign(this, state);
    }

    // Clone the edit state
    clone() {
        const clone = new EditState();
        clone.deserialize(this.serialize());
        return clone;
    }
}
