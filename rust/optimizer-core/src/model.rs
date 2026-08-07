use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Clone)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ConditionEntry {
    pub condition: String,
    pub magnitude: f64,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct EquipEffect {
    #[serde(rename = "increaseMaxAP", default)]
    pub increase_max_ap: f64,
    #[serde(rename = "addedConditions", default)]
    pub added_conditions: Vec<ConditionEntry>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Item {
    pub id: String,
    pub category: String,
    #[serde(rename = "equipEffect", default)]
    pub equip_effect: EquipEffect,
    #[serde(rename = "damagePotential")]
    pub damage_potential: Option<Range>,
    // ... remaining fields (hitEffect, hitReceivedEffect, killEffect,
    // categoryLink) added in the same style as combatMath.js/statEngine.js
    // read them — extend this struct incrementally as later phases need
    // each field, rather than guessing the full shape up front.
}

#[derive(Debug, Deserialize, Clone)]
pub struct Monster {
    pub id: String,
    // extended incrementally in Phase A2 as statEngine.js's
    // resolveMonsterStats needs each field.
}

#[derive(Debug, Deserialize, Clone)]
pub struct Condition {
    pub id: String,
    // extended incrementally in Phase A2/A3 as merge_condition_instances /
    // get_expected_condition_hp_per_round need each field.
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct Equipment {
    // extended incrementally in Phase A2 as resolve_equipped needs each
    // slot field (weapon, shield, head, body, hand, feet, neck, rings...).
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct Build {
    pub level: u32,
    #[serde(default)]
    pub equipment: Equipment,
    #[serde(rename = "skillLevels", default)]
    pub skill_levels: HashMap<String, f64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Target {
    // extended incrementally in Phase A3/A4 as search.rs/combat_math.rs
    // need each field (monster id, horde config, ...).
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct CandidateLists {
    // extended incrementally in Phase A4 as buildDimensions'/searchBestBuilds'
    // Rust port needs each slot's candidate id list.
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
