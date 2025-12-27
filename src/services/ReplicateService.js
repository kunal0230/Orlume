/**
 * ReplicateService - API integration for AI features
 * 
 * In DEVELOPMENT: Uses Vite proxy (/api/replicate) → Replicate API
 * In PRODUCTION: Uses Vercel serverless function (/api/replicate) → Replicate API
 * 
 * The API key is NEVER exposed to the client:
 * - Dev: Set in .env.local (VITE_REPLICATE_API_TOKEN)
 * - Prod: Set in Vercel Dashboard (REPLICATE_API_TOKEN)
 */

export class ReplicateService {
    constructor() {
        // Both dev and prod use /api/replicate - but they're different implementations:
        // - Dev: Vite proxy (see vite.config.js)
        // - Prod: Vercel serverless function (see /api/replicate.js)
        this.proxyUrl = '/api/replicate';

        // In dev, we still need the token for the Vite proxy
        // In prod, the token is handled server-side
        this.isDev = import.meta.env.DEV;
        this.apiToken = this.isDev ? (import.meta.env.VITE_REPLICATE_API_TOKEN || '') : 'SERVER_SIDE';

        // Model versions
        this.models = {
            lama: {
                owner: 'allenhooo',
                name: 'lama',
                version: 'cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72'
            },
            gfpgan: {
                owner: 'tencentarc',
                name: 'gfpgan',
                version: '0fbacf7afc6c144e5be9767cff80f25aff23e52b0708f17e20f9879b2f21516c'
            },
            codeformer: {
                owner: 'sczhou',
                name: 'codeformer',
                version: 'cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2'
            },
            rembg: {
                owner: 'cjwbw',
                name: 'rembg',
                version: 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003'
            }
        };

        // Polling configuration
        this.pollInterval = 1000; // 1 second
        this.maxPolls = 120; // 2 minutes max
    }

    /**
     * Check if API is available
     */
    hasApiToken() {
        // In production, always return true (server handles it)
        // In dev, check for the environment variable
        return !this.isDev || (!!this.apiToken && this.apiToken.length > 0);
    }

    /**
     * Make a prediction request
     */
    async predict(modelKey, input) {
        const model = this.models[modelKey];
        if (!model) {
            throw new Error(`Unknown model: ${modelKey}`);
        }

        console.log(`🚀 Starting ${modelKey} prediction...`);

        let response;

        if (this.isDev) {
            // Development: Use Vite proxy with direct API
            response = await fetch(`${this.proxyUrl}/predictions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    version: model.version,
                    input: input
                })
            });
        } else {
            // Production: Use Vercel serverless function
            response = await fetch(this.proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'create',
                    version: model.version,
                    input: input
                })
            });
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`API error: ${error.detail || error.error || response.statusText}`);
        }

        const prediction = await response.json();
        console.log(`📋 Prediction created: ${prediction.id}`);

        // Poll for result
        return this.pollForResult(prediction.id);
    }

    /**
     * Poll for prediction result
     */
    async pollForResult(predictionId) {
        let polls = 0;

        while (polls < this.maxPolls) {
            let response;

            if (this.isDev) {
                // Development: Use Vite proxy
                response = await fetch(`${this.proxyUrl}/predictions/${predictionId}`, {
                    headers: {
                        'Authorization': `Token ${this.apiToken}`
                    }
                });
            } else {
                // Production: Use Vercel serverless function
                response = await fetch(this.proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'status',
                        predictionId: predictionId
                    })
                });
            }

            if (!response.ok) {
                throw new Error(`Failed to get prediction status`);
            }

            const prediction = await response.json();

            if (prediction.status === 'succeeded') {
                console.log(`✅ Prediction completed!`);
                return prediction.output;
            }

            if (prediction.status === 'failed') {
                throw new Error(`Prediction failed: ${prediction.error}`);
            }

            if (prediction.status === 'canceled') {
                throw new Error('Prediction was canceled');
            }

            // Still processing
            polls++;
            await this.sleep(this.pollInterval);
        }

        throw new Error('Prediction timed out');
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== Feature Methods ====================

    /**
     * Spot Healing / Inpainting using LaMa
     */
    async inpaint(imageDataUrl, maskDataUrl) {
        return this.predict('lama', {
            image: imageDataUrl,
            mask: maskDataUrl
        });
    }

    /**
     * Face Enhancement using GFPGAN
     */
    async enhanceFace(imageDataUrl, scale = 2) {
        return this.predict('gfpgan', {
            img: imageDataUrl,
            scale: scale,
            version: 'v1.4'
        });
    }

    /**
     * Face Restoration using CodeFormer
     */
    async restoreFace(imageDataUrl, fidelity = 0.7) {
        return this.predict('codeformer', {
            image: imageDataUrl,
            codeformer_fidelity: fidelity,
            upscale: 2,
            face_upsample: true,
            background_enhance: true
        });
    }

    /**
     * Background Removal using rembg
     */
    async removeBackground(imageDataUrl) {
        return this.predict('rembg', {
            image: imageDataUrl
        });
    }
}

// Export singleton instance
export const replicateService = new ReplicateService();
