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

export default function OpponentPicker({ opponentId, monsters, onChange }) {
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
            {monster ? (
                <div style={{ marginTop: 8 }}>
                    <div>Attack Damage: {monster.attackDamage?.min ?? 0}-{monster.attackDamage?.max ?? 0}</div>
                    {STAT_ROWS.map(({ key, label }) => (
                        <div key={key}>{label}: {monster[key] ?? 0}</div>
                    ))}
                </div>
            ) : (
                <p>Select an opponent to see its stats.</p>
            )}
        </div>
    );
}
