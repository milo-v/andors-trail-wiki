import React, { Component } from 'react';
import SlotPicker from './SlotPicker';
import SearchableSelect from './SearchableSelect';
import Icon from '../Icon';
import ItemStatsCard from './ItemStatsCard';
import { getItemsForSlot } from './buildHelpers';
import { EQUIP_SLOTS } from '../../utils/combat/statEngine';
import { DEFAULT_CANDIDATES_PER_SLOT } from '../../utils/combat/optimizer';
import { sanitizeItemForWorker, sanitizeMonsterForWorker, sanitizeConditionForWorker } from '../../utils/combat/workerSanitize';
import { buildCandidateLists } from '../../utils/combat/optimizer';
import { isWasmSupported } from '../../utils/combat/wasmSupport';
import { runShardedSearch } from '../../utils/combat/wasmSearchCoordinator';

const SLOT_LABELS = {
    weapon: 'Weapon', shield: 'Shield/Off-hand', head: 'Head', body: 'Body', hand: 'Hand',
    feet: 'Feet', neck: 'Neck', leftring: 'Left ring', rightring: 'Right ring',
};

// Config fields (locks/filters/excluded/limited/candidatesPerSlot/etc.) are
// owned by CalculatorPage - a controlled-component pattern, same as
// build/opponentId - so they can be round-tripped through buildCodec.js's
// shareable URL alongside the rest of the page's state. Only ephemeral,
// non-shareable run state (the worker instance, its progress, results, and
// the item-card popover) stays local to this component.
export default class OptimizerPanel extends Component {
    constructor(props) {
        super(props);
        this.state = {
            running: false,
            error: null,
            evaluated: 0,
            total: 0,
            top10BestFirst: [],
            top10Random: [],
            randomEvaluated: 0,
            startFrom: '',
            randomSearchEnabled: false,
            cardItem: null,
            wasmSupported: false,
            wasmEnabled: false,
        };
        this.worker = null;
        this.wasmAbortController = null;
    }

    componentDidMount() {
        isWasmSupported().then(supported => {
            if (supported) this.setState({ wasmSupported: true, wasmEnabled: true });
        });
    }

    componentWillUnmount() {
        this.terminateWorker();
        if (this.wasmAbortController) this.wasmAbortController.abort();
    }

    terminateWorker() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    updateConfig(patch) {
        this.props.onChangeConfig(patch);
    }

    setLock(slot, itemId) {
        this.updateConfig({ locks: { ...this.props.config.locks, [slot]: itemId || undefined } });
    }

    setSlotDisabled(slot, disabled) {
        const patch = { disabledSlots: { ...this.props.config.disabledSlots, [slot]: disabled } };
        if (disabled) {
            patch.locks = { ...this.props.config.locks, [slot]: undefined };
            patch.categoryFilters = { ...this.props.config.categoryFilters, [slot]: [] };
        }
        this.updateConfig(patch);
    }

    addCategoryFilter(slot, categoryId) {
        const current = this.props.config.categoryFilters[slot] || [];
        if (!categoryId || current.includes(categoryId)) return;
        this.updateConfig({ categoryFilters: { ...this.props.config.categoryFilters, [slot]: [...current, categoryId] } });
    }

    removeCategoryFilter(slot, categoryId) {
        const current = this.props.config.categoryFilters[slot] || [];
        this.updateConfig({ categoryFilters: { ...this.props.config.categoryFilters, [slot]: current.filter(id => id !== categoryId) } });
    }

    addExcluded(itemId) {
        if (!itemId || this.props.config.excludedItemIds.includes(itemId)) return;
        this.updateConfig({ excludedItemIds: [...this.props.config.excludedItemIds, itemId] });
    }

    removeExcluded(itemId) {
        this.updateConfig({ excludedItemIds: this.props.config.excludedItemIds.filter(id => id !== itemId) });
    }

    // "Limit 1" items may still appear in the search (unlike excluded items),
    // just never twice in the same build - see optimizer.js's
    // buildWeaponShieldPairs/buildRingPairs for why that only matters for
    // rings/dual-wielding.
    addLimited(itemId) {
        if (!itemId || this.props.config.limitedItemIds.includes(itemId)) return;
        this.updateConfig({ limitedItemIds: [...this.props.config.limitedItemIds, itemId] });
    }

    removeLimited(itemId) {
        this.updateConfig({ limitedItemIds: this.props.config.limitedItemIds.filter(id => id !== itemId) });
    }

    showCard(item, event) {
        const rect = event.currentTarget.getBoundingClientRect();
        this.setState({ cardItem: item, cardPosition: { top: rect.bottom + window.scrollY, left: rect.left + window.scrollX } });
    }

    closeCard() {
        this.setState({ cardItem: null });
    }

    renderResultsTable(title, top10, multiTarget) {
        if (top10.length === 0) return null;
        const { items, onApplyBuild } = this.props;
        const itemsById = items.reduce((obj, item) => Object.assign(obj, { [item.id]: item }), {});
        return (
            <div style={{ marginTop: 10 }}>
                <h4>{title}</h4>
                <table style={{ width: '100%' }}>
                    <thead>
                        <tr><th>#</th><th>Build #</th><th>Equipment</th><th>Damage/turn</th><th>{multiTarget ? 'Avg HP loss/kill' : 'HP loss/kill'}</th><th>Difficulty</th><th></th></tr>
                    </thead>
                    <tbody>
                        {top10.map((entry, i) => (
                            <tr key={i}>
                                <td>{i + 1}</td>
                                <td>{entry.buildNumber}</td>
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
            </div>
        );
    }

    addTarget(opponentId) {
        if (!opponentId) return;
        const targets = this.props.config.optimizerTargets || [];
        this.updateConfig({ optimizerTargets: [...targets, { opponentId, hordeConfig: { enabled: false, size: 2 } }] });
    }

    addCurrentTarget() {
        const { monster, hordeConfig } = this.props;
        if (!monster) return;
        const targets = this.props.config.optimizerTargets || [];
        this.updateConfig({ optimizerTargets: [...targets, { opponentId: monster.id, hordeConfig: { ...hordeConfig } }] });
    }

    removeTarget(index) {
        const targets = this.props.config.optimizerTargets || [];
        this.updateConfig({ optimizerTargets: targets.filter((_, i) => i !== index) });
    }

    updateTarget(index, patch) {
        const targets = this.props.config.optimizerTargets || [];
        this.updateConfig({
            optimizerTargets: targets.map((t, i) => i === index ? { ...t, ...patch } : t),
        });
    }

    run() {
        const { items, monster, build, monsters } = this.props;
        const config = this.props.config;
        const configTargets = (config.optimizerTargets || []).filter(t => t.opponentId);
        if (configTargets.length === 0 && !monster) return;

        const itemsById = items.reduce((obj, item) => Object.assign(obj, { [item.id]: sanitizeItemForWorker(item) }), {});
        const conditionsById = {};
        Object.entries(this.props.conditionsById || {}).forEach(([id, condition]) => {
            conditionsById[id] = sanitizeConditionForWorker(condition);
        });

        const monstersById = (monsters || []).reduce((obj, m) => Object.assign(obj, { [m.id]: m }), {});
        let targets;
        if (configTargets.length > 0) {
            targets = configTargets.map(t => {
                const m = monstersById[t.opponentId];
                if (!m) return null;
                const hc = t.hordeConfig;
                const horde = hc && hc.enabled && Number(hc.size) > 1 ? { size: Number(hc.size) } : undefined;
                return { monster: sanitizeMonsterForWorker(m), horde };
            }).filter(Boolean);
            if (targets.length === 0) return;
        } else {
            const hordeConfig = this.props.hordeConfig;
            const horde = hordeConfig && hordeConfig.enabled && Number(hordeConfig.size) > 1 ? { size: Number(hordeConfig.size) } : undefined;
            targets = [{ monster: sanitizeMonsterForWorker(monster), horde }];
        }

        const locks = {};
        Object.entries(config.locks).forEach(([slot, itemId]) => { if (itemId) locks[slot] = itemId; });

        const maxItemLevel = config.maxItemLevel === '' ? undefined : Number(config.maxItemLevel);
        const excludedSet = new Set(config.excludedItemIds);
        const filtersBySlot = {};
        EQUIP_SLOTS.forEach(slot => {
            filtersBySlot[slot] = {
                maxItemLevel, excludedItemIds: excludedSet,
                categoryIds: new Set(config.categoryFilters[slot] || []),
            };
        });

        const maxHpLoss = config.maxHpLossPerKill === '' ? undefined : Number(config.maxHpLossPerKill);
        const candidatesPerSlot = config.unlimitedCandidates
            ? null
            : Math.max(1, Number(config.candidatesPerSlot) || DEFAULT_CANDIDATES_PER_SLOT);
        const startFrom = this.state.startFrom === '' ? 0 : Math.max(0, Number(this.state.startFrom) || 0);
        const { randomSearchEnabled, wasmEnabled, wasmSupported } = this.state;

        if (wasmEnabled && wasmSupported) {
            this.runWasm({ build, targets, itemsById, conditionsById, locks, filtersBySlot, maxHpLoss, candidatesPerSlot, disabledSlots: config.disabledSlots, limitedItemIds: config.limitedItemIds });
            return;
        }

        this.terminateWorker();
        this.worker = new Worker(new URL('../../workers/optimizerWorker.js', import.meta.url));
        this.worker.onmessage = (event) => {
            const { type, evaluated, total, top10, randomEvaluated, randomTop10, message } = event.data;
            if (type === 'progress') {
                this.setState({ evaluated, total, top10BestFirst: top10, randomEvaluated: randomEvaluated || 0, top10Random: randomTop10 || [] });
            } else if (type === 'done') {
                this.setState({ running: false, top10BestFirst: top10, top10Random: randomTop10 || [] });
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
        this.setState({ running: true, evaluated: 0, total: 0, top10BestFirst: [], top10Random: [], randomEvaluated: 0, error: null });
        try {
            this.worker.postMessage({
                type: 'start', build, targets, itemsById, conditionsById, locks, filtersBySlot, maxHpLoss, candidatesPerSlot,
                limitedItemIds: config.limitedItemIds, startFrom, randomSearchEnabled, disabledSlots: config.disabledSlots,
            });
        } catch (err) {
            // Most likely a DataCloneError - some field on the monster/items/build
            // isn't structured-clonable (a raw XML-parser node, a function, etc.)
            // and postMessage throws synchronously before the worker ever runs.
            this.setState({ running: false, error: err.message || 'Failed to start optimizer' });
            this.terminateWorker();
        }
    }

    // WASM engine path: Track A only covers the deterministic best-first
    // search (Rust/WASM worker-pool sharded), not the random-search stream
    // (that's Track B, a separate WebGPU-based plan not yet implemented) -
    // random search and the startFrom resume cursor are therefore not
    // available while this engine is active (see the disabled random-search
    // checkbox in render()). candidateLists building (valueScoring.js
    // scoring/pruning) stays on the main thread here, same as it always ran
    // inside optimizerWorker.js off-thread - it's cheap relative to the
    // search itself, and the coordinator's own worker pool is where the
    // expensive part (the search) actually runs.
    async runWasm({ build, targets, itemsById, conditionsById, locks, filtersBySlot, maxHpLoss, candidatesPerSlot, disabledSlots, limitedItemIds }) {
        this.setState({ running: true, evaluated: 0, total: 0, top10BestFirst: [], top10Random: [], randomEvaluated: 0, error: null });
        this.wasmAbortController = new AbortController();
        try {
            const items = Object.values(itemsById);
            const primaryMonster = targets.length > 0 ? targets[0].monster : null;
            const candidateLists = buildCandidateLists(items, locks, filtersBySlot, candidatesPerSlot, conditionsById, build.skillLevels, primaryMonster, disabledSlots);

            const result = await runShardedSearch(build, targets, { itemsById, conditionsById }, candidateLists, {
                maxHpLoss,
                limitedItemIds: limitedItemIds && limitedItemIds.length > 0 ? new Set(limitedItemIds) : null,
                onProgress: ({ evaluated, total }) => this.setState({ evaluated, total }),
                signal: this.wasmAbortController.signal,
            });

            this.setState({ running: false, evaluated: result.evaluated, total: result.total, top10BestFirst: result.bestFirst, top10Random: [] });
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            this.setState({ running: false, error: (err && err.message) || 'Failed to run WASM optimizer' });
        } finally {
            this.wasmAbortController = null;
        }
    }

    cancel() {
        if (this.worker) this.worker.postMessage({ type: 'cancel' });
        if (this.wasmAbortController) this.wasmAbortController.abort();
        this.setState({ running: false });
    }

    render() {
        const { items, monster, monsters, config, hordeConfig } = this.props;
        const {
            locks, disabledSlots, maxItemLevel, candidatesPerSlot, unlimitedCandidates, categoryFilters, excludedItemIds, limitedItemIds,
            maxHpLossPerKill, optimizerTargets,
        } = config;
        const targets = optimizerTargets || [];
        const { running, error, evaluated, total, top10BestFirst, top10Random, randomEvaluated, startFrom, randomSearchEnabled, wasmSupported, wasmEnabled, cardItem, cardPosition } = this.state;
        const percent = total > 0 ? Math.round((evaluated / total) * 100) : 0;

        const monstersById = (monsters || []).reduce((obj, m) => Object.assign(obj, { [m.id]: m }), {});
        const monsterOptions = (monsters || []).map(m => ({ value: m.id, label: m.name }));
        const monsterOptionsForAdd = monsterOptions.filter(o => !targets.some(t => t.opponentId === o.value));

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
                    const isDisableable = slot === 'weapon' || slot === 'shield';
                    const disabled = isDisableable && !!disabledSlots[slot];
                    const selectedCategories = categoryFilters[slot] || [];
                    const categoryOptions = categoryOptionsBySlot[slot].filter(o => !selectedCategories.includes(o.value));
                    return (
                        <div key={slot} style={{ marginBottom: 6 }}>
                            <label style={{ display: 'inline-block', width: 140 }}>{SLOT_LABELS[slot]} lock</label>
                            {isDisableable && (
                                <label style={{ marginRight: 10 }}>
                                    <input type="checkbox" checked={disabled}
                                        onChange={e => this.setSlotDisabled(slot, e.target.checked)} />
                                    {' '}{slot === 'weapon' ? 'No weapon (barehanded)' : 'No shield'}
                                </label>
                            )}
                            {!disabled && <SlotPicker slot={slot} items={items} value={locks[slot]} onChange={id => this.setLock(slot, id)} />}
                            {!disabled && !locks[slot] && categoryOptions.length + selectedCategories.length > 0 && (
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
                        onChange={e => this.updateConfig({ maxItemLevel: e.target.value })} placeholder="No cap" />
                </div>
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>Candidates per slot</label>
                    <input type="number" min="1" step="1" value={candidatesPerSlot} disabled={unlimitedCandidates}
                        onChange={e => this.updateConfig({ candidatesPerSlot: e.target.value })} />
                    <label style={{ marginLeft: 10 }}>
                        <input type="checkbox" checked={unlimitedCandidates}
                            onChange={e => this.updateConfig({ unlimitedCandidates: e.target.checked })} />
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
                        onChange={e => this.updateConfig({ maxHpLossPerKill: e.target.value })} placeholder="No limit" />
                </div>
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>Start from build #</label>
                    <input type="number" min="0" step="1" value={startFrom} disabled={wasmEnabled}
                        onChange={e => this.setState({ startFrom: e.target.value })} placeholder="0" />
                    {wasmEnabled && <span style={{ marginLeft: 6, color: '#999' }}>Not available with the WASM engine (each run always searches from the start)</span>}
                </div>
                <div style={{ marginBottom: 6 }}>
                    <label style={{ display: 'inline-block', width: 140 }}>Random search</label>
                    <input type="checkbox" checked={randomSearchEnabled} disabled={wasmEnabled}
                        onChange={e => this.setState({ randomSearchEnabled: e.target.checked })} />
                    <span style={{ marginLeft: 6, color: '#999' }}>
                        {wasmEnabled
                            ? 'Not available with the WASM engine yet (best-first search only)'
                            : 'Splits evaluations 1:1 with a separate fully-random search (slower best-first progress, chance of a surprise find)'}
                    </span>
                </div>
                {wasmSupported && (
                    <div style={{ marginBottom: 6 }}>
                        <label style={{ display: 'inline-block', width: 140 }}>WASM engine</label>
                        <input type="checkbox" checked={wasmEnabled}
                            onChange={e => this.setState({ wasmEnabled: e.target.checked })} />
                        <span style={{ marginLeft: 6, color: '#999' }}>
                            Runs the best-first search as native code across all CPU cores (faster, same results)
                        </span>
                    </div>
                )}
                <div style={{ marginBottom: 10 }}>
                    <strong>Targets</strong>
                    <div style={{ color: '#999', fontSize: '0.85em', marginBottom: 6 }}>
                        {targets.length === 0
                            ? 'No targets added — using the current opponent as the sole target.'
                            : `Optimizing for lowest average HP loss/kill across ${targets.length} target${targets.length === 1 ? '' : 's'}.`}
                    </div>
                    {targets.map((t, i) => {
                        const m = monstersById[t.opponentId];
                        const hc = t.hordeConfig || { enabled: false, size: 2 };
                        return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ minWidth: 120 }}>{m ? m.name : t.opponentId}</span>
                                <label>
                                    <input type="checkbox" checked={hc.enabled}
                                        onChange={e => this.updateTarget(i, { hordeConfig: { ...hc, enabled: e.target.checked } })} />
                                    {' '}Horde
                                </label>
                                {hc.enabled && (
                                    <input type="number" min="2" step="1" value={hc.size} style={{ width: 50 }}
                                        onChange={e => this.updateTarget(i, { hordeConfig: { ...hc, size: Math.max(2, Number(e.target.value) || 2) } })} />
                                )}
                                <button type="button" onClick={() => this.removeTarget(i)}>Remove</button>
                            </div>
                        );
                    })}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                        {monster && (
                            <button type="button" onClick={() => this.addCurrentTarget()}>
                                + Add current opponent{hordeConfig?.enabled ? ` (×${hordeConfig.size})` : ''}
                            </button>
                        )}
                        <SearchableSelect
                            options={monsterOptionsForAdd}
                            value={null}
                            onChange={id => this.addTarget(id)}
                            placeholder="Add any monster..."
                        />
                    </div>
                </div>
                <button disabled={(!monster && targets.length === 0) || running} onClick={() => this.run()}>Run optimizer</button>
                {running && <button onClick={() => this.cancel()}>Cancel</button>}
                {error && (
                    <div style={{ marginTop: 8, color: '#e05555' }}>Optimizer failed: {error}</div>
                )}
                {(running || total > 0) && (
                    <div style={{ marginTop: 8 }}>
                        <div style={{ background: '#333', height: 8, width: 300 }}>
                            <div style={{ background: '#4a90d9', height: 8, width: `${percent}%` }} />
                        </div>
                        <span>{evaluated} / {total} best-first builds evaluated</span>
                        {randomSearchEnabled && <span style={{ marginLeft: 12 }}>{randomEvaluated} random builds also checked</span>}
                    </div>
                )}
                {this.renderResultsTable('Best-first results', top10BestFirst, targets.length > 1)}
                {this.renderResultsTable('Random-search results', top10Random, targets.length > 1)}
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
