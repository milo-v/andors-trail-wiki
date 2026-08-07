// Port of src/utils/combat/levelModel.js — level-1 base traits plus
// per-level-up bonus application, used by stat_engine::build_base_stats.

use crate::model::{LevelUpChoices, Range};
use crate::stat_engine::PlayerStats;

const BASE_MAX_AP: f64 = 10.0;
const BASE_MAX_HP: f64 = 25.0;
const BASE_MOVE_COST: f64 = 6.0;
const BASE_ATTACK_COST: f64 = 4.0;
const BASE_ATTACK_CHANCE: f64 = 60.0;
const BASE_CRITICAL_SKILL: f64 = 0.0;
const BASE_CRITICAL_MULTIPLIER: f64 = 1.0;
const BASE_DAMAGE_MIN: f64 = 1.0;
const BASE_DAMAGE_MAX: f64 = 1.0;
const BASE_BLOCK_CHANCE: f64 = 9.0;
const BASE_DAMAGE_RESISTANCE: f64 = 0.0;
const BASE_USE_ITEM_COST: f64 = 5.0;
const BASE_REEQUIP_COST: f64 = 5.0;

const LEVELUP_EFFECT_HEALTH: f64 = 5.0;
const LEVELUP_EFFECT_ATTACK_CHANCE: f64 = 5.0;
const LEVELUP_EFFECT_ATTACK_DAMAGE: f64 = 1.0;
const LEVELUP_EFFECT_BLOCK_CHANCE: f64 = 3.0;

const PER_SKILLPOINT_INCREASE_FORTITUDE_HEALTH: f64 = 1.0;

// levelModel.js:55-82 (applyLevelUpChoices). Panics like the JS throws if
// the choices don't sum to `level - 1` — this is a caller-input-validation
// error, not a recoverable combat-math case, so an unwrap-style panic at
// the WASM boundary (surfaced as a JS exception) mirrors the JS behavior.
pub fn apply_level_up_choices(level: u32, level_up_choices: &LevelUpChoices, fortitude_levels: &[u32]) -> PlayerStats {
    let num_choices = (level as f64) - 1.0;
    let chosen = level_up_choices.health + level_up_choices.attack_chance + level_up_choices.attack_damage + level_up_choices.block_chance;
    if chosen != num_choices {
        panic!("levelUpChoices must sum to {} (level {} - 1), got {}", num_choices, level, chosen);
    }

    let mut stats = PlayerStats {
        attack_cost: BASE_ATTACK_COST,
        attack_chance: BASE_ATTACK_CHANCE,
        critical_skill: BASE_CRITICAL_SKILL,
        critical_multiplier: BASE_CRITICAL_MULTIPLIER,
        damage_potential: Range { min: BASE_DAMAGE_MIN, max: BASE_DAMAGE_MAX },
        block_chance: BASE_BLOCK_CHANCE,
        damage_resistance: BASE_DAMAGE_RESISTANCE,
        max_hp: BASE_MAX_HP,
        max_ap: BASE_MAX_AP,
        is_immune_to_critical_hits: false,
        move_cost: BASE_MOVE_COST,
        use_item_cost: BASE_USE_ITEM_COST,
        reequip_cost: BASE_REEQUIP_COST,
    };

    stats.max_hp += level_up_choices.health * LEVELUP_EFFECT_HEALTH;
    stats.attack_chance += level_up_choices.attack_chance * LEVELUP_EFFECT_ATTACK_CHANCE;
    stats.damage_potential.min += level_up_choices.attack_damage * LEVELUP_EFFECT_ATTACK_DAMAGE;
    stats.damage_potential.max += level_up_choices.attack_damage * LEVELUP_EFFECT_ATTACK_DAMAGE;
    stats.block_chance += level_up_choices.block_chance * LEVELUP_EFFECT_BLOCK_CHANCE;
    stats.max_hp += fortitude_levels.iter().map(|&acquired_at| PER_SKILLPOINT_INCREASE_FORTITUDE_HEALTH * ((level as f64) - (acquired_at as f64))).sum::<f64>();

    stats
}
