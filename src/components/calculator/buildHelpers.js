import { EQUIP_SLOTS } from '../../utils/combat/statEngine';
import { getSkillPointBudget } from '../../utils/combat/levelModel';
import { SKILL_IDS, SKILL_META, SKILL_CATEGORY } from '../../utils/combat/skillData';

// Weapon/armor proficiency skills are SkillInfo.LevelUpType.firstLevelRequiresQuest
// in the game (SkillCollection.java): level 1 is granted by a quest, not bought
// with skill points - only levels beyond 1 cost a point
// (SkillController.canLevelupSkillManually requires player.hasSkill(id) already).
function isFreeFirstLevelSkill(skillId) {
    const category = SKILL_META[skillId]?.category;
    return category === SKILL_CATEGORY.WEAPON_PROFICIENCY || category === SKILL_CATEGORY.ARMOR_PROFICIENCY;
}

export function createEmptyBuild() {
    const equipment = {};
    for (const slot of EQUIP_SLOTS) equipment[slot] = null;
    return {
        level: 1,
        levelUpChoices: { health: 0, attackChance: 0, attackDamage: 0, blockChance: 0 },
        skillLevels: {},
        fortitudeLevels: [],
        equipment,
        activeConditions: [],
    };
}

// Offhand-weapon eligibility (light/std size only) is a UI-only restriction in the
// real game (equip-menu, not the stat math) -- statEngine.js doesn't enforce it, so
// this picker filter implements it directly to match the game's actual UI behavior.
export function getItemsForSlot(slot, items) {
    if (slot === 'weapon') {
        return items.filter(item => item.categoryLink?.inventorySlot === 'weapon');
    }
    if (slot === 'shield') {
        return items.filter(item => {
            const cl = item.categoryLink;
            if (!cl) return false;
            if (cl.inventorySlot === 'shield') return true;
            return cl.inventorySlot === 'weapon' && (cl.size === 'light' || cl.size === 'std');
        });
    }
    return items.filter(item => item.categoryLink?.inventorySlot === slot);
}

export function getLevelUpChoicesSum(levelUpChoices) {
    return (levelUpChoices.health || 0) + (levelUpChoices.attackChance || 0)
        + (levelUpChoices.attackDamage || 0) + (levelUpChoices.blockChance || 0);
}

export function getSkillPointsSpent(skillLevels) {
    return Object.entries(skillLevels).reduce((sum, [skillId, level]) => {
        const cost = isFreeFirstLevelSkill(skillId) ? Math.max(0, (level || 0) - 1) : (level || 0);
        return sum + cost;
    }, 0);
}

// applyLevelUpChoices() throws if levelUpChoices doesn't sum to exactly (level-1).
// When the level changes, previously-valid choices can become invalid (too many
// points spent for the new, smaller level). Rather than partially/ambiguously
// rescale individual bonus counts, reset to zero and let the user reallocate --
// simplest rule that can never leave the build in an invalid state.
export function reconcileLevelUpChoices(level, levelUpChoices) {
    const numChoices = Math.max(0, level - 1);
    if (getLevelUpChoicesSum(levelUpChoices) > numChoices) {
        return { health: 0, attackChance: 0, attackDamage: 0, blockChance: 0 };
    }
    return levelUpChoices;
}

export function reconcileSkillLevels(level, skillLevels) {
    const budget = getSkillPointBudget(level);
    if (getSkillPointsSpent(skillLevels) > budget) {
        return {};
    }
    return skillLevels;
}

// Fortitude's k-th skill point (1-indexed) requires player level >= 15k - 10
// (SkillCollection.java: requireExperienceLevels(15, -10)), matching
// LEVELUP_REQUIREMENTS' formula shape (requestedLevel*every + initial) but kept
// here since fortitude isn't in skillData.js's LEVELUP_REQUIREMENTS (its bonus is
// acquisition-order-dependent, not a simple gate - see levelModel.js).
export function getFortitudeMinLevelForPoint(pointIndex) {
    return Math.max(1, 15 * pointIndex - 10);
}

// Appends a new fortitude point, defaulting its acquired-at level to the later of
// its own minimum legal level and the previous point's level (points are acquired
// in order), clamped to the build's current level.
export function addFortitudePoint(fortitudeLevels, buildLevel) {
    const nextIndex = fortitudeLevels.length + 1;
    const minLevel = getFortitudeMinLevelForPoint(nextIndex);
    const previous = fortitudeLevels[fortitudeLevels.length - 1] || minLevel;
    const acquiredAt = Math.max(minLevel, previous);
    return [...fortitudeLevels, Math.min(acquiredAt, buildLevel)];
}

export function removeFortitudePoint(fortitudeLevels) {
    return fortitudeLevels.slice(0, -1);
}

// Clamps a user-edited acquired-at level for point `index` (0-indexed) to stay
// between its own minimum legal level / the previous point's level, and the next
// point's level / the build's overall level.
export function setFortitudePointLevel(fortitudeLevels, index, newLevel, buildLevel) {
    const minLevel = getFortitudeMinLevelForPoint(index + 1);
    const prevLevel = index > 0 ? fortitudeLevels[index - 1] : minLevel;
    const nextLevel = index < fortitudeLevels.length - 1 ? fortitudeLevels[index + 1] : buildLevel;
    const lowerBound = Math.max(minLevel, prevLevel);
    const clamped = Math.min(Math.max(newLevel, lowerBound), nextLevel);
    return fortitudeLevels.map((lvl, i) => (i === index ? clamped : lvl));
}

// Re-derives a valid fortitudeLevels array after the build's level or skillLevels
// changed (e.g. via reconcileSkillLevels wiping skillLevels on over-budget, or the
// user lowering the level below a point's previously-legal acquired-at level).
// Existing entries are clamped to stay within [minLevel-for-that-point, level]; a
// point whose minimum legal level now exceeds the (lowered) build level is no
// longer attainable at all, so it and every later point are dropped - the
// returned array can be shorter than skillLevels[fortitude]'s count, and callers
// MUST resync skillLevels[fortitude] to the returned array's length (mirrors how
// reconcileLevelUpChoices/reconcileSkillLevels handle their own over-budget resets).
export function reconcileFortitudeLevels(level, fortitudeLevels, skillLevels) {
    const fortitudeCount = skillLevels[SKILL_IDS.FORTITUDE] || 0;
    if (fortitudeCount === 0) return [];
    let prev = 0;
    const result = [];
    for (let i = 0; i < fortitudeCount; i++) {
        const minLevel = getFortitudeMinLevelForPoint(i + 1);
        if (minLevel > level) break;
        const existing = fortitudeLevels[i];
        const acquiredAt = Math.min(Math.max(minLevel, prev, existing || minLevel), level);
        result.push(acquiredAt);
        prev = acquiredAt;
    }
    return result;
}
