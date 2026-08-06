# Optimizer Native Acceleration (Rust/WASM Best-First + WebGPU Random Search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the equipment optimizer (`src/utils/combat/optimizer.js`) dramatically faster on the user's own hardware, without leaving the browser or the GitHub Pages static-hosting model, by (1) porting the best-first search's hot loop to Rust compiled to WASM and sharding it across a Web Worker pool for multi-core parallelism, and (2) evaluating the random-search mode as parallel batches on the GPU via WebGPU compute shaders.

**Architecture:** Two independent tracks, both staying entirely client-side and deployable as static files:
- **Track A (best-first → Rust/WASM):** JS keeps doing one-time, cheap work (candidate selection/sorting/pruning via `valueScoring.js`/`buildCandidateLists`). The expensive part — the best-first combinatorial search (`bestFirstCombos`) and per-combo evaluation (`computeCombatSummary`) — moves into a Rust crate compiled to `wasm32-unknown-unknown`. Because GitHub Pages cannot serve the `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers required for `SharedArrayBuffer`, multi-core scaling comes from running N independent single-threaded WASM instances in N Web Workers (message-passing, no shared memory), each searching its own shard of the weapon/shield dimension.
- **Track B (random search → WebGPU):** Item/monster/condition data is flattened into structure-of-arrays typed buffers, including a dense condition-ID table and fixed proc slots per item. A WGSL compute shader implements the full `computeCombatSummary` formula (base damage/hit-chance, AP deltas, proc conditions including horde-mode ramp-up, kill-triggered effects), evaluating one random combo per GPU thread. The CPU generates large batches of random index-tuples, dispatches them, and reduces the returned results to a top-10 list.

**Tech Stack:** Rust + `wasm-bindgen`/`wasm-pack` (Track A), WebGPU + WGSL (Track B), existing React 17 / CRA app, Web Workers.

## Global Constraints

- Must keep working as a static site on GitHub Pages — no custom response headers, no server component.
- Must degrade gracefully: browsers without WebAssembly, without WebGPU, or on hardware where either underperforms must fall back to the existing pure-JS engine (`src/utils/combat/optimizer.js`) with no loss of functionality.
- Must not change the optimizer's observable results (top-10 builds, `hpLossPerKill`/`damagePerTurn` values) beyond floating-point rounding tolerance — this is a performance change, not a behavior change.
- Existing pure-JS engine and worker (`src/workers/optimizerWorker.js`) stay in the codebase as the fallback; do not delete them.
- Follow the "no automated tests kept in the repo" project convention: write throwaway verification scripts/tests during development, delete them before considering a task done, unless the plan step below is explicitly a Rust `#[test]` (those live with the Rust crate, which is new source, not app test suite churn) — see Task A-by-A test steps for which is which.

---

## Track A: Best-first search → Rust/WASM, worker-pool sharded

### Task A1: Rust crate scaffold + WASM build pipeline

**Files:**
- Create: `rust/optimizer-core/Cargo.toml`
- Create: `rust/optimizer-core/src/lib.rs`
- Create: `rust/optimizer-core/.cargo/config.toml` (target default, if needed)
- Modify: `package.json` — add a `build:wasm` script
- Modify: `.gitignore` — ignore `rust/optimizer-core/target/` and `rust/optimizer-core/pkg/`

**Interfaces:**
- Produces: a `wasm-bindgen` export `ping(n: u32) -> u32` (returns `n + 1`) — purely to prove the toolchain works end to end before any real logic is ported.
- Produces: a build script that emits JS glue + `.wasm` binary into `src/wasm/optimizer_core/` (checked into `public`/`src` so CRA can bundle it — decide during this task whether to import it via CRA's built-in WASM asset support or copy-on-build; document the choice in a comment at the top of `lib.rs`).

- [ ] **Step 1: Install toolchain and scaffold the crate**

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
mkdir -p rust/optimizer-core/src
```

`rust/optimizer-core/Cargo.toml`:
```toml
[package]
name = "optimizer-core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
opt-level = 3
lto = true
```

`rust/optimizer-core/src/lib.rs`:
```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn ping(n: u32) -> u32 {
    n + 1
}
```

- [ ] **Step 2: Build and verify the wasm output loads under Node**

```bash
cd rust/optimizer-core
wasm-pack build --target nodejs --out-dir pkg-node
node -e "const m = require('./pkg-node'); console.log(m.ping(41));"
```

Expected: prints `42`.

- [ ] **Step 3: Add the browser-target build script used by the app**

```bash
wasm-pack build --target web --out-dir pkg
```

Add to `package.json` scripts:
```json
"build:wasm": "cd rust/optimizer-core && wasm-pack build --target web --out-dir ../../src/wasm/optimizer-core"
```

- [ ] **Step 4: Verify the app can import the generated glue**

Add a throwaway test in `src/wasm/optimizer-core.smoketest.js` (delete after verifying, per project convention):
```js
import init, { ping } from './optimizer-core/optimizer_core.js';

async function run() {
    await init();
    console.log('ping(41) =', ping(41));
}
run();
```
Run it via a scratch HTML page or `npm start` + browser console import; confirm `42` logs with no console errors (in particular no MIME-type/module-resolution errors from CRA's webpack config — if CRA rejects the `.wasm` import, note the exact error here before moving on, since it determines whether Task A7 needs a `CRACO`/webpack override).

- [ ] **Step 5: Delete the smoketest file and commit**

```bash
rm src/wasm/optimizer-core.smoketest.js
git add rust/optimizer-core package.json .gitignore
git commit -m "Scaffold Rust/WASM crate for optimizer-core"
```

---

### Task A2: Port data model + JSON (de)serialization

**Files:**
- Create: `rust/optimizer-core/src/model.rs`
- Modify: `rust/optimizer-core/src/lib.rs` — `mod model;`

**Interfaces:**
- Consumes: nothing new (raw JSON strings from JS).
- Produces: `pub struct Item`, `pub struct Monster`, `pub struct Condition`, `pub struct Build`, each `#[derive(Deserialize)]`, covering exactly the fields read by `statEngine.js`/`combatMath.js`/`procEffects.js` (cross-reference those files field-by-field while writing this — do not port fields nothing downstream reads). Also `pub struct SearchConfig { build: Build, targets: Vec<Target>, items_by_id: HashMap<String, Item>, conditions_by_id: HashMap<String, Condition>, candidate_lists: CandidateLists, max_hp_loss: Option<f64>, limited_item_ids: Vec<String> }` mirroring `searchBestBuilds`'s parameters in `optimizer.js:482-483`.

- [ ] **Step 1: Write a failing Rust test with a literal item fixture**

```rust
// rust/optimizer-core/src/model.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_item_with_equip_effect() {
        let json = r#"{
            "id": "sword1",
            "category": "weapon",
            "equipEffect": { "increaseMaxAP": 0 },
            "damagePotential": { "min": 1, "max": 5 }
        }"#;
        let item: Item = serde_json::from_str(json).unwrap();
        assert_eq!(item.id, "sword1");
        assert_eq!(item.damage_potential.unwrap().max, 5);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd rust/optimizer-core && cargo test deserializes_item_with_equip_effect
```
Expected: compile error, `Item` not defined.

- [ ] **Step 3: Implement the structs**

```rust
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
pub struct Range { pub min: f64, pub max: f64 }

#[derive(Debug, Deserialize, Clone, Default)]
pub struct EquipEffect {
    #[serde(rename = "increaseMaxAP", default)]
    pub increase_max_ap: f64,
    #[serde(default)]
    pub added_conditions: Vec<ConditionEntry>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ConditionEntry {
    pub condition: String,
    pub magnitude: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Item {
    pub id: String,
    pub category: String,
    #[serde(rename = "equipEffect", default)]
    pub equip_effect: EquipEffect,
    #[serde(rename = "damagePotential")]
    pub damage_potential: Option<Range>,
    // ... remaining fields (hitEffect, hitReceivedEffect, killEffect,
    // categoryLink) added in the same style as combatMath.js/statEngine.js
    // read them — extend this struct incrementally as later tasks need
    // each field, rather than guessing the full shape up front.
}

// Monster, Condition, Build, Target, CandidateLists follow the same
// pattern: one field per thing statEngine.js/combatMath.js actually reads.
```

- [ ] **Step 4: Run to verify it passes**

```bash
cargo test deserializes_item_with_equip_effect
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rust/optimizer-core/src/model.rs rust/optimizer-core/src/lib.rs
git commit -m "Add Rust data model for optimizer-core"
```

---

### Task A3: Port stat resolution (`statEngine.js` subset)

**Files:**
- Create: `rust/optimizer-core/src/stat_engine.rs`
- Reference (read, do not modify): `src/utils/combat/statEngine.js` (all of `resolvePlayerStats`, `resolveMonsterStats`, `resolveEquipped`, `getEquipmentConditions`, `mergeConditionInstances`, `applyGeneralCombatSkills`, `buildBaseStats`)

**Interfaces:**
- Consumes: `model::{Item, Monster, Build, Condition}` from Task A2.
- Produces: `pub fn resolve_player_stats(build: &Build, items_by_id: &HashMap<String, Item>, conditions_by_id: &HashMap<String, Condition>, precomputed_base: Option<&PlayerStats>) -> PlayerStats`, `pub fn resolve_monster_stats(monster: &Monster, active_conditions: &[ConditionEntry], conditions_by_id: &HashMap<String, Condition>) -> PlayerStats`, `pub fn resolve_equipped(equipment: &Equipment, items_by_id: &HashMap<String, Item>) -> Equipped`, `pub fn get_equipment_conditions(equipped: &Equipped) -> Vec<ConditionEntry>`, `pub fn merge_condition_instances(instances: &[ConditionEntry], conditions_by_id: &HashMap<String, Condition>) -> HashMap<String, f64>` — one-to-one with the JS function names so later tasks (and anyone diffing against the JS source) can match them up.
- These are consumed by `combat_math::compute_combat_summary` in Task A5.

- [ ] **Step 1: Write a failing test that pins one golden value**

First, get the golden value from the existing JS: run the real app (or a Node script importing `statEngine.js`) against one fixed, simple build (documented here — pick e.g. a level-5 build with no equipment) and record the exact `maxAP`, `attackChance`, `damageResistance` numbers it produces. Paste those literal numbers into the Rust test so the two implementations are checked against the same ground truth:

```rust
#[test]
fn resolve_player_stats_matches_js_golden_value() {
    let build = Build { level: 5, equipment: Equipment::default(), skill_levels: HashMap::new(), ..Default::default() };
    let items_by_id = HashMap::new();
    let conditions_by_id = HashMap::new();
    let stats = resolve_player_stats(&build, &items_by_id, &conditions_by_id, None);
    // Replace these with the actual numbers captured from statEngine.js.
    assert_eq!(stats.max_ap, /* JS value */ 10.0);
    assert_eq!(stats.attack_chance, /* JS value */ 50.0);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cargo test resolve_player_stats_matches_js_golden_value
```
Expected: compile error (function not defined) or wrong values.

- [ ] **Step 3: Port `buildBaseStats`/`applyGeneralCombatSkills`/`resolvePlayerStats` line-for-line**

Translate `src/utils/combat/statEngine.js`'s `buildBaseStats`, `applyGeneralCombatSkills`, and `resolvePlayerStats` functions into `stat_engine.rs`, preserving the exact arithmetic and order of operations (this is a formula-fidelity port, not a redesign — every constant and rounding (`Math.floor`/`Math.ceil`) call in the JS must have an exact Rust equivalent, e.g. `f64::floor`).

- [ ] **Step 4: Run to verify it passes**

```bash
cargo test resolve_player_stats_matches_js_golden_value
```
Expected: PASS.

- [ ] **Step 5: Repeat steps 1–4 for `resolveMonsterStats`, `resolveEquipped`, `getEquipmentConditions`, `mergeConditionInstances`**

Each gets its own golden-value test captured from the corresponding JS function, following the exact same fail→port→pass loop as above — do not batch multiple functions into one test.

- [ ] **Step 6: Commit**

```bash
git add rust/optimizer-core/src/stat_engine.rs
git commit -m "Port statEngine.js core to Rust with golden-value tests"
```

---

### Task A4: Port `procEffects.js`

**Files:**
- Create: `rust/optimizer-core/src/proc_effects.rs`
- Reference: `src/utils/combat/procEffects.js`

**Interfaces:**
- Consumes: `model::ConditionEntry`, `model::Condition`.
- Produces: `pub fn average_range(range: Option<&Range>) -> f64`, `pub fn get_expected_boost_per_turn(...) -> f64`, `pub fn apply_expected_proc_conditions(stats: &mut PlayerStats, sources: Option<&[ConditionEntry]>, hit_chance: f64, attacks_per_turn: f64, conditions_by_id: &HashMap<String, Condition>, cycle_length: Option<f64>)` — signatures mirror the JS call sites in `combatMath.js` exactly (same parameter order) so Task A5's port is a mechanical transliteration.

- [ ] **Step 1: Write failing test for `average_range`** (simplest function, proves the module compiles)

```rust
#[test]
fn average_range_none_is_zero() {
    assert_eq!(average_range(None), 0.0);
}
#[test]
fn average_range_midpoint() {
    let r = Range { min: 2.0, max: 6.0 };
    assert_eq!(average_range(Some(&r)), 4.0);
}
```

- [ ] **Step 2: Run to verify it fails, then implement, then verify it passes**

```bash
cargo test average_range
```

- [ ] **Step 3: Repeat the fail→implement→pass loop for `get_expected_boost_per_turn` and `apply_expected_proc_conditions`**, each with a golden value captured from the JS (same technique as Task A3).

- [ ] **Step 4: Commit**

```bash
git add rust/optimizer-core/src/proc_effects.rs
git commit -m "Port procEffects.js to Rust"
```

---

### Task A5: Port `computeCombatSummary`

**Files:**
- Create: `rust/optimizer-core/src/combat_math.rs`
- Reference: `src/utils/combat/combatMath.js:228-425`

**Interfaces:**
- Consumes: `stat_engine::{resolve_player_stats, resolve_monster_stats, resolve_equipped, get_equipment_conditions, merge_condition_instances}`, `proc_effects::*`.
- Produces: `pub struct CombatSummary { pub difficulty: f64, pub difficulty_label: String, pub damage_per_turn: f64, pub hp_loss_per_turn: f64, pub hp_gain_per_turn: f64, pub hp_loss_per_kill: f64, pub hp_gain_per_kill: f64 }` and `pub fn compute_combat_summary(build: &Build, monster: &Monster, items_by_id: &HashMap<String, Item>, conditions_by_id: &HashMap<String, Condition>, horde: Option<&Horde>, precomputed: Option<&Precomputed>) -> CombatSummary` — field names and function name match `combatMath.js` exactly (snake_case of the same identifiers) so `optimizer.rs` (Task A6) calls it the same way `optimizer.js:531` does.

- [ ] **Step 1: Write a failing golden-value test for the 1v1, no-horde case**

Capture from the running app (or a Node script) `computeCombatSummary(build, monster, {...}, undefined, {})`'s full output for one fixed build+monster pair with at least one equipped item that has a `hitEffect.conditionsSource` (to exercise the proc path, not just the trivial no-conditions path). Hardcode every field of the returned object into the test assertion.

```rust
#[test]
fn compute_combat_summary_matches_js_golden_value() {
    let (build, monster, items_by_id, conditions_by_id) = fixtures::golden_case_1();
    let summary = compute_combat_summary(&build, &monster, &items_by_id, &conditions_by_id, None, None);
    assert!((summary.damage_per_turn - /* JS value */ 12.34).abs() < 1e-6);
    assert!((summary.hp_loss_per_kill - /* JS value */ 56.78).abs() < 1e-6);
    // ... remaining fields
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cargo test compute_combat_summary_matches_js_golden_value
```

- [ ] **Step 3: Port the function body**

Translate `combatMath.js:228-425` section by section, in the same order (AP deltas → player condition procs → monster condition procs w/ `buildAdjustedMonster` closure → difficulty → kill-triggered effects → final HP/damage numbers). Keep the same intermediate variable names (translated to snake_case) so a reviewer can diff line-by-line against the JS.

- [ ] **Step 4: Run to verify it passes**

```bash
cargo test compute_combat_summary_matches_js_golden_value
```

- [ ] **Step 5: Add a second golden-value test covering horde mode** (`horde.size > 1`, exercising `buildAdjustedMonster`'s `cycleLength` re-derivation at `combatMath.js:358-361` and the kill-triggered AP/condition pass at `combatMath.js:363-370`), following the same fail→port(if gaps found)→pass loop.

- [ ] **Step 6: Commit**

```bash
git add rust/optimizer-core/src/combat_math.rs
git commit -m "Port computeCombatSummary to Rust with golden-value tests"
```

---

### Task A6: Port the best-first search (`bestFirstCombos` + `MaxHeap` + dimension building)

**Files:**
- Create: `rust/optimizer-core/src/search.rs`
- Reference: `src/utils/combat/optimizer.js:139-570` (`insertIntoTop10`, `isDisallowedPair`, `buildWeaponShieldPairs`, `sameCandidateSet`, `buildRingPairs`, `buildDimensions`, `MaxHeap`, `bestFirstCombos`, `searchBestBuilds`)

**Interfaces:**
- Consumes: `combat_math::compute_combat_summary`, pre-sorted, pre-pruned candidate item-id lists per slot (produced by the *existing JS* `buildCandidateLists`/`selectCandidates` — Rust does not reimplement `valueScoring.js`'s scoring/pruning, only consumes its already-ranked output).
- Produces: `pub struct SearchResult { pub best_first: Vec<Top10Entry>, pub evaluated: u64, pub total: u64 }` and `pub fn search_best_builds(config: &ShardConfig) -> SearchResult` where `ShardConfig` additionally carries `shard_start_rank: u32, shard_stride: u32` (see Task A8 — this is how one shard skips combos belonging to other shards without needing to know about them).

- [ ] **Step 1: Write a failing test for `insert_into_top10` ordering** (smallest self-contained piece, matches `optimizer.js:139-149`)

```rust
#[test]
fn insert_into_top10_orders_by_hp_loss_then_damage() {
    let mut top10 = vec![];
    top10 = insert_into_top10(top10, entry_with(10.0, 5.0));
    top10 = insert_into_top10(top10, entry_with(5.0, 3.0)); // lower hp loss wins
    assert_eq!(top10[0].summary.hp_loss_per_kill, 5.0);
}
#[test]
fn insert_into_top10_treats_infinity_as_equal_for_tiebreak() {
    let mut top10 = vec![];
    top10 = insert_into_top10(top10, entry_with(f64::INFINITY, 5.0));
    top10 = insert_into_top10(top10, entry_with(f64::INFINITY, 9.0)); // higher dpt wins tie
    assert_eq!(top10[0].summary.damage_per_turn, 9.0);
}
```

- [ ] **Step 2: Run to verify it fails, implement `insert_into_top10`, run to verify it passes**

- [ ] **Step 3: Port `MaxHeap`, `buildWeaponShieldPairs`, `buildRingPairs`, `buildDimensions` with the same fail→port→pass loop**, one test per function, each pinned against a small hand-constructed candidate list (2-3 items per slot) where you can enumerate the expected pairs by hand — e.g. a `build_ring_pairs_dedupes_same_pool_swaps` test mirroring the `sameCandidateSet` optimization at `optimizer.js:252-264`.

- [ ] **Step 4: Port `bestFirstCombos` as a Rust iterator (or explicit loop yielding via a callback/closure, since Rust generators are unstable) preserving the rank-sum best-first ordering and the `MAX_FRONTIER_SIZE`/`visitedByRank` bucket-purging memory bound** (`optimizer.js:390-476`) — test: given a small 2-dimension, 3-values-each candidate set, assert the first 4 combos yielded have non-decreasing rank sum.

- [ ] **Step 5: Port `search_best_builds`** (`optimizer.js:482-570`), including the `shard_start_rank`/`shard_stride` skip logic that Task A8 needs — a single-shard call (`shard_stride = 1`) must reproduce the JS engine's un-sharded behavior exactly, so write that as the correctness test:

```rust
#[test]
fn single_shard_search_matches_js_top10_for_fixture() {
    // Use the same fixture the JS engine was run against manually to
    // capture a top-10 result; assert equal build equipment + hpLossPerKill
    // within tolerance for every one of the 10 entries.
}
```

- [ ] **Step 6: Commit**

```bash
git add rust/optimizer-core/src/search.rs
git commit -m "Port best-first search to Rust"
```

---

### Task A7: `wasm-bindgen` entry point + CRA integration

**Files:**
- Modify: `rust/optimizer-core/src/lib.rs` — add the public wasm-bindgen surface
- Modify: `package.json` — `build:wasm` runs before `build`/`start` (a `prebuild`/`prestart` script, or documented manual step if CRA's dev server hot-reload doesn't need it rebuilt often)

**Interfaces:**
- Produces: `#[wasm_bindgen] pub fn search_best_builds_js(config_json: &str) -> String` — takes/returns JSON strings (simplest `wasm-bindgen` boundary, avoids hand-writing JS-Rust type mappings for every field) matching the shape JS already builds for `optimizerWorker.js`'s `event.data` today.

- [ ] **Step 1: Write the wasm-bindgen wrapper**

```rust
use wasm_bindgen::prelude::*;
use serde_json;

#[wasm_bindgen]
pub fn search_best_builds_js(config_json: &str) -> String {
    let config: ShardConfig = serde_json::from_str(config_json)
        .expect("invalid search config JSON");
    let result = search::search_best_builds(&config);
    serde_json::to_string(&result).expect("failed to serialize search result")
}
```

- [ ] **Step 2: Rebuild and verify from a throwaway Node script (delete after use)**

```bash
npm run build:wasm
node -e "
const init = require('./src/wasm/optimizer-core/optimizer_core.js');
// ... load fixture JSON, call search_best_builds_js, console.log parsed result
"
```
Expected: JSON result with a `best_first` array of 10 entries, no panics.

- [ ] **Step 3: Commit**

```bash
git add rust/optimizer-core/src/lib.rs package.json
git commit -m "Expose search_best_builds_js wasm-bindgen entry point"
```

---

### Task A8: Worker-pool sharding (JS side)

**Files:**
- Create: `src/workers/optimizerWasmWorker.js`
- Create: `src/utils/combat/wasmSearchCoordinator.js`
- Modify: `src/utils/combat/optimizer.js` — export `buildCandidateLists`/`countCombinations` if not already exported (they already are) for the coordinator to reuse

**Interfaces:**
- Consumes: `search_best_builds_js` (Task A7) inside each worker; `buildCandidateLists`, `countCombinations` from `optimizer.js` (unchanged, still JS).
- Produces: `export async function runShardedSearch(build, targets, { itemsById, conditionsById }, candidateLists, options)` in `wasmSearchCoordinator.js` — same call signature as `searchBestBuilds` in `optimizer.js:482`, so `OptimizerPanel.jsx` can switch between engines without changing its own call site shape (only which function/worker it invokes).

- [ ] **Step 1: Write `optimizerWasmWorker.js`**

```js
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
```

- [ ] **Step 2: Write a throwaway test spawning one worker directly and confirming it returns a result** (delete after verifying — per project's no-kept-tests convention), e.g. a scratch HTML page loaded via `npm start` that posts a small fixture config and logs the response.

- [ ] **Step 3: Write the coordinator**

```js
// src/utils/combat/wasmSearchCoordinator.js
import { buildDimensions } from './optimizer';

// Splits the top-level weapon/shield dimension (dims[0].values) into
// `shardCount` contiguous slices, one per worker — each worker gets a
// disjoint subset of the outermost dimension, so no two workers can ever
// evaluate the same combo, and merging is a plain top-10 merge with no
// dedup needed. See optimizer.js:280-296 for why the weapon/shield pair
// is always dims[0].
function partitionWeaponShieldDim(candidateLists, limitedItemIds, build, shardCount) {
    const dims = buildDimensions(candidateLists, limitedItemIds, build);
    const weaponShieldValues = dims[0].values;
    const shardSize = Math.ceil(weaponShieldValues.length / shardCount);
    const shards = [];
    for (let i = 0; i < weaponShieldValues.length; i += shardSize) {
        shards.push(weaponShieldValues.slice(i, i + shardSize));
    }
    return shards;
}

export async function runShardedSearch(build, targets, { itemsById, conditionsById }, candidateLists, options = {}) {
    const { limitedItemIds, onProgress, shouldCancel } = options;
    const shardCount = Math.max(1, navigator.hardwareConcurrency || 4);
    const shards = partitionWeaponShieldDim(candidateLists, limitedItemIds, build, shardCount);

    const workers = shards.map(() => new Worker(new URL('../../workers/optimizerWasmWorker.js', import.meta.url)));
    const perShardCandidateLists = shards.map(weaponShieldSlice => ({
        ...candidateLists,
        // Rust side treats a restricted weapon/shield slice like any other
        // candidate list — it doesn't need to know sharding happened.
        weapon: weaponShieldSlice.map(pair => pair.weapon).filter(Boolean),
        shield: weaponShieldSlice.map(pair => pair.shield).filter(Boolean),
    }));

    const results = await Promise.all(workers.map((worker, i) => new Promise((resolve, reject) => {
        worker.onmessage = (event) => {
            if (event.data.type === 'done') resolve(JSON.parse(event.data.resultJson));
            else if (event.data.type === 'error') reject(new Error(event.data.message));
        };
        worker.postMessage({ configJson: JSON.stringify({
            build, targets, itemsById, conditionsById,
            candidateLists: perShardCandidateLists[i],
            limitedItemIds: limitedItemIds ? [...limitedItemIds] : [],
            maxHpLoss: options.maxHpLoss ?? null,
        }) });
    })));

    workers.forEach(w => w.terminate());

    const merged = results.flatMap(r => r.best_first);
    merged.sort((a, b) => {
        if (a.summary.hp_loss_per_kill !== b.summary.hp_loss_per_kill) return a.summary.hp_loss_per_kill - b.summary.hp_loss_per_kill;
        return b.summary.damage_per_turn - a.summary.damage_per_turn;
    });
    return { bestFirst: merged.slice(0, 10) };
}
```

- [ ] **Step 4: Verify end-to-end against the fixture used in Task A6 Step 5** — run `runShardedSearch` with `shardCount` forced to e.g. 4 on the same fixture, assert the merged top-10 matches the single-shard/JS-engine top-10 from Task A6.

- [ ] **Step 5: Commit**

```bash
git add src/workers/optimizerWasmWorker.js src/utils/combat/wasmSearchCoordinator.js
git commit -m "Add WASM worker-pool sharded search coordinator"
```

---

### Task A9: Wire into `OptimizerPanel.jsx` with feature detection + fallback

**Files:**
- Modify: `src/components/calculator/OptimizerPanel.jsx`
- Create: `src/utils/combat/wasmSupport.js`

**Interfaces:**
- Consumes: `runShardedSearch` (Task A8), existing `searchBestBuilds`/worker flow already used by `OptimizerPanel.jsx`.
- Produces: `export async function isWasmSupported()` in `wasmSupport.js` — attempts `WebAssembly.instantiate` a trivial module and returns `false` on any throw, so `OptimizerPanel` can pick an engine without hardcoding a browser sniff.

- [ ] **Step 1: Write `wasmSupport.js`**

```js
export async function isWasmSupported() {
    if (typeof WebAssembly !== 'object') return false;
    try {
        const module = new WebAssembly.Module(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
        return module instanceof WebAssembly.Module;
    } catch {
        return false;
    }
}
```

- [ ] **Step 2: In `OptimizerPanel.jsx`, branch the search invocation on `isWasmSupported()`**, keeping the existing `optimizerWorker.js` path as the untouched fallback — locate the existing call site that posts to `optimizerWorker.js` and add the WASM branch alongside it, gated behind the feature-detect result (and, if you want a user-visible off switch, a checkbox — this is a UI decision to confirm with the user before adding UI, not something to assume silently).

- [ ] **Step 3: Manual browser verification** — run `npm start`, open the Calculator page, run an optimizer search with the WASM engine active, confirm results render in `ResultsPanel`/top-10 UI identically in shape to the JS-engine path (per this project's convention: UI changes need a real browser check, not just unit tests).

- [ ] **Step 4: Commit**

```bash
git add src/components/calculator/OptimizerPanel.jsx src/utils/combat/wasmSupport.js
git commit -m "Wire WASM sharded search into OptimizerPanel with fallback"
```

---

## Track B: Random search → WebGPU compute shader

### Task B1: WebGPU feature detection

**Files:**
- Create: `src/utils/combat/gpuSupport.js`

**Interfaces:**
- Produces: `export async function getGpuDevice()` — returns a `GPUDevice` or `null` (never throws), so every caller downstream can treat "no WebGPU" as a plain falsy check.

- [ ] **Step 1: Write the detection function**

```js
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
```

- [ ] **Step 2: Verify manually in browser console** (Chrome/Edge with WebGPU enabled): `await getGpuDevice()` returns a `GPUDevice` object; in Firefox/Safari without support, returns `null` with no thrown error.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/gpuSupport.js
git commit -m "Add WebGPU feature detection"
```

---

### Task B2: Flatten item/monster/build data into GPU buffer layout

**Files:**
- Create: `src/utils/combat/gpuDataLayout.js`
- Create: `docs/superpowers/plans/gpu-buffer-layout.md` (buffer struct documentation — the WGSL shader in Task B3 must byte-for-byte match this; keeping it as a standalone doc avoids the layout drifting out of sync between the JS packer and the shader source)

**Interfaces:**
- Consumes: `itemsById`, `conditionsById`, per-slot candidate arrays (same shape `buildCandidateLists` already produces).
- Produces: `export function packItemBuffer(candidateLists) -> { floatBuffer: Float32Array, u32Buffer: Uint32Array, itemIndexBySlotAndCandidate: Map }` — one fixed-width record per item, with each of the six combat-relevant condition-list fields (`equipEffect.addedConditions`, `hitEffect.conditionsSource`/`conditionsTarget`, `hitReceivedEffect.conditionsSource`/`conditionsTarget`, `killEffect.conditionsSource`) padded to exactly 4 slots (verified cap — see Step 1), since WGSL has no dynamic-length arrays inside a struct — and `export function packBuildAndMonsterBuffer(build, monster, skillLevels) -> Float32Array`.

- [ ] **Step 1: Document the layout first, using the verified proc-slot cap**

Slot cap is **4 entries per condition-list field**, not a guess: a scan of every `public/raw/itemlist_*.json` file (the actual shipped game data) for the maximum length of `equipEffect.addedConditions`, `hitEffect.conditionsSource`, `hitEffect.conditionsTarget`, `hitReceivedEffect.conditionsSource`, `hitReceivedEffect.conditionsTarget`, and `killEffect.conditionsSource` — the six condition-list fields `combatMath.js`/`procEffects.js` actually read during combat — found a real maximum of 3 (`equipEffect.addedConditions` on `ring_antipoison`), with every other field maxing out at 1–2. (A `useEffect.conditionsSource` list of length 7 on the consumable `pot_rnd` was also found, but `computeCombatSummary` never reads `useEffect` — that field is a potion's on-use buff roll, out of scope for the combat shader entirely, and must **not** be included in the item record at all.) 4 slots therefore covers every field in the current dataset with one spare slot for future game-data updates; re-run the scan below if the data changes materially in a later game version and bump the constant if a field ever exceeds 4.

Re-run the verification scan anytime the constant is questioned:
```bash
python3 - <<'EOF'
import json, glob
max_counts, examples = {}, {}
for f in glob.glob('public/raw/itemlist_*.json'):
    data = json.load(open(f))
    def walk(obj, item_id=None):
        if isinstance(obj, dict):
            cur_id = obj.get('id', item_id)
            for effkey in ('hitEffect', 'hitReceivedEffect', 'killEffect', 'equipEffect'):
                if effkey in obj and isinstance(obj[effkey], dict):
                    for k, v in obj[effkey].items():
                        if k in ('conditionsSource', 'conditionsTarget', 'addedConditions') and isinstance(v, list):
                            key = f"{effkey}.{k}"
                            if len(v) > max_counts.get(key, 0):
                                max_counts[key] = len(v)
                                examples[key] = cur_id
            for kk, v in obj.items():
                walk(v, cur_id)
        elif isinstance(obj, list):
            for v in obj:
                walk(v, item_id)
    walk(data)
for k in sorted(max_counts):
    print(k, max_counts[k], examples[k])
EOF
```
Expected output: every field ≤ 3, confirming 4 slots is still a safe cap.

Write `gpu-buffer-layout.md` listing, in order, every `f32`/`u32` field per item record: damage min/max, armor rating, block chance contribution, then for each of the six combat-relevant condition-list fields above, exactly **4 fixed slots**, each slot laid out as `[conditionIndex: u32, magnitude: f32, chance: f32, duration: f32]`. Unused slots (i.e. beyond an item's real entry count) are padded with `conditionIndex = 0xFFFFFFFF` as the "empty, skip" sentinel — e.g. `ring_antipoison`'s 3 real `addedConditions` entries fill slots 0–2, slot 3 is sentinel-padded; an item with zero added conditions has all 4 slots sentinel-padded. Derive every non-condition field from what `combat_math.rs`/`combatMath.js` actually reads — don't guess those. Also document the equivalent layout for the build/monster record. This doc is the single source of truth Task B3's WGSL struct must match field-for-field.

- [ ] **Step 2: Write a failing test for `packItemBuffer` on a 1-item fixture**

```js
test('packItemBuffer lays out damage potential at the documented offset', () => {
    const items = [{ id: 'sword1', damagePotential: { min: 1, max: 5 }, equipEffect: {} }];
    const { floatBuffer } = packItemBuffer({ weapon: items });
    expect(floatBuffer[0]).toBe(1); // offset 0: damage min, per gpu-buffer-layout.md
    expect(floatBuffer[1]).toBe(5); // offset 1: damage max
});

test('packItemBuffer fills all 3 real addedConditions entries then sentinel-pads slot 4', () => {
    const items = [{
        id: 'ring_antipoison',
        equipEffect: { addedConditions: [
            { condition: 'antipoison_weak', magnitude: 1 },
            { condition: 'antipoison_medium', magnitude: 1 },
            { condition: 'antipoison_strong', magnitude: 1 },
        ] },
    }];
    const { u32Buffer } = packItemBuffer({ neck: items });
    const conditionIndexOffsets = getAddedConditionsSlotOffsets(); // per gpu-buffer-layout.md
    expect(u32Buffer[conditionIndexOffsets[0]]).not.toBe(0xFFFFFFFF);
    expect(u32Buffer[conditionIndexOffsets[1]]).not.toBe(0xFFFFFFFF);
    expect(u32Buffer[conditionIndexOffsets[2]]).not.toBe(0xFFFFFFFF);
    expect(u32Buffer[conditionIndexOffsets[3]]).toBe(0xFFFFFFFF); // 4th slot: no 4th real entry, sentinel
});

test('packItemBuffer sentinel-pads all 4 slots for an item with zero added conditions', () => {
    const items = [{ id: 'plain_ring', equipEffect: {} }];
    const { u32Buffer } = packItemBuffer({ neck: items });
    const conditionIndexOffsets = getAddedConditionsSlotOffsets();
    for (const offset of conditionIndexOffsets) {
        expect(u32Buffer[offset]).toBe(0xFFFFFFFF);
    }
});
```

(Throwaway per project convention — delete this test file once Task B2 is verified working, keep only the implementation. `getAddedConditionsSlotOffsets` is a small test-only helper reading the 4 slot offsets straight from `gpu-buffer-layout.md`'s documented layout — write it inline in the test file, not as a new exported function.)

- [ ] **Step 3: Run to verify it fails, implement `packItemBuffer`/`packBuildAndMonsterBuffer` to match the documented layout, run to verify it passes**

- [ ] **Step 4: Delete the test file, commit implementation + layout doc**

```bash
git add src/utils/combat/gpuDataLayout.js docs/superpowers/plans/gpu-buffer-layout.md
git commit -m "Add GPU buffer packing for item/build/monster data"
```

---

### Task B3: WGSL compute shader implementing the FULL `computeCombatSummary` formula

**Files:**
- Create: `src/shaders/randomSearch.wgsl`
- Modify: `docs/superpowers/plans/gpu-buffer-layout.md` — add the condition-ID table and build/monster skill-level fields this task's port needs (see Step 0)

**Interfaces:**
- Consumes: the buffer layout from Task B2 (`gpu-buffer-layout.md`) as `@group(0) @binding(0..N)` storage buffers, a `comboIndices: array<u32>` buffer (one tuple of per-slot candidate indices per invocation, laid out contiguously, from Task B4), and a new `conditionTable: array<f32>` storage buffer (per-condition-id `roundEffect.increaseCurrentHP` min/max, for `getExpectedConditionHPPerRound` — see Step 0).
- Produces: an `outputResults: array<CombatSummaryGpu>` buffer, one full result struct per invocation index — `{ hp_loss_per_kill: f32, damage_per_turn: f32, hp_loss_per_turn: f32, hp_gain_per_turn: f32, hp_gain_per_kill: f32, difficulty: f32 }`, field-for-field matching `combat_math.rs`'s `CombatSummary` (Task A5) so Task B7's cross-check compares every field, not just two.

This task ports **all** of `combatMath.js:1-425`, not a subset. It's the largest single task in the plan — do not compress the fail→port→pass loop across multiple functions at once; WGSL has no debugger and a wrong sign or missed early-return several functions deep is much easier to isolate one function at a time.

- [ ] **Step 0: Extend the buffer layout for condition IDs and skill levels**

Two things Task B2 didn't need yet, now required for the full formula:
1. **Condition-ID table.** `mergeConditionInstances` (`statEngine.js`) aggregates condition magnitudes *by condition ID* across every source (equipment + `build.activeConditions`), and `getExpectedConditionHPPerRound` (`combatMath.js:134-145`) then looks up each aggregated ID's `roundEffect.increaseCurrentHP`. WGSL has no hash map, so this needs a dense integer ID space: assign every condition in `conditionsById` a stable index `0..conditionCount` when packing buffers (a plain JS `Object.keys(conditionsById)` order is fine, just must be the same order used to build both `conditionTable` and every item's proc-slot `conditionIndex` fields). A scan of `public/raw/actorconditions_*.json` found **131 distinct condition IDs** in the current game data; size the shader's private per-invocation accumulator array at a rounded-up constant `CONDITION_SLOT_COUNT = 256u` (documented safety margin, same reasoning as Task B2's proc-slot cap — re-run the scan below and bump the constant if a future game version exceeds it):
```bash
python3 - <<'EOF'
import json, glob
ids = set()
for f in glob.glob('public/raw/actorconditions_*.json'):
    data = json.load(open(f))
    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get('id'), str): ids.add(o['id'])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(data)
print(len(ids))
EOF
```
2. **Skill levels.** `applyGeneralCombatSkillProcs` (`combatMath.js:183-214`) and `getAttacksPerTurn`-affecting general combat skills read `build.skillLevels[SKILL_IDS.X]`. Add fixed `f32` fields to the build record for exactly the skill IDs `combatMath.js`/`statEngine.js` read (`SKILL_IDS.CONCUSSION`, `CRIT1`, `CRIT2`, `TAUNT`, `EATER`, `FIGHTSTYLE_DUAL_WIELD`, plus whatever `applyGeneralCombatSkills` in `statEngine.js` reads) — a fixed small set, not a dynamic map, since `SKILL_IDS` is a closed enum in `skillData.js`.

Update `gpu-buffer-layout.md` with both additions before writing any WGSL.

- [ ] **Step 1: Shader skeleton + buffer round-trip** (prove the pipeline before porting any formula)

```wgsl
struct CombatSummaryGpu {
    hp_loss_per_kill: f32,
    damage_per_turn: f32,
    hp_loss_per_turn: f32,
    hp_gain_per_turn: f32,
    hp_gain_per_kill: f32,
    difficulty: f32,
};

@group(0) @binding(0) var<storage, read> items: array<f32>;
@group(0) @binding(1) var<storage, read> itemsU32: array<u32>;
@group(0) @binding(2) var<storage, read> buildAndMonster: array<f32>;
@group(0) @binding(3) var<storage, read> conditionTable: array<f32>;
@group(0) @binding(4) var<storage, read> comboIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> outputResults: array<CombatSummaryGpu>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let comboIdx = id.x;
    if (comboIdx >= arrayLength(&outputResults)) { return; }
    outputResults[comboIdx] = CombatSummaryGpu(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
}
```

- [ ] **Step 2: Verify the pipeline round-trips** via a throwaway script (a minimal stand-in for Task B5's real pipeline module, just enough to dispatch and read back): confirm `outputResults` comes back as the expected number of all-zero structs, no WebGPU validation errors.

- [ ] **Step 3: Port the base damage/hit-chance formulas** (`combatMath.js:10-100`: `getAttacksPerTurn`, `getEffectiveCriticalChance`, `hasCriticalAttack`, `getAttackHitChance`, `getAverageDamagePerHit`, `getAverageDamagePerTurn`, `getTurnsToKillTarget`) as WGSL functions operating on a `PlayerStats`-equivalent struct read from `buildAndMonster`/`items`. Test against the same golden fixture Task A5 Step 1 already captured (reuse it — don't recapture): dispatch a single combo matching that fixture, assert `damage_per_turn` matches `combat_math.rs`'s test value within `1e-4` float32 tolerance.

- [ ] **Step 4: Port `getMonsterDifficulty`/`getDifficultyLabel`** (`combatMath.js:103-121`) — note WGSL has no string type, so `difficulty_label` is **not** part of `CombatSummaryGpu`; only the numeric `difficulty` is returned, and the JS caller (Task B5) derives the label from the number using the same thresholds as `getDifficultyLabel`, client-side, from the numeric result. Test: same golden fixture, assert `difficulty` matches.

- [ ] **Step 5: Port `procEffects.js`'s `averageRange`/`getExpectedBoostPerTurn`** as WGSL functions reading a fixed-size proc-slot array (per Task B2's 4-slot layout) and summing only non-sentinel entries. Test with a synthetic item that has exactly 2 of 4 `hitEffect.increaseCurrentAP`-style slots filled, assert the sum ignores the 2 sentinel slots.

- [ ] **Step 6: Port `applyExpectedProcConditions`** (`procEffects.js`) — for each of the 4 proc slots on a given effect field, if not sentinel, look up `conditionTable[conditionIndex]` and accumulate into a `var<function> accumulated: array<f32, 256>` (indexed by condition ID, per Step 0's dense ID space) weighted by hit chance/attacks-per-turn/chance/duration exactly as the JS does, including the `cycleLength` parameter (pass as an `f32`, `-1.0` sentinel for "undefined" matching the JS's optional-parameter behavior). Test: a golden fixture item with a real `hitEffect.conditionsSource` entry (same one used in Task A5's proc-path golden test), assert the accumulated magnitude at that condition's index matches the Rust port's equivalent intermediate (expose that intermediate as a `#[cfg(test)]`-only public function in `proc_effects.rs` if needed to compare against, or compare via the final `compute_combat_summary` output instead if isolating the intermediate isn't worth the extra Rust surface).

- [ ] **Step 7: Port the AP-delta accumulation loop** (`combatMath.js:254-281`, including the Taunt skill's monster-AP-drain term) using Steps 5/6's helpers, iterating over each of the 6 equipped item slots (weapon/shield/head/body/hand/feet/neck/leftring/rightring — whichever `comboIndices` resolved for this invocation) plus the monster's own `hitEffect`/`hitReceivedEffect`. Test against the golden fixture's intermediate `adjustedPlayer.maxAP`/`adjustedMonster.maxAP` — expose those as test-only Rust getters the same way as Step 6, or compare via final output.

- [ ] **Step 8: Port condition-proc accumulation for player and monster**, including the monster's `buildAdjustedMonster`-equivalent two-pass re-derivation with `cycleLength` for horde mode (`combatMath.js:302-361`) and the general combat skill procs (`applyGeneralCombatSkillProcs`, `combatMath.js:183-214`, using Step 0's skill-level fields). This is the most control-flow-heavy part of the port — write it as a WGSL function `build_adjusted_monster(cycle_length: f32) -> MonsterStats` called twice (matching `combatMath.js:326` then `359`), exactly mirroring the JS's two-call structure. Test against the golden horde-mode fixture from Task A5 Step 5.

- [ ] **Step 9: Port kill-triggered effects and final HP/damage numbers** (`combatMath.js:363-425`: kill-triggered AP/condition pass, `damagePerTurn`, `hpLossPerTurn`, `regenPerTurn` via `getExpectedConditionHPPerRound` reading `conditionTable`, `hitEffectHPPerTurn`, Eater skill flat HP, final `hpLossPerKill`/`hpGainPerKill`/`hpGainPerTurn`). Test: full `CombatSummaryGpu` output against the complete Task A5 golden fixture (both 1v1 and horde variants), every field within `1e-4` tolerance.

- [ ] **Step 10: Run all shader tests from Steps 3–9 together against both Task A5 golden fixtures** (1v1 and horde) as a final full-formula regression check before moving on.

- [ ] **Step 11: Commit**

```bash
git add src/shaders/randomSearch.wgsl docs/superpowers/plans/gpu-buffer-layout.md
git commit -m "Port full computeCombatSummary formula to WGSL compute shader"
```

---

### Task B4: Batch random combo-index generation

**Files:**
- Modify: `src/utils/combat/optimizer.js` — no changes needed if `buildDimensions`/`pickRandomCombo` are reused as-is; if a batch-oriented variant is clearer, add it alongside `pickRandomCombo` rather than replacing it (existing JS random-search fallback still calls the original)
- Create: `src/utils/combat/gpuRandomBatch.js`

**Interfaces:**
- Consumes: `buildDimensions` (existing, `optimizer.js:286-296`).
- Produces: `export function generateRandomComboBatch(dims, batchSize) -> Uint32Array` — `batchSize` tuples of `dims.length` indices each, flattened, ready to upload as `comboIndices` in Task B3's shader.

- [ ] **Step 1: Write a failing test**

```js
test('generateRandomComboBatch produces batchSize * dims.length indices within bounds', () => {
    const dims = [{ values: [1, 2, 3] }, { values: ['a', 'b'] }];
    const batch = generateRandomComboBatch(dims, 100);
    expect(batch.length).toBe(200);
    for (let i = 0; i < 100; i++) {
        expect(batch[i * 2]).toBeLessThan(3);
        expect(batch[i * 2 + 1]).toBeLessThan(2);
    }
});
```

- [ ] **Step 2: Run to verify it fails, implement, run to verify it passes**

```js
export function generateRandomComboBatch(dims, batchSize) {
    const out = new Uint32Array(batchSize * dims.length);
    for (let i = 0; i < batchSize; i++) {
        for (let d = 0; d < dims.length; d++) {
            out[i * dims.length + d] = Math.floor(Math.random() * dims[d].values.length);
        }
    }
    return out;
}
```

- [ ] **Step 3: Delete the test file per project convention, commit implementation**

```bash
git add src/utils/combat/gpuRandomBatch.js
git commit -m "Add batch random combo-index generation for GPU dispatch"
```

---

### Task B5: GPU pipeline module (device, buffers, dispatch, readback, reduce)

**Files:**
- Create: `src/utils/combat/gpuRandomSearch.js`

**Interfaces:**
- Consumes: `getGpuDevice` (B1), `packItemBuffer`/`packBuildAndMonsterBuffer` (B2), `randomSearch.wgsl` (B3, imported as a raw string — confirm during this task whether CRA's default webpack config needs a raw-loader rule added, or whether inlining the shader as a JS template string is simpler given no existing raw-asset import pattern in this codebase), `generateRandomComboBatch` (B4).
- Produces: `export async function runGpuRandomSearch(build, targets, { itemsById, conditionsById }, candidateLists, { batchSize = 65536, batchCount = 10, onProgress } = {}) -> { top10: Array }` — same top-10 shape as the JS engine's `insertIntoTop10` output (`{ equipment, summary, buildNumber }`) so it can plug into the same results UI without translation.

- [ ] **Step 1: Write the device/pipeline setup**

```js
import { getGpuDevice } from './gpuSupport';
import { packItemBuffer, packBuildAndMonsterBuffer } from './gpuDataLayout';
import { generateRandomComboBatch } from './gpuRandomBatch';
import { buildDimensions } from './optimizer';
import shaderSource from '../shaders/randomSearch.wgsl'; // resolve the exact import mechanism decided in this task

export async function runGpuRandomSearch(build, targets, { itemsById, conditionsById }, candidateLists, options = {}) {
    const device = await getGpuDevice();
    if (!device) throw new Error('WebGPU not supported');

    const { batchSize = 65536, batchCount = 10 } = options;
    const dims = buildDimensions(candidateLists, options.limitedItemIds, build);

    const { floatBuffer, u32Buffer } = packItemBuffer(candidateLists);
    const { buildAndMonsterBuffer, conditionTableBuffer } = packBuildAndMonsterBuffer(build, targets[0].monster, build.skillLevels, conditionsById);

    const itemsGpuBuffer = writeStorageBuffer(device, floatBuffer);
    const itemsU32GpuBuffer = writeStorageBuffer(device, u32Buffer);
    const buildAndMonsterGpuBuffer = writeStorageBuffer(device, buildAndMonsterBuffer);
    const conditionTableGpuBuffer = writeStorageBuffer(device, conditionTableBuffer);

    const module = device.createShaderModule({ code: shaderSource });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });

    // 6 f32 fields per CombatSummaryGpu struct (see randomSearch.wgsl) = 24 bytes/combo.
    const RESULT_STRIDE_BYTES = 24;

    const allSummaries = [];
    const allComboIndices = [];
    for (let b = 0; b < batchCount; b++) {
        const comboIndices = generateRandomComboBatch(dims, batchSize);
        const summaries = await dispatchBatch(device, pipeline, itemsGpuBuffer, itemsU32GpuBuffer, buildAndMonsterGpuBuffer, conditionTableGpuBuffer, comboIndices, batchSize, RESULT_STRIDE_BYTES);
        allSummaries.push(...summaries);
        allComboIndices.push(comboIndices);
        if (options.onProgress) options.onProgress({ evaluated: (b + 1) * batchSize, total: batchCount * batchSize });
    }

    return { top10: reduceToTop10(allSummaries, allComboIndices, dims, batchSize) };
}

function writeStorageBuffer(device, typedArray) {
    const buffer = device.createBuffer({ size: typedArray.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, typedArray);
    return buffer;
}

async function dispatchBatch(device, pipeline, itemsGpuBuffer, itemsU32GpuBuffer, buildAndMonsterGpuBuffer, conditionTableGpuBuffer, comboIndices, batchSize, resultStrideBytes) {
    const comboBuffer = device.createBuffer({ size: comboIndices.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(comboBuffer, 0, comboIndices);

    const outputByteLength = batchSize * resultStrideBytes;
    const outputBuffer = device.createBuffer({ size: outputByteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readBuffer = device.createBuffer({ size: outputByteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: itemsGpuBuffer } },
            { binding: 1, resource: { buffer: itemsU32GpuBuffer } },
            { binding: 2, resource: { buffer: buildAndMonsterGpuBuffer } },
            { binding: 3, resource: { buffer: conditionTableGpuBuffer } },
            { binding: 4, resource: { buffer: comboBuffer } },
            { binding: 5, resource: { buffer: outputBuffer } },
        ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(batchSize / 64));
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, outputByteLength);
    device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const floats = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();

    // Unpack the flat Float32Array into one object per combo, field order
    // matching CombatSummaryGpu in randomSearch.wgsl exactly.
    const summaries = [];
    for (let i = 0; i < batchSize; i++) {
        const o = i * 6;
        summaries.push({
            hpLossPerKill: floats[o], damagePerTurn: floats[o + 1], hpLossPerTurn: floats[o + 2],
            hpGainPerTurn: floats[o + 3], hpGainPerKill: floats[o + 4], difficulty: floats[o + 5],
        });
    }
    return summaries;
}

// Mirrors combatMath.js:114-121's getDifficultyLabel thresholds — the shader
// only returns the numeric difficulty (see Task B3 Step 4: WGSL has no
// string type), so the label is derived here instead.
function getDifficultyLabel(difficulty) {
    if (difficulty >= 80) return 'veryeasy';
    if (difficulty >= 60) return 'easy';
    if (difficulty >= 40) return 'normal';
    if (difficulty >= 20) return 'hard';
    if (difficulty === 0) return 'impossible';
    return 'veryhard';
}

function reduceToTop10(allSummaries, allComboIndices, dims, batchSize) {
    const entries = allSummaries.map((summary, flatIdx) => {
        const batchIdx = Math.floor(flatIdx / batchSize);
        const withinBatchIdx = flatIdx % batchSize;
        const comboIndices = allComboIndices[batchIdx];
        const equipment = {};
        for (let d = 0; d < dims.length; d++) {
            const idx = comboIndices[withinBatchIdx * dims.length + d];
            Object.assign(equipment, dims[d].values[idx]);
        }
        return { equipment, summary: { ...summary, difficultyLabel: getDifficultyLabel(summary.difficulty) }, buildNumber: flatIdx };
    });
    entries.sort((a, b) => {
        if (a.summary.hpLossPerKill !== b.summary.hpLossPerKill) return a.summary.hpLossPerKill - b.summary.hpLossPerKill;
        return b.summary.damagePerTurn - a.summary.damagePerTurn;
    });
    return entries.slice(0, 10);
}
```

- [ ] **Step 2: Verify manually against Task B3's golden-fixture single-combo value** — run `runGpuRandomSearch` with `batchSize = 1, batchCount = 1` forced to the same combo used in Task B3's golden fixture (Task A5 Step 1's fixture), confirm every field of the returned `top10[0].summary` matches within `1e-4` tolerance, not just `damagePerTurn`.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/gpuRandomSearch.js
git commit -m "Add GPU pipeline for batched random-search evaluation"
```

---

### Task B6: Wire into the optimizer's random-search option

**Files:**
- Modify: `src/components/calculator/OptimizerPanel.jsx` — locate the existing `randomSearchEnabled` toggle/call site
- Modify: `src/workers/optimizerWorker.js` — no change required if GPU path runs on the main thread via `runGpuRandomSearch` directly (WebGPU device access from a Worker requires `OffscreenCanvas`-style setup that isn't needed here since there's no rendering, just compute — confirm `navigator.gpu` is reachable from a Worker context in the target browsers during this task; if not, keep the GPU path on the main thread since a burst of async `mapAsync` calls won't block the UI thread significantly)

**Interfaces:**
- Consumes: `runGpuRandomSearch` (B5), `getGpuDevice` (B1) for the availability check.
- Produces: no new exports — this task only changes call-site wiring in `OptimizerPanel.jsx`.

- [ ] **Step 1: Add the availability check and branch**, alongside the existing `randomSearchEnabled` handling — if `await getGpuDevice()` succeeds, call `runGpuRandomSearch`; otherwise keep using the existing per-combo JS `pickRandomCombo` path inside `searchBestBuilds`/`optimizerWorker.js` untouched.

- [ ] **Step 2: Manual browser verification** — run the optimizer with random search enabled on a WebGPU-capable browser, confirm the "random top 10" panel populates with plausible, sane values (compare a couple of entries' `hpLossPerKill` against what the JS engine reports for the same equipment, computed manually via the existing Calculator page); then disable/spoof WebGPU (or test in a non-supporting browser) and confirm it falls back cleanly with no console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/calculator/OptimizerPanel.jsx
git commit -m "Wire GPU random search into OptimizerPanel with fallback"
```

---

### Task B7: Cross-check GPU results against the JS engine (validation pass)

**Files:**
- No new source files — this is a verification task using a throwaway script, per project convention.

**Interfaces:**
- Consumes: `runGpuRandomSearch` (B5), `computeCombatSummary` (existing JS, `combatMath.js`).

- [ ] **Step 1: Write a throwaway comparison script**

```js
// scratch/compareGpuVsJs.js — delete after running
import { runGpuRandomSearch } from '../src/utils/combat/gpuRandomSearch';
import { computeCombatSummary } from '../src/utils/combat/combatMath';

async function run() {
    // Pick fixtures that specifically exercise procs/conditions/horde mode,
    // not just plain-stat weapons — those are the paths most likely to have
    // a porting bug, since the base damage formula (Task B3 Step 3) was
    // already golden-value-tested in isolation.
    const { top10 } = await runGpuRandomSearch(build, targets, { itemsById, conditionsById }, candidateLists, { batchSize: 1000, batchCount: 1 });
    for (const entry of top10) {
        const candidateBuild = { ...build, equipment: entry.equipment };
        const jsSummary = computeCombatSummary(candidateBuild, targets[0].monster, { itemsById, conditionsById });
        for (const field of ['damagePerTurn', 'hpLossPerTurn', 'hpGainPerTurn', 'hpLossPerKill', 'hpGainPerKill', 'difficulty']) {
            const diff = Math.abs(jsSummary[field] - entry.summary[field]);
            console.log(entry.equipment, field, 'diff:', diff);
        }
    }
}
run();
```

- [ ] **Step 2: Run it, inspect the diffs**

Expected: every field within `1e-4` tolerance (float32 vs float64 rounding) for every combo, procs and horde mode included — Track B now implements the full formula, so there is no scope-driven gap left to explain away. Any diff larger than float rounding is a genuine porting bug in `randomSearch.wgsl`; go fix it in Task B3 (identify which of Steps 3–9 covers the diverging term, since each step is scoped to one part of the formula) rather than documenting it as expected.

- [ ] **Step 3: Delete the scratch script**

```bash
rm scratch/compareGpuVsJs.js
```

No commit needed for this task (verification only, no source changes) — but if Step 2 surfaces a real bug in Task B3's shader, fix it there and follow that task's own commit step.

---

## Self-Review Notes

- **Spec coverage:** Track A covers "best-first search → Rust" end to end (scaffold → data model → stat engine → proc effects → combat math → search algorithm → wasm export → worker sharding → UI wiring). Track B covers "random search → GPU" end to end (feature detection → data layout → shader → batch generation → pipeline → UI wiring → validation). Both explicitly address the GitHub Pages hosting constraint surfaced in conversation (no `SharedArrayBuffer`, so Track A shards via independent worker instances rather than shared-memory threads).
- **Fallback behavior:** Task A9 and B6 both require the pre-existing JS engine to remain the fallback path — never delete `src/utils/combat/optimizer.js`'s pure-JS path or `src/workers/optimizerWorker.js`.
- **Full formula parity:** Track B (revised) ports all of `combatMath.js` into WGSL, not a reduced subset — Task B3 Steps 3–9 cover base damage/hit-chance, difficulty, AP deltas, proc conditions (player and monster, including horde-mode `cycleLength` re-derivation and general combat skill procs), and kill-triggered effects, in the same order and against the same golden fixtures as Track A's Rust port (Task A5). Task B7's cross-check therefore expects near-zero diffs across every field, not just the base formula — any real diff is a bug to fix, not an accepted limitation.
- **Proc-slot and condition-ID caps are verified against real game data, not guessed:** 4 slots per condition-list field (Task B2, scanned from `public/raw/itemlist_*.json`, real max 3) and a 256-entry condition-ID accumulator (Task B3 Step 0, scanned from `public/raw/actorconditions_*.json`, real count 131) — both include the re-runnable scan script and instructions to bump the constant if a future game-data update exceeds it.
