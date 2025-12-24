/**
 * HistoryManager
 * Manages application state for Undo/Redo functionality
 */
export class HistoryManager {
    constructor(app, limit = 20) {
        this.app = app;
        this.limit = limit;
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Push a new state to history
     * @param {Object} state - { image, depthMap }
     */
    push(state) {
        // Deep copy text/simple data, but store references for large objects (Image, DepthMap).
        // Since Image/DepthMap objects are replaced on edit (new instances), storing references is fine.
        // If we mutated them in place, we'd need to clone.
        // Our pipeline creates NEW Image/DepthMap objects on transform, so references work.

        this.undoStack.push(state);

        // Cap limit
        if (this.undoStack.length > this.limit) {
            this.undoStack.shift();
        }

        // Clear redo
        this.redoStack = [];

        this.updateUI();
    }

    undo() {
        if (this.undoStack.length === 0) return null;

        const currentState = {
            image: this.app.state.image,
            depthMap: this.app.state.depthMap
        };
        this.redoStack.push(currentState);

        const prevState = this.undoStack.pop();
        this.updateUI();
        return prevState;
    }

    redo() {
        if (this.redoStack.length === 0) return null;

        const currentState = {
            image: this.app.state.image,
            depthMap: this.app.state.depthMap
        };
        this.undoStack.push(currentState);

        const nextState = this.redoStack.pop();
        this.updateUI();
        return nextState;
    }

    updateUI() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');

        if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
        if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;
    }
}
