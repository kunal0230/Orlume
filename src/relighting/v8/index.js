/**
 * v8 Relighting System - Main Entry Point
 * 
 * Export all modules for easy importing
 */

// Core modules
export { RelightingPipeline } from './core/RelightingPipeline.js';
export { ResolutionManager, UserCancelledError } from './core/ResolutionManager.js';
export { ColorSpaceConverter } from './core/ColorSpaceConverter.js';
export { BackgroundModelLoader } from './core/BackgroundModelLoader.js';
export { EventEmitter } from './core/EventEmitter.js';

// Rendering
export { RenderingEngine } from './rendering/RenderingEngine.js';
export { WebGPURenderer } from './rendering/WebGPURenderer.js';
export { WebGL2DeferredRenderer } from './rendering/WebGL2DeferredRenderer.js';

// Confidence system
export { ConfidenceEstimator } from './confidence/ConfidenceEstimator.js';
export { LightingAnalyzer } from './confidence/LightingAnalyzer.js';

// Default export is the main pipeline
export { default } from './core/RelightingPipeline.js';

