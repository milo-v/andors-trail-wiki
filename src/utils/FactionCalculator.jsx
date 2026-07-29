const FACTION_ALIGNMENT_KEYS = {
    shadow: ['factionCountShadow', 'fsc_shd', 'fsc_shd2'],
    feygard: ['fsc_fey', 'fsc_fey2'],
    thieves: ['factionCountThieves', 'fsc_thv', 'fsc_thv2'],
};

const REWARD_KEY_TO_FACTION = {};
Object.entries(FACTION_ALIGNMENT_KEYS).forEach(([faction, keys]) => {
    keys.forEach((key) => { REWARD_KEY_TO_FACTION[key] = faction; });
});

export function satisfiesRequirement(req, state) {
    if (req.requireType === 'questProgress') {
        return state.questProgressOverlay.get(req.requireID)?.has(req.value) || false;
    }
    if (req.requireType === 'factionScore') {
        return (state.alignments.get(req.requireID) || 0) >= req.value;
    }
    if (req.requireType === 'factionScoreEquals') {
        return (state.alignments.get(req.requireID) || 0) === req.value;
    }
    return true;
}

function scoresFactionForProgress(value) {
    const bucket = value % 100;
    if (bucket >= 10 && bucket < 20) return 'shadow';
    if (bucket >= 20 && bucket < 30) return 'feygard';
    if (bucket >= 30 && bucket < 40) return 'thieves';
    return null;
}

export function computeFactionState(realQuestProgress, conversations, quests) {
    const alignments = new Map();
    const questProgressOverlay = new Map();
    realQuestProgress.forEach((set, qid) => questProgressOverlay.set(qid, new Set(set)));

    const state = { alignments, questProgressOverlay };
    const decisions = { shadow: [], feygard: [], thieves: [] };

    const describeSource = (source) => {
        if (!source) return null;
        const stage = quests[source.requireID]?.stages?.find((s) => s.progress === source.value);
        return {
            questID: source.requireID,
            thresholdValue: source.value,
            description: stage?.logText || `${source.requireID}: ${source.value}`,
        };
    };

    const applyReward = (reward, source) => {
        const { rewardType, rewardID, value } = reward;
        if (rewardType === 'alignmentChange') {
            const before = alignments.get(rewardID) || 0;
            alignments.set(rewardID, before + value);
            const faction = REWARD_KEY_TO_FACTION[rewardID];
            if (faction && value !== 0) {
                const sourceInfo = describeSource(source);
                if (sourceInfo) decisions[faction].push({ ...sourceInfo, delta: value });
            }
        } else if (rewardType === 'alignmentSet') {
            alignments.set(rewardID, value);
        } else if (rewardType === 'alignmentToReg1') {
            alignments.set('reg1', alignments.get(rewardID) || 0);
        } else if (rewardType === 'alignmentFromReg1') {
            alignments.set(rewardID, alignments.get('reg1') || 0);
        } else if (rewardType === 'alignmentDiv') {
            const denominator = alignments.get(rewardID) || 0;
            if (denominator !== 0) {
                const numerator = (alignments.get('reg1') || 0) * value;
                alignments.set('reg1', Math.trunc(numerator / denominator));
            }
        } else if (rewardType === 'questProgress') {
            if (!questProgressOverlay.has(rewardID)) questProgressOverlay.set(rewardID, new Set());
            questProgressOverlay.get(rewardID).add(value);
        } else if (rewardType === 'removeQuestProgress') {
            questProgressOverlay.get(rewardID)?.delete(value);
        }
    };

    let currentId = 'faction_count_shadow';
    let currentSource = null;
    const visited = new Set();
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const node = conversations[currentId];
        if (!node) break;
        (node.rewards || []).forEach((reward) => applyReward(reward, currentSource));

        const replies = node.replies || [];
        let nextId = null;
        let nextSource = null;
        for (const reply of replies) {
            const requires = reply.requires || [];
            if (requires.every((req) => satisfiesRequirement(req, state))) {
                nextId = reply.nextPhraseID;
                nextSource = requires.length ? { requireID: requires[0].requireID, value: requires[0].value } : null;
                break;
            }
        }
        currentId = nextId;
        currentSource = nextSource;
    }

    const standingLabel = (faction) => {
        const values = Array.from(questProgressOverlay.get('scores') || []).filter((v) => scoresFactionForProgress(v) === faction);
        const labels = values
            .map((v) => quests.scores?.stages?.find((s) => s.progress === v)?.logText)
            .filter((text) => text && text.trim().length > 0);
        return labels.length ? labels.join(' / ') : 'Unknown';
    };

    const factions = {};
    const percentKeys = { shadow: 'fsc_shd2', feygard: 'fsc_fey2', thieves: 'fsc_thv2' };
    ['shadow', 'feygard', 'thieves'].forEach((faction) => {
        factions[faction] = {
            percent: alignments.get(percentKeys[faction]) || 0,
            standingLabel: standingLabel(faction),
            decisions: decisions[faction],
        };
    });

    return { alignments, questProgressOverlay, factions };
}
