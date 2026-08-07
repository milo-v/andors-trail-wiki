// Line-for-line port of src/utils/combat/optimizer.js:139-570 (insertIntoTop10,
// isDisallowedPair, buildWeaponShieldPairs, sameCandidateSet, buildRingPairs,
// buildDimensions, MaxHeap, bestFirstCombos, searchBestBuilds).
//
// Tie-break/traversal-order note: bestFirstCombos yields combos in a
// best-first (lowest rank-sum first) order for progress-display purposes,
// but the *set* of combos visited before completion — and therefore the
// final top10 — is order-independent of how same-rank-sum ties are broken
// internally. The JS's hand-rolled MaxHeap breaks ties by its own swap
// mechanics; this port uses std::collections::BinaryHeap (via Reverse) with
// index-vector tie-break instead of reimplementing that exact tie order.
// Both are valid orderings of "lowest rank sum first" and converge to an
// identical top10 once the search runs to completion.

use crate::model::{Build, CandidateLists, Condition, Horde, Item, Monster, SearchConfig, Target};
use crate::combat_math::{compute_combat_summary, CombatSummary, Precomputed};
use crate::skill_data::skill_ids as si;
use crate::stat_engine::{build_base_stats, apply_general_combat_skills, compute_weapon_pair_attack_cost, is_twohand_weapon, is_weapon, resolve_monster_stats, Equipped, PlayerStats};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct Top10Entry {
    pub equipment: HashMap<&'static str, Option<String>>,
    pub summary: CombatSummary,
    pub build_number: u64,
}

// optimizer.js:139-149 (insertIntoTop10).
pub fn insert_into_top10(mut top10: Vec<Top10Entry>, entry: Top10Entry) -> Vec<Top10Entry> {
    top10.push(entry);
    top10.sort_by(|a, b| {
        let hp_a = a.summary.hp_loss_per_kill;
        let hp_b = b.summary.hp_loss_per_kill;
        if hp_a != hp_b {
            return hp_a.partial_cmp(&hp_b).unwrap();
        }
        b.summary.damage_per_turn.partial_cmp(&a.summary.damage_per_turn).unwrap()
    });
    top10.truncate(10);
    top10
}

// optimizer.js:157-160 (isDisallowedPair).
fn is_disallowed_pair(a: Option<&Item>, b: Option<&Item>, limited_item_ids: &HashSet<String>) -> bool {
    let (a, b) = match (a, b) {
        (Some(a), Some(b)) => (a, b),
        _ => return false,
    };
    if limited_item_ids.is_empty() {
        return false;
    }
    a.id == b.id && limited_item_ids.contains(&a.id)
}

const ARMOR_LIKE_SLOTS: [&str; 7] = ["head", "body", "hand", "feet", "neck", "leftring", "rightring"];
const SINGLE_SLOTS: [&str; 5] = ["head", "body", "hand", "feet", "neck"];

// optimizer.js:188-197 (computeMaxAchievableAP).
fn compute_max_achievable_ap(build: &Build, candidate_lists: &CandidateLists) -> f64 {
    let mut stats = build_base_stats(build.level, &build.level_up_choices, &build.fortitude_levels);
    apply_general_combat_skills(&mut stats, &build.skill_levels);
    let mut max_ap = stats.max_ap;
    for slot in ARMOR_LIKE_SLOTS.iter() {
        let items = candidate_lists.get(slot);
        let best = items.iter().fold(0.0_f64, |best, item| best.max(item.equip_effect.increase_max_ap));
        max_ap += best;
    }
    max_ap
}

// optimizer.js:199-234 (buildWeaponShieldPairs).
fn build_weapon_shield_pairs<'a>(
    weapon_candidates: &'a [Item],
    shield_candidates: &'a [Item],
    limited_item_ids: &HashSet<String>,
    skill_levels: &HashMap<String, f64>,
    max_achievable_ap: Option<f64>,
) -> Vec<Equipped<'a>> {
    let weapons: Vec<Option<&Item>> = if !weapon_candidates.is_empty() { weapon_candidates.iter().map(Some).collect() } else { vec![None] };
    let shields: Vec<Option<&Item>> = if !shield_candidates.is_empty() { shield_candidates.iter().map(Some).collect() } else { vec![None] };

    let dw_level = *skill_levels.get(si::FIGHTSTYLE_DUAL_WIELD).unwrap_or(&0.0);
    let dedupe_swaps = dw_level >= 2.0;
    let mut seen_swapped_pairs: HashSet<String> = HashSet::new();
    let mut pairs = Vec::new();

    for &weapon in &weapons {
        let two_handed = weapon.is_some() && is_twohand_weapon(weapon);
        for &shield in &shields {
            if two_handed && shield.is_some() && shield_candidates.len() > 1 && !std::ptr::eq(shield.unwrap(), &shield_candidates[0]) {
                continue;
            }
            if is_disallowed_pair(weapon, shield, limited_item_ids) {
                continue;
            }
            let effective_shield = if two_handed { None } else { shield };
            if dedupe_swaps {
                if let (Some(w), Some(s)) = (weapon, effective_shield) {
                    if is_weapon(Some(s)) {
                        let swap_key = if w.id < s.id { format!("{}|{}", w.id, s.id) } else { format!("{}|{}", s.id, w.id) };
                        if seen_swapped_pairs.contains(&swap_key) {
                            continue;
                        }
                        seen_swapped_pairs.insert(swap_key);
                    }
                }
            }
            if let Some(max_ap) = max_achievable_ap {
                let cost = compute_weapon_pair_attack_cost(weapon, effective_shield, skill_levels);
                let bonus_ap = weapon.map(|w| w.equip_effect.increase_max_ap).unwrap_or(0.0) + effective_shield.map(|s| s.equip_effect.increase_max_ap).unwrap_or(0.0);
                if cost > max_ap + bonus_ap {
                    continue;
                }
            }
            pairs.push(Equipped { weapon, shield: effective_shield, ..Default::default() });
        }
    }
    pairs
}

// optimizer.js:236-240 (sameCandidateSet).
fn same_candidate_set(a: &[Item], b: &[Item]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let ids_a: HashSet<&str> = a.iter().map(|i| i.id.as_str()).collect();
    b.iter().all(|item| ids_a.contains(item.id.as_str()))
}

// optimizer.js:252-276 (buildRingPairs).
fn build_ring_pairs<'a>(left_candidates: &'a [Item], right_candidates: &'a [Item], limited_item_ids: &HashSet<String>) -> Vec<Equipped<'a>> {
    if !left_candidates.is_empty() && same_candidate_set(left_candidates, right_candidates) {
        let mut pairs = Vec::new();
        for i in 0..left_candidates.len() {
            for j in i..left_candidates.len() {
                let left = &left_candidates[i];
                let right = &left_candidates[j];
                if is_disallowed_pair(Some(left), Some(right), limited_item_ids) {
                    continue;
                }
                pairs.push(Equipped { leftring: Some(left), rightring: Some(right), ..Default::default() });
            }
        }
        return pairs;
    }

    let lefts: Vec<Option<&Item>> = if !left_candidates.is_empty() { left_candidates.iter().map(Some).collect() } else { vec![None] };
    let rights: Vec<Option<&Item>> = if !right_candidates.is_empty() { right_candidates.iter().map(Some).collect() } else { vec![None] };
    let mut pairs = Vec::new();
    for &leftring in &lefts {
        for &rightring in &rights {
            if is_disallowed_pair(leftring, rightring, limited_item_ids) {
                continue;
            }
            pairs.push(Equipped { leftring, rightring, ..Default::default() });
        }
    }
    pairs
}

// A "dimension": one independent axis of choice (weapon+shield pair, one
// simple slot, or the ring pair), values already best-to-worst ranked —
// optimizer.js:280-296 (buildDimensions).
pub struct Dimension<'a> {
    pub values: Vec<Equipped<'a>>,
}

pub fn build_dimensions<'a>(candidate_lists: &'a CandidateLists, limited_item_ids: &HashSet<String>, build: Option<&Build>) -> Vec<Dimension<'a>> {
    let max_achievable_ap = build.map(|b| compute_max_achievable_ap(b, candidate_lists));
    let skill_levels: HashMap<String, f64> = build.map(|b| b.skill_levels.clone()).unwrap_or_default();

    let mut dims = vec![Dimension { values: build_weapon_shield_pairs(&candidate_lists.weapon, &candidate_lists.shield, limited_item_ids, &skill_levels, max_achievable_ap) }];
    for slot in SINGLE_SLOTS.iter() {
        let list = candidate_lists.get(slot);
        if list.is_empty() {
            continue;
        }
        let values: Vec<Equipped> = list.iter().map(|item| {
            let mut e = Equipped::default();
            match *slot {
                "head" => e.head = Some(item),
                "body" => e.body = Some(item),
                "hand" => e.hand = Some(item),
                "feet" => e.feet = Some(item),
                "neck" => e.neck = Some(item),
                _ => {}
            }
            e
        }).collect();
        dims.push(Dimension { values });
    }
    dims.push(Dimension { values: build_ring_pairs(&candidate_lists.leftring, &candidate_lists.rightring, limited_item_ids) });
    dims
}

pub fn count_combinations(candidate_lists: &CandidateLists, limited_item_ids: &HashSet<String>, build: Option<&Build>) -> u64 {
    build_dimensions(candidate_lists, limited_item_ids, build).iter().fold(1u64, |product, d| product * d.values.len() as u64)
}

fn merge_equipped<'a>(mut acc: Equipped<'a>, part: &Equipped<'a>) -> Equipped<'a> {
    if part.weapon.is_some() { acc.weapon = part.weapon; }
    if part.shield.is_some() { acc.shield = part.shield; }
    if part.head.is_some() { acc.head = part.head; }
    if part.body.is_some() { acc.body = part.body; }
    if part.hand.is_some() { acc.hand = part.hand; }
    if part.feet.is_some() { acc.feet = part.feet; }
    if part.neck.is_some() { acc.neck = part.neck; }
    if part.leftring.is_some() { acc.leftring = part.leftring; }
    if part.rightring.is_some() { acc.rightring = part.rightring; }
    acc
}

// optimizer.js:410-476 (bestFirstCombos), as a Rust Iterator instead of a JS
// generator (Rust generators are unstable) — same lazy best-first-order
// yielding, same MAX_FRONTIER_SIZE-bounded frontier and rank-sum-bucketed
// visited-set purging.
const MAX_FRONTIER_SIZE: usize = 200_000;

pub struct BestFirstCombos<'a> {
    dims: Vec<Dimension<'a>>,
    heap: BinaryHeap<Reverse<(i64, Vec<usize>)>>,
    visited_by_rank: HashMap<i64, HashSet<Vec<usize>>>,
    current_rank: i64,
    exhausted_empty_dim: bool,
}

impl<'a> BestFirstCombos<'a> {
    pub fn new(candidate_lists: &'a CandidateLists, limited_item_ids: &HashSet<String>, build: Option<&Build>) -> Self {
        let dims = build_dimensions(candidate_lists, limited_item_ids, build);
        let exhausted_empty_dim = dims.iter().any(|d| d.values.is_empty());
        let mut heap = BinaryHeap::new();
        let mut visited_by_rank: HashMap<i64, HashSet<Vec<usize>>> = HashMap::new();
        if !exhausted_empty_dim {
            let start = vec![0usize; dims.len()];
            heap.push(Reverse((0, start.clone())));
            visited_by_rank.entry(0).or_default().insert(start);
        }
        BestFirstCombos { dims, heap, visited_by_rank, current_rank: -1, exhausted_empty_dim }
    }

    fn is_visited(&self, k: &[usize], r: i64) -> bool {
        self.visited_by_rank.get(&r).map(|s| s.contains(k)).unwrap_or(false)
    }
    fn mark_visited(&mut self, k: Vec<usize>, r: i64) {
        self.visited_by_rank.entry(r).or_default().insert(k);
    }
    fn advance_rank(&mut self, r: i64) {
        if r <= self.current_rank {
            return;
        }
        self.current_rank = r;
        self.visited_by_rank.retain(|&old_rank, _| old_rank >= r - 1);
    }
}

impl<'a> Iterator for BestFirstCombos<'a> {
    type Item = Equipped<'a>;

    fn next(&mut self) -> Option<Equipped<'a>> {
        if self.exhausted_empty_dim {
            return None;
        }
        let Reverse((r, indices)) = self.heap.pop()?;
        self.advance_rank(r);

        let mut combo = Equipped::default();
        for (i, d) in self.dims.iter().enumerate() {
            combo = merge_equipped(combo, &d.values[indices[i]]);
        }

        for i in 0..self.dims.len() {
            if indices[i] + 1 >= self.dims[i].values.len() {
                continue;
            }
            let mut next = indices.clone();
            next[i] += 1;
            let next_rank = r + 1;
            if self.is_visited(&next, next_rank) {
                continue;
            }
            if self.heap.len() >= MAX_FRONTIER_SIZE {
                continue;
            }
            self.mark_visited(next.clone(), next_rank);
            self.heap.push(Reverse((next_rank, next)));
        }

        Some(combo)
    }
}

pub struct SearchResult {
    pub best_first: Vec<Top10Entry>,
    pub evaluated: u64,
    pub total: u64,
}

// A search shard: restricts the outermost (weapon/shield) dimension to a
// contiguous slice via shard_start_rank/shard_stride, mirroring how Phase
// A5's coordinator partitions candidateLists.weapon/shield before handing
// each worker its own ShardConfig — see wasmSearchCoordinator.js's
// partitionWeaponShieldDim. shard_stride = 1 (the default) reproduces the
// unsharded JS engine's behavior exactly, since the outermost dimension is
// then left untouched.
pub struct ShardConfig<'a> {
    pub build: &'a Build,
    pub targets: &'a [Target],
    pub items_by_id: &'a HashMap<String, Item>,
    pub conditions_by_id: &'a HashMap<String, Condition>,
    pub candidate_lists: &'a CandidateLists,
    pub max_hp_loss: Option<f64>,
    pub limited_item_ids: HashSet<String>,
}

impl<'a> From<&'a SearchConfig> for ShardConfig<'a> {
    fn from(config: &'a SearchConfig) -> Self {
        ShardConfig {
            build: &config.build,
            targets: &config.targets,
            items_by_id: &config.items_by_id,
            conditions_by_id: &config.conditions_by_id,
            candidate_lists: &config.candidate_lists,
            max_hp_loss: config.max_hp_loss,
            limited_item_ids: config.limited_item_ids.iter().cloned().collect(),
        }
    }
}

fn equipped_to_ids(equipped: &Equipped) -> HashMap<&'static str, Option<String>> {
    let mut m = HashMap::new();
    m.insert("weapon", equipped.weapon.map(|i| i.id.clone()));
    m.insert("shield", equipped.shield.map(|i| i.id.clone()));
    m.insert("head", equipped.head.map(|i| i.id.clone()));
    m.insert("body", equipped.body.map(|i| i.id.clone()));
    m.insert("hand", equipped.hand.map(|i| i.id.clone()));
    m.insert("feet", equipped.feet.map(|i| i.id.clone()));
    m.insert("neck", equipped.neck.map(|i| i.id.clone()));
    m.insert("leftring", equipped.leftring.map(|i| i.id.clone()));
    m.insert("rightring", equipped.rightring.map(|i| i.id.clone()));
    m
}

fn equipment_from_combo<'a>(combo: &Equipped<'a>, build: &Build) -> Build {
    let mut b = build.clone();
    b.equipment = crate::model::Equipment {
        weapon: combo.weapon.map(|i| i.id.clone()),
        shield: combo.shield.map(|i| i.id.clone()),
        head: combo.head.map(|i| i.id.clone()),
        body: combo.body.map(|i| i.id.clone()),
        hand: combo.hand.map(|i| i.id.clone()),
        feet: combo.feet.map(|i| i.id.clone()),
        neck: combo.neck.map(|i| i.id.clone()),
        leftring: combo.leftring.map(|i| i.id.clone()),
        rightring: combo.rightring.map(|i| i.id.clone()),
    };
    b
}

// optimizer.js:482-570 (searchBestBuilds), best-first/deterministic stream
// only — the random-search stream (Track B) is ported separately to WGSL,
// not duplicated here. shard_start_rank is unused by a single-shard run
// (shard_stride = 1); Phase A5's coordinator instead restricts
// candidate_lists.weapon/shield per shard before calling this, per
// ShardConfig's doc comment above.
pub fn search_best_builds(config: &ShardConfig) -> SearchResult {
    let total = count_combinations(config.candidate_lists, &config.limited_item_ids, Some(config.build));
    let mut best_first_top10: Vec<Top10Entry> = Vec::new();

    let precomputed_target_stats: Vec<PlayerStats> = config
        .targets
        .iter()
        .map(|t| resolve_monster_stats(&t.monster, &t.monster.active_conditions, config.conditions_by_id))
        .collect();
    let base_stats = build_base_stats(config.build.level, &config.build.level_up_choices, &config.build.fortitude_levels);

    let mut combo_index: u64 = 0;
    let mut evaluated: u64 = 0;

    for combo in BestFirstCombos::new(config.candidate_lists, &config.limited_item_ids, Some(config.build)) {
        combo_index += 1;
        evaluated += 1;

        let candidate_build = equipment_from_combo(&combo, config.build);
        let mut sum_hp_loss = 0.0;
        let mut has_infinite = false;
        let mut primary_summary: Option<CombatSummary> = None;

        for (ti, target) in config.targets.iter().enumerate() {
            let horde_ref: Option<&Horde> = target.horde.as_ref();
            let precomputed = Precomputed { target_stats: Some(&precomputed_target_stats[ti]), base_stats: Some(&base_stats) };
            let summary = compute_combat_summary(&candidate_build, &target.monster, config.items_by_id, config.conditions_by_id, horde_ref, Some(&precomputed));
            if ti == 0 {
                primary_summary = Some(summary.clone());
            }
            if !summary.hp_loss_per_kill.is_finite() {
                has_infinite = true;
            } else {
                sum_hp_loss += summary.hp_loss_per_kill;
            }
        }

        let primary_summary = primary_summary.unwrap();
        let avg_hp_loss_per_kill = if config.targets.len() == 1 {
            primary_summary.hp_loss_per_kill
        } else if has_infinite {
            f64::INFINITY
        } else {
            sum_hp_loss / (config.targets.len() as f64)
        };
        let mut summary = primary_summary;
        if config.targets.len() != 1 {
            summary.hp_loss_per_kill = avg_hp_loss_per_kill;
        }

        let within_cap = match config.max_hp_loss {
            None => true,
            Some(cap) => avg_hp_loss_per_kill <= cap,
        };
        if within_cap {
            let entry = Top10Entry { equipment: equipped_to_ids(&combo), summary, build_number: combo_index };
            best_first_top10 = insert_into_top10(best_first_top10, entry);
        }
    }

    SearchResult { best_first: best_first_top10, evaluated, total }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::combat_math::CombatSummary;

    fn entry_with(hp_loss: f64, dpt: f64) -> Top10Entry {
        Top10Entry {
            equipment: HashMap::new(),
            summary: CombatSummary { difficulty: 0.0, difficulty_label: "normal", damage_per_turn: dpt, hp_loss_per_turn: 0.0, hp_gain_per_turn: 0.0, hp_loss_per_kill: hp_loss, hp_gain_per_kill: 0.0 },
            build_number: 0,
        }
    }

    #[test]
    fn insert_into_top10_orders_by_hp_loss_then_damage() {
        let mut top10 = vec![];
        top10 = insert_into_top10(top10, entry_with(10.0, 5.0));
        top10 = insert_into_top10(top10, entry_with(5.0, 3.0));
        assert_eq!(top10[0].summary.hp_loss_per_kill, 5.0);
    }

    #[test]
    fn insert_into_top10_treats_infinity_as_equal_for_tiebreak() {
        let mut top10 = vec![];
        top10 = insert_into_top10(top10, entry_with(f64::INFINITY, 5.0));
        top10 = insert_into_top10(top10, entry_with(f64::INFINITY, 9.0));
        assert_eq!(top10[0].summary.damage_per_turn, 9.0);
    }

    fn item(id: &str, slot: &str, size: &str, dmg_min: f64, dmg_max: f64) -> Item {
        Item {
            id: id.to_string(),
            category: slot.to_string(),
            equip_effect: crate::model::EquipEffect::default(),
            damage_potential: Some(crate::model::Range { min: dmg_min, max: dmg_max }),
            category_link: Some(crate::model::CategoryLink { id: "lsword".to_string(), inventory_slot: slot.to_string(), size: size.to_string() }),
            hit_effect: None,
            hit_received_effect: None,
            kill_effect: None,
        }
    }

    #[test]
    fn build_ring_pairs_dedupes_same_pool_swaps() {
        let rings = vec![item("ring_a", "neck", "none", 0.0, 0.0), item("ring_b", "neck", "none", 0.0, 0.0)];
        let limited: HashSet<String> = HashSet::new();
        let pairs = build_ring_pairs(&rings, &rings, &limited);
        // Same pool on both sides: {A,A}, {A,B}, {B,B} — not {B,A} as a
        // separate entry, since applyEquipment treats leftring/rightring
        // identically (optimizer.js:242-251).
        assert_eq!(pairs.len(), 3);
    }

    #[test]
    fn best_first_combos_yields_non_decreasing_rank_sum() {
        let weapons = vec![item("w1", "weapon", "std", 1.0, 3.0), item("w2", "weapon", "std", 2.0, 4.0), item("w3", "weapon", "std", 3.0, 5.0)];
        let necks = vec![item("n1", "neck", "none", 0.0, 0.0), item("n2", "neck", "none", 0.0, 0.0), item("n3", "neck", "none", 0.0, 0.0)];
        let candidate_lists = CandidateLists { weapon: weapons, neck: necks, ..Default::default() };
        let limited: HashSet<String> = HashSet::new();
        let mut ranks = Vec::new();
        for combo in BestFirstCombos::new(&candidate_lists, &limited, None).take(4) {
            let mut r = 0;
            if let Some(w) = combo.weapon { r += ["w1", "w2", "w3"].iter().position(|&id| id == w.id).unwrap(); }
            if let Some(n) = combo.neck { r += ["n1", "n2", "n3"].iter().position(|&id| id == n.id).unwrap(); }
            ranks.push(r);
        }
        for w in ranks.windows(2) {
            assert!(w[1] >= w[0], "ranks not non-decreasing: {:?}", ranks);
        }
    }

    // Golden top10 captured from the real optimizer.js's searchBestBuilds
    // for a 2-weapon x 2-neck candidate pool (4 total combos, no sharding —
    // shard_stride = 1's implicit case, since ShardConfig here just wraps
    // the full, unrestricted candidate_lists). Confirms a single-shard Rust
    // search reproduces the JS engine's top10 exactly (equipment + ranking
    // order), not just matching combat-summary formulas in isolation.
    #[test]
    fn single_shard_search_matches_js_top10_for_fixture() {
        let w1 = item("w1", "weapon", "std", 2.0, 5.0);
        let mut w1 = w1;
        w1.equip_effect = crate::model::EquipEffect { increase_attack_chance: 10.0, increase_attack_cost: 4.0, ..Default::default() };
        let mut w2 = item("w2", "weapon", "std", 3.0, 8.0);
        w2.equip_effect = crate::model::EquipEffect { increase_attack_chance: 5.0, increase_attack_cost: 4.0, ..Default::default() };

        let mut n1 = item("n1", "neck", "none", 0.0, 0.0);
        n1.equip_effect = crate::model::EquipEffect { increase_max_hp: 5.0, ..Default::default() };
        n1.category_link = Some(crate::model::CategoryLink { id: "neck".to_string(), inventory_slot: "neck".to_string(), size: "none".to_string() });
        let mut n2 = item("n2", "neck", "none", 0.0, 0.0);
        n2.equip_effect = crate::model::EquipEffect { increase_max_hp: 10.0, ..Default::default() };
        n2.category_link = Some(crate::model::CategoryLink { id: "neck".to_string(), inventory_slot: "neck".to_string(), size: "none".to_string() });

        let mut items_by_id = HashMap::new();
        for it in [w1.clone(), w2.clone(), n1.clone(), n2.clone()] {
            items_by_id.insert(it.id.clone(), it);
        }
        let candidate_lists = CandidateLists { weapon: vec![w1, w2], neck: vec![n1, n2], ..Default::default() };

        let build = Build {
            level: 5,
            level_up_choices: crate::model::LevelUpChoices { health: 4.0, ..Default::default() },
            fortitude_levels: vec![],
            equipment: crate::model::Equipment::default(),
            skill_levels: HashMap::new(),
            active_conditions: vec![],
        };
        let monster = Monster {
            id: "rat1".to_string(),
            attack_cost: 4.0,
            attack_chance: 30.0,
            critical_skill: 0.0,
            critical_multiplier: 0.0,
            attack_damage: Some(crate::model::Range { min: 1.0, max: 3.0 }),
            block_chance: 5.0,
            damage_resistance: 0.0,
            max_hp: 15.0,
            max_ap: Some(10.0),
            is_immune_to_critical_hits: false,
            hit_effect: None,
            hit_received_effect: None,
            active_conditions: vec![],
        };
        let targets = vec![Target { monster, horde: None }];
        let conditions_by_id = HashMap::new();
        let limited_item_ids = HashSet::new();

        let config = ShardConfig { build: &build, targets: &targets, items_by_id: &items_by_id, conditions_by_id: &conditions_by_id, candidate_lists: &candidate_lists, max_hp_loss: None, limited_item_ids };
        let result = search_best_builds(&config);

        assert_eq!(result.total, 4);
        assert_eq!(result.best_first.len(), 4);

        let expected = [
            ("w1", "n1", 15.6, 1.22),
            ("w1", "n2", 15.6, 1.22),
            ("w2", "n1", 16.8, 1.14),
            ("w2", "n2", 16.8, 1.14),
        ];
        for (entry, (w, n, hp_loss, dpt)) in result.best_first.iter().zip(expected.iter()) {
            assert_eq!(entry.equipment["weapon"].as_deref(), Some(*w));
            assert_eq!(entry.equipment["neck"].as_deref(), Some(*n));
            assert!((entry.summary.hp_loss_per_kill - hp_loss).abs() < 1e-6);
            assert!((entry.summary.damage_per_turn - dpt).abs() < 1e-6);
        }
    }
}
