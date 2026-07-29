import { satisfiesRequirement } from './FactionCalculator';

const RELEVANT_QUEST_IDS = new Set(['scores']);
const RELEVANT_ALIGNMENT_IDS = new Set([
    'factionCountShadow', 'factionCountThieves',
    'fsc_shd', 'fsc_shd2', 'fsc_shd9',
    'fsc_fey', 'fsc_fey2', 'fsc_fey9',
    'fsc_thv', 'fsc_thv2', 'fsc_thv9',
]);

function factionForRequirement(req) {
    if (req.requireType === 'questProgress' && RELEVANT_QUEST_IDS.has(req.requireID)) {
        const bucket = req.value % 100;
        if (bucket >= 10 && bucket < 20) return 'shadow';
        if (bucket >= 20 && bucket < 30) return 'feygard';
        if (bucket >= 30 && bucket < 40) return 'thieves';
        return null;
    }
    if ((req.requireType === 'factionScore' || req.requireType === 'factionScoreEquals') && RELEVANT_ALIGNMENT_IDS.has(req.requireID)) {
        if (req.requireID.startsWith('fsc_shd') || req.requireID === 'factionCountShadow') return 'shadow';
        if (req.requireID.startsWith('fsc_fey')) return 'feygard';
        if (req.requireID.startsWith('fsc_thv') || req.requireID === 'factionCountThieves') return 'thieves';
    }
    return null;
}

function buildPhraseOwnerMap(monsters) {
    const owner = new Map();
    monsters.forEach((monster) => {
        if (!monster.conversationLink) return;
        const queue = [monster.conversationLink];
        const seen = new Set();
        while (queue.length) {
            const node = queue.shift();
            if (!node || seen.has(node.id)) continue;
            seen.add(node.id);
            if (!owner.has(node.id)) owner.set(node.id, monster);
            (node.replies || []).forEach((reply) => {
                if (reply.next) queue.push(reply.next);
            });
        }
    });
    return owner;
}

export function computeGatedContent(state, conversations, monsters) {
    const phraseOwners = buildPhraseOwnerMap(monsters);
    const results = [];
    Object.values(conversations).forEach((node) => {
        (node.replies || []).forEach((reply) => {
            (reply.requires || []).forEach((req) => {
                const faction = factionForRequirement(req);
                if (!faction) return;
                const target = conversations[reply.nextPhraseID];
                if (!target || !target.message) return;
                const npc = phraseOwners.get(target.id);
                if (!npc) return;
                results.push({
                    faction,
                    message: target.message,
                    requirement: req,
                    npc,
                    unlocked: satisfiesRequirement(req, state),
                });
            });
        });
    });
    return results;
}
