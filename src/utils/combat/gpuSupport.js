export async function getGpuDevice() {
    if (!navigator.gpu) return null;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return null;
        return await adapter.requestDevice();
    } catch {
        return null;
    }
}
