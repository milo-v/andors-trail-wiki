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
    const { build, monster, itemsById, conditionsById, locks, filtersBySlot, maxHpLossPerKill, candidatesPerSlot, limitedItemIds } = event.data;
    const items = Object.values(itemsById);
    const candidateLists = buildCandidateLists(items, locks, filtersBySlot, candidatesPerSlot);

    const top10 = await searchBestBuilds(build, monster, { itemsById, conditionsById }, candidateLists, {
        maxHpLossPerKill,
        limitedItemIds: limitedItemIds ? new Set(limitedItemIds) : null,
        onProgress: ({ evaluated, total, top10 }) => {
            self.postMessage({ type: 'progress', evaluated, total, top10 });
        },
        shouldCancel: () => cancelled,
    });

    self.postMessage({ type: 'done', top10 });
};
