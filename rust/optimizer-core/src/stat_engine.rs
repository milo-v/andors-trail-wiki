// Line-for-line port of src/utils/combat/statEngine.js. Keep function names,
// order of operations, and rounding (Math.floor/Math.ceil -> f64::floor/
// f64::ceil) identical to the JS so a reviewer can diff the two directly.

use crate::model::{Build, CategoryLink, ConditionEntry, Condition, Equipment, Item, Monster, Range};
use crate::skill_data::{skill_constants as sc, skill_ids as si, get_proficiency_skill_for_category};
use std::collections::HashMap;

pub const EQUIP_SLOTS: [&str; 9] = ["weapon", "shield", "head", "body", "hand", "feet", "neck", "leftring", "rightring"];
pub const ARMOR_SLOTS: [&str; 4] = ["head", "body", "hand", "feet"];

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct PlayerStats {
    pub attack_cost: f64,
    pub attack_chance: f64,
    pub critical_skill: f64,
    pub critical_multiplier: f64,
    pub damage_potential: Range,
    pub block_chance: f64,
    pub damage_resistance: f64,
    pub max_hp: f64,
    pub max_ap: f64,
    pub is_immune_to_critical_hits: bool,
    pub move_cost: f64,
    pub use_item_cost: f64,
    pub reequip_cost: f64,
}

impl Default for Range {
    fn default() -> Self {
        Range { min: 0.0, max: 0.0 }
    }
}

// One resolved equipment slot set: statEngine.js works with `equipped[slot]`
// (Option<&Item>) rather than the raw item-id strings on Build.equipment.
#[derive(Debug, Clone, Default)]
pub struct Equipped<'a> {
    pub weapon: Option<&'a Item>,
    pub shield: Option<&'a Item>,
    pub head: Option<&'a Item>,
    pub body: Option<&'a Item>,
    pub hand: Option<&'a Item>,
    pub feet: Option<&'a Item>,
    pub neck: Option<&'a Item>,
    pub leftring: Option<&'a Item>,
    pub rightring: Option<&'a Item>,
}

impl<'a> Equipped<'a> {
    pub fn get(&self, slot: &str) -> Option<&'a Item> {
        match slot {
            "weapon" => self.weapon,
            "shield" => self.shield,
            "head" => self.head,
            "body" => self.body,
            "hand" => self.hand,
            "feet" => self.feet,
            "neck" => self.neck,
            "leftring" => self.leftring,
            "rightring" => self.rightring,
            _ => None,
        }
    }
}

// statEngine.js:19-35 (applyAbilityEffects).
pub fn apply_ability_effects(stats: &mut PlayerStats, effect: Option<&crate::model::EquipEffect>, multiplier: f64) {
    let effect = match effect {
        Some(e) => e,
        None => return,
    };
    stats.max_hp += effect.increase_max_hp * multiplier;
    stats.max_ap += effect.increase_max_ap * multiplier;
    stats.move_cost += effect.increase_move_cost * multiplier;
    stats.attack_cost += effect.increase_attack_cost * multiplier;
    stats.use_item_cost += effect.increase_use_item_cost * multiplier;
    stats.reequip_cost += effect.increase_reequip_cost * multiplier;
    stats.attack_chance += effect.increase_attack_chance * multiplier;
    stats.critical_skill += effect.increase_critical_skill * multiplier;
    if let Some(dmg) = &effect.increase_attack_damage {
        stats.damage_potential.min += dmg.min * multiplier;
        stats.damage_potential.max += dmg.max * multiplier;
    }
    stats.block_chance += effect.increase_block_chance * multiplier;
    stats.damage_resistance += effect.increase_damage_resistance * multiplier;
}

// statEngine.js:40-44 (getPercentage).
pub fn get_percentage(value: f64, percent_positive: f64, percent_negative: f64) -> f64 {
    if value == 0.0 {
        return 0.0;
    }
    if value > 0.0 {
        return ((value * percent_positive) / 100.0).floor();
    }
    ((value * percent_negative) / 100.0).floor()
}

pub fn is_weapon(item: Option<&Item>) -> bool {
    matches!(item.and_then(|i| i.category_link.as_ref()), Some(cl) if cl.inventory_slot == "weapon")
}
pub fn is_shield(item: Option<&Item>) -> bool {
    matches!(item.and_then(|i| i.category_link.as_ref()), Some(cl) if cl.inventory_slot == "shield")
}
pub fn is_twohand_weapon(item: Option<&Item>) -> bool {
    is_weapon(item) && matches!(item.and_then(|i| i.category_link.as_ref()), Some(cl) if cl.size == "large")
}
pub fn has_weight(item: Option<&Item>) -> bool {
    matches!(item.and_then(|i| i.category_link.as_ref()), Some(cl) if !cl.size.is_empty() && cl.size != "none")
}

pub fn is_unarmed(equipped: &Equipped) -> bool {
    !has_weight(equipped.weapon) && !has_weight(equipped.shield)
}
pub fn is_unarmored(equipped: &Equipped) -> bool {
    ARMOR_SLOTS.iter().all(|slot| !has_weight(equipped.get(slot)))
}

pub fn is_dual_wielding(main_hand: Option<&Item>, off_hand: Option<&Item>) -> bool {
    is_weapon(main_hand) && is_weapon(off_hand)
}
pub fn is_wielding_2hand(main_hand: Option<&Item>, off_hand: Option<&Item>) -> bool {
    main_hand.is_some() && off_hand.is_none() && is_twohand_weapon(main_hand)
}
pub fn is_wielding_weapon_and_shield(main_hand: Option<&Item>, off_hand: Option<&Item>) -> bool {
    is_weapon(main_hand) && is_shield(off_hand)
}

// statEngine.js:79-85 (clampStats).
pub fn clamp_stats(stats: &mut PlayerStats) {
    if stats.attack_chance < 0.0 {
        stats.attack_chance = 0.0;
    }
    if stats.damage_potential.max < 0.0 {
        stats.damage_potential.min = 0.0;
        stats.damage_potential.max = 0.0;
    }
}

// statEngine.js:90-107 (buildBaseStats).
pub fn build_base_stats(level: u32, level_up_choices: &crate::model::LevelUpChoices, fortitude_levels: &[u32]) -> PlayerStats {
    let traits = crate::level_model::apply_level_up_choices(level, level_up_choices, fortitude_levels);
    PlayerStats {
        attack_cost: traits.attack_cost,
        attack_chance: traits.attack_chance,
        critical_skill: traits.critical_skill,
        critical_multiplier: traits.critical_multiplier,
        damage_potential: traits.damage_potential,
        block_chance: traits.block_chance,
        damage_resistance: traits.damage_resistance,
        max_hp: traits.max_hp,
        max_ap: traits.max_ap,
        is_immune_to_critical_hits: false,
        move_cost: traits.move_cost,
        use_item_cost: traits.use_item_cost,
        reequip_cost: traits.reequip_cost,
    }
}

fn lvl(skill_levels: &HashMap<String, f64>, id: &str) -> f64 {
    *skill_levels.get(id).unwrap_or(&0.0)
}

struct WeaponDamage {
    min: f64,
    max: f64,
}

// statEngine.js:111-165 (applyDualWield).
fn apply_dual_wield(stats: &mut PlayerStats, main_hand: &Item, off_hand: &Item, skill_levels: &HashMap<String, f64>, weapon_damage: &mut WeaponDamage) {
    let fs_level = lvl(skill_levels, si::FIGHTSTYLE_DUAL_WIELD);
    // off_hand.equip_effect always exists (non-Optional field with #[serde(default)]);
    // the JS `if (!offHand.equipEffect) return;` guard is therefore a no-op here.

    let attack_cost_main = main_hand.equip_effect.increase_attack_cost;
    let attack_cost_off = off_hand.equip_effect.increase_attack_cost;
    let percent;

    if fs_level >= 2.0 {
        percent = sc::DUALWIELD_EFFICIENCY_LEVEL2;
        stats.attack_cost = attack_cost_main.max(attack_cost_off);
    } else if fs_level == 1.0 {
        percent = sc::DUALWIELD_EFFICIENCY_LEVEL1;
        stats.attack_cost = attack_cost_main.max(attack_cost_off)
            + get_percentage(attack_cost_main.min(attack_cost_off), sc::DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT, 0.0);
    } else {
        percent = sc::DUALWIELD_EFFICIENCY_LEVEL0;
        stats.attack_cost = attack_cost_main + attack_cost_off;
    }

    stats.critical_multiplier = main_hand.equip_effect.set_critical_multiplier.unwrap_or(0.0)
        .max(get_percentage(off_hand.equip_effect.set_critical_multiplier.unwrap_or(0.0), percent, 0.0));

    let offhand_prof_skill = get_proficiency_skill_for_category(off_hand.category_link.as_ref());
    let offhand_prof_level = offhand_prof_skill.map(|s| lvl(skill_levels, s)).unwrap_or(0.0);
    let offhand_prof_ac = get_percentage(off_hand.equip_effect.increase_attack_chance, sc::WEAPON_PROF_AC_PERCENT * offhand_prof_level, 0.0);
    let offhand_prof_bc = get_percentage(off_hand.equip_effect.increase_block_chance, sc::WEAPON_PROF_BC_PERCENT * offhand_prof_level, 0.0);
    let offhand_prof_cs = get_percentage(off_hand.equip_effect.increase_critical_skill, sc::WEAPON_PROF_CS_PERCENT * offhand_prof_level, 0.0);
    stats.attack_chance += get_percentage(offhand_prof_ac, percent, 0.0);
    stats.block_chance += get_percentage(offhand_prof_bc, percent, 0.0);
    stats.critical_skill += get_percentage(offhand_prof_cs, percent, 0.0);

    let e = &off_hand.equip_effect;
    stats.attack_chance += get_percentage(e.increase_attack_chance, percent, 100.0);
    stats.block_chance += get_percentage(e.increase_block_chance, percent, 100.0);
    if let Some(dmg) = &e.increase_attack_damage {
        let dmg_max = get_percentage(dmg.max, percent, 100.0);
        let dmg_min = get_percentage(dmg.min, percent, 100.0);
        stats.damage_potential.max += dmg_max;
        stats.damage_potential.min += dmg_min;
        weapon_damage.max += dmg_max;
        weapon_damage.min += dmg_min;
    }
    stats.critical_skill += get_percentage(e.increase_critical_skill, percent, 100.0);
    stats.max_hp += get_percentage(e.increase_max_hp, percent, 100.0);
    stats.damage_resistance += get_percentage(e.increase_damage_resistance, percent, 100.0);
    stats.max_ap += get_percentage(e.increase_max_ap, percent, 100.0);
    stats.move_cost += get_percentage(e.increase_move_cost, 100.0, percent);
    stats.reequip_cost += get_percentage(e.increase_reequip_cost, 100.0, percent);
    stats.use_item_cost += get_percentage(e.increase_use_item_cost, 100.0, percent);
}

// statEngine.js:174-191 (computeWeaponPairAttackCost).
pub fn compute_weapon_pair_attack_cost(main_hand: Option<&Item>, off_hand: Option<&Item>, skill_levels: &HashMap<String, f64>) -> f64 {
    let main_is_weapon = is_weapon(main_hand);
    let off_is_weapon = is_weapon(off_hand);
    if !main_is_weapon && !off_is_weapon {
        return 0.0;
    }
    if !(main_is_weapon && off_is_weapon) {
        let weapon = if main_is_weapon { main_hand } else { off_hand };
        return weapon.map(|w| w.equip_effect.increase_attack_cost).unwrap_or(0.0);
    }
    let attack_cost_main = main_hand.map(|w| w.equip_effect.increase_attack_cost).unwrap_or(0.0);
    let attack_cost_off = off_hand.map(|w| w.equip_effect.increase_attack_cost).unwrap_or(0.0);
    let fs_level = lvl(skill_levels, si::FIGHTSTYLE_DUAL_WIELD);
    if fs_level >= 2.0 {
        return attack_cost_main.max(attack_cost_off);
    }
    if fs_level == 1.0 {
        return attack_cost_main.max(attack_cost_off)
            + get_percentage(attack_cost_main.min(attack_cost_off), sc::DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT, 0.0);
    }
    attack_cost_main + attack_cost_off
}

// statEngine.js:197-202 (getDualWieldEfficiencyPercent).
pub fn get_dual_wield_efficiency_percent(skill_levels: &HashMap<String, f64>) -> f64 {
    let fs_level = lvl(skill_levels, si::FIGHTSTYLE_DUAL_WIELD);
    if fs_level >= 2.0 {
        return sc::DUALWIELD_EFFICIENCY_LEVEL2;
    }
    if fs_level == 1.0 {
        return sc::DUALWIELD_EFFICIENCY_LEVEL1;
    }
    sc::DUALWIELD_EFFICIENCY_LEVEL0
}

// statEngine.js:289-345 (applyFightingStyles).
fn apply_fighting_styles(stats: &mut PlayerStats, equipped: &Equipped, skill_levels: &HashMap<String, f64>, weapon_damage: &mut WeaponDamage) {
    let main_hand = equipped.weapon;
    let off_hand = equipped.shield;

    if lvl(skill_levels, si::FIGHTSTYLE_UNARMED_UNARMORED) > 0.0 && is_unarmored(equipped) && main_hand.is_none() && off_hand.is_none() {
        let level = lvl(skill_levels, si::FIGHTSTYLE_UNARMED_UNARMORED);
        stats.block_chance += sc::UNARMED_UNARMORED_BC * level;
        stats.damage_resistance += sc::UNARMED_UNARMORED_DR * level;
        stats.attack_chance += sc::UNARMED_UNARMORED_AC * level;
        stats.damage_potential.max += sc::UNARMED_UNARMORED_DMG_MAX * level;
        stats.critical_multiplier = 1.0 + (sc::UNARMED_UNARMORED_CM_PERCENT / 100.0) * level;
    }

    if is_wielding_2hand(main_hand, off_hand) {
        let main_hand = main_hand.unwrap();
        let fs = lvl(skill_levels, si::FIGHTSTYLE_2HAND);
        let spec = lvl(skill_levels, si::SPECIALIZATION_2HAND);
        let dmg = main_hand.equip_effect.increase_attack_damage.clone().unwrap_or(Range { min: 0.0, max: 0.0 });
        let fs_max = get_percentage(dmg.max, fs * sc::FIGHTSTYLE_2HAND_DMG_PERCENT, 0.0);
        let fs_min = get_percentage(dmg.min, fs * sc::FIGHTSTYLE_2HAND_DMG_PERCENT, 0.0);
        let spec_max = get_percentage(dmg.max, spec * sc::SPECIALIZATION_2HAND_DMG_PERCENT, 0.0);
        let spec_min = get_percentage(dmg.min, spec * sc::SPECIALIZATION_2HAND_DMG_PERCENT, 0.0);
        stats.damage_potential.max += fs_max;
        stats.damage_potential.min += fs_min;
        stats.damage_potential.max += spec_max;
        stats.damage_potential.min += spec_min;
        weapon_damage.max += fs_max + spec_max;
        weapon_damage.min += fs_min + spec_min;
        stats.attack_chance += get_percentage(main_hand.equip_effect.increase_attack_chance, spec * sc::SPECIALIZATION_2HAND_AC_PERCENT, 0.0);
    }

    if is_wielding_weapon_and_shield(main_hand, off_hand) {
        let main_hand = main_hand.unwrap();
        let off_hand = off_hand.unwrap();
        let fs = lvl(skill_levels, si::FIGHTSTYLE_WEAPON_SHIELD);
        let spec = lvl(skill_levels, si::SPECIALIZATION_WEAPON_SHIELD);
        stats.attack_chance += get_percentage(main_hand.equip_effect.increase_attack_chance, fs * sc::FIGHTSTYLE_WEAPON_AC_PERCENT, 0.0);
        stats.block_chance += get_percentage(off_hand.equip_effect.increase_block_chance, fs * sc::FIGHTSTYLE_SHIELD_BC_PERCENT, 0.0);
        stats.attack_chance += get_percentage(main_hand.equip_effect.increase_attack_chance, spec * sc::SPECIALIZATION_WEAPON_AC_PERCENT, 0.0);
        let dmg = main_hand.equip_effect.increase_attack_damage.clone().unwrap_or(Range { min: 0.0, max: 0.0 });
        let spec_max = get_percentage(dmg.max, spec * sc::SPECIALIZATION_WEAPON_DMG_PERCENT, 0.0);
        let spec_min = get_percentage(dmg.min, spec * sc::SPECIALIZATION_WEAPON_DMG_PERCENT, 0.0);
        stats.damage_potential.max += spec_max;
        stats.damage_potential.min += spec_min;
        weapon_damage.max += spec_max;
        weapon_damage.min += spec_min;
    }

    if is_dual_wielding(main_hand, off_hand) {
        let main_hand_item = main_hand.unwrap();
        let off_hand_item = off_hand.unwrap();
        apply_dual_wield(stats, main_hand_item, off_hand_item, skill_levels, weapon_damage);
        let spec_level = lvl(skill_levels, si::SPECIALIZATION_DUAL_WIELD);
        if spec_level > 0.0 {
            stats.attack_chance += get_percentage(main_hand_item.equip_effect.increase_attack_chance, spec_level * sc::SPECIALIZATION_DUALWIELD_AC_PERCENT, 0.0);
            stats.block_chance += get_percentage(main_hand_item.equip_effect.increase_block_chance, spec_level * sc::SPECIALIZATION_DUALWIELD_BC_PERCENT, 0.0);
            stats.attack_chance += get_percentage(off_hand_item.equip_effect.increase_attack_chance, spec_level * sc::SPECIALIZATION_DUALWIELD_AC_PERCENT, 0.0);
            stats.block_chance += get_percentage(off_hand_item.equip_effect.increase_block_chance, spec_level * sc::SPECIALIZATION_DUALWIELD_BC_PERCENT, 0.0);
        }
    }
}

// statEngine.js:350-391 (applyEquipment).
fn apply_equipment(stats: &mut PlayerStats, equipped: &Equipped, skill_levels: &HashMap<String, f64>) -> WeaponDamage {
    let main_hand = equipped.weapon;
    let off_hand = equipped.shield;
    let mut weapon_damage = WeaponDamage { min: 0.0, max: 0.0 };

    let has_main_weapon = is_weapon(main_hand) || is_weapon(off_hand);
    if has_main_weapon {
        stats.attack_cost = 0.0;
    }
    if let Some(mh) = main_hand {
        if let Some(cm) = mh.equip_effect.set_critical_multiplier {
            stats.critical_multiplier = cm;
        }
        apply_ability_effects(stats, Some(&mh.equip_effect), 1.0);
        if is_weapon(main_hand) {
            if let Some(dmg) = &mh.equip_effect.increase_attack_damage {
                weapon_damage.min += dmg.min;
                weapon_damage.max += dmg.max;
            }
        }
    }

    let dual_wielding = is_dual_wielding(main_hand, off_hand);
    if !dual_wielding {
        if let Some(oh) = off_hand {
            apply_ability_effects(stats, Some(&oh.equip_effect), 1.0);
            if is_weapon(off_hand) {
                if let Some(dmg) = &oh.equip_effect.increase_attack_damage {
                    weapon_damage.min += dmg.min;
                    weapon_damage.max += dmg.max;
                }
            }
        }
    }

    apply_fighting_styles(stats, equipped, skill_levels, &mut weapon_damage);

    for slot in ARMOR_SLOTS.iter().chain(["neck", "leftring", "rightring"].iter()) {
        if let Some(item) = equipped.get(slot) {
            apply_ability_effects(stats, Some(&item.equip_effect), 1.0);
        }
    }

    weapon_damage
}

// statEngine.js:396-445 (applyItemProficiencies).
fn apply_item_proficiencies(stats: &mut PlayerStats, equipped: &Equipped, skill_levels: &HashMap<String, f64>) {
    let main_weapon = equipped.weapon;

    if let Some(mw) = main_weapon {
        let skill = get_proficiency_skill_for_category(mw.category_link.as_ref());
        let level = skill.map(|s| lvl(skill_levels, s)).unwrap_or(0.0);
        if level > 0.0 {
            stats.attack_chance += get_percentage(mw.equip_effect.increase_attack_chance, sc::WEAPON_PROF_AC_PERCENT * level, 0.0);
            stats.block_chance += get_percentage(mw.equip_effect.increase_block_chance, sc::WEAPON_PROF_BC_PERCENT * level, 0.0);
            stats.critical_skill += get_percentage(mw.equip_effect.increase_critical_skill, sc::WEAPON_PROF_CS_PERCENT * level, 0.0);
        }
    }

    let unarmed_level = lvl(skill_levels, si::WEAPON_PROF_UNARMED);
    if unarmed_level > 0.0 && is_unarmed(equipped) {
        stats.attack_chance += sc::UNARMED_AC * unarmed_level;
        stats.damage_potential.max += sc::UNARMED_DMG * unarmed_level;
        stats.damage_potential.min += sc::UNARMED_DMG * unarmed_level;
        stats.block_chance += sc::UNARMED_BC * unarmed_level;
    }

    let shield = equipped.shield;
    if is_shield(shield) {
        let skill = get_proficiency_skill_for_category(shield.unwrap().category_link.as_ref());
        let level = skill.map(|s| lvl(skill_levels, s)).unwrap_or(0.0);
        stats.damage_resistance += sc::SHIELD_PROF_DR * level;
    }

    let unarmored_level = lvl(skill_levels, si::ARMOR_PROF_UNARMORED);
    if unarmored_level > 0.0 && is_unarmored(equipped) {
        stats.block_chance += sc::UNARMORED_BC * unarmored_level;
    }

    let light_level = lvl(skill_levels, si::ARMOR_PROF_LIGHT);
    let heavy_level = lvl(skill_levels, si::ARMOR_PROF_HEAVY);
    for slot in ARMOR_SLOTS.iter() {
        let item = match equipped.get(slot) {
            Some(i) => i,
            None => continue,
        };
        let skill = get_proficiency_skill_for_category(item.category_link.as_ref());
        if skill == Some(si::ARMOR_PROF_LIGHT) && light_level > 0.0 {
            stats.block_chance += get_percentage(item.equip_effect.increase_block_chance, sc::LIGHT_ARMOR_BC_PERCENT * light_level, 0.0);
        } else if skill == Some(si::ARMOR_PROF_HEAVY) && heavy_level > 0.0 {
            stats.block_chance += get_percentage(item.equip_effect.increase_block_chance, sc::HEAVY_ARMOR_BC_PERCENT * heavy_level, 0.0);
            stats.move_cost -= get_percentage(item.equip_effect.increase_move_cost, sc::HEAVY_ARMOR_MOVECOST_PERCENT * heavy_level, 0.0);
            stats.attack_cost -= get_percentage(item.equip_effect.increase_attack_cost, sc::HEAVY_ARMOR_ATKCOST_PERCENT * heavy_level, 0.0);
            stats.use_item_cost -= get_percentage(item.equip_effect.increase_use_item_cost, sc::HEAVY_ARMOR_USECOST_PERCENT * heavy_level, 0.0);
        }
    }
}

// statEngine.js:449-465 (applyGeneralCombatSkills).
pub fn apply_general_combat_skills(stats: &mut PlayerStats, skill_levels: &HashMap<String, f64>) {
    stats.attack_chance += sc::WEAPON_CHANCE * lvl(skill_levels, si::WEAPON_CHANCE);
    stats.damage_potential.max += sc::WEAPON_DAMAGE_MAX * lvl(skill_levels, si::WEAPON_DMG);
    stats.damage_potential.min += sc::WEAPON_DAMAGE_MIN * lvl(skill_levels, si::WEAPON_DMG);
    stats.block_chance += sc::DODGE * lvl(skill_levels, si::DODGE);
    stats.damage_resistance += sc::BARKSKIN * lvl(skill_levels, si::BARK_SKIN);

    if stats.critical_skill > 0.0 && lvl(skill_levels, si::MORE_CRITICALS) > 0.0 {
        stats.critical_skill += (stats.critical_skill * sc::MORE_CRITICALS_PERCENT * lvl(skill_levels, si::MORE_CRITICALS)) / 100.0;
    }
    if stats.critical_multiplier != 0.0 && stats.critical_multiplier != 1.0 && lvl(skill_levels, si::BETTER_CRITICALS) > 0.0 {
        stats.critical_multiplier += (stats.critical_multiplier * sc::BETTER_CRITICALS_PERCENT * lvl(skill_levels, si::BETTER_CRITICALS)) / 100.0;
    }
    stats.max_ap += sc::SPEED * lvl(skill_levels, si::SPEED);
}

// statEngine.js:473-482 (getEquipmentConditions).
pub fn get_equipment_conditions(equipped: &Equipped) -> Vec<ConditionEntry> {
    let mut entries = Vec::new();
    for slot in EQUIP_SLOTS.iter() {
        if let Some(item) = equipped.get(slot) {
            for c in &item.equip_effect.added_conditions {
                entries.push(c.clone());
            }
        }
    }
    entries
}

// statEngine.js:489-507 (mergeConditionInstances).
pub fn merge_condition_instances(entries: &[ConditionEntry], conditions_by_id: &HashMap<String, Condition>) -> Vec<(String, Option<f64>)> {
    let mut order: Vec<String> = Vec::new();
    let mut merged: HashMap<String, Option<f64>> = HashMap::new();
    for entry in entries {
        let condition = match conditions_by_id.get(&entry.condition) {
            Some(c) => c,
            None => continue, // unknown condition id: debug-logged in JS, silently skipped here (no console in WASM)
        };
        match merged.get(&entry.condition) {
            None => {
                merged.insert(entry.condition.clone(), entry.magnitude);
                order.push(entry.condition.clone());
            }
            Some(&existing) => {
                // JS: `existing + magnitude` / `Math.max(existing, magnitude)` with
                // either side `undefined` produces NaN, which then flows into
                // applyActiveConditions' `magnitude <= 0` check (false, i.e. not
                // skipped) and an effective multiplier of NaN - a real but
                // vanishingly rare data-quality edge case (two instances of the
                // same equipment-granted condition where at least one omits
                // magnitude) that would corrupt the whole result either way.
                // Rather than reproduce NaN propagation, treat a missing side as
                // "no contribution from that instance" - closer in spirit to the
                // apply_active_conditions single-instance default (see
                // ConditionEntry::magnitude's doc comment) without the crash.
                let new_val = match (existing, entry.magnitude) {
                    (Some(a), Some(b)) => Some(if condition.is_stacking { a + b } else { a.max(b) }),
                    (Some(a), None) => Some(a),
                    (None, Some(b)) => Some(b),
                    (None, None) => None,
                };
                merged.insert(entry.condition.clone(), new_val);
            }
        }
    }
    order.into_iter().map(|id| { let v = merged[&id]; (id, v) }).collect()
}

// statEngine.js:515-524 (applyActiveConditions). A missing magnitude
// (`None`) does NOT fail the `magnitude <= 0` skip check (JS: `undefined <=
// 0` is false) and applies at full strength - JS's
// `applyAbilityEffects(stats, effect, multiplier = 1)` substitutes 1 for an
// explicitly-`undefined` argument. See ConditionEntry::magnitude's doc
// comment for why this differs from the procEffects.js proc-condition path.
pub fn apply_active_conditions(stats: &mut PlayerStats, active_conditions: &[ConditionEntry], conditions_by_id: &HashMap<String, Condition>) {
    let merged = merge_condition_instances(active_conditions, conditions_by_id);
    for (condition_id, magnitude) in merged {
        if magnitude.map_or(false, |m| m <= 0.0) {
            continue;
        }
        if let Some(condition) = conditions_by_id.get(&condition_id) {
            if let Some(ability_effect) = &condition.ability_effect {
                apply_ability_effects(stats, Some(ability_effect), magnitude.unwrap_or(1.0));
            }
        }
    }
}

// statEngine.js:530-561 (applyNonWeaponDamageModifier).
fn apply_non_weapon_damage_modifier(stats: &mut PlayerStats, equipped: &Equipped, weapon_damage: &WeaponDamage, skill_levels: &HashMap<String, f64>) {
    let main_weapon = equipped.weapon;
    let off_weapon = if is_weapon(equipped.shield) { equipped.shield } else { None };

    let modifier1 = main_weapon.and_then(|w| w.equip_effect.set_non_weapon_damage_modifier).unwrap_or(-1.0);
    let modifier2 = off_weapon.and_then(|w| w.equip_effect.set_non_weapon_damage_modifier).unwrap_or(-1.0);

    let modifier = if modifier1 >= 0.0 && modifier2 >= 0.0 {
        let fs_level = lvl(skill_levels, si::FIGHTSTYLE_DUAL_WIELD);
        if fs_level == 2.0 {
            modifier1.max(modifier2)
        } else if fs_level == 1.0 {
            ((modifier1 + modifier2) / 2.0).floor()
        } else {
            modifier1.min(modifier2)
        }
    } else if modifier1 <= 0.0 && modifier2 >= 0.0 {
        modifier2
    } else if modifier2 <= 0.0 && modifier1 >= 0.0 {
        modifier1
    } else {
        100.0
    };

    if modifier != 100.0 {
        let min_base_damage = stats.damage_potential.min - weapon_damage.min;
        let max_base_damage = stats.damage_potential.max - weapon_damage.max;
        stats.damage_potential.min += round_half_away_from_zero(min_base_damage * ((modifier - 100.0) / 100.0));
        stats.damage_potential.max += round_half_away_from_zero(max_base_damage * ((modifier - 100.0) / 100.0));
    }
}

// JS Math.round rounds half-up (toward +Infinity) even for negatives, unlike
// Rust's f64::round which rounds half away from zero. Match Math.round exactly.
fn round_half_away_from_zero(x: f64) -> f64 {
    (x + 0.5).floor()
}

// statEngine.js:566-588 (resolveEquipped).
pub fn resolve_equipped<'a>(equipment: &Equipment, items_by_id: &'a HashMap<String, Item>) -> Equipped<'a> {
    let lookup = |id: &Option<String>| -> Option<&'a Item> {
        id.as_ref().and_then(|id| items_by_id.get(id))
    };
    let mut equipped = Equipped {
        weapon: lookup(&equipment.weapon),
        shield: lookup(&equipment.shield),
        head: lookup(&equipment.head),
        body: lookup(&equipment.body),
        hand: lookup(&equipment.hand),
        feet: lookup(&equipment.feet),
        neck: lookup(&equipment.neck),
        leftring: lookup(&equipment.leftring),
        rightring: lookup(&equipment.rightring),
    };
    if is_twohand_weapon(equipped.weapon) {
        equipped.shield = None;
    }
    equipped
}

// statEngine.js:623-638 (resolvePlayerStats).
pub fn resolve_player_stats(build: &Build, items_by_id: &HashMap<String, Item>, conditions_by_id: &HashMap<String, Condition>, precomputed_base_stats: Option<&PlayerStats>) -> PlayerStats {
    let mut stats = match precomputed_base_stats {
        Some(base) => base.clone(),
        None => build_base_stats(build.level, &build.level_up_choices, &build.fortitude_levels),
    };
    let equipped = resolve_equipped(&build.equipment, items_by_id);

    let weapon_damage = apply_equipment(&mut stats, &equipped, &build.skill_levels);
    apply_item_proficiencies(&mut stats, &equipped, &build.skill_levels);
    apply_general_combat_skills(&mut stats, &build.skill_levels);
    let equipment_conditions = get_equipment_conditions(&equipped);
    let mut all_conditions = equipment_conditions;
    all_conditions.extend(build.active_conditions.iter().cloned());
    apply_active_conditions(&mut stats, &all_conditions, conditions_by_id);
    apply_non_weapon_damage_modifier(&mut stats, &equipped, &weapon_damage, &build.skill_levels);
    clamp_stats(&mut stats);

    stats
}

// statEngine.js:642-658 (resolveMonsterStats).
pub fn resolve_monster_stats(monster: &Monster, active_conditions: &[ConditionEntry], conditions_by_id: &HashMap<String, Condition>) -> PlayerStats {
    let mut stats = PlayerStats {
        attack_cost: monster.attack_cost,
        attack_chance: monster.attack_chance,
        critical_skill: monster.critical_skill,
        critical_multiplier: monster.critical_multiplier,
        damage_potential: monster.attack_damage.clone().unwrap_or(Range { min: 0.0, max: 0.0 }),
        block_chance: monster.block_chance,
        damage_resistance: monster.damage_resistance,
        max_hp: monster.max_hp,
        max_ap: monster.max_ap.unwrap_or(10.0),
        is_immune_to_critical_hits: monster.is_immune_to_critical_hits,
        move_cost: 0.0,
        use_item_cost: 0.0,
        reequip_cost: 0.0,
    };
    apply_active_conditions(&mut stats, active_conditions, conditions_by_id);
    clamp_stats(&mut stats);
    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::LevelUpChoices;

    fn empty_build(level: u32, health_choices: f64) -> Build {
        Build {
            level,
            level_up_choices: LevelUpChoices { health: health_choices, ..Default::default() },
            fortitude_levels: vec![],
            equipment: Equipment::default(),
            skill_levels: HashMap::new(),
            active_conditions: vec![],
        }
    }

    // Golden value captured from the real statEngine.js via
    // `resolvePlayerStats({ level: 5, levelUpChoices: { health: 4 }, ... }, { itemsById: {}, conditionsById: {} })`.
    #[test]
    fn resolve_player_stats_matches_js_golden_value_no_equipment() {
        let build = empty_build(5, 4.0);
        let items_by_id = HashMap::new();
        let conditions_by_id = HashMap::new();
        let stats = resolve_player_stats(&build, &items_by_id, &conditions_by_id, None);
        assert_eq!(stats.max_ap, 10.0);
        assert_eq!(stats.attack_chance, 60.0);
        assert_eq!(stats.damage_resistance, 0.0);
        assert_eq!(stats.max_hp, 45.0);
        assert_eq!(stats.attack_cost, 4.0);
        assert_eq!(stats.block_chance, 9.0);
        assert_eq!(stats.damage_potential.min, 1.0);
        assert_eq!(stats.damage_potential.max, 1.0);
    }

    fn condition(id: &str, is_stacking: bool, ability_effect: Option<crate::model::EquipEffect>) -> (String, Condition) {
        (id.to_string(), Condition { id: id.to_string(), is_stacking, ability_effect, round_effect: None })
    }

    // Golden value captured from the real statEngine.js via
    // `resolveMonsterStats(monster, [{ conditionId: 'poisoned', magnitude: 2 }], conditionsById)`
    // with monster = { attackCost: 4, attackChance: 40, criticalSkill: 5,
    // criticalMultiplier: 1.5, attackDamage: { min: 2, max: 6 }, blockChance: 3,
    // damageResistance: 1, maxHP: 20, maxAP: 12 } and poisoned's abilityEffect
    // = { increaseDamageResistance: -2 } (magnitude 2 -> -4 applied).
    #[test]
    fn resolve_monster_stats_matches_js_golden_value() {
        let mut conditions_by_id = HashMap::new();
        let (id, c) = condition("poisoned", true, Some(crate::model::EquipEffect { increase_damage_resistance: -2.0, ..Default::default() }));
        conditions_by_id.insert(id, c);

        let monster = Monster {
            id: "rat1".to_string(),
            attack_cost: 4.0,
            attack_chance: 40.0,
            critical_skill: 5.0,
            critical_multiplier: 1.5,
            attack_damage: Some(Range { min: 2.0, max: 6.0 }),
            block_chance: 3.0,
            damage_resistance: 1.0,
            max_hp: 20.0,
            max_ap: Some(12.0),
            is_immune_to_critical_hits: false,
            hit_effect: None,
            hit_received_effect: None,
            active_conditions: vec![],
        };
        let active = vec![ConditionEntry { condition: "poisoned".to_string(), magnitude: Some(2.0), ..Default::default() }];
        let stats = resolve_monster_stats(&monster, &active, &conditions_by_id);

        assert_eq!(stats.attack_cost, 4.0);
        assert_eq!(stats.attack_chance, 40.0);
        assert_eq!(stats.critical_skill, 5.0);
        assert_eq!(stats.critical_multiplier, 1.5);
        assert_eq!(stats.damage_potential.min, 2.0);
        assert_eq!(stats.damage_potential.max, 6.0);
        assert_eq!(stats.block_chance, 3.0);
        assert_eq!(stats.damage_resistance, -3.0);
        assert_eq!(stats.max_hp, 20.0);
        assert_eq!(stats.max_ap, 12.0);
        assert_eq!(stats.is_immune_to_critical_hits, false);
    }

    // Golden value from `mergeConditionInstances` with two `poisoned` (isStacking:
    // true) instances of magnitude 2+3 -> 5, and two `blessed` (isStacking:
    // false) instances of magnitude 1 and 5 -> max(1,5) = 5.
    #[test]
    fn merge_condition_instances_matches_js_golden_value() {
        let mut conditions_by_id = HashMap::new();
        let (id1, c1) = condition("poisoned", true, None);
        let (id2, c2) = condition("blessed", false, None);
        conditions_by_id.insert(id1, c1);
        conditions_by_id.insert(id2, c2);

        let entries = vec![
            ConditionEntry { condition: "poisoned".to_string(), magnitude: Some(2.0), ..Default::default() },
            ConditionEntry { condition: "poisoned".to_string(), magnitude: Some(3.0), ..Default::default() },
            ConditionEntry { condition: "blessed".to_string(), magnitude: Some(1.0), ..Default::default() },
            ConditionEntry { condition: "blessed".to_string(), magnitude: Some(5.0), ..Default::default() },
        ];
        let merged = merge_condition_instances(&entries, &conditions_by_id);
        let as_map: HashMap<String, Option<f64>> = merged.into_iter().collect();
        assert_eq!(as_map["poisoned"], Some(5.0));
        assert_eq!(as_map["blessed"], Some(5.0));
    }

    // Regression test: a missing magnitude on an equipment-granted condition
    // (e.g. valugha_gloves' addedConditions entry for "clumsiness", which
    // has no magnitude key at all in the real game data) must apply that
    // condition's abilityEffect at full (1x) strength, matching JS's
    // `applyAbilityEffects(stats, effect, multiplier = 1)` default
    // parameter - NOT skip it, and NOT apply at 0x. Found via a real
    // browser run: without this, attackChance/blockChance came out 7 higher
    // than the live JS engine for a build wearing that item.
    #[test]
    fn apply_active_conditions_applies_missing_magnitude_at_full_strength() {
        let mut conditions_by_id = HashMap::new();
        let (id, c) = condition("clumsiness", false, Some(crate::model::EquipEffect { increase_attack_chance: -7.0, increase_block_chance: -7.0, ..Default::default() }));
        conditions_by_id.insert(id, c);

        let entries = vec![ConditionEntry { condition: "clumsiness".to_string(), magnitude: None, ..Default::default() }];
        let mut stats = PlayerStats::default();
        apply_active_conditions(&mut stats, &entries, &conditions_by_id);
        assert_eq!(stats.attack_chance, -7.0);
        assert_eq!(stats.block_chance, -7.0);
    }

    // Golden value from `resolveEquipped({ weapon: 'sword1' }, itemsById)` +
    // `getEquipmentConditions(equipped)` for a weapon whose equipEffect grants
    // one addedConditions entry.
    #[test]
    fn resolve_equipped_and_get_equipment_conditions_match_js_golden_value() {
        let mut items_by_id = HashMap::new();
        items_by_id.insert(
            "sword1".to_string(),
            Item {
                id: "sword1".to_string(),
                category: "weapon".to_string(),
                equip_effect: crate::model::EquipEffect {
                    increase_attack_chance: 15.0,
                    added_conditions: vec![ConditionEntry { condition: "blessed".to_string(), magnitude: Some(1.0), ..Default::default() }],
                    ..Default::default()
                },
                damage_potential: Some(Range { min: 2.0, max: 8.0 }),
                category_link: Some(CategoryLink { id: "lsword".to_string(), inventory_slot: "weapon".to_string(), size: "std".to_string() }),
                hit_effect: None,
                hit_received_effect: None,
                kill_effect: None,
            },
        );
        let equipment = Equipment { weapon: Some("sword1".to_string()), ..Default::default() };
        let equipped = resolve_equipped(&equipment, &items_by_id);
        assert_eq!(equipped.weapon.unwrap().id, "sword1");

        let conditions = get_equipment_conditions(&equipped);
        assert_eq!(conditions.len(), 1);
        assert_eq!(conditions[0].condition, "blessed");
        assert_eq!(conditions[0].magnitude, Some(1.0));
    }
}
