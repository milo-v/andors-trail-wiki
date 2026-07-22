import { computeOffenseVector, computeDefenseVector } from './valueScoring';
import { getItemsForSlot } from '../../components/calculator/buildHelpers';
import { getItemLevel } from './itemLevels';
import { EQUIP_SLOTS, isTwohandWeapon } from './statEngine';
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

export const DEFAULT_CANDIDATES_PER_SLOT = 6;

// Best-first ordering for a slot's pool: combinedScore is the primary signal,
// item level (a power-tier signal the flat-stat vectors don't capture, e.g.
// two items scoring equally but one being a much higher-level drop) breaks
// ties. This is also the traversal order cartesian() walks a slot's list in,
// so it doubles as "evaluate the most promising combos first" - useful when
// candidatesPerSlot is unlimited and the search may be cancelled before it
// finishes.
function compareCandidates(a, b) {
    const scoreDiff = combinedScore(b) - combinedScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return (getItemLevel(b.id) ?? -1) - (getItemLevel(a.id) ?? -1);
}

export function selectCandidates(slot, items, options = {}) {
    const { maxItemLevel, categoryIds, excludedItemIds, candidatesPerSlot = DEFAULT_CANDIDATES_PER_SLOT } = options;
    let pool = getItemsForSlot(slot, items);
    if (maxItemLevel !== undefined && maxItemLevel !== null) {
        pool = pool.filter(item => {
            const level = getItemLevel(item.id);
            return level === null || level <= maxItemLevel;
        });
    }
    if (categoryIds && categoryIds.size > 0) {
        pool = pool.filter(item => categoryIds.has(item.category));
    }
    if (excludedItemIds && excludedItemIds.size > 0) {
        pool = pool.filter(item => !excludedItemIds.has(item.id));
    }
    const sorted = [...pool].sort(compareCandidates);
    // candidatesPerSlot: null/Infinity means unlimited (no cap); the default
    // above (6) applies whenever the caller doesn't specify one at all.
    return candidatesPerSlot == null || candidatesPerSlot === Infinity
        ? sorted
        : sorted.slice(0, candidatesPerSlot);
}

export function buildCandidateLists(items, locks, filtersBySlot = {}, candidatesPerSlot) {
    const itemsById = items.reduce((obj, item) => Object.assign(obj, { [item.id]: item }), {});
    const result = {};
    for (const slot of EQUIP_SLOTS) {
        const lockedId = locks[slot];
        if (lockedId) {
            const lockedItem = itemsById[lockedId];
            result[slot] = lockedItem ? [lockedItem] : [];
        } else {
            result[slot] = selectCandidates(slot, items, { ...(filtersBySlot[slot] || {}), candidatesPerSlot });
        }
    }
    // A two-handed weapon forces the shield slot empty for stat purposes
    // (statEngine.js's resolvePlayerStats), so searching shield candidates
    // alongside an all-two-handed weapon pool only produces duplicate,
    // functionally-identical builds - skip that wasted search space.
    if (result.weapon.length > 0 && result.weapon.every(isTwohandWeapon)) {
        result.shield = [];
    }
    return result;
}

// Primary: lower hpLossPerKill wins (survivability first). Secondary:
// higher damagePerTurn breaks ties. hpLossPerKill can be Infinity (can't
// kill the monster at all, per combatMath.js) - compare for equality before
// subtracting so two Infinity entries don't produce a NaN comparator result
// and fall through to the damagePerTurn tiebreak instead.
export function insertIntoTop10(top10, entry) {
    const next = [...top10, entry].sort((a, b) => {
        const { hpLossPerKill: hpA, damagePerTurn: dptA } = a.summary;
        const { hpLossPerKill: hpB, damagePerTurn: dptB } = b.summary;
        if (hpA !== hpB) return hpA - hpB;
        return dptB - dptA;
    });
    return next.slice(0, 10);
}

// Items the user has flagged as single-copy ("limit 1") must not occupy more
// than one slot in the same build. Most items only fit one canonical slot
// anyway, so this only ever matters for the leftring/rightring and
// weapon/shield pairs, which can both draw the same item out of a shared
// candidate pool (wearing one ring on both hands, or dual-wielding a
// one-handed weapon against itself) even though only one copy exists.
function hasDisallowedDuplicate(combo, limitedItemIds) {
    if (!limitedItemIds || limitedItemIds.size === 0) return false;
    const seen = new Set();
    for (const slot of EQUIP_SLOTS) {
        const item = combo[slot];
        if (!item || !limitedItemIds.has(item.id)) continue;
        if (seen.has(item.id)) return true;
        seen.add(item.id);
    }
    return false;
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
    const { maxHpLossPerKill, limitedItemIds, onProgress, shouldCancel, yieldEveryN = 5000 } = options;
    const total = countCombinations(candidateLists);
    let top10 = [];
    let evaluated = 0;

    // Shield choice only affects scoring when the weapon isn't two-handed. If the
    // (possibly mixed) weapon candidate pool includes a two-handed weapon, cartesian()
    // still independently pairs it with every shield candidate - resolvePlayerStats
    // nulls the shield for all of them alike, so only the first is worth evaluating;
    // the rest are skipped rather than filling the leaderboard with cosmetic
    // duplicates. Locked shields (candidateLists.shield.length <= 1) have nothing to
    // dedupe against, so they're left alone.
    const shieldCandidates = candidateLists.shield || [];

    // Advances the evaluated counter and periodically yields/reports progress.
    // Returns true if the caller should stop (search was cancelled).
    const tick = async () => {
        evaluated++;
        if (evaluated % yieldEveryN === 0) {
            if (onProgress) onProgress({ evaluated, total, top10 });
            if (shouldCancel && shouldCancel()) return true;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return false;
    };

    for (const combo of cartesian(candidateLists)) {
        const twoHanded = combo.weapon && isTwohandWeapon(combo.weapon);
        if (twoHanded && combo.shield && shieldCandidates.length > 1 && combo.shield !== shieldCandidates[0]) {
            if (await tick()) return top10;
            continue;
        }
        if (hasDisallowedDuplicate(combo, limitedItemIds)) {
            if (await tick()) return top10;
            continue;
        }

        const equipment = {};
        for (const slot of EQUIP_SLOTS) equipment[slot] = combo[slot] ? combo[slot].id : null;
        if (twoHanded) equipment.shield = null;
        const candidateBuild = { ...build, equipment };
        const summary = computeCombatSummary(candidateBuild, monster, { itemsById, conditionsById });

        if (maxHpLossPerKill === undefined || maxHpLossPerKill === null || summary.hpLossPerKill <= maxHpLossPerKill) {
            top10 = insertIntoTop10(top10, { equipment, summary });
        }

        if (await tick()) return top10;
    }

    if (onProgress) onProgress({ evaluated, total, top10 });
    return top10;
}
