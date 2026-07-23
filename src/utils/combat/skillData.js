// Hand-transcribed from SkillCollection.java / SkillController.java. This data
// does not exist anywhere else in this repo: the wiki's parsed JSON only has
// skill names/descriptions (public/values/strings.xml); all mechanics are Java
// constants in the game source.

export const SKILL_IDS = {
    WEAPON_CHANCE: 'weaponChance',
    WEAPON_DMG: 'weaponDmg',
    DODGE: 'dodge',
    BARK_SKIN: 'barkSkin',
    MORE_CRITICALS: 'moreCriticals',
    BETTER_CRITICALS: 'betterCriticals',
    SPEED: 'speed',
    FORTITUDE: 'fortitude',
    EATER: 'eater',
    CLEAVE: 'cleave',

    WEAPON_PROF_DAGGER: 'weaponProficiencyDagger',
    WEAPON_PROF_1HSWORD: 'weaponProficiency1hsword',
    WEAPON_PROF_2HSWORD: 'weaponProficiency2hsword',
    WEAPON_PROF_AXE: 'weaponProficiencyAxe',
    WEAPON_PROF_BLUNT: 'weaponProficiencyBlunt',
    WEAPON_PROF_POLE: 'weaponProficiencyPole',
    WEAPON_PROF_UNARMED: 'weaponProficiencyUnarmed',

    ARMOR_PROF_SHIELD: 'armorProficiencyShield',
    ARMOR_PROF_LIGHT: 'armorProficiencyLight',
    ARMOR_PROF_HEAVY: 'armorProficiencyHeavy',
    ARMOR_PROF_UNARMORED: 'armorProficiencyUnarmored',

    FIGHTSTYLE_UNARMED_UNARMORED: 'fightstyleUnarmedUnarmored',
    FIGHTSTYLE_2HAND: 'fightstyle2hand',
    FIGHTSTYLE_WEAPON_SHIELD: 'fightstyleWeaponShield',
    FIGHTSTYLE_DUAL_WIELD: 'fightstyleDualWield',
    SPECIALIZATION_2HAND: 'specialization2hand',
    SPECIALIZATION_WEAPON_SHIELD: 'specializationWeaponShield',
    SPECIALIZATION_DUAL_WIELD: 'specializationDualWield',

    // General combat skills that act as chance-based procs on a hit/miss/crit
    // outcome (SkillController.applySkillEffectsFromPlayerAttack/
    // applySkillEffectsFromMonsterAttack) rather than a flat stat modifier -
    // see procEffects.js for how these get folded into combat math.
    CRIT1: 'crit1',
    CRIT2: 'crit2',
    TAUNT: 'taunt',
    CONCUSSION: 'concussion',
    // Evasion has no combat-turn effect at all (SkillCollection.java: it only
    // scales flee chance and out-of-combat monster-aggression chance) - it
    // exists here purely because Taunt's real level-up requirement gates on
    // it, so leaving it out would let the calculator allow allocating Taunt
    // when the real game wouldn't.
    EVASION: 'evasion',
};

// Per-skillpoint constants, from SkillCollection.java.
export const SKILL_CONSTANTS = {
    WEAPON_CHANCE: 12,
    WEAPON_DAMAGE_MAX: 2,
    WEAPON_DAMAGE_MIN: 0,
    DODGE: 9,
    BARKSKIN: 1,
    MORE_CRITICALS_PERCENT: 20,
    BETTER_CRITICALS_PERCENT: 25,
    SPEED: 1,
    FORTITUDE_HEALTH: 1,
    EATER_HEALTH: 1,
    CLEAVE_AP: 3,

    WEAPON_PROF_AC_PERCENT: 30,
    WEAPON_PROF_BC_PERCENT: 30,
    WEAPON_PROF_CS_PERCENT: 10,
    UNARMED_AC: 20,
    UNARMED_DMG: 2,
    UNARMED_BC: 5,
    SHIELD_PROF_DR: 1,
    UNARMORED_BC: 10,
    LIGHT_ARMOR_BC_PERCENT: 30,
    HEAVY_ARMOR_BC_PERCENT: 20,
    HEAVY_ARMOR_MOVECOST_PERCENT: 25,
    HEAVY_ARMOR_ATKCOST_PERCENT: 25,
    HEAVY_ARMOR_USECOST_PERCENT: 25,

    UNARMED_UNARMORED_BC: 5,
    UNARMED_UNARMORED_DR: 1,
    UNARMED_UNARMORED_AC: 12,
    UNARMED_UNARMORED_DMG_MAX: 4,
    UNARMED_UNARMORED_CM_PERCENT: 25,

    FIGHTSTYLE_2HAND_DMG_PERCENT: 30,
    SPECIALIZATION_2HAND_DMG_PERCENT: 50,
    SPECIALIZATION_2HAND_AC_PERCENT: 20,

    FIGHTSTYLE_WEAPON_AC_PERCENT: 25,
    FIGHTSTYLE_SHIELD_BC_PERCENT: 25,
    SPECIALIZATION_WEAPON_AC_PERCENT: 50,
    SPECIALIZATION_WEAPON_DMG_PERCENT: 20,

    DUALWIELD_EFFICIENCY_LEVEL0: 25,
    DUALWIELD_EFFICIENCY_LEVEL1: 50,
    DUALWIELD_EFFICIENCY_LEVEL2: 100,
    DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT: 50,
    SPECIALIZATION_DUALWIELD_AC_PERCENT: 50,
    SPECIALIZATION_DUALWIELD_BC_PERCENT: 50,

    // Chance-based general combat skills (SkillController.java:173-202). Each
    // fires on a specific attack outcome; magnitude/duration for the
    // conditions they grant are fixed constants in the game source (not read
    // from item/condition JSON like equipment procs are).
    CRIT1_CHANCE_PERCENT: 50,
    CRIT2_CHANCE_PERCENT: 50,
    CRIT_CONDITION_MAGNITUDE: 1,
    CRIT_CONDITION_DURATION: 5,
    TAUNT_CHANCE_PERCENT: 75,
    TAUNT_AP_LOSS: 2,
    CONCUSSION_CHANCE_PERCENT: 15,
    CONCUSSION_THRESHOLD: 50,
    CONCUSSION_CONDITION_MAGNITUDE: 1,
    CONCUSSION_CONDITION_DURATION: 5,
};

// Weapon item-category id -> weapon proficiency skill, from
// SkillController.java:287-312 (getProficiencySkillForItemCategory).
export const WEAPON_CATEGORY_TO_PROFICIENCY = {
    dagger: SKILL_IDS.WEAPON_PROF_DAGGER,
    ssword: SKILL_IDS.WEAPON_PROF_DAGGER,
    rapier: SKILL_IDS.WEAPON_PROF_1HSWORD,
    lsword: SKILL_IDS.WEAPON_PROF_1HSWORD,
    bsword: SKILL_IDS.WEAPON_PROF_1HSWORD,
    '2hsword': SKILL_IDS.WEAPON_PROF_2HSWORD,
    axe: SKILL_IDS.WEAPON_PROF_AXE,
    axe2h: SKILL_IDS.WEAPON_PROF_AXE,
    club: SKILL_IDS.WEAPON_PROF_BLUNT,
    staff: SKILL_IDS.WEAPON_PROF_BLUNT,
    mace: SKILL_IDS.WEAPON_PROF_BLUNT,
    scepter: SKILL_IDS.WEAPON_PROF_BLUNT,
    hammer: SKILL_IDS.WEAPON_PROF_BLUNT,
    hammer2h: SKILL_IDS.WEAPON_PROF_BLUNT,
    whip: SKILL_IDS.WEAPON_PROF_BLUNT,
    pole: SKILL_IDS.WEAPON_PROF_POLE,
};

// Maps an equipped item's categoryLink (as populated by Main.jsx's linkTemp())
// to the proficiency skill it trains, or null if none applies.
// From SkillController.java:287-312.
export function getProficiencySkillForCategory(categoryLink) {
    if (!categoryLink) return null;
    if (categoryLink.inventorySlot === 'weapon') {
        return WEAPON_CATEGORY_TO_PROFICIENCY[categoryLink.id] || null;
    }
    if (categoryLink.inventorySlot === 'shield') {
        return SKILL_IDS.ARMOR_PROF_SHIELD;
    }
    if (['head', 'body', 'hand', 'feet'].includes(categoryLink.inventorySlot)) {
        if (categoryLink.size === 'light' || categoryLink.size === 'std') return SKILL_IDS.ARMOR_PROF_LIGHT;
        if (categoryLink.size === 'large') return SKILL_IDS.ARMOR_PROF_HEAVY;
    }
    return null;
}

// Category groupings + max skill level per skill, for UI display. Not needed by
// the combat math itself (statEngine.js only reads skill *levels*, never caps
// them) — this is Phase B's data, transcribed here since skillData.js is already
// this repo's designated home for hand-transcribed skill data.
// Max levels from SkillCollection.java:151-243 (initializeSkill calls);
// MAXLEVEL_NONE (-1) -> null (no cap beyond the skill point budget).
// Display names from public/values/strings.xml's skill_title_* keys.
export const SKILL_CATEGORY = {
    GENERAL: 'general',
    WEAPON_PROFICIENCY: 'weaponProficiency',
    ARMOR_PROFICIENCY: 'armorProficiency',
    FIGHTSTYLE: 'fightstyle',
};

export const SKILL_META = {
    [SKILL_IDS.WEAPON_CHANCE]: { category: SKILL_CATEGORY.GENERAL, maxLevel: null, name: 'Weapon Accuracy' },
    [SKILL_IDS.WEAPON_DMG]: { category: SKILL_CATEGORY.GENERAL, maxLevel: null, name: 'Hard Hit' },
    [SKILL_IDS.DODGE]: { category: SKILL_CATEGORY.GENERAL, maxLevel: null, name: 'Dodge' },
    [SKILL_IDS.BARK_SKIN]: { category: SKILL_CATEGORY.GENERAL, maxLevel: 5, name: 'Bark Skin' },
    [SKILL_IDS.MORE_CRITICALS]: { category: SKILL_CATEGORY.GENERAL, maxLevel: null, name: 'More Criticals' },
    [SKILL_IDS.BETTER_CRITICALS]: { category: SKILL_CATEGORY.GENERAL, maxLevel: null, name: 'Better Criticals' },
    [SKILL_IDS.SPEED]: { category: SKILL_CATEGORY.GENERAL, maxLevel: 2, name: 'Combat Speed' },
    [SKILL_IDS.FORTITUDE]: { category: SKILL_CATEGORY.GENERAL, maxLevel: null, name: 'Increased Fortitude' },
    [SKILL_IDS.EATER]: { category: SKILL_CATEGORY.GENERAL, maxLevel: null, name: 'Corpse Eater' },
    [SKILL_IDS.CLEAVE]: { category: SKILL_CATEGORY.GENERAL, maxLevel: null, name: 'Cleave' },

    [SKILL_IDS.WEAPON_PROF_DAGGER]: { category: SKILL_CATEGORY.WEAPON_PROFICIENCY, maxLevel: 3, name: 'Dagger proficiency' },
    [SKILL_IDS.WEAPON_PROF_1HSWORD]: { category: SKILL_CATEGORY.WEAPON_PROFICIENCY, maxLevel: 3, name: 'One-handed sword proficiency' },
    [SKILL_IDS.WEAPON_PROF_2HSWORD]: { category: SKILL_CATEGORY.WEAPON_PROFICIENCY, maxLevel: 3, name: 'Two-handed sword proficiency' },
    [SKILL_IDS.WEAPON_PROF_AXE]: { category: SKILL_CATEGORY.WEAPON_PROFICIENCY, maxLevel: 3, name: 'Axe proficiency' },
    [SKILL_IDS.WEAPON_PROF_BLUNT]: { category: SKILL_CATEGORY.WEAPON_PROFICIENCY, maxLevel: 3, name: 'Blunt weapon proficiency' },
    [SKILL_IDS.WEAPON_PROF_POLE]: { category: SKILL_CATEGORY.WEAPON_PROFICIENCY, maxLevel: 3, name: 'Pole weapon proficiency' },
    [SKILL_IDS.WEAPON_PROF_UNARMED]: { category: SKILL_CATEGORY.WEAPON_PROFICIENCY, maxLevel: 3, name: 'Unarmed fighting' },

    [SKILL_IDS.ARMOR_PROF_SHIELD]: { category: SKILL_CATEGORY.ARMOR_PROFICIENCY, maxLevel: 2, name: 'Shield proficiency' },
    [SKILL_IDS.ARMOR_PROF_LIGHT]: { category: SKILL_CATEGORY.ARMOR_PROFICIENCY, maxLevel: 3, name: 'Light armor proficiency' },
    [SKILL_IDS.ARMOR_PROF_HEAVY]: { category: SKILL_CATEGORY.ARMOR_PROFICIENCY, maxLevel: 4, name: 'Heavy armor proficiency' },
    [SKILL_IDS.ARMOR_PROF_UNARMORED]: { category: SKILL_CATEGORY.ARMOR_PROFICIENCY, maxLevel: 3, name: 'Unarmored fighting' },

    [SKILL_IDS.FIGHTSTYLE_UNARMED_UNARMORED]: { category: SKILL_CATEGORY.FIGHTSTYLE, maxLevel: 3, name: 'Fighting style: Way of the monk' },
    [SKILL_IDS.FIGHTSTYLE_2HAND]: { category: SKILL_CATEGORY.FIGHTSTYLE, maxLevel: 2, name: 'Fighting style: Two-handed weapon' },
    [SKILL_IDS.FIGHTSTYLE_WEAPON_SHIELD]: { category: SKILL_CATEGORY.FIGHTSTYLE, maxLevel: 2, name: 'Fighting style: Weapon and shield' },
    [SKILL_IDS.FIGHTSTYLE_DUAL_WIELD]: { category: SKILL_CATEGORY.FIGHTSTYLE, maxLevel: 2, name: 'Fighting style: Dual wield' },
    [SKILL_IDS.SPECIALIZATION_2HAND]: { category: SKILL_CATEGORY.FIGHTSTYLE, maxLevel: 1, name: 'Specialization: Two-handed weapon' },
    [SKILL_IDS.SPECIALIZATION_WEAPON_SHIELD]: { category: SKILL_CATEGORY.FIGHTSTYLE, maxLevel: 1, name: 'Specialization: Weapon and shield' },
    [SKILL_IDS.SPECIALIZATION_DUAL_WIELD]: { category: SKILL_CATEGORY.FIGHTSTYLE, maxLevel: 1, name: 'Specialization: Dual wield' },

    [SKILL_IDS.CRIT1]: { category: SKILL_CATEGORY.GENERAL, maxLevel: 1, name: 'Critical hit I' },
    [SKILL_IDS.CRIT2]: { category: SKILL_CATEGORY.GENERAL, maxLevel: 1, name: 'Critical hit II' },
    [SKILL_IDS.TAUNT]: { category: SKILL_CATEGORY.GENERAL, maxLevel: 1, name: 'Taunt' },
    [SKILL_IDS.CONCUSSION]: { category: SKILL_CATEGORY.GENERAL, maxLevel: 1, name: 'Concussion' },
    [SKILL_IDS.EVASION]: { category: SKILL_CATEGORY.GENERAL, maxLevel: 4, name: 'Evasion' },
};

// Level-gating requirements, ported from SkillCollection.java:initialize()'s
// SkillLevelRequirement arrays. Fortitude is handled separately (its HP bonus is
// acquisition-order-dependent - see buildHelpers.js's fortitude helpers and
// levelModel.js's applyLevelUpChoices) and has no entry here. Weapon/armor
// proficiencies only have the quest-gated-first-level rule (already handled in
// buildHelpers.js's getSkillPointsSpent) and have no other levelupRequirements in
// the game source.
export const LEVELUP_REQUIREMENTS = {
    [SKILL_IDS.BARK_SKIN]: [
        { type: 'experienceLevel', every: 10, initial: 0 },
        { type: 'stat', stat: 'blockChance', every: 15, initial: 0 },
    ],
    [SKILL_IDS.BETTER_CRITICALS]: [
        { type: 'otherSkill', skillId: SKILL_IDS.MORE_CRITICALS, every: 1, initial: 0 },
    ],
    [SKILL_IDS.SPEED]: [
        { type: 'experienceLevel', every: 15, initial: 0 },
    ],
    [SKILL_IDS.EATER]: [
        { type: 'stat', stat: 'maxHP', every: 20, initial: 20 },
    ],
    [SKILL_IDS.CLEAVE]: [
        { type: 'otherSkill', skillId: SKILL_IDS.WEAPON_CHANCE, every: 1, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.WEAPON_DMG, every: 1, initial: 0 },
    ],
    [SKILL_IDS.FIGHTSTYLE_DUAL_WIELD]: [{ type: 'experienceLevel', every: 15, initial: 0 }],
    [SKILL_IDS.FIGHTSTYLE_2HAND]: [{ type: 'experienceLevel', every: 15, initial: 0 }],
    [SKILL_IDS.FIGHTSTYLE_WEAPON_SHIELD]: [{ type: 'experienceLevel', every: 15, initial: 0 }],
    [SKILL_IDS.FIGHTSTYLE_UNARMED_UNARMORED]: [{ type: 'experienceLevel', every: 15, initial: 0 }],
    [SKILL_IDS.SPECIALIZATION_DUAL_WIELD]: [
        { type: 'experienceLevel', every: 45, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.FIGHTSTYLE_DUAL_WIELD, every: 2, initial: 0 },
    ],
    [SKILL_IDS.SPECIALIZATION_2HAND]: [
        { type: 'experienceLevel', every: 45, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.FIGHTSTYLE_2HAND, every: 2, initial: 0 },
    ],
    [SKILL_IDS.SPECIALIZATION_WEAPON_SHIELD]: [
        { type: 'experienceLevel', every: 45, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.FIGHTSTYLE_WEAPON_SHIELD, every: 2, initial: 0 },
    ],
    [SKILL_IDS.CRIT1]: [
        { type: 'otherSkill', skillId: SKILL_IDS.MORE_CRITICALS, every: 2, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.BETTER_CRITICALS, every: 2, initial: 0 },
    ],
    [SKILL_IDS.CRIT2]: [
        { type: 'otherSkill', skillId: SKILL_IDS.MORE_CRITICALS, every: 4, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.BETTER_CRITICALS, every: 4, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.CRIT1, every: 1, initial: 0 },
    ],
    [SKILL_IDS.TAUNT]: [
        { type: 'otherSkill', skillId: SKILL_IDS.EVASION, every: 2, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.DODGE, every: 4, initial: 0 },
    ],
    [SKILL_IDS.CONCUSSION]: [
        { type: 'otherSkill', skillId: SKILL_IDS.SPEED, every: 2, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.WEAPON_CHANCE, every: 3, initial: 0 },
        { type: 'otherSkill', skillId: SKILL_IDS.WEAPON_DMG, every: 5, initial: 0 },
    ],
};

// Ported from SkillInfo.canLevelUpSkillTo / SkillLevelRequirement.isSatisfiedByPlayer.
// resolvedStats may be null while the build's level-up choices aren't fully
// allocated yet (resolvePlayerStats throws until levelUpChoices sums correctly) -
// 'stat' requirements are treated as satisfied in that case, since they can't be
// evaluated yet; 'experienceLevel'/'otherSkill' checks don't need resolvedStats and
// are always evaluated.
export function canLevelUpSkillTo(skillId, requestedLevel, { level, skillLevels, resolvedStats }) {
    const requirements = LEVELUP_REQUIREMENTS[skillId];
    if (!requirements) return true;

    return requirements.every(req => {
        const requiredValue = requestedLevel * req.every + req.initial;
        if (req.type === 'experienceLevel') return level >= requiredValue;
        if (req.type === 'otherSkill') return (skillLevels[req.skillId] || 0) >= requiredValue;
        if (req.type === 'stat') {
            if (!resolvedStats) return true;
            return resolvedStats[req.stat] >= requiredValue;
        }
        return true;
    });
}

const STAT_REQUIREMENT_LABELS = { maxHP: 'Max HP', blockChance: 'Block Chance' };

// Human-readable description of the first unmet requirement, for a disabled "+"
// button's title attribute. Returns null if the level-up is allowed.
export function describeUnmetRequirement(skillId, requestedLevel, ctx) {
    const requirements = LEVELUP_REQUIREMENTS[skillId];
    if (!requirements) return null;
    for (const req of requirements) {
        const requiredValue = requestedLevel * req.every + req.initial;
        if (req.type === 'experienceLevel' && ctx.level < requiredValue) {
            return `Requires character level ${requiredValue}`;
        }
        if (req.type === 'otherSkill' && (ctx.skillLevels[req.skillId] || 0) < requiredValue) {
            return `Requires ${SKILL_META[req.skillId].name} level ${requiredValue}`;
        }
        if (req.type === 'stat' && ctx.resolvedStats && ctx.resolvedStats[req.stat] < requiredValue) {
            return `Requires ${STAT_REQUIREMENT_LABELS[req.stat] || req.stat} of ${requiredValue}`;
        }
    }
    return null;
}
