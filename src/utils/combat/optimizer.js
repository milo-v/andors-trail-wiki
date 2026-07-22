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
function isDisallowedPair(a, b, limitedItemIds) {
    if (!a || !b || !limitedItemIds || limitedItemIds.size === 0) return false;
    return a.id === b.id && limitedItemIds.has(a.id);
}

// Builds every valid (weapon, shield) pairing up front, rather than letting
// cartesian() generate all pairings and reject the invalid ones after the
// fact. That distinction matters: weapon/shield sit at the *front* of
// EQUIP_SLOTS, and a Cartesian odometer varies its last dimension fastest -
// so with candidatesPerSlot unlimited and a single-copy item that scores
// well for both slots (e.g. a strong one-handed sword), every combo for the
// *entire* rest of the search (every combination of every other slot) could
// keep landing on that one invalid pairing before the odometer ever carries
// into a different weapon/shield choice, stalling the leaderboard for a very
// long time even though evaluated/total keeps ticking up. Building only the
// valid pairs makes that structurally impossible instead of merely unlikely.
// Also folds in the pre-existing two-handed-weapon/shield dedup (a
// two-handed weapon always nulls the shield for stat purposes, per
// statEngine.js's resolveEquipped - every shield candidate scores
// identically, so only the first is worth keeping as a combo).
function buildWeaponShieldPairs(weaponCandidates, shieldCandidates, limitedItemIds) {
    const weapons = weaponCandidates.length > 0 ? weaponCandidates : [null];
    const shields = shieldCandidates.length > 0 ? shieldCandidates : [null];
    const pairs = [];
    for (const weapon of weapons) {
        const twoHanded = !!weapon && isTwohandWeapon(weapon);
        for (const shield of shields) {
            if (twoHanded && shield && shieldCandidates.length > 1 && shield !== shieldCandidates[0]) continue;
            if (isDisallowedPair(weapon, shield, limitedItemIds)) continue;
            pairs.push({ weapon, shield: twoHanded ? null : shield });
        }
    }
    return pairs;
}

function sameCandidateSet(a, b) {
    if (a.length !== b.length) return false;
    const idsA = new Set(a.map(item => item.id));
    return b.every(item => idsA.has(item.id));
}

// Same idea as buildWeaponShieldPairs, for the ring slots - plus one more
// optimization specific to rings: statEngine.js's applyEquipment applies
// leftring/rightring identically (a plain loop over both slots, no
// left/right-specific logic anywhere), unlike weapon/shield where main-hand
// vs off-hand genuinely differ (dual-wield efficiency scaling, proficiency
// keyed to equipped.weapon only). So when both ring slots draw from the
// exact same candidate pool, {A,B} and {B,A} are stat-identical and only
// need evaluating once - halving that dimension's search space. Skipped
// when the pools genuinely differ (per-slot category filters, or a lock on
// just one side), since swapping isn't necessarily redundant then.
function buildRingPairs(leftCandidates, rightCandidates, limitedItemIds) {
    if (leftCandidates.length > 0 && sameCandidateSet(leftCandidates, rightCandidates)) {
        const pairs = [];
        for (let i = 0; i < leftCandidates.length; i++) {
            for (let j = i; j < leftCandidates.length; j++) {
                const left = leftCandidates[i];
                const right = leftCandidates[j];
                if (isDisallowedPair(left, right, limitedItemIds)) continue;
                pairs.push({ leftring: left, rightring: right });
            }
        }
        return pairs;
    }

    const lefts = leftCandidates.length > 0 ? leftCandidates : [null];
    const rights = rightCandidates.length > 0 ? rightCandidates : [null];
    const pairs = [];
    for (const leftring of lefts) {
        for (const rightring of rights) {
            if (isDisallowedPair(leftring, rightring, limitedItemIds)) continue;
            pairs.push({ leftring, rightring });
        }
    }
    return pairs;
}

const SINGLE_SLOTS = ['head', 'body', 'hand', 'feet', 'neck'];

// One "dimension" per independent choice the search makes: the weapon+shield
// pair, one per remaining simple slot (skipped entirely if empty, so it never
// contributes a combinatorial factor), and the ring pair. Each dimension's
// values are either a single-slot object ({ [slot]: item }) or a pre-merged
// pair object ({ weapon, shield } / { leftring, rightring }) - cartesian()
// doesn't need to know which.
function buildDimensions(candidateLists, limitedItemIds) {
    const dims = [{ values: buildWeaponShieldPairs(candidateLists.weapon || [], candidateLists.shield || [], limitedItemIds) }];
    for (const slot of SINGLE_SLOTS) {
        const list = candidateLists[slot] || [];
        if (list.length === 0) continue;
        dims.push({ values: list.map(item => ({ [slot]: item })) });
    }
    dims.push({ values: buildRingPairs(candidateLists.leftring || [], candidateLists.rightring || [], limitedItemIds) });
    return dims;
}

// dims can include an empty pair dimension (buildWeaponShieldPairs/
// buildRingPairs return []) only when every possible pairing for that slot
// pair is disallowed - a genuinely impossible configuration, not "no item
// equipped" (which is already represented as a { weapon: null, ... } entry
// within a non-empty list) - so unlike single slots, an empty pair dimension
// correctly makes the total (and the search) zero rather than one.
export function countCombinations(candidateLists, limitedItemIds) {
    return buildDimensions(candidateLists, limitedItemIds).reduce((product, d) => product * d.values.length, 1);
}

function* cartesian(candidateLists, limitedItemIds) {
    const dims = buildDimensions(candidateLists, limitedItemIds);
    const indices = dims.map(() => 0);
    if (dims.some(d => d.values.length === 0)) return;
    while (true) {
        const combo = {};
        dims.forEach((d, i) => Object.assign(combo, d.values[indices[i]]));
        yield combo;

        let pos = dims.length - 1;
        while (pos >= 0) {
            indices[pos]++;
            if (indices[pos] < dims[pos].values.length) break;
            indices[pos] = 0;
            pos--;
        }
        if (pos < 0) return;
    }
}

export async function searchBestBuilds(build, monster, { itemsById, conditionsById }, candidateLists, options = {}) {
    const { maxHpLossPerKill, limitedItemIds, onProgress, shouldCancel, yieldEveryN = 5000 } = options;
    const total = countCombinations(candidateLists, limitedItemIds);
    let top10 = [];
    let evaluated = 0;

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

    // Every combo cartesian() yields here is already a valid pairing (two-
    // handed-weapon/shield dedup and the limit-1 constraint are both baked
    // into buildDimensions), so there's nothing left to reject - every
    // iteration goes straight to scoring.
    for (const combo of cartesian(candidateLists, limitedItemIds)) {
        const equipment = {};
        for (const slot of EQUIP_SLOTS) equipment[slot] = combo[slot] ? combo[slot].id : null;
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
