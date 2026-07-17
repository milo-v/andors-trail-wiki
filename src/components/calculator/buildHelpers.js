import { EQUIP_SLOTS } from '../../utils/combat/statEngine';
import { getSkillPointBudget } from '../../utils/combat/levelModel';

export function createEmptyBuild() {
    const equipment = {};
    for (const slot of EQUIP_SLOTS) equipment[slot] = null;
    return {
        level: 1,
        levelUpChoices: { health: 0, attackChance: 0, attackDamage: 0, blockChance: 0 },
        skillLevels: {},
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
    return Object.values(skillLevels).reduce((sum, v) => sum + (v || 0), 0);
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
