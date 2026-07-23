import { computeScoringVectors, isNetNegativeCondition, pruneCandidates } from './valueScoring';
import { getItemsForSlot } from '../../components/calculator/buildHelpers';
import { getItemLevel } from './itemLevels';
import { EQUIP_SLOTS, isTwohandWeapon, computeWeaponPairAttackCost, buildBaseStats, applyGeneralCombatSkills } from './statEngine';
import { computeCombatSummary } from './combatMath';

function sum(vector) {
    return vector.reduce((a, b) => a + b, 0);
}

// Scalar ranking signal for a slot's pool: sums valueScoring.js's
// computeScoringVectors (base equip stats with off-hand-efficiency scaling,
// chance-based condition procs, permanent equip-granted conditions, and
// weapon/shield/armor proficiency + two-handed fighting style - see that
// function's own header comment for what each term covers) into the same
// 0.6 offense / 0.4 defense weighted score pruneCandidates' Pareto dominance
// checks are built from, so ranking and pruning are always consistent.
export function combinedScore(item, conditionsById, sharedConditionSlotCounts, slot, skillLevels) {
    const { offense, defense } = computeScoringVectors(item, conditionsById, sharedConditionSlotCounts, slot, skillLevels);
    return 0.6 * sum(offense) + 0.4 * sum(defense);
}

// Counts, per conditionId, how many distinct equip slots (categoryLink.
// inventorySlot) have at least one item that inflicts that condition as a
// net-negative equipEffect.addedConditions entry. Computed once from the
// full item pool (not just one slot's candidates) since the whole point is
// to notice cross-slot redundancy before per-slot pruning ever happens.
function computeSharedNegativeConditionSlotCounts(items, conditionsById) {
    if (!conditionsById) return {};
    const slotsByCondition = new Map();
    for (const item of items) {
        const slot = item.categoryLink?.inventorySlot;
        if (!slot) continue;
        for (const entry of item.equipEffect?.addedConditions || []) {
            if (!entry.magnitude || entry.magnitude <= 0) continue;
            if (!isNetNegativeCondition(conditionsById[entry.condition])) continue;
            if (!slotsByCondition.has(entry.condition)) slotsByCondition.set(entry.condition, new Set());
            slotsByCondition.get(entry.condition).add(slot);
        }
    }
    const counts = {};
    for (const [conditionId, slots] of slotsByCondition) counts[conditionId] = slots.size;
    return counts;
}

export const DEFAULT_CANDIDATES_PER_SLOT = 6;

// Best-first ordering for a slot's pool: combinedScore is the primary signal,
// item level (a power-tier signal the flat-stat vectors don't capture, e.g.
// two items scoring equally but one being a much higher-level drop) breaks
// ties. This is also the per-dimension order bestFirstCombos() ranks each
// slot's index by (0 = best), so it doubles as "evaluate the most promising
// combos first" across every dimension - not just this one slot in isolation.
function compareCandidates(a, b, conditionsById, sharedConditionSlotCounts, slot, skillLevels) {
    const scoreDiff = combinedScore(b, conditionsById, sharedConditionSlotCounts, slot, skillLevels) - combinedScore(a, conditionsById, sharedConditionSlotCounts, slot, skillLevels);
    if (scoreDiff !== 0) return scoreDiff;
    return (getItemLevel(b.id) ?? -1) - (getItemLevel(a.id) ?? -1);
}

export function selectCandidates(slot, items, options = {}) {
    const { maxItemLevel, categoryIds, excludedItemIds, candidatesPerSlot = DEFAULT_CANDIDATES_PER_SLOT, conditionsById, sharedConditionSlotCounts, skillLevels } = options;
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
    // Pareto-pruning runs after the filters above on purpose: an item the
    // player excluded (locked out, unreachable, too hard to obtain) is
    // already gone from `pool` by this point, so it can never dominate - and
    // thereby suppress - an otherwise-inferior alternative that's actually
    // available. Pruning before these filters would risk losing that
    // alternative to a "best in slot" the player can't even use.
    pool = pruneCandidates(pool, conditionsById, sharedConditionSlotCounts, slot, skillLevels);
    const sorted = [...pool].sort((a, b) => compareCandidates(a, b, conditionsById, sharedConditionSlotCounts, slot, skillLevels));
    // candidatesPerSlot: null/Infinity means unlimited (no cap); the default
    // above (6) applies whenever the caller doesn't specify one at all.
    return candidatesPerSlot == null || candidatesPerSlot === Infinity
        ? sorted
        : sorted.slice(0, candidatesPerSlot);
}

export function buildCandidateLists(items, locks, filtersBySlot = {}, candidatesPerSlot, conditionsById, skillLevels) {
    const itemsById = items.reduce((obj, item) => Object.assign(obj, { [item.id]: item }), {});
    const sharedConditionSlotCounts = computeSharedNegativeConditionSlotCounts(items, conditionsById);
    const result = {};
    for (const slot of EQUIP_SLOTS) {
        const lockedId = locks[slot];
        if (lockedId) {
            const lockedItem = itemsById[lockedId];
            result[slot] = lockedItem ? [lockedItem] : [];
        } else {
            result[slot] = selectCandidates(slot, items, { ...(filtersBySlot[slot] || {}), candidatesPerSlot, conditionsById, sharedConditionSlotCounts, skillLevels });
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
// the traversal generate all pairings and reject the invalid ones after the
// fact. That distinction matters regardless of traversal strategy - both the
// original Cartesian-odometer walk and the current bestFirstCombos() search
// trust every value in a dimension to already be valid and never re-check,
// so an invalid pairing left in would either get wastefully evaluated or (in
// the old odometer, whose last dimension varies fastest) could dominate the
// *entire* rest of the search behind a single-copy item that scores well for
// both slots, stalling the leaderboard for a long time even though
// evaluated/total kept ticking up. Building only the valid pairs makes that
// structurally impossible instead of merely unlikely. Also folds in the
// pre-existing two-handed-weapon/shield dedup (a two-handed weapon always
// nulls the shield for stat purposes, per statEngine.js's resolveEquipped -
// every shield candidate scores identically, so only the first is worth
// keeping as a combo).
const ARMOR_LIKE_SLOTS = EQUIP_SLOTS.filter(slot => slot !== 'weapon' && slot !== 'shield');

// Upper bound on maxAP this build could ever reach, using the actual
// candidate pools already selected for the non-weapon slots (the single
// best increaseMaxAP found in each slot, since only one item per slot can
// be worn). Used below to prune weapon/shield pairings whose attack cost
// can *never* leave a single attack per turn (e.g. dual-wielding two 7-cost
// weapons with no Dual Wield skill) - those combos would just compute out
// to the getTurnsToKillTarget Infinity sentinel anyway, so skipping them
// here avoids evaluating every other slot's combinatorial product against
// a foregone conclusion.
function computeMaxAchievableAP(build, candidateLists) {
    const stats = buildBaseStats(build.level, build.levelUpChoices, build.fortitudeLevels || []);
    applyGeneralCombatSkills(stats, build.skillLevels || {});
    let maxAP = stats.maxAP;
    for (const slot of ARMOR_LIKE_SLOTS) {
        const items = candidateLists[slot] || [];
        maxAP += items.reduce((best, item) => Math.max(best, item.equipEffect?.increaseMaxAP || 0), 0);
    }
    return maxAP;
}

function buildWeaponShieldPairs(weaponCandidates, shieldCandidates, limitedItemIds, skillLevels, maxAchievableAP) {
    const weapons = weaponCandidates.length > 0 ? weaponCandidates : [null];
    const shields = shieldCandidates.length > 0 ? shieldCandidates : [null];
    const pairs = [];
    for (const weapon of weapons) {
        const twoHanded = !!weapon && isTwohandWeapon(weapon);
        for (const shield of shields) {
            if (twoHanded && shield && shieldCandidates.length > 1 && shield !== shieldCandidates[0]) continue;
            if (isDisallowedPair(weapon, shield, limitedItemIds)) continue;
            const effectiveShield = twoHanded ? null : shield;
            if (maxAchievableAP != null) {
                const cost = computeWeaponPairAttackCost(weapon, effectiveShield, skillLevels || {});
                const bonusAP = (weapon?.equipEffect?.increaseMaxAP || 0) + (effectiveShield?.equipEffect?.increaseMaxAP || 0);
                if (cost > maxAchievableAP + bonusAP) continue;
            }
            pairs.push({ weapon, shield: effectiveShield });
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
function buildDimensions(candidateLists, limitedItemIds, build) {
    const maxAchievableAP = build ? computeMaxAchievableAP(build, candidateLists) : null;
    const dims = [{ values: buildWeaponShieldPairs(candidateLists.weapon || [], candidateLists.shield || [], limitedItemIds, build?.skillLevels, maxAchievableAP) }];
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
// correctly makes the total (and the search) zero rather than one. `build`
// is optional (omit it and the weapon/shield AP-feasibility prune above is
// simply skipped, matching the pre-existing unfiltered behavior).
export function countCombinations(candidateLists, limitedItemIds, build) {
    return buildDimensions(candidateLists, limitedItemIds, build).reduce((product, d) => product * d.values.length, 1);
}

// Small binary max-heap (array-based) - JS has no built-in priority queue,
// and bestFirstCombos() below can push/pop many thousands of entries on a
// large or "unlimited" search, where a plain sorted-array insertion (O(n)
// per push) would get slow; this keeps push/pop at O(log n).
class MaxHeap {
    constructor() {
        this.items = [];
    }
    get size() {
        return this.items.length;
    }
    push(priority, value) {
        this.items.push({ priority, value });
        let i = this.items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.items[parent].priority >= this.items[i].priority) break;
            [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
            i = parent;
        }
    }
    pop() {
        const top = this.items[0];
        const last = this.items.pop();
        if (this.items.length > 0) {
            this.items[0] = last;
            let i = 0;
            for (;;) {
                const left = i * 2 + 1;
                const right = i * 2 + 2;
                let largest = i;
                if (left < this.items.length && this.items[left].priority > this.items[largest].priority) largest = left;
                if (right < this.items.length && this.items[right].priority > this.items[largest].priority) largest = right;
                if (largest === i) break;
                [this.items[i], this.items[largest]] = [this.items[largest], this.items[i]];
                i = largest;
            }
        }
        return top.value;
    }
}

// Replaces a plain nested-loop (odometer) walk over `dims`, which varies the
// *last* dimension fastest - it would exhaustively finish every combination
// of every other dimension against the single best weapon+shield pairing
// before ever trying the second-best one. Under "unlimited" candidatesPerSlot
// that first pairing alone can be enough combos to never finish, so a weapon
// that's #2 overall but pairs far better with the rest of the build would
// never get a chance to surface.
//
// Instead, this is a best-first search over the same `dims`: each
// dimension's `values` are already sorted best-to-worst (selectCandidates'
// combinedScore sort), so a tuple of indices' "rank sum" (sum of each
// dimension's own index, 0 = best) is a cheap, principled proxy for how
// promising that combo is a priori - lower is better. Starting from the
// all-best tuple, it repeatedly pops the lowest-rank-sum tuple not yet
// visited, yields it, and pushes its neighbors (each dimension bumped by one
// index in turn, skipping any already visited/enqueued). This is the
// standard way to enumerate the top entries of a cross product of
// independently-sorted lists (the same idea used for combining N-best lists
// elsewhere, e.g. machine translation reranking) - it still eventually
// visits every combo exactly once if left to run to completion (same total
// as countCombinations), but interleaves across every dimension instead of
// getting stuck varying just the fastest one.
function* bestFirstCombos(candidateLists, limitedItemIds, build) {
    const dims = buildDimensions(candidateLists, limitedItemIds, build);
    if (dims.some(d => d.values.length === 0)) return;

    const rankSum = (indices) => indices.reduce((sum, idx) => sum + idx, 0);
    const key = (indices) => indices.join(',');

    const heap = new MaxHeap();
    const visited = new Set();
    const start = dims.map(() => 0);
    heap.push(-rankSum(start), start);
    visited.add(key(start));

    while (heap.size > 0) {
        const indices = heap.pop();
        const combo = {};
        dims.forEach((d, i) => Object.assign(combo, d.values[indices[i]]));
        yield combo;

        for (let i = 0; i < dims.length; i++) {
            if (indices[i] + 1 >= dims[i].values.length) continue;
            const next = indices.slice();
            next[i]++;
            const nextKey = key(next);
            if (visited.has(nextKey)) continue;
            visited.add(nextKey);
            heap.push(-rankSum(next), next);
        }
    }
}

export async function searchBestBuilds(build, monster, { itemsById, conditionsById }, candidateLists, options = {}) {
    const { maxHpLossPerKill, limitedItemIds, onProgress, shouldCancel, yieldEveryN = 5000 } = options;
    const total = countCombinations(candidateLists, limitedItemIds, build);
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

    // Every combo bestFirstCombos() yields here is already a valid pairing
    // (two-handed-weapon/shield dedup and the limit-1 constraint are both
    // baked into buildDimensions), so there's nothing left to reject - every
    // iteration goes straight to scoring.
    for (const combo of bestFirstCombos(candidateLists, limitedItemIds, build)) {
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
