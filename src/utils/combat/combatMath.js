// Direct port of CombatController.java:518-621 (see this project's design spec
// docs/superpowers/specs/2026-07-16-damage-calculator-phase-a-design.md).
// No RNG: every value here is a closed-form expected value, matching the game's
// own implementation.

import { resolvePlayerStats, resolveMonsterStats, resolveEquipped, EQUIP_SLOTS } from './statEngine';
import { SKILL_IDS, SKILL_CONSTANTS } from './skillData';

export function getAttacksPerTurn(stats) {
    return Math.floor(stats.maxAP / stats.attackCost);
}

// CombatController.java:87-93 (Actor.getEffectiveCriticalChance).
export function getEffectiveCriticalChance(criticalSkill) {
    if (criticalSkill <= 0) return 0;
    const v = Math.floor(-5 + 2 * Math.sqrt(5 * criticalSkill));
    return v < 0 ? 0 : v;
}

export function hasCriticalSkillEffect(stats) {
    return stats.criticalSkill !== 0;
}
export function hasCriticalMultiplierEffect(stats) {
    return stats.criticalMultiplier !== 0 && stats.criticalMultiplier !== 1;
}
export function hasCriticalAttacks(stats) {
    return hasCriticalSkillEffect(stats) && hasCriticalMultiplierEffect(stats);
}

// CombatController.java:518-522.
export function hasCriticalAttack(attacker, target) {
    if (!hasCriticalAttacks(attacker)) return false;
    if (target.isImmuneToCriticalHits) return false;
    return true;
}

const HITCHANCE_N = 50;
const HITCHANCE_F = 40;
const TWO_OVER_PI = 2 / Math.PI;

// CombatController.java:583-597.
// formula: 50 * (1 + (2/pi) * atan((attackChance - blockChance - 50) / 40))
export function getAttackHitChance(attacker, target) {
    const c = attacker.attackChance - target.blockChance;
    return Math.floor(50 * (1 + TWO_OVER_PI * Math.atan((c - HITCHANCE_N) / HITCHANCE_F)));
}

// CombatController.java:526-546.
export function getAverageDamagePerHit(attacker, target) {
    const numOutcomes = attacker.damagePotential.max - attacker.damagePotential.min + 1;

    let avgNonCriticalDamage = 0;
    for (let n = 0; n < numOutcomes; n++) {
        avgNonCriticalDamage += Math.max(0, n + attacker.damagePotential.min - target.damageResistance) / numOutcomes;
    }

    let avgCriticalDamage = 0;
    let effectiveCriticalChance = 0;
    if (hasCriticalAttack(attacker, target)) {
        effectiveCriticalChance = getEffectiveCriticalChance(attacker.criticalSkill);
    }
    if (effectiveCriticalChance > 0) {
        for (let n = 0; n < numOutcomes; n++) {
            avgCriticalDamage +=
                Math.max(0, Math.floor((n + attacker.damagePotential.min) * attacker.criticalMultiplier) - target.damageResistance) /
                numOutcomes;
        }
    }

    const avgDamagePerSuccessfulStrike =
        (1 - effectiveCriticalChance / 100) * avgNonCriticalDamage + (effectiveCriticalChance * avgCriticalDamage) / 100;
    return (getAttackHitChance(attacker, target) * avgDamagePerSuccessfulStrike) / 100;
}

// CombatController.java:547-549.
export function getAverageDamagePerTurn(attacker, target) {
    return getAverageDamagePerHit(attacker, target) * getAttacksPerTurn(attacker);
}

// CombatController.java:550-560.
export function getTurnsToKillTarget(attacker, target) {
    if (hasCriticalAttack(attacker, target)) {
        if (attacker.damagePotential.max * attacker.criticalMultiplier <= target.damageResistance) return 999;
    } else {
        if (attacker.damagePotential.max <= target.damageResistance) return 999;
    }

    const averageDamagePerTurn = getAverageDamagePerTurn(attacker, target);
    if (averageDamagePerTurn <= 0) return 100;
    return Math.ceil(target.maxHP / averageDamagePerTurn);
}

// CombatController.java:561-570. Returns [0..100], 100 == easiest.
export function getMonsterDifficulty(player, monster) {
    const turnsToKillMonster = getTurnsToKillTarget(player, monster);
    if (turnsToKillMonster >= 999) return 0;
    const turnsToKillPlayer = getTurnsToKillTarget(monster, player);
    const result = 50 + (turnsToKillPlayer - turnsToKillMonster) * 2;
    if (result <= 1) return 1;
    if (result > 100) return 100;
    return result;
}

// MonsterInfoActivity.java:104-111.
export function getDifficultyLabel(difficulty) {
    if (difficulty >= 80) return 'veryeasy';
    if (difficulty >= 60) return 'easy';
    if (difficulty >= 40) return 'normal';
    if (difficulty >= 20) return 'hard';
    if (difficulty === 0) return 'impossible';
    return 'veryhard';
}

// --- Derived metrics ---

// Expected HP restored per round from conditions with a positive roundEffect
// (e.g. a regeneration-style buff). fullRoundEffect ticks are rarer/slower and
// intentionally excluded here — this is a per-turn estimate, not a full replay.
function getExpectedConditionHPPerRound(activeConditions, conditionsById) {
    let total = 0;
    for (const { conditionId, magnitude } of activeConditions || []) {
        const condition = conditionsById[conditionId];
        const boost = condition?.roundEffect?.increaseCurrentHP;
        if (!boost) continue;
        const avg = ((boost.min || 0) + (boost.max || 0)) / 2;
        total += avg * magnitude;
    }
    return total;
}

function averageRange(range) {
    if (!range) return 0;
    return ((range.min || 0) + (range.max || 0)) / 2;
}

// Expected HP restored per turn from equipped items' hitEffect - fires on
// every *successful* hit (CombatController.attack() rolls the hit chance
// before calling applyAttackHitStatusEffects; a miss uses a separate
// missEffect path this doesn't model), so it scales by hit chance and
// attacks/turn same as damage itself does.
function getExpectedHitEffectHPPerTurn(equipped, hitChance, attacksPerTurn) {
    let total = 0;
    for (const slot of EQUIP_SLOTS) {
        total += averageRange(equipped[slot]?.hitEffect?.increaseCurrentHP);
    }
    return total * (hitChance / 100) * attacksPerTurn;
}

// Expected HP restored per kill from equipped items' killEffect -
// ActorStatsController.applyKillEffectsToPlayer fires once per kill,
// independent of the Eater skill's own flat per-kill restore.
function getExpectedKillEffectHP(equipped) {
    let total = 0;
    for (const slot of EQUIP_SLOTS) {
        total += averageRange(equipped[slot]?.killEffect?.increaseCurrentHP);
    }
    return total;
}

// Builds the full set of calculator outputs for one player build vs one monster.
export function computeCombatSummary(build, monster, { itemsById, conditionsById }) {
    const player = resolvePlayerStats(build, { itemsById, conditionsById });
    const target = resolveMonsterStats(monster, monster.activeConditions || [], conditionsById);
    const equipped = resolveEquipped(build.equipment, itemsById);

    const difficulty = getMonsterDifficulty(player, target);
    const difficultyLabel = getDifficultyLabel(difficulty);

    const damagePerTurn = getAverageDamagePerTurn(player, target);
    const hpLossPerTurn = getAverageDamagePerTurn(target, player);
    const turnsToKillMonster = getTurnsToKillTarget(player, target);

    const regenPerTurn = getExpectedConditionHPPerRound(build.activeConditions, conditionsById);
    const hitEffectPerTurn = getExpectedHitEffectHPPerTurn(equipped, getAttackHitChance(player, target), getAttacksPerTurn(player));
    const hpGainPerTurn = regenPerTurn + hitEffectPerTurn;

    const hpLossPerKill = turnsToKillMonster >= 999 ? Infinity : turnsToKillMonster * hpLossPerTurn;

    // Eater skill's per-kill restore is a flat, deterministic bonus; item
    // killEffect HP restores are an expected value (min-max roll), per
    // ActorStatsController.applyKillEffectsToPlayer/applyUseEffect.
    const eaterLevel = build.skillLevels[SKILL_IDS.EATER] || 0;
    const hpGainPerKill = eaterLevel * SKILL_CONSTANTS.EATER_HEALTH + getExpectedKillEffectHP(equipped);

    return {
        difficulty,
        difficultyLabel,
        damagePerTurn,
        hpLossPerTurn,
        hpGainPerTurn,
        hpLossPerKill,
        hpGainPerKill,
    };
}
