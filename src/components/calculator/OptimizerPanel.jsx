import React, { Component } from 'react';
import SlotPicker from './SlotPicker';
import SearchableSelect from './SearchableSelect';
import Icon from '../Icon';
import ItemStatsCard from './ItemStatsCard';
import { getItemsForSlot } from './buildHelpers';
import { EQUIP_SLOTS } from '../../utils/combat/statEngine';
import { DEFAULT_CANDIDATES_PER_SLOT } from '../../utils/combat/optimizer';
import { sanitizeItemForWorker, sanitizeMonsterForWorker, sanitizeConditionForWorker } from '../../utils/combat/workerSanitize';

const SLOT_LABELS = {
    weapon: 'Weapon', shield: 'Shield/Off-hand', head: 'Head', body: 'Body', hand: 'Hand',
    feet: 'Feet', neck: 'Neck', leftring: 'Left ring', rightring: 'Right ring',
};

export default class OptimizerPanel extends Component {
    constructor(props) {
        super(props);
        this.state = {
            locks: {},
            maxItemLevel: '',
            candidatesPerSlot: String(DEFAULT_CANDIDATES_PER_SLOT),
            unlimitedCandidates: false,
            categoryFilters: {},
            excludedItemIds: [],
            limitedItemIds: [],
            maxHpLossPerKill: '',
            running: false,
            error: null,
            evaluated: 0,
            total: 0,
            top10: [],
            cardItem: null,
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

    addCategoryFilter(slot, categoryId) {
        const current = this.state.categoryFilters[slot] || [];
        if (!categoryId || current.includes(categoryId)) return;
        this.setState({ categoryFilters: { ...this.state.categoryFilters, [slot]: [...current, categoryId] } });
    }

    removeCategoryFilter(slot, categoryId) {
        const current = this.state.categoryFilters[slot] || [];
        this.setState({ categoryFilters: { ...this.state.categoryFilters, [slot]: current.filter(id => id !== categoryId) } });
    }

    addExcluded(itemId) {
        if (!itemId || this.state.excludedItemIds.includes(itemId)) return;
        this.setState({ excludedItemIds: [...this.state.excludedItemIds, itemId] });
    }

    removeExcluded(itemId) {
        this.setState({ excludedItemIds: this.state.excludedItemIds.filter(id => id !== itemId) });
    }

    // "Limit 1" items may still appear in the search (unlike excluded items),
    // just never twice in the same build - see optimizer.js's
    // hasDisallowedDuplicate for why that only matters for rings/dual-wielding.
    addLimited(itemId) {
        if (!itemId || this.state.limitedItemIds.includes(itemId)) return;
        this.setState({ limitedItemIds: [...this.state.limitedItemIds, itemId] });
    }

    removeLimited(itemId) {
        this.setState({ limitedItemIds: this.state.limitedItemIds.filter(id => id !== itemId) });
    }

    showCard(item, event) {
        const rect = event.currentTarget.getBoundingClientRect();
        this.setState({ cardItem: item, cardPosition: { top: rect.bottom + window.scrollY, left: rect.left + window.scrollX } });
    }

    closeCard() {
        this.setState({ cardItem: null });
    }

    run() {
        const { items, monster, build } = this.props;
        if (!monster) return;

        const itemsById = items.reduce((obj, item) => Object.assign(obj, { [item.id]: sanitizeItemForWorker(item) }), {});
        const sanitizedMonster = sanitizeMonsterForWorker(monster);
        const conditionsById = {};
        Object.entries(this.props.conditionsById || {}).forEach(([id, condition]) => {
            conditionsById[id] = sanitizeConditionForWorker(condition);
        });

        const locks = {};
        Object.entries(this.state.locks).forEach(([slot, itemId]) => { if (itemId) locks[slot] = itemId; });

        const maxItemLevel = this.state.maxItemLevel === '' ? undefined : Number(this.state.maxItemLevel);
        const excludedSet = new Set(this.state.excludedItemIds);
        const filtersBySlot = {};
        EQUIP_SLOTS.forEach(slot => {
            filtersBySlot[slot] = {
                maxItemLevel, excludedItemIds: excludedSet,
                categoryIds: new Set(this.state.categoryFilters[slot] || []),
            };
        });

        const maxHpLossPerKill = this.state.maxHpLossPerKill === '' ? undefined : Number(this.state.maxHpLossPerKill);
        const candidatesPerSlot = this.state.unlimitedCandidates
            ? null
            : Math.max(1, Number(this.state.candidatesPerSlot) || DEFAULT_CANDIDATES_PER_SLOT);

        this.terminateWorker();
        this.worker = new Worker(new URL('../../workers/optimizerWorker.js', import.meta.url));
        this.worker.onmessage = (event) => {
            const { type, evaluated, total, top10, message } = event.data;
            if (type === 'progress') {
                this.setState({ evaluated, total, top10 });
            } else if (type === 'done') {
                this.setState({ running: false, top10 });
                this.terminateWorker();
            } else if (type === 'error') {
                this.setState({ running: false, error: message });
                this.terminateWorker();
            }
        };
        // Runtime errors thrown inside the worker's own event loop (as opposed
        // to a rejected promise, which optimizerWorker.js's try/catch already
        // turns into an 'error' message above) surface here instead.
        this.worker.onerror = (event) => {
            this.setState({ running: false, error: event.message || 'Optimizer worker crashed' });
            this.terminateWorker();
        };
        this.setState({ running: true, evaluated: 0, total: 0, top10: [], error: null });
        try {
            this.worker.postMessage({
                type: 'start', build, monster: sanitizedMonster, itemsById, conditionsById, locks, filtersBySlot, maxHpLossPerKill, candidatesPerSlot,
                limitedItemIds: this.state.limitedItemIds,
            });
        } catch (err) {
            // Most likely a DataCloneError - some field on the monster/items/build
            // isn't structured-clonable (a raw XML-parser node, a function, etc.)
            // and postMessage throws synchronously before the worker ever runs.
            this.setState({ running: false, error: err.message || 'Failed to start optimizer' });
            this.terminateWorker();
        }
    }

    cancel() {
        if (this.worker) this.worker.postMessage({ type: 'cancel' });
        this.setState({ running: false });
    }

    render() {
        const { items, monster, onApplyBuild } = this.props;
        const {
            locks, maxItemLevel, candidatesPerSlot, unlimitedCandidates, categoryFilters, excludedItemIds, limitedItemIds,
            maxHpLossPerKill, running, error, evaluated, total, top10, cardItem, cardPosition,
        } = this.state;
        const percent = total > 0 ? Math.round((evaluated / total) * 100) : 0;

        const itemsById = items.reduce((obj, item) => Object.assign(obj, { [item.id]: item }), {});
        const excludableOptions = items
            .filter(item => !excludedItemIds.includes(item.id))
            .map(item => ({ value: item.id, label: item.name }));
        const limitableOptions = items
            .filter(item => !limitedItemIds.includes(item.id))
            .map(item => ({ value: item.id, label: item.name }));

        const categoryOptionsBySlot = {};
        EQUIP_SLOTS.forEach(slot => {
            const seen = new Map();
            getItemsForSlot(slot, items).forEach(item => {
                if (item.categoryLink) seen.set(item.category, item.categoryLink.name);
            });
            categoryOptionsBySlot[slot] = [...seen.entries()].map(([value, label]) => ({ value, label }));
        });

        return (
            <div style={{ marginTop: 20, borderTop: '1px solid #444', paddingTop: 10 }}>
                <h3>Equipment optimizer</h3>
                {EQUIP_SLOTS.map(slot => {
                    const selectedCategories = categoryFilters[slot] || [];
                    const categoryOptions = categoryOptionsBySlot[slot].filter(o => !selectedCategories.includes(o.value));
                    return (
                        <div key={slot} style={{ marginBottom: 6 }}>
                            <label style={{ display: 'inline-block', width: 140 }}>{SLOT_LABELS[slot]} lock</label>
                            <SlotPicker slot={slot} items={items} value={locks[slot]} onChange={id => this.setLock(slot, id)} />
                            {!locks[slot] && categoryOptions.length + selectedCategories.length > 0 && (
                                <div style={{ margin: '2px 0 0 140px' }}>
                                    <SearchableSelect
                                        options={categoryOptions}
                                        value={null}
                                        onChange={id => this.addCategoryFilter(slot, id)}
                                        placeholder="Restrict to category..."
                                    />
                                    {selectedCategories.map(id => (
                                        <span key={id} style={{ marginLeft: 6 }}>
                                            {categoryOptionsBySlot[slot].find(o => o.value === id)?.label || id}
                                            <button type="button" onClick={() => this.removeCategoryFilter(slot, id)} style={{ marginLeft: 4 }}>×</button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>Max item level</label>
                    <input type="number" step="5" value={maxItemLevel}
                        onChange={e => this.setState({ maxItemLevel: e.target.value })} placeholder="No cap" />
                </div>
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>Candidates per slot</label>
                    <input type="number" min="1" step="1" value={candidatesPerSlot} disabled={unlimitedCandidates}
                        onChange={e => this.setState({ candidatesPerSlot: e.target.value })} />
                    <label style={{ marginLeft: 10 }}>
                        <input type="checkbox" checked={unlimitedCandidates}
                            onChange={e => this.setState({ unlimitedCandidates: e.target.checked })} />
                        {' '}Unlimited
                    </label>
                </div>
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140, verticalAlign: 'top' }}>Excluded items</label>
                    <SearchableSelect
                        options={excludableOptions}
                        value={null}
                        onChange={id => this.addExcluded(id)}
                        placeholder="Add item to exclude..."
                    />
                    {excludedItemIds.length > 0 && (
                        <ul style={{ margin: '4px 0 0 140px', padding: 0, listStyle: 'none' }}>
                            {excludedItemIds.map(id => (
                                <li key={id}>
                                    {itemsById[id]?.name || id}
                                    <button type="button" onClick={() => this.removeExcluded(id)} style={{ marginLeft: 8 }}>Remove</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140, verticalAlign: 'top' }}>Limit to 1 copy</label>
                    <SearchableSelect
                        options={limitableOptions}
                        value={null}
                        onChange={id => this.addLimited(id)}
                        placeholder="Add single-copy item..."
                    />
                    {limitedItemIds.length > 0 && (
                        <ul style={{ margin: '4px 0 0 140px', padding: 0, listStyle: 'none' }}>
                            {limitedItemIds.map(id => (
                                <li key={id}>
                                    {itemsById[id]?.name || id}
                                    <button type="button" onClick={() => this.removeLimited(id)} style={{ marginLeft: 8 }}>Remove</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>Max HP loss/kill</label>
                    <input type="number" value={maxHpLossPerKill}
                        onChange={e => this.setState({ maxHpLossPerKill: e.target.value })} placeholder="No limit" />
                </div>
                <button disabled={!monster || running} onClick={() => this.run()}>Run optimizer</button>
                {running && <button onClick={() => this.cancel()}>Cancel</button>}
                {error && (
                    <div style={{ marginTop: 8, color: '#e05555' }}>Optimizer failed: {error}</div>
                )}
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
                            <tr><th>#</th><th>Equipment</th><th>Damage/turn</th><th>HP loss/kill</th><th>Difficulty</th><th></th></tr>
                        </thead>
                        <tbody>
                            {top10.map((entry, i) => (
                                <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                            {EQUIP_SLOTS.map(slot => {
                                                const item = itemsById[entry.equipment[slot]];
                                                if (!item) return null;
                                                return (
                                                    <div key={slot} style={{ width: 24, height: 24, overflow: 'hidden', cursor: 'pointer' }}
                                                        onClickCapture={e => { e.preventDefault(); e.stopPropagation(); this.showCard(item, e); }}>
                                                        <div style={{ width: 32, height: 32, transform: 'scale(0.75)', transformOrigin: 'top left' }}>
                                                            <Icon data={item} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </td>
                                    <td>{entry.summary.damagePerTurn.toFixed(2)}</td>
                                    <td>{Number.isFinite(entry.summary.hpLossPerKill) ? entry.summary.hpLossPerKill.toFixed(2) : '∞'}</td>
                                    <td>{entry.summary.difficultyLabel}</td>
                                    <td><button onClick={() => onApplyBuild(entry.equipment)}>Apply</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {cardItem && (
                    <ItemStatsCard
                        item={cardItem}
                        top={cardPosition.top}
                        left={cardPosition.left}
                        onExclude={() => { this.addExcluded(cardItem.id); this.closeCard(); }}
                        onLimit={() => { this.addLimited(cardItem.id); this.closeCard(); }}
                        onClose={() => this.closeCard()}
                    />
                )}
            </div>
        );
    }
}
