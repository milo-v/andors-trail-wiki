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
        e?.increaseDamageResistance || 0,
        e?.increaseMaxHP || 0,
        e?.increaseMaxAP || 0,
        averageRange(item?.hitEffect?.increaseCurrentHP),
        averageRange(item?.killEffect?.increaseCurrentHP),
        averageRange(item?.hitReceivedEffect?.increaseCurrentHP),
    ];
}

function abilityEffectAsOffenseVector(effect) {
    const dmg = effect?.increaseAttackDamage || { min: 0, max: 0 };
    return [dmg.min || 0, dmg.max || 0, effect?.increaseAttackChance || 0, effect?.increaseCriticalSkill || 0, effect?.setCriticalMultiplier || 0, -(effect?.increaseAttackCost || 0), 0];
}
function abilityEffectAsDefenseVector(effect) {
    return [effect?.increaseBlockChance || 0, effect?.increaseDamageResistance || 0, effect?.increaseMaxHP || 0, effect?.increaseMaxAP || 0, 0, 0, 0];
}
function addVectors(a, b) {
    return a.map((v, i) => v + b[i]);
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

// Items with proc-based effects, or an on-equip condition (e.g. Ortholion's
// talisman's fear immunity, a ring's self-inflicted debuff tradeoff), have
// real value these flat-stat vectors can't represent (proc chance/condition
// effect isn't a vector dimension) - always keep them as candidates rather
// than let them get pruned on raw stats alone.
export function isExemptItem(item) {
    return !!(
        item?.hitEffect ||
        item?.killEffect ||
        item?.useEffect ||
        item?.missEffect ||
        item?.hitReceivedEffect ||
        item?.missReceivedEffect ||
        item?.equipEffect?.addedConditions?.length
    );
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

// Groups items by the proficiency skill they invest in (null key = no
// proficiency track, e.g. rings/necklaces/cloth armor) - items in different
// groups are never compared against each other.
function groupByProficiency(items) {
    const groups = new Map();
    for (const item of items) {
        const key = getProficiencySkillForCategory(item.categoryLink);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return [...groups.values()];
}

// Phase D's entry point: prune a slot's item candidates down to, per
// proficiency-skill group, the offense-frontier union defense-frontier union
// proc-exempt items.
export function pruneCandidates(items) {
    const exempt = items.filter(isExemptItem);
    const scoreable = items.filter((item) => !isExemptItem(item));
    const survivors = [];
    for (const group of groupByProficiency(scoreable)) {
        const offenseSurvivors = paretoFrontier(group, computeOffenseVector);
        const defenseSurvivors = paretoFrontier(group, computeDefenseVector);
        const survivorIds = new Set([...offenseSurvivors, ...defenseSurvivors].map((item) => item.id));
        survivors.push(...group.filter((item) => survivorIds.has(item.id)));
    }
    return [...exempt, ...survivors];
}
