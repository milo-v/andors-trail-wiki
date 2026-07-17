import React from 'react';
import { getFortitudeMinLevelForPoint } from './buildHelpers';

export default function FortitudeSkillRow({ level, fortitudeLevels, canAdd, blockedReason, onAdd, onRemove, onSetLevel }) {
    return (
        <div style={{ marginBottom: 4 }}>
            <div>
                <span style={{ display: 'inline-block', width: 260 }}>Increased Fortitude</span>
                <button type="button" disabled={fortitudeLevels.length === 0} onClick={onRemove}>-</button>
                <span style={{ margin: '0 8px' }}>{fortitudeLevels.length}</span>
                <button type="button" disabled={!canAdd} title={blockedReason || ''} onClick={onAdd}>+</button>
            </div>
            {fortitudeLevels.map((acquiredAt, index) => (
                <div key={index} style={{ marginLeft: 20 }}>
                    Point {index + 1}: acquired at level{' '}
                    <input
                        type="number"
                        min={getFortitudeMinLevelForPoint(index + 1)}
                        max={level}
                        value={acquiredAt}
                        onChange={e => onSetLevel(index, parseInt(e.target.value, 10) || acquiredAt)}
                        style={{ background: '#1a1a1a', color: 'white', border: '1px solid #666', width: 60 }}
                    />
                </div>
            ))}
        </div>
    );
}
