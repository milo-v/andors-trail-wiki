# GPU buffer layout (WebGPU random search)

This is the single source of truth for every buffer `randomSearch.wgsl` (Phase
B2) reads. `gpuDataLayout.js`'s packing functions must match this document
field-for-field — if you change one, change both in the same commit.

## Design: what runs on GPU vs. what's precomputed in JS

`computeCombatSummary` = `resolvePlayerStats` (base traits + equipment +
proficiencies + general skills + active conditions + non-weapon damage
modifier + clamp) → `combatMath.js`'s formula (hit chance, damage, procs,
difficulty, kill-triggered effects).

Two categories of input to that pipeline:

1. **Search-invariant** (same for every combo in one search): player level,
   level-up choices, fortitude timing, skill levels, `build.activeConditions`,
   the monster, horde config. `buildBaseStats` + `applyGeneralCombatSkills`
   depend on none of these varying — exactly like the existing JS/Rust
   engines' `precomputedBaseStats` optimization (`combatMath.js`'s
   `precomputed.baseStats` parameter, `statEngine.js:614-622`), this is
   computed **once per search in JS** and uploaded as a fixed baseline
   (`buildAndMonster` buffer below), not reimplemented in WGSL.
2. **Combo-dependent** (varies per GPU thread): which item occupies each
   slot. `applyEquipment` (incl. fighting styles/dual-wield), equip-added
   conditions, and the resulting proc effects. This **does** run in WGSL,
   per invocation.

**Proficiency bonuses are a special case of (1) disguised as (2):**
`computeProficiencyBonus(item, slot, skillLevels)` depends only on the
item's category and the (fixed) skill levels — never on what's in any other
slot. So instead of porting `computeProficiencyBonus`/
`getProficiencySkillForCategory`/`WEAPON_CATEGORY_TO_PROFICIENCY` to WGSL,
`packItemBuffer` calls the existing JS `computeProficiencyBonus` once per
item **per slot pool it appears in** (a one-handed weapon can appear in both
the weapon pool and the shield/off-hand pool — see
`buildHelpers.getItemsForSlot`'s shield-slot inclusion of light/std
one-handed weapons — and gets a different proficiency bonus in each,
because `computeProficiencyBonus(item, 'shield', ...)` additionally scales
by dual-wield efficiency) and bakes the result into that pool-copy's item
record as `profAttackChance`/`profBlockChance`/`profCriticalSkill`/
`profDamageResistance`/`profAttackCost`/`profDamageMin`/`profDamageMax`.
The shader adds these unconditionally — no category/skill-level lookup
logic needed on the GPU at all.

**Fighting styles/dual-wield ARE combo-dependent** (they depend on what's in
*both* hands at once) and do run in WGSL — see Phase B2 Step 8's design
note. They scale the item's own **raw** `equipEffect` fields (not the
already-proficiency-adjusted ones), so both raw and proficiency-adjusted
values are packed per item, applied as two separate, unconditional-then-
conditional passes (mirrors `applyEquipment` then `applyItemProficiencies`
running as two separate passes over the same equipped set in
`resolvePlayerStats`).

## Proc-slot cap

**4 slots per condition-list field.** Verified against real game data
(`public/raw/itemlist_*.json`, scanned via a Node port of the plan's Python
scanner since no Python interpreter is available on this dev machine — see
commit message): real max is 3, on `ring_antipoison`'s
`equipEffect.addedConditions`. Every other field maxes at 1-2. Re-run the
scan (any language) if game data changes materially; bump the constant if a
field ever exceeds 4.

Each slot is `[conditionIndex: u32, magnitude: f32, chance: f32, duration: f32]`.
Unused slots: `conditionIndex = 0xFFFFFFFF` (sentinel, "skip").

`useEffect.conditionsSource` is explicitly excluded (a potion's on-use buff
roll; `computeCombatSummary` never reads `useEffect`).

## Item record layout

One record per (item, slot-pool) pair — i.e. an item appearing in both the
weapon and shield pools gets two independently-packed records, since its
proficiency bonus differs per pool (see above). Packed as parallel
`Float32Array`/`Uint32Array` buffers, one record-worth of entries per index,
same index into both arrays.

### Float fields (offset : field, all f32)

Raw `equipEffect` (used by fighting-style scaling and the base `applyEquipment` pass):

| Offset | Field | Source |
|---|---|---|
| 0 | `damageMin` | `equipEffect.increaseAttackDamage.min` |
| 1 | `damageMax` | `equipEffect.increaseAttackDamage.max` |
| 2 | `attackCost` | `equipEffect.increaseAttackCost` |
| 3 | `attackChance` | `equipEffect.increaseAttackChance` |
| 4 | `criticalSkill` | `equipEffect.increaseCriticalSkill` |
| 5 | `blockChance` | `equipEffect.increaseBlockChance` |
| 6 | `damageResistance` | `equipEffect.increaseDamageResistance` |
| 7 | `maxHP` | `equipEffect.increaseMaxHP` |
| 8 | `maxAP` | `equipEffect.increaseMaxAP` |
| 9 | `moveCost` | `equipEffect.increaseMoveCost` |
| 10 | `useItemCost` | `equipEffect.increaseUseItemCost` |
| 11 | `reequipCost` | `equipEffect.increaseReequipCost` |
| 12 | `setCriticalMultiplier` | `equipEffect.setCriticalMultiplier`; sentinel `0` = "not set" (matches JS's `\|\|` fallback — real values are never legitimately 0) |
| 13 | `setNonWeaponDamageModifier` | sentinel `-1` = "not set" (matches JS's `!= null` check; real values are non-negative percents) |

Precomputed proficiency bonus (from `computeProficiencyBonus(item, pool, skillLevels)`, `pool` = which candidate pool this record belongs to):

| Offset | Field |
|---|---|
| 14 | `profAttackChance` |
| 15 | `profBlockChance` |
| 16 | `profCriticalSkill` |
| 17 | `profDamageResistance` |
| 18 | `profAttackCost` |
| 19 | `profDamageMin` |
| 20 | `profDamageMax` |

Proc-slot fields, 4 slots each, `[magnitude, chance, duration]` as f32 (the
4th field, `conditionIndex`, lives in the u32 buffer at the same slot — see
below). Slot `s` (0-3) of field `F` is at
`floatOffset(F) + s*3 + {0:magnitude, 1:chance, 2:duration}`:

| Base offset | Field |
|---|---|
| 21 | `equipEffect.addedConditions` (magnitude/chance/duration; chance is always 100 for a permanent equip condition — no `chance` in the JSON, packed as 100 for uniformity with proc fields below) |
| 33 | `hitEffect.conditionsSource` |
| 45 | `hitEffect.conditionsTarget` |
| 57 | `hitReceivedEffect.conditionsSource` |
| 69 | `hitReceivedEffect.conditionsTarget` |
| 81 | `killEffect.conditionsSource` |

Direct hit/kill HP+AP boosts (`averageRange` precomputed in JS — these are
plain `(min+max)/2` scalars, not ranges, since WGSL never needs the raw
min/max):

| Offset | Field |
|---|---|
| 93 | `hitEffectIncreaseCurrentAP` (avg of `hitEffect.increaseCurrentAP`) |
| 94 | `hitReceivedEffectIncreaseCurrentAP` (avg of `hitReceivedEffect.increaseCurrentAP`) |
| 95 | `hitReceivedEffectIncreaseAttackerCurrentAP` |
| 96 | `hitEffectIncreaseCurrentHP` |
| 97 | `hitReceivedEffectIncreaseCurrentHP` |
| 98 | `hitReceivedEffectIncreaseAttackerCurrentHP` |
| 99 | `killEffectIncreaseCurrentHP` |
| 100 | `killEffectIncreaseCurrentAP` |

**`ITEM_FLOAT_STRIDE = 101`**.

### u32 fields (offset : field)

| Offset | Field |
|---|---|
| 0 | `isWeapon` (0/1) |
| 1 | `isShield` (0/1) |
| 2 | `isTwohandWeapon` (0/1) — precomputed `isWeapon && categoryLink.size === 'large'` |
| 3 | `hasEquipEffect` (0/1) — item may have no `equipEffect` at all |

Proc-slot condition indices (u32, 4 per field, sentinel `0xFFFFFFFF`), same
base offsets as the float table's slot bases divided by 3 (one u32 per
slot instead of 3 f32 per slot) — i.e. field F's slot s condition index is
at `u32Base(F) + s`:

| Base offset | Field |
|---|---|
| 4 | `equipEffect.addedConditions` conditionIndex |
| 8 | `hitEffect.conditionsSource` conditionIndex |
| 12 | `hitEffect.conditionsTarget` conditionIndex |
| 16 | `hitReceivedEffect.conditionsSource` conditionIndex |
| 20 | `hitReceivedEffect.conditionsTarget` conditionIndex |
| 24 | `killEffect.conditionsSource` conditionIndex |

**`ITEM_U32_STRIDE = 28`**.

## Build/monster record layout (`buildAndMonster` buffer, f32)

The search-invariant baseline (see "Design" above) plus monster stats and
horde config. One record for the whole search (not per-combo).

| Offset | Field |
|---|---|
| 0-8 | Precomputed player baseline stats, in the same field order as `PlayerStats` (`attackCost, attackChance, criticalSkill, criticalMultiplier, damagePotential.min, damagePotential.max, blockChance, damageResistance, maxHP`) — this is `buildBaseStats(...)` + `applyGeneralCombatSkills(...)` already applied, i.e. exactly `precomputed.baseStats` as JS already computes it today |
| 9 | `playerMaxAP` (baseline, before combo-dependent equip/proc deltas) |
| 10-18 | Monster stats, same 9-field order, from `resolveMonsterStats` (already includes the monster's own active conditions — search-invariant since the target monster doesn't change per combo) |
| 19 | `monsterMaxAP` |
| 20 | `monsterIsImmuneToCriticalHits` (0/1, stored as f32 for uniform buffer type) |
| 21 | `hordeSize` (1 = no horde) |
| 22-25 | Monster's own `hitEffect`/`hitReceivedEffect` `increaseCurrentAP` averages (`monsterHitEffectIncreaseCurrentAP`, `monsterHitReceivedEffectIncreaseCurrentAP`, `monsterHitReceivedEffectIncreaseAttackerCurrentAP`, `monsterHitReceivedEffectIncreaseAttackerCurrentHP`) — monster-level, not per-item, so these live here rather than in an item record |
| 26 | `monsterHitReceivedEffectIncreaseCurrentHP` |
| 27-32 | Monster's proc condition lists as 4-slot groups would blow up this fixed record; instead the monster's `hitEffect.conditionsSource/Target` and `hitReceivedEffect.conditionsSource/Target` reuse the **same 4-slot layout as an item record** (offsets 27, 39, 51, 63 respectively, each spanning 12 f32 exactly like an item's proc fields) — see u32 companion buffer below for their condition indices |
| 75 | `tauntLevel` |
| 76 | `concussionLevel` |
| 77 | `crit1Level` |
| 78 | `crit2Level` |
| 79 | `eaterLevel` |

**`BUILD_MONSTER_FLOAT_STRIDE = 80`**.

Companion u32 buffer (`buildAndMonsterU32`): monster proc condition indices,
4 per field at the same relative slot layout as an item's u32 proc fields,
base offsets `0, 4, 8, 12` for `hitEffect.conditionsSource/Target`,
`hitReceivedEffect.conditionsSource/Target` respectively.
**`BUILD_MONSTER_U32_STRIDE = 16`**.

## Condition table (`conditionTable` buffer, f32)

Dense array indexed by the same `conditionIndex` used throughout (assigned
via `Object.keys(conditionsById)` order at pack time — must be the same
order used for every proc-slot `conditionIndex` field above). One record
per condition:

| Offset | Field |
|---|---|
| 0 | `isStacking` (0/1) |
| 1 | `hasAbilityEffect` (0/1) |
| 2-10 | `abilityEffect` fields, same 9-field order as a `PlayerStats`-shape ability effect (`increaseMaxHP, increaseMaxAP, increaseMoveCost, increaseAttackCost, increaseAttackChance, increaseCriticalSkill, increaseAttackDamage.min, increaseAttackDamage.max, increaseBlockChance, increaseDamageResistance`) — actually 10 fields, not 9 (damage has min+max); offsets 2-11 |
| 12 | `roundEffectIncreaseCurrentHPAvg` (precomputed `(min+max)/2`, or 0 if no `roundEffect.increaseCurrentHP`) |

**`CONDITION_STRIDE = 13`**.

Condition-ID space size: **256 entries** (`CONDITION_SLOT_COUNT`), verified
safety margin — a scan of `public/raw/actorconditions_*.json` (Node port of
the plan's Python scanner, same reasoning as the proc-slot cap) found
**131 distinct condition IDs** in current game data. Re-run the scan and
bump the constant if a future game version exceeds it.

## Combo indices buffer (`comboIndices`, u32)

One tuple per invocation: `[weaponIdx, shieldIdx, headIdx, bodyIdx, handIdx,
feetIdx, neckIdx, leftringIdx, rightringIdx]` — 9 u32 per combo, one index
per `EQUIP_SLOTS` entry into that slot's packed item table (a per-slot
sentinel `0xFFFFFFFF` means "no item equipped in this slot", matching
`resolveEquipped`'s `null` for an empty slot). Unlike the plan's original
sketch (indices into a single shared `dims` array), this repo's combo shape
is genuinely per-slot (see `optimizer.js`'s `EQUIP_SLOTS`), so
`generateRandomComboBatch` (Phase B3) samples per-slot pool sizes directly
rather than through `buildDimensions`' paired weapon/shield and ring
dimensions — pairing/dedup optimizations (`buildWeaponShieldPairs`,
`buildRingPairs`) are a best-first-search-specific pruning concern (Track
A/Phase A4) and are deliberately not replicated for random search, which
already tolerates duplicate/redundant draws by design
(`pickRandomCombo`'s own doc comment).

**`COMBO_STRIDE = 9`**.

## Output buffer (`outputResults`, f32)

One `CombatSummaryGpu` struct per invocation, 6 f32 fields matching
`combat_math.rs`'s `CombatSummary` (Phase A3): `hp_loss_per_kill,
damage_per_turn, hp_loss_per_turn, hp_gain_per_turn, hp_gain_per_kill,
difficulty` (`difficulty_label` is not included — WGSL has no string type;
the JS caller derives it from `difficulty` via the existing
`getDifficultyLabel`).
