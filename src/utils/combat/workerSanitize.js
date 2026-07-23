// Stripping known-unsafe keys off items/monsters/conditions before posting
// them to optimizerWorker.js is a losing game: Main.jsx's linkTemp()
// cross-links these objects for wiki navigation in ways that aren't fully
// enumerable up front (a prior blocklist here still let a raw XML
// map-parser node - an Element-like object with .name/.children and a
// getElementsByTagName-style method - reach postMessage's structured clone
// for at least one real monster, hanging the optimizer with no error).
// Building a clean object containing only the fields combat math
// (statEngine.js/combatMath.js/optimizer.js/valueScoring.js) actually reads
// is immune to any such link, known or not yet discovered.

function sanitizeAbilityEffect(effect) {
    if (!effect) return effect;
    return {
        increaseAttackCost: effect.increaseAttackCost,
        increaseAttackChance: effect.increaseAttackChance,
        increaseBlockChance: effect.increaseBlockChance,
        increaseCriticalSkill: effect.increaseCriticalSkill,
        setCriticalMultiplier: effect.setCriticalMultiplier,
        increaseMaxHP: effect.increaseMaxHP,
        increaseMaxAP: effect.increaseMaxAP,
        increaseMoveCost: effect.increaseMoveCost,
        increaseUseItemCost: effect.increaseUseItemCost,
        increaseReequipCost: effect.increaseReequipCost,
        increaseDamageResistance: effect.increaseDamageResistance,
        setNonWeaponDamageModifier: effect.setNonWeaponDamageModifier,
        increaseAttackDamage: effect.increaseAttackDamage
            ? { min: effect.increaseAttackDamage.min, max: effect.increaseAttackDamage.max }
            : undefined,
        addedConditions: (effect.addedConditions || []).map(({ condition, magnitude }) => ({ condition, magnitude })),
    };
}

function sanitizeProcConditionList(entries) {
    return (entries || []).map(({ condition, magnitude, duration, chance }) => ({ condition, magnitude, duration, chance }));
}

// hitEffect/killEffect/hitReceivedEffect shape (procEffects.js/combatMath.js
// read all of these): conditionsSource/conditionsTarget proc lists, direct
// increaseCurrentHP/AP boosts, and hitReceivedEffect's increaseAttacker*
// reflect fields (harmless no-ops on hitEffect/killEffect, which never set them).
function sanitizeProcEffect(effect) {
    if (!effect) return effect;
    return {
        conditionsSource: sanitizeProcConditionList(effect.conditionsSource),
        conditionsTarget: sanitizeProcConditionList(effect.conditionsTarget),
        increaseCurrentHP: effect.increaseCurrentHP
            ? { min: effect.increaseCurrentHP.min, max: effect.increaseCurrentHP.max }
            : undefined,
        increaseCurrentAP: effect.increaseCurrentAP
            ? { min: effect.increaseCurrentAP.min, max: effect.increaseCurrentAP.max }
            : undefined,
        increaseAttackerCurrentHP: effect.increaseAttackerCurrentHP
            ? { min: effect.increaseAttackerCurrentHP.min, max: effect.increaseAttackerCurrentHP.max }
            : undefined,
        increaseAttackerCurrentAP: effect.increaseAttackerCurrentAP
            ? { min: effect.increaseAttackerCurrentAP.min, max: effect.increaseAttackerCurrentAP.max }
            : undefined,
    };
}

export function sanitizeItemForWorker(item) {
    return {
        id: item.id,
        category: item.category,
        categoryLink: item.categoryLink
            ? { id: item.categoryLink.id, inventorySlot: item.categoryLink.inventorySlot, size: item.categoryLink.size }
            : null,
        equipEffect: sanitizeAbilityEffect(item.equipEffect),
        hitEffect: sanitizeProcEffect(item.hitEffect),
        killEffect: sanitizeProcEffect(item.killEffect),
        hitReceivedEffect: sanitizeProcEffect(item.hitReceivedEffect),
    };
}

export function sanitizeMonsterForWorker(monster) {
    return {
        id: monster.id,
        attackCost: monster.attackCost,
        attackChance: monster.attackChance,
        criticalSkill: monster.criticalSkill,
        criticalMultiplier: monster.criticalMultiplier,
        attackDamage: monster.attackDamage
            ? { min: monster.attackDamage.min, max: monster.attackDamage.max }
            : undefined,
        blockChance: monster.blockChance,
        damageResistance: monster.damageResistance,
        maxHP: monster.maxHP,
        maxAP: monster.maxAP,
        isImmuneToCriticalHits: monster.isImmuneToCriticalHits,
        activeConditions: (monster.activeConditions || []).map(({ conditionId, magnitude }) => ({ conditionId, magnitude })),
        hitEffect: sanitizeProcEffect(monster.hitEffect),
        hitReceivedEffect: sanitizeProcEffect(monster.hitReceivedEffect),
    };
}

export function sanitizeConditionForWorker(condition) {
    return {
        id: condition.id,
        isStacking: condition.isStacking,
        abilityEffect: sanitizeAbilityEffect(condition.abilityEffect),
        roundEffect: condition.roundEffect
            ? { increaseCurrentHP: condition.roundEffect.increaseCurrentHP }
            : undefined,
    };
}
