# Damage Calculator — Project Tracker

Persisted progress tracker for the damage/build calculator feature. This file is the
source of truth across sessions — update it whenever a decision is made or a phase
advances, since the in-session task list does not persist between conversations.

## Goal

Add a "damage calculator" page to the wiki:
- Build a hypothetical player (level, equipment, skills, active conditions/potions).
- Pick a single opponent monster.
- Compute the game's actual combat-difficulty rating (very easy → impossible) and
  derived stats: damage/turn, avg HP gain/loss per turn, avg HP loss per kill.
- Provide a brute-force "optimal build" search: given constraints (max acceptable HP
  loss per kill, level, assumed active conditions, etc.), find the equipment/skill
  combination maximizing damage per turn.

## Key decisions made during brainstorming (2026-07-16)

- **Game source**: cloned to `../andors-trail` (`https://github.com/AndorsTrailRelease/andors-trail`),
  linked into `public/` via `make link`, per existing `Makefile`/`AT_FOLDER` convention.
- **Combat math is closed-form, not a turn-by-turn RNG simulation.** The game itself
  computes difficulty/DPS via expected-value formulas — see
  `CombatController.java:518-570` (`getAverageDamagePerHit`, `getTurnsToKillTarget`,
  `getMonsterDifficulty`) and `:583-621` (`getAttackHitChance`, `attack()`). We port
  these formulas directly; no Monte Carlo needed.
- **1v1 only.** The game's own difficulty formula is inherently single-opponent;
  multi-monster fights would need genuine simulation and are out of scope.
- **Conditions/potions**: modeled as picking active `ActorCondition`s + magnitude
  directly (covers potions too, since a potion's only combat-relevant effect is the
  condition it grants — no need to model drinking/AP cost/instant-use effects).
- **Player level model**: user picks a level; freely allocates the `(level-1)`
  level-up bonus choices across {health +5, attackChance +5, attackDamage +1/+1,
  blockChance +3} and freely allocates skill points up to the budget derived from
  level (1 per 4 levels starting at level 4, `Player.java` XP/level-up logic).
- **Weapon/armor proficiency + fighting-style + dual-wield: IN SCOPE for Phase A**
  (not deferred) — user explicitly chose full modeling over a simplified version.
- **Value/scoring system (offense-value + defense-value, two scores not one)**
  exists solely to prune the Phase D brute-force search space (Pareto-frontier
  candidate selection per equipment slot before combinatorial search) — it is NOT
  an input to the actual combat math in Phase A/B.

## Data model notes (already confirmed against this repo's parsed JSON)

- Monster stats: `attackDamage{min,max}, attackChance, criticalSkill,
  criticalMultiplier, blockChance, damageResistance, maxHP, maxAP, attackCost,
  hitEffect.conditionsTarget[]` — static per monster, no level scaling.
- Item effect fields already match game field names: `equipEffect`, `hitEffect`,
  `useEffect`, `killEffect`, `hitReceivedEffect`, `missEffect`, `missReceivedEffect`.
- Item categories (`public/raw/itemcategories_*.json`) have `inventorySlot`
  (weapon/shield/head/body/hand/feet/neck/leftring/rightring) and `size`
  (light/std/large) — `size` drives armor proficiency mapping
  (light/std→armorProficiencyLight, large→armorProficiencyHeavy); weapon category id
  drives weapon proficiency mapping (7 skills: Dagger/1hsword/2hsword/Axe/Blunt/
  Unarmed/Pole) — full id→skill table pending research agent (see below).
- **No skill data model exists in this wiki today.** Only names/descriptions live in
  `public/values/strings.xml`; all mechanics (per-level stat deltas, max levels,
  unlock requirements) live only in `SkillCollection.java` Java constants — must be
  hand-ported into a new JS data module.

## Relevant game source files (in `../andors-trail/AndorsTrail/app/src/main/java/com/gpl/rpg/AndorsTrail/`)

- `controller/CombatController.java` — combat formulas (hit chance, avg dmg/hit,
  turns-to-kill, difficulty rating), lines 518-621.
- `activity/MonsterInfoActivity.java:104-111` — difficulty score → 6-bucket label
  thresholds (≥80 veryeasy, ≥60 easy, ≥40 normal, ≥20 hard, ==0 impossible, else
  veryhard).
- `model/actor/Actor.java`, `Player.java`, `Monster.java` — stat fields/getters,
  `PlayerBaseTraits`, level-up (`Player.java:106-217`), XP curve (`182-197`,
  `55*L²` per level).
- `controller/ActorStatsController.java` — the master pipeline: `recalculatePlayerStats`
  (:275-296) = base → equip → skills → conditions → clamp; `applyAbilityEffects`
  (:254-273) = generic stat-delta application shared by items/skills/conditions;
  condition stacking/immunity (:151-212); per-round HP/AP tick effects (:385-574).
- `controller/ItemController.java` — `applyInventoryEffects` (:153-194) equips
  main-hand/shield/armor slots, calls fighting-style + item-proficiency skill
  application; `applyDamageModifier` (:439-467) non-weapon damage % rescaling.
- `controller/SkillController.java` — `applySkillEffects` (:34-59, general combat
  skills), `applySkillEffectsFromItemProficiencies`, `applySkillEffectsFromFightingStyles`
  (dual-wield/2hand/weapon+shield/unarmed — mapping details pending research agent).
- `model/ability/SkillCollection.java` — all `SkillID`s, per-skillpoint constants,
  max levels.
- `controller/Constants.java` — `rollValue`/`roll100`/`rollResult` are uniform
  distributions (not gaussian); note `Range.current` = min, `.max` = max (gotcha).

## Weapon/armor proficiency & dual-wield research (completed 2026-07-16)

Full findings from the second research agent — needed since Phase A includes full
proficiency/fighting-style/dual-wield modeling (user's explicit choice, not deferred):

- **Category→proficiency mapping** (`SkillController.java:287-312`, `getProficiencySkillForItemCategory`):
  one function handles both weapon and armor mapping. Weapon category id → one of 7
  skills (Dagger: dagger/ssword; 1hsword: lsword/bsword/rapier; 2hsword: 2hsword;
  Axe: axe/axe2h; Blunt: club/staff/mace/scepter/hammer/hammer2h/whip; Pole: pole;
  Unarmed: special-cased via `isUnarmed()`, not category-driven). Armor: shields
  always → `armorProficiencyShield`; size `light`/`std` → `armorProficiencyLight`;
  size `large` → `armorProficiencyHeavy`; size `none` (cloth head/body/hand/feet) →
  no proficiency skill applies at all, and cloth doesn't count as "worn armor" for
  `isUnarmored()`/`isUnarmed()` weight checks either.
- **Proficiency bonus math**: each proficiency level adds `getPercentage(itemsOwnStatValue, percent, 0)`
  on top of the item's already-applied 100% stat — i.e. percent of *that item's own*
  contribution, not of the player's aggregated total. `PER_SKILLPOINT_INCREASE_WEAPON_PROF_AC/BC/CS_PERCENT`
  = 30/30/10 per level; heavy armor adds BC% (20/level) and *reduces* moveCost/attackCost/useItemCost
  penalties by 25%/level; light armor adds BC% (30/level) only.
  `getPercentage(v, posPct, negPct)` is sign-aware: `floor(v*posPct/100)` if v>0 else `floor(v*negPct/100)`.
- **Fighting styles**, all mutually exclusive by slot occupancy (`SkillController.java:314-391`,
  `469-485`): `fightstyleUnarmedUnarmored` (both weapon+shield slots empty AND all
  armor slots weightless) grants flat BC/DR/AC/max-dmg bonuses and **overwrites**
  (not adds) `criticalMultiplier = 1 + 0.25*level`; `fightstyle2hand`/`specialization2hand`
  (weapon slot = large weapon, shield slot empty) add % damage/AC to the mainhand item;
  `fightstyleWeaponShield`/`specializationWeaponShield` (weapon = any weapon, shield
  slot = actual shield category) add % AC to weapon and % BC to shield;
  `fightstyleDualWield`/`specializationDualWield` (both slots hold weapon-category
  items) — see dual-wield table below. Note: `isOffhandCapableWeapon()` (light/std
  size only) is a **UI-only** restriction (equip menu), not enforced in the stat math
  — the JS port should replicate this as a UI-level constraint on the offhand picker,
  not bake it into the stat engine itself, to match actual game behavior faithfully.
- **Dual-wield mechanics**: when both slots hold weapons, `ItemController.applyInventoryEffects`
  *skips* the normal 100%-application of the shield-slot item, and instead
  `SkillController.applySkillEffectsFromFightingStyles`'s dual-wield branch injects
  its stats scaled by an efficiency `percent` keyed on `fightstyleDualWield` level:
  level 0→25%, level 1→50% (attackCost = `max(main,off) + floor(min(main,off)*0.5)`),
  level 2→100% (attackCost = `max(main,off)`, i.e. off-hand attacks are AP-free).
  `criticalMultiplier = max(mainHand.setCriticalMultiplier, offHand.setCriticalMultiplier*percent/100)`
  (never additive). Off-hand's positive stat contributions scale by `percent`;
  negative/malus contributions (cost fields) scale by 100% for actual penalties and
  by `percent` for actual discounts (reversed param order — "positive value is a
  malus for these" per source comment). Off-hand weapon proficiency bonuses are
  further scaled by `percent` on top of the normal proficiency %.
- **Pipeline order confirmed** (`ItemController.applyInventoryEffects`, `:152-167`):
  reset attackCost=0 + seed criticalMultiplier from mainhand → apply weapon slot
  100% → apply shield slot 100% (skipped if dual-wielding) → fighting styles
  (dual-wield injection + 2h/weaponShield/unarmedUnarmored bonuses) → remaining
  armor slots (head/body/hand/feet/neck/leftring/rightring) 100% → item/armor/shield/
  unarmed/unarmored proficiencies (percent bonuses layered on everything above).
  This entire block runs inside the master pipeline between "equip" and "general
  skills" (see `ActorStatsController.recalculatePlayerStats` order above).

## Verification anchor

`CombatControllerTest.java.txt` (game's own unit test, not currently run by us but
useful as a hand-check) gives concrete expected values for `getAverageDamagePerHit`:
attacker attackChance=100, damagePotential(min=3,max=5) vs target damageResistance=3,
blockChance=50 → **avg dmg/hit ≈ 0.5**; adding attacker criticalSkill=30,
criticalMultiplier=2.5 → **≈1.038**. Use these as a throwaway sanity check when the
JS port of `getAverageDamagePerHit` is written (per project convention: write a
throwaway verification script, confirm, then delete it — no permanent test files).

## Phases

1. **Phase A — Stat engine & combat math** (pure JS, no UI). Port the full stat
   pipeline including proficiency/fighting-style/dual-wield, and the combat formulas.
   *Status: brainstorming in progress — spec not yet written.*
2. **Phase B — Calculator page UI.** Equipment/condition/skill pickers, opponent
   picker, results panel. Depends on Phase A.
3. **Phase C — Value/scoring system.** Offense-value + defense-value per item/skill.
   Depends on Phase A (validated by correlation with real DPT/survivability output).
4. **Phase D — Brute-force optimizer.** Prune via Phase C's Pareto frontier, search
   combinations against Phase A's real math, filter by user constraints. Depends on
   Phase B (UI for constraints) and Phase C (pruning).
   - **Note (2026-07-20, not yet designed):** add an "item level" filter — a concept
     that doesn't exist in the game itself, to be derived from general availability
     based on game progression (e.g. where/when an item is reachable). Revisit and
     design this later, before/during Phase D planning.

Each phase gets its own brainstorm → spec (`docs/superpowers/specs/`) → plan →
implementation cycle.

## Task checklist

- [ ] **Phase A design**
  - [x] Explore game source, confirm closed-form combat math (no simulation needed)
  - [x] Confirm data field names match existing wiki JSON parsing
  - [x] Resolve open design questions (opponent scope, conditions input, level model,
        value scoring shape, proficiency scope) — all answered above
  - [ ] Research agent: full weapon-category→proficiency mapping table, fighting-style
        activation rules, dual-wield combination math (**in progress**, agent id
        `ad28f9517c03b7450` as of 2026-07-16 — check for completion, re-launch if
        context lost)
  - [x] Write `docs/superpowers/specs/2026-07-16-damage-calculator-phase-a-design.md`
        (gitignored per repo convention, not committed — see feedback_commits memory)
  - [x] Spec self-review (placeholders/consistency/scope/ambiguity) — caught and fixed
        a missing "HP gain per kill" metric (eater skill / killEffect, distinct from
        per-round HP gain)
  - [ ] User reviews spec (**current step**)
- [x] **Phase A plan** — written to `docs/superpowers/plans/2026-07-16-damage-calculator-phase-a.md`
      (8 tasks: levelModel, skillData, combatMath core formulas, statEngine in 4
      parts [base/equip helpers, equipment+fighting-styles+dual-wield, item
      proficiencies+general skills, conditions+damage-modifier+assembly],
      combatMath derived metrics + end-to-end sanity check). Awaiting user's
      choice of execution mode (subagent-driven vs inline).
- [x] **Phase A implementation** (8/8 tasks done, see plan file — Task 8 completed
      2026-07-16: `computeCombatSummary` added to `combatMath.js`, verified against
      real repo data (arulir_3 monster + a hand-built dagger), throwaway test
      deleted, committed as `477f6ba`)
- [x] **Phase B design** — brainstormed and written to
      `docs/superpowers/specs/2026-07-16-damage-calculator-phase-b-design.md`
      (route `/calculator`, URL-encoded shareable build, searchable dropdown
      pickers, +/- only skill/level-up allocation, add/remove condition rows,
      player-only conditions, summary-only results panel).
- [x] **Phase B plan** — written to
      `docs/superpowers/plans/2026-07-16-damage-calculator-phase-b.md` (10 tasks:
      skillData.js metadata extension, buildHelpers+buildCodec, SearchableSelect,
      LevelPanel, Equipment pickers, SkillsPanel, ConditionsPanel, OpponentPicker,
      ResultsPanel, CalculatorPage wiring). Awaiting execution.
- [x] **Phase B implementation** (10/10 tasks done — Task 1 `skillData.js` metadata
      commit `c0d360f`, Task 2 `buildHelpers.js`/`buildCodec.js` commit `4c16323`,
      Task 3 `SearchableSelect` commit `d432f16`, Task 4 `LevelPanel` commit
      `11e2558`, Task 5 `SlotPicker`/`EquipmentPanel` commit `cb1c72a`, Task 6
      `SkillsPanel` + Task 7 `ConditionsPanel` + Task 8 `OpponentPicker` commit
      `c238384`, Task 9 `ResultsPanel` commit `e660efb`, Task 10 `CalculatorPage`
      + `Main.jsx`/`Menu.jsx` routing/nav wiring commit `99da81a`.
      **Manual end-to-end dev-server verification (plan Task 10 Step 4) was NOT
      run this session** — user interrupted before it happened; do this before
      considering Phase B fully done, or at least before starting Phase C.)
- [x] **Phase B UI fixes** (2026-07-17, post-manual-verification bug pass): found
      via dev-server + Playwright testing —
      1. Dark-theme contrast: `SearchableSelect`'s dropdown had `background: white`
         with no `color` on `<li>` (inherited white text → invisible), and native
         inputs had no theme-aware styling. Fixed with explicit dark colors on all
         calculator inputs/dropdown.
      2. `ResultsPanel`'s `DIFFICULTY_COLORS.impossible` was `#000000` — black text
         on this site's black background, invisible. Changed to `#9c27b0`.
      3. Damage per turn showing Infinity: `statEngine.js` `applyEquipment`
         unconditionally reset `stats.attackCost = 0`, but the real game
         (`ItemController.applyInventoryEffects`/`getMainWeapon`) only resets it
         when a weapon is actually equipped (main-hand or dual-wielded off-hand) —
         unarmed builds kept `attackCost = 0` forever, so
         `getAttacksPerTurn = maxAP/0 = Infinity`. Fixed to only reset when
         `isWeapon(mainHand) || isWeapon(offHand)`, otherwise the base-trait
         attackCost (4, fists) is kept.
      4. Two-column layout: left = Level/Equipment/Skills/Conditions (character
         build), right = Opponent + Results.
      5. Weapon/armor proficiency skills are `firstLevelRequiresQuest` in the game
         (`SkillCollection.java`) — level 1 is quest-granted, free of skill points;
         only levels beyond 1 cost a point (confirmed via
         `SkillController.canLevelupSkillManually` requiring `player.hasSkill(id)`
         already true). Fixed `getSkillPointsSpent` in `buildHelpers.js` to charge
         `max(0, level-1)` for `WEAPON_PROFICIENCY`/`ARMOR_PROFICIENCY` category
         skills instead of `level`.
      **Known non-bug edge case**: some "monster" entries (e.g. `acolyte`) are
      decorative/conversation-only NPCs with no combat stats at all — selecting
      them as an opponent yields `NaN` results. Not fixed (out of scope, real data
      gap, not a UI bug) — verified against a real combat monster (`arulir_1`)
      instead, which produced correct finite values.
- [x] **Phase B enhancements pass 2** (2026-07-17): brainstormed and written to
      `docs/superpowers/specs/2026-07-17-damage-calculator-phase-b-enhancements-design.md`,
      plan at `docs/superpowers/plans/2026-07-17-damage-calculator-phase-b-enhancements.md`
      (10 tasks, executed inline, verified via dev-server + Playwright). Covers:
      1. **Skill level-gating**: `LEVELUP_REQUIREMENTS` + `canLevelUpSkillTo`/
         `describeUnmetRequirement` added to `skillData.js`, ported from
         `SkillCollection.java`'s `SkillLevelRequirement`s (`barkSkin`,
         `betterCriticals`, `speed`, `eater`, `cleave`, all 4 fightstyles, all 3
         specializations). `SkillsPanel`'s "+" buttons grey out with a tooltip when
         a requirement isn't met.
      2. **Fortitude HP formula fix** (real bug, not just a UI gap): the real game
         (`ActorStatsController.addLevelupEffect`) applies fortitude's HP bonus once
         per level-up event using whatever fortitude level was active *then* — a
         point acquired late contributes less HP than one acquired early. The old
         `fortitudeLevel * (level-1)` formula silently assumed every point was
         acquired at level 1 (the max-HP case), always overstating HP. New
         `build.fortitudeLevels: number[]` field (one acquired-at player-level per
         point) drives a corrected formula in `levelModel.js`'s
         `applyLevelUpChoices`: `Σ(buildLevel - acquiredLevel)`. UI: fortitude's
         skill row is replaced by a per-point list (`FortitudeSkillRow.jsx`) with an
         editable "acquired at level N" input per point, validated against the
         real per-point minimum (`15k - 10`, `buildHelpers.getFortitudeMinLevelForPoint`).
      3. **Three-column layout**: build config | new `PlayerStatsPanel.jsx`
         (resolved player stats) | Opponent (now shows the monster's raw stats too,
         via extended `OpponentPicker.jsx`) + Results.
      4. **Results panel cleanup**: collapsed the 4 separate HP gain/loss lines into
         2 net "HP change per turn"/"HP change per kill" lines (green ≥0, red <0),
         plus a static generic-formula explanation block for damage/turn, HP
         change/turn, HP change/kill.
      Verified live: level-20 build with 2 fortitude points at levels 5 and 20
      showed Max HP 135 (base 120 + 15 + 0); editing point 1's level from 5→20
      correctly dropped Max HP to 120. Gated skills (e.g. Combat Speed) correctly
      greyed out below their required level. Opponent stats block and net
      HP-change coloring both confirmed against a real monster (`arulir_1`).
- [x] **Phase B post-enhancement bug pass** (2026-07-20/21, ad-hoc, no formal
      spec/plan — small isolated fixes): 1. `288152e` right-ring picker was always
      empty (game data has one ring category, not separate left/right) + fighting-
      style weapon-damage bonuses (2h/weapon+shield/dual-wield specializations) were
      being incorrectly rescaled by `setNonWeaponDamageModifier` instead of feeding
      into the `weaponDamage` tracker like `SkillController.java`'s `addPercentDamage`.
      2. `073652d` calculator stopped rendering stats/results entirely when a build
      had unspent skill points (only level-up choices need full allocation; skill
      points are already handled safely). 3. `71494eb` monsters with no `maxAP` in
      JSON now default to 10, matching `MonsterTypeParser.java:44`'s `optInt`
      fallback (previously showed 0 AP for most monsters). 4. `ae5abc0` `OpponentPicker`
      now gets resolved monster stats from `CalculatorPage` (via `resolveMonsterStats`,
      the same helper `combatMath.js` uses) instead of reading raw JSON fields with
      its own separate `?? 0` fallback, so fixes like #3 reach the display too.
- [x] **Phase C** (brainstorm → spec → plan → implement) — done 2026-07-21
  - [x] Brainstormed and written to
        `docs/superpowers/specs/2026-07-21-damage-calculator-phase-c-design.md`
        (gitignored, not committed). Key pivot from the original tracker note:
        scoring does NOT run items through Phase A's combat formulas (rejected —
        `getAttackHitChance`'s arctan saturation makes marginal-delta-at-a-baseline
        scoring unreliable near the curve's edges). Instead: raw stat-delta Pareto
        vectors (offense = attackDamage/attackChance/criticalSkill/
        criticalMultiplier/-attackCost, defense = blockChance/damageResistance/
        maxHP/maxAP), context-free (no baseline build). Proc-effect items
        (hitEffect/killEffect/useEffect/etc.) are exempted from pruning entirely
        (their value isn't representable in the vectors). **Scope narrowed
        mid-brainstorm**: skill scoring/pruning was dropped entirely — Phase D
        will brute-force equipment only, given a fixed, user-chosen skill build,
        so skills are never searched and don't need scoring. **Added mid-brainstorm**:
        items within a slot are grouped by `getProficiencySkillForCategory`
        (light vs heavy armor, per-weapon-type proficiency, etc.) before Pareto
        pruning, so an item is only ever compared against others that train the
        same proficiency skill — otherwise e.g. a strong light-armor item could
        wrongly prune a weak heavy-armor item that's the only valid choice once
        heavy-armor skill points are on the table.
  - [x] User reviewed spec, approved
  - [x] Phase C plan — written to
        `docs/superpowers/plans/2026-07-21-damage-calculator-phase-c.md` (3 tasks:
        item vectors + exemption, grouped Pareto frontier + `pruneCandidates`,
        validation spot-check).
  - [x] Phase C implementation — `src/utils/combat/valueScoring.js` created,
        exports `computeOffenseVector`, `computeDefenseVector`, `isExemptItem`,
        `paretoFrontier`, `pruneCandidates`. Executed inline, single commit
        `6271d7f` (all 3 tasks' code landed together since Task 1's file write
        included Task 2's functions). Verified via throwaway scripts (deleted
        after use) for: vector extraction, Pareto dominance, proficiency
        grouping (weak heavy-armor item correctly survives against a
        stat-dominant light-armor item in a different group), and a real-item
        spot-check (`club1` vs `flail_giant`). That last check caught a flaw in
        my own plan's stated expectation — I'd claimed `flail_giant` dominates
        `club1` on every dimension, but it doesn't: `flail_giant`'s higher
        attack cost (14 AP vs 5 AP) means it loses on the negated attack-cost
        dimension, so both correctly survive `paretoFrontier` together. This
        wasn't a code bug — it demonstrated the multi-dimensional vector
        approach correctly preserving a real damage/AP-cost tradeoff that a
        single-scalar score would have missed. No UI changes, as planned. No
        permanent test files added.
- [ ] **Phase D** (brainstorm → spec → plan → implement)
  - [x] Item-level data curated (2026-07-21): manually assigned levels (steps
        of 5) for all 480 equippable items via interactive Q&A with the user,
        grouped by shop/quest-giver/drop-map to speed up batch assignment.
        Extracted via a temporary `window.__wikiTemp` debug hook in
        `Main.jsx` (reverted after use) + Playwright browser evaluation to
        get real linked provenance (droplists/monsters/maps/quests) without
        reimplementing `linkTemp()`'s cross-linking logic. Saved to
        `docs/superpowers/data/item_levels.csv` (gitignored, not committed).
  - [x] Brainstormed and written to
        `docs/superpowers/specs/2026-07-21-damage-calculator-phase-d-design.md`
        (gitignored, not committed). User approved. Key decisions: item-level
        filter is optional/no default cap; per-slot locking (pre-selected
        items excluded from search entirely); candidate selection per
        unlocked slot = top 5 by a unified `0.6*offense + 0.4*defense`
        combined score (proc items compete on equal footing, no bonus);
        optional per-slot category filter + global exclude list; full
        brute-force cross-product over candidates (~2M combos worst case,
        measured live against real item data) scored by Phase A's real
        `computeCombatSummary`, subject to max-HP-loss-per-kill constraint;
        runs in a Web Worker with streaming progress bar + live-updating
        top-10 leaderboard (not just a final result).
  - [x] Phase D plan — written to
        `docs/superpowers/plans/2026-07-21-damage-calculator-phase-d.md` (7
        tasks: upgrade react-scripts 4->5 for native Web Worker support,
        `itemLevels.js` data module, `optimizer.js` candidate scoring/
        selection, `optimizer.js` Cartesian search core, `optimizerWorker.js`,
        `OptimizerPanel.jsx` UI, `CalculatorPage.jsx` wiring). Key toolchain
        finding during planning: this repo runs `react-scripts@4.0.2`
        (webpack 4, not ejected, no CRACO) which can't support native module
        Web Workers — user chose to upgrade to react-scripts 5.x rather than
        fall back to chunked main-thread execution or add CRACO.
  - [ ] Phase D implementation (3/7 tasks)
    - [x] Task 1 — react-scripts 4.0.2 -> 5.0.1 upgrade for native Web
          Worker support, commit `a8d762c`. Two incidental fixes needed:
          pinned `eslint` to `8.56.0` via `package.json` `overrides`
          (eslint 8.57.x regression broke `eslint-config-react-app`'s
          jest overrides, "Environment key jest/globals is unknown");
          added `atob` as an explicit dependency (`bin/mapParser.js`
          requires it directly but it only existed as an incidental
          transitive dep before, and the upgrade dropped it, breaking
          `bin/generateMapImages.js`). `npm start`/`npm run build`/
          `npm test` all verified working. **Known pre-existing,
          unrelated issue**: `bin/generateMapImages.js` now fails at
          `context.drawImage is not a function` — `canvas@2.10.2`'s
          native binding isn't loading under this environment's Node
          version; `canvas`'s version is unchanged by this upgrade, so
          not a regression from it. Not fixed (out of scope for Phase D).
    - [x] Task 2 — `src/utils/combat/itemLevels.js` created, commit
          `3b8e762`. Ported `docs/superpowers/data/item_levels.csv`
          (name-keyed) to an id-keyed `ITEM_LEVELS` map + `getItemLevel`.
          Generation script caught a real bug on first run: the CSV has
          CRLF line endings, so `header.indexOf('level')` silently
          failed (matched against `"level\r"`) and produced `NaN` for
          every single row — verification script's non-null count check
          (482 expected, 0 found) is what caught it, not the "480/480
          resolved" count alone, which stayed correct throughout since
          `nameToLevel[name] !== undefined` is true even for `NaN`. Fixed
          by stripping `\r\n` before parsing; reran, got 482 non-null
          entries (482 not 480 because 2 item names collide across
          different itemlist files, both correctly inheriting the same
          CSV-assigned level). Verified `getItemLevel('helm_crude_iron')
          -> 15`, `getItemLevel('nonexistent_item') -> null`.
    - [x] Tasks 3+4 — `src/utils/combat/optimizer.js` created (candidate
          scoring/selection + Cartesian search core), commit `df6b026`
          (landed together in one commit, same file, mirroring Phase
          C's precedent). Exports `combinedScore`, `selectCandidates`,
          `buildCandidateLists`, `insertIntoTop10`, `countCombinations`,
          `searchBestBuilds`. Verified against real game data: every
          non-empty slot returns exactly 5 candidates with no filters,
          `rightring`'s pool matches `leftring`'s (both draw from the
          `leftring` category); a locked-down 5-combination search
          (only weapon slot open) against monster `arulir_1` produced a
          real top result (`xulviir` weapon, `damagePerTurn` ≈ 4.96,
          `hpLossPerKill` ≈ 439.9) — no `NaN`/`undefined`. Verification
          note: plain-Node ESM can't resolve this repo's extensionless
          relative imports (`./statEngine` etc., which work fine under
          webpack) or `.jsx` files — needed a small throwaway
          `--experimental-loader` resolver hook (not committed) to run
          the verification scripts directly; worth remembering for
          Tasks 5+ if more throwaway Node verification is needed.

## Resuming this work in a new session

1. Read this file first.
2. Check `docs/superpowers/specs/` for any written specs and their approval state.
3. Check the in-session task list (`TaskList`) — it does NOT persist across sessions,
   so recreate it from the checklist above if starting fresh.
4. If the checklist shows a research agent "in progress," it has almost certainly
   finished or been lost — just re-run the equivalent research directly rather than
   trying to resume a stale agent id.
