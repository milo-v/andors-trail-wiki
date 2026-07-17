import React from 'react';
import {
    SKILL_IDS, SKILL_META, SKILL_CATEGORY, canLevelUpSkillTo, describeUnmetRequirement,
} from '../../utils/combat/skillData';
import { getSkillPointBudget } from '../../utils/combat/levelModel';
import {
    getSkillPointsSpent, getFortitudeMinLevelForPoint,
    addFortitudePoint, removeFortitudePoint, setFortitudePointLevel,
} from './buildHelpers';
import FortitudeSkillRow from './FortitudeSkillRow';

const CATEGORY_LABELS = {
    [SKILL_CATEGORY.GENERAL]: 'General combat skills',
    [SKILL_CATEGORY.WEAPON_PROFICIENCY]: 'Weapon proficiencies',
    [SKILL_CATEGORY.ARMOR_PROFICIENCY]: 'Armor proficiencies',
    [SKILL_CATEGORY.FIGHTSTYLE]: 'Fighting styles & specializations',
};

const CATEGORY_ORDER = [
    SKILL_CATEGORY.GENERAL, SKILL_CATEGORY.WEAPON_PROFICIENCY,
    SKILL_CATEGORY.ARMOR_PROFICIENCY, SKILL_CATEGORY.FIGHTSTYLE,
];

const ALL_SKILL_IDS = Object.values(SKILL_IDS);

export default function SkillsPanel({ level, skillLevels, fortitudeLevels, resolvedStats, onChange, onChangeFortitude }) {
    const budget = getSkillPointBudget(level);
    const spent = getSkillPointsSpent(skillLevels);
    const remaining = budget - spent;
    const ctx = { level, skillLevels, resolvedStats };

    const setLevel = (skillId, delta) => {
        const current = skillLevels[skillId] || 0;
        const meta = SKILL_META[skillId];
        const next = current + delta;
        if (next < 0) return;
        if (meta.maxLevel != null && next > meta.maxLevel) return;
        if (delta > 0 && remaining <= 0) return;
        if (delta > 0 && !canLevelUpSkillTo(skillId, next, ctx)) return;
        onChange({ ...skillLevels, [skillId]: next });
    };

    const addFortitude = () => {
        if (remaining <= 0) return;
        if (getFortitudeMinLevelForPoint(fortitudeLevels.length + 1) > level) return;
        const newFortitudeLevels = addFortitudePoint(fortitudeLevels, level);
        onChangeFortitude({
            skillLevels: { ...skillLevels, [SKILL_IDS.FORTITUDE]: newFortitudeLevels.length },
            fortitudeLevels: newFortitudeLevels,
        });
    };
    const removeFortitude = () => {
        const newFortitudeLevels = removeFortitudePoint(fortitudeLevels);
        onChangeFortitude({
            skillLevels: { ...skillLevels, [SKILL_IDS.FORTITUDE]: newFortitudeLevels.length },
            fortitudeLevels: newFortitudeLevels,
        });
    };
    const setFortitudeLevel = (index, newLevel) => {
        onChangeFortitude({
            skillLevels,
            fortitudeLevels: setFortitudePointLevel(fortitudeLevels, index, newLevel, level),
        });
    };

    const fortitudeMinLevel = getFortitudeMinLevelForPoint(fortitudeLevels.length + 1);
    const fortitudeCanAdd = remaining > 0 && fortitudeMinLevel <= level;
    const fortitudeBlockedReason = fortitudeCanAdd ? null : `Requires character level ${fortitudeMinLevel}`;

    return (
        <div>
            <h3>Skills ({remaining} of {budget} points remaining)</h3>
            {CATEGORY_ORDER.map(category => (
                <div key={category}>
                    <h4>{CATEGORY_LABELS[category]}</h4>
                    {ALL_SKILL_IDS.filter(skillId => SKILL_META[skillId].category === category).map(skillId => {
                        if (skillId === SKILL_IDS.FORTITUDE) {
                            return (
                                <FortitudeSkillRow
                                    key={skillId}
                                    level={level}
                                    fortitudeLevels={fortitudeLevels}
                                    canAdd={fortitudeCanAdd}
                                    blockedReason={fortitudeBlockedReason}
                                    onAdd={addFortitude}
                                    onRemove={removeFortitude}
                                    onSetLevel={setFortitudeLevel}
                                />
                            );
                        }
                        const current = skillLevels[skillId] || 0;
                        const meta = SKILL_META[skillId];
                        const next = current + 1;
                        const blockedReason = !canLevelUpSkillTo(skillId, next, ctx)
                            ? describeUnmetRequirement(skillId, next, ctx) : null;
                        const plusDisabled = (meta.maxLevel != null && next > meta.maxLevel)
                            || remaining <= 0 || !!blockedReason;
                        return (
                            <div key={skillId} style={{ marginBottom: 4 }}>
                                <span style={{ display: 'inline-block', width: 260 }}>{meta.name}</span>
                                <button type="button" onClick={() => setLevel(skillId, -1)}>-</button>
                                <span style={{ margin: '0 8px' }}>
                                    {current}{meta.maxLevel != null ? ` / ${meta.maxLevel}` : ''}
                                </span>
                                <button type="button" disabled={plusDisabled} title={blockedReason || ''}
                                    onClick={() => setLevel(skillId, 1)}>+</button>
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
