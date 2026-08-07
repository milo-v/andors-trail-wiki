/* eslint-disable no-restricted-globals */
import init, { search_best_builds_js } from '../wasm/optimizer-core/optimizer_core.js';

let ready = init();

self.onmessage = async (event) => {
    await ready;
    const { configJson } = event.data;
    try {
        const resultJson = search_best_builds_js(configJson);
        self.postMessage({ type: 'done', resultJson });
    } catch (err) {
        self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
    }
};
