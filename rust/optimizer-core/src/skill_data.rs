// Hand-transcribed from src/utils/combat/skillData.js — only the pieces
// combat math (statEngine.js/combatMath.js) actually reads: skill ID
// strings, per-skillpoint constants, and category->proficiency-skill
// mapping. skillData.js's UI-only exports (SKILL_META, LEVELUP_REQUIREMENTS,
// canLevelUpSkillTo, describeUnmetRequirement) gate skill-point allocation
// in the UI and are not read by the combat formulas this crate ports.

pub mod skill_ids {
    pub const WEAPON_CHANCE: &str = "weaponChance";
    pub const WEAPON_DMG: &str = "weaponDmg";
    pub const DODGE: &str = "dodge";
    pub const BARK_SKIN: &str = "barkSkin";
    pub const MORE_CRITICALS: &str = "moreCriticals";
    pub const BETTER_CRITICALS: &str = "betterCriticals";
    pub const SPEED: &str = "speed";
    pub const FORTITUDE: &str = "fortitude";
    pub const EATER: &str = "eater";
    pub const CLEAVE: &str = "cleave";

    pub const WEAPON_PROF_DAGGER: &str = "weaponProficiencyDagger";
    pub const WEAPON_PROF_1HSWORD: &str = "weaponProficiency1hsword";
    pub const WEAPON_PROF_2HSWORD: &str = "weaponProficiency2hsword";
    pub const WEAPON_PROF_AXE: &str = "weaponProficiencyAxe";
    pub const WEAPON_PROF_BLUNT: &str = "weaponProficiencyBlunt";
    pub const WEAPON_PROF_POLE: &str = "weaponProficiencyPole";
    pub const WEAPON_PROF_UNARMED: &str = "weaponProficiencyUnarmed";

    pub const ARMOR_PROF_SHIELD: &str = "armorProficiencyShield";
    pub const ARMOR_PROF_LIGHT: &str = "armorProficiencyLight";
    pub const ARMOR_PROF_HEAVY: &str = "armorProficiencyHeavy";
    pub const ARMOR_PROF_UNARMORED: &str = "armorProficiencyUnarmored";

    pub const FIGHTSTYLE_UNARMED_UNARMORED: &str = "fightstyleUnarmedUnarmored";
    pub const FIGHTSTYLE_2HAND: &str = "fightstyle2hand";
    pub const FIGHTSTYLE_WEAPON_SHIELD: &str = "fightstyleWeaponShield";
    pub const FIGHTSTYLE_DUAL_WIELD: &str = "fightstyleDualWield";
    pub const SPECIALIZATION_2HAND: &str = "specialization2hand";
    pub const SPECIALIZATION_WEAPON_SHIELD: &str = "specializationWeaponShield";
    pub const SPECIALIZATION_DUAL_WIELD: &str = "specializationDualWield";

    pub const CRIT1: &str = "crit1";
    pub const CRIT2: &str = "crit2";
    pub const TAUNT: &str = "taunt";
    pub const CONCUSSION: &str = "concussion";
    pub const EVASION: &str = "evasion";
}

pub mod skill_constants {
    pub const WEAPON_CHANCE: f64 = 12.0;
    pub const WEAPON_DAMAGE_MAX: f64 = 2.0;
    pub const WEAPON_DAMAGE_MIN: f64 = 0.0;
    pub const DODGE: f64 = 9.0;
    pub const BARKSKIN: f64 = 1.0;
    pub const MORE_CRITICALS_PERCENT: f64 = 20.0;
    pub const BETTER_CRITICALS_PERCENT: f64 = 25.0;
    pub const SPEED: f64 = 1.0;
    pub const FORTITUDE_HEALTH: f64 = 1.0;
    pub const EATER_HEALTH: f64 = 1.0;
    pub const CLEAVE_AP: f64 = 3.0;

    pub const WEAPON_PROF_AC_PERCENT: f64 = 30.0;
    pub const WEAPON_PROF_BC_PERCENT: f64 = 30.0;
    pub const WEAPON_PROF_CS_PERCENT: f64 = 10.0;
    pub const UNARMED_AC: f64 = 20.0;
    pub const UNARMED_DMG: f64 = 2.0;
    pub const UNARMED_BC: f64 = 5.0;
    pub const SHIELD_PROF_DR: f64 = 1.0;
    pub const UNARMORED_BC: f64 = 10.0;
    pub const LIGHT_ARMOR_BC_PERCENT: f64 = 30.0;
    pub const HEAVY_ARMOR_BC_PERCENT: f64 = 20.0;
    pub const HEAVY_ARMOR_MOVECOST_PERCENT: f64 = 25.0;
    pub const HEAVY_ARMOR_ATKCOST_PERCENT: f64 = 25.0;
    pub const HEAVY_ARMOR_USECOST_PERCENT: f64 = 25.0;

    pub const UNARMED_UNARMORED_BC: f64 = 5.0;
    pub const UNARMED_UNARMORED_DR: f64 = 1.0;
    pub const UNARMED_UNARMORED_AC: f64 = 12.0;
    pub const UNARMED_UNARMORED_DMG_MAX: f64 = 4.0;
    pub const UNARMED_UNARMORED_CM_PERCENT: f64 = 25.0;

    pub const FIGHTSTYLE_2HAND_DMG_PERCENT: f64 = 30.0;
    pub const SPECIALIZATION_2HAND_DMG_PERCENT: f64 = 50.0;
    pub const SPECIALIZATION_2HAND_AC_PERCENT: f64 = 20.0;

    pub const FIGHTSTYLE_WEAPON_AC_PERCENT: f64 = 25.0;
    pub const FIGHTSTYLE_SHIELD_BC_PERCENT: f64 = 25.0;
    pub const SPECIALIZATION_WEAPON_AC_PERCENT: f64 = 50.0;
    pub const SPECIALIZATION_WEAPON_DMG_PERCENT: f64 = 20.0;

    pub const DUALWIELD_EFFICIENCY_LEVEL0: f64 = 25.0;
    pub const DUALWIELD_EFFICIENCY_LEVEL1: f64 = 50.0;
    pub const DUALWIELD_EFFICIENCY_LEVEL2: f64 = 100.0;
    pub const DUALWIELD_LEVEL1_OFFHAND_AP_COST_PERCENT: f64 = 50.0;
    pub const SPECIALIZATION_DUALWIELD_AC_PERCENT: f64 = 50.0;
    pub const SPECIALIZATION_DUALWIELD_BC_PERCENT: f64 = 50.0;

    pub const CRIT1_CHANCE_PERCENT: f64 = 50.0;
    pub const CRIT2_CHANCE_PERCENT: f64 = 50.0;
    pub const CRIT_CONDITION_MAGNITUDE: f64 = 1.0;
    pub const CRIT_CONDITION_DURATION: f64 = 5.0;
    pub const TAUNT_CHANCE_PERCENT: f64 = 75.0;
    pub const TAUNT_AP_LOSS: f64 = 2.0;
    pub const CONCUSSION_CHANCE_PERCENT: f64 = 15.0;
    pub const CONCUSSION_THRESHOLD: f64 = 50.0;
    pub const CONCUSSION_CONDITION_MAGNITUDE: f64 = 1.0;
    pub const CONCUSSION_CONDITION_DURATION: f64 = 5.0;
}

use crate::model::CategoryLink;

fn weapon_category_to_proficiency(category_id: &str) -> Option<&'static str> {
    use skill_ids::*;
    match category_id {
        "dagger" | "ssword" => Some(WEAPON_PROF_DAGGER),
        "rapier" | "lsword" | "bsword" => Some(WEAPON_PROF_1HSWORD),
        "2hsword" => Some(WEAPON_PROF_2HSWORD),
        "axe" | "axe2h" => Some(WEAPON_PROF_AXE),
        "club" | "staff" | "mace" | "scepter" | "hammer" | "hammer2h" | "whip" => Some(WEAPON_PROF_BLUNT),
        "pole" => Some(WEAPON_PROF_POLE),
        _ => None,
    }
}

// skillData.js:145-158 (getProficiencySkillForCategory).
pub fn get_proficiency_skill_for_category(category_link: Option<&CategoryLink>) -> Option<&'static str> {
    let category_link = category_link?;
    if category_link.inventory_slot == "weapon" {
        return weapon_category_to_proficiency(&category_link.id);
    }
    if category_link.inventory_slot == "shield" {
        return Some(skill_ids::ARMOR_PROF_SHIELD);
    }
    if ["head", "body", "hand", "feet"].contains(&category_link.inventory_slot.as_str()) {
        if category_link.size == "light" || category_link.size == "std" {
            return Some(skill_ids::ARMOR_PROF_LIGHT);
        }
        if category_link.size == "large" {
            return Some(skill_ids::ARMOR_PROF_HEAVY);
        }
    }
    None
}
