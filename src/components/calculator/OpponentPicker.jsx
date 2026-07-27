import React from 'react';
import SearchableSelect from './SearchableSelect';

const STAT_ROWS = [
    { key: 'maxHP', label: 'Max HP' },
    { key: 'maxAP', label: 'Max AP' },
    { key: 'attackChance', label: 'Attack Chance' },
    { key: 'criticalSkill', label: 'Critical Skill' },
    { key: 'criticalMultiplier', label: 'Critical Multiplier' },
    { key: 'blockChance', label: 'Block Chance' },
    { key: 'damageResistance', label: 'Damage Resistance' },
    { key: 'attackCost', label: 'Attack Cost' },
];

export default function OpponentPicker({ opponentId, monsters, resolvedStats, onChange, hordeConfig, onChangeHordeConfig }) {
    const options = monsters.map(m => ({ value: m.id, label: m.name }));
    const monster = monsters.find(m => m.id === opponentId) || null;
    return (
        <div>
            <h3>Opponent</h3>
            <SearchableSelect
                options={options}
                value={opponentId}
                onChange={onChange}
                allowClear={true}
                placeholder="Select monster..."
            />
            <div style={{ marginTop: 8 }}>
                <label>
                    <input
                        type="checkbox"
                        checked={hordeConfig.enabled}
                        onChange={e => onChangeHordeConfig({ enabled: e.target.checked })}
                    />
                    {' '}Horde
                </label>
                {hordeConfig.enabled && (
                    <span style={{ marginLeft: 10 }}>
                        <label>Enemies{' '}
                            <input
                                type="number"
                                min="2"
                                step="1"
                                value={hordeConfig.size}
                                onChange={e => onChangeHordeConfig({ size: Math.max(2, Number(e.target.value) || 2) })}
                                style={{ width: 60 }}
                            />
                        </label>
                    </span>
                )}
            </div>
            {monster && resolvedStats ? (
                <div style={{ marginTop: 8 }}>
                    <div>Attack Damage: {resolvedStats.damagePotential.min}-{resolvedStats.damagePotential.max}</div>
                    {STAT_ROWS.map(({ key, label }) => (
                        <div key={key}>{label}: {resolvedStats[key]}</div>
                    ))}
                </div>
            ) : (
                <p>Select an opponent to see its stats.</p>
            )}
        </div>
    );
}
