import React from 'react';
import SearchableSelect from './SearchableSelect';

export default function OpponentPicker({ opponentId, monsters, onChange }) {
    const options = monsters.map(m => ({ value: m.id, label: m.name }));
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
        </div>
    );
}
