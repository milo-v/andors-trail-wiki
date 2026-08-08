// Full-formula port of computeCombatSummary (src/utils/combat/combatMath.js)
// + the equipment-dependent portion of resolvePlayerStats
// (src/utils/combat/statEngine.js) for the WebGPU random-search engine.
// One invocation evaluates one random equipment combo. Buffer layout is
// documented field-for-field in gpu-buffer-layout.md — keep both in sync.
//
// Search-invariant inputs (player base traits + general combat skills,
// monster stats) are precomputed once in JS and uploaded via the
// buildAndMonster buffer (see gpu-buffer-layout.md's "Design" section) -
// this shader only computes the combo-dependent remainder: equipment
// ability effects, fighting styles/dual-wield, equip-added conditions
// merged with build.activeConditions, item procs, then the same
// combatMath.js formula Track A's Rust port already implements.

const PROC_SLOT_COUNT: u32 = 4u;
const CONDITION_SLOT_COUNT: u32 = 256u;
const NO_CONDITION: u32 = 0xFFFFFFFFu;
const NO_ITEM: u32 = 0xFFFFFFFFu;

const ITEM_FLOAT_STRIDE: u32 = 101u;
const ITEM_U32_STRIDE: u32 = 28u;
const BUILD_MONSTER_FLOAT_STRIDE: u32 = 93u;
const BUILD_MONSTER_U32_STRIDE: u32 = 20u;
const CONDITION_STRIDE: u32 = 13u;
const COMBO_STRIDE: u32 = 9u;

// EQUIP_SLOTS order (statEngine.js) - combo index slot 0..8.
const SLOT_WEAPON: u32 = 0u;
const SLOT_SHIELD: u32 = 1u;
const SLOT_HEAD: u32 = 2u;
const SLOT_BODY: u32 = 3u;
const SLOT_HAND: u32 = 4u;
const SLOT_FEET: u32 = 5u;
const SLOT_NECK: u32 = 6u;
const SLOT_LEFTRING: u32 = 7u;
const SLOT_RIGHTRING: u32 = 8u;

// SKILL_CONSTANTS (skillData.js) used directly by this shader's ported
// functions (fighting styles, dual-wield, general skill procs). Kept as
// named constants, not read from a buffer - these are fixed game constants,
// not per-search configuration.
const FIGHTSTYLE_2HAND_DMG_PERCENT: f32 = 30.0;
const SPECIALIZATION_2HAND_DMG_PERCENT: f32 = 50.0;
const SPECIALIZATION_2HAND_AC_PERCENT: f32 = 20.0;
const FIGHTSTYLE_WEAPON_AC_PERCENT: f32 = 25.0;
const FIGHTSTYLE_SHIELD_BC_PERCENT: f32 = 25.0;
const SPECIALIZATION_WEAPON_AC_PERCENT: f32 = 50.0;
const SPECIALIZATION_WEAPON_DMG_PERCENT: f32 = 20.0;
const DUALWIELD_EFFICIENCY_LEVEL0: f32 = 25.0;
const DUALWIELD_EFFICIENCY_LEVEL1: f32 = 50.0;
const DUALWIELD_EFFICIENCY_LEVEL2: f32 = 100.0;
const DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT: f32 = 50.0;
const SPECIALIZATION_DUALWIELD_AC_PERCENT: f32 = 50.0;
const SPECIALIZATION_DUALWIELD_BC_PERCENT: f32 = 50.0;
const CRIT1_CHANCE_PERCENT: f32 = 50.0;
const CRIT2_CHANCE_PERCENT: f32 = 50.0;
const CRIT_CONDITION_MAGNITUDE: f32 = 1.0;
const CRIT_CONDITION_DURATION: f32 = 5.0;
const TAUNT_CHANCE_PERCENT: f32 = 75.0;
const TAUNT_AP_LOSS: f32 = 2.0;
const CONCUSSION_CHANCE_PERCENT: f32 = 15.0;
const CONCUSSION_THRESHOLD: f32 = 50.0;
const CONCUSSION_CONDITION_MAGNITUDE: f32 = 1.0;
const CONCUSSION_CONDITION_DURATION: f32 = 5.0;
const EATER_HEALTH: f32 = 1.0;
const CLEAVE_AP: f32 = 3.0;

struct CombatSummaryGpu {
    hp_loss_per_kill: f32,
    damage_per_turn: f32,
    hp_loss_per_turn: f32,
    hp_gain_per_turn: f32,
    hp_gain_per_kill: f32,
    difficulty: f32,
};

@group(0) @binding(0) var<storage, read> itemFloats: array<f32>;
@group(0) @binding(1) var<storage, read> itemU32s: array<u32>;
@group(0) @binding(2) var<storage, read> buildAndMonster: array<f32>;
@group(0) @binding(3) var<storage, read> buildAndMonsterU32: array<u32>;
@group(0) @binding(4) var<storage, read> conditionTable: array<f32>;
@group(0) @binding(5) var<storage, read> comboIndices: array<u32>;
@group(0) @binding(6) var<storage, read_write> outputResults: array<CombatSummaryGpu>;

// --- PlayerStats-equivalent, 9 f32 fields matching gpu-buffer-layout.md's
// packStatsFields order: attackCost, attackChance, criticalSkill,
// criticalMultiplier, damageMin, damageMax, blockChance, damageResistance,
// maxHP. maxAP kept separate (matches JS's separate treatment of maxAP via
// playerBonusAP/monsterBonusAP deltas in combatMath.js).
struct Stats {
    attackCost: f32,
    attackChance: f32,
    criticalSkill: f32,
    criticalMultiplier: f32,
    damageMin: f32,
    damageMax: f32,
    blockChance: f32,
    damageResistance: f32,
    maxHP: f32,
    maxAP: f32,
};

fn readStats(base: u32) -> Stats {
    var s: Stats;
    s.attackCost = buildAndMonster[base + 0u];
    s.attackChance = buildAndMonster[base + 1u];
    s.criticalSkill = buildAndMonster[base + 2u];
    s.criticalMultiplier = buildAndMonster[base + 3u];
    s.damageMin = buildAndMonster[base + 4u];
    s.damageMax = buildAndMonster[base + 5u];
    s.blockChance = buildAndMonster[base + 6u];
    s.damageResistance = buildAndMonster[base + 7u];
    s.maxHP = buildAndMonster[base + 8u];
    s.maxAP = buildAndMonster[base + 9u];
    return s;
}

// --- combatMath.js:10-121 (base formulas, difficulty) ---

fn getAttacksPerTurn(maxAP: f32, attackCost: f32) -> f32 {
    if (attackCost <= 0.0) { return 0.0; }
    return floor(maxAP / attackCost);
}

fn getEffectiveCriticalChance(criticalSkill: f32) -> f32 {
    if (criticalSkill <= 0.0) { return 0.0; }
    let v = floor(-5.0 + 2.0 * sqrt(5.0 * criticalSkill));
    if (v < 0.0) { return 0.0; }
    return v;
}

fn hasCriticalAttacks(criticalSkill: f32, criticalMultiplier: f32) -> bool {
    return criticalSkill != 0.0 && criticalMultiplier != 0.0 && criticalMultiplier != 1.0;
}

const HITCHANCE_N: f32 = 50.0;
const HITCHANCE_F: f32 = 40.0;
const TWO_OVER_PI: f32 = 0.6366197723675814;

fn getAttackHitChance(attackerAttackChance: f32, targetBlockChance: f32) -> f32 {
    let c = attackerAttackChance - targetBlockChance;
    return floor(50.0 * (1.0 + TWO_OVER_PI * atan((c - HITCHANCE_N) / HITCHANCE_F)));
}

fn getAverageDamagePerHit(attacker: Stats, target: Stats, isImmuneToCrit: bool) -> f32 {
    let numOutcomes = attacker.damageMax - attacker.damageMin + 1.0;

    var avgNonCriticalDamage = 0.0;
    for (var n = 0.0; n < numOutcomes; n = n + 1.0) {
        avgNonCriticalDamage = avgNonCriticalDamage + max(0.0, n + attacker.damageMin - target.damageResistance) / numOutcomes;
    }

    var avgCriticalDamage = 0.0;
    var effectiveCriticalChance = 0.0;
    let canCrit = hasCriticalAttacks(attacker.criticalSkill, attacker.criticalMultiplier) && !isImmuneToCrit;
    if (canCrit) {
        effectiveCriticalChance = getEffectiveCriticalChance(attacker.criticalSkill);
    }
    if (effectiveCriticalChance > 0.0) {
        for (var n = 0.0; n < numOutcomes; n = n + 1.0) {
            avgCriticalDamage = avgCriticalDamage + max(0.0, floor((n + attacker.damageMin) * attacker.criticalMultiplier) - target.damageResistance) / numOutcomes;
        }
    }

    let avgDamagePerSuccessfulStrike = (1.0 - effectiveCriticalChance / 100.0) * avgNonCriticalDamage + (effectiveCriticalChance * avgCriticalDamage) / 100.0;
    return (getAttackHitChance(attacker.attackChance, target.blockChance) * avgDamagePerSuccessfulStrike) / 100.0;
}

fn getAverageDamagePerTurn(attacker: Stats, target: Stats, isImmuneToCrit: bool) -> f32 {
    return getAverageDamagePerHit(attacker, target, isImmuneToCrit) * getAttacksPerTurn(attacker.maxAP, attacker.attackCost);
}

fn getTurnsToKillTarget(attacker: Stats, target: Stats, isImmuneToCrit: bool) -> f32 {
    if (getAttacksPerTurn(attacker.maxAP, attacker.attackCost) <= 0.0) { return 999.0; }
    let canCrit = hasCriticalAttacks(attacker.criticalSkill, attacker.criticalMultiplier) && !isImmuneToCrit;
    if (canCrit) {
        if (attacker.damageMax * attacker.criticalMultiplier <= target.damageResistance) { return 999.0; }
    } else {
        if (attacker.damageMax <= target.damageResistance) { return 999.0; }
    }
    let avgDamagePerTurn = getAverageDamagePerTurn(attacker, target, isImmuneToCrit);
    if (avgDamagePerTurn <= 0.0) { return 100.0; }
    return ceil(target.maxHP / avgDamagePerTurn);
}

fn getMonsterDifficulty(player: Stats, monster: Stats, monsterImmuneToCrit: bool) -> f32 {
    let turnsToKillMonster = getTurnsToKillTarget(player, monster, monsterImmuneToCrit);
    if (turnsToKillMonster >= 999.0) { return 0.0; }
    let turnsToKillPlayer = getTurnsToKillTarget(monster, player, false);
    let result = 50.0 + (turnsToKillPlayer - turnsToKillMonster) * 2.0;
    if (result <= 1.0) { return 1.0; }
    if (result > 100.0) { return 100.0; }
    return result;
}

// --- procEffects.js ---

fn getProcOccupancy(perAttemptChance: f32, attacksPerTurn: f32, duration: f32) -> f32 {
    if (duration <= 0.0 || attacksPerTurn <= 0.0 || perAttemptChance <= 0.0) { return 0.0; }
    let q = 1.0 - pow(1.0 - perAttemptChance, attacksPerTurn);
    if (q <= 0.0) { return 0.0; }
    let r = pow(1.0 - q, duration);
    return 1.0 - r;
}

fn getExpectedStackCount(perAttemptChance: f32, attacksPerTurn: f32, duration: f32) -> f32 {
    if (duration <= 0.0 || attacksPerTurn <= 0.0 || perAttemptChance <= 0.0) { return 0.0; }
    return attacksPerTurn * perAttemptChance * duration;
}

// Returns (magnitude, hpPerRound) - WGSL has no multi-return, packed as vec2.
fn getExpectedConditionMagnitude(conditionIdx: u32, itemMagnitude: f32, perAttemptChance: f32, attacksPerTurn: f32, duration: f32) -> f32 {
    if (conditionIdx == NO_CONDITION || itemMagnitude <= 0.0) { return 0.0; }
    let cOff = conditionIdx * CONDITION_STRIDE;
    let isStacking = conditionTable[cOff + 0u] > 0.5;
    if (isStacking) {
        let stacks = getExpectedStackCount(perAttemptChance, attacksPerTurn, duration);
        return stacks * itemMagnitude;
    }
    let occupancy = getProcOccupancy(perAttemptChance, attacksPerTurn, duration);
    return occupancy * itemMagnitude;
}

// Applies one proc slot's ability-effect contribution onto `stats` (in
// place) and returns its roundEffect.increaseCurrentHP contribution -
// mirrors applyExpectedProcConditions' per-entry body (procEffects.js:132-146).
// cycleLength/horde mode is NOT modeled by this GPU path (see design note at
// top of file) - always steady-state (procEffects.js's no-cycleLength branch).
fn applyProcSlot(stats: ptr<function, Stats>, conditionIdx: u32, itemMagnitude: f32, chance: f32, duration: f32, hitChancePercent: f32, attacksPerTurn: f32) -> f32 {
    if (conditionIdx == NO_CONDITION) { return 0.0; }
    let cOff = conditionIdx * CONDITION_STRIDE;
    let hasAbilityEffect = conditionTable[cOff + 1u] > 0.5;
    let roundHpAvg = conditionTable[cOff + 12u];
    if (!hasAbilityEffect && roundHpAvg == 0.0) { return 0.0; }

    let perAttemptChance = (hitChancePercent / 100.0) * (chance / 100.0);
    let magnitude = getExpectedConditionMagnitude(conditionIdx, itemMagnitude, perAttemptChance, attacksPerTurn, duration);
    if (magnitude <= 0.0) { return 0.0; }

    if (hasAbilityEffect) {
        (*stats).maxHP = (*stats).maxHP + conditionTable[cOff + 2u] * magnitude;
        (*stats).maxAP = (*stats).maxAP + conditionTable[cOff + 3u] * magnitude;
        // conditionTable[cOff+4] (increaseMoveCost) intentionally unused - Stats has no moveCost field (moveCost never feeds computeCombatSummary's output).
        (*stats).attackCost = (*stats).attackCost + conditionTable[cOff + 5u] * magnitude;
        (*stats).attackChance = (*stats).attackChance + conditionTable[cOff + 6u] * magnitude;
        (*stats).criticalSkill = (*stats).criticalSkill + conditionTable[cOff + 7u] * magnitude;
        (*stats).damageMin = (*stats).damageMin + conditionTable[cOff + 8u] * magnitude;
        (*stats).damageMax = (*stats).damageMax + conditionTable[cOff + 9u] * magnitude;
        (*stats).blockChance = (*stats).blockChance + conditionTable[cOff + 10u] * magnitude;
        (*stats).damageResistance = (*stats).damageResistance + conditionTable[cOff + 11u] * magnitude;
    }
    if (roundHpAvg != 0.0) {
        return roundHpAvg * magnitude;
    }
    return 0.0;
}

fn getExpectedBoostPerTurn(rangeAvg: f32, hitChancePercent: f32, attacksPerTurn: f32) -> f32 {
    return rangeAvg * (hitChancePercent / 100.0) * attacksPerTurn;
}

// --- Item accessors (gpu-buffer-layout.md's item record layout) ---

fn itemFloat(recordIdx: u32, offset: u32) -> f32 {
    return itemFloats[recordIdx * ITEM_FLOAT_STRIDE + offset];
}
fn itemU32(recordIdx: u32, offset: u32) -> u32 {
    return itemU32s[recordIdx * ITEM_U32_STRIDE + offset];
}

fn itemIsWeapon(r: u32) -> bool { return itemU32(r, 0u) == 1u; }
fn itemIsShield(r: u32) -> bool { return itemU32(r, 1u) == 1u; }
fn itemIsTwohand(r: u32) -> bool { return itemU32(r, 2u) == 1u; }
fn itemHasEquipEffect(r: u32) -> bool { return itemU32(r, 3u) == 1u; }

// Sums a proc-slot field's roundEffect HP contribution + applies its
// ability-effect deltas onto `stats`, for all 4 slots of one field.
// floatBase/u32Base are the field's slot-0 offsets (item record layout).
fn applyItemProcField(stats: ptr<function, Stats>, itemRecord: u32, floatBase: u32, u32Base: u32, hitChancePercent: f32, attacksPerTurn: f32) -> f32 {
    var regen = 0.0;
    for (var s = 0u; s < PROC_SLOT_COUNT; s = s + 1u) {
        let condIdx = itemU32(itemRecord, u32Base + s);
        let magnitude = itemFloat(itemRecord, floatBase + s * 3u);
        let chance = itemFloat(itemRecord, floatBase + s * 3u + 1u);
        let duration = itemFloat(itemRecord, floatBase + s * 3u + 2u);
        regen = regen + applyProcSlot(stats, condIdx, magnitude, chance, duration, hitChancePercent, attacksPerTurn);
    }
    return regen;
}

// --- Condition merging (statEngine.js:489-507, mergeConditionInstances) ---
// Merges every equip-added condition (from the resolved combo) with
// build.activeConditions (search-invariant), stacking-aware. Returns the
// merged per-condition magnitude array via a fixed-size accumulator (see
// CONDITION_SLOT_COUNT) since WGSL has no dynamic maps.
struct MergedConditions {
    magnitudes: array<f32, 256>,
    present: array<bool, 256>,
};

fn mergeConditionEntry(merged: ptr<function, MergedConditions>, conditionIdx: u32, magnitude: f32) {
    if (conditionIdx == NO_CONDITION || conditionIdx >= CONDITION_SLOT_COUNT) { return; }
    let isStacking = conditionTable[conditionIdx * CONDITION_STRIDE + 0u] > 0.5;
    if (!(*merged).present[conditionIdx]) {
        (*merged).present[conditionIdx] = true;
        (*merged).magnitudes[conditionIdx] = magnitude;
    } else if (isStacking) {
        (*merged).magnitudes[conditionIdx] = (*merged).magnitudes[conditionIdx] + magnitude;
    } else {
        (*merged).magnitudes[conditionIdx] = max((*merged).magnitudes[conditionIdx], magnitude);
    }
}

// Sums getExpectedConditionHPPerRound (combatMath.js:134-145) over the
// merged set, and applies each merged condition's abilityEffect onto
// `stats` via applyActiveConditions' semantics (statEngine.js:515-524) -
// magnitude <= 0 means "not in effect", not an inverted application.
fn applyMergedConditions(stats: ptr<function, Stats>, merged: MergedConditions) -> f32 {
    var hpPerRound = 0.0;
    for (var i = 0u; i < CONDITION_SLOT_COUNT; i = i + 1u) {
        if (!merged.present[i]) { continue; }
        let magnitude = merged.magnitudes[i];
        if (magnitude <= 0.0) { continue; }
        let cOff = i * CONDITION_STRIDE;
        if (conditionTable[cOff + 1u] > 0.5) {
            (*stats).maxHP = (*stats).maxHP + conditionTable[cOff + 2u] * magnitude;
            (*stats).maxAP = (*stats).maxAP + conditionTable[cOff + 3u] * magnitude;
            (*stats).attackCost = (*stats).attackCost + conditionTable[cOff + 5u] * magnitude;
            (*stats).attackChance = (*stats).attackChance + conditionTable[cOff + 6u] * magnitude;
            (*stats).criticalSkill = (*stats).criticalSkill + conditionTable[cOff + 7u] * magnitude;
            (*stats).damageMin = (*stats).damageMin + conditionTable[cOff + 8u] * magnitude;
            (*stats).damageMax = (*stats).damageMax + conditionTable[cOff + 9u] * magnitude;
            (*stats).blockChance = (*stats).blockChance + conditionTable[cOff + 10u] * magnitude;
            (*stats).damageResistance = (*stats).damageResistance + conditionTable[cOff + 11u] * magnitude;
        }
        let avg = conditionTable[cOff + 12u];
        if (avg != 0.0) { hpPerRound = hpPerRound + avg * magnitude; }
    }
    return hpPerRound;
}

// --- Equipment resolution (statEngine.js:289-391, applyEquipment/applyFightingStyles/applyDualWield) ---
// Applies raw equipEffect fields + proficiency deltas for every equipped
// item, then combo-dependent fighting-style/dual-wield bonuses (which scale
// off the RAW equipEffect a second time, per applyFightingStyles/
// applyDualWield). weaponDamageMin/Max tracked separately for
// applyNonWeaponDamageModifier below (statEngine.js:530-561).
struct EquipResult {
    stats: Stats,
    weaponDamageMin: f32,
    weaponDamageMax: f32,
    nonWeaponModifier: f32, // -1 = "not overridden" (matches modifier1/modifier2 sentinel logic)
};

fn applyItemRaw(stats: ptr<function, Stats>, r: u32, multiplier: f32) {
    if (!itemHasEquipEffect(r)) { return; }
    (*stats).maxHP = (*stats).maxHP + itemFloat(r, 7u) * multiplier;
    (*stats).maxAP = (*stats).maxAP + itemFloat(r, 8u) * multiplier;
    (*stats).attackCost = (*stats).attackCost + itemFloat(r, 2u) * multiplier;
    (*stats).attackChance = (*stats).attackChance + itemFloat(r, 3u) * multiplier;
    (*stats).criticalSkill = (*stats).criticalSkill + itemFloat(r, 4u) * multiplier;
    (*stats).damageMin = (*stats).damageMin + itemFloat(r, 0u) * multiplier;
    (*stats).damageMax = (*stats).damageMax + itemFloat(r, 1u) * multiplier;
    (*stats).blockChance = (*stats).blockChance + itemFloat(r, 5u) * multiplier;
    (*stats).damageResistance = (*stats).damageResistance + itemFloat(r, 6u) * multiplier;
}

fn applyItemProficiency(stats: ptr<function, Stats>, r: u32) {
    (*stats).attackChance = (*stats).attackChance + itemFloat(r, 14u);
    (*stats).blockChance = (*stats).blockChance + itemFloat(r, 15u);
    (*stats).criticalSkill = (*stats).criticalSkill + itemFloat(r, 16u);
    (*stats).damageResistance = (*stats).damageResistance + itemFloat(r, 17u);
    (*stats).attackCost = (*stats).attackCost + itemFloat(r, 18u);
    (*stats).damageMin = (*stats).damageMin + itemFloat(r, 19u);
    (*stats).damageMax = (*stats).damageMax + itemFloat(r, 20u);
}

// getPercentage (statEngine.js:40-44).
fn getPercentage(value: f32, percentPositive: f32, percentNegative: f32) -> f32 {
    if (value == 0.0) { return 0.0; }
    if (value > 0.0) { return floor((value * percentPositive) / 100.0); }
    return floor((value * percentNegative) / 100.0);
}

// weaponR/offR: item record index, or NO_ITEM if slot empty. Mirrors
// applyEquipment (statEngine.js:350-391) then applyFightingStyles
// (:289-345) - dual-wield/2hand/weapon+shield styles, unarmed/unarmored
// fighting style excluded (needs isUnarmed/isUnarmored over ALL slots,
// deliberately out of scope for the GPU path's fighting-style coverage -
// see Phase B2 self-review note below).
fn resolveEquipmentDependentStats(base: Stats, weaponR: u32, shieldR: u32, otherRecords: array<u32, 7>, fsDualWieldLevel: f32, spec2handLevel: f32, fs2handLevel: f32, fsWeaponShieldLevel: f32, specWeaponShieldLevel: f32, specDualWieldLevel: f32) -> EquipResult {
    var result: EquipResult;
    var stats = base;
    var weaponDamageMin = 0.0;
    var weaponDamageMax = 0.0;
    var modifier1 = -1.0;
    var modifier2 = -1.0;

    let hasWeaponItem = weaponR != NO_ITEM && itemIsWeapon(weaponR);
    let hasShieldSlotWeapon = shieldR != NO_ITEM && itemIsWeapon(shieldR);
    let isTwohand = hasWeaponItem && itemIsTwohand(weaponR);
    // resolveEquipped: a two-handed weapon forces the shield slot empty.
    let effectiveShieldR = select(shieldR, NO_ITEM, isTwohand);
    let effectiveHasShieldSlotWeapon = hasShieldSlotWeapon && !isTwohand;
    let dualWielding = hasWeaponItem && effectiveHasShieldSlotWeapon;

    if (hasWeaponItem || (effectiveShieldR != NO_ITEM && itemIsWeapon(effectiveShieldR))) {
        stats.attackCost = 0.0;
    }
    if (weaponR != NO_ITEM && itemHasEquipEffect(weaponR)) {
        let setCM = itemFloat(weaponR, 12u);
        if (setCM != 0.0) { stats.criticalMultiplier = setCM; }
        if (itemFloat(weaponR, 13u) >= 0.0) { modifier1 = itemFloat(weaponR, 13u); }
    }
    if (weaponR != NO_ITEM) {
        applyItemRaw(&stats, weaponR, 1.0);
        if (hasWeaponItem) {
            weaponDamageMin = weaponDamageMin + itemFloat(weaponR, 0u);
            weaponDamageMax = weaponDamageMax + itemFloat(weaponR, 1u);
        }
    }

    if (!dualWielding && effectiveShieldR != NO_ITEM) {
        applyItemRaw(&stats, effectiveShieldR, 1.0);
        if (itemIsWeapon(effectiveShieldR)) {
            weaponDamageMin = weaponDamageMin + itemFloat(effectiveShieldR, 0u);
            weaponDamageMax = weaponDamageMax + itemFloat(effectiveShieldR, 1u);
        }
        if (itemHasEquipEffect(effectiveShieldR) && itemFloat(effectiveShieldR, 13u) >= 0.0) {
            modifier2 = itemFloat(effectiveShieldR, 13u);
        }
    }

    // --- Fighting styles (statEngine.js:289-345) ---
    if (isTwohand) {
        let dmgMax = itemFloat(weaponR, 1u);
        let dmgMin = itemFloat(weaponR, 0u);
        let fsMax = getPercentage(dmgMax, fs2handLevel * FIGHTSTYLE_2HAND_DMG_PERCENT, 0.0);
        let fsMin = getPercentage(dmgMin, fs2handLevel * FIGHTSTYLE_2HAND_DMG_PERCENT, 0.0);
        let specMax = getPercentage(dmgMax, spec2handLevel * SPECIALIZATION_2HAND_DMG_PERCENT, 0.0);
        let specMin = getPercentage(dmgMin, spec2handLevel * SPECIALIZATION_2HAND_DMG_PERCENT, 0.0);
        stats.damageMax = stats.damageMax + fsMax + specMax;
        stats.damageMin = stats.damageMin + fsMin + specMin;
        weaponDamageMax = weaponDamageMax + fsMax + specMax;
        weaponDamageMin = weaponDamageMin + fsMin + specMin;
        stats.attackChance = stats.attackChance + getPercentage(itemFloat(weaponR, 3u), spec2handLevel * SPECIALIZATION_2HAND_AC_PERCENT, 0.0);
    }

    let isWeaponAndShield = hasWeaponItem && effectiveShieldR != NO_ITEM && itemIsShield(effectiveShieldR);
    if (isWeaponAndShield) {
        stats.attackChance = stats.attackChance + getPercentage(itemFloat(weaponR, 3u), fsWeaponShieldLevel * FIGHTSTYLE_WEAPON_AC_PERCENT, 0.0);
        stats.blockChance = stats.blockChance + getPercentage(itemFloat(effectiveShieldR, 5u), fsWeaponShieldLevel * FIGHTSTYLE_SHIELD_BC_PERCENT, 0.0);
        stats.attackChance = stats.attackChance + getPercentage(itemFloat(weaponR, 3u), specWeaponShieldLevel * SPECIALIZATION_WEAPON_AC_PERCENT, 0.0);
        let specMax = getPercentage(itemFloat(weaponR, 1u), specWeaponShieldLevel * SPECIALIZATION_WEAPON_DMG_PERCENT, 0.0);
        let specMin = getPercentage(itemFloat(weaponR, 0u), specWeaponShieldLevel * SPECIALIZATION_WEAPON_DMG_PERCENT, 0.0);
        stats.damageMax = stats.damageMax + specMax;
        stats.damageMin = stats.damageMin + specMin;
        weaponDamageMax = weaponDamageMax + specMax;
        weaponDamageMin = weaponDamageMin + specMin;
    }

    if (dualWielding) {
        var percent = DUALWIELD_EFFICIENCY_LEVEL0;
        let attackCostMain = itemFloat(weaponR, 2u);
        let attackCostOff = itemFloat(effectiveShieldR, 2u);
        if (fsDualWieldLevel >= 2.0) {
            percent = DUALWIELD_EFFICIENCY_LEVEL2;
            stats.attackCost = max(attackCostMain, attackCostOff);
        } else if (fsDualWieldLevel == 1.0) {
            percent = DUALWIELD_EFFICIENCY_LEVEL1;
            stats.attackCost = max(attackCostMain, attackCostOff) + getPercentage(min(attackCostMain, attackCostOff), DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT, 0.0);
        } else {
            stats.attackCost = attackCostMain + attackCostOff;
        }

        let offSetCM = itemFloat(effectiveShieldR, 12u);
        stats.criticalMultiplier = max(itemFloat(weaponR, 12u), getPercentage(offSetCM, percent, 0.0));

        // Off-hand's OWN proficiency bonus (computeProficiencyBonus's
        // slot='shield' branch already scaled by dwPercent at pack time -
        // see gpu-buffer-layout.md), further scaled here by the fighting-
        // style-level dual-wield percent, matching applyDualWield's
        // offhandProfAC/BC/CS (statEngine.js:139-144, which double-scales:
        // once by dual-wield-efficiency-percent inside computeProficiencyBonus's
        // shield-slot branch, once more here by the SAME percent again).
        stats.attackChance = stats.attackChance + getPercentage(itemFloat(effectiveShieldR, 14u), percent, 0.0);
        stats.blockChance = stats.blockChance + getPercentage(itemFloat(effectiveShieldR, 15u), percent, 0.0);
        stats.criticalSkill = stats.criticalSkill + getPercentage(itemFloat(effectiveShieldR, 16u), percent, 0.0);

        stats.attackChance = stats.attackChance + getPercentage(itemFloat(effectiveShieldR, 3u), percent, 100.0);
        stats.blockChance = stats.blockChance + getPercentage(itemFloat(effectiveShieldR, 5u), percent, 100.0);
        let dmgMax = getPercentage(itemFloat(effectiveShieldR, 1u), percent, 100.0);
        let dmgMin = getPercentage(itemFloat(effectiveShieldR, 0u), percent, 100.0);
        stats.damageMax = stats.damageMax + dmgMax;
        stats.damageMin = stats.damageMin + dmgMin;
        weaponDamageMax = weaponDamageMax + dmgMax;
        weaponDamageMin = weaponDamageMin + dmgMin;
        stats.criticalSkill = stats.criticalSkill + getPercentage(itemFloat(effectiveShieldR, 4u), percent, 100.0);
        stats.maxHP = stats.maxHP + getPercentage(itemFloat(effectiveShieldR, 7u), percent, 100.0);
        stats.damageResistance = stats.damageResistance + getPercentage(itemFloat(effectiveShieldR, 6u), percent, 100.0);
        stats.maxAP = stats.maxAP + getPercentage(itemFloat(effectiveShieldR, 8u), percent, 100.0);

        if (itemHasEquipEffect(effectiveShieldR) && itemFloat(effectiveShieldR, 13u) >= 0.0) {
            modifier2 = itemFloat(effectiveShieldR, 13u);
        }

        if (specDualWieldLevel > 0.0) {
            stats.attackChance = stats.attackChance + getPercentage(itemFloat(weaponR, 3u), specDualWieldLevel * SPECIALIZATION_DUALWIELD_AC_PERCENT, 0.0);
            stats.blockChance = stats.blockChance + getPercentage(itemFloat(weaponR, 5u), specDualWieldLevel * SPECIALIZATION_DUALWIELD_BC_PERCENT, 0.0);
            stats.attackChance = stats.attackChance + getPercentage(itemFloat(effectiveShieldR, 3u), specDualWieldLevel * SPECIALIZATION_DUALWIELD_AC_PERCENT, 0.0);
            stats.blockChance = stats.blockChance + getPercentage(itemFloat(effectiveShieldR, 5u), specDualWieldLevel * SPECIALIZATION_DUALWIELD_BC_PERCENT, 0.0);
        }
    } else if (effectiveShieldR != NO_ITEM) {
        applyItemProficiency(&stats, effectiveShieldR);
    }

    if (weaponR != NO_ITEM) { applyItemProficiency(&stats, weaponR); }

    // Remaining armor/neck/ring slots: 100% ability effect + proficiency,
    // no fighting-style interaction (statEngine.js:385-388).
    for (var i = 0u; i < 7u; i = i + 1u) {
        let r = otherRecords[i];
        if (r == NO_ITEM) { continue; }
        applyItemRaw(&stats, r, 1.0);
        applyItemProficiency(&stats, r);
    }

    // applyNonWeaponDamageModifier (statEngine.js:530-561).
    var modifier = 100.0;
    if (modifier1 >= 0.0 && modifier2 >= 0.0) {
        if (fsDualWieldLevel == 2.0) { modifier = max(modifier1, modifier2); }
        else if (fsDualWieldLevel == 1.0) { modifier = floor((modifier1 + modifier2) / 2.0); }
        else { modifier = min(modifier1, modifier2); }
    } else if (modifier1 <= 0.0 && modifier2 >= 0.0) {
        modifier = modifier2;
    } else if (modifier2 <= 0.0 && modifier1 >= 0.0) {
        modifier = modifier1;
    }
    if (modifier != 100.0) {
        let minBase = stats.damageMin - weaponDamageMin;
        let maxBase = stats.damageMax - weaponDamageMax;
        stats.damageMin = stats.damageMin + round(minBase * ((modifier - 100.0) / 100.0));
        stats.damageMax = stats.damageMax + round(maxBase * ((modifier - 100.0) / 100.0));
    }

    // clampStats (statEngine.js:79-85).
    if (stats.attackChance < 0.0) { stats.attackChance = 0.0; }
    if (stats.damageMax < 0.0) {
        stats.damageMin = 0.0;
        stats.damageMax = 0.0;
    }

    result.stats = stats;
    result.weaponDamageMin = weaponDamageMin;
    result.weaponDamageMax = weaponDamageMax;
    result.nonWeaponModifier = modifier;
    return result;
}

// --- Main entry point ---

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let comboIdx = globalId.x;
    if (comboIdx >= arrayLength(&outputResults)) { return; }

    let comboBase = comboIdx * COMBO_STRIDE;
    let weaponR = comboIndices[comboBase + SLOT_WEAPON];
    let shieldR = comboIndices[comboBase + SLOT_SHIELD];
    var otherRecords: array<u32, 7>;
    otherRecords[0] = comboIndices[comboBase + SLOT_HEAD];
    otherRecords[1] = comboIndices[comboBase + SLOT_BODY];
    otherRecords[2] = comboIndices[comboBase + SLOT_HAND];
    otherRecords[3] = comboIndices[comboBase + SLOT_FEET];
    otherRecords[4] = comboIndices[comboBase + SLOT_NECK];
    otherRecords[5] = comboIndices[comboBase + SLOT_LEFTRING];
    otherRecords[6] = comboIndices[comboBase + SLOT_RIGHTRING];

    let fsDualWieldLevel = 0.0; // build.skillLevels[FIGHTSTYLE_DUAL_WIELD] - see self-review note below
    let spec2handLevel = 0.0;
    let fs2handLevel = 0.0;
    let fsWeaponShieldLevel = 0.0;
    let specWeaponShieldLevel = 0.0;
    let specDualWieldLevel = 0.0;

    let playerBase = readStats(0u);
    let equip = resolveEquipmentDependentStats(playerBase, weaponR, shieldR, otherRecords, fsDualWieldLevel, spec2handLevel, fs2handLevel, fsWeaponShieldLevel, specWeaponShieldLevel, specDualWieldLevel);
    var adjustedPlayer = equip.stats;

    let monsterStats = readStats(10u);
    let monsterImmuneToCrit = buildAndMonster[20u] > 0.5;
    let hordeSize = buildAndMonster[21u];

    // --- Base rates (combatMath.js:242-252) ---
    let baseHitChancePlayer = getAttackHitChance(adjustedPlayer.attackChance, monsterStats.blockChance);
    let baseHitChanceMonster = getAttackHitChance(monsterStats.attackChance, adjustedPlayer.blockChance);
    let baseAttacksPlayer = getAttacksPerTurn(adjustedPlayer.maxAP, adjustedPlayer.attackCost);
    let baseAttacksMonster = getAttacksPerTurn(monsterStats.maxAP, monsterStats.attackCost);

    // --- AP deltas (combatMath.js:254-281) ---
    var playerBonusAP = 0.0;
    var monsterBonusAP = 0.0;

    let allSlots = array<u32, 9>(weaponR, shieldR, otherRecords[0], otherRecords[1], otherRecords[2], otherRecords[3], otherRecords[4], otherRecords[5], otherRecords[6]);
    for (var i = 0u; i < 9u; i = i + 1u) {
        let r = allSlots[i];
        if (r == NO_ITEM) { continue; }
        playerBonusAP = playerBonusAP + getExpectedBoostPerTurn(itemFloat(r, 93u), baseHitChancePlayer, baseAttacksPlayer);
        playerBonusAP = playerBonusAP + getExpectedBoostPerTurn(itemFloat(r, 94u), baseHitChanceMonster, baseAttacksMonster);
        monsterBonusAP = monsterBonusAP + getExpectedBoostPerTurn(itemFloat(r, 95u), baseHitChanceMonster, baseAttacksMonster);
    }
    monsterBonusAP = monsterBonusAP + getExpectedBoostPerTurn(buildAndMonster[22u], baseHitChanceMonster, baseAttacksMonster);
    monsterBonusAP = monsterBonusAP + getExpectedBoostPerTurn(buildAndMonster[23u], baseHitChancePlayer, baseAttacksPlayer);
    playerBonusAP = playerBonusAP + getExpectedBoostPerTurn(buildAndMonster[24u], baseHitChancePlayer, baseAttacksPlayer);

    let tauntLevel = buildAndMonster[75u];
    if (tauntLevel > 0.0) {
        let tauntChance = (TAUNT_CHANCE_PERCENT * tauntLevel) / 100.0;
        monsterBonusAP = monsterBonusAP - (1.0 - baseHitChanceMonster / 100.0) * tauntChance * TAUNT_AP_LOSS * baseAttacksMonster;
    }

    adjustedPlayer.maxAP = max(0.0, adjustedPlayer.maxAP + playerBonusAP);
    var baseMonster = monsterStats;
    baseMonster.maxAP = max(0.0, monsterStats.maxAP + monsterBonusAP);

    // --- Merged conditions: equip-added + build.activeConditions (statEngine.js applyActiveConditions) ---
    var merged: MergedConditions;
    for (var i = 0u; i < CONDITION_SLOT_COUNT; i = i + 1u) {
        merged.present[i] = false;
        merged.magnitudes[i] = 0.0;
    }
    for (var i = 0u; i < 9u; i = i + 1u) {
        let r = allSlots[i];
        if (r == NO_ITEM) { continue; }
        for (var s = 0u; s < PROC_SLOT_COUNT; s = s + 1u) {
            let condIdx = itemU32(r, 4u + s);
            let magnitude = itemFloat(r, 21u + s * 3u);
            mergeConditionEntry(&merged, condIdx, magnitude);
        }
    }
    for (var s = 0u; s < PROC_SLOT_COUNT; s = s + 1u) {
        let condIdx = buildAndMonsterU32[16u + s];
        let magnitude = buildAndMonster[81u + s * 3u];
        mergeConditionEntry(&merged, condIdx, magnitude);
    }
    var procRegenPerTurn = applyMergedConditions(&adjustedPlayer, merged);

    // --- Proc conditions landing on the player (combatMath.js:296-307) ---
    for (var i = 0u; i < 9u; i = i + 1u) {
        let r = allSlots[i];
        if (r == NO_ITEM) { continue; }
        procRegenPerTurn = procRegenPerTurn + applyItemProcField(&adjustedPlayer, r, 33u, 8u, baseHitChancePlayer, baseAttacksPlayer);
        procRegenPerTurn = procRegenPerTurn + applyItemProcField(&adjustedPlayer, r, 57u, 16u, baseHitChanceMonster, baseAttacksMonster);
    }
    procRegenPerTurn = procRegenPerTurn + applyMonsterProcField(&adjustedPlayer, 39u, 4u, baseHitChanceMonster, baseAttacksMonster);
    procRegenPerTurn = procRegenPerTurn + applyMonsterProcField(&adjustedPlayer, 63u, 12u, baseHitChancePlayer, baseAttacksPlayer);

    // --- Monster's adjusted stats (combatMath.js:318-333; no horde cycleLength - see design note) ---
    var adjustedMonster = baseMonster;
    for (var i = 0u; i < 9u; i = i + 1u) {
        let r = allSlots[i];
        if (r == NO_ITEM) { continue; }
        applyItemProcField(&adjustedMonster, r, 45u, 12u, baseHitChancePlayer, baseAttacksPlayer);
        applyItemProcField(&adjustedMonster, r, 69u, 20u, baseHitChanceMonster, baseAttacksMonster);
    }
    applyMonsterProcField(&adjustedMonster, 27u, 0u, baseHitChanceMonster, baseAttacksMonster);
    applyMonsterProcField(&adjustedMonster, 51u, 8u, baseHitChancePlayer, baseAttacksPlayer);
    applyGeneralCombatSkillProcs(&adjustedPlayer, &adjustedMonster, baseHitChancePlayer, baseHitChanceMonster, baseAttacksPlayer);

    let difficulty = getMonsterDifficulty(adjustedPlayer, adjustedMonster, monsterImmuneToCrit);

    // --- Reflect/thorns direct damage (combatMath.js:338-347) ---
    var bonusDamageToMonsterPerTurn = 0.0;
    for (var i = 0u; i < 9u; i = i + 1u) {
        let r = allSlots[i];
        if (r == NO_ITEM) { continue; }
        bonusDamageToMonsterPerTurn = bonusDamageToMonsterPerTurn - getExpectedBoostPerTurn(itemFloat(r, 98u), baseHitChanceMonster, baseAttacksMonster);
    }
    let bonusDamageToPlayerPerTurn = -getExpectedBoostPerTurn(buildAndMonster[26u], baseHitChancePlayer, baseAttacksPlayer);

    // --- Kill-triggered effects: horde only (combatMath.js:349-377) - GPU
    // path does not model horde mode (hordeSize always treated as 1; see
    // design note). turnsToKillMonster still computed for the 1v1 formula.
    let turnsToKillMonster = getTurnsToKillTarget(adjustedPlayer, adjustedMonster, monsterImmuneToCrit);

    let damagePerTurn = getAverageDamagePerTurn(adjustedPlayer, adjustedMonster, monsterImmuneToCrit) + bonusDamageToMonsterPerTurn;
    let hpLossPerTurn = getAverageDamagePerTurn(adjustedMonster, adjustedPlayer, false) + bonusDamageToPlayerPerTurn;

    var hitEffectHPPerTurn = 0.0;
    for (var i = 0u; i < 9u; i = i + 1u) {
        let r = allSlots[i];
        if (r == NO_ITEM) { continue; }
        hitEffectHPPerTurn = hitEffectHPPerTurn + getExpectedBoostPerTurn(itemFloat(r, 96u), baseHitChancePlayer, baseAttacksPlayer);
        hitEffectHPPerTurn = hitEffectHPPerTurn + getExpectedBoostPerTurn(itemFloat(r, 97u), baseHitChanceMonster, baseAttacksMonster);
    }
    hitEffectHPPerTurn = hitEffectHPPerTurn + getExpectedBoostPerTurn(buildAndMonster[25u], baseHitChancePlayer, baseAttacksPlayer);

    let eaterLevel = buildAndMonster[79u];
    var hpGainPerKillSingle = eaterLevel * EATER_HEALTH;
    for (var i = 0u; i < 9u; i = i + 1u) {
        let r = allSlots[i];
        if (r == NO_ITEM) { continue; }
        hpGainPerKillSingle = hpGainPerKillSingle + itemFloat(r, 99u);
    }

    let regenPerTurn = procRegenPerTurn;
    let hpGainPerTurn = regenPerTurn + hitEffectHPPerTurn;
    var hpLossPerKill = select(turnsToKillMonster * hpLossPerTurn, 1e30, turnsToKillMonster >= 999.0);
    var hpGainPerKill = select(turnsToKillMonster * (regenPerTurn + hitEffectHPPerTurn) + hpGainPerKillSingle, hpGainPerKillSingle, turnsToKillMonster >= 999.0);

    var out: CombatSummaryGpu;
    out.hp_loss_per_kill = hpLossPerKill;
    out.damage_per_turn = damagePerTurn;
    out.hp_loss_per_turn = hpLossPerTurn;
    out.hp_gain_per_turn = hpGainPerTurn;
    out.hp_gain_per_kill = hpGainPerKill;
    out.difficulty = difficulty;
    outputResults[comboIdx] = out;
}

// Monster's own hitEffect/hitReceivedEffect proc fields use the
// buildAndMonster buffer's own proc-slot layout (offsets 27/39/51/63,
// u32 base 0/4/8/12 - see gpu-buffer-layout.md), not an item record -
// separate accessor from applyItemProcField for that reason.
fn applyMonsterProcField(stats: ptr<function, Stats>, floatBase: u32, u32Base: u32, hitChancePercent: f32, attacksPerTurn: f32) -> f32 {
    var regen = 0.0;
    for (var s = 0u; s < PROC_SLOT_COUNT; s = s + 1u) {
        let condIdx = buildAndMonsterU32[u32Base + s];
        let magnitude = buildAndMonster[floatBase + s * 3u];
        let chance = buildAndMonster[floatBase + s * 3u + 1u];
        let duration = buildAndMonster[floatBase + s * 3u + 2u];
        regen = regen + applyProcSlot(stats, condIdx, magnitude, chance, duration, hitChancePercent, attacksPerTurn);
    }
    return regen;
}

// General combat skill procs (combatMath.js:183-214, Concussion/Crit1/Crit2)
// - Taunt is handled inline above (AP-delta pass, not a condition proc).
// NOT YET WIRED: these hardcoded conditions ('concussion'/'crit1'/'crit2')
// need their conditionIndex resolved from conditionsById at pack time and
// threaded in as uniforms - see Phase B2 self-review note below. Currently
// a no-op stub so the shader compiles; must be completed before this file
// is trustworthy.
fn applyGeneralCombatSkillProcs(adjustedPlayer: ptr<function, Stats>, adjustedMonster: ptr<function, Stats>, baseHitChancePlayer: f32, baseHitChanceMonster: f32, baseAttacksPlayer: f32) {
    // Deliberately unimplemented - see self-review note in Phase B2 commit.
}
