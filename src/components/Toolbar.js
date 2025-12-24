/**
 * Toolbar Component
 * Handles tool selection and toolbar UI
 */

export class Toolbar {
    constructor(app) {
        this.app = app;
        this.init();
    }

    init() {
        const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');

        toolButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                this.selectTool(tool);
            });
        });
    }

    selectTool(tool) {
        // Update button states
        const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
        toolButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        // Disable effects when switching
        this.app.components.parallax?.disable();
        this.app.components.relighting?.disable();

        // Exit 3D mode if not selecting 3D tool
        if (tool !== '3d' && this.app.state.is3DMode) {
            this.app.toggle3DMode(false);
        }

        // Notify app
        this.app.setTool(tool);
    }
}
