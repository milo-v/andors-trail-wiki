// Ported from ActorStatsController.java / ItemController.java / SkillController.java.
// See docs/superpowers/specs/2026-07-16-damage-calculator-phase-a-design.md for the
// full pipeline order and rationale.

import { applyLevelUpChoices } from './levelModel';
import { SKILL_IDS, SKILL_CONSTANTS, getProficiencySkillForCategory } from './skillData';

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

// --- Fighting styles + dual-wield ---

function applyDualWield(stats, mainHand, offHand, skillLevels) {
    const fsLevel = skillLevels[SKILL_IDS.FIGHTSTYLE_DUAL_WIELD] || 0;
    if (!offHand.equipEffect) return;

    const attackCostMain = mainHand.equipEffect?.increaseAttackCost || 0;
    const attackCostOff = offHand.equipEffect.increaseAttackCost || 0;
    let percent;

    if (fsLevel >= 2) {
        percent = SKILL_CONSTANTS.DUALWIELD_EFFICIENCY_LEVEL2;
        stats.attackCost = Math.max(attackCostMain, attackCostOff);
    } else if (fsLevel === 1) {
        percent = SKILL_CONSTANTS.DUALWIELD_EFFICIENCY_LEVEL1;
        stats.attackCost =
            Math.max(attackCostMain, attackCostOff) +
            getPercentage(Math.min(attackCostMain, attackCostOff), SKILL_CONSTANTS.DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT, 0);
    } else {
        percent = SKILL_CONSTANTS.DUALWIELD_EFFICIENCY_LEVEL0;
        stats.attackCost = attackCostMain + attackCostOff;
    }

    stats.criticalMultiplier = Math.max(
        mainHand.equipEffect?.setCriticalMultiplier || 0,
        getPercentage(offHand.equipEffect.setCriticalMultiplier || 0, percent, 0)
    );

    const offhandProfSkill = getProficiencySkillForCategory(offHand.categoryLink);
    const offhandProfLevel = offhandProfSkill ? skillLevels[offhandProfSkill] || 0 : 0;
    stats.attackChance += getPercentage(SKILL_CONSTANTS.WEAPON_PROF_AC_PERCENT * offhandProfLevel, percent, 0);
    stats.blockChance += getPercentage(SKILL_CONSTANTS.WEAPON_PROF_BC_PERCENT * offhandProfLevel, percent, 0);
    stats.criticalSkill += getPercentage(SKILL_CONSTANTS.WEAPON_PROF_CS_PERCENT * offhandProfLevel, percent, 0);

    const e = offHand.equipEffect;
    stats.attackChance += getPercentage(e.increaseAttackChance || 0, percent, 100);
    stats.blockChance += getPercentage(e.increaseBlockChance || 0, percent, 100);
    if (e.increaseAttackDamage) {
        stats.damagePotential.max += getPercentage(e.increaseAttackDamage.max || 0, percent, 100);
        stats.damagePotential.min += getPercentage(e.increaseAttackDamage.min || 0, percent, 100);
    }
    stats.criticalSkill += getPercentage(e.increaseCriticalSkill || 0, percent, 100);
    stats.maxHP += getPercentage(e.increaseMaxHP || 0, percent, 100);
    stats.damageResistance += getPercentage(e.increaseDamageResistance || 0, percent, 100);
    stats.maxAP += getPercentage(e.increaseMaxAP || 0, percent, 100);
    // Reversed parameters: a positive value is a malus for these cost fields.
    stats.moveCost += getPercentage(e.increaseMoveCost || 0, 100, percent);
    stats.reequipCost += getPercentage(e.increaseReequipCost || 0, 100, percent);
    stats.useItemCost += getPercentage(e.increaseUseItemCost || 0, 100, percent);
}

function applyFightingStyles(stats, equipped, skillLevels) {
    const lvl = (id) => skillLevels[id] || 0;
    const mainHand = equipped.weapon;
    const offHand = equipped.shield;

    if (lvl(SKILL_IDS.FIGHTSTYLE_UNARMED_UNARMORED) > 0 && isUnarmored(equipped) && !mainHand && !offHand) {
        const level = lvl(SKILL_IDS.FIGHTSTYLE_UNARMED_UNARMORED);
        stats.blockChance += SKILL_CONSTANTS.UNARMED_UNARMORED_BC * level;
        stats.damageResistance += SKILL_CONSTANTS.UNARMED_UNARMORED_DR * level;
        stats.attackChance += SKILL_CONSTANTS.UNARMED_UNARMORED_AC * level;
        stats.damagePotential.max += SKILL_CONSTANTS.UNARMED_UNARMORED_DMG_MAX * level;
        stats.criticalMultiplier = 1 + (SKILL_CONSTANTS.UNARMED_UNARMORED_CM_PERCENT / 100) * level;
    }

    if (isWielding2Hand(mainHand, offHand)) {
        const fs = lvl(SKILL_IDS.FIGHTSTYLE_2HAND);
        const spec = lvl(SKILL_IDS.SPECIALIZATION_2HAND);
        const dmg = mainHand.equipEffect?.increaseAttackDamage || { min: 0, max: 0 };
        stats.damagePotential.max += getPercentage(dmg.max, fs * SKILL_CONSTANTS.FIGHTSTYLE_2HAND_DMG_PERCENT, 0);
        stats.damagePotential.min += getPercentage(dmg.min, fs * SKILL_CONSTANTS.FIGHTSTYLE_2HAND_DMG_PERCENT, 0);
        stats.damagePotential.max += getPercentage(dmg.max, spec * SKILL_CONSTANTS.SPECIALIZATION_2HAND_DMG_PERCENT, 0);
        stats.damagePotential.min += getPercentage(dmg.min, spec * SKILL_CONSTANTS.SPECIALIZATION_2HAND_DMG_PERCENT, 0);
        stats.attackChance += getPercentage(mainHand.equipEffect?.increaseAttackChance || 0, spec * SKILL_CONSTANTS.SPECIALIZATION_2HAND_AC_PERCENT, 0);
    }

    if (isWieldingWeaponAndShield(mainHand, offHand)) {
        const fs = lvl(SKILL_IDS.FIGHTSTYLE_WEAPON_SHIELD);
        const spec = lvl(SKILL_IDS.SPECIALIZATION_WEAPON_SHIELD);
        stats.attackChance += getPercentage(mainHand.equipEffect?.increaseAttackChance || 0, fs * SKILL_CONSTANTS.FIGHTSTYLE_WEAPON_AC_PERCENT, 0);
        stats.blockChance += getPercentage(offHand.equipEffect?.increaseBlockChance || 0, fs * SKILL_CONSTANTS.FIGHTSTYLE_SHIELD_BC_PERCENT, 0);
        stats.attackChance += getPercentage(mainHand.equipEffect?.increaseAttackChance || 0, spec * SKILL_CONSTANTS.SPECIALIZATION_WEAPON_AC_PERCENT, 0);
        const dmg = mainHand.equipEffect?.increaseAttackDamage || { min: 0, max: 0 };
        stats.damagePotential.max += getPercentage(dmg.max, spec * SKILL_CONSTANTS.SPECIALIZATION_WEAPON_DMG_PERCENT, 0);
        stats.damagePotential.min += getPercentage(dmg.min, spec * SKILL_CONSTANTS.SPECIALIZATION_WEAPON_DMG_PERCENT, 0);
    }

    if (isDualWielding(mainHand, offHand)) {
        applyDualWield(stats, mainHand, offHand, skillLevels);
        const specLevel = lvl(SKILL_IDS.SPECIALIZATION_DUAL_WIELD);
        if (specLevel > 0) {
            stats.attackChance += getPercentage(mainHand.equipEffect?.increaseAttackChance || 0, specLevel * SKILL_CONSTANTS.SPECIALIZATION_DUALWIELD_AC_PERCENT, 0);
            stats.blockChance += getPercentage(mainHand.equipEffect?.increaseBlockChance || 0, specLevel * SKILL_CONSTANTS.SPECIALIZATION_DUALWIELD_BC_PERCENT, 0);
            stats.attackChance += getPercentage(offHand.equipEffect?.increaseAttackChance || 0, specLevel * SKILL_CONSTANTS.SPECIALIZATION_DUALWIELD_AC_PERCENT, 0);
            stats.blockChance += getPercentage(offHand.equipEffect?.increaseBlockChance || 0, specLevel * SKILL_CONSTANTS.SPECIALIZATION_DUALWIELD_BC_PERCENT, 0);
        }
    }
}

// ItemController.java:152-194 order: weapon 100% -> shield 100% (skipped if
// dual-wielding) -> fighting styles -> remaining armor slots 100%.
// Returns the weapon-damage tracker needed by Task 7's non-weapon damage modifier.
export function applyEquipment(stats, equipped, skillLevels) {
    const mainHand = equipped.weapon;
    const offHand = equipped.shield;
    const weaponDamage = { min: 0, max: 0 };

    stats.attackCost = 0;
    if (mainHand?.equipEffect) {
        stats.criticalMultiplier = mainHand.equipEffect.setCriticalMultiplier || stats.criticalMultiplier;
    }
    if (mainHand?.equipEffect) {
        applyAbilityEffects(stats, mainHand.equipEffect, 1);
        if (isWeapon(mainHand) && mainHand.equipEffect.increaseAttackDamage) {
            weaponDamage.min += mainHand.equipEffect.increaseAttackDamage.min || 0;
            weaponDamage.max += mainHand.equipEffect.increaseAttackDamage.max || 0;
        }
    }

    const dualWielding = isDualWielding(mainHand, offHand);
    if (!dualWielding && offHand?.equipEffect) {
        applyAbilityEffects(stats, offHand.equipEffect, 1);
        if (isWeapon(offHand) && offHand.equipEffect.increaseAttackDamage) {
            weaponDamage.min += offHand.equipEffect.increaseAttackDamage.min || 0;
            weaponDamage.max += offHand.equipEffect.increaseAttackDamage.max || 0;
        }
    }

    applyFightingStyles(stats, equipped, skillLevels);

    for (const slot of [...ARMOR_SLOTS, 'neck', 'leftring', 'rightring']) {
        const item = equipped[slot];
        if (item?.equipEffect) applyAbilityEffects(stats, item.equipEffect, 1);
    }

    return weaponDamage;
}
