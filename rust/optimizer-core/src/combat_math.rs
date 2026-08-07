// Line-for-line port of src/utils/combat/combatMath.js, section order
// preserved (base damage/hit-chance -> difficulty -> AP deltas -> player
// condition procs -> monster condition procs w/ buildAdjustedMonster closure
// -> kill-triggered effects -> final HP/damage numbers) so a reviewer can
// diff the two directly.

use crate::model::{Build, Condition, ConditionEntry, Horde, Item, Monster};
use crate::proc_effects::{apply_expected_proc_conditions, average_range, get_expected_boost_per_turn};
use crate::skill_data::{skill_constants as sc, skill_ids as si};
use crate::stat_engine::{
    get_equipment_conditions, merge_condition_instances, resolve_equipped,
    resolve_monster_stats, resolve_player_stats, PlayerStats, EQUIP_SLOTS,
};
use std::collections::HashMap;
use std::f64::consts::PI;

// combatMath.js:10-12 (getAttacksPerTurn).
pub fn get_attacks_per_turn(stats: &PlayerStats) -> f64 {
    (stats.max_ap / stats.attack_cost).floor()
}

// combatMath.js:15-19 (getEffectiveCriticalChance).
pub fn get_effective_critical_chance(critical_skill: f64) -> f64 {
    if critical_skill <= 0.0 {
        return 0.0;
    }
    let v = (-5.0 + 2.0 * (5.0 * critical_skill).sqrt()).floor();
    if v < 0.0 { 0.0 } else { v }
}

pub fn has_critical_skill_effect(stats: &PlayerStats) -> bool {
    stats.critical_skill != 0.0
}
pub fn has_critical_multiplier_effect(stats: &PlayerStats) -> bool {
    stats.critical_multiplier != 0.0 && stats.critical_multiplier != 1.0
}
pub fn has_critical_attacks(stats: &PlayerStats) -> bool {
    has_critical_skill_effect(stats) && has_critical_multiplier_effect(stats)
}

// combatMath.js:32-36 (hasCriticalAttack).
pub fn has_critical_attack(attacker: &PlayerStats, target: &PlayerStats) -> bool {
    if !has_critical_attacks(attacker) {
        return false;
    }
    !target.is_immune_to_critical_hits
}

const HITCHANCE_N: f64 = 50.0;
const HITCHANCE_F: f64 = 40.0;

// combatMath.js:44-47 (getAttackHitChance).
pub fn get_attack_hit_chance(attacker: &PlayerStats, target: &PlayerStats) -> f64 {
    let c = attacker.attack_chance - target.block_chance;
    let two_over_pi = 2.0 / PI;
    (50.0 * (1.0 + two_over_pi * (((c - HITCHANCE_N) / HITCHANCE_F).atan()))).floor()
}

// combatMath.js:50-74 (getAverageDamagePerHit).
pub fn get_average_damage_per_hit(attacker: &PlayerStats, target: &PlayerStats) -> f64 {
    let num_outcomes = attacker.damage_potential.max - attacker.damage_potential.min + 1.0;

    let mut avg_non_critical_damage = 0.0;
    let mut n = 0.0;
    while n < num_outcomes {
        avg_non_critical_damage += (n + attacker.damage_potential.min - target.damage_resistance).max(0.0) / num_outcomes;
        n += 1.0;
    }

    let mut avg_critical_damage = 0.0;
    let mut effective_critical_chance = 0.0;
    if has_critical_attack(attacker, target) {
        effective_critical_chance = get_effective_critical_chance(attacker.critical_skill);
    }
    if effective_critical_chance > 0.0 {
        let mut n = 0.0;
        while n < num_outcomes {
            avg_critical_damage += (((n + attacker.damage_potential.min) * attacker.critical_multiplier).floor() - target.damage_resistance).max(0.0) / num_outcomes;
            n += 1.0;
        }
    }

    let avg_damage_per_successful_strike = (1.0 - effective_critical_chance / 100.0) * avg_non_critical_damage + (effective_critical_chance * avg_critical_damage) / 100.0;
    (get_attack_hit_chance(attacker, target) * avg_damage_per_successful_strike) / 100.0
}

// combatMath.js:77-79 (getAverageDamagePerTurn).
pub fn get_average_damage_per_turn(attacker: &PlayerStats, target: &PlayerStats) -> f64 {
    get_average_damage_per_hit(attacker, target) * get_attacks_per_turn(attacker)
}

// combatMath.js:89-100 (getTurnsToKillTarget).
pub fn get_turns_to_kill_target(attacker: &PlayerStats, target: &PlayerStats) -> f64 {
    if get_attacks_per_turn(attacker) <= 0.0 {
        return 999.0;
    }
    if has_critical_attack(attacker, target) {
        if attacker.damage_potential.max * attacker.critical_multiplier <= target.damage_resistance {
            return 999.0;
        }
    } else if attacker.damage_potential.max <= target.damage_resistance {
        return 999.0;
    }

    let average_damage_per_turn = get_average_damage_per_turn(attacker, target);
    if average_damage_per_turn <= 0.0 {
        return 100.0;
    }
    (target.max_hp / average_damage_per_turn).ceil()
}

// combatMath.js:103-111 (getMonsterDifficulty). Returns [0..100], 100 == easiest.
pub fn get_monster_difficulty(player: &PlayerStats, monster: &PlayerStats) -> f64 {
    let turns_to_kill_monster = get_turns_to_kill_target(player, monster);
    if turns_to_kill_monster >= 999.0 {
        return 0.0;
    }
    let turns_to_kill_player = get_turns_to_kill_target(monster, player);
    let result = 50.0 + (turns_to_kill_player - turns_to_kill_monster) * 2.0;
    if result <= 1.0 {
        return 1.0;
    }
    if result > 100.0 {
        return 100.0;
    }
    result
}

// combatMath.js:114-121 (getDifficultyLabel).
pub fn get_difficulty_label(difficulty: f64) -> &'static str {
    if difficulty >= 80.0 {
        return "veryeasy";
    }
    if difficulty >= 60.0 {
        return "easy";
    }
    if difficulty >= 40.0 {
        return "normal";
    }
    if difficulty >= 20.0 {
        return "hard";
    }
    if difficulty == 0.0 {
        return "impossible";
    }
    "veryhard"
}

// combatMath.js:134-145 (getExpectedConditionHPPerRound).
fn get_expected_condition_hp_per_round(merged_conditions: &[(String, Option<f64>)], conditions_by_id: &HashMap<String, Condition>) -> f64 {
    let mut total = 0.0;
    for (condition_id, magnitude) in merged_conditions {
        if magnitude.map_or(false, |m| m <= 0.0) {
            continue;
        }
        let condition = match conditions_by_id.get(condition_id) {
            Some(c) => c,
            None => continue,
        };
        let boost = match condition.round_effect.as_ref().and_then(|re| re.increase_current_hp.as_ref()) {
            Some(b) => b,
            None => continue,
        };
        let avg = (boost.min + boost.max) / 2.0;
        // JS multiplies `avg * magnitude` directly here (no default-
        // parameter substitution like applyActiveConditions has), so a
        // missing magnitude produces NaN there. Using the same 1.0 fallback
        // as apply_active_conditions instead of reproducing that NaN
        // cascade - see ConditionEntry::magnitude's doc comment.
        total += avg * magnitude.unwrap_or(1.0);
    }
    total
}

// combatMath.js:156-162 (getExpectedKillEffectHP).
fn get_expected_kill_effect_hp(player_items: &[&Item]) -> f64 {
    player_items.iter().map(|item| average_range(item.kill_effect.as_ref().and_then(|k| k.increase_current_hp.as_ref()))).sum()
}

// combatMath.js:165-171 (getExpectedKillEffectAP).
fn get_expected_kill_effect_ap(player_items: &[&Item]) -> f64 {
    player_items.iter().map(|item| average_range(item.kill_effect.as_ref().and_then(|k| k.increase_current_ap.as_ref()))).sum()
}

fn lvl(skill_levels: &HashMap<String, f64>, id: &str) -> f64 {
    *skill_levels.get(id).unwrap_or(&0.0)
}

// combatMath.js:183-214 (applyGeneralCombatSkillProcs).
fn apply_general_combat_skill_procs(
    adjusted_player: &PlayerStats,
    adjusted_monster: &mut PlayerStats,
    build: &Build,
    base_hit_chance_player: f64,
    base_attacks_player: f64,
    conditions_by_id: &HashMap<String, Condition>,
    cycle_length: Option<f64>,
) {
    let skill_levels = &build.skill_levels;

    let concussion_level = lvl(skill_levels, si::CONCUSSION);
    if concussion_level > 0.0 && adjusted_player.attack_chance - adjusted_monster.block_chance > sc::CONCUSSION_THRESHOLD {
        let entries = vec![ConditionEntry {
            condition: "concussion".to_string(),
            magnitude: Some(sc::CONCUSSION_CONDITION_MAGNITUDE),
            duration: sc::CONCUSSION_CONDITION_DURATION,
            chance: sc::CONCUSSION_CHANCE_PERCENT * concussion_level,
        }];
        apply_expected_proc_conditions(adjusted_monster, &entries, base_hit_chance_player, base_attacks_player, conditions_by_id, cycle_length);
    }

    let crit1_level = lvl(skill_levels, si::CRIT1);
    let crit2_level = lvl(skill_levels, si::CRIT2);
    if (crit1_level > 0.0 || crit2_level > 0.0) && has_critical_attack(adjusted_player, adjusted_monster) {
        let crit_hit_chance_percent = base_hit_chance_player * (get_effective_critical_chance(adjusted_player.critical_skill) / 100.0);
        if crit1_level > 0.0 {
            let entries = vec![ConditionEntry {
                condition: "crit1".to_string(),
                magnitude: Some(sc::CRIT_CONDITION_MAGNITUDE),
                duration: sc::CRIT_CONDITION_DURATION,
                chance: sc::CRIT1_CHANCE_PERCENT * crit1_level,
            }];
            apply_expected_proc_conditions(adjusted_monster, &entries, crit_hit_chance_percent, base_attacks_player, conditions_by_id, cycle_length);
        }
        if crit2_level > 0.0 {
            let entries = vec![ConditionEntry {
                condition: "crit2".to_string(),
                magnitude: Some(sc::CRIT_CONDITION_MAGNITUDE),
                duration: sc::CRIT_CONDITION_DURATION,
                chance: sc::CRIT2_CHANCE_PERCENT * crit2_level,
            }];
            apply_expected_proc_conditions(adjusted_monster, &entries, crit_hit_chance_percent, base_attacks_player, conditions_by_id, cycle_length);
        }
    }
}

#[derive(Debug, Clone)]
#[derive(serde::Serialize)]
pub struct CombatSummary {
    pub difficulty: f64,
    pub difficulty_label: &'static str,
    pub damage_per_turn: f64,
    pub hp_loss_per_turn: f64,
    pub hp_gain_per_turn: f64,
    pub hp_loss_per_kill: f64,
    pub hp_gain_per_kill: f64,
}

pub struct Precomputed<'a> {
    pub target_stats: Option<&'a PlayerStats>,
    pub base_stats: Option<&'a PlayerStats>,
}

// combatMath.js:228-425 (computeCombatSummary).
pub fn compute_combat_summary(
    build: &Build,
    monster: &Monster,
    items_by_id: &HashMap<String, Item>,
    conditions_by_id: &HashMap<String, Condition>,
    horde: Option<&Horde>,
    precomputed: Option<&Precomputed>,
) -> CombatSummary {
    let precomputed_target_stats = precomputed.and_then(|p| p.target_stats);
    let precomputed_base_stats = precomputed.and_then(|p| p.base_stats);

    let player = resolve_player_stats(build, items_by_id, conditions_by_id, precomputed_base_stats);
    let target_owned;
    let target: &PlayerStats = match precomputed_target_stats {
        Some(t) => t,
        None => {
            target_owned = resolve_monster_stats(monster, &monster.active_conditions, conditions_by_id);
            &target_owned
        }
    };
    let equipped = resolve_equipped(&build.equipment, items_by_id);
    let player_items: Vec<&Item> = EQUIP_SLOTS.iter().filter_map(|slot| equipped.get(slot)).collect();

    let attacker_count = match horde {
        Some(h) if h.size > 1.0 => h.size,
        _ => 1.0,
    };
    let horde_active = attacker_count > 1.0;

    // --- Base (pre-proc-adjustment) rates ---
    let base_hit_chance_player = get_attack_hit_chance(&player, target);
    let base_hit_chance_monster = get_attack_hit_chance(target, &player);
    let base_attacks_player = get_attacks_per_turn(&player);
    let base_attacks_monster = get_attacks_per_turn(target);
    let effective_attacks_monster = base_attacks_monster * attacker_count;

    // --- AP deltas ---
    let mut player_bonus_ap = 0.0;
    let mut monster_bonus_ap = 0.0;

    for item in &player_items {
        player_bonus_ap += get_expected_boost_per_turn(item.hit_effect.as_ref().and_then(|e| e.increase_current_ap.as_ref()), base_hit_chance_player, base_attacks_player);
        player_bonus_ap += get_expected_boost_per_turn(item.hit_received_effect.as_ref().and_then(|e| e.increase_current_ap.as_ref()), base_hit_chance_monster, effective_attacks_monster);
        monster_bonus_ap += get_expected_boost_per_turn(item.hit_received_effect.as_ref().and_then(|e| e.increase_attacker_current_ap.as_ref()), base_hit_chance_monster, base_attacks_monster);
    }
    monster_bonus_ap += get_expected_boost_per_turn(monster.hit_effect.as_ref().and_then(|e| e.increase_current_ap.as_ref()), base_hit_chance_monster, base_attacks_monster);
    monster_bonus_ap += get_expected_boost_per_turn(monster.hit_received_effect.as_ref().and_then(|e| e.increase_current_ap.as_ref()), base_hit_chance_player, base_attacks_player);
    player_bonus_ap += get_expected_boost_per_turn(monster.hit_received_effect.as_ref().and_then(|e| e.increase_attacker_current_ap.as_ref()), base_hit_chance_player, base_attacks_player);

    let taunt_level = lvl(&build.skill_levels, si::TAUNT);
    if taunt_level > 0.0 {
        let taunt_chance = (sc::TAUNT_CHANCE_PERCENT * taunt_level) / 100.0;
        monster_bonus_ap -= (1.0 - base_hit_chance_monster / 100.0) * taunt_chance * sc::TAUNT_AP_LOSS * base_attacks_monster;
    }

    let mut adjusted_player = player.clone();
    adjusted_player.max_ap = (player.max_ap + player_bonus_ap).max(0.0);
    let base_monster_stats = {
        let mut s = target.clone();
        s.max_ap = (target.max_ap + monster_bonus_ap).max(0.0);
        s
    };

    // --- Condition procs landing on the PLAYER ---
    for item in &player_items {
        if let Some(entries) = item.hit_effect.as_ref().map(|e| &e.conditions_source) {
            apply_expected_proc_conditions(&mut adjusted_player, entries, base_hit_chance_player, base_attacks_player, conditions_by_id, None);
        }
        if let Some(entries) = item.hit_received_effect.as_ref().map(|e| &e.conditions_source) {
            apply_expected_proc_conditions(&mut adjusted_player, entries, base_hit_chance_monster, effective_attacks_monster, conditions_by_id, None);
        }
    }
    if let Some(entries) = monster.hit_effect.as_ref().map(|e| &e.conditions_target) {
        apply_expected_proc_conditions(&mut adjusted_player, entries, base_hit_chance_monster, effective_attacks_monster, conditions_by_id, None);
    }
    if let Some(entries) = monster.hit_received_effect.as_ref().map(|e| &e.conditions_target) {
        apply_expected_proc_conditions(&mut adjusted_player, entries, base_hit_chance_player, base_attacks_player, conditions_by_id, None);
    }

    // --- Condition procs landing on the MONSTER (buildAdjustedMonster) ---
    let build_adjusted_monster = |cycle_length: Option<f64>| -> PlayerStats {
        let mut monster_stats = base_monster_stats.clone();
        for item in &player_items {
            if let Some(entries) = item.hit_effect.as_ref().map(|e| &e.conditions_target) {
                apply_expected_proc_conditions(&mut monster_stats, entries, base_hit_chance_player, base_attacks_player, conditions_by_id, cycle_length);
            }
            if let Some(entries) = item.hit_received_effect.as_ref().map(|e| &e.conditions_target) {
                apply_expected_proc_conditions(&mut monster_stats, entries, base_hit_chance_monster, base_attacks_monster, conditions_by_id, cycle_length);
            }
        }
        if let Some(entries) = monster.hit_effect.as_ref().map(|e| &e.conditions_source) {
            apply_expected_proc_conditions(&mut monster_stats, entries, base_hit_chance_monster, base_attacks_monster, conditions_by_id, cycle_length);
        }
        if let Some(entries) = monster.hit_received_effect.as_ref().map(|e| &e.conditions_source) {
            apply_expected_proc_conditions(&mut monster_stats, entries, base_hit_chance_player, base_attacks_player, conditions_by_id, cycle_length);
        }
        apply_general_combat_skill_procs(&adjusted_player, &mut monster_stats, build, base_hit_chance_player, base_attacks_player, conditions_by_id, cycle_length);
        monster_stats
    };

    let mut adjusted_monster = build_adjusted_monster(None);

    let difficulty = get_monster_difficulty(&adjusted_player, &adjusted_monster);
    let difficulty_label = get_difficulty_label(difficulty);

    // --- Reflect/thorns direct damage ---
    let mut bonus_damage_to_monster_per_turn = 0.0;
    for item in &player_items {
        bonus_damage_to_monster_per_turn -= get_expected_boost_per_turn(item.hit_received_effect.as_ref().and_then(|e| e.increase_attacker_current_hp.as_ref()), base_hit_chance_monster, base_attacks_monster);
    }
    let bonus_damage_to_player_per_turn = -get_expected_boost_per_turn(monster.hit_received_effect.as_ref().and_then(|e| e.increase_attacker_current_hp.as_ref()), base_hit_chance_player, base_attacks_player);

    // --- Kill-triggered effects (horde only) ---
    let mut turns_to_kill_monster = get_turns_to_kill_target(&adjusted_player, &adjusted_monster);

    if horde_active && turns_to_kill_monster < 999.0 {
        adjusted_monster = build_adjusted_monster(Some(turns_to_kill_monster));
        turns_to_kill_monster = get_turns_to_kill_target(&adjusted_player, &adjusted_monster);
    }

    if horde_active && turns_to_kill_monster < 999.0 {
        let kill_rate = 1.0 / turns_to_kill_monster;
        let kill_ap = get_expected_kill_effect_ap(&player_items) * kill_rate;
        if kill_ap != 0.0 {
            adjusted_player.max_ap = (adjusted_player.max_ap + kill_ap).max(0.0);
        }
        let kill_conditions: Vec<ConditionEntry> = player_items
            .iter()
            .flat_map(|item| item.kill_effect.as_ref().map(|k| k.conditions_source.clone()).unwrap_or_default())
            .collect();
        apply_expected_proc_conditions(&mut adjusted_player, &kill_conditions, 100.0, kill_rate, conditions_by_id, None);
        turns_to_kill_monster = get_turns_to_kill_target(&adjusted_player, &adjusted_monster);
    }

    let damage_per_turn = get_average_damage_per_turn(&adjusted_player, &adjusted_monster) + bonus_damage_to_monster_per_turn;
    let hp_loss_per_turn = get_average_damage_per_turn(&adjusted_monster, &adjusted_player) * attacker_count + bonus_damage_to_player_per_turn;

    let mut all_conditions = get_equipment_conditions(&equipped);
    all_conditions.extend(build.active_conditions.iter().cloned());
    let merged_conditions = merge_condition_instances(&all_conditions, conditions_by_id);
    let regen_per_turn = get_expected_condition_hp_per_round(&merged_conditions, conditions_by_id);

    let mut hit_effect_hp_per_turn = 0.0;
    for item in &player_items {
        hit_effect_hp_per_turn += get_expected_boost_per_turn(item.hit_effect.as_ref().and_then(|e| e.increase_current_hp.as_ref()), base_hit_chance_player, base_attacks_player);
        hit_effect_hp_per_turn += get_expected_boost_per_turn(item.hit_received_effect.as_ref().and_then(|e| e.increase_current_hp.as_ref()), base_hit_chance_monster, effective_attacks_monster);
    }
    hit_effect_hp_per_turn += get_expected_boost_per_turn(monster.hit_received_effect.as_ref().and_then(|e| e.increase_current_hp.as_ref()), base_hit_chance_player, base_attacks_player);

    let eater_level = lvl(&build.skill_levels, si::EATER);
    let hp_gain_per_kill_single = eater_level * sc::EATER_HEALTH + get_expected_kill_effect_hp(&player_items);

    let mut hp_gain_per_turn = regen_per_turn + hit_effect_hp_per_turn;
    let hp_loss_per_kill = if turns_to_kill_monster >= 999.0 { f64::INFINITY } else { turns_to_kill_monster * hp_loss_per_turn };
    let hp_gain_per_kill = if turns_to_kill_monster >= 999.0 {
        hp_gain_per_kill_single
    } else {
        turns_to_kill_monster * (regen_per_turn + hit_effect_hp_per_turn) + hp_gain_per_kill_single
    };
    if horde_active && turns_to_kill_monster < 999.0 {
        hp_gain_per_turn += hp_gain_per_kill_single / turns_to_kill_monster;
    }

    CombatSummary {
        difficulty,
        difficulty_label,
        damage_per_turn,
        hp_loss_per_turn,
        hp_gain_per_turn,
        hp_loss_per_kill,
        hp_gain_per_kill,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CategoryLink, EquipEffect, Equipment, LevelUpChoices, ProcEffect, Range};

    fn golden_fixture() -> (Build, Monster, HashMap<String, Item>, HashMap<String, Condition>) {
        let mut conditions_by_id = HashMap::new();
        conditions_by_id.insert(
            "bleed".to_string(),
            Condition { id: "bleed".to_string(), round_effect: None, is_stacking: false, ability_effect: Some(EquipEffect { increase_damage_resistance: -1.0, ..Default::default() }) },
        );

        let mut items_by_id = HashMap::new();
        items_by_id.insert(
            "weapon1".to_string(),
            Item {
                id: "weapon1".to_string(),
                category: "weapon".to_string(),
                equip_effect: EquipEffect {
                    increase_attack_chance: 20.0,
                    increase_attack_cost: 4.0,
                    increase_attack_damage: Some(Range { min: 0.0, max: 0.0 }),
                    ..Default::default()
                },
                damage_potential: Some(Range { min: 3.0, max: 7.0 }),
                category_link: Some(CategoryLink { id: "lsword".to_string(), inventory_slot: "weapon".to_string(), size: "std".to_string() }),
                hit_effect: Some(ProcEffect {
                    conditions_source: vec![ConditionEntry { condition: "bleed".to_string(), magnitude: Some(1.0), duration: 3.0, chance: 50.0 }],
                    ..Default::default()
                }),
                hit_received_effect: None,
                kill_effect: None,
            },
        );

        let build = Build {
            level: 5,
            level_up_choices: LevelUpChoices { health: 4.0, ..Default::default() },
            fortitude_levels: vec![],
            equipment: Equipment { weapon: Some("weapon1".to_string()), ..Default::default() },
            skill_levels: HashMap::new(),
            active_conditions: vec![],
        };

        let monster = Monster {
            id: "rat1".to_string(),
            attack_cost: 4.0,
            attack_chance: 30.0,
            critical_skill: 0.0,
            critical_multiplier: 0.0,
            attack_damage: Some(Range { min: 1.0, max: 3.0 }),
            block_chance: 5.0,
            damage_resistance: 0.0,
            max_hp: 15.0,
            max_ap: Some(10.0),
            is_immune_to_critical_hits: false,
            hit_effect: None,
            hit_received_effect: None,
            active_conditions: vec![],
        };

        (build, monster, items_by_id, conditions_by_id)
    }

    // Golden value captured from the real combatMath.js's computeCombatSummary
    // for the 1v1 (no horde) case, exercising the hitEffect.conditionsSource
    // proc path (see git history / plan for the exact node script used).
    #[test]
    fn compute_combat_summary_matches_js_golden_value_1v1() {
        let (build, monster, items_by_id, conditions_by_id) = golden_fixture();
        let summary = compute_combat_summary(&build, &monster, &items_by_id, &conditions_by_id, None, None);
        assert_eq!(summary.difficulty, 78.0);
        assert_eq!(summary.difficulty_label, "easy");
        assert!((summary.damage_per_turn - 1.34).abs() < 1e-6);
        assert!((summary.hp_loss_per_turn - 1.7481103044959159).abs() < 1e-9);
        assert_eq!(summary.hp_gain_per_turn, 0.0);
        assert!((summary.hp_loss_per_kill - 20.97732365395099).abs() < 1e-6);
        assert_eq!(summary.hp_gain_per_kill, 0.0);
    }

    // Golden value captured from the same fixture with horde = { size: 3 }.
    #[test]
    fn compute_combat_summary_matches_js_golden_value_horde() {
        let (build, monster, items_by_id, conditions_by_id) = golden_fixture();
        let horde = Horde { size: 3.0 };
        let summary = compute_combat_summary(&build, &monster, &items_by_id, &conditions_by_id, Some(&horde), None);
        assert_eq!(summary.difficulty, 78.0);
        assert!((summary.damage_per_turn - 1.34).abs() < 1e-6);
        assert!((summary.hp_loss_per_turn - 5.244330913487747).abs() < 1e-6);
        assert_eq!(summary.hp_gain_per_turn, 0.0);
        assert!((summary.hp_loss_per_kill - 62.93197096185297).abs() < 1e-6);
        assert_eq!(summary.hp_gain_per_kill, 0.0);
    }
}
