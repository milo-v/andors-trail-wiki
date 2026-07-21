import React from 'react';
import SlotPicker from './SlotPicker';
import { EQUIP_SLOTS, isTwohandWeapon } from '../../utils/combat/statEngine';

const SLOT_LABELS = {
    weapon: 'Weapon', shield: 'Shield / Off-hand', head: 'Head', body: 'Body',
    hand: 'Hands', feet: 'Feet', neck: 'Neck', leftring: 'Left ring', rightring: 'Right ring',
};

export default function EquipmentPanel({ equipment, items, onChange }) {
    const weaponItem = items.find(item => item.id === equipment.weapon);
    const twoHanded = isTwohandWeapon(weaponItem);

    const handleChange = (slot, itemId) => {
        const next = { ...equipment, [slot]: itemId };
        if (slot === 'weapon' && isTwohandWeapon(items.find(item => item.id === itemId))) {
            next.shield = null;
        }
        onChange(next);
    };

    return (
        <div>
            <h3>Equipment</h3>
            {EQUIP_SLOTS.map(slot => (
                <div key={slot} style={{ marginBottom: 8 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>{SLOT_LABELS[slot]}</label>
                    {slot === 'shield' && twoHanded ? (
                        <span style={{ color: '#888' }}>Two-handed weapon equipped</span>
                    ) : (
                        <SlotPicker
                            slot={slot}
                            items={items}
                            value={equipment[slot]}
                            onChange={itemId => handleChange(slot, itemId)}
                        />
                    )}
                </div>
            ))}
        </div>
    );
}
