// Models the expected-value contribution of chance-based on-hit/on-kill/
// on-miss proc effects into the closed-form combat math the rest of this
// package already uses (no RNG/simulation — every value here is an expected
// value). Covers item hitEffect/killEffect/hitReceivedEffect condition procs
// and direct HP/AP boosts, plus the general combat skills that work the same
// way (Crit1/Crit2/Concussion/Taunt - see skillData.js).
//
// Two closed forms for "how often is this in effect", both exact (derived,
// not approximated):
//
// - Non-stacking conditions (ActorStatsController.addNonStackableActorCondition):
//   a new proc replaces/refreshes the existing instance rather than adding to
//   it, so what matters is the fraction of rounds the condition is *active at
//   all*. Modeled as a discrete-time alternating renewal process — idle until
//   a proc, then active for `duration` rounds, with any reproc while active
//   refreshing back to full duration:
//     q = 1 - (1 - perAttemptChance)^attacksPerTurn   (>=1 proc this round)
//     r = (1 - q)^duration
//     occupancy = (1 - r) / (1 - q*r)
//
// - Stacking conditions (ActorStatsController.addStackableActorCondition):
//   each round's proc(s) create an independent, parallel-timer instance
//   (they only merge into an existing one if landed in the exact same round)
//   that decays after `duration` rounds regardless of other instances. This
//   is exactly Little's Law (L = lambda * W) with a deterministic service
//   time — exact for any arrival distribution, not an approximation:
//     expectedStacks = attacksPerTurn * perAttemptChance * duration

import { applyAbilityEffects } from './statEngine';

export function averageRange(range) {
    if (!range) return 0;
    return ((range.min || 0) + (range.max || 0)) / 2;
}

export function getProcOccupancy(perAttemptChance, attacksPerTurn, duration) {
    if (duration <= 0 || attacksPerTurn <= 0 || perAttemptChance <= 0) return 0;
    const q = 1 - Math.pow(1 - perAttemptChance, attacksPerTurn);
    if (q <= 0) return 0;
    const r = Math.pow(1 - q, duration);
    return (1 - r) / (1 - q * r);
}

export function getExpectedStackCount(perAttemptChance, attacksPerTurn, duration) {
    if (duration <= 0 || attacksPerTurn <= 0 || perAttemptChance <= 0) return 0;
    return attacksPerTurn * perAttemptChance * duration;
}

// Finite-horizon variant of getExpectedStackCount, for horde mode: a kill
// replaces the monster with a fresh, zero-stack copy, so stacks can't ramp
// up indefinitely the way they can in a real 1v1 fight - see
// docs/superpowers/specs/2026-07-27-horde-condition-ramp-design.md. A stack
// created at round s is still alive at round t iff t - s < duration, so the
// instantaneous expected count at round t (from a zero-stack start) is
// p * min(t, duration) where p = attacksPerTurn * perAttemptChance.
// Averaging that over cycleLength (T) rounds gives an exact closed form
// (not an approximation) that converges to getExpectedStackCount's
// steady-state p * duration as T grows large.
export function getExpectedStackCountFiniteHorizon(perAttemptChance, attacksPerTurn, duration, cycleLength) {
    if (duration <= 0 || attacksPerTurn <= 0 || perAttemptChance <= 0 || cycleLength <= 0) return 0;
    const p = attacksPerTurn * perAttemptChance;
    const T = cycleLength;
    const sum = T <= duration
        ? (T * (T + 1)) / 2
        : (duration * (duration + 1)) / 2 + (T - duration) * duration;
    return (p * sum) / T;
}

// A proc entry's own `magnitude` can be the game's MAGNITUDE_REMOVE_ALL
// sentinel (-99, "grants immunity to this condition" - see the equivalent
// guard in statEngine.js's applyActiveConditions) rather than a literal
// intensity to scale by occupancy/stacks. Magnitudes <= 0 mean the condition
// isn't actually manifesting as a stat effect, so contribute nothing here
// (not an inverted-sign contribution).
// cycleLength (optional): in horde mode, the number of rounds until the
// current monster dies and is replaced by a fresh, zero-stack copy - see
// docs/superpowers/specs/2026-07-27-horde-condition-ramp-design.md. Only
// stacking conditions get a finite-horizon correction (non-stacking
// conditions are explicitly descoped in that spec - always steady state).
export function getExpectedConditionMagnitude(condition, itemMagnitude, perAttemptChance, attacksPerTurn, duration, cycleLength) {
    if (!condition || !itemMagnitude || itemMagnitude <= 0) return 0;
    if (condition.isStacking) {
        const stacks = cycleLength != null
            ? getExpectedStackCountFiniteHorizon(perAttemptChance, attacksPerTurn, duration, cycleLength)
            : getExpectedStackCount(perAttemptChance, attacksPerTurn, duration);
        return stacks * itemMagnitude;
    }
    return getProcOccupancy(perAttemptChance, attacksPerTurn, duration) * itemMagnitude;
}

// Applies every entry in a conditionsSource/conditionsTarget-style proc list
// (each { condition, magnitude, duration, chance }) onto `stats`, scaled by
// its expected value given the triggering actor's hit chance and
// attacks/turn. `chance` in the parsed JSON is a percent string (e.g. "20").
export function applyExpectedProcConditions(stats, entries, hitChancePercent, attacksPerTurn, conditionsById, cycleLength) {
    for (const entry of entries || []) {
        const condition = conditionsById[entry.condition];
        if (!condition?.abilityEffect) continue;
        const perAttemptChance = (hitChancePercent / 100) * (Number(entry.chance) / 100);
        const magnitude = getExpectedConditionMagnitude(condition, entry.magnitude, perAttemptChance, attacksPerTurn, entry.duration, cycleLength);
        if (magnitude <= 0) continue;
        applyAbilityEffects(stats, condition.abilityEffect, magnitude);
    }
}

// Expected value of a direct stat boost (HP or AP) that fires on every
// successful hit/kill - e.g. hitEffect.increaseCurrentHP, killEffect's same
// field, or hitReceivedEffect's increaseAttackerCurrentHP (a reflect/thorns
// effect applied to the attacker, unconditional like the others - it has no
// chance/duration of its own in the game's data). Per-turn variants scale by
// hit chance and attacks/turn; per-kill/per-use variants are already a single
// flat expected amount.
export function getExpectedBoostPerTurn(range, hitChancePercent, attacksPerTurn) {
    return averageRange(range) * (hitChancePercent / 100) * attacksPerTurn;
}
