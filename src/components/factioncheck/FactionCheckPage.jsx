import React from 'react';
import { HashLink as Link } from 'react-router-hash-link';
import { parseSavegame } from '../../utils/SavegameParser';
import { computeFactionState } from '../../utils/FactionCalculator';
import { computeGatedContent } from '../../utils/FactionGatedContent';

const FACTION_LABELS = { shadow: 'Shadow', feygard: 'Feygard', thieves: 'Thieves Guild' };
const FACTION_ORDER = ['shadow', 'feygard', 'thieves'];

const INTERNAL_ALIGNMENT_PREFIXES = ['fsc_', 'scoreShadow', 'scoreFeygard', 'scoreThieves', 'factionCount', 'faction_count_'];
const INTERNAL_ALIGNMENT_KEYS = new Set(['reg1', 'reg2', 'reg3']);

function isInternalAlignmentKey(key) {
    if (INTERNAL_ALIGNMENT_KEYS.has(key)) return true;
    return INTERNAL_ALIGNMENT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export default class FactionCheckPage extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null, result: null };
        this.handleFileChange = this.handleFileChange.bind(this);
    }

    handleFileChange(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const { header, player, usedBonemealPotions } = parseSavegame(reader.result);
                const factionState = computeFactionState(player.questProgress, this.props.conversations, this.props.quests, usedBonemealPotions);
                const gatedContent = computeGatedContent(factionState, this.props.conversations, this.props.monsters);
                const rawAlignments = Array.from(player.alignments.entries())
                    .filter(([key]) => !isInternalAlignmentKey(key))
                    .sort((a, b) => a[0].localeCompare(b[0]));
                this.setState({ error: null, result: { header, factionState, gatedContent, rawAlignments } });
            } catch (e) {
                this.setState({ error: e.message, result: null });
            }
        };
        reader.onerror = () => this.setState({ error: 'Could not read this file.', result: null });
        reader.readAsArrayBuffer(file);
    }

    render() {
        const { error, result } = this.state;
        return (
            <div>
                <h2>Faction Check</h2>
                <p>Upload your Andor's Trail savegame file to see your faction standing. The file is read entirely in your browser and is never uploaded anywhere.</p>
                <input type="file" onChange={this.handleFileChange} />
                {error && <p style={{ color: 'red' }}>Could not read this savegame: {error}</p>}
                {result && (
                    <div>
                        <h3>{result.header.playerName}</h3>
                        {FACTION_ORDER.map((faction) => (
                            <FactionCard key={faction} faction={faction} data={result.factionState.factions[faction]} />
                        ))}

                        <h3>Other alignment values</h3>
                        <table border="1">
                            <thead><tr><th>Key</th><th>Value</th></tr></thead>
                            <tbody>
                                {result.rawAlignments.map(([key, value]) => (
                                    <tr key={key}><td>{key}</td><td>{value}</td></tr>
                                ))}
                            </tbody>
                        </table>

                        <h3>Faction-gated content</h3>
                        {FACTION_ORDER.map((faction) => (
                            <GatedContentList
                                key={faction}
                                faction={faction}
                                items={result.gatedContent.filter((g) => g.faction === faction)}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }
}

const FactionCard = ({ faction, data }) => (
    <div>
        <h4>{FACTION_LABELS[faction]}: {data.percent}% ({data.standingLabel})</h4>
        <ul>
            {data.decisions.map((d, i) => (
                <li key={i}>{d.description} ({d.delta > 0 ? '+' : ''}{d.delta})</li>
            ))}
        </ul>
    </div>
);

const GatedContentList = ({ faction, items }) => (
    <div>
        <h4>{FACTION_LABELS[faction]}</h4>
        <ul>
            {items.map((item, i) => (
                <li key={i}>
                    {item.unlocked ? '✓' : '✗'}{' '}
                    {item.npc ? <Link to={item.npc.rootLink + item.npc.id}>{item.npc.name}</Link> : 'Unknown NPC'}
                    {': "'}{item.message}{'"'}
                </li>
            ))}
        </ul>
    </div>
);
