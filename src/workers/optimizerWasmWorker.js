/* eslint-disable no-restricted-globals */
import init, { search_best_builds_js } from '../wasm/optimizer-core/optimizer_core.js';

let ready = init();

// Rust calls this every PROGRESS_REPORT_INTERVAL combos (search.rs), which
// on a fast shard (cheap combat-summary computation, few slots) can fire far
// more often than the main thread can absorb a setState/re-render for -
// without this wall-clock throttle, a burst of postMessage calls floods the
// main thread's event loop and the page freezes solid until the search
// finishes (observed: a multi-minute unresponsive tab pegged at >1000% CPU).
const MIN_PROGRESS_POST_INTERVAL_MS = 200;

self.onmessage = async (event) => {
    await ready;
    const { configJson } = event.data;
    try {
        let lastPostTime = 0;
        const resultJson = search_best_builds_js(configJson, (evaluated, total) => {
            const now = Date.now();
            if (now - lastPostTime < MIN_PROGRESS_POST_INTERVAL_MS) return;
            lastPostTime = now;
            self.postMessage({ type: 'progress', evaluated, total });
        });
        self.postMessage({ type: 'done', resultJson });
    } catch (err) {
        self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
    }
};
