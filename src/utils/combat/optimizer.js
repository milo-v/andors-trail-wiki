import { computeOffenseVector, computeDefenseVector } from './valueScoring';
import { getItemsForSlot } from '../../components/calculator/buildHelpers';
import { getItemLevel } from './itemLevels';
import { EQUIP_SLOTS } from './statEngine';
import { computeCombatSummary } from './combatMath';

function sum(vector) {
    return vector.reduce((a, b) => a + b, 0);
}

// Proc-effect items (hitEffect/killEffect/etc.) are scored identically to
// everything else - their proc value isn't representable in the flat-stat
// vectors, consistent with Phase C's stance (valueScoring.js). A proc item
// only makes the candidate list if its flat stats are already competitive.
export function combinedScore(item) {
    return 0.6 * sum(computeOffenseVector(item)) + 0.4 * sum(computeDefenseVector(item));
}

export function selectCandidates(slot, items, options = {}) {
    const { maxItemLevel, categoryId, excludedItemIds } = options;
    let pool = getItemsForSlot(slot, items);
    if (maxItemLevel !== undefined && maxItemLevel !== null) {
        pool = pool.filter(item => {
            const level = getItemLevel(item.id);
            return level === null || level <= maxItemLevel;
        });
    }
    if (categoryId) {
        pool = pool.filter(item => item.category === categoryId);
    }
    if (excludedItemIds && excludedItemIds.size > 0) {
        pool = pool.filter(item => !excludedItemIds.has(item.id));
    }
    return [...pool].sort((a, b) => combinedScore(b) - combinedScore(a)).slice(0, 5);
}

export function buildCandidateLists(items, locks, filtersBySlot = {}) {
    const itemsById = items.reduce((obj, item) => Object.assign(obj, { [item.id]: item }), {});
    const result = {};
    for (const slot of EQUIP_SLOTS) {
        const lockedId = locks[slot];
        if (lockedId) {
            const lockedItem = itemsById[lockedId];
            result[slot] = lockedItem ? [lockedItem] : [];
        } else {
            result[slot] = selectCandidates(slot, items, filtersBySlot[slot] || {});
        }
    }
    return result;
}

export function insertIntoTop10(top10, entry) {
    const next = [...top10, entry].sort((a, b) => b.summary.damagePerTurn - a.summary.damagePerTurn);
    return next.slice(0, 10);
}

export function countCombinations(candidateLists) {
    return EQUIP_SLOTS.reduce((product, slot) => product * Math.max(1, (candidateLists[slot] || []).length), 1);
}

function* cartesian(candidateLists) {
    const slots = EQUIP_SLOTS.filter(slot => (candidateLists[slot] || []).length > 0);
    const indices = slots.map(() => 0);
    if (slots.some(slot => candidateLists[slot].length === 0)) return;
    while (true) {
        const combo = {};
        slots.forEach((slot, i) => { combo[slot] = candidateLists[slot][indices[i]]; });
        yield combo;

        let pos = slots.length - 1;
        while (pos >= 0) {
            indices[pos]++;
            if (indices[pos] < candidateLists[slots[pos]].length) break;
            indices[pos] = 0;
            pos--;
        }
        if (pos < 0) return;
    }
}

export async function searchBestBuilds(build, monster, { itemsById, conditionsById }, candidateLists, options = {}) {
    const { maxHpLossPerKill, onProgress, shouldCancel, yieldEveryN = 5000 } = options;
    const total = countCombinations(candidateLists);
    let top10 = [];
    let evaluated = 0;

    for (const combo of cartesian(candidateLists)) {
        const equipment = {};
        for (const slot of EQUIP_SLOTS) equipment[slot] = combo[slot] ? combo[slot].id : null;
        const candidateBuild = { ...build, equipment };
        const summary = computeCombatSummary(candidateBuild, monster, { itemsById, conditionsById });

        if (maxHpLossPerKill === undefined || maxHpLossPerKill === null || summary.hpLossPerKill <= maxHpLossPerKill) {
            top10 = insertIntoTop10(top10, { equipment, summary });
        }

        evaluated++;
        if (evaluated % yieldEveryN === 0) {
            if (onProgress) onProgress({ evaluated, total, top10 });
            if (shouldCancel && shouldCancel()) return top10;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    if (onProgress) onProgress({ evaluated, total, top10 });
    return top10;
}
