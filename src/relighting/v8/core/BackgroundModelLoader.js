/**
 * BackgroundModelLoader.js - v8 Relighting System
 * 
 * Loads AI models in background when app opens, NOT when user clicks "Relight".
 * By the time user needs relighting, models are already cached and ready.
 * 
 * Key strategy:
 * - Fire-and-forget loading on app init
 * - Priority-ordered: depth → normals → intrinsic → materials
 * - Cache Storage for persistence across sessions
 * - Progressive feature enablement
 * - Non-blocking progress indicators
 */

import { EventEmitter } from './EventEmitter.js';

export class BackgroundModelLoader extends EventEmitter {
    constructor(options = {}) {
        super();

        // Model configuration
        this.models = {
            depth: {
                id: 'depth-estimation',
                // Using HuggingFace Transformers.js model IDs
                modelId: 'Xenova/depth-anything-small-hf',
                size: 24, // MB (quantized)
                priority: 1,
                loaded: false,
                pipeline: null,
                description: 'Depth estimation'
            },
            normals: {
                id: 'normals',
                // Will use depth-derived normals for now (no separate model)
                // Future: Omnidata-large when available
                size: 0,
                priority: 2,
                loaded: true, // Derived from depth
                pipeline: null,
                description: 'Surface normals'
            },
            // Future: intrinsic decomposition model
            // Future: PBR material estimation model
        };

        this.totalSize = Object.values(this.models).reduce((sum, m) => sum + m.size, 0);
        this.loadedSize = 0;

        // Loading state
        this.isLoading = false;
        this.loadingComplete = false;
        this.loadError = null;

        // Options
        this.autoStart = options.autoStart !== false;
        this.cacheVersion = options.cacheVersion || 'v8-1';
    }

    /**
     * Start background loading (call on app open)
     * Non-blocking, fire-and-forget
     */
    async startLoading() {
        if (this.isLoading || this.loadingComplete) {
            return;
        }

        this.isLoading = true;
        console.log('🚀 Starting background model loading...');

        try {
            // Check what's already cached
            const cacheStatus = await this._checkCacheStatus();

            if (cacheStatus.allCached) {
                console.log('✓ All models cached, instant ready!');
                this._markAllLoaded();
                return;
            }

            // Load in priority order
            await this._loadInPriorityOrder();

            this.loadingComplete = true;
            this.emit('all-models-ready');
            console.log('✓ All models loaded and ready!');

        } catch (error) {
            console.error('❌ Model loading failed:', error);
            this.loadError = error;
            this.emit('loading-error', { error });
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Load models in priority order
     */
    async _loadInPriorityOrder() {
        const sortedModels = Object.entries(this.models)
            .filter(([_, m]) => m.size > 0) // Skip derived models
            .sort((a, b) => a[1].priority - b[1].priority);

        for (const [name, model] of sortedModels) {
            if (model.loaded) continue;

            try {
                await this._loadModel(name, model);
            } catch (error) {
                console.error(`Failed to load ${name}:`, error);
                // Continue with other models
                this.emit('model-error', { model: name, error });
            }
        }
    }

    /**
     * Load a single model
     */
    async _loadModel(name, model) {
        console.log(`⬇ Loading ${name} model (${model.size}MB)...`);

        this.emit('model-loading', {
            model: name,
            description: model.description,
            size: model.size
        });

        // Import transformers.js dynamically
        const { pipeline } = await import('@huggingface/transformers');

        // Create pipeline with progress callback
        model.pipeline = await pipeline(model.id, model.modelId, {
            progress_callback: (progress) => {
                if (progress.status === 'progress') {
                    const percent = Math.round((progress.loaded / progress.total) * 100);
                    this._emitProgress(name, percent, progress.loaded, progress.total);
                }
            }
        });

        model.loaded = true;
        this.loadedSize += model.size;

        console.log(`✓ ${name} model ready (${this.loadedSize}/${this.totalSize}MB)`);

        this.emit('model-loaded', { model: name });
        this._emitTotalProgress();
        this._checkFeatureEnablement();
    }

    /**
     * Emit progress for a specific model
     */
    _emitProgress(modelName, percent, loaded, total) {
        this.emit('model-progress', {
            model: modelName,
            percent,
            loaded,
            total
        });
    }

    /**
     * Emit overall progress
     */
    _emitTotalProgress() {
        const totalPercent = this.totalSize > 0
            ? Math.round((this.loadedSize / this.totalSize) * 100)
            : 100;

        this.emit('total-progress', {
            percent: totalPercent,
            loadedSize: this.loadedSize,
            totalSize: this.totalSize
        });
    }

    /**
     * Check which features are now available
     */
    _checkFeatureEnablement() {
        const features = this.getAvailableFeatures();

        if (features.basicRelight && !this._basicRelightEmitted) {
            this._basicRelightEmitted = true;
            this.emit('feature-enabled', { feature: 'basic-relight' });
        }

        if (features.qualityRelight && !this._qualityRelightEmitted) {
            this._qualityRelightEmitted = true;
            this.emit('feature-enabled', { feature: 'quality-relight' });
        }

        if (features.maximumQuality && !this._maxQualityEmitted) {
            this._maxQualityEmitted = true;
            this.emit('feature-enabled', { feature: 'maximum-quality' });
        }
    }

    /**
     * Get currently available features based on loaded models
     */
    getAvailableFeatures() {
        return {
            basicRelight: this.models.depth.loaded,
            qualityRelight: this.models.depth.loaded && this.models.normals.loaded,
            maximumQuality: Object.values(this.models).every(m => m.loaded)
        };
    }

    /**
     * Check cache status
     */
    async _checkCacheStatus() {
        try {
            const cache = await caches.open(`relighting-models-${this.cacheVersion}`);
            const keys = await cache.keys();

            const cachedModels = new Set(
                keys.map(req => new URL(req.url).pathname.split('/').pop())
            );

            let allCached = true;
            let totalCachedSize = 0;

            for (const [name, model] of Object.entries(this.models)) {
                if (model.size === 0) continue; // Skip derived

                if (cachedModels.has(name)) {
                    model.loaded = true;
                    totalCachedSize += model.size;
                } else {
                    allCached = false;
                }
            }

            this.loadedSize = totalCachedSize;

            return { allCached, cachedModels: Array.from(cachedModels) };

        } catch (error) {
            console.warn('Cache check failed:', error);
            return { allCached: false, cachedModels: [] };
        }
    }

    /**
     * Mark all models as loaded (for cache hit case)
     */
    _markAllLoaded() {
        for (const model of Object.values(this.models)) {
            model.loaded = true;
        }
        this.loadedSize = this.totalSize;
        this.loadingComplete = true;
        this._checkFeatureEnablement();
        this._emitTotalProgress();
    }

    /**
     * Get a loaded pipeline
     */
    getPipeline(name) {
        const model = this.models[name];
        if (!model || !model.loaded) {
            throw new Error(`Model ${name} not loaded`);
        }
        return model.pipeline;
    }

    /**
     * Check if ready for relighting
     */
    isReady() {
        return this.models.depth.loaded;
    }

    /**
     * Check if all models are loaded
     */
    isFullyLoaded() {
        return this.loadingComplete;
    }

    /**
     * Get loading status summary
     */
    getStatus() {
        return {
            isLoading: this.isLoading,
            isReady: this.isReady(),
            isFullyLoaded: this.isFullyLoaded(),
            loadedSize: this.loadedSize,
            totalSize: this.totalSize,
            percent: this.totalSize > 0
                ? Math.round((this.loadedSize / this.totalSize) * 100)
                : 100,
            error: this.loadError,
            models: Object.entries(this.models).map(([name, m]) => ({
                name,
                loaded: m.loaded,
                size: m.size
            }))
        };
    }

    /**
     * Clear all cached models
     */
    async clearCache() {
        try {
            await caches.delete(`relighting-models-${this.cacheVersion}`);

            // Reset state
            for (const model of Object.values(this.models)) {
                if (model.size > 0) {
                    model.loaded = false;
                    model.pipeline = null;
                }
            }
            this.loadedSize = 0;
            this.loadingComplete = false;

            console.log('✓ Model cache cleared');
            return true;
        } catch (error) {
            console.error('Failed to clear cache:', error);
            return false;
        }
    }
}

export default BackgroundModelLoader;
