/**
 * Vercel Serverless Function - Replicate API Proxy
 * 
 * This keeps the API key server-side only.
 * Set REPLICATE_API_TOKEN in Vercel Dashboard → Settings → Environment Variables
 */

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiToken = process.env.REPLICATE_API_TOKEN;

    if (!apiToken) {
        console.error('REPLICATE_API_TOKEN not configured');
        return res.status(500).json({ error: 'API not configured' });
    }

    try {
        const { action, ...payload } = req.body;

        let url = 'https://api.replicate.com/v1/predictions';
        let method = 'POST';
        let body = null;

        if (action === 'create') {
            // Create new prediction
            body = JSON.stringify({
                version: payload.version,
                input: payload.input
            });
        } else if (action === 'status') {
            // Check prediction status
            url = `https://api.replicate.com/v1/predictions/${payload.predictionId}`;
            method = 'GET';
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }

        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Token ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: method === 'POST' ? body : undefined
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.status(200).json(data);

    } catch (error) {
        console.error('Replicate proxy error:', error);
        return res.status(500).json({ error: 'Proxy error' });
    }
}
