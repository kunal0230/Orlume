/**
 * EventEmitter.js - Simple event emitter for v8 modules
 * 
 * Lightweight pub/sub pattern for module communication
 */

export class EventEmitter {
    constructor() {
        this._events = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this._events.has(event)) {
            this._events.set(event, new Set());
        }
        this._events.get(event).add(callback);

        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    /**
     * Subscribe to an event once
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     */
    once(event, callback) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            callback(...args);
        };
        this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name  
     * @param {Function} callback - Handler to remove
     */
    off(event, callback) {
        const handlers = this._events.get(event);
        if (handlers) {
            handlers.delete(callback);
        }
    }

    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        const handlers = this._events.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in ${event} handler:`, error);
                }
            }
        }
    }

    /**
     * Remove all listeners for an event (or all events)
     * @param {string} [event] - Event name (optional)
     */
    removeAllListeners(event) {
        if (event) {
            this._events.delete(event);
        } else {
            this._events.clear();
        }
    }

    /**
     * Get listener count for an event
     * @param {string} event - Event name
     * @returns {number}
     */
    listenerCount(event) {
        const handlers = this._events.get(event);
        return handlers ? handlers.size : 0;
    }
}

export default EventEmitter;
