import React, { Component } from 'react';
import LevelPanel from './LevelPanel';
import EquipmentPanel from './EquipmentPanel';
import SkillsPanel from './SkillsPanel';
import ConditionsPanel from './ConditionsPanel';
import OpponentPicker from './OpponentPicker';
import ResultsPanel from './ResultsPanel';
import PlayerStatsPanel from './PlayerStatsPanel';
import OptimizerPanel from './OptimizerPanel';
import { encodeBuildToQuery, decodeBuildFromQuery } from './buildCodec';
import {
    getLevelUpChoicesSum,
    reconcileLevelUpChoices, reconcileSkillLevels, reconcileFortitudeLevels,
} from './buildHelpers';
import { computeCombatSummary } from '../../utils/combat/combatMath';
import { resolvePlayerStats, resolveMonsterStats, resolveEquipped, getEquipmentConditionDetails } from '../../utils/combat/statEngine';
import { SKILL_IDS } from '../../utils/combat/skillData';

export default class CalculatorPage extends Component {
    constructor(props) {
        super(props);
        this.state = decodeBuildFromQuery(props.location.search, props.items, props.monsters, props.conditions);
    }

    getItemsById() {
        if (!this._itemsById) {
            this._itemsById = this.props.items.reduce((obj, item) => Object.assign(obj, { [item.id]: item }), {});
        }
        return this._itemsById;
    }

    getConditionsById() {
        if (!this._conditionsById) {
            this._conditionsById = this.props.conditions.reduce((obj, c) => Object.assign(obj, { [c.id]: c }), {});
        }
        return this._conditionsById;
    }

    updateBuild(patch) {
        this.setState({ build: { ...this.state.build, ...patch } }, () => this.syncUrl());
    }

    handleLevelChange(level) {
        const levelUpChoices = reconcileLevelUpChoices(level, this.state.build.levelUpChoices);
        let skillLevels = reconcileSkillLevels(level, this.state.build.skillLevels);
        const fortitudeLevels = reconcileFortitudeLevels(level, this.state.build.fortitudeLevels, skillLevels);
        if (fortitudeLevels.length !== (skillLevels[SKILL_IDS.FORTITUDE] || 0)) {
            skillLevels = { ...skillLevels, [SKILL_IDS.FORTITUDE]: fortitudeLevels.length };
        }
        this.updateBuild({ level, levelUpChoices, skillLevels, fortitudeLevels });
    }

    setOpponentId(opponentId) {
        this.setState({ opponentId }, () => this.syncUrl());
    }

    syncUrl() {
        const query = encodeBuildToQuery(this.state.build, this.state.opponentId);
        this.props.history.replace({ pathname: '/calculator', search: query });
    }

    getResolvedPlayerStats() {
        try {
            return resolvePlayerStats(this.state.build, {
                itemsById: this.getItemsById(),
                conditionsById: this.getConditionsById(),
            });
        } catch (e) {
            return null; // levelUpChoices not fully allocated yet - can't resolve stats
        }
    }

    render() {
        const { build, opponentId } = this.state;
        const monster = this.props.monsters.find(m => m.id === opponentId) || null;

        const levelUpChoicesSum = getLevelUpChoicesSum(build.levelUpChoices);
        const fullyAllocated = levelUpChoicesSum === Math.max(0, build.level - 1);

        const resolvedStats = this.getResolvedPlayerStats();
        const resolvedMonsterStats = monster ? resolveMonsterStats(monster, [], this.getConditionsById()) : null;

        let summary = null;
        if (monster && fullyAllocated && resolvedStats) {
            summary = computeCombatSummary(build, monster, {
                itemsById: this.getItemsById(),
                conditionsById: this.getConditionsById(),
            });
        }

        return (
            <div style={{ padding: 10 }}>
                <h2>Damage Calculator</h2>
                <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: '2 1 480px', minWidth: 320 }}>
                        <LevelPanel
                            level={build.level}
                            levelUpChoices={build.levelUpChoices}
                            onChangeLevel={level => this.handleLevelChange(level)}
                            onChangeLevelUpChoices={levelUpChoices => this.updateBuild({ levelUpChoices })}
                        />
                        <EquipmentPanel
                            equipment={build.equipment}
                            items={this.props.items}
                            onChange={equipment => this.updateBuild({ equipment })}
                        />
                        <SkillsPanel
                            level={build.level}
                            skillLevels={build.skillLevels}
                            fortitudeLevels={build.fortitudeLevels}
                            resolvedStats={resolvedStats}
                            onChange={skillLevels => this.updateBuild({ skillLevels })}
                            onChangeFortitude={patch => this.updateBuild(patch)}
                        />
                        <ConditionsPanel
                            activeConditions={build.activeConditions}
                            equipmentConditions={getEquipmentConditionDetails(resolveEquipped(build.equipment, this.getItemsById()))}
                            conditions={this.props.conditions}
                            onChange={activeConditions => this.updateBuild({ activeConditions })}
                        />
                        <OptimizerPanel
                            items={this.props.items}
                            monster={monster}
                            build={build}
                            conditionsById={this.getConditionsById()}
                            onApplyBuild={equipment => this.updateBuild({ equipment })}
                        />
                    </div>
                    <div style={{ flex: '1 1 280px', minWidth: 260 }}>
                        <PlayerStatsPanel resolvedStats={resolvedStats} fullyAllocated={fullyAllocated} />
                    </div>
                    <div style={{ flex: '1 1 300px', minWidth: 280 }}>
                        <OpponentPicker
                            opponentId={opponentId}
                            monsters={this.props.monsters}
                            resolvedStats={resolvedMonsterStats}
                            onChange={id => this.setOpponentId(id)}
                        />
                        <ResultsPanel summary={summary} opponentSelected={!!monster} pointsFullyAllocated={fullyAllocated}/>
                    </div>
                </div>
            </div>
        );
    }
}
