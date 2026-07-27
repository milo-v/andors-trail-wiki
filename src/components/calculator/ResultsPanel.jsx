import React from 'react';

const DIFFICULTY_COLORS = {
    veryeasy: '#2e7d32',
    easy: '#66bb6a',
    normal: '#fbc02d',
    hard: '#ef6c00',
    veryhard: '#c62828',
    impossible: '#9c27b0',
};

export function getDifficultyColor(label) {
    return DIFFICULTY_COLORS[label] || '#888888';
}

const CHANGE_COLORS = { positive: '#66bb6a', negative: '#ef5350' };

// hpLossPerKill can be Infinity (target can't be killed); the caller maps that to
// netPerKill = -Infinity before calling this, so only that one special case needs
// its own text - a positive-infinite net can't occur (hpGainPerKill is always finite).
function formatChange(value) {
    if (value === -Infinity) return { text: '−∞ (cannot kill)', color: CHANGE_COLORS.negative };
    const sign = value >= 0 ? '+' : '';
    return { text: `${sign}${value.toFixed(2)}`, color: value >= 0 ? CHANGE_COLORS.positive : CHANGE_COLORS.negative };
}

function FormulaNotes({ hordeEnabled }) {
    return (
        <div style={{ marginTop: 16, fontSize: '0.85em', color: '#aaa' }}>
            <div><strong>Damage per turn</strong> = hit chance × average damage per successful hit × attacks
                per turn, where attacks per turn = ⌊max AP ÷ attack cost⌋.</div>
            <div><strong>HP change per turn</strong> = your HP regen per turn (from active conditions) − the
                opponent's damage per turn against you.</div>
            {hordeEnabled ? (
                <div><strong>Horde mode</strong>: a dead enemy is instantly replaced, so every enemy attacks
                    you every turn, forever - only a per-turn number applies. On-kill HP/AP/condition bonuses
                    are folded into the per-turn number at the rate kills actually happen.</div>
            ) : (
                <div><strong>HP change per kill</strong> = (your HP regen per turn × turns to kill the opponent) +
                    on-kill HP bonuses (e.g. Corpse Eater) − (the opponent's damage per turn × turns to kill).</div>
            )}
        </div>
    );
}

export default function ResultsPanel({ summary, opponentSelected, pointsFullyAllocated, hordeEnabled }) {
    if (!opponentSelected) {
        return (
            <div>
                <h3>Results</h3>
                <p>Select an opponent to see combat results.</p>
                <FormulaNotes hordeEnabled={hordeEnabled} />
            </div>
        );
    }
    if (!pointsFullyAllocated) {
        return (
            <div>
                <h3>Results</h3>
                <p>Allocate all remaining level-up points to see combat results.</p>
                <FormulaNotes hordeEnabled={hordeEnabled} />
            </div>
        );
    }

    const netPerTurn = summary.hpGainPerTurn - summary.hpLossPerTurn;
    const perTurn = formatChange(netPerTurn);
    const showPerKill = summary.hpLossPerKill !== undefined;
    const netPerKill = showPerKill && summary.hpLossPerKill === Infinity
        ? -Infinity
        : showPerKill ? summary.hpGainPerKill - summary.hpLossPerKill : null;
    const perKill = showPerKill ? formatChange(netPerKill) : null;

    return (
        <div>
            <h3>Results</h3>
            <div style={{ color: getDifficultyColor(summary.difficultyLabel), fontWeight: 'bold', fontSize: '1.2em' }}>
                Difficulty: {summary.difficultyLabel} ({summary.difficulty})
            </div>
            <div>Damage per turn: {summary.damagePerTurn.toFixed(2)}</div>
            <div>HP change per turn: <span style={{ color: perTurn.color }}>{perTurn.text}</span></div>
            {showPerKill && (
                <div>HP change per kill: <span style={{ color: perKill.color }}>{perKill.text}</span></div>
            )}
            <FormulaNotes hordeEnabled={hordeEnabled} />
        </div>
    );
}
