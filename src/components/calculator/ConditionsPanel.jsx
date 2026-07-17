import React from 'react';
import SearchableSelect from './SearchableSelect';

export default function ConditionsPanel({ activeConditions, conditions, onChange }) {
    const options = conditions.map(c => ({ value: c.id, label: c.name }));

    const updateRow = (index, patch) => {
        onChange(activeConditions.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    };
    const removeRow = index => {
        onChange(activeConditions.filter((_, i) => i !== index));
    };
    const addRow = () => {
        onChange([...activeConditions, { conditionId: null, magnitude: 1 }]);
    };

    return (
        <div>
            <h3>Active conditions</h3>
            {activeConditions.map((row, index) => (
                <div key={index} style={{ marginBottom: 4 }}>
                    <SearchableSelect
                        options={options}
                        value={row.conditionId}
                        onChange={conditionId => updateRow(index, { conditionId })}
                        placeholder="Select condition..."
                    />
                    <button type="button" onClick={() => updateRow(index, { magnitude: Math.max(1, row.magnitude - 1) })}>-</button>
                    <span style={{ margin: '0 8px' }}>{row.magnitude}</span>
                    <button type="button" onClick={() => updateRow(index, { magnitude: row.magnitude + 1 })}>+</button>
                    <button type="button" onClick={() => removeRow(index)} style={{ marginLeft: 8 }}>Remove</button>
                </div>
            ))}
            <button type="button" onClick={addRow}>Add condition</button>
        </div>
    );
}
