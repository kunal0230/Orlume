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
                owner: '851-labs',
                name: 'background-remover',
                version: 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc'
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

    /**
     * Fetch an image URL and return as data URL (bypasses CORS)
     */
    async fetchImageAsDataUrl(imageUrl) {


        if (this.isDev) {
            // In dev mode, try direct fetch first (might work with some URLs)
            try {
                const response = await fetch(imageUrl);
                const blob = await response.blob();
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch (error) {
                // Direct fetch failed, falling back to proxy
            }
        }

        // Use serverless proxy
        const response = await fetch(this.isDev ? `${this.proxyUrl.replace('/v1', '')}/fetch-image` : this.proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.isDev && { 'Authorization': `Token ${this.apiToken}` })
            },
            body: JSON.stringify({
                action: 'fetch-image',
                imageUrl: imageUrl
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`);
        }

        const data = await response.json();

        return data.dataUrl;
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
