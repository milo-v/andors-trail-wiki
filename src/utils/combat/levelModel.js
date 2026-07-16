// Level-1 base traits, from Player.java:106-120 (initializeNewPlayer).
export const BASE_TRAITS_LEVEL1 = {
    maxAP: 10,
    maxHP: 25,
    moveCost: 6,
    attackCost: 4,
    attackChance: 60,
    criticalSkill: 0,
    criticalMultiplier: 1,
    damagePotential: { min: 1, max: 1 },
    blockChance: 9,
    damageResistance: 0,
    useItemCost: 5,
    reequipCost: 5,
};

// Per-level-up bonus amounts, from Constants.java:
// LEVELUP_EFFECT_HEALTH/ATK_CH/ATK_DMG/DEF_CH.
export const LEVELUP_EFFECT = {
    health: 5,
    attackChance: 5,
    attackDamage: 1,
    blockChance: 3,
};

// Constants.java: FIRST_SKILL_POINT_IS_GIVEN_AT_LEVEL / NEW_SKILL_POINT_EVERY_N_LEVELS.
const FIRST_SKILL_POINT_LEVEL = 4;
const NEW_SKILL_POINT_EVERY_N_LEVELS = 4;

// Fortitude skill's per-level-up HP bonus, SkillCollection.PER_SKILLPOINT_INCREASE_FORTITUDE_HEALTH.
const PER_SKILLPOINT_INCREASE_FORTITUDE_HEALTH = 1;

export function getSkillPointBudget(level) {
    if (level < FIRST_SKILL_POINT_LEVEL) return 0;
    return Math.floor((level - FIRST_SKILL_POINT_LEVEL) / NEW_SKILL_POINT_EVERY_N_LEVELS) + 1;
}

// Player.java:182-197 - XP required to reach `level` (cumulative), 55*L^2 per level step.
export function getRequiredExperienceForNextLevel(level) {
    return 55 * level * level;
}
export function getRequiredExperience(level) {
    let total = 0;
    for (let i = 1; i < level; i++) total += getRequiredExperienceForNextLevel(i);
    return total;
}

// Builds level-1 base traits, then applies `(level - 1)` user-chosen level-up
// bonuses plus the fortitude skill's retroactive HP bonus.
//
// Simplification (documented in the design spec): the real game applies the
// fortitude bonus incrementally at each level-up event using whatever fortitude
// skill level was active *then*. Here we assume the final chosen fortitude level
// was active for every level-up, which is the natural reading of "build a
// level-N character with these skills."
export function applyLevelUpChoices(level, levelUpChoices, fortitudeSkillLevel) {
    const numChoices = level - 1;
    const chosen =
        (levelUpChoices.health || 0) +
        (levelUpChoices.attackChance || 0) +
        (levelUpChoices.attackDamage || 0) +
        (levelUpChoices.blockChance || 0);
    if (chosen !== numChoices) {
        throw new Error(`levelUpChoices must sum to ${numChoices} (level ${level} - 1), got ${chosen}`);
    }

    const traits = {
        ...BASE_TRAITS_LEVEL1,
        damagePotential: { ...BASE_TRAITS_LEVEL1.damagePotential },
    };

    traits.maxHP += (levelUpChoices.health || 0) * LEVELUP_EFFECT.health;
    traits.attackChance += (levelUpChoices.attackChance || 0) * LEVELUP_EFFECT.attackChance;
    traits.damagePotential.min += (levelUpChoices.attackDamage || 0) * LEVELUP_EFFECT.attackDamage;
    traits.damagePotential.max += (levelUpChoices.attackDamage || 0) * LEVELUP_EFFECT.attackDamage;
    traits.blockChance += (levelUpChoices.blockChance || 0) * LEVELUP_EFFECT.blockChance;
    traits.maxHP += (fortitudeSkillLevel || 0) * PER_SKILLPOINT_INCREASE_FORTITUDE_HEALTH * numChoices;

    return traits;
}
