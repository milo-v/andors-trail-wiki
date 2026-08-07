// Splits the top-level weapon/shield dimension (dims[0].values) into
// `shardCount` contiguous slices, one per worker — each worker gets a
// disjoint subset of the outermost dimension, so no two workers can ever
// evaluate the same combo, and merging is a plain top-10 merge with no
// dedup needed. See optimizer.js:280-296 for why the weapon/shield pair
// is always dims[0].
import { buildDimensions } from './optimizer';

function partitionWeaponShieldDim(candidateLists, limitedItemIds, build, shardCount) {
    const dims = buildDimensions(candidateLists, limitedItemIds, build);
    const weaponShieldValues = dims[0].values;
    const shardSize = Math.max(1, Math.ceil(weaponShieldValues.length / shardCount));
    const shards = [];
    for (let i = 0; i < weaponShieldValues.length; i += shardSize) {
        shards.push(weaponShieldValues.slice(i, i + shardSize));
    }
    return shards.length > 0 ? shards : [[]];
}

// Same top10 shape as the pure-JS engine's insertIntoTop10 output
// ({ equipment, summary, buildNumber }), so OptimizerPanel/ResultsPanel can
// consume either engine's result without translation.
function toCamelEntry(entry) {
    const { equipment, summary, build_number: buildNumber } = entry;
    return {
        equipment,
        summary: {
            difficulty: summary.difficulty,
            difficultyLabel: summary.difficulty_label,
            damagePerTurn: summary.damage_per_turn,
            hpLossPerTurn: summary.hp_loss_per_turn,
            hpGainPerTurn: summary.hp_gain_per_turn,
            hpLossPerKill: summary.hp_loss_per_kill,
            hpGainPerKill: summary.hp_gain_per_kill,
        },
        buildNumber,
    };
}

export async function runShardedSearch(build, targets, { itemsById, conditionsById }, candidateLists, options = {}) {
    const { limitedItemIds, maxHpLoss, onProgress, signal } = options;
    const shardCount = Math.max(1, navigator.hardwareConcurrency || 4);
    const shards = partitionWeaponShieldDim(candidateLists, limitedItemIds, build, shardCount);

    const workers = shards.map(() => new Worker(new URL('../../workers/optimizerWasmWorker.js', import.meta.url)));
    // Send each shard's exact slice of already-paired, already-pruned
    // {weapon, shield} combos as explicit id pairs, rather than trying to
    // hand Rust a restricted candidateLists.weapon/shield to re-pair itself.
    // Flattening a pair slice into separate weapon/shield arrays is lossy -
    // it can't reconstruct which shield went with which weapon - so Rust
    // re-deriving pairs from those arrays either invented pairs that were
    // never actually assigned to this shard (double-counted, since another
    // shard could invent the same pair) or produced far more pairs than the
    // shard's real share (see search::WeaponShieldPairIds's doc comment).
    // Sending the pairs directly sidesteps that entirely: every other
    // dimension (head/body/hand/feet/neck/rings) still comes from the full,
    // unsharded candidateLists, since only the weapon-shield dimension is
    // split across shards.
    const perShardWeaponShieldPairs = shards.map(weaponShieldSlice =>
        weaponShieldSlice.map(pair => ({
            weapon: pair.weapon ? pair.weapon.id : null,
            shield: pair.shield ? pair.shield.id : null,
        })));

    // Per-shard running totals, updated as each worker's 'progress' messages
    // arrive - a shard's own total is fixed from the start of its run (Rust
    // computes it upfront), only its evaluated count grows, so summing
    // across shards on every message gives an accurate aggregate without
    // waiting for all shards to finish (see optimizerWasmWorker.js). Each
    // shard's own top10-so-far is merged the same way the final result is
    // (below), giving a live, real ranking rather than a per-shard partial
    // view - a shard that hasn't reported yet simply contributes nothing
    // until its first progress message, same as its evaluated/total do.
    const shardProgress = shards.map(() => ({ evaluated: 0, total: 0, top10: [] }));
    const reportProgress = () => {
        if (!onProgress) return;
        const evaluated = shardProgress.reduce((sum, p) => sum + p.evaluated, 0);
        const total = shardProgress.reduce((sum, p) => sum + p.total, 0);
        const merged = shardProgress.flatMap(p => p.top10.map(toCamelEntry));
        merged.sort((a, b) => {
            if (a.summary.hpLossPerKill !== b.summary.hpLossPerKill) return a.summary.hpLossPerKill - b.summary.hpLossPerKill;
            return b.summary.damagePerTurn - a.summary.damagePerTurn;
        });
        onProgress({ evaluated, total, top10: merged.slice(0, 10) });
    };

    const onAbort = () => workers.forEach(w => w.terminate());
    if (signal) signal.addEventListener('abort', onAbort);

    try {
        const results = await Promise.all(workers.map((worker, i) => new Promise((resolve, reject) => {
            if (signal && signal.aborted) {
                reject(new DOMException('Optimizer search cancelled', 'AbortError'));
                return;
            }
            worker.onmessage = (event) => {
                if (event.data.type === 'done') resolve(JSON.parse(event.data.resultJson));
                else if (event.data.type === 'progress') {
                    shardProgress[i] = { evaluated: event.data.evaluated, total: event.data.total, top10: event.data.top10 || [] };
                    reportProgress();
                } else if (event.data.type === 'error') reject(new Error(event.data.message));
            };
            worker.onerror = (event) => reject(new Error(event.message || 'Optimizer WASM worker crashed'));
            worker.postMessage({ configJson: JSON.stringify({
                build,
                targets: targets.map(t => ({ monster: t.monster, horde: t.horde || null })),
                itemsById, conditionsById,
                candidateLists,
                limitedItemIds: limitedItemIds ? [...limitedItemIds] : [],
                maxHpLoss: maxHpLoss === undefined ? null : maxHpLoss,
                weaponShieldPairs: perShardWeaponShieldPairs[i],
            }) });
        })));

        const merged = results.flatMap(r => r.best_first.map(toCamelEntry));
        merged.sort((a, b) => {
            if (a.summary.hpLossPerKill !== b.summary.hpLossPerKill) return a.summary.hpLossPerKill - b.summary.hpLossPerKill;
            return b.summary.damagePerTurn - a.summary.damagePerTurn;
        });
        const total = results.reduce((sum, r) => sum + r.total, 0);
        const evaluated = results.reduce((sum, r) => sum + r.evaluated, 0);
        if (onProgress) onProgress({ evaluated, total, top10: merged.slice(0, 10) });
        return { bestFirst: merged.slice(0, 10), evaluated, total };
    } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        workers.forEach(w => w.terminate());
    }
}
