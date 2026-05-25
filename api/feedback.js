/**
 * Vercel Serverless Function — Feedback Email Sender
 * 
 * Uses Resend (https://resend.com) to deliver feedback emails.
 * Free tier: 3,000 emails/month — more than enough for feedback.
 * 
 * Required env var: RESEND_API_KEY
 * Set it in Vercel Dashboard → Settings → Environment Variables
 */

// Simple in-memory rate limiter (resets on cold start, ~5min window)
const submissions = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 3; // max 3 submissions per minute per IP

function isRateLimited(ip) {
    const now = Date.now();
    const record = submissions.get(ip);

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
        submissions.set(ip, { windowStart: now, count: 1 });
        return false;
    }

    if (record.count >= RATE_LIMIT_MAX) {
        return true;
    }

    record.count++;
    return false;
}

export default async function handler(req, res) {
    // CORS headers for the editor (same-origin) and feedback page
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.error('RESEND_API_KEY not configured');
        return res.status(500).json({ success: false, message: 'Email service not configured' });
    }

    // Rate limiting
    const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    if (isRateLimited(clientIp)) {
        return res.status(429).json({ success: false, message: 'Too many submissions. Please wait a moment.' });
    }

    try {
        const body = req.body;

        // Honeypot check (spam bots fill hidden fields)
        if (body._honey || body.honeypot) {
            // Silently accept but don't send — fools the bot
            return res.status(200).json({ success: true, message: 'Feedback submitted successfully!' });
        }

        // Validate required fields
        const message = body.message || body.Description || '';
        if (!message.trim()) {
            return res.status(400).json({ success: false, message: 'Message is required.' });
        }

        // Build email content from either editor modal or feedback page fields
        const source = body.tool_context ? 'Editor' : 'Feedback Page';
        const category = body.Category || 'General';
        const toolContext = body.tool_context || 'N/A';
        const subject = body.Subject || body._subject || `Orlume Feedback — ${category}`;
        const priority = body.Priority || 'N/A';
        const userName = body.Name || 'Anonymous';
        const userEmail = body.email || body.Email || '';
        const environment = body.Environment || 'N/A';

        // Validate email format if provided
        if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid email address (e.g. you@example.com).' });
        }

        // Build a clean HTML email
        const htmlBody = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; border-radius: 12px 12px 0 0;">
                    <h1 style="color: white; margin: 0; font-size: 20px;">📬 New Feedback — ${category}</h1>
                </div>
                <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr>
                            <td style="padding: 8px 12px; font-weight: 600; color: #374151; width: 120px; vertical-align: top;">Source</td>
                            <td style="padding: 8px 12px; color: #6b7280;">${source}</td>
                        </tr>
                        <tr style="background: #ffffff;">
                            <td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">Category</td>
                            <td style="padding: 8px 12px; color: #6b7280;">${category}</td>
                        </tr>
                        ${toolContext !== 'N/A' ? `<tr><td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">Tool</td><td style="padding: 8px 12px; color: #6b7280;">${toolContext}</td></tr>` : ''}
                        ${priority !== 'N/A' ? `<tr style="background: #ffffff;"><td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">Priority</td><td style="padding: 8px 12px; color: #6b7280;">${priority}</td></tr>` : ''}
                        <tr>
                            <td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">Subject</td>
                            <td style="padding: 8px 12px; color: #6b7280;">${subject}</td>
                        </tr>
                        <tr style="background: #ffffff;">
                            <td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">From</td>
                            <td style="padding: 8px 12px; color: #6b7280;">${userName} ${userEmail ? `(${userEmail})` : ''}</td>
                        </tr>
                        ${environment !== 'N/A' ? `<tr><td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">Environment</td><td style="padding: 8px 12px; color: #6b7280;">${environment}</td></tr>` : ''}
                    </table>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
                    <div style="padding: 12px; background: white; border-radius: 8px; border: 1px solid #e5e7eb;">
                        <p style="margin: 0 0 8px; font-weight: 600; color: #374151; font-size: 13px;">Message:</p>
                        <p style="margin: 0; color: #4b5563; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                    </div>
                </div>
            </div>
        `;

        // Send via Resend API
        const resendResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'Orlume Feedback <feedback@orlume.io>',
                to: ['kunalchaugule36@gmail.com'],
                subject: `[Orlume ${source}] ${subject}`,
                html: htmlBody,
                reply_to: userEmail || undefined
            })
        });

        const resendData = await resendResponse.json();

        if (!resendResponse.ok) {
            console.error('Resend API error:', resendData);
            return res.status(502).json({ 
                success: false, 
                message: 'Failed to send feedback. Please try again later.' 
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Feedback submitted successfully! Thank you.' 
        });

    } catch (error) {
        console.error('Feedback handler error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An unexpected error occurred. Please try again.' 
        });
    }
}
