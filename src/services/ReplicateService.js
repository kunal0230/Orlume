/**
 * ReplicateService - API integration for AI features
 * 
 * Provides access to:
 * - LaMa: Spot healing / inpainting
 * - GFPGAN: Face enhancement
 * - CodeFormer: Face restoration
 * - rembg: Background removal
 */

export class ReplicateService {
    constructor() {
        this.baseUrl = 'https://api.replicate.com/v1';
        this.apiToken = localStorage.getItem('replicate_api_token') || '';

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
     * Set the API token
     */
    setApiToken(token) {
        this.apiToken = token;
        localStorage.setItem('replicate_api_token', token);
        console.log('✅ Replicate API token saved');
    }

    /**
     * Get current API token
     */
    getApiToken() {
        return this.apiToken;
    }

    /**
     * Check if API token is configured
     */
    hasApiToken() {
        return !!this.apiToken && this.apiToken.length > 0;
    }

    /**
     * Clear the API token
     */
    clearApiToken() {
        this.apiToken = '';
        localStorage.removeItem('replicate_api_token');
    }

    /**
     * Make a prediction request
     */
    async predict(modelKey, input) {
        if (!this.hasApiToken()) {
            throw new Error('Replicate API token not configured');
        }

        const model = this.models[modelKey];
        if (!model) {
            throw new Error(`Unknown model: ${modelKey}`);
        }

        console.log(`🚀 Starting ${modelKey} prediction...`);

        const response = await fetch(`${this.baseUrl}/predictions`, {
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

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`API error: ${error.detail || response.statusText}`);
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
            const response = await fetch(`${this.baseUrl}/predictions/${predictionId}`, {
                headers: {
                    'Authorization': `Token ${this.apiToken}`
                }
            });

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
     * @param {string} imageDataUrl - Base64 image data URL
     * @param {string} maskDataUrl - Base64 mask data URL (white = area to heal)
     */
    async inpaint(imageDataUrl, maskDataUrl) {
        return this.predict('lama', {
            image: imageDataUrl,
            mask: maskDataUrl
        });
    }

    /**
     * Face Enhancement using GFPGAN
     * @param {string} imageDataUrl - Base64 image data URL
     * @param {number} scale - Upscale factor (1, 2, 4)
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
     * @param {string} imageDataUrl - Base64 image data URL
     * @param {number} fidelity - 0-1, higher = more faithful to input
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
     * @param {string} imageDataUrl - Base64 image data URL
     */
    async removeBackground(imageDataUrl) {
        return this.predict('rembg', {
            image: imageDataUrl
        });
    }

    /**
     * Test API connection
     */
    async testConnection() {
        if (!this.hasApiToken()) {
            return { success: false, error: 'No API token configured' };
        }

        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Token ${this.apiToken}`
                }
            });

            if (response.ok) {
                return { success: true };
            } else {
                const error = await response.json();
                return { success: false, error: error.detail || 'Connection failed' };
            }
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
}

// Export singleton instance
export const replicateService = new ReplicateService();
