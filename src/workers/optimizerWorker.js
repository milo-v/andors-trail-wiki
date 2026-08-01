/* eslint-disable no-restricted-globals */
import { buildCandidateLists, searchBestBuilds } from '../utils/combat/optimizer';

let cancelled = false;

self.onmessage = async (event) => {
    const { type } = event.data;
    if (type === 'cancel') {
        cancelled = true;
        return;
    }
    if (type !== 'start') return;

    cancelled = false;
    const { build, targets, itemsById, conditionsById, locks, filtersBySlot, maxHpLoss, candidatesPerSlot, limitedItemIds, startFrom, randomSearchEnabled, disabledSlots } = event.data;

    // Without this, an exception anywhere in the search (bad monster/item data,
    // an unexpected shape) becomes an unhandled rejection inside the worker -
    // invisible to the user, who just sees the progress bar stuck at 0/0
    // forever with no indication anything went wrong.
    try {
        const items = Object.values(itemsById);
        const primaryMonster = targets.length > 0 ? targets[0].monster : null;
        const candidateLists = buildCandidateLists(items, locks, filtersBySlot, candidatesPerSlot, conditionsById, build.skillLevels, primaryMonster, disabledSlots);

        const result = await searchBestBuilds(build, targets, { itemsById, conditionsById }, candidateLists, {
            maxHpLoss,
            startFrom,
            randomSearchEnabled,
            limitedItemIds: limitedItemIds ? new Set(limitedItemIds) : null,
            onProgress: ({ evaluated, total, top10, randomEvaluated, randomTop10 }) => {
                self.postMessage({ type: 'progress', evaluated, total, top10, randomEvaluated, randomTop10 });
            },
            shouldCancel: () => cancelled,
        });

        self.postMessage({ type: 'done', top10: result.bestFirst, randomTop10: result.random });
    } catch (err) {
        self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
    }
};
