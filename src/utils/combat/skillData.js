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
};
