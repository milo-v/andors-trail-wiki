import React from 'react';
import { SKILL_IDS, SKILL_META, SKILL_CATEGORY } from '../../utils/combat/skillData';
import { getSkillPointBudget } from '../../utils/combat/levelModel';
import { getSkillPointsSpent } from './buildHelpers';

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

export default function SkillsPanel({ level, skillLevels, onChange }) {
    const budget = getSkillPointBudget(level);
    const spent = getSkillPointsSpent(skillLevels);
    const remaining = budget - spent;

    const setLevel = (skillId, delta) => {
        const current = skillLevels[skillId] || 0;
        const meta = SKILL_META[skillId];
        const next = current + delta;
        if (next < 0) return;
        if (meta.maxLevel != null && next > meta.maxLevel) return;
        if (delta > 0 && remaining <= 0) return;
        onChange({ ...skillLevels, [skillId]: next });
    };

    return (
        <div>
            <h3>Skills ({remaining} of {budget} points remaining)</h3>
            {CATEGORY_ORDER.map(category => (
                <div key={category}>
                    <h4>{CATEGORY_LABELS[category]}</h4>
                    {ALL_SKILL_IDS.filter(skillId => SKILL_META[skillId].category === category).map(skillId => (
                        <div key={skillId} style={{ marginBottom: 4 }}>
                            <span style={{ display: 'inline-block', width: 260 }}>{SKILL_META[skillId].name}</span>
                            <button type="button" onClick={() => setLevel(skillId, -1)}>-</button>
                            <span style={{ margin: '0 8px' }}>
                                {skillLevels[skillId] || 0}{SKILL_META[skillId].maxLevel != null ? ` / ${SKILL_META[skillId].maxLevel}` : ''}
                            </span>
                            <button type="button" onClick={() => setLevel(skillId, 1)}>+</button>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
