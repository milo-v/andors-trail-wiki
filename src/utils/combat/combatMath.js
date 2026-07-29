// Direct port of CombatController.java:518-621 (see this project's design spec
// docs/superpowers/specs/2026-07-16-damage-calculator-phase-a-design.md).
// No RNG: every value here is a closed-form expected value, matching the game's
// own implementation.

import { resolvePlayerStats, resolveMonsterStats, resolveEquipped, EQUIP_SLOTS, getEquipmentConditions, mergeConditionInstances } from './statEngine';
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

// Expected HP restored (or drained) per round from conditions with a
// roundEffect (e.g. a regeneration-style buff, or a self-inflicted curse like
// Necklace of the Undead's Curse of the Undead). fullRoundEffect ticks are
// rarer/slower and intentionally excluded here — this is a per-turn estimate,
// not a full replay. mergedConditions: Map<conditionId, magnitude> from
// mergeConditionInstances - includes both equip-added conditions and
// user-toggled build.activeConditions, so an item's permanent self-curse is
// no longer invisible to this estimate the way it was when this only read
// build.activeConditions directly.
function getExpectedConditionHPPerRound(mergedConditions, conditionsById) {
    let total = 0;
    for (const [conditionId, magnitude] of mergedConditions) {
        if (magnitude <= 0) continue;
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
// independent of the Eater skill's own flat per-kill restore. Outside horde
// mode, killEffect's other fields (increaseCurrentAP, conditionsSource)
// aren't modeled here: they'd only affect a *subsequent* encounter, which a
// 1v1 fight (this calculator's default) never simulates - a fight against a
// single monster ends at the kill. In horde mode there IS a next monster
// (instant replacement), so those fields are modeled too - see
// getExpectedKillEffectAP and computeCombatSummary's kill-triggered pass.
function getExpectedKillEffectHP(playerItems) {
    let total = 0;
    for (const item of playerItems) {
        total += averageRange(item.killEffect?.increaseCurrentHP);
    }
    return total;
}

// Same idea as getExpectedKillEffectHP, for killEffect's increaseCurrentAP.
function getExpectedKillEffectAP(playerItems) {
    let total = 0;
    for (const item of playerItems) {
        total += averageRange(item.killEffect?.increaseCurrentAP);
    }
    return total;
}

// Skill-based procs that fire off attack outcomes rather than a flat stat
// (SkillController.applySkillEffectsFromPlayerAttack/
// applySkillEffectsFromMonsterAttack): Concussion/Crit1/Crit2 apply a fixed
// condition to the monster on the player's hit/critical hit; Taunt drains
// the monster's AP on the monster's miss. Unlike item procs, chance/
// magnitude/duration are fixed game constants, not read from JSON.
// cycleLength (optional, 8th param): threaded through to every proc call in
// this function - Concussion/Crit1/Crit2 all apply their condition to
// adjustedMonster, which resets every kill in horde mode. See
// docs/superpowers/specs/2026-07-27-horde-condition-ramp-design.md.
function applyGeneralCombatSkillProcs(adjustedPlayer, adjustedMonster, build, baseHitChancePlayer, baseHitChanceMonster, baseAttacksPlayer, conditionsById, cycleLength) {
    const lvl = (id) => build.skillLevels[id] || 0;

    const concussionLevel = lvl(SKILL_IDS.CONCUSSION);
    if (concussionLevel > 0 && adjustedPlayer.attackChance - adjustedMonster.blockChance > SKILL_CONSTANTS.CONCUSSION_THRESHOLD) {
        applyExpectedProcConditions(adjustedMonster, [{
            condition: 'concussion',
            magnitude: SKILL_CONSTANTS.CONCUSSION_CONDITION_MAGNITUDE,
            duration: SKILL_CONSTANTS.CONCUSSION_CONDITION_DURATION,
            chance: SKILL_CONSTANTS.CONCUSSION_CHANCE_PERCENT * concussionLevel,
        }], baseHitChancePlayer, baseAttacksPlayer, conditionsById, cycleLength);
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
            }], critHitChancePercent, baseAttacksPlayer, conditionsById, cycleLength);
        }
        if (crit2Level > 0) {
            applyExpectedProcConditions(adjustedMonster, [{
                condition: 'crit2', magnitude: SKILL_CONSTANTS.CRIT_CONDITION_MAGNITUDE,
                duration: SKILL_CONSTANTS.CRIT_CONDITION_DURATION, chance: SKILL_CONSTANTS.CRIT2_CHANCE_PERCENT * crit2Level,
            }], critHitChancePercent, baseAttacksPlayer, conditionsById, cycleLength);
        }
    }
}

// Builds the full set of calculator outputs for one player build vs one
// monster. `horde` is optional: `{ size }` with size > 1 means the player is
// fighting `size` simultaneous, endlessly-replaced copies of `monster` (a
// dead one is instantly replaced, so the attacker count never drops) - see
// docs/superpowers/specs/2026-07-27-horde-mode-design.md. Omitting it (or
// `size <= 1`) reproduces the original 1-vs-1 output exactly.
// precomputed (optional): { targetStats, baseStats } - lets a hot-loop caller
// (optimizer.js's searchBestBuilds) hoist the equipment-independent parts of
// player/monster stat resolution out of the per-combo loop. See
// resolvePlayerStats's precomputedBaseStats param above resolveMonsterStats -
// target is read-only for the rest of this function (only ever spread into
// copies below), so it's safe to reuse the same object across many calls.
export function computeCombatSummary(build, monster, { itemsById, conditionsById }, horde, precomputed = {}) {
    const player = resolvePlayerStats(build, { itemsById, conditionsById }, precomputed.baseStats);
    const target = precomputed.targetStats || resolveMonsterStats(monster, monster.activeConditions || [], conditionsById);
    const equipped = resolveEquipped(build.equipment, itemsById);
    const playerItems = EQUIP_SLOTS.map(slot => equipped[slot]).filter(Boolean);

    const attackerCount = horde && horde.size > 1 ? horde.size : 1;
    const hordeActive = attackerCount > 1;

    // Base (pre-proc-adjustment) rates - the single-pass inputs every proc
    // formula below uses. Intentionally not recomputed after applying procs:
    // e.g. AP a proc grants could itself buy another attack that could
    // itself proc more AP, but chasing that fixed point would be more
    // precision than a single min-max roll estimate can really support.
    const baseHitChancePlayer = getAttackHitChance(player, target);
    const baseHitChanceMonster = getAttackHitChance(target, player);
    const baseAttacksPlayer = getAttacksPerTurn(player);
    const baseAttacksMonster = getAttacksPerTurn(target);
    // A horde's N enemies each independently attack the player every round -
    // N parallel Bernoulli attack streams at the same per-attempt chance are
    // exactly equivalent (for every linear EV formula in procEffects.js) to
    // one stream at N times the rate, so scaling attacksPerTurn is exact,
    // not an approximation. Only used for effects the MONSTER's hit inflicts
    // on the PLAYER - see the horde design spec for what does/doesn't scale.
    const effectiveAttacksMonster = baseAttacksMonster * attackerCount;

    // --- AP deltas (re-floor once - the game has no fractional attacks) ---
    let playerBonusAP = 0;
    let monsterBonusAP = 0; // negative = drained

    for (const item of playerItems) {
        // Player's own gear firing on the player's hits against the monster.
        playerBonusAP += getExpectedBoostPerTurn(item.hitEffect?.increaseCurrentAP, baseHitChancePlayer, baseAttacksPlayer);
        // Player's gear reacting when the *player* is hit by the monster -
        // scaled: every attacking monster can independently trigger this.
        playerBonusAP += getExpectedBoostPerTurn(item.hitReceivedEffect?.increaseCurrentAP, baseHitChanceMonster, effectiveAttacksMonster);
        // AP drained from *whichever* monster's hit triggered this - a
        // per-monster effect (each monster has its own AP pool), not scaled -
        // it's already captured once via the representative monster and the
        // whole representative monster's output is scaled at the end.
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
    const baseMonsterStats = { ...target, damagePotential: { ...target.damagePotential }, maxAP: Math.max(0, target.maxAP + monsterBonusAP) };

    // --- Condition procs landing on the PLAYER (occupancy/stacking math
    // lives in procEffects.js) - applied once, unconditionally: the
    // player's identity persists across the whole horde fight, so there's
    // no reset-on-kill ramp-up issue here, ever.
    for (const item of playerItems) {
        applyExpectedProcConditions(adjustedPlayer, item.hitEffect?.conditionsSource, baseHitChancePlayer, baseAttacksPlayer, conditionsById);
        // Player's own gear reacting to being hit - scaled (every attacking
        // monster can independently trigger it).
        applyExpectedProcConditions(adjustedPlayer, item.hitReceivedEffect?.conditionsSource, baseHitChanceMonster, effectiveAttacksMonster, conditionsById);
    }
    // Conditions the monster's hit inflicts on the player - the highest-risk
    // horde effect (e.g. poison/stun stacking from N simultaneous attackers)
    // - scaled.
    applyExpectedProcConditions(adjustedPlayer, monster.hitEffect?.conditionsTarget, baseHitChanceMonster, effectiveAttacksMonster, conditionsById);
    applyExpectedProcConditions(adjustedPlayer, monster.hitReceivedEffect?.conditionsTarget, baseHitChancePlayer, baseAttacksPlayer, conditionsById);

    // Condition procs landing on the MONSTER: its identity resets every kill
    // in horde mode (a dead one is instantly replaced by a fresh,
    // zero-condition copy), so this is rebuilt from `baseMonsterStats` -
    // once at steady state below to get a preliminary turnsToKillMonster,
    // and again with that as a finite-horizon cycleLength once horde mode
    // and killability are confirmed - see
    // docs/superpowers/specs/2026-07-27-horde-condition-ramp-design.md.
    // cycleLength is undefined for the steady-state build (1v1 behavior,
    // and horde mode's own first pass).
    function buildAdjustedMonster(cycleLength) {
        const monsterStats = { ...baseMonsterStats, damagePotential: { ...baseMonsterStats.damagePotential } };
        for (const item of playerItems) {
            applyExpectedProcConditions(monsterStats, item.hitEffect?.conditionsTarget, baseHitChancePlayer, baseAttacksPlayer, conditionsById, cycleLength);
            // Conditions the player's gear applies to *the attacker* - per-
            // monster (only affects the representative monster's own
            // stats), not scaled.
            applyExpectedProcConditions(monsterStats, item.hitReceivedEffect?.conditionsTarget, baseHitChanceMonster, baseAttacksMonster, conditionsById, cycleLength);
        }
        applyExpectedProcConditions(monsterStats, monster.hitEffect?.conditionsSource, baseHitChanceMonster, baseAttacksMonster, conditionsById, cycleLength);
        applyExpectedProcConditions(monsterStats, monster.hitReceivedEffect?.conditionsSource, baseHitChancePlayer, baseAttacksPlayer, conditionsById, cycleLength);
        applyGeneralCombatSkillProcs(adjustedPlayer, monsterStats, build, baseHitChancePlayer, baseHitChanceMonster, baseAttacksPlayer, conditionsById, cycleLength);
        return monsterStats;
    }

    let adjustedMonster = buildAdjustedMonster(undefined);

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

    // Kill-triggered effects (horde only): a kill arrives at rate
    // 1/turnsToKillMonster once that preliminary rate is known. Applied as
    // one extra adjustment pass rather than iterating to a converged fixed
    // point (this file's "not recomputed after applying procs" philosophy
    // above already accepts the same kind of single-pass approximation for
    // AP procs). Outside horde mode this never runs - a 1v1 fight ends at
    // the kill, so there's no "next monster" in the same encounter to
    // benefit from a kill's AP/condition bonus (killEffect's HP restore is
    // still modeled outside horde mode via getExpectedKillEffectHP below).
    let turnsToKillMonster = getTurnsToKillTarget(adjustedPlayer, adjustedMonster);

    // Rebuild the monster's condition-derived stats with a finite-horizon
    // cycleLength (this preliminary turnsToKillMonster) before the
    // kill-triggered-effects step below, so that step's own preliminary
    // rate is computed from the already-corrected monster - see
    // docs/superpowers/specs/2026-07-27-horde-condition-ramp-design.md.
    if (hordeActive && turnsToKillMonster < 999) {
        adjustedMonster = buildAdjustedMonster(turnsToKillMonster);
        turnsToKillMonster = getTurnsToKillTarget(adjustedPlayer, adjustedMonster);
    }

    if (hordeActive && turnsToKillMonster < 999) {
        const killRate = 1 / turnsToKillMonster;
        const killAP = getExpectedKillEffectAP(playerItems) * killRate;
        if (killAP !== 0) adjustedPlayer.maxAP = Math.max(0, adjustedPlayer.maxAP + killAP);
        const killConditions = playerItems.flatMap(item => item.killEffect?.conditionsSource || []);
        applyExpectedProcConditions(adjustedPlayer, killConditions, 100, killRate, conditionsById);
        turnsToKillMonster = getTurnsToKillTarget(adjustedPlayer, adjustedMonster);
    }

    const damagePerTurn = getAverageDamagePerTurn(adjustedPlayer, adjustedMonster) + bonusDamageToMonsterPerTurn;
    // Direct monster damage is the one term that must be scaled as a whole
    // result (getAverageDamagePerTurn derives the monster's own attack rate
    // internally, so there's no rate parameter to scale going in).
    const hpLossPerTurn = getAverageDamagePerTurn(adjustedMonster, adjustedPlayer) * attackerCount + bonusDamageToPlayerPerTurn;

    const mergedConditions = mergeConditionInstances(
        [...getEquipmentConditions(equipped), ...(build.activeConditions || [])],
        conditionsById
    );
    const regenPerTurn = getExpectedConditionHPPerRound(mergedConditions, conditionsById);
    let hitEffectHPPerTurn = 0;
    for (const item of playerItems) {
        hitEffectHPPerTurn += getExpectedBoostPerTurn(item.hitEffect?.increaseCurrentHP, baseHitChancePlayer, baseAttacksPlayer);
        // HP the player gains from being hit - scaled.
        hitEffectHPPerTurn += getExpectedBoostPerTurn(item.hitReceivedEffect?.increaseCurrentHP, baseHitChanceMonster, effectiveAttacksMonster);
    }
    hitEffectHPPerTurn += getExpectedBoostPerTurn(monster.hitReceivedEffect?.increaseCurrentHP, baseHitChancePlayer, baseAttacksPlayer);

    // Eater skill's per-kill restore is a flat, deterministic bonus; item
    // killEffect HP restores are an expected value (min-max roll), per
    // ActorStatsController.applyKillEffectsToPlayer/applyUseEffect.
    const eaterLevel = build.skillLevels[SKILL_IDS.EATER] || 0;
    const hpGainPerKillSingle = eaterLevel * SKILL_CONSTANTS.EATER_HEALTH + getExpectedKillEffectHP(playerItems);

    let hpGainPerTurn = regenPerTurn + hitEffectHPPerTurn;
    // Same formula regardless of horde: expected HP lost/gained over the
    // time it takes to land one kill. In horde mode this is reported
    // *alongside* the per-turn numbers above (rather than replacing them),
    // since an endless horde still makes both framings meaningful.
    const hpLossPerKill = turnsToKillMonster >= 999 ? Infinity : turnsToKillMonster * hpLossPerTurn;
    // Mirrors hpLossPerKill: fold in HP regen/hitEffect healing accrued
    // over the whole fight (not just the flat on-kill bonus), matching the
    // "HP change per kill" formula documented in ResultsPanel.jsx.
    const hpGainPerKill = turnsToKillMonster >= 999
        ? hpGainPerKillSingle
        : turnsToKillMonster * (regenPerTurn + hitEffectHPPerTurn) + hpGainPerKillSingle;
    if (hordeActive && turnsToKillMonster < 999) {
        // Horde mode additionally folds the on-kill HP bonus into the
        // per-turn number, at the rate kills actually happen, since kills
        // keep recurring for the rest of an endless fight.
        hpGainPerTurn += hpGainPerKillSingle / turnsToKillMonster;
    }

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
