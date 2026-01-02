/**
 * Vercel Analytics and Speed Insights Integration
 * Automatically injected into all pages
 */
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

// Initialize Vercel Analytics
inject();

// Initialize Speed Insights
injectSpeedInsights();

console.log('📊 Vercel Analytics initialized');
