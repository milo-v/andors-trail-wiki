// Line-for-line port of src/utils/combat/procEffects.js.

use crate::model::{Condition, ConditionEntry, Range};
use crate::stat_engine::{apply_ability_effects, PlayerStats};
use std::collections::HashMap;

// procEffects.js:35-38 (averageRange).
pub fn average_range(range: Option<&Range>) -> f64 {
    match range {
        None => 0.0,
        Some(r) => (r.min + r.max) / 2.0,
    }
}

// procEffects.js:40-46 (getProcOccupancy).
pub fn get_proc_occupancy(per_attempt_chance: f64, attacks_per_turn: f64, duration: f64) -> f64 {
    if duration <= 0.0 || attacks_per_turn <= 0.0 || per_attempt_chance <= 0.0 {
        return 0.0;
    }
    let q = 1.0 - (1.0 - per_attempt_chance).powf(attacks_per_turn);
    if q <= 0.0 {
        return 0.0;
    }
    let r = (1.0 - q).powf(duration);
    1.0 - r
}

// procEffects.js:61-71 (getProcOccupancyFiniteHorizon).
pub fn get_proc_occupancy_finite_horizon(per_attempt_chance: f64, attacks_per_turn: f64, duration: f64, cycle_length: f64) -> f64 {
    if duration <= 0.0 || attacks_per_turn <= 0.0 || per_attempt_chance <= 0.0 || cycle_length <= 0.0 {
        return 0.0;
    }
    let q = 1.0 - (1.0 - per_attempt_chance).powf(attacks_per_turn);
    if q <= 0.0 {
        return 0.0;
    }
    let x = 1.0 - q;
    let t = cycle_length;
    let m = t.min(duration);
    let geom_sum = (x * (1.0 - x.powf(m))) / (1.0 - x);
    let tail_sum = if t > duration { (t - duration) * x.powf(duration) } else { 0.0 };
    1.0 - (geom_sum + tail_sum) / t
}

// procEffects.js:73-76 (getExpectedStackCount).
pub fn get_expected_stack_count(per_attempt_chance: f64, attacks_per_turn: f64, duration: f64) -> f64 {
    if duration <= 0.0 || attacks_per_turn <= 0.0 || per_attempt_chance <= 0.0 {
        return 0.0;
    }
    attacks_per_turn * per_attempt_chance * duration
}

// procEffects.js:88-96 (getExpectedStackCountFiniteHorizon).
pub fn get_expected_stack_count_finite_horizon(per_attempt_chance: f64, attacks_per_turn: f64, duration: f64, cycle_length: f64) -> f64 {
    if duration <= 0.0 || attacks_per_turn <= 0.0 || per_attempt_chance <= 0.0 || cycle_length <= 0.0 {
        return 0.0;
    }
    let p = attacks_per_turn * per_attempt_chance;
    let t = cycle_length;
    let sum = if t <= duration {
        (t * (t + 1.0)) / 2.0
    } else {
        (duration * (duration + 1.0)) / 2.0 + (t - duration) * duration
    };
    (p * sum) / t
}

// procEffects.js:107-119 (getExpectedConditionMagnitude). cycle_length: None
// mirrors the JS's `cycleLength == null` (steady-state / 1v1 case).
pub fn get_expected_condition_magnitude(
    condition: Option<&Condition>,
    item_magnitude: Option<f64>,
    per_attempt_chance: f64,
    attacks_per_turn: f64,
    duration: f64,
    cycle_length: Option<f64>,
) -> f64 {
    let condition = match condition {
        Some(c) => c,
        None => return 0.0,
    };
    // JS: `if (!condition || !itemMagnitude || itemMagnitude <= 0) return 0;`
    // - a missing magnitude (`undefined`) is falsy, so it's treated as "no
    // effect" here, unlike statEngine.js's applyActiveConditions path (see
    // ConditionEntry::magnitude's doc comment for why the two differ).
    let item_magnitude = match item_magnitude {
        Some(m) if m > 0.0 => m,
        _ => return 0.0,
    };
    if condition.is_stacking {
        let stacks = match cycle_length {
            Some(cl) => get_expected_stack_count_finite_horizon(per_attempt_chance, attacks_per_turn, duration, cl),
            None => get_expected_stack_count(per_attempt_chance, attacks_per_turn, duration),
        };
        return stacks * item_magnitude;
    }
    let occupancy = match cycle_length {
        Some(cl) => get_proc_occupancy_finite_horizon(per_attempt_chance, attacks_per_turn, duration, cl),
        None => get_proc_occupancy(per_attempt_chance, attacks_per_turn, duration),
    };
    occupancy * item_magnitude
}

// procEffects.js:125-134 (applyExpectedProcConditions).
pub fn apply_expected_proc_conditions(
    stats: &mut PlayerStats,
    entries: &[ConditionEntry],
    hit_chance_percent: f64,
    attacks_per_turn: f64,
    conditions_by_id: &HashMap<String, Condition>,
    cycle_length: Option<f64>,
) {
    for entry in entries {
        let condition = conditions_by_id.get(&entry.condition);
        let condition = match condition {
            Some(c) if c.ability_effect.is_some() => c,
            _ => continue,
        };
        let per_attempt_chance = (hit_chance_percent / 100.0) * (entry.chance / 100.0);
        let magnitude = get_expected_condition_magnitude(Some(condition), entry.magnitude, per_attempt_chance, attacks_per_turn, entry.duration, cycle_length);
        if magnitude <= 0.0 {
            continue;
        }
        apply_ability_effects(stats, condition.ability_effect.as_ref(), magnitude);
    }
}

// procEffects.js:143-145 (getExpectedBoostPerTurn).
pub fn get_expected_boost_per_turn(range: Option<&Range>, hit_chance_percent: f64, attacks_per_turn: f64) -> f64 {
    average_range(range) * (hit_chance_percent / 100.0) * attacks_per_turn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn average_range_none_is_zero() {
        assert_eq!(average_range(None), 0.0);
    }
    #[test]
    fn average_range_midpoint() {
        let r = Range { min: 2.0, max: 6.0 };
        assert_eq!(average_range(Some(&r)), 4.0);
    }

    // Golden value from `getExpectedBoostPerTurn({ min: 4, max: 8 }, 75, 2)`
    // in the real procEffects.js: averageRange = 6, * 0.75 * 2 = 9.
    #[test]
    fn get_expected_boost_per_turn_matches_js_golden_value() {
        let r = Range { min: 4.0, max: 8.0 };
        assert_eq!(get_expected_boost_per_turn(Some(&r), 75.0, 2.0), 9.0);
    }

    // Golden value from `applyExpectedProcConditions` with a single entry
    // hitting a stacking condition (poisoned, abilityEffect.increaseDamageResistance:
    // -1) at chance 50, duration 3, hitChancePercent 80, attacksPerTurn 2:
    // perAttemptChance = 0.8*0.5 = 0.4, expectedStacks = 2*0.4*3 = 2.4,
    // magnitude = 2.4*1 = 2.4, appliedDamageResistance = -1*2.4 = -2.4.
    #[test]
    fn apply_expected_proc_conditions_matches_js_golden_value() {
        let mut conditions_by_id = HashMap::new();
        conditions_by_id.insert(
            "poisoned".to_string(),
            Condition {
                id: "poisoned".to_string(),
                round_effect: None,
                is_stacking: true,
                ability_effect: Some(crate::model::EquipEffect { increase_damage_resistance: -1.0, ..Default::default() }),
            },
        );
        let entries = vec![ConditionEntry { condition: "poisoned".to_string(), magnitude: Some(1.0), duration: 3.0, chance: 50.0 }];
        let mut stats = PlayerStats::default();
        apply_expected_proc_conditions(&mut stats, &entries, 80.0, 2.0, &conditions_by_id, None);
        assert!((stats.damage_resistance - (-2.4)).abs() < 1e-9);
    }
}
