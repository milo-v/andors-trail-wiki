// Build strategy: `wasm-pack build --target web` emits ES module glue + a
// `.wasm` binary directly into `src/wasm/optimizer-core/` (see the
// `build:wasm` npm script). We copy-on-build into `src/` rather than
// relying on CRA's built-in WASM asset support, since CRA's webpack config
// does not reliably resolve `.wasm` imports out of `node_modules`-style
// packages without ejecting — importing pre-generated JS glue from `src/`
// sidesteps that entirely.

use wasm_bindgen::prelude::*;

mod combat_math;
mod level_model;
mod model;
mod proc_effects;
mod search;
mod skill_data;
mod stat_engine;

#[wasm_bindgen]
pub fn ping(n: u32) -> u32 {
    n + 1
}

// JSON-string in/out is the simplest wasm-bindgen boundary (Step 1 of Phase
// A5) and matches the shape JS already builds for optimizerWorker.js's
// event.data today, so wasmSearchCoordinator.js can send the same
// build/targets/itemsById/conditionsById/candidateLists/limitedItemIds/
// maxHpLoss shape it already assembles.
#[wasm_bindgen]
pub fn search_best_builds_js(config_json: &str) -> String {
    console_error_panic_hook::set_once();
    let config: model::SearchConfig = serde_json::from_str(config_json).expect("invalid search config JSON");
    let shard_config: search::ShardConfig = (&config).into();
    let result = search::search_best_builds(&shard_config);
    serde_json::to_string(&result).expect("failed to serialize search result")
}
