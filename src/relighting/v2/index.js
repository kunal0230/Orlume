/**
 * v7 Relighting System - Module Exports
 * Neural Network-based depth and normal estimation
 * 
 * v7 Features:
 * - Multi-scale normal fusion
 * - Depth confidence maps
 * - Linear color space processing
 * - Advanced albedo estimation
 */

// v5 Legacy Components (for backward compatibility)
export { NeuralEstimator } from './NeuralEstimator.js';
export { HeightmapGenerator } from './HeightmapGenerator.js';
export { AlbedoEstimator } from './AlbedoEstimator.js';
export { SurfaceEstimator } from './SurfaceEstimator.js';
export { DeferredLightingShader } from './DeferredLightingShader.js';
export { LightingCompositor } from './LightingCompositor.js';
// RelightingEngine removed - replaced by RelightingEngineV7

// v7 Enhanced Components
export { NeuralEstimatorV7 } from './NeuralEstimatorV7.js';
export { AlbedoEstimatorV7 } from './AlbedoEstimatorV7.js';
export { RelightingEngineV7 } from './RelightingEngineV7.js';

