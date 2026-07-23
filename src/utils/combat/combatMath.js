// Direct port of CombatController.java:518-621 (see this project's design spec
// docs/superpowers/specs/2026-07-16-damage-calculator-phase-a-design.md).
// No RNG: every value here is a closed-form expected value, matching the game's
// own implementation.

import { resolvePlayerStats, resolveMonsterStats, resolveEquipped, EQUIP_SLOTS } from './statEngine';
import { SKILL_IDS, SKILL_CONSTANTS } from './skillData';
import { averageRange, getExpectedBoostPerTurn, applyExpectedProcConditions } from './procEffects';

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

// CombatController.java:550-560. attacksPerTurn <= 0 (attackCost exceeds
// maxAP - the game resets AP to max every turn with no carryover, so this
// weapon can *never* be swung, not just "swung rarely") is a structurally
// different kind of impossible than "attacks land but deal ≤0 net damage" -
// the latter still uses the game's own 100-turn fallback, but the former
// needs the same 999 sentinel as the other impossible cases below it, or a
// build that can't attack at all reports a finite, plausible-looking
// hpLossPerKill instead of correctly sorting to the bottom as unusable.
export function getTurnsToKillTarget(attacker, target) {
    if (getAttacksPerTurn(attacker) <= 0) return 999;
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

// Expected HP restored per kill from equipped items' killEffect -
// ActorStatsController.applyKillEffectsToPlayer fires once per kill,
// independent of the Eater skill's own flat per-kill restore. killEffect's
// other fields (increaseCurrentAP, conditionsSource) aren't modeled: they'd
// only affect a *subsequent* encounter, which this calculator (one build vs
// one monster) never simulates.
function getExpectedKillEffectHP(playerItems) {
    let total = 0;
    for (const item of playerItems) {
        total += averageRange(item.killEffect?.increaseCurrentHP);
    }
    return total;
}

// Skill-based procs that fire off attack outcomes rather than a flat stat
// (SkillController.applySkillEffectsFromPlayerAttack/
// applySkillEffectsFromMonsterAttack): Concussion/Crit1/Crit2 apply a fixed
// condition to the monster on the player's hit/critical hit; Taunt drains
// the monster's AP on the monster's miss. Unlike item procs, chance/
// magnitude/duration are fixed game constants, not read from JSON.
function applyGeneralCombatSkillProcs(adjustedPlayer, adjustedMonster, build, baseHitChancePlayer, baseHitChanceMonster, baseAttacksPlayer, conditionsById) {
    const lvl = (id) => build.skillLevels[id] || 0;

    const concussionLevel = lvl(SKILL_IDS.CONCUSSION);
    if (concussionLevel > 0 && adjustedPlayer.attackChance - adjustedMonster.blockChance > SKILL_CONSTANTS.CONCUSSION_THRESHOLD) {
        applyExpectedProcConditions(adjustedMonster, [{
            condition: 'concussion',
            magnitude: SKILL_CONSTANTS.CONCUSSION_CONDITION_MAGNITUDE,
            duration: SKILL_CONSTANTS.CONCUSSION_CONDITION_DURATION,
            chance: SKILL_CONSTANTS.CONCUSSION_CHANCE_PERCENT * concussionLevel,
        }], baseHitChancePlayer, baseAttacksPlayer, conditionsById);
    }

    const crit1Level = lvl(SKILL_IDS.CRIT1);
    const crit2Level = lvl(SKILL_IDS.CRIT2);
    if ((crit1Level > 0 || crit2Level > 0) && hasCriticalAttack(adjustedPlayer, adjustedMonster)) {
        // Chance out of 100 that a given attack both lands *and* crits.
        const critHitChancePercent = baseHitChancePlayer * (getEffectiveCriticalChance(adjustedPlayer.criticalSkill) / 100);
        if (crit1Level > 0) {
            applyExpectedProcConditions(adjustedMonster, [{
                condition: 'crit1', magnitude: SKILL_CONSTANTS.CRIT_CONDITION_MAGNITUDE,
                duration: SKILL_CONSTANTS.CRIT_CONDITION_DURATION, chance: SKILL_CONSTANTS.CRIT1_CHANCE_PERCENT * crit1Level,
            }], critHitChancePercent, baseAttacksPlayer, conditionsById);
        }
        if (crit2Level > 0) {
            applyExpectedProcConditions(adjustedMonster, [{
                condition: 'crit2', magnitude: SKILL_CONSTANTS.CRIT_CONDITION_MAGNITUDE,
                duration: SKILL_CONSTANTS.CRIT_CONDITION_DURATION, chance: SKILL_CONSTANTS.CRIT2_CHANCE_PERCENT * crit2Level,
            }], critHitChancePercent, baseAttacksPlayer, conditionsById);
        }
    }
}

// Builds the full set of calculator outputs for one player build vs one monster.
export function computeCombatSummary(build, monster, { itemsById, conditionsById }) {
    const player = resolvePlayerStats(build, { itemsById, conditionsById });
    const target = resolveMonsterStats(monster, monster.activeConditions || [], conditionsById);
    const equipped = resolveEquipped(build.equipment, itemsById);
    const playerItems = EQUIP_SLOTS.map(slot => equipped[slot]).filter(Boolean);

    // Base (pre-proc-adjustment) rates - the single-pass inputs every proc
    // formula below uses. Intentionally not recomputed after applying procs:
    // e.g. AP a proc grants could itself buy another attack that could
    // itself proc more AP, but chasing that fixed point would be more
    // precision than a single min-max roll estimate can really support.
    const baseHitChancePlayer = getAttackHitChance(player, target);
    const baseHitChanceMonster = getAttackHitChance(target, player);
    const baseAttacksPlayer = getAttacksPerTurn(player);
    const baseAttacksMonster = getAttacksPerTurn(target);

    // --- AP deltas (re-floor once - the game has no fractional attacks) ---
    let playerBonusAP = 0;
    let monsterBonusAP = 0; // negative = drained

    for (const item of playerItems) {
        // Player's own gear firing on the player's hits against the monster.
        playerBonusAP += getExpectedBoostPerTurn(item.hitEffect?.increaseCurrentAP, baseHitChancePlayer, baseAttacksPlayer);
        // Player's gear reacting when the *player* is hit by the monster.
        playerBonusAP += getExpectedBoostPerTurn(item.hitReceivedEffect?.increaseCurrentAP, baseHitChanceMonster, baseAttacksMonster);
        monsterBonusAP += getExpectedBoostPerTurn(item.hitReceivedEffect?.increaseAttackerCurrentAP, baseHitChanceMonster, baseAttacksMonster);
    }
    // Monster's own effects (rare in practice, but the data shape allows it),
    // symmetric to the player's gear above.
    monsterBonusAP += getExpectedBoostPerTurn(monster.hitEffect?.increaseCurrentAP, baseHitChanceMonster, baseAttacksMonster);
    monsterBonusAP += getExpectedBoostPerTurn(monster.hitReceivedEffect?.increaseCurrentAP, baseHitChancePlayer, baseAttacksPlayer);
    playerBonusAP += getExpectedBoostPerTurn(monster.hitReceivedEffect?.increaseAttackerCurrentAP, baseHitChancePlayer, baseAttacksPlayer);

    // Taunt: fires on the monster's *miss* against the player.
    const tauntLevel = build.skillLevels[SKILL_IDS.TAUNT] || 0;
    if (tauntLevel > 0) {
        const tauntChance = (SKILL_CONSTANTS.TAUNT_CHANCE_PERCENT * tauntLevel) / 100;
        monsterBonusAP -= (1 - baseHitChanceMonster / 100) * tauntChance * SKILL_CONSTANTS.TAUNT_AP_LOSS * baseAttacksMonster;
    }

    const adjustedPlayer = { ...player, damagePotential: { ...player.damagePotential }, maxAP: Math.max(0, player.maxAP + playerBonusAP) };
    const adjustedMonster = { ...target, damagePotential: { ...target.damagePotential }, maxAP: Math.max(0, target.maxAP + monsterBonusAP) };

    // --- Condition procs (occupancy/stacking math lives in procEffects.js) ---
    for (const item of playerItems) {
        applyExpectedProcConditions(adjustedPlayer, item.hitEffect?.conditionsSource, baseHitChancePlayer, baseAttacksPlayer, conditionsById);
        applyExpectedProcConditions(adjustedMonster, item.hitEffect?.conditionsTarget, baseHitChancePlayer, baseAttacksPlayer, conditionsById);
        applyExpectedProcConditions(adjustedPlayer, item.hitReceivedEffect?.conditionsSource, baseHitChanceMonster, baseAttacksMonster, conditionsById);
        applyExpectedProcConditions(adjustedMonster, item.hitReceivedEffect?.conditionsTarget, baseHitChanceMonster, baseAttacksMonster, conditionsById);
    }
    applyExpectedProcConditions(adjustedMonster, monster.hitEffect?.conditionsSource, baseHitChanceMonster, baseAttacksMonster, conditionsById);
    applyExpectedProcConditions(adjustedPlayer, monster.hitEffect?.conditionsTarget, baseHitChanceMonster, baseAttacksMonster, conditionsById);
    applyExpectedProcConditions(adjustedMonster, monster.hitReceivedEffect?.conditionsSource, baseHitChancePlayer, baseAttacksPlayer, conditionsById);
    applyExpectedProcConditions(adjustedPlayer, monster.hitReceivedEffect?.conditionsTarget, baseHitChancePlayer, baseAttacksPlayer, conditionsById);

    applyGeneralCombatSkillProcs(adjustedPlayer, adjustedMonster, build, baseHitChancePlayer, baseHitChanceMonster, baseAttacksPlayer, conditionsById);

    const difficulty = getMonsterDifficulty(adjustedPlayer, adjustedMonster);
    const difficultyLabel = getDifficultyLabel(difficulty);

    // Reflect/thorns-style direct damage (hitReceivedEffect's
    // increaseAttackerCurrentHP - negative values are damage to the
    // attacker) is folded straight into damage/turn and hp-loss/turn: it's
    // extra damage dealt at the rate of the *other* side's attacks, exactly
    // like the weapon damage it's added alongside.
    let bonusDamageToMonsterPerTurn = 0;
    for (const item of playerItems) {
        bonusDamageToMonsterPerTurn -= getExpectedBoostPerTurn(item.hitReceivedEffect?.increaseAttackerCurrentHP, baseHitChanceMonster, baseAttacksMonster);
    }
    const bonusDamageToPlayerPerTurn = -getExpectedBoostPerTurn(monster.hitReceivedEffect?.increaseAttackerCurrentHP, baseHitChancePlayer, baseAttacksPlayer);

    const damagePerTurn = getAverageDamagePerTurn(adjustedPlayer, adjustedMonster) + bonusDamageToMonsterPerTurn;
    const hpLossPerTurn = getAverageDamagePerTurn(adjustedMonster, adjustedPlayer) + bonusDamageToPlayerPerTurn;
    const turnsToKillMonster = getTurnsToKillTarget(adjustedPlayer, adjustedMonster);

    const regenPerTurn = getExpectedConditionHPPerRound(build.activeConditions, conditionsById);
    let hitEffectHPPerTurn = 0;
    for (const item of playerItems) {
        hitEffectHPPerTurn += getExpectedBoostPerTurn(item.hitEffect?.increaseCurrentHP, baseHitChancePlayer, baseAttacksPlayer);
        hitEffectHPPerTurn += getExpectedBoostPerTurn(item.hitReceivedEffect?.increaseCurrentHP, baseHitChanceMonster, baseAttacksMonster);
    }
    hitEffectHPPerTurn += getExpectedBoostPerTurn(monster.hitReceivedEffect?.increaseCurrentHP, baseHitChancePlayer, baseAttacksPlayer);
    const hpGainPerTurn = regenPerTurn + hitEffectHPPerTurn;

    const hpLossPerKill = turnsToKillMonster >= 999 ? Infinity : turnsToKillMonster * hpLossPerTurn;

    // Eater skill's per-kill restore is a flat, deterministic bonus; item
    // killEffect HP restores are an expected value (min-max roll), per
    // ActorStatsController.applyKillEffectsToPlayer/applyUseEffect.
    const eaterLevel = build.skillLevels[SKILL_IDS.EATER] || 0;
    const hpGainPerKill = eaterLevel * SKILL_CONSTANTS.EATER_HEALTH + getExpectedKillEffectHP(playerItems);

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
