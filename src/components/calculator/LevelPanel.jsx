import React, { useState, useEffect } from 'react';
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

    // Kept as separate local text so the field can be fully cleared while
    // typing (e.g. to replace "1" with "12") instead of a controlled
    // number-input snapping straight back to the last valid level on every
    // keystroke. Only committed to the real (always-numeric) build.level via
    // onChangeLevel once it parses to a valid level.
    const [levelText, setLevelText] = useState(String(level));

    // Resyncs the displayed text when level changes from outside (e.g. a
    // shared build URL loading, or level-up choice reconciliation) - skipped
    // when the text already represents the current level, so normal typing
    // isn't disrupted by the resulting re-render.
    useEffect(() => {
        setLevelText(current => (parseInt(current, 10) === level ? current : String(level)));
    }, [level]);

    const handleLevelTextChange = (text) => {
        setLevelText(text);
        const parsed = parseInt(text, 10);
        if (Number.isInteger(parsed) && parsed >= 1) {
            onChangeLevel(parsed);
        }
    };

    const handleLevelBlur = () => {
        if (parseInt(levelText, 10) !== level) {
            setLevelText(String(level));
        }
    };

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
                    value={levelText}
                    onChange={e => handleLevelTextChange(e.target.value)}
                    onBlur={handleLevelBlur}
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
