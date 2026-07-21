import React, { Component } from 'react';
import SlotPicker from './SlotPicker';
import { EQUIP_SLOTS } from '../../utils/combat/statEngine';

const SLOT_LABELS = {
    weapon: 'Weapon', shield: 'Shield/Off-hand', head: 'Head', body: 'Body', hand: 'Hand',
    feet: 'Feet', neck: 'Neck', leftring: 'Left ring', rightring: 'Right ring',
};

// Main.jsx's linkTemp() cross-links items/monsters with these fields for wiki
// navigation (conv_links/droplists on items, droplistLink/spawnGroupLinks/
// conversationLink on monsters) - they reach deep, cyclic, non-serializable
// object graphs (including raw XML map-parser nodes), which fail
// postMessage's structured-clone. Combat math never reads them, so strip
// before sending to the worker.
const UNSAFE_ITEM_KEYS = ['conv_links', 'droplists'];
const UNSAFE_MONSTER_KEYS = ['droplistLink', 'spawnGroupLinks', 'conversationLink'];

function omitKeys(obj, keys) {
    const clone = { ...obj };
    keys.forEach(key => delete clone[key]);
    return clone;
}

export default class OptimizerPanel extends Component {
    constructor(props) {
        super(props);
        this.state = {
            locks: {},
            maxItemLevel: '',
            excludedItemIds: [],
            maxHpLossPerKill: '',
            running: false,
            evaluated: 0,
            total: 0,
            top10: [],
        };
        this.worker = null;
    }

    componentWillUnmount() {
        this.terminateWorker();
    }

    terminateWorker() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    setLock(slot, itemId) {
        this.setState({ locks: { ...this.state.locks, [slot]: itemId || undefined } });
    }

    run() {
        const { items, monster, build } = this.props;
        if (!monster) return;

        const itemsById = items.reduce((obj, item) => Object.assign(obj, { [item.id]: omitKeys(item, UNSAFE_ITEM_KEYS) }), {});
        const sanitizedMonster = omitKeys(monster, UNSAFE_MONSTER_KEYS);
        const conditionsById = this.props.conditionsById || {};

        const locks = {};
        Object.entries(this.state.locks).forEach(([slot, itemId]) => { if (itemId) locks[slot] = itemId; });

        const maxItemLevel = this.state.maxItemLevel === '' ? undefined : Number(this.state.maxItemLevel);
        const excludedSet = new Set(this.state.excludedItemIds);
        const filtersBySlot = {};
        EQUIP_SLOTS.forEach(slot => {
            filtersBySlot[slot] = { maxItemLevel, excludedItemIds: excludedSet };
        });

        const maxHpLossPerKill = this.state.maxHpLossPerKill === '' ? undefined : Number(this.state.maxHpLossPerKill);

        this.terminateWorker();
        this.worker = new Worker(new URL('../../workers/optimizerWorker.js', import.meta.url));
        this.worker.onmessage = (event) => {
            const { type, evaluated, total, top10 } = event.data;
            if (type === 'progress') {
                this.setState({ evaluated, total, top10 });
            } else if (type === 'done') {
                this.setState({ running: false, top10 });
                this.terminateWorker();
            }
        };
        this.setState({ running: true, evaluated: 0, total: 0, top10: [] });
        this.worker.postMessage({
            type: 'start', build, monster: sanitizedMonster, itemsById, conditionsById, locks, filtersBySlot, maxHpLossPerKill,
        });
    }

    cancel() {
        if (this.worker) this.worker.postMessage({ type: 'cancel' });
        this.setState({ running: false });
    }

    render() {
        const { items, monster, onApplyBuild } = this.props;
        const { locks, maxItemLevel, maxHpLossPerKill, running, evaluated, total, top10 } = this.state;
        const percent = total > 0 ? Math.round((evaluated / total) * 100) : 0;

        return (
            <div style={{ marginTop: 20, borderTop: '1px solid #444', paddingTop: 10 }}>
                <h3>Equipment optimizer</h3>
                {EQUIP_SLOTS.map(slot => (
                    <div key={slot} style={{ marginBottom: 6 }}>
                        <label style={{ display: 'inline-block', width: 140 }}>{SLOT_LABELS[slot]} lock</label>
                        <SlotPicker slot={slot} items={items} value={locks[slot]} onChange={id => this.setLock(slot, id)} />
                    </div>
                ))}
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>Max item level</label>
                    <input type="number" step="5" value={maxItemLevel}
                        onChange={e => this.setState({ maxItemLevel: e.target.value })} placeholder="No cap" />
                </div>
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>Max HP loss/kill</label>
                    <input type="number" value={maxHpLossPerKill}
                        onChange={e => this.setState({ maxHpLossPerKill: e.target.value })} placeholder="No limit" />
                </div>
                <button disabled={!monster || running} onClick={() => this.run()}>Run optimizer</button>
                {running && <button onClick={() => this.cancel()}>Cancel</button>}
                {(running || total > 0) && (
                    <div style={{ marginTop: 8 }}>
                        <div style={{ background: '#333', height: 8, width: 300 }}>
                            <div style={{ background: '#4a90d9', height: 8, width: `${percent}%` }} />
                        </div>
                        <span>{evaluated} / {total} builds evaluated</span>
                    </div>
                )}
                {top10.length > 0 && (
                    <table style={{ marginTop: 10, width: '100%' }}>
                        <thead>
                            <tr><th>#</th><th>Damage/turn</th><th>HP loss/kill</th><th>Difficulty</th><th></th></tr>
                        </thead>
                        <tbody>
                            {top10.map((entry, i) => (
                                <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td>{entry.summary.damagePerTurn.toFixed(2)}</td>
                                    <td>{Number.isFinite(entry.summary.hpLossPerKill) ? entry.summary.hpLossPerKill.toFixed(2) : '∞'}</td>
                                    <td>{entry.summary.difficultyLabel}</td>
                                    <td><button onClick={() => onApplyBuild(entry.equipment)}>Apply</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        );
    }
}
