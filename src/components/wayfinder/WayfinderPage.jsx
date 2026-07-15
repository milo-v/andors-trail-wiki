import React, { useState } from 'react';
import { ratdomEdges, buildGraph, shortestPath, DIRECTION_LABELS } from '../../utils/wayfinderGraph';

const POINTS_OF_INTEREST = [
    { label: 'Entrance', map: 'ratdom_maze1' },
    { label: 'Bloskelt', map: 'ratdom_maze_416' },
    { label: 'Roskelt', map: 'ratdom_maze_415' },
    { label: 'Librarian', map: 'ratdom_maze_611' },
    { label: '4 wells puzzle', map: 'ratdom_maze_768' },
    { label: 'A lot of trolls and giant orc', map: 'ratdom_maze_517a' },
    { label: 'Warden of Ratdom', map: 'ratdom_maze_624', startMap: 'ratdom_maze_515' },
    { label: 'Loirash', map: 'ratdom_maze_464' },
    { label: 'Waterway challenge', map: 'ratdom_maze_664' },
    { label: 'Whootibarfag', map: 'blackwater_mountain55' },
    { label: 'Feygard patrol', map: 'ratdom_maze_412_up' },
    { label: 'Pub', map: 'ratdom_maze_705' },
    { label: 'Skeleton Dance', map: 'ratdom_maze_543d' },
];

export default function WayfinderPage() {
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [door533, setDoor533] = useState(false);
    const [door545, setDoor545] = useState(false);
    const [path, setPath] = useState(null);

    const findPath = () => {
        const extraEdges = [];
        if (door533) extraEdges.push(['ratdom_maze_533_up', 'ratdom_maze_533_down']);
        if (door545) extraEdges.push(['ratdom_maze_545_up', 'ratdom_maze_545_down']);

        const graph = buildGraph(ratdomEdges, extraEdges);
        setPath(shortestPath(graph, start, end));
    };

    return (
        <div style={{ textAlign: 'left', margin: 10 }}>
            <h1>Ratdom Wayfinder</h1>
            <p>
                Use this alongside the map pages to navigate Ratdom. Copy the name of your
                current map to "Start" and your destination to "End", check any doors you've
                already unlocked, then find your path.
            </p>
            <p>Points of interest:</p>
            <ul>
                {POINTS_OF_INTEREST.map(({ label, map, startMap }) => (
                    <li key={map}>
                        {label}: {map}{' '}
                        <button onClick={() => setStart(startMap || map)}>Set {label} as Start</button>{' '}
                        <button onClick={() => setEnd(map)}>Set {label} as End</button>
                    </li>
                ))}
            </ul>
            <table>
                <tbody>
                    <tr>
                        <td>
                            <label htmlFor="wayfinder-start">Start: </label>
                            <input id="wayfinder-start" type="text" value={start} onChange={(e) => setStart(e.target.value)} />
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <label htmlFor="wayfinder-end">End: </label>
                            <input id="wayfinder-end" type="text" value={end} onChange={(e) => setEnd(e.target.value)} />
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <label htmlFor="wayfinder-door533">Door 533 opened: </label>
                            <input id="wayfinder-door533" type="checkbox" checked={door533} onChange={(e) => setDoor533(e.target.checked)} />
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <label htmlFor="wayfinder-door545">Door 545 opened: </label>
                            <input id="wayfinder-door545" type="checkbox" checked={door545} onChange={(e) => setDoor545(e.target.checked)} />
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <button onClick={findPath}>Find path</button>
                        </td>
                    </tr>
                </tbody>
            </table>
            <div>
                <h3>Path:</h3>
                {path && path.length === 0 && <p>No path found.</p>}
                {path && path.map((step, i) => (
                    <p key={i}>
                        {step.from} -&gt; {step.to}, {DIRECTION_LABELS[step.direction] || 'unknown'}
                    </p>
                ))}
            </div>
        </div>
    );
}
