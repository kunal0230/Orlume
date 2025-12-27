/**
 * MaskSystem Factory - Creates appropriate mask system based on GPU backend
 * 
 * Returns WebGPU or WebGL2 MaskSystem based on the active backend.
 */

export async function createMaskSystem(gpuProcessor) {
    const backendName = gpuProcessor.backend?.getName();

    if (backendName === 'WebGPU') {
        // Use WebGPU MaskSystem
        const { MaskSystemWebGPU } = await import('./MaskSystemWebGPU.js');
        const maskSystem = new MaskSystemWebGPU(gpuProcessor.backend);
        await maskSystem.init();
        return maskSystem;
    }

    // Default to WebGL2 MaskSystem
    const { MaskSystem } = await import('./MaskSystem.js');
    return new MaskSystem(gpuProcessor);
}
