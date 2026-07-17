import React, { Component } from 'react';
import LevelPanel from './LevelPanel';
import EquipmentPanel from './EquipmentPanel';
import SkillsPanel from './SkillsPanel';
import ConditionsPanel from './ConditionsPanel';
import OpponentPicker from './OpponentPicker';
import ResultsPanel from './ResultsPanel';
import { encodeBuildToQuery, decodeBuildFromQuery } from './buildCodec';
import {
    createEmptyBuild, getLevelUpChoicesSum, getSkillPointsSpent,
    reconcileLevelUpChoices, reconcileSkillLevels,
} from './buildHelpers';
import { computeCombatSummary } from '../../utils/combat/combatMath';
import { getSkillPointBudget } from '../../utils/combat/levelModel';

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
        const skillLevels = reconcileSkillLevels(level, this.state.build.skillLevels);
        this.updateBuild({ level, levelUpChoices, skillLevels });
    }

    setOpponentId(opponentId) {
        this.setState({ opponentId }, () => this.syncUrl());
    }

    syncUrl() {
        const query = encodeBuildToQuery(this.state.build, this.state.opponentId);
        this.props.history.replace({ pathname: '/calculator', search: query });
    }

    render() {
        const { build, opponentId } = this.state;
        const monster = this.props.monsters.find(m => m.id === opponentId) || null;

        const levelUpChoicesSum = getLevelUpChoicesSum(build.levelUpChoices);
        const skillPointsSpent = getSkillPointsSpent(build.skillLevels);
        const fullyAllocated = levelUpChoicesSum === Math.max(0, build.level - 1)
            && skillPointsSpent === getSkillPointBudget(build.level);

        let summary = null;
        if (monster && fullyAllocated) {
            summary = computeCombatSummary(build, monster, {
                itemsById: this.getItemsById(),
                conditionsById: this.getConditionsById(),
            });
        }

        return (
            <div style={{ padding: 10 }}>
                <h2>Damage Calculator</h2>
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
                    onChange={skillLevels => this.updateBuild({ skillLevels })}
                />
                <ConditionsPanel
                    activeConditions={build.activeConditions}
                    conditions={this.props.conditions}
                    onChange={activeConditions => this.updateBuild({ activeConditions })}
                />
                <OpponentPicker
                    opponentId={opponentId}
                    monsters={this.props.monsters}
                    onChange={id => this.setOpponentId(id)}
                />
                <ResultsPanel summary={summary} opponentSelected={!!monster} pointsFullyAllocated={fullyAllocated}/>
            </div>
        );
    }
}
