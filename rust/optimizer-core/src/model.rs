use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

// Shared shape for both equipEffect.addedConditions entries (condition +
// magnitude only) and hitEffect/killEffect/hitReceivedEffect
// conditionsSource/conditionsTarget entries (which also carry duration +
// chance) — procEffects.js reads the same object shape in both contexts,
// just ignores chance/duration where they don't apply.
#[derive(Debug, Deserialize, Clone, Default)]
pub struct ConditionEntry {
    pub condition: String,
    pub magnitude: f64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub chance: f64,
}

// statEngine.js:19-35 (applyAbilityEffects) reads exactly these fields off
// an equipEffect/abilityEffect object.
#[derive(Debug, Deserialize, Clone, Default)]
pub struct EquipEffect {
    #[serde(rename = "increaseMaxHP", default)]
    pub increase_max_hp: f64,
    #[serde(rename = "increaseMaxAP", default)]
    pub increase_max_ap: f64,
    #[serde(rename = "increaseMoveCost", default)]
    pub increase_move_cost: f64,
    #[serde(rename = "increaseAttackCost", default)]
    pub increase_attack_cost: f64,
    #[serde(rename = "increaseUseItemCost", default)]
    pub increase_use_item_cost: f64,
    #[serde(rename = "increaseReequipCost", default)]
    pub increase_reequip_cost: f64,
    #[serde(rename = "increaseAttackChance", default)]
    pub increase_attack_chance: f64,
    #[serde(rename = "increaseCriticalSkill", default)]
    pub increase_critical_skill: f64,
    #[serde(rename = "increaseAttackDamage")]
    pub increase_attack_damage: Option<Range>,
    #[serde(rename = "increaseBlockChance", default)]
    pub increase_block_chance: f64,
    #[serde(rename = "increaseDamageResistance", default)]
    pub increase_damage_resistance: f64,
    #[serde(rename = "addedConditions", default)]
    pub added_conditions: Vec<ConditionEntry>,
    #[serde(rename = "setCriticalMultiplier")]
    pub set_critical_multiplier: Option<f64>,
    #[serde(rename = "setNonWeaponDamageModifier")]
    pub set_non_weapon_damage_modifier: Option<f64>,
}

// The subset of an item's linked ItemCategory (Main.jsx's linkTemp())
// statEngine.js/skillData.js read: inventorySlot ("weapon"/"shield"/
// "head"/"body"/"hand"/"feet"/...), size ("large" = two-handed weapon or
// heavy armor; "light"/"std" = light armor), and category id (weapon
// proficiency lookup).
#[derive(Debug, Deserialize, Clone)]
pub struct CategoryLink {
    pub id: String,
    #[serde(rename = "inventorySlot")]
    pub inventory_slot: String,
    #[serde(default)]
    pub size: String,
}

// Union of the fields combatMath.js reads off hitEffect/hitReceivedEffect/
// killEffect. Not every field applies in every context (e.g. killEffect
// never reads conditionsTarget/increaseAttackerCurrentAP/
// increaseAttackerCurrentHP) — matching procEffects.js's/combatMath.js's own
// approach of reading the same JSON object shape with `?.` regardless of
// which fields a given effect slot actually populates, rather than three
// separate Rust types for what's one shape in the game's JSON.
#[derive(Debug, Deserialize, Clone, Default)]
pub struct ProcEffect {
    #[serde(rename = "increaseCurrentAP")]
    pub increase_current_ap: Option<Range>,
    #[serde(rename = "increaseCurrentHP")]
    pub increase_current_hp: Option<Range>,
    #[serde(rename = "increaseAttackerCurrentAP")]
    pub increase_attacker_current_ap: Option<Range>,
    #[serde(rename = "increaseAttackerCurrentHP")]
    pub increase_attacker_current_hp: Option<Range>,
    #[serde(rename = "conditionsSource", default)]
    pub conditions_source: Vec<ConditionEntry>,
    #[serde(rename = "conditionsTarget", default)]
    pub conditions_target: Vec<ConditionEntry>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Item {
    pub id: String,
    pub category: String,
    #[serde(rename = "equipEffect", default)]
    pub equip_effect: EquipEffect,
    #[serde(rename = "damagePotential")]
    pub damage_potential: Option<Range>,
    #[serde(rename = "categoryLink")]
    pub category_link: Option<CategoryLink>,
    #[serde(rename = "hitEffect")]
    pub hit_effect: Option<ProcEffect>,
    #[serde(rename = "hitReceivedEffect")]
    pub hit_received_effect: Option<ProcEffect>,
    #[serde(rename = "killEffect")]
    pub kill_effect: Option<ProcEffect>,
}

// Monster.resetStatsToBaseTraits (Monster.java:50-66), as read by
// statEngine.js:642-658 (resolveMonsterStats).
#[derive(Debug, Deserialize, Clone)]
pub struct Monster {
    pub id: String,
    #[serde(rename = "attackCost", default)]
    pub attack_cost: f64,
    #[serde(rename = "attackChance", default)]
    pub attack_chance: f64,
    #[serde(rename = "criticalSkill", default)]
    pub critical_skill: f64,
    #[serde(rename = "criticalMultiplier", default)]
    pub critical_multiplier: f64,
    #[serde(rename = "attackDamage")]
    pub attack_damage: Option<Range>,
    #[serde(rename = "blockChance", default)]
    pub block_chance: f64,
    #[serde(rename = "damageResistance", default)]
    pub damage_resistance: f64,
    #[serde(rename = "maxHP", default)]
    pub max_hp: f64,
    #[serde(rename = "maxAP")]
    pub max_ap: Option<f64>,
    #[serde(rename = "isImmuneToCriticalHits", default)]
    pub is_immune_to_critical_hits: bool,
    #[serde(rename = "hitEffect")]
    pub hit_effect: Option<ProcEffect>,
    #[serde(rename = "hitReceivedEffect")]
    pub hit_received_effect: Option<ProcEffect>,
    #[serde(rename = "activeConditions", default)]
    pub active_conditions: Vec<ConditionEntry>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RoundEffect {
    #[serde(rename = "increaseCurrentHP")]
    pub increase_current_hp: Option<Range>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Condition {
    pub id: String,
    #[serde(rename = "roundEffect")]
    pub round_effect: Option<RoundEffect>,
    #[serde(rename = "isStacking", default)]
    pub is_stacking: bool,
    #[serde(rename = "abilityEffect")]
    pub ability_effect: Option<EquipEffect>,
    // extended in Phase A3 as get_expected_condition_hp_per_round needs
    // roundEffect.increaseCurrentHP.
}

// statEngine.js's EQUIP_SLOTS: weapon/shield are the two hands, the rest
// are armor + accessory slots. `build.equipment` maps slot -> item id;
// resolve_equipped (Phase A2) turns this into slot -> Option<&Item>.
#[derive(Debug, Deserialize, Clone, Default)]
pub struct Equipment {
    pub weapon: Option<String>,
    pub shield: Option<String>,
    pub head: Option<String>,
    pub body: Option<String>,
    pub hand: Option<String>,
    pub feet: Option<String>,
    pub neck: Option<String>,
    pub leftring: Option<String>,
    pub rightring: Option<String>,
}

// levelModel.js's applyLevelUpChoices reads these fields off
// build.levelUpChoices; they must sum to `level - 1`.
#[derive(Debug, Deserialize, Clone, Default)]
pub struct LevelUpChoices {
    #[serde(default)]
    pub health: f64,
    #[serde(rename = "attackChance", default)]
    pub attack_chance: f64,
    #[serde(rename = "attackDamage", default)]
    pub attack_damage: f64,
    #[serde(rename = "blockChance", default)]
    pub block_chance: f64,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct Build {
    pub level: u32,
    #[serde(rename = "levelUpChoices", default)]
    pub level_up_choices: LevelUpChoices,
    #[serde(rename = "fortitudeLevels", default)]
    pub fortitude_levels: Vec<u32>,
    #[serde(default)]
    pub equipment: Equipment,
    #[serde(rename = "skillLevels", default)]
    pub skill_levels: HashMap<String, f64>,
    #[serde(rename = "activeConditions", default)]
    pub active_conditions: Vec<ConditionEntry>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Horde {
    pub size: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Target {
    pub monster: Monster,
    pub horde: Option<Horde>,
}

// Already combinedScore-sorted (best first) per slot — produced by the
// existing JS valueScoring.js/selectCandidates, not reimplemented here (see
// Phase A4's plan interfaces note: Rust only consumes the already-ranked
// output).
#[derive(Debug, Deserialize, Clone, Default)]
pub struct CandidateLists {
    #[serde(default)]
    pub weapon: Vec<Item>,
    #[serde(default)]
    pub shield: Vec<Item>,
    #[serde(default)]
    pub head: Vec<Item>,
    #[serde(default)]
    pub body: Vec<Item>,
    #[serde(default)]
    pub hand: Vec<Item>,
    #[serde(default)]
    pub feet: Vec<Item>,
    #[serde(default)]
    pub neck: Vec<Item>,
    #[serde(default)]
    pub leftring: Vec<Item>,
    #[serde(default)]
    pub rightring: Vec<Item>,
}

impl CandidateLists {
    pub fn get(&self, slot: &str) -> &[Item] {
        match slot {
            "weapon" => &self.weapon,
            "shield" => &self.shield,
            "head" => &self.head,
            "body" => &self.body,
            "hand" => &self.hand,
            "feet" => &self.feet,
            "neck" => &self.neck,
            "leftring" => &self.leftring,
            "rightring" => &self.rightring,
            _ => &[],
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct SearchConfig {
    pub build: Build,
    pub targets: Vec<Target>,
    #[serde(rename = "itemsById")]
    pub items_by_id: HashMap<String, Item>,
    #[serde(rename = "conditionsById")]
    pub conditions_by_id: HashMap<String, Condition>,
    #[serde(rename = "candidateLists")]
    pub candidate_lists: CandidateLists,
    #[serde(rename = "maxHpLoss")]
    pub max_hp_loss: Option<f64>,
    #[serde(rename = "limitedItemIds", default)]
    pub limited_item_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_item_with_equip_effect() {
        let json = r#"{
            "id": "sword1",
            "category": "weapon",
            "equipEffect": { "increaseMaxAP": 0 },
            "damagePotential": { "min": 1, "max": 5 }
        }"#;
        let item: Item = serde_json::from_str(json).unwrap();
        assert_eq!(item.id, "sword1");
        assert_eq!(item.damage_potential.unwrap().max, 5.0);
    }
}
