export async function isWasmSupported() {
    if (typeof WebAssembly !== 'object') return false;
    try {
        const module = new WebAssembly.Module(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
        return module instanceof WebAssembly.Module;
    } catch {
        return false;
    }
}
