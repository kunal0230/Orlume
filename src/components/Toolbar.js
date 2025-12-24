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
        // Handle both main buttons and flyout items
        const toolButtons = document.querySelectorAll('[data-tool]');

        toolButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent bubbling issues
                const tool = btn.dataset.tool;
                this.selectTool(tool);
            });
        });
    }

    selectTool(tool) {
        // Update button states
        const toolButtons = document.querySelectorAll('[data-tool]');
        toolButtons.forEach(btn => {
            const isActive = btn.dataset.tool === tool;
            btn.classList.toggle('active', isActive);

            // If this button is active and inside a flyout, activate the parent group
            if (isActive) {
                const flyout = btn.closest('.tool-flyout');
                if (flyout) {
                    const groupBtn = flyout.parentElement.querySelector('[data-group]');
                    if (groupBtn) groupBtn.classList.add('active');
                }
            }
        });

        // Deactivate groups if we switched to a root-level tool (like select)
        if (tool === 'select') {
            document.querySelectorAll('[data-group]').forEach(btn => btn.classList.remove('active'));
        } else {
            // Ensure we don't have multiple groups active (future proofing)
            // If current tool is NOT in a group, or is in Group A, make sure Group B is inactive
            const activeToolBtn = document.querySelector(`[data-tool="${tool}"]`);
            const activeGroup = activeToolBtn?.closest('.tool-group-wrapper');

            document.querySelectorAll('.tool-group-wrapper').forEach(wrapper => {
                if (wrapper !== activeGroup) {
                    const groupBtn = wrapper.querySelector('[data-group]');
                    if (groupBtn) groupBtn.classList.remove('active');
                }
            });
        }

        // Disable effects when switching
        this.app.components.parallax?.disable();
        this.app.components.relighting?.disable();
        this.app.components.transformTool?.deactivate();

        // Exit 3D mode if not selecting 3D tool
        if (tool !== '3d' && this.app.state.is3DMode) {
            this.app.toggle3DMode(false);
        }

        // Notify app
        this.app.setTool(tool);
    }
}
