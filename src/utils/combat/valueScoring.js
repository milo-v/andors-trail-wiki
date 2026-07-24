// Phase C: pure internal pruning heuristic for Phase D's brute-force
// equipment search (skill allocation is fixed/user-chosen, not searched, so
// only items are scored here). Scores items on raw stat-delta Pareto vectors
// - deliberately NOT run through Phase A's real combat formulas, since
// CombatController.getAttackHitChance's arctan saturation
// (50 * (1 + (2/pi) * atan((attackChance - blockChance - n) / F))) makes a
// marginal-delta-at-one-baseline score unreliable near the curve's edges.
// See docs/superpowers/specs/2026-07-21-damage-calculator-phase-c-design.md.

import { getProficiencySkillForCategory } from './skillData';
import { averageRange } from './procEffects';
import { isWeapon, getDualWieldEfficiencyPercent, computeProficiencyBonus } from './statEngine';

// Vector dimension order: [attackDamageMin, attackDamageMax, attackChance,
// criticalSkill, criticalMultiplier, -attackCost, reflectDamageToAttacker].
// The last dimension is hitReceivedEffect.increaseAttackerCurrentHP (a
// thorns/reflect effect - negative values are damage dealt to whoever hit
// you, e.g. Shield of the Undead), which is unconditional like the other
// direct hitEffect/killEffect stat boosts, so it needs no proxy-occupancy
// scaling.
export function computeOffenseVector(item) {
    const e = item?.equipEffect;
    const dmg = e?.increaseAttackDamage || { min: 0, max: 0 };
    return [
        dmg.min || 0,
        dmg.max || 0,
        e?.increaseAttackChance || 0,
        e?.increaseCriticalSkill || 0,
        e?.setCriticalMultiplier || 0,
        -(e?.increaseAttackCost || 0),
        -averageRange(item?.hitReceivedEffect?.increaseAttackerCurrentHP),
    ];
}

// Phase-C-only calibration, not a real game constant: CombatController's
// damage roll subtracts damageResistance from *every landed hit*
// (combatMath.js's getAverageDamagePerHit: Math.max(0, ... - target.
// damageResistance)), unlike blockChance (a percentage chance to negate one
// whole hit) or maxHP (a one-time buffer) - its value compounds with however
// many hits actually land per turn, so weighting it 1:1 against those other
// dimensions understates it. This multiplier is applied everywhere
// damageResistance feeds a defense vector (an item's own stats, conditions,
// and proficiency bonuses alike) so all three stay consistently weighted
// relative to each other.
const DAMAGE_RESISTANCE_SCORE_WEIGHT = 3;

// Vector dimension order: [blockChance, damageResistance, maxHP, maxAP,
// hitEffect HP recovery, killEffect HP recovery, hitReceivedEffect HP
// recovery]. The proc-based dimensions fold in items like Necklace of the
// Undead, whose real value is almost entirely in per-hit/per-kill HP
// recovery (CombatController.applyAttackHitStatusEffects/
// ActorStatsController.applyKillEffectsToPlayer) rather than its modest flat
// equipEffect - without this, such items score too low on raw stats alone to
// ever surface as optimizer candidates.
export function computeDefenseVector(item) {
    const e = item?.equipEffect;
    return [
        e?.increaseBlockChance || 0,
        (e?.increaseDamageResistance || 0) * DAMAGE_RESISTANCE_SCORE_WEIGHT,
        e?.increaseMaxHP || 0,
        e?.increaseMaxAP || 0,
        averageRange(item?.hitEffect?.increaseCurrentHP),
        averageRange(item?.killEffect?.increaseCurrentHP),
        averageRange(item?.hitReceivedEffect?.increaseCurrentHP),
    ];
}

// Only relevant when scoring a weapon as a candidate for the *shield* slot
// (a light/std weapon considered for off-hand dual-wielding) - a weapon
// scored for the main weapon slot is never discounted, matching
// applyEquipment's mainHand handling. Returns null (no discount) otherwise,
// including the case where the same weapon ends up wielded alone (main hand
// empty) rather than genuinely dual-wielded - Phase C scores items in
// isolation and can't know which of those two outcomes a given candidate
// will land in, so this assumes the common case (paired with an actual main
// hand) rather than the edge case of an off-hand-only build.
export function getOffHandEfficiencyPercent(item, slot, skillLevels) {
    if (slot !== 'shield' || !isWeapon(item)) return null;
    return getDualWieldEfficiencyPercent(skillLevels);
}

// Discounts only the leading "flat equip stat" dimensions of a vector by an
// off-hand efficiency percent - attack cost (offense vector index 5) and any
// proc-based dimensions (hitReceivedEffect reflect/HP, hitEffect/killEffect
// HP) are never part of applyDualWield's generic percent scaling, so
// scaledDimCount stops short of them (5 for offense, 4 for defense).
export function scaleOffHandStats(vector, percent, scaledDimCount) {
    if (percent == null || percent === 100) return vector;
    return vector.map((v, i) => (i < scaledDimCount ? (v * percent) / 100 : v));
}

const OFFENSE_SCALED_DIM_COUNT = 5;
const DEFENSE_SCALED_DIM_COUNT = 4;

function abilityEffectAsOffenseVector(effect) {
    const dmg = effect?.increaseAttackDamage || { min: 0, max: 0 };
    return [dmg.min || 0, dmg.max || 0, effect?.increaseAttackChance || 0, effect?.increaseCriticalSkill || 0, effect?.setCriticalMultiplier || 0, -(effect?.increaseAttackCost || 0), 0];
}
function abilityEffectAsDefenseVector(effect) {
    return [effect?.increaseBlockChance || 0, (effect?.increaseDamageResistance || 0) * DAMAGE_RESISTANCE_SCORE_WEIGHT, effect?.increaseMaxHP || 0, effect?.increaseMaxAP || 0, 0, 0, 0];
}

// Weapon/shield/armor proficiency and the two-handed fighting style, folded
// into offense/defense vector deltas via statEngine.js's
// computeProficiencyBonus - see that function's header comment for exactly
// which fighting styles are (and aren't) modeled here and why. skillLevels
// omitted (e.g. call sites that don't have it handy) simply skips this term,
// matching the pre-existing no-proficiency-bonus scoring.
export function computeProficiencyVectors(item, slot, skillLevels) {
    if (!skillLevels) return { offense: [0, 0, 0, 0, 0, 0, 0], defense: [0, 0, 0, 0, 0, 0, 0] };
    const bonus = computeProficiencyBonus(item, slot, skillLevels);
    return { offense: abilityEffectAsOffenseVector(bonus), defense: abilityEffectAsDefenseVector(bonus) };
}

function addVectors(a, b) {
    return a.map((v, i) => v + b[i]);
}

// Full context-adjusted offense/defense vectors combining every scoring
// signal this file computes - base equip stats (off-hand-efficiency
// scaled), chance-based condition procs, permanent equip-granted
// conditions, and weapon/shield/armor proficiency + two-handed fighting
// style. The single source of truth for both optimizer.js's combinedScore
// (summed to a scalar for ranking) and pruneCandidates' Pareto-frontier
// dominance checks below, so a pruning decision is always consistent with
// how items actually get ranked.
export function computeScoringVectors(item, conditionsById, sharedConditionSlotCounts, slot, skillLevels) {
    const procVectors = computeProcConditionVectors(item, conditionsById);
    const equipConditionVectors = computeEquipConditionVectors(item, conditionsById, sharedConditionSlotCounts);
    const proficiencyVectors = computeProficiencyVectors(item, slot, skillLevels);
    const offHandPercent = getOffHandEfficiencyPercent(item, slot, skillLevels);
    const offenseVec = scaleOffHandStats(computeOffenseVector(item), offHandPercent, OFFENSE_SCALED_DIM_COUNT);
    const defenseVec = scaleOffHandStats(computeDefenseVector(item), offHandPercent, DEFENSE_SCALED_DIM_COUNT);
    return {
        offense: addVectors(addVectors(offenseVec, procVectors.offense), addVectors(equipConditionVectors.offense, proficiencyVectors.offense)),
        defense: addVectors(addVectors(defenseVec, procVectors.defense), addVectors(equipConditionVectors.defense, proficiencyVectors.defense)),
    };
}
function scaleVector(v, s) {
    return v.map((x) => x * s);
}

// Context-free proxy for "how often is this proc in effect" at scoring time:
// no specific opponent/build is chosen yet, so the real hit-chance/attacks-
// per-turn-scaled occupancy formula (procEffects.js) can't be evaluated here
// - this file already avoids real combat formulas at scoring time for the
// same reason (see the top-of-file comment on the arctan hit-chance curve).
// min(1, chance% * duration) is the first-order approximation of the exact
// occupancy formula for small chance values, which covers most real procs.
function getProxyOccupancy(entry) {
    return Math.min(1, (Number(entry.chance) / 100) * (entry.duration || 0));
}

// Scores a conditionsSource/conditionsTarget-style proc list against
// whichever side it applies to. `entries` applied to the item's own wearer
// (conditionsSource) score directly; entries applied to the opponent
// (conditionsTarget) are inverted and cross-mapped - debuffing the enemy's
// own offense stats (their attackChance/crit/etc.) is a benefit to *my*
// defense, and debuffing their defense stats (blockChance/resistance/etc.)
// benefits *my* offense, mirroring how those stats actually interact in combat.
function scoreProcConditions(entries, conditionsById, isEnemyEffect) {
    let offense = [0, 0, 0, 0, 0, 0, 0];
    let defense = [0, 0, 0, 0, 0, 0, 0];
    for (const entry of entries || []) {
        const condition = conditionsById?.[entry.condition];
        if (!condition?.abilityEffect || !entry.magnitude || entry.magnitude <= 0) continue;
        const weight = getProxyOccupancy(entry) * entry.magnitude;
        const off = scaleVector(abilityEffectAsOffenseVector(condition.abilityEffect), weight);
        const def = scaleVector(abilityEffectAsDefenseVector(condition.abilityEffect), weight);
        if (isEnemyEffect) {
            offense = addVectors(offense, def.map((x) => -x));
            defense = addVectors(defense, off.map((x) => -x));
        } else {
            offense = addVectors(offense, off);
            defense = addVectors(defense, def);
        }
    }
    return { offense, defense };
}

function vectorSum(v) {
    return v.reduce((a, b) => a + b, 0);
}

// Same 0.6/0.4 offense/defense weighting optimizer.js's combinedScore uses,
// applied to a single condition's own abilityEffect (per unit magnitude) to
// classify it as a net buff or net debuff for the amortization below.
export function isNetNegativeCondition(condition) {
    if (!condition?.abilityEffect) return false;
    const net = 0.6 * vectorSum(abilityEffectAsOffenseVector(condition.abilityEffect)) + 0.4 * vectorSum(abilityEffectAsDefenseVector(condition.abilityEffect));
    return net < 0;
}

// Permanent, always-on conditions an item inflicts on its own wearer while
// equipped (equipEffect.addedConditions - ActorStatsController.java's
// addConditionsFromEquippedItem, e.g. Feline Gloves' self-inflicted
// Clumsiness). Unlike the chance-based procs above, these are active 100% of
// the time the item is worn, so no occupancy/proxy math applies - the
// magnitude itself is the full weight, mirroring statEngine.js's
// applyActiveConditions (magnitude <= 0 means "grants immunity", not an
// inverted effect).
//
// A net-negative condition's penalty gets amortized across
// sharedConditionSlotCounts[conditionId] (optimizer.js's
// computeSharedNegativeConditionSlotCounts) - the number of distinct equip
// slots that have *some* item inflicting this same non-stacking debuff.
// ActorStatsController's non-stacking merge means wearing two such items
// never actually doubles the cost (only the strongest instance applies), so
// scoring each one at full penalty is too pessimistic whenever a different
// slot could just as easily bring the same debuff on its own. Net-positive
// conditions get no such discount - full credit every time, since
// over-crediting a shared buff isn't the problem being corrected for.
export function computeEquipConditionVectors(item, conditionsById, sharedConditionSlotCounts) {
    let offense = [0, 0, 0, 0, 0, 0, 0];
    let defense = [0, 0, 0, 0, 0, 0, 0];
    if (!conditionsById) return { offense, defense };
    for (const entry of item?.equipEffect?.addedConditions || []) {
        const condition = conditionsById[entry.condition];
        if (!condition?.abilityEffect || !entry.magnitude || entry.magnitude <= 0) continue;
        const offVec = abilityEffectAsOffenseVector(condition.abilityEffect);
        const defVec = abilityEffectAsDefenseVector(condition.abilityEffect);
        let weight = entry.magnitude;
        if (isNetNegativeCondition(condition)) {
            const slotCount = sharedConditionSlotCounts?.[entry.condition] || 1;
            weight = entry.magnitude / slotCount;
        }
        offense = addVectors(offense, scaleVector(offVec, weight));
        defense = addVectors(defense, scaleVector(defVec, weight));
    }
    return { offense, defense };
}

// Folds an item's chance-based condition procs (hitEffect/killEffect/
// hitReceivedEffect conditionsSource/conditionsTarget) into offense/defense
// vector deltas. conditionsById is required to look up each proc's
// abilityEffect; omit it (e.g. call sites that don't have it handy) and
// these contributions are simply skipped, matching the pre-existing
// direct-stat-only scoring.
export function computeProcConditionVectors(item, conditionsById) {
    if (!conditionsById) return { offense: [0, 0, 0, 0, 0, 0, 0], defense: [0, 0, 0, 0, 0, 0, 0] };
    const parts = [
        scoreProcConditions(item?.hitEffect?.conditionsSource, conditionsById, false),
        scoreProcConditions(item?.hitEffect?.conditionsTarget, conditionsById, true),
        scoreProcConditions(item?.killEffect?.conditionsSource, conditionsById, false),
        scoreProcConditions(item?.hitReceivedEffect?.conditionsSource, conditionsById, false),
        scoreProcConditions(item?.hitReceivedEffect?.conditionsTarget, conditionsById, true),
    ];
    return {
        offense: parts.reduce((acc, p) => addVectors(acc, p.offense), [0, 0, 0, 0, 0, 0, 0]),
        defense: parts.reduce((acc, p) => addVectors(acc, p.defense), [0, 0, 0, 0, 0, 0, 0]),
    };
}

// Key-order- and array-order-independent JSON serialization, so two items
// whose special effects are structurally identical (just authored/parsed
// with entries or object keys in a different order) still produce the same
// signature below rather than spuriously comparing as "different".
function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).sort().join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

const EFFECT_FIELDS = ['hitEffect', 'killEffect', 'hitReceivedEffect', 'useEffect', 'missEffect', 'missReceivedEffect'];

// Canonical representation of every special-effect field an item can carry
// (proc effects plus equipEffect.addedConditions), for grouping "exact same
// effects" items together in pruneCandidates. Two items with identical
// special effects always contribute identical value to a build - whether or
// not that value happens to be captured by the vectors above (e.g. a direct
// hitEffect.increaseCurrentAP boost isn't currently vector-tracked at all) -
// so comparing them on stats alone is always safe when their signatures
// match exactly. Items with differing signatures (even a single differing
// field) never land in the same pruning group and so never cross-compare,
// preserving the old blanket-exemption's safety net for anything the
// vectors don't (yet) capture.
export function getEffectSignature(item) {
    const parts = {};
    for (const field of EFFECT_FIELDS) {
        if (item?.[field]) parts[field] = item[field];
    }
    if (item?.equipEffect?.addedConditions?.length) parts.addedConditions = item.equipEffect.addedConditions;
    return stableStringify(parts);
}

function dominates(a, b) {
    let strictlyGreater = false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) return false;
        if (a[i] > b[i]) strictlyGreater = true;
    }
    return strictlyGreater;
}

// Returns the subset of `candidates` not dominated by any other candidate,
// per `vectorFn`'s vector for each. O(n^2) - fine for per-slot item lists
// (tens to low hundreds of items), not meant for the full item catalog at once.
export function paretoFrontier(candidates, vectorFn) {
    const vectors = candidates.map(vectorFn);
    return candidates.filter((_, i) => !vectors.some((v, j) => j !== i && dominates(v, vectors[i])));
}

// Groups items by (proficiency-skill track, exact special-effect signature)
// - items only ever compete against others in the exact same group. The
// proficiency-track split (null key = no track, e.g. rings/necklaces/cloth
// armor) keeps e.g. an off-hand dagger candidate from being compared against
// an unrelated armor proficiency track's items. Within a track, items are
// further split by getEffectSignature: items with a unique signature end up
// alone in their own group (nothing to dominate them - the old exemption's
// effect, achieved here as a natural consequence of grouping rather than a
// special case), while items sharing the *exact same* signature (e.g. a
// higher-tier reskin of the same proc'd item) do get compared.
function groupForPruning(items) {
    const groups = new Map();
    for (const item of items) {
        const key = `${getProficiencySkillForCategory(item.categoryLink)}::${getEffectSignature(item)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return [...groups.values()];
}

// Phase D's entry point: prune a slot's item candidates (already filtered by
// the caller's level/category/exclusion rules - see optimizer.js's
// selectCandidates, which deliberately runs this *after* those filters so an
// item the player excluded, e.g. a "best in slot" that's unreachable or too
// hard to obtain, can never suppress a reachable, otherwise-dominated
// alternative from surviving) down to each group's Pareto frontier, using
// the same full context-adjusted vectors combinedScore ranks by so a
// pruning decision is always consistent with the score. Offense and defense
// are concatenated into one 14-dimension vector per item rather than
// computing two separate frontiers and unioning them - a separate-frontier
// union is broken for any item tied at zero on one axis (e.g. a pure-armor
// piece has an all-zero offense vector): ties never dominate, so every such
// item would trivially "survive" that axis's frontier no matter how
// dominated it is on the other axis, defeating pruning for most non-hybrid
// items. A single combined vector still correctly keeps genuine tradeoffs
// (better offense, worse defense, or vice versa) since neither side
// dominates the other once at least one dimension favors each.
export function pruneCandidates(items, conditionsById, sharedConditionSlotCounts, slot, skillLevels) {
    const survivors = [];
    for (const group of groupForPruning(items)) {
        if (group.length <= 1) {
            survivors.push(...group);
            continue;
        }
        const vectorFn = (item) => {
            const { offense, defense } = computeScoringVectors(item, conditionsById, sharedConditionSlotCounts, slot, skillLevels);
            return [...offense, ...defense];
        };
        survivors.push(...paretoFrontier(group, vectorFn));
    }
    return survivors;
}
