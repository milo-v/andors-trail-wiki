import React from 'react';
import SearchableSelect from './SearchableSelect';
import { getItemsForSlot } from './buildHelpers';

export default function SlotPicker({ slot, items, value, onChange }) {
    const options = getItemsForSlot(slot, items).map(item => ({ value: item.id, label: item.name }));
    return (
        <SearchableSelect
            options={options}
            value={value}
            onChange={onChange}
            allowClear={true}
            placeholder={`Select ${slot}...`}
        />
    );
}
