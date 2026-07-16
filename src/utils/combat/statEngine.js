// Ported from ActorStatsController.java / ItemController.java / SkillController.java.
// See docs/superpowers/specs/2026-07-16-damage-calculator-phase-a-design.md for the
// full pipeline order and rationale.

import { applyLevelUpChoices } from './levelModel';

export const EQUIP_SLOTS = ['weapon', 'shield', 'head', 'body', 'hand', 'feet', 'neck', 'leftring', 'rightring'];
export const ARMOR_SLOTS = ['head', 'body', 'hand', 'feet'];

// Generic ability-effect application shared by items/skills/conditions alike,
// mirroring ActorStatsController.applyAbilityEffects (:254-273). `effect` is the
// game's AbilityModifierTraits shape as already parsed in this repo's JSON
// (equipEffect / abilityEffect): increaseMaxHP, increaseMaxAP, increaseMoveCost,
// increaseAttackCost, increaseAttackChance, increaseCriticalSkill,
// increaseAttackDamage:{min,max}, increaseBlockChance, increaseDamageResistance,
// increaseUseItemCost, increaseReequipCost.
export function applyAbilityEffects(stats, effect, multiplier = 1) {
    if (!effect) return;
    stats.maxHP += (effect.increaseMaxHP || 0) * multiplier;
    stats.maxAP += (effect.increaseMaxAP || 0) * multiplier;
    stats.moveCost += (effect.increaseMoveCost || 0) * multiplier;
    stats.attackCost += (effect.increaseAttackCost || 0) * multiplier;
    stats.useItemCost += (effect.increaseUseItemCost || 0) * multiplier;
    stats.reequipCost += (effect.increaseReequipCost || 0) * multiplier;
    stats.attackChance += (effect.increaseAttackChance || 0) * multiplier;
    stats.criticalSkill += (effect.increaseCriticalSkill || 0) * multiplier;
    if (effect.increaseAttackDamage) {
        stats.damagePotential.min += (effect.increaseAttackDamage.min || 0) * multiplier;
        stats.damagePotential.max += (effect.increaseAttackDamage.max || 0) * multiplier;
    }
    stats.blockChance += (effect.increaseBlockChance || 0) * multiplier;
    stats.damageResistance += (effect.increaseDamageResistance || 0) * multiplier;
}

// SkillController.java:449-467 (getPercentage) - sign-aware percentage of a
// stat's own contribution: positive contributions scaled by percentPositive,
// negative contributions (maluses) scaled by percentNegative.
export function getPercentage(value, percentPositive, percentNegative) {
    if (!value) return 0;
    if (value > 0) return Math.floor((value * percentPositive) / 100);
    return Math.floor((value * percentNegative) / 100);
}

export function isWeapon(item) {
    return !!item && item.categoryLink?.inventorySlot === 'weapon';
}
export function isShield(item) {
    return !!item && item.categoryLink?.inventorySlot === 'shield';
}
export function isTwohandWeapon(item) {
    return isWeapon(item) && item.categoryLink?.size === 'large';
}
// ItemCategory.getSize() defaults to `none` for cloth armor (no "size" field in
// JSON) - such items don't count as "worn" for unarmed/unarmored purposes.
export function hasWeight(item) {
    return !!item && !!item.categoryLink?.size && item.categoryLink.size !== 'none';
}

export function isUnarmed(equipped) {
    return !hasWeight(equipped.weapon) && !hasWeight(equipped.shield);
}
export function isUnarmored(equipped) {
    return ARMOR_SLOTS.every((slot) => !hasWeight(equipped[slot]));
}

export function isDualWielding(mainHand, offHand) {
    return isWeapon(mainHand) && isWeapon(offHand);
}
export function isWielding2Hand(mainHand, offHand) {
    return !!mainHand && !offHand && isTwohandWeapon(mainHand);
}
export function isWieldingWeaponAndShield(mainHand, offHand) {
    return isWeapon(mainHand) && isShield(offHand);
}

// ActorStatsController.java: lowCapActorAttackChance / lowCapActorDamagePotential.
export function clampStats(stats) {
    if (stats.attackChance < 0) stats.attackChance = 0;
    if (stats.damagePotential.max < 0) {
        stats.damagePotential.min = 0;
        stats.damagePotential.max = 0;
    }
}

// Builds an empty ResolvedStats-plus-cost-fields object from level-1-plus-level-up
// base traits (Task 1's levelModel), ready for equipment/skills/conditions to be
// layered on top of.
export function buildBaseStats(level, levelUpChoices, fortitudeSkillLevel) {
    const traits = applyLevelUpChoices(level, levelUpChoices, fortitudeSkillLevel);
    return {
        attackCost: traits.attackCost,
        attackChance: traits.attackChance,
        criticalSkill: traits.criticalSkill,
        criticalMultiplier: traits.criticalMultiplier,
        damagePotential: { ...traits.damagePotential },
        blockChance: traits.blockChance,
        damageResistance: traits.damageResistance,
        maxHP: traits.maxHP,
        maxAP: traits.maxAP,
        isImmuneToCriticalHits: false,
        moveCost: traits.moveCost,
        useItemCost: traits.useItemCost,
        reequipCost: traits.reequipCost,
    };
}
