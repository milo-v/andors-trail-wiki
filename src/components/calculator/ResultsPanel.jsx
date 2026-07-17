import React from 'react';

const DIFFICULTY_COLORS = {
    veryeasy: '#2e7d32',
    easy: '#66bb6a',
    normal: '#fbc02d',
    hard: '#ef6c00',
    veryhard: '#c62828',
    impossible: '#000000',
};

export function getDifficultyColor(label) {
    return DIFFICULTY_COLORS[label] || '#888888';
}

export default function ResultsPanel({ summary, opponentSelected, pointsFullyAllocated }) {
    if (!opponentSelected) {
        return <div><h3>Results</h3><p>Select an opponent to see combat results.</p></div>;
    }
    if (!pointsFullyAllocated) {
        return <div><h3>Results</h3><p>Allocate all remaining level-up and skill points to see combat results.</p></div>;
    }
    return (
        <div>
            <h3>Results</h3>
            <div style={{ color: getDifficultyColor(summary.difficultyLabel), fontWeight: 'bold', fontSize: '1.2em' }}>
                Difficulty: {summary.difficultyLabel} ({summary.difficulty})
            </div>
            <div>Damage per turn: {summary.damagePerTurn.toFixed(2)}</div>
            <div>HP loss per turn: {summary.hpLossPerTurn.toFixed(2)}</div>
            <div>HP gain per turn: {summary.hpGainPerTurn.toFixed(2)}</div>
            <div>HP loss per kill: {summary.hpLossPerKill === Infinity ? '∞ (cannot kill)' : summary.hpLossPerKill.toFixed(2)}</div>
            <div>HP gain per kill: {summary.hpGainPerKill.toFixed(2)}</div>
        </div>
    );
}
