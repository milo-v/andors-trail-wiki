import React from 'react';
import { HashLink as Link } from 'react-router-hash-link';
import Icon from '../Icon';

// Field labels mirror ItemsTable.jsx's equipEffect columns, so the same
// stat means the same thing in both places.
const EQUIP_EFFECT_FIELDS = [
    ['increaseAttackCost', 'Atk Cost'],
    ['increaseAttackDamage', 'Dmg'],
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

// equipEffect covers only an item's always-on flat stats - hitEffect/
// killEffect/hitReceivedEffect/useEffect (proc-based, chance-triggered
// effects) previously weren't shown here at all, making an item's real
// value (or another item's hidden edge) invisible when comparing two
// items that otherwise look identical on flat stats.
const PROC_EFFECT_FIELDS = [
    ['hitEffect', 'On hit'],
    ['killEffect', 'On kill'],
    ['hitReceivedEffect', 'When hit'],
    ['useEffect', 'On use'],
];

function formatRange(range) {
    if (!range) return null;
    return `${range.min}-${range.max}`;
}

function formatChanceDuration(entry) {
    const parts = [];
    if (entry.chance != null) parts.push(`${entry.chance}% chance`);
    if (entry.duration != null) parts.push(`${entry.duration} turns`);
    return parts.length ? ` (${parts.join(', ')})` : '';
}

function describeProcEffect(effect, label) {
    const lines = [];
    const hp = formatRange(effect.increaseCurrentHP);
    if (hp) lines.push(`${label}: +${hp} HP`);
    const ap = formatRange(effect.increaseCurrentAP);
    if (ap) lines.push(`${label}: +${ap} AP`);
    const atkHp = formatRange(effect.increaseAttackerCurrentHP);
    if (atkHp) lines.push(`${label}: ${atkHp} HP to attacker`);
    const atkAp = formatRange(effect.increaseAttackerCurrentAP);
    if (atkAp) lines.push(`${label}: ${atkAp} AP to attacker`);
    (effect.conditionsSource || []).forEach((entry) => {
        lines.push(`${label} (self): ${entry.link?.name || entry.condition}${entry.magnitude ? ` x${entry.magnitude}` : ''}${formatChanceDuration(entry)}`);
    });
    (effect.conditionsTarget || []).forEach((entry) => {
        lines.push(`${label} (target): ${entry.link?.name || entry.condition}${entry.magnitude ? ` x${entry.magnitude}` : ''}${formatChanceDuration(entry)}`);
    });
    return lines;
}

// item.droplists is populated by Main.linkTemp(): each entry's `.droplist.links`
// is the list of monsters/containers (or quest-giving monsters, for quest
// rewards) that can yield this item, mirroring items/ExpandingName.jsx's
// getEnemyList - kept in sync so "sources" means the same thing here and there.
function getSources(item) {
    const sources = [];
    (item.droplists || []).forEach((entry) => {
        entry.droplist?.links?.forEach((monster) => {
            sources.push({ monster, entry });
        });
    });
    return sources;
}

function formatQuantity(quantity) {
    if (!quantity) return null;
    if (quantity.max === quantity.min) return `${quantity.max}x`;
    return `${quantity.min}-${quantity.max}x`;
}

function formatSourceDetail(entry, monster) {
    if (entry.type) return entry.type;
    if (!monster?.maxHP) return 'sell';
    if (entry.chance == null) return null;
    return (typeof entry.chance === 'string' && entry.chance.indexOf('/') > 0) ? entry.chance : `${entry.chance}%`;
}

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

export default function ItemStatsCard({ item, top, left, onExclude, onLimit, onClose }) {
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

    PROC_EFFECT_FIELDS.forEach(([field, label]) => {
        const effect = item[field];
        if (!effect) return;
        describeProcEffect(effect, label).forEach((line, i) => {
            stats.push(<li key={`${field}${i}`}>{line}</li>);
        });
    });

    const sources = getSources(item);

    return (
        <React.Fragment>
            <div style={styles.backdrop} onClick={onClose} />
            <div style={{ ...styles.card, top, left }}>
                <div style={styles.header}>
                    <div style={{ width: 32, height: 32 }}><Icon data={item} /></div>
                    <strong>{item.name}</strong>
                </div>
                {item.priceCost ? <p style={styles.statList}>Price: {item.priceCost} gold</p> : null}
                {stats.length > 0
                    ? <ul style={styles.statList}>{stats}</ul>
                    : <p style={styles.statList}>No equip effects.</p>}
                {sources.length > 0 && (
                    <React.Fragment>
                        <p style={{ ...styles.statList, marginBottom: 2 }}>Sources:</p>
                        <ul style={styles.statList}>
                            {sources.map(({ monster, entry }, i) => (
                                <li key={i}>
                                    <Link to={monster.rootLink + monster.id}>{monster.name}</Link>
                                    {formatQuantity(entry.quantity) ? ` ${formatQuantity(entry.quantity)}` : ''}
                                    {formatSourceDetail(entry, monster) ? ` (${formatSourceDetail(entry, monster)})` : ''}
                                </li>
                            ))}
                        </ul>
                    </React.Fragment>
                )}
                <button type="button" onClick={onExclude}>Add to exclude list</button>
                {' '}
                <button type="button" onClick={onLimit}>Limit to 1 copy</button>
            </div>
        </React.Fragment>
    );
}
