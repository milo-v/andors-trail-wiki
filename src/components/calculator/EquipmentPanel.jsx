import React from 'react';
import SlotPicker from './SlotPicker';
import { EQUIP_SLOTS } from '../../utils/combat/statEngine';

const SLOT_LABELS = {
    weapon: 'Weapon', shield: 'Shield / Off-hand', head: 'Head', body: 'Body',
    hand: 'Hands', feet: 'Feet', neck: 'Neck', leftring: 'Left ring', rightring: 'Right ring',
};

export default function EquipmentPanel({ equipment, items, onChange }) {
    return (
        <div>
            <h3>Equipment</h3>
            {EQUIP_SLOTS.map(slot => (
                <div key={slot} style={{ marginBottom: 8 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>{SLOT_LABELS[slot]}</label>
                    <SlotPicker
                        slot={slot}
                        items={items}
                        value={equipment[slot]}
                        onChange={itemId => onChange({ ...equipment, [slot]: itemId })}
                    />
                </div>
            ))}
        </div>
    );
}
