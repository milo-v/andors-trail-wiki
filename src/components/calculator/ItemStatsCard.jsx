import React from 'react';
import Icon from '../Icon';

// Field labels mirror ItemsTable.jsx's equipEffect columns, so the same
// stat means the same thing in both places.
const EQUIP_EFFECT_FIELDS = [
    ['increaseAttackCost', 'Atk Cost'],
    ['increaseAttackChance', 'AC'],
    ['increaseBlockChance', 'BC'],
    ['increaseCriticalSkill', 'Crit'],
    ['setCriticalMultiplier', 'Crit*'],
    ['increaseMaxHP', 'MaxHP'],
    ['increaseMaxAP', 'MaxAP'],
    ['increaseMoveCost', 'MC'],
    ['increaseUseItemCost', 'UC'],
    ['increaseReequipCost', 'EC'],
    ['setNonWeaponDamageModifier', 'Dmg*%'],
    ['increaseDamageResistance', 'Res'],
];

const styles = {
    backdrop: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
    },
    card: {
        position: 'absolute', zIndex: 101, background: '#222', border: '1px solid #555',
        borderRadius: 4, padding: 10, minWidth: 200, boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    },
    header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
    statList: { margin: '0 0 8px 0', padding: 0, listStyle: 'none', fontSize: '0.9em' },
};

export default function ItemStatsCard({ item, top, left, onExclude, onClose }) {
    if (!item) return null;

    const equipEffect = item.equipEffect || {};
    const stats = EQUIP_EFFECT_FIELDS
        .filter(([field]) => equipEffect[field] !== undefined && equipEffect[field] !== 0)
        .map(([field, label]) => {
            const value = equipEffect[field];
            const text = (value && typeof value === 'object') ? `${value.min}-${value.max}` : value;
            return <li key={field}>{label}: {text}</li>;
        });

    (equipEffect.addedConditions || []).forEach((entry, i) => {
        stats.push(<li key={`cond${i}`}>{entry.link?.name || entry.condition}{entry.magnitude ? ` x${entry.magnitude}` : ''}</li>);
    });

    return (
        <React.Fragment>
            <div style={styles.backdrop} onClick={onClose} />
            <div style={{ ...styles.card, top, left }}>
                <div style={styles.header}>
                    <div style={{ width: 32, height: 32 }}><Icon data={item} /></div>
                    <strong>{item.name}</strong>
                </div>
                {stats.length > 0
                    ? <ul style={styles.statList}>{stats}</ul>
                    : <p style={styles.statList}>No equip effects.</p>}
                <button type="button" onClick={onExclude}>Add to exclude list</button>
            </div>
        </React.Fragment>
    );
}
