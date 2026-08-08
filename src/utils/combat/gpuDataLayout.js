// Packs item/build/monster/condition data into the flat typed-array buffers
// randomSearch.wgsl (Phase B2) reads. Field order and sentinel values are
// documented in gpu-buffer-layout.md — keep both in sync.
import { EQUIP_SLOTS, isWeapon, isShield, isTwohandWeapon, computeProficiencyBonus } from './statEngine';
import { averageRange } from './procEffects';
import { SKILL_IDS } from './skillData';

export const PROC_SLOT_COUNT = 4;
export const CONDITION_SLOT_COUNT = 256;
export const NO_CONDITION = 0xffffffff;
export const NO_ITEM = 0xffffffff;

export const ITEM_FLOAT_STRIDE = 101;
export const ITEM_U32_STRIDE = 28;
export const BUILD_MONSTER_FLOAT_STRIDE = 93;
export const BUILD_MONSTER_U32_STRIDE = 20;
export const CONDITION_STRIDE = 13;
export const COMBO_STRIDE = 9;

const PROC_FIELDS = [
    { key: 'addedConditions', floatBase: 21, u32Base: 4, isEquipEffect: true },
    { key: 'hitEffect.conditionsSource', floatBase: 33, u32Base: 8 },
    { key: 'hitEffect.conditionsTarget', floatBase: 45, u32Base: 12 },
    { key: 'hitReceivedEffect.conditionsSource', floatBase: 57, u32Base: 16 },
    { key: 'hitReceivedEffect.conditionsTarget', floatBase: 69, u32Base: 20 },
    { key: 'killEffect.conditionsSource', floatBase: 81, u32Base: 24 },
];

function getByPath(obj, path) {
    if (path === 'addedConditions') return obj?.equipEffect?.addedConditions;
    const [effKey, listKey] = path.split('.');
    return obj?.[effKey]?.[listKey];
}

// Assigns every known condition a stable dense index, in Object.keys order -
// must be the same order packConditionTable uses to build conditionTable, so
// a proc slot's conditionIndex always looks up the right row.
export function buildConditionIndex(conditionsById) {
    const index = {};
    Object.keys(conditionsById).forEach((id, i) => { index[id] = i; });
    return index;
}

function packProcSlots(floatBuffer, u32Buffer, recordFloatOffset, recordU32Offset, entity, conditionIndexById) {
    for (const field of PROC_FIELDS) {
        const entries = getByPath(entity, field.key) || [];
        for (let s = 0; s < PROC_SLOT_COUNT; s++) {
            const fOff = recordFloatOffset + field.floatBase + s * 3;
            const uOff = recordU32Offset + field.u32Base + s;
            const entry = entries[s];
            if (!entry) {
                u32Buffer[uOff] = NO_CONDITION;
                continue;
            }
            const idx = conditionIndexById[entry.condition];
            if (idx === undefined) {
                u32Buffer[uOff] = NO_CONDITION;
                continue;
            }
            u32Buffer[uOff] = idx;
            floatBuffer[fOff] = entry.magnitude || 0;
            // equipEffect.addedConditions entries have no chance/duration in
            // the JSON - they're a permanent condition while equipped, so
            // pack chance=100 for uniformity with the proc-slot reader.
            floatBuffer[fOff + 1] = field.isEquipEffect ? 100 : Number(entry.chance) || 0;
            floatBuffer[fOff + 2] = field.isEquipEffect ? 0 : (entry.duration || 0);
        }
    }
}

function packItemRecord(floatBuffer, u32Buffer, recordIndex, item, pool, skillLevels, conditionIndexById) {
    const floatOff = recordIndex * ITEM_FLOAT_STRIDE;
    const u32Off = recordIndex * ITEM_U32_STRIDE;
    const e = item.equipEffect;

    u32Buffer[u32Off] = isWeapon(item) ? 1 : 0;
    u32Buffer[u32Off + 1] = isShield(item) ? 1 : 0;
    u32Buffer[u32Off + 2] = isTwohandWeapon(item) ? 1 : 0;
    u32Buffer[u32Off + 3] = e ? 1 : 0;

    if (e) {
        floatBuffer[floatOff + 0] = e.increaseAttackDamage?.min || 0;
        floatBuffer[floatOff + 1] = e.increaseAttackDamage?.max || 0;
        floatBuffer[floatOff + 2] = e.increaseAttackCost || 0;
        floatBuffer[floatOff + 3] = e.increaseAttackChance || 0;
        floatBuffer[floatOff + 4] = e.increaseCriticalSkill || 0;
        floatBuffer[floatOff + 5] = e.increaseBlockChance || 0;
        floatBuffer[floatOff + 6] = e.increaseDamageResistance || 0;
        floatBuffer[floatOff + 7] = e.increaseMaxHP || 0;
        floatBuffer[floatOff + 8] = e.increaseMaxAP || 0;
        floatBuffer[floatOff + 9] = e.increaseMoveCost || 0;
        floatBuffer[floatOff + 10] = e.increaseUseItemCost || 0;
        floatBuffer[floatOff + 11] = e.increaseReequipCost || 0;
        floatBuffer[floatOff + 12] = e.setCriticalMultiplier || 0;
        floatBuffer[floatOff + 13] = e.setNonWeaponDamageModifier != null ? e.setNonWeaponDamageModifier : -1;
    } else {
        floatBuffer[floatOff + 13] = -1;
    }

    const prof = computeProficiencyBonus(item, pool, skillLevels || {});
    floatBuffer[floatOff + 14] = prof.increaseAttackChance || 0;
    floatBuffer[floatOff + 15] = prof.increaseBlockChance || 0;
    floatBuffer[floatOff + 16] = prof.increaseCriticalSkill || 0;
    floatBuffer[floatOff + 17] = prof.increaseDamageResistance || 0;
    floatBuffer[floatOff + 18] = prof.increaseAttackCost || 0;
    floatBuffer[floatOff + 19] = prof.increaseAttackDamage?.min || 0;
    floatBuffer[floatOff + 20] = prof.increaseAttackDamage?.max || 0;

    packProcSlots(floatBuffer, u32Buffer, floatOff, u32Off, item, conditionIndexById);

    floatBuffer[floatOff + 93] = averageRange(item.hitEffect?.increaseCurrentAP);
    floatBuffer[floatOff + 94] = averageRange(item.hitReceivedEffect?.increaseCurrentAP);
    floatBuffer[floatOff + 95] = averageRange(item.hitReceivedEffect?.increaseAttackerCurrentAP);
    floatBuffer[floatOff + 96] = averageRange(item.hitEffect?.increaseCurrentHP);
    floatBuffer[floatOff + 97] = averageRange(item.hitReceivedEffect?.increaseCurrentHP);
    floatBuffer[floatOff + 98] = averageRange(item.hitReceivedEffect?.increaseAttackerCurrentHP);
    floatBuffer[floatOff + 99] = averageRange(item.killEffect?.increaseCurrentHP);
    floatBuffer[floatOff + 100] = averageRange(item.killEffect?.increaseCurrentAP);
}

// candidateLists: { [slot]: Item[] }, same shape optimizer.js's
// buildCandidateLists produces. Packs every slot's pool into one combined
// buffer, EQUIP_SLOTS order, and returns the per-slot start offsets so combo
// indices (local to a slot's pool) can be translated to a global record row.
export function packItemBuffer(candidateLists, skillLevels, conditionIndexById) {
    let total = 0;
    const slotOffsets = {};
    const slotCounts = {};
    for (const slot of EQUIP_SLOTS) {
        slotOffsets[slot] = total;
        const count = (candidateLists[slot] || []).length;
        slotCounts[slot] = count;
        total += count;
    }

    const floatBuffer = new Float32Array(total * ITEM_FLOAT_STRIDE);
    const u32Buffer = new Uint32Array(total * ITEM_U32_STRIDE);

    for (const slot of EQUIP_SLOTS) {
        const pool = candidateLists[slot] || [];
        for (let i = 0; i < pool.length; i++) {
            packItemRecord(floatBuffer, u32Buffer, slotOffsets[slot] + i, pool[i], slot, skillLevels, conditionIndexById);
        }
    }

    return { floatBuffer, u32Buffer, slotOffsets, slotCounts };
}

function packStatsFields(floatBuffer, offset, stats) {
    floatBuffer[offset + 0] = stats.attackCost;
    floatBuffer[offset + 1] = stats.attackChance;
    floatBuffer[offset + 2] = stats.criticalSkill;
    floatBuffer[offset + 3] = stats.criticalMultiplier;
    floatBuffer[offset + 4] = stats.damagePotential.min;
    floatBuffer[offset + 5] = stats.damagePotential.max;
    floatBuffer[offset + 6] = stats.blockChance;
    floatBuffer[offset + 7] = stats.damageResistance;
    floatBuffer[offset + 8] = stats.maxHP;
}

// playerBaseStats: buildBaseStats(...) with applyGeneralCombatSkills(...)
// already applied (search-invariant - see gpu-buffer-layout.md's "Design"
// section), same object shape resolvePlayerStats returns before equipment.
// monsterStats: resolveMonsterStats(monster, monster.activeConditions, conditionsById).
export function packBuildAndMonsterBuffer(playerBaseStats, monster, monsterStats, build, conditionIndexById) {
    const floatBuffer = new Float32Array(BUILD_MONSTER_FLOAT_STRIDE);
    const u32Buffer = new Uint32Array(BUILD_MONSTER_U32_STRIDE);

    packStatsFields(floatBuffer, 0, playerBaseStats);
    floatBuffer[9] = playerBaseStats.maxAP;

    packStatsFields(floatBuffer, 10, monsterStats);
    floatBuffer[19] = monsterStats.maxAP;
    floatBuffer[20] = monsterStats.isImmuneToCriticalHits ? 1 : 0;

    const horde = build.horde;
    floatBuffer[21] = horde && horde.size > 1 ? horde.size : 1;

    floatBuffer[22] = averageRange(monster.hitEffect?.increaseCurrentAP);
    floatBuffer[23] = averageRange(monster.hitReceivedEffect?.increaseCurrentAP);
    floatBuffer[24] = averageRange(monster.hitReceivedEffect?.increaseAttackerCurrentAP);
    floatBuffer[25] = averageRange(monster.hitReceivedEffect?.increaseAttackerCurrentHP);
    floatBuffer[26] = averageRange(monster.hitReceivedEffect?.increaseCurrentHP);

    const monsterProcFields = [
        { key: 'hitEffect.conditionsSource', floatBase: 27, u32Base: 0 },
        { key: 'hitEffect.conditionsTarget', floatBase: 39, u32Base: 4 },
        { key: 'hitReceivedEffect.conditionsSource', floatBase: 51, u32Base: 8 },
        { key: 'hitReceivedEffect.conditionsTarget', floatBase: 63, u32Base: 12 },
    ];
    for (const field of monsterProcFields) {
        const [effKey, listKey] = field.key.split('.');
        const entries = monster[effKey]?.[listKey] || [];
        for (let s = 0; s < PROC_SLOT_COUNT; s++) {
            const fOff = field.floatBase + s * 3;
            const uOff = field.u32Base + s;
            const entry = entries[s];
            if (!entry) {
                u32Buffer[uOff] = NO_CONDITION;
                continue;
            }
            const idx = conditionIndexById[entry.condition];
            if (idx === undefined) {
                u32Buffer[uOff] = NO_CONDITION;
                continue;
            }
            u32Buffer[uOff] = idx;
            floatBuffer[fOff] = entry.magnitude || 0;
            floatBuffer[fOff + 1] = Number(entry.chance) || 0;
            floatBuffer[fOff + 2] = entry.duration || 0;
        }
    }

    const lvl = (id) => build.skillLevels?.[id] || 0;
    floatBuffer[75] = lvl(SKILL_IDS.TAUNT);
    floatBuffer[76] = lvl(SKILL_IDS.CONCUSSION);
    floatBuffer[77] = lvl(SKILL_IDS.CRIT1);
    floatBuffer[78] = lvl(SKILL_IDS.CRIT2);
    floatBuffer[79] = lvl(SKILL_IDS.EATER);
    floatBuffer[80] = lvl(SKILL_IDS.CLEAVE);

    const activeConditions = build.activeConditions || [];
    for (let s = 0; s < PROC_SLOT_COUNT; s++) {
        const fOff = 81 + s * 3;
        const uOff = 16 + s;
        const entry = activeConditions[s];
        if (!entry) {
            u32Buffer[uOff] = NO_CONDITION;
            continue;
        }
        const idx = conditionIndexById[entry.conditionId];
        if (idx === undefined) {
            u32Buffer[uOff] = NO_CONDITION;
            continue;
        }
        u32Buffer[uOff] = idx;
        floatBuffer[fOff] = entry.magnitude || 0;
        floatBuffer[fOff + 1] = 100;
        floatBuffer[fOff + 2] = 0;
    }

    return { buildAndMonsterBuffer: floatBuffer, buildAndMonsterU32Buffer: u32Buffer };
}

export function packConditionTable(conditionsById, conditionIndexById) {
    const count = Object.keys(conditionIndexById).length;
    const table = new Float32Array(count * CONDITION_STRIDE);
    for (const [id, idx] of Object.entries(conditionIndexById)) {
        const condition = conditionsById[id];
        const off = idx * CONDITION_STRIDE;
        table[off] = condition.isStacking ? 1 : 0;
        const ae = condition.abilityEffect;
        table[off + 1] = ae ? 1 : 0;
        if (ae) {
            table[off + 2] = ae.increaseMaxHP || 0;
            table[off + 3] = ae.increaseMaxAP || 0;
            table[off + 4] = ae.increaseMoveCost || 0;
            table[off + 5] = ae.increaseAttackCost || 0;
            table[off + 6] = ae.increaseAttackChance || 0;
            table[off + 7] = ae.increaseCriticalSkill || 0;
            table[off + 8] = ae.increaseAttackDamage?.min || 0;
            table[off + 9] = ae.increaseAttackDamage?.max || 0;
            table[off + 10] = ae.increaseBlockChance || 0;
            table[off + 11] = ae.increaseDamageResistance || 0;
        }
        table[off + 12] = averageRange(condition.roundEffect?.increaseCurrentHP);
    }
    return table;
}
