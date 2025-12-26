/**
 * HistoryManager - Undo/Redo system for editor adjustments
 * 
 * Tracks snapshots of adjustment state and allows stepping
 * backwards and forwards through history.
 */

export class HistoryManager {
    constructor(maxHistory = 50) {
        this.maxHistory = maxHistory;
        this.history = [];
        this.currentIndex = -1;
        this._listeners = [];
    }

    /**
     * Push a new state snapshot to history
     * @param {Object} snapshot - State snapshot to save
     */
    pushState(snapshot) {
        // If we're not at the end of history, truncate future states
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }

        // Add new state
        this.history.push(JSON.parse(JSON.stringify(snapshot)));
        this.currentIndex = this.history.length - 1;

        // Trim if exceeds max
        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.currentIndex--;
        }

        this._notifyListeners();
    }

    /**
     * Undo - go back one step in history
     * @returns {Object|null} Previous state or null if at beginning
     */
    undo() {
        if (!this.canUndo()) return null;
        // Return the current state BEFORE decrementing
        // This gives us the state we pushed before the last action
        const state = JSON.parse(JSON.stringify(this.history[this.currentIndex]));
        this.currentIndex--;
        this._notifyListeners();
        return state;
    }

    /**
     * Redo - go forward one step in history
     * @returns {Object|null} Next state or null if at end
     */
    redo() {
        if (!this.canRedo()) return null;
        this.currentIndex++;
        this._notifyListeners();
        return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
    }

    /**
     * Check if undo is available
     */
    canUndo() {
        return this.currentIndex > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }

    /**
     * Get current state
     */
    getCurrentState() {
        if (this.currentIndex < 0 || this.currentIndex >= this.history.length) {
            return null;
        }
        return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
    }

    /**
     * Clear all history
     */
    clear() {
        this.history = [];
        this.currentIndex = -1;
        this._notifyListeners();
    }

    /**
     * Subscribe to history changes
     */
    onChange(callback) {
        this._listeners.push(callback);
        return () => {
            const index = this._listeners.indexOf(callback);
            if (index > -1) this._listeners.splice(index, 1);
        };
    }

    /**
     * Notify listeners of state change
     */
    _notifyListeners() {
        this._listeners.forEach(cb => cb({
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            historyLength: this.history.length,
            currentIndex: this.currentIndex
        }));
    }

    /**
     * Get history info for debugging
     */
    getInfo() {
        return {
            length: this.history.length,
            currentIndex: this.currentIndex,
            canUndo: this.canUndo(),
            canRedo: this.canRedo()
        };
    }
}
