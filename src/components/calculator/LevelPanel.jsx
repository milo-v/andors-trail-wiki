import React from 'react';
import { getLevelUpChoicesSum } from './buildHelpers';

const BONUS_LABELS = {
    health: '+5 Max HP',
    attackChance: '+5 Attack Chance',
    attackDamage: '+1/+1 Attack Damage',
    blockChance: '+3 Block Chance',
};

export default function LevelPanel({ level, levelUpChoices, onChangeLevel, onChangeLevelUpChoices }) {
    const numChoices = Math.max(0, level - 1);
    const remaining = numChoices - getLevelUpChoicesSum(levelUpChoices);

    const setChoice = (key, delta) => {
        const current = levelUpChoices[key] || 0;
        const next = current + delta;
        if (next < 0) return;
        if (delta > 0 && remaining <= 0) return;
        onChangeLevelUpChoices({ ...levelUpChoices, [key]: next });
    };

    return (
        <div>
            <h3>Level</h3>
            <label>
                Level:{' '}
                <input
                    type="number"
                    min={1}
                    value={level}
                    onChange={e => onChangeLevel(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    style={{ background: '#1a1a1a', color: 'white', border: '1px solid #666', padding: '2px 4px' }}
                />
            </label>
            <div>Level-up bonuses ({remaining} of {numChoices} remaining)</div>
            {Object.keys(BONUS_LABELS).map(key => (
                <div key={key}>
                    <span style={{ display: 'inline-block', width: 200 }}>{BONUS_LABELS[key]}</span>
                    <button type="button" onClick={() => setChoice(key, -1)}>-</button>
                    <span style={{ margin: '0 8px' }}>{levelUpChoices[key] || 0}</span>
                    <button type="button" onClick={() => setChoice(key, 1)}>+</button>
                </div>
            ))}
        </div>
    );
}
