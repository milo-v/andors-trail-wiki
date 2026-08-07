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
    const { limitedItemIds, maxHpLoss, onProgress } = options;
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

    try {
        const results = await Promise.all(workers.map((worker, i) => new Promise((resolve, reject) => {
            worker.onmessage = (event) => {
                if (event.data.type === 'done') resolve(JSON.parse(event.data.resultJson));
                else if (event.data.type === 'error') reject(new Error(event.data.message));
            };
            worker.onerror = (event) => reject(new Error(event.message || 'Optimizer WASM worker crashed'));
            worker.postMessage({ configJson: JSON.stringify({
                build,
                targets: targets.map(t => ({ monster: t.monster, horde: t.horde || null })),
                itemsById, conditionsById,
                candidateLists: perShardCandidateLists[i],
                limitedItemIds: limitedItemIds ? [...limitedItemIds] : [],
                maxHpLoss: maxHpLoss === undefined ? null : maxHpLoss,
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
        workers.forEach(w => w.terminate());
    }
}
