/**
 * ModelCache.js - IndexedDB Cache for ML Models
 * 
 * Stores model weights in browser's IndexedDB to avoid re-downloading
 * on subsequent visits. Models can be ~25-100MB, so caching is crucial.
 * 
 * Usage:
 *   const cache = new ModelCache();
 *   await cache.init();
 *   
 *   // Check if cached
 *   const info = await cache.getModelInfo('depth-small');
 *   
 *   // Clear specific model
 *   await cache.clearModel('depth-base');
 */

const DB_NAME = 'orlume-model-cache';
const DB_VERSION = 1;
const STORE_NAME = 'models';

export class ModelCache {
    constructor() {
        this.db = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the IndexedDB database
     */
    async init() {
        if (this.isInitialized) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                console.log('✅ Model cache initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create models store if it doesn't exist
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'modelId' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('Created models store');
                }
            };
        });
    }

    /**
     * Check if a model is cached
     */
    async isModelCached(modelId) {
        const info = await this.getModelInfo(modelId);
        return info !== null;
    }

    /**
     * Get info about a cached model
     * @returns {Object|null} { modelId, timestamp, size, version } or null
     */
    async getModelInfo(modelId) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(modelId);

            request.onsuccess = () => {
                if (request.result) {
                    // Return info without the heavy weights data
                    const { modelId, timestamp, size, version } = request.result;
                    resolve({ modelId, timestamp, size, version });
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all cached models info
     * @returns {Array} List of cached model info objects
     */
    async getAllCachedModels() {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const models = request.result.map(({ modelId, timestamp, size, version }) => ({
                    modelId,
                    timestamp,
                    size,
                    version,
                    sizeFormatted: this._formatBytes(size)
                }));
                resolve(models);
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get total cache size
     * @returns {Object} { totalBytes, formatted }
     */
    async getCacheSize() {
        const models = await this.getAllCachedModels();
        const totalBytes = models.reduce((sum, m) => sum + (m.size || 0), 0);
        return {
            totalBytes,
            formatted: this._formatBytes(totalBytes)
        };
    }

    /**
     * Store model cache marker (actual caching handled by Transformers.js)
     * We just track metadata about what's cached
     */
    async markModelCached(modelId, estimatedSize) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const record = {
                modelId,
                timestamp: Date.now(),
                size: estimatedSize,
                version: '1.0'
            };

            const request = store.put(record);

            request.onsuccess = () => {
                console.log(`✅ Marked ${modelId} as cached`);
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear a specific model from cache
     * Note: This clears our marker. Browser cache cleanup is separate.
     */
    async clearModel(modelId) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(modelId);

            request.onsuccess = () => {
                console.log(`🗑️ Cleared ${modelId} from cache marker`);
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear all cached models
     */
    async clearAllModels() {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('🗑️ Cleared all cached models');
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear browser's Cache Storage for Transformers.js models
     * This is where the actual model weights are stored
     */
    async clearBrowserCache() {
        try {
            // Transformers.js uses Cache API with specific cache names
            const cacheNames = await caches.keys();
            const transformersCaches = cacheNames.filter(name =>
                name.includes('transformers') || name.includes('onnx') || name.includes('huggingface')
            );

            for (const cacheName of transformersCaches) {
                await caches.delete(cacheName);
                console.log(`🗑️ Deleted browser cache: ${cacheName}`);
            }

            // Also clear our IndexedDB markers
            await this.clearAllModels();

            return transformersCaches.length;
        } catch (error) {
            console.error('Failed to clear browser cache:', error);
            throw error;
        }
    }

    /**
     * Get storage estimate (if available)
     */
    async getStorageEstimate() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                usageFormatted: this._formatBytes(estimate.usage),
                quotaFormatted: this._formatBytes(estimate.quota),
                percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(1)
            };
        }
        return null;
    }

    /**
     * Format bytes to human readable string
     */
    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

// Singleton instance
export const modelCache = new ModelCache();
