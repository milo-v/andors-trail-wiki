# Optimizer Native Acceleration (Rust/WASM Best-First + WebGPU Random Search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan phase-by-phase in this session (batch execution with a review checkpoint after each phase). Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are grouped into 9 phases (5 in Track A, 4 in Track B); each phase ends in exactly one commit, so a phase is the natural pause/review point for inline execution — don't stop mid-phase unless blocked.

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
- Follow the "no automated tests kept in the repo" project convention: write throwaway verification scripts/tests during development, delete them before considering a phase done, unless a step is explicitly a Rust `#[test]` (those live with the Rust crate, which is new source, not app test suite churn) — each phase's steps say which is which.

## Branch Setup

This work happens on its own branch, not on `master`. Before Phase A1, run:

```bash
git checkout master
git pull
git checkout -b feature/optimizer-native-acceleration
```

All 9 phases' commits land on `feature/optimizer-native-acceleration`. When every phase is complete and verified, use `superpowers:finishing-a-development-branch` to decide how to integrate it (merge/PR/etc.) — don't merge or push preemptively mid-plan.

---

## Track A: Best-first search → Rust/WASM, worker-pool sharded

### Phase A1: Crate scaffold + data model

**Covers former Tasks A1 + A2.**

**Files:**
- Create: `rust/optimizer-core/Cargo.toml`
- Create: `rust/optimizer-core/src/lib.rs`
- Create: `rust/optimizer-core/src/model.rs`
- Create: `rust/optimizer-core/.cargo/config.toml` (target default, if needed)
- Modify: `package.json` — add a `build:wasm` script
- Modify: `.gitignore` — ignore `rust/optimizer-core/target/` and `rust/optimizer-core/pkg/`

**Interfaces:**
- Produces: a `wasm-bindgen` export `ping(n: u32) -> u32` (returns `n + 1`) — purely to prove the toolchain works end to end before any real logic is ported.
- Produces: a build script that emits JS glue + `.wasm` binary into `src/wasm/optimizer_core/` (checked into `public`/`src` so CRA can bundle it — decide during this phase whether to import it via CRA's built-in WASM asset support or copy-on-build; document the choice in a comment at the top of `lib.rs`).
- Produces: `pub struct Item`, `pub struct Monster`, `pub struct Condition`, `pub struct Build`, each `#[derive(Deserialize)]`, covering exactly the fields read by `statEngine.js`/`combatMath.js`/`procEffects.js` (cross-reference those files field-by-field while writing this — do not port fields nothing downstream reads). Also `pub struct SearchConfig { build: Build, targets: Vec<Target>, items_by_id: HashMap<String, Item>, conditions_by_id: HashMap<String, Condition>, candidate_lists: CandidateLists, max_hp_loss: Option<f64>, limited_item_ids: Vec<String> }` mirroring `searchBestBuilds`'s parameters in `optimizer.js:482-483`.

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

- [ ] **Step 4: Verify the app can import the generated glue, then delete the smoketest**

Add a throwaway test in `src/wasm/optimizer-core.smoketest.js`:
```js
import init, { ping } from './optimizer-core/optimizer_core.js';

async function run() {
    await init();
    console.log('ping(41) =', ping(41));
}
run();
```
Run it via a scratch HTML page or `npm start` + browser console import; confirm `42` logs with no console errors (in particular no MIME-type/module-resolution errors from CRA's webpack config — if CRA rejects the `.wasm` import, note the exact error here before moving on, since it determines whether Phase A5 needs a `CRACO`/webpack override). Then delete it:

```bash
rm src/wasm/optimizer-core.smoketest.js
```

- [ ] **Step 5: Write a failing Rust test with a literal item fixture**

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

- [ ] **Step 6: Run to verify it fails**

```bash
cd rust/optimizer-core && cargo test deserializes_item_with_equip_effect
```
Expected: compile error, `Item` not defined.

- [ ] **Step 7: Implement the structs**

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
    // read them — extend this struct incrementally as later phases need
    // each field, rather than guessing the full shape up front.
}

// Monster, Condition, Build, Target, CandidateLists follow the same
// pattern: one field per thing statEngine.js/combatMath.js actually reads.
```

- [ ] **Step 8: Run to verify it passes**

```bash
cargo test deserializes_item_with_equip_effect
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add rust/optimizer-core package.json .gitignore
git commit -m "Scaffold Rust/WASM crate with data model for optimizer-core"
```

---

### Phase A2: Stat resolution + proc effects

**Covers former Tasks A3 + A4.**

**Files:**
- Create: `rust/optimizer-core/src/stat_engine.rs`
- Create: `rust/optimizer-core/src/proc_effects.rs`
- Reference (read, do not modify): `src/utils/combat/statEngine.js` (all of `resolvePlayerStats`, `resolveMonsterStats`, `resolveEquipped`, `getEquipmentConditions`, `mergeConditionInstances`, `applyGeneralCombatSkills`, `buildBaseStats`), `src/utils/combat/procEffects.js`

**Interfaces:**
- Consumes: `model::{Item, Monster, Build, Condition}` from Phase A1.
- Produces: `pub fn resolve_player_stats(build: &Build, items_by_id: &HashMap<String, Item>, conditions_by_id: &HashMap<String, Condition>, precomputed_base: Option<&PlayerStats>) -> PlayerStats`, `pub fn resolve_monster_stats(monster: &Monster, active_conditions: &[ConditionEntry], conditions_by_id: &HashMap<String, Condition>) -> PlayerStats`, `pub fn resolve_equipped(equipment: &Equipment, items_by_id: &HashMap<String, Item>) -> Equipped`, `pub fn get_equipment_conditions(equipped: &Equipped) -> Vec<ConditionEntry>`, `pub fn merge_condition_instances(instances: &[ConditionEntry], conditions_by_id: &HashMap<String, Condition>) -> HashMap<String, f64>` — one-to-one with the JS function names.
- Produces: `pub fn average_range(range: Option<&Range>) -> f64`, `pub fn get_expected_boost_per_turn(...) -> f64`, `pub fn apply_expected_proc_conditions(stats: &mut PlayerStats, sources: Option<&[ConditionEntry]>, hit_chance: f64, attacks_per_turn: f64, conditions_by_id: &HashMap<String, Condition>, cycle_length: Option<f64>)` — signatures mirror the JS call sites in `combatMath.js` exactly (same parameter order) so Phase A3's port is a mechanical transliteration.
- These are consumed by `combat_math::compute_combat_summary` in Phase A3.

- [ ] **Step 1: Write a failing test that pins one golden value for `resolve_player_stats`**

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

- [ ] **Step 5: Repeat the fail→port→pass loop for `resolveMonsterStats`, `resolveEquipped`, `getEquipmentConditions`, `mergeConditionInstances`**

Each gets its own golden-value test captured from the corresponding JS function — do not batch multiple functions into one test.

- [ ] **Step 6: Write failing test for `average_range`** (simplest proc-effects function, proves the module compiles)

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

- [ ] **Step 7: Run to verify it fails, implement `average_range`, run to verify it passes**

```bash
cargo test average_range
```

- [ ] **Step 8: Repeat the fail→port→pass loop for `get_expected_boost_per_turn` and `apply_expected_proc_conditions`**, each with a golden value captured from the JS (same technique as Step 1).

- [ ] **Step 9: Commit**

```bash
git add rust/optimizer-core/src/stat_engine.rs rust/optimizer-core/src/proc_effects.rs
git commit -m "Port statEngine.js and procEffects.js to Rust with golden-value tests"
```

---

### Phase A3: Combat math port

**Covers former Task A5.**

**Files:**
- Create: `rust/optimizer-core/src/combat_math.rs`
- Reference: `src/utils/combat/combatMath.js:228-425`

**Interfaces:**
- Consumes: `stat_engine::{resolve_player_stats, resolve_monster_stats, resolve_equipped, get_equipment_conditions, merge_condition_instances}`, `proc_effects::*`.
- Produces: `pub struct CombatSummary { pub difficulty: f64, pub difficulty_label: String, pub damage_per_turn: f64, pub hp_loss_per_turn: f64, pub hp_gain_per_turn: f64, pub hp_loss_per_kill: f64, pub hp_gain_per_kill: f64 }` and `pub fn compute_combat_summary(build: &Build, monster: &Monster, items_by_id: &HashMap<String, Item>, conditions_by_id: &HashMap<String, Condition>, horde: Option<&Horde>, precomputed: Option<&Precomputed>) -> CombatSummary` — field names and function name match `combatMath.js` exactly (snake_case of the same identifiers) so `search.rs` (Phase A4) calls it the same way `optimizer.js:531` does.

- [ ] **Step 1: Write a failing golden-value test for the 1v1, no-horde case**

Capture from the running app (or a Node script) `computeCombatSummary(build, monster, {...}, undefined, {})`'s full output for one fixed build+monster pair with at least one equipped item that has a `hitEffect.conditionsSource` (to exercise the proc path, not just the trivial no-conditions path). Hardcode every field of the returned object into the test assertion. **Keep this exact fixture recorded somewhere durable (a comment or a `fixtures` module) — Phase B2's WGSL port reuses it directly instead of recapturing.**

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

- [ ] **Step 5: Add a second golden-value test covering horde mode** (`horde.size > 1`, exercising `buildAdjustedMonster`'s `cycleLength` re-derivation at `combatMath.js:358-361` and the kill-triggered AP/condition pass at `combatMath.js:363-370`), following the same fail→port(if gaps found)→pass loop. **Keep this fixture recorded too — Phase B2 reuses it.**

- [ ] **Step 6: Commit**

```bash
git add rust/optimizer-core/src/combat_math.rs
git commit -m "Port computeCombatSummary to Rust with golden-value tests"
```

---

### Phase A4: Best-first search port

**Covers former Task A6.**

**Files:**
- Create: `rust/optimizer-core/src/search.rs`
- Reference: `src/utils/combat/optimizer.js:139-570` (`insertIntoTop10`, `isDisallowedPair`, `buildWeaponShieldPairs`, `sameCandidateSet`, `buildRingPairs`, `buildDimensions`, `MaxHeap`, `bestFirstCombos`, `searchBestBuilds`)

**Interfaces:**
- Consumes: `combat_math::compute_combat_summary`, pre-sorted, pre-pruned candidate item-id lists per slot (produced by the *existing JS* `buildCandidateLists`/`selectCandidates` — Rust does not reimplement `valueScoring.js`'s scoring/pruning, only consumes its already-ranked output).
- Produces: `pub struct SearchResult { pub best_first: Vec<Top10Entry>, pub evaluated: u64, pub total: u64 }` and `pub fn search_best_builds(config: &ShardConfig) -> SearchResult` where `ShardConfig` additionally carries `shard_start_rank: u32, shard_stride: u32` (see Phase A5 — this is how one shard skips combos belonging to other shards without needing to know about them).

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

- [ ] **Step 5: Port `search_best_builds`** (`optimizer.js:482-570`), including the `shard_start_rank`/`shard_stride` skip logic that Phase A5 needs — a single-shard call (`shard_stride = 1`) must reproduce the JS engine's un-sharded behavior exactly, so write that as the correctness test:

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

### Phase A5: WASM export + worker sharding + UI wiring

**Covers former Tasks A7 + A8 + A9.**

**Files:**
- Modify: `rust/optimizer-core/src/lib.rs` — add the public wasm-bindgen surface
- Modify: `package.json` — `build:wasm` runs before `build`/`start` (a `prebuild`/`prestart` script, or documented manual step if CRA's dev server hot-reload doesn't need it rebuilt often)
- Create: `src/workers/optimizerWasmWorker.js`
- Create: `src/utils/combat/wasmSearchCoordinator.js`
- Create: `src/utils/combat/wasmSupport.js`
- Modify: `src/components/calculator/OptimizerPanel.jsx`

**Interfaces:**
- Produces: `#[wasm_bindgen] pub fn search_best_builds_js(config_json: &str) -> String` — takes/returns JSON strings (simplest `wasm-bindgen` boundary) matching the shape JS already builds for `optimizerWorker.js`'s `event.data` today.
- Produces: `export async function runShardedSearch(build, targets, { itemsById, conditionsById }, candidateLists, options)` in `wasmSearchCoordinator.js` — same call signature as `searchBestBuilds` in `optimizer.js:482`, so `OptimizerPanel.jsx` can switch between engines without changing its own call site shape.
- Produces: `export async function isWasmSupported()` in `wasmSupport.js` — attempts `WebAssembly.instantiate` a trivial module and returns `false` on any throw.

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

- [ ] **Step 3: Write `optimizerWasmWorker.js`**

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

- [ ] **Step 4: Write a throwaway test spawning one worker directly and confirming it returns a result, then delete it** — e.g. a scratch HTML page loaded via `npm start` that posts a small fixture config and logs the response.

- [ ] **Step 5: Write the coordinator**

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

- [ ] **Step 6: Verify end-to-end against the fixture used in Phase A4 Step 5** — run `runShardedSearch` with `shardCount` forced to e.g. 4 on the same fixture, assert the merged top-10 matches the single-shard/JS-engine top-10 from Phase A4.

- [ ] **Step 7: Write `wasmSupport.js`**

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

- [ ] **Step 8: In `OptimizerPanel.jsx`, branch the search invocation on `isWasmSupported()`**, keeping the existing `optimizerWorker.js` path as the untouched fallback — locate the existing call site that posts to `optimizerWorker.js` and add the WASM branch alongside it, gated behind the feature-detect result (and, if you want a user-visible off switch, a checkbox — this is a UI decision to confirm with the user before adding UI, not something to assume silently).

- [ ] **Step 9: Manual browser verification** — run `npm start`, open the Calculator page, run an optimizer search with the WASM engine active, confirm results render in `ResultsPanel`/top-10 UI identically in shape to the JS-engine path.

- [ ] **Step 10: Commit**

```bash
git add rust/optimizer-core/src/lib.rs package.json src/workers/optimizerWasmWorker.js src/utils/combat/wasmSearchCoordinator.js src/utils/combat/wasmSupport.js src/components/calculator/OptimizerPanel.jsx
git commit -m "Expose WASM search via worker-pool sharding, wire into OptimizerPanel with fallback"
```

---

## Track B: Random search → WebGPU compute shader

### Phase B1: Feature detection + buffer layout

**Covers former Tasks B1 + B2.**

**Files:**
- Create: `src/utils/combat/gpuSupport.js`
- Create: `src/utils/combat/gpuDataLayout.js`
- Create: `gpu-buffer-layout.md` (buffer struct documentation — the WGSL shader in Phase B2 must byte-for-byte match this; keeping it as a standalone doc avoids the layout drifting out of sync between the JS packer and the shader source)

**Interfaces:**
- Produces: `export async function getGpuDevice()` — returns a `GPUDevice` or `null` (never throws), so every caller downstream can treat "no WebGPU" as a plain falsy check.
- Produces: `export function packItemBuffer(candidateLists) -> { floatBuffer: Float32Array, u32Buffer: Uint32Array, itemIndexBySlotAndCandidate: Map }` — one fixed-width record per item, with each of the six combat-relevant condition-list fields (`equipEffect.addedConditions`, `hitEffect.conditionsSource`/`conditionsTarget`, `hitReceivedEffect.conditionsSource`/`conditionsTarget`, `killEffect.conditionsSource`) padded to exactly 4 slots (verified cap — see Step 3), since WGSL has no dynamic-length arrays inside a struct — and `export function packBuildAndMonsterBuffer(build, monster, skillLevels) -> Float32Array`.

- [ ] **Step 1: Write the WebGPU detection function**

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

- [ ] **Step 3: Document the buffer layout, using the verified proc-slot cap**

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

Write `gpu-buffer-layout.md` listing, in order, every `f32`/`u32` field per item record: damage min/max, armor rating, block chance contribution, then for each of the six combat-relevant condition-list fields above, exactly **4 fixed slots**, each slot laid out as `[conditionIndex: u32, magnitude: f32, chance: f32, duration: f32]`. Unused slots (i.e. beyond an item's real entry count) are padded with `conditionIndex = 0xFFFFFFFF` as the "empty, skip" sentinel — e.g. `ring_antipoison`'s 3 real `addedConditions` entries fill slots 0–2, slot 3 is sentinel-padded; an item with zero added conditions has all 4 slots sentinel-padded. Derive every non-condition field from what `combat_math.rs`/`combatMath.js` actually reads — don't guess those. Also document the equivalent layout for the build/monster record. This doc is the single source of truth Phase B2's WGSL struct must match field-for-field.

- [ ] **Step 4: Write failing tests for `packItemBuffer` on small fixtures**

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

(`getAddedConditionsSlotOffsets` is a small test-only helper reading the 4 slot offsets straight from `gpu-buffer-layout.md`'s documented layout — write it inline in the test file, not as a new exported function.)

- [ ] **Step 5: Run to verify it fails, implement `packItemBuffer`/`packBuildAndMonsterBuffer` to match the documented layout, run to verify it passes**

- [ ] **Step 6: Delete the test file**

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/gpuSupport.js src/utils/combat/gpuDataLayout.js gpu-buffer-layout.md
git commit -m "Add WebGPU feature detection and buffer packing for item/build/monster data"
```

---

### Phase B2: WGSL compute shader implementing the FULL `computeCombatSummary` formula

**Covers former Task B3. Kept as its own phase — this is the largest single unit of work in the plan.**

**Files:**
- Create: `src/shaders/randomSearch.wgsl`
- Modify: `gpu-buffer-layout.md` — add the condition-ID table and build/monster skill-level fields this phase's port needs (see Step 1)

**Interfaces:**
- Consumes: the buffer layout from Phase B1 (`gpu-buffer-layout.md`) as `@group(0) @binding(0..N)` storage buffers, a `comboIndices: array<u32>` buffer (one tuple of per-slot candidate indices per invocation, laid out contiguously, from Phase B3), and a new `conditionTable: array<f32>` storage buffer (per-condition-id `roundEffect.increaseCurrentHP` min/max, for `getExpectedConditionHPPerRound` — see Step 1).
- Produces: an `outputResults: array<CombatSummaryGpu>` buffer, one full result struct per invocation index — `{ hp_loss_per_kill: f32, damage_per_turn: f32, hp_loss_per_turn: f32, hp_gain_per_turn: f32, hp_gain_per_kill: f32, difficulty: f32 }`, field-for-field matching `combat_math.rs`'s `CombatSummary` (Phase A3) so Phase B4's cross-check compares every field, not just two.

This phase ports **all** of `combatMath.js:1-425`, not a subset. Do not compress the fail→port→pass loop across multiple functions at once; WGSL has no debugger and a wrong sign or missed early-return several functions deep is much easier to isolate one function at a time.

- [ ] **Step 1: Extend the buffer layout for condition IDs and skill levels**

Two things Phase B1 didn't need yet, now required for the full formula:
1. **Condition-ID table.** `mergeConditionInstances` (`statEngine.js`) aggregates condition magnitudes *by condition ID* across every source (equipment + `build.activeConditions`), and `getExpectedConditionHPPerRound` (`combatMath.js:134-145`) then looks up each aggregated ID's `roundEffect.increaseCurrentHP`. WGSL has no hash map, so this needs a dense integer ID space: assign every condition in `conditionsById` a stable index `0..conditionCount` when packing buffers (a plain JS `Object.keys(conditionsById)` order is fine, just must be the same order used to build both `conditionTable` and every item's proc-slot `conditionIndex` fields). A scan of `public/raw/actorconditions_*.json` found **131 distinct condition IDs** in the current game data; size the shader's private per-invocation accumulator array at a rounded-up constant `CONDITION_SLOT_COUNT = 256u` (documented safety margin, same reasoning as Phase B1's proc-slot cap — re-run the scan below and bump the constant if a future game version exceeds it):
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

- [ ] **Step 2: Shader skeleton + buffer round-trip** (prove the pipeline before porting any formula)

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

- [ ] **Step 3: Verify the pipeline round-trips** via a throwaway script (a minimal stand-in for Phase B3's real pipeline module, just enough to dispatch and read back): confirm `outputResults` comes back as the expected number of all-zero structs, no WebGPU validation errors.

- [ ] **Step 4: Port the base damage/hit-chance formulas** (`combatMath.js:10-100`: `getAttacksPerTurn`, `getEffectiveCriticalChance`, `hasCriticalAttack`, `getAttackHitChance`, `getAverageDamagePerHit`, `getAverageDamagePerTurn`, `getTurnsToKillTarget`) as WGSL functions operating on a `PlayerStats`-equivalent struct read from `buildAndMonster`/`items`. Test against the same golden fixture Phase A3 Step 1 already captured (reuse it — don't recapture): dispatch a single combo matching that fixture, assert `damage_per_turn` matches `combat_math.rs`'s test value within `1e-4` float32 tolerance.

- [ ] **Step 5: Port `getMonsterDifficulty`/`getDifficultyLabel`** (`combatMath.js:103-121`) — note WGSL has no string type, so `difficulty_label` is **not** part of `CombatSummaryGpu`; only the numeric `difficulty` is returned, and the JS caller (Phase B3) derives the label from the number using the same thresholds as `getDifficultyLabel`, client-side. Test: same golden fixture, assert `difficulty` matches.

- [ ] **Step 6: Port `procEffects.js`'s `averageRange`/`getExpectedBoostPerTurn`** as WGSL functions reading a fixed-size proc-slot array (per Phase B1's 4-slot layout) and summing only non-sentinel entries. Test with a synthetic item that has exactly 2 of 4 `hitEffect.increaseCurrentAP`-style slots filled, assert the sum ignores the 2 sentinel slots.

- [ ] **Step 7: Port `applyExpectedProcConditions`** (`procEffects.js`) — for each of the 4 proc slots on a given effect field, if not sentinel, look up `conditionTable[conditionIndex]` and accumulate into a `var<function> accumulated: array<f32, 256>` (indexed by condition ID, per Step 1's dense ID space) weighted by hit chance/attacks-per-turn/chance/duration exactly as the JS does, including the `cycleLength` parameter (pass as an `f32`, `-1.0` sentinel for "undefined" matching the JS's optional-parameter behavior). Test: a golden fixture item with a real `hitEffect.conditionsSource` entry (same one used in Phase A3's proc-path golden test), assert the accumulated magnitude at that condition's index matches the Rust port's equivalent intermediate (expose that intermediate as a `#[cfg(test)]`-only public function in `proc_effects.rs` if needed to compare against, or compare via the final `compute_combat_summary` output instead if isolating the intermediate isn't worth the extra Rust surface).

- [ ] **Step 8: Port the AP-delta accumulation loop** (`combatMath.js:254-281`, including the Taunt skill's monster-AP-drain term) using Steps 6/7's helpers, iterating over each of the 6 equipped item slots (weapon/shield/head/body/hand/feet/neck/leftring/rightring — whichever `comboIndices` resolved for this invocation) plus the monster's own `hitEffect`/`hitReceivedEffect`. Test against the golden fixture's intermediate `adjustedPlayer.maxAP`/`adjustedMonster.maxAP` — expose those as test-only Rust getters the same way as Step 7, or compare via final output.

- [ ] **Step 9: Port condition-proc accumulation for player and monster**, including the monster's `buildAdjustedMonster`-equivalent two-pass re-derivation with `cycleLength` for horde mode (`combatMath.js:302-361`) and the general combat skill procs (`applyGeneralCombatSkillProcs`, `combatMath.js:183-214`, using Step 1's skill-level fields). This is the most control-flow-heavy part of the port — write it as a WGSL function `build_adjusted_monster(cycle_length: f32) -> MonsterStats` called twice (matching `combatMath.js:326` then `359`), exactly mirroring the JS's two-call structure. Test against the golden horde-mode fixture from Phase A3 Step 5.

- [ ] **Step 10: Port kill-triggered effects and final HP/damage numbers** (`combatMath.js:363-425`: kill-triggered AP/condition pass, `damagePerTurn`, `hpLossPerTurn`, `regenPerTurn` via `getExpectedConditionHPPerRound` reading `conditionTable`, `hitEffectHPPerTurn`, Eater skill flat HP, final `hpLossPerKill`/`hpGainPerKill`/`hpGainPerTurn`). Test: full `CombatSummaryGpu` output against the complete Phase A3 golden fixture (both 1v1 and horde variants), every field within `1e-4` tolerance.

- [ ] **Step 11: Run all shader tests from Steps 4–10 together against both Phase A3 golden fixtures** (1v1 and horde) as a final full-formula regression check before moving on.

- [ ] **Step 12: Commit**

```bash
git add src/shaders/randomSearch.wgsl gpu-buffer-layout.md
git commit -m "Port full computeCombatSummary formula to WGSL compute shader"
```

---

### Phase B3: Batch generation + GPU pipeline

**Covers former Tasks B4 + B5.**

**Files:**
- Modify: `src/utils/combat/optimizer.js` — no changes needed if `buildDimensions`/`pickRandomCombo` are reused as-is; if a batch-oriented variant is clearer, add it alongside `pickRandomCombo` rather than replacing it (existing JS random-search fallback still calls the original)
- Create: `src/utils/combat/gpuRandomBatch.js`
- Create: `src/utils/combat/gpuRandomSearch.js`

**Interfaces:**
- Consumes: `buildDimensions` (existing, `optimizer.js:286-296`), `getGpuDevice` (Phase B1), `packItemBuffer`/`packBuildAndMonsterBuffer` (Phase B1), `randomSearch.wgsl` (Phase B2, imported as a raw string — confirm during this phase whether CRA's default webpack config needs a raw-loader rule added, or whether inlining the shader as a JS template string is simpler given no existing raw-asset import pattern in this codebase).
- Produces: `export function generateRandomComboBatch(dims, batchSize) -> Uint32Array` — `batchSize` tuples of `dims.length` indices each, flattened, ready to upload as `comboIndices`.
- Produces: `export async function runGpuRandomSearch(build, targets, { itemsById, conditionsById }, candidateLists, { batchSize = 65536, batchCount = 10, onProgress } = {}) -> { top10: Array }` — same top-10 shape as the JS engine's `insertIntoTop10` output (`{ equipment, summary, buildNumber }`) so it can plug into the same results UI without translation.

- [ ] **Step 1: Write a failing test for `generateRandomComboBatch`**

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

- [ ] **Step 3: Delete the test file**

- [ ] **Step 4: Write the GPU pipeline module** (device/pipeline setup, dispatch, readback, reduce to top10)

```js
import { getGpuDevice } from './gpuSupport';
import { packItemBuffer, packBuildAndMonsterBuffer } from './gpuDataLayout';
import { generateRandomComboBatch } from './gpuRandomBatch';
import { buildDimensions } from './optimizer';
import shaderSource from '../shaders/randomSearch.wgsl'; // resolve the exact import mechanism decided in this phase

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
// only returns the numeric difficulty (see Phase B2 Step 5: WGSL has no
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

- [ ] **Step 5: Verify manually against Phase B2's golden-fixture single-combo value** — run `runGpuRandomSearch` with `batchSize = 1, batchCount = 1` forced to the same combo used in Phase B2's golden fixture (Phase A3 Step 1's fixture), confirm every field of the returned `top10[0].summary` matches within `1e-4` tolerance, not just `damagePerTurn`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/gpuRandomBatch.js src/utils/combat/gpuRandomSearch.js
git commit -m "Add batch random combo-index generation and GPU pipeline for random search"
```

---

### Phase B4: Wire in + validate

**Covers former Tasks B6 + B7.**

**Files:**
- Modify: `src/components/calculator/OptimizerPanel.jsx` — locate the existing `randomSearchEnabled` toggle/call site
- Modify: `src/workers/optimizerWorker.js` — no change required if GPU path runs on the main thread via `runGpuRandomSearch` directly (WebGPU device access from a Worker requires `OffscreenCanvas`-style setup that isn't needed here since there's no rendering, just compute — confirm `navigator.gpu` is reachable from a Worker context in the target browsers during this phase; if not, keep the GPU path on the main thread since a burst of async `mapAsync` calls won't block the UI thread significantly)
- No new source files for validation — that part uses a throwaway script, per project convention.

**Interfaces:**
- Consumes: `runGpuRandomSearch` (Phase B3), `getGpuDevice` (Phase B1), `computeCombatSummary` (existing JS, `combatMath.js`).

- [ ] **Step 1: Add the availability check and branch**, alongside the existing `randomSearchEnabled` handling — if `await getGpuDevice()` succeeds, call `runGpuRandomSearch`; otherwise keep using the existing per-combo JS `pickRandomCombo` path inside `searchBestBuilds`/`optimizerWorker.js` untouched.

- [ ] **Step 2: Manual browser verification** — run the optimizer with random search enabled on a WebGPU-capable browser, confirm the "random top 10" panel populates with plausible, sane values (compare a couple of entries' `hpLossPerKill` against what the JS engine reports for the same equipment, computed manually via the existing Calculator page); then disable/spoof WebGPU (or test in a non-supporting browser) and confirm it falls back cleanly with no console errors.

- [ ] **Step 3: Write a throwaway comparison script cross-checking GPU vs JS**

```js
// scratch/compareGpuVsJs.js — delete after running
import { runGpuRandomSearch } from '../src/utils/combat/gpuRandomSearch';
import { computeCombatSummary } from '../src/utils/combat/combatMath';

async function run() {
    // Pick fixtures that specifically exercise procs/conditions/horde mode,
    // not just plain-stat weapons — those are the paths most likely to have
    // a porting bug, since the base damage formula (Phase B2 Step 4) was
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

- [ ] **Step 4: Run it, inspect the diffs**

Expected: every field within `1e-4` tolerance (float32 vs float64 rounding) for every combo, procs and horde mode included — Track B implements the full formula, so there is no scope-driven gap to explain away. Any diff larger than float rounding is a genuine porting bug in `randomSearch.wgsl`; go fix it in Phase B2 (identify which of Steps 4–10 covers the diverging term, since each step is scoped to one part of the formula) rather than documenting it as expected.

- [ ] **Step 5: Delete the scratch script**

```bash
rm scratch/compareGpuVsJs.js
```

- [ ] **Step 6: Commit**

```bash
git add src/components/calculator/OptimizerPanel.jsx
git commit -m "Wire GPU random search into OptimizerPanel with fallback"
```

(If Step 4 surfaced a real bug fixed in Phase B2's files, that fix was already committed as part of Phase B2's own commit step — amend only if Phase B2's commit hasn't happened yet in this session; otherwise this is a clean, separate commit.)

---

## Self-Review Notes

- **Spec coverage:** Track A (Phases A1–A5) covers "best-first search → Rust" end to end: scaffold + data model → stat engine + proc effects → combat math → search algorithm → wasm export + worker sharding + UI wiring. Track B (Phases B1–B4) covers "random search → GPU" end to end: feature detection + buffer layout → full-formula shader → batch generation + pipeline → UI wiring + validation. Both explicitly address the GitHub Pages hosting constraint (no `SharedArrayBuffer`, so Track A shards via independent worker instances rather than shared-memory threads).
- **Fallback behavior:** Phase A5 and Phase B4 both require the pre-existing JS engine to remain the fallback path — never delete `src/utils/combat/optimizer.js`'s pure-JS path or `src/workers/optimizerWorker.js`.
- **Full formula parity:** Track B ports all of `combatMath.js` into WGSL, not a reduced subset — Phase B2 Steps 4–10 cover base damage/hit-chance, difficulty, AP deltas, proc conditions (player and monster, including horde-mode `cycleLength` re-derivation and general combat skill procs), and kill-triggered effects, in the same order and against the same golden fixtures as Track A's Rust port (Phase A3). Phase B4's cross-check therefore expects near-zero diffs across every field, not just the base formula — any real diff is a bug to fix, not an accepted limitation.
- **Proc-slot and condition-ID caps are verified against real game data, not guessed:** 4 slots per condition-list field (Phase B1, scanned from `public/raw/itemlist_*.json`, real max 3) and a 256-entry condition-ID accumulator (Phase B2 Step 1, scanned from `public/raw/actorconditions_*.json`, real count 131) — both include the re-runnable scan script and instructions to bump the constant if a future game-data update exceeds it.
- **Inline-execution grouping:** the original 16 fine-grained tasks are grouped into 9 phases so each phase ends in exactly one commit and is a natural checkpoint for `superpowers:executing-plans`'s batch-execution-with-checkpoints flow, rather than reviewing after every 2-5-minute step.
