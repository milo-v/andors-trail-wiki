import { EQUIP_SLOTS } from '../../utils/combat/statEngine';
import { SKILL_IDS, SKILL_META } from '../../utils/combat/skillData';
import { createEmptyBuild, reconcileLevelUpChoices, reconcileSkillLevels, reconcileFortitudeLevels } from './buildHelpers';

export function encodeBuildToQuery(build, opponentId) {
    const json = JSON.stringify({ build, opponentId });
    const encoded = btoa(unescape(encodeURIComponent(json)));
    return `?b=${encoded}`;
}

export function decodeBuildFromQuery(search, items, monsters, conditions) {
    const empty = { build: createEmptyBuild(), opponentId: null };
    const params = new URLSearchParams(search);
    const raw = params.get('b');
    if (!raw) return empty;

    let payload;
    try {
        const json = decodeURIComponent(escape(atob(raw)));
        payload = JSON.parse(json);
    } catch (e) {
        return empty;
    }
    if (!payload || typeof payload !== 'object' || !payload.build) return empty;

    const itemIds = new Set(items.map(i => i.id));
    const monsterIds = new Set(monsters.map(m => m.id));
    const conditionIds = new Set(conditions.map(c => c.id));

    const build = createEmptyBuild();
    const src = payload.build;

    if (typeof src.level === 'number' && src.level >= 1) {
        build.level = src.level;
    }
    if (src.levelUpChoices) {
        build.levelUpChoices = {
            health: src.levelUpChoices.health || 0,
            attackChance: src.levelUpChoices.attackChance || 0,
            attackDamage: src.levelUpChoices.attackDamage || 0,
            blockChance: src.levelUpChoices.blockChance || 0,
        };
    }
    if (src.skillLevels) {
        for (const [skillId, lvl] of Object.entries(src.skillLevels)) {
            if (SKILL_META[skillId] && typeof lvl === 'number' && lvl > 0) {
                build.skillLevels[skillId] = lvl;
            }
        }
    }
    if (Array.isArray(src.fortitudeLevels)) {
        build.fortitudeLevels = src.fortitudeLevels.filter(n => typeof n === 'number' && n >= 1);
    }
    if (src.equipment) {
        for (const slot of EQUIP_SLOTS) {
            const itemId = src.equipment[slot];
            if (itemId && itemIds.has(itemId)) {
                build.equipment[slot] = itemId;
            }
        }
    }
    if (Array.isArray(src.activeConditions)) {
        build.activeConditions = src.activeConditions
            .filter(row => row && conditionIds.has(row.conditionId) && typeof row.magnitude === 'number')
            .map(row => ({ conditionId: row.conditionId, magnitude: row.magnitude }));
    }

    build.levelUpChoices = reconcileLevelUpChoices(build.level, build.levelUpChoices);
    build.skillLevels = reconcileSkillLevels(build.level, build.skillLevels);
    build.fortitudeLevels = reconcileFortitudeLevels(build.level, build.fortitudeLevels, build.skillLevels);
    if (build.fortitudeLevels.length !== (build.skillLevels[SKILL_IDS.FORTITUDE] || 0)) {
        build.skillLevels = { ...build.skillLevels, [SKILL_IDS.FORTITUDE]: build.fortitudeLevels.length };
    }

    const opponentId = monsterIds.has(payload.opponentId) ? payload.opponentId : null;

    return { build, opponentId };
}
