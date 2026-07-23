// Phase C: pure internal pruning heuristic for Phase D's brute-force
// equipment search (skill allocation is fixed/user-chosen, not searched, so
// only items are scored here). Scores items on raw stat-delta Pareto vectors
// - deliberately NOT run through Phase A's real combat formulas, since
// CombatController.getAttackHitChance's arctan saturation
// (50 * (1 + (2/pi) * atan((attackChance - blockChance - n) / F))) makes a
// marginal-delta-at-one-baseline score unreliable near the curve's edges.
// See docs/superpowers/specs/2026-07-21-damage-calculator-phase-c-design.md.

import { getProficiencySkillForCategory } from './skillData';

// Vector dimension order: [attackDamageMin, attackDamageMax, attackChance,
// criticalSkill, criticalMultiplier, -attackCost].
export function computeOffenseVector(item) {
    const e = item?.equipEffect;
    if (!e) return [0, 0, 0, 0, 0, 0];
    const dmg = e.increaseAttackDamage || { min: 0, max: 0 };
    return [
        dmg.min || 0,
        dmg.max || 0,
        e.increaseAttackChance || 0,
        e.increaseCriticalSkill || 0,
        e.setCriticalMultiplier || 0,
        -(e.increaseAttackCost || 0),
    ];
}

function averageRange(range) {
    if (!range) return 0;
    return ((range.min || 0) + (range.max || 0)) / 2;
}

// Vector dimension order: [blockChance, damageResistance, maxHP, maxAP,
// hitEffect HP recovery, killEffect HP recovery]. The last two fold in items
// like Necklace of the Undead, whose real value is almost entirely in
// per-hit/per-kill HP recovery (CombatController.applyAttackHitStatusEffects/
// ActorStatsController.applyKillEffectsToPlayer) rather than its modest flat
// equipEffect - without this, such items score too low on raw stats alone to
// ever surface as optimizer candidates. Other on-hit/on-kill effects (chance-
// based condition procs, AP restores) aren't folded in here - their value
// isn't a single comparable number the way a flat HP average is.
export function computeDefenseVector(item) {
    const e = item?.equipEffect;
    return [
        e?.increaseBlockChance || 0,
        e?.increaseDamageResistance || 0,
        e?.increaseMaxHP || 0,
        e?.increaseMaxAP || 0,
        averageRange(item?.hitEffect?.increaseCurrentHP),
        averageRange(item?.killEffect?.increaseCurrentHP),
    ];
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
