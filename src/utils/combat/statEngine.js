// Ported from ActorStatsController.java / ItemController.java / SkillController.java.
// See docs/superpowers/specs/2026-07-16-damage-calculator-phase-a-design.md for the
// full pipeline order and rationale.

import { applyLevelUpChoices } from './levelModel';
import { SKILL_IDS, SKILL_CONSTANTS, getProficiencySkillForCategory } from './skillData';
import debug from '../debug';

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
export function buildBaseStats(level, levelUpChoices, fortitudeLevels) {
    const traits = applyLevelUpChoices(level, levelUpChoices, fortitudeLevels);
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

function applyDualWield(stats, mainHand, offHand, skillLevels, weaponDamage) {
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
        const dmgMax = getPercentage(e.increaseAttackDamage.max || 0, percent, 100);
        const dmgMin = getPercentage(e.increaseAttackDamage.min || 0, percent, 100);
        stats.damagePotential.max += dmgMax;
        stats.damagePotential.min += dmgMin;
        weaponDamage.max += dmgMax;
        weaponDamage.min += dmgMin;
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

function applyFightingStyles(stats, equipped, skillLevels, weaponDamage) {
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
        const fsMax = getPercentage(dmg.max, fs * SKILL_CONSTANTS.FIGHTSTYLE_2HAND_DMG_PERCENT, 0);
        const fsMin = getPercentage(dmg.min, fs * SKILL_CONSTANTS.FIGHTSTYLE_2HAND_DMG_PERCENT, 0);
        const specMax = getPercentage(dmg.max, spec * SKILL_CONSTANTS.SPECIALIZATION_2HAND_DMG_PERCENT, 0);
        const specMin = getPercentage(dmg.min, spec * SKILL_CONSTANTS.SPECIALIZATION_2HAND_DMG_PERCENT, 0);
        stats.damagePotential.max += fsMax;
        stats.damagePotential.min += fsMin;
        stats.damagePotential.max += specMax;
        stats.damagePotential.min += specMin;
        weaponDamage.max += fsMax + specMax;
        weaponDamage.min += fsMin + specMin;
        stats.attackChance += getPercentage(mainHand.equipEffect?.increaseAttackChance || 0, spec * SKILL_CONSTANTS.SPECIALIZATION_2HAND_AC_PERCENT, 0);
    }

    if (isWieldingWeaponAndShield(mainHand, offHand)) {
        const fs = lvl(SKILL_IDS.FIGHTSTYLE_WEAPON_SHIELD);
        const spec = lvl(SKILL_IDS.SPECIALIZATION_WEAPON_SHIELD);
        stats.attackChance += getPercentage(mainHand.equipEffect?.increaseAttackChance || 0, fs * SKILL_CONSTANTS.FIGHTSTYLE_WEAPON_AC_PERCENT, 0);
        stats.blockChance += getPercentage(offHand.equipEffect?.increaseBlockChance || 0, fs * SKILL_CONSTANTS.FIGHTSTYLE_SHIELD_BC_PERCENT, 0);
        stats.attackChance += getPercentage(mainHand.equipEffect?.increaseAttackChance || 0, spec * SKILL_CONSTANTS.SPECIALIZATION_WEAPON_AC_PERCENT, 0);
        const dmg = mainHand.equipEffect?.increaseAttackDamage || { min: 0, max: 0 };
        const specMax = getPercentage(dmg.max, spec * SKILL_CONSTANTS.SPECIALIZATION_WEAPON_DMG_PERCENT, 0);
        const specMin = getPercentage(dmg.min, spec * SKILL_CONSTANTS.SPECIALIZATION_WEAPON_DMG_PERCENT, 0);
        stats.damagePotential.max += specMax;
        stats.damagePotential.min += specMin;
        weaponDamage.max += specMax;
        weaponDamage.min += specMin;
    }

    if (isDualWielding(mainHand, offHand)) {
        applyDualWield(stats, mainHand, offHand, skillLevels, weaponDamage);
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

    // ItemController.getMainWeapon(): falls back to the shield slot only if it
    // holds a weapon (dual-wield). attackCost is only reset when a weapon is
    // actually wielded - unarmed builds keep the base-trait attackCost (fists),
    // otherwise getAttacksPerTurn() would divide by zero.
    const hasMainWeapon = isWeapon(mainHand) || isWeapon(offHand);
    if (hasMainWeapon) {
        stats.attackCost = 0;
    }
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

    applyFightingStyles(stats, equipped, skillLevels, weaponDamage);

    for (const slot of [...ARMOR_SLOTS, 'neck', 'leftring', 'rightring']) {
        const item = equipped[slot];
        if (item?.equipEffect) applyAbilityEffects(stats, item.equipEffect, 1);
    }

    return weaponDamage;
}

// --- Item proficiencies + general combat skills ---

// SkillController.java:204-260 (applySkillEffectsFromItemProficiencies).
export function applyItemProficiencies(stats, equipped, skillLevels) {
    const lvl = (id) => skillLevels[id] || 0;
    const mainWeapon = equipped.weapon;

    if (mainWeapon?.equipEffect) {
        const skill = getProficiencySkillForCategory(mainWeapon.categoryLink);
        const level = skill ? lvl(skill) : 0;
        if (level > 0) {
            stats.attackChance += getPercentage(mainWeapon.equipEffect.increaseAttackChance || 0, SKILL_CONSTANTS.WEAPON_PROF_AC_PERCENT * level, 0);
            stats.blockChance += getPercentage(mainWeapon.equipEffect.increaseBlockChance || 0, SKILL_CONSTANTS.WEAPON_PROF_BC_PERCENT * level, 0);
            stats.criticalSkill += getPercentage(mainWeapon.equipEffect.increaseCriticalSkill || 0, SKILL_CONSTANTS.WEAPON_PROF_CS_PERCENT * level, 0);
        }
    }

    const unarmedLevel = lvl(SKILL_IDS.WEAPON_PROF_UNARMED);
    if (unarmedLevel > 0 && isUnarmed(equipped)) {
        stats.attackChance += SKILL_CONSTANTS.UNARMED_AC * unarmedLevel;
        stats.damagePotential.max += SKILL_CONSTANTS.UNARMED_DMG * unarmedLevel;
        stats.damagePotential.min += SKILL_CONSTANTS.UNARMED_DMG * unarmedLevel;
        stats.blockChance += SKILL_CONSTANTS.UNARMED_BC * unarmedLevel;
    }

    const shield = equipped.shield;
    if (isShield(shield)) {
        const skill = getProficiencySkillForCategory(shield.categoryLink);
        const level = skill ? lvl(skill) : 0;
        stats.damageResistance += SKILL_CONSTANTS.SHIELD_PROF_DR * level;
    }

    const unarmoredLevel = lvl(SKILL_IDS.ARMOR_PROF_UNARMORED);
    if (unarmoredLevel > 0 && isUnarmored(equipped)) {
        stats.blockChance += SKILL_CONSTANTS.UNARMORED_BC * unarmoredLevel;
    }

    const lightLevel = lvl(SKILL_IDS.ARMOR_PROF_LIGHT);
    const heavyLevel = lvl(SKILL_IDS.ARMOR_PROF_HEAVY);
    for (const slot of ARMOR_SLOTS) {
        const item = equipped[slot];
        if (!item?.equipEffect) continue;
        const skill = getProficiencySkillForCategory(item.categoryLink);
        if (skill === SKILL_IDS.ARMOR_PROF_LIGHT && lightLevel > 0) {
            stats.blockChance += getPercentage(item.equipEffect.increaseBlockChance || 0, SKILL_CONSTANTS.LIGHT_ARMOR_BC_PERCENT * lightLevel, 0);
        } else if (skill === SKILL_IDS.ARMOR_PROF_HEAVY && heavyLevel > 0) {
            stats.blockChance += getPercentage(item.equipEffect.increaseBlockChance || 0, SKILL_CONSTANTS.HEAVY_ARMOR_BC_PERCENT * heavyLevel, 0);
            stats.moveCost -= getPercentage(item.equipEffect.increaseMoveCost || 0, SKILL_CONSTANTS.HEAVY_ARMOR_MOVECOST_PERCENT * heavyLevel, 0);
            stats.attackCost -= getPercentage(item.equipEffect.increaseAttackCost || 0, SKILL_CONSTANTS.HEAVY_ARMOR_ATKCOST_PERCENT * heavyLevel, 0);
            stats.useItemCost -= getPercentage(item.equipEffect.increaseUseItemCost || 0, SKILL_CONSTANTS.HEAVY_ARMOR_USECOST_PERCENT * heavyLevel, 0);
        }
    }
}

// SkillController.java:34-59 (applySkillEffects) - general combat skills that
// apply unconditionally, regardless of what's equipped.
export function applyGeneralCombatSkills(stats, skillLevels) {
    const lvl = (id) => skillLevels[id] || 0;

    stats.attackChance += SKILL_CONSTANTS.WEAPON_CHANCE * lvl(SKILL_IDS.WEAPON_CHANCE);
    stats.damagePotential.max += SKILL_CONSTANTS.WEAPON_DAMAGE_MAX * lvl(SKILL_IDS.WEAPON_DMG);
    stats.damagePotential.min += SKILL_CONSTANTS.WEAPON_DAMAGE_MIN * lvl(SKILL_IDS.WEAPON_DMG);
    stats.blockChance += SKILL_CONSTANTS.DODGE * lvl(SKILL_IDS.DODGE);
    stats.damageResistance += SKILL_CONSTANTS.BARKSKIN * lvl(SKILL_IDS.BARK_SKIN);

    if (stats.criticalSkill > 0 && lvl(SKILL_IDS.MORE_CRITICALS) > 0) {
        stats.criticalSkill += (stats.criticalSkill * SKILL_CONSTANTS.MORE_CRITICALS_PERCENT * lvl(SKILL_IDS.MORE_CRITICALS)) / 100;
    }
    if (stats.criticalMultiplier !== 0 && stats.criticalMultiplier !== 1 && lvl(SKILL_IDS.BETTER_CRITICALS) > 0) {
        stats.criticalMultiplier += (stats.criticalMultiplier * SKILL_CONSTANTS.BETTER_CRITICALS_PERCENT * lvl(SKILL_IDS.BETTER_CRITICALS)) / 100;
    }
    stats.maxAP += SKILL_CONSTANTS.SPEED * lvl(SKILL_IDS.SPEED);
}

// --- Active conditions, damage modifier, final assembly ---

// ActorStatsController.java:248-252 (applyEffectsFromCurrentConditions).
export function applyActiveConditions(stats, activeConditions, conditionsById) {
    for (const { conditionId, magnitude } of activeConditions || []) {
        const condition = conditionsById[conditionId];
        if (!condition) {
            debug(`Damage calculator: unknown condition id '${conditionId}' in build`);
            continue;
        }
        if (condition.abilityEffect) {
            applyAbilityEffects(stats, condition.abilityEffect, magnitude);
        }
    }
}

// ItemController.java:439-467 (applyDamageModifier). Rescales the *non-weapon*
// portion of damage potential (i.e. everything except the main/off-hand weapon's
// own increaseAttackDamage contribution, tracked in `weaponDamage`) by a weapon's
// setNonWeaponDamageModifier percent.
export function applyNonWeaponDamageModifier(stats, equipped, weaponDamage, skillLevels) {
    const mainWeapon = equipped.weapon;
    const offWeapon = isWeapon(equipped.shield) ? equipped.shield : null;

    let modifier1 = -1;
    let modifier2 = -1;
    if (mainWeapon?.equipEffect?.setNonWeaponDamageModifier != null) {
        modifier1 = mainWeapon.equipEffect.setNonWeaponDamageModifier;
    }
    if (offWeapon?.equipEffect?.setNonWeaponDamageModifier != null) {
        modifier2 = offWeapon.equipEffect.setNonWeaponDamageModifier;
    }

    let modifier = 100;
    if (modifier1 >= 0 && modifier2 >= 0) {
        const fsLevel = skillLevels[SKILL_IDS.FIGHTSTYLE_DUAL_WIELD] || 0;
        if (fsLevel === 2) modifier = Math.max(modifier1, modifier2);
        else if (fsLevel === 1) modifier = Math.floor((modifier1 + modifier2) / 2);
        else modifier = Math.min(modifier1, modifier2);
    } else if (modifier1 <= 0 && modifier2 >= 0) {
        modifier = modifier2;
    } else if (modifier2 <= 0 && modifier1 >= 0) {
        modifier = modifier1;
    }

    if (modifier !== 100) {
        const minBaseDamage = stats.damagePotential.min - weaponDamage.min;
        const maxBaseDamage = stats.damagePotential.max - weaponDamage.max;
        stats.damagePotential.min += Math.round(minBaseDamage * ((modifier - 100) / 100));
        stats.damagePotential.max += Math.round(maxBaseDamage * ((modifier - 100) / 100));
    }
}

// Full player pipeline, ActorStatsController.recalculatePlayerStats (:275-296) order:
// base traits -> equipment (incl. fighting styles/dual-wield) -> item proficiencies
// -> general combat skills -> active conditions -> non-weapon damage modifier -> clamp.
export function resolvePlayerStats(build, { itemsById, conditionsById }) {
    const stats = buildBaseStats(build.level, build.levelUpChoices, build.fortitudeLevels || []);

    const equipped = {};
    for (const slot of EQUIP_SLOTS) {
        const itemId = build.equipment[slot];
        if (!itemId) {
            equipped[slot] = null;
            continue;
        }
        const item = itemsById[itemId];
        if (!item) {
            debug(`Damage calculator: unknown item id '${itemId}' in build (slot ${slot})`);
        }
        equipped[slot] = item || null;
    }

    const weaponDamage = applyEquipment(stats, equipped, build.skillLevels);
    applyItemProficiencies(stats, equipped, build.skillLevels);
    applyGeneralCombatSkills(stats, build.skillLevels);
    applyActiveConditions(stats, build.activeConditions, conditionsById);
    applyNonWeaponDamageModifier(stats, equipped, weaponDamage, build.skillLevels);
    clampStats(stats);

    return stats;
}

// Monsters never equip/level/skill - just static JSON fields plus conditions.
// Monster.resetStatsToBaseTraits (Monster.java:50-66).
export function resolveMonsterStats(monster, activeConditions, conditionsById) {
    const stats = {
        attackCost: monster.attackCost,
        attackChance: monster.attackChance,
        criticalSkill: monster.criticalSkill || 0,
        criticalMultiplier: monster.criticalMultiplier || 0,
        damagePotential: { min: monster.attackDamage?.min || 0, max: monster.attackDamage?.max || 0 },
        blockChance: monster.blockChance || 0,
        damageResistance: monster.damageResistance || 0,
        maxHP: monster.maxHP,
        maxAP: monster.maxAP,
        isImmuneToCriticalHits: !!monster.isImmuneToCriticalHits,
    };
    applyActiveConditions(stats, activeConditions, conditionsById);
    clampStats(stats);
    return stats;
}
