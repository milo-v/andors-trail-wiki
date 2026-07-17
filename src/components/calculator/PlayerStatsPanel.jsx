import React from 'react';

const STAT_ROWS = [
    { key: 'maxHP', label: 'Max HP' },
    { key: 'maxAP', label: 'Max AP' },
    { key: 'attackChance', label: 'Attack Chance' },
    { key: 'blockChance', label: 'Block Chance' },
    { key: 'damageResistance', label: 'Damage Resistance' },
    { key: 'criticalSkill', label: 'Critical Skill' },
    { key: 'criticalMultiplier', label: 'Critical Multiplier' },
    { key: 'attackCost', label: 'Attack Cost' },
    { key: 'moveCost', label: 'Move Cost' },
];

export default function PlayerStatsPanel({ resolvedStats, fullyAllocated }) {
    if (!fullyAllocated || !resolvedStats) {
        return (
            <div>
                <h3>Player Stats</h3>
                <p>Allocate all remaining level-up and skill points to see stats.</p>
            </div>
        );
    }
    return (
        <div>
            <h3>Player Stats</h3>
            <div>Damage Potential: {resolvedStats.damagePotential.min}-{resolvedStats.damagePotential.max}</div>
            {STAT_ROWS.map(({ key, label }) => (
                <div key={key}>{label}: {resolvedStats[key]}</div>
            ))}
        </div>
    );
}
