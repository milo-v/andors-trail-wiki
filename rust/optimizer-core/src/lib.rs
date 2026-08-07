// Build strategy: `wasm-pack build --target web` emits ES module glue + a
// `.wasm` binary directly into `src/wasm/optimizer-core/` (see the
// `build:wasm` npm script). We copy-on-build into `src/` rather than
// relying on CRA's built-in WASM asset support, since CRA's webpack config
// does not reliably resolve `.wasm` imports out of `node_modules`-style
// packages without ejecting — importing pre-generated JS glue from `src/`
// sidesteps that entirely.

use wasm_bindgen::prelude::*;

mod level_model;
mod model;
mod proc_effects;
mod skill_data;
mod stat_engine;

#[wasm_bindgen]
pub fn ping(n: u32) -> u32 {
    n + 1
}
