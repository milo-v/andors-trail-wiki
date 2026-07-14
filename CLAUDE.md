# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A React 17 (Create React App) single-page wiki/database browser for the Android game **Andor's Trail**. It reads the game's own resource files (Android `res/xml`, `res/values`, `res/drawable`, `res/raw` from the game's separate source repo) at runtime/build-time and renders searchable tables for items, monsters, NPCs, quests, conditions, and maps, plus rendered map images.

There is no backend: game data lives in `public/xml`, `public/values`, `public/drawable`, `public/raw` (symlinked from a sibling `andors-trail` game repo) and `public/backgrounds` (generated JPGs). The app fetches these as static assets and parses XML/JSON client-side in `src/App.js` / `src/components/Main.jsx`.

## Setup (one-time)

The game resources must exist as a sibling checkout at `../andors-trail/AndorsTrail/` (path is hardcoded via `AT_FOLDER` in `Makefile` / hardcoded in `.bat` files), then symlinked into `public/`:

- Unix: `make link`
- Windows: `link.bat`

## Common commands

- `npm install` — install deps
- `npm start` — dev server (`react-scripts start`)
- `npm run build` — production build (`react-scripts build`)
- `npm test` — run tests (`react-scripts test`, Jest + React Testing Library)
- `npm test -- --testPathPattern=App` — run a single test file
- `make gen` / `npm run gen` — render all map `.tmx` files under `public/xml` to JPG backgrounds in `public/backgrounds` (slow — can take ~25+ min for the full set)
- `make gen_grave` — render only the `graveyard1` map, for quick testing of map-rendering changes
- `node bin/generateMapImages.js <mapName> [<mapName2> ...]` — render specific maps by name
- `node bin/generateMapImages.js false` — render only maps missing a background JPG (skip existing)
- `node bin/getVersion.js` — reads the game's `AndroidManifest.xml` version and writes `REACT_APP_AT_VERSION` to `.env` (shown in the app footer)

`build.bat` additionally patches the CRA production build so every route resolves to `index.html` (this repo has no server-side routing).

## Architecture

### Data loading and cross-linking pipeline (the core of the app)

1. **`src/App.js`** fetches `/values/loadresources.xml` to get lists of resource file paths, then fetches `/xml/worldmap.xml` (global map, parsed by `src/utils/GlobalMapParser.jsx`) and each map's `.tmx` file (parsed by `src/utils/MapParser.jsx`, which decodes base64+zlib tile layers via `pako`).
2. **`src/components/Main.jsx`** (a big class component) takes over: it fetches the remaining JSON resources (items, monsters, item categories, actor conditions, droplists, conversations, quests) referenced in `loadresources.xml`, then runs `linkTemp()`.
3. `linkTemp()` is the central "join" step: it builds ID-keyed lookup maps (`this.temp.maps.items`, `.monsters`, `.quests`, `.conditions`, `.droplists`, `.conversations`, `.spawngroups`, ...) and cross-links entities by mutating them in place — e.g. an item gets `.categoryLink`, `.conv_links`, `.droplists`; a monster gets `.droplistLink`, `.spawnGroupLinks`, `.conversationLink`, `.rootLink`; conversations get walked recursively (`linkConversationInner`) to find quest rewards/requirements and back-link them onto items/monsters/quests; map object groups (spawn points, signs, scripts, containers) are cross-linked to monsters/conversations/droplists.
4. Once linking finishes, `Main` renders `react-router-dom` v5 `<Switch>/<Route>` pages, passing the linked data down via `PropsRoute` (a wrapper that merges extra props into route components).

**When touching data parsing or linking, expect ripple effects** — most "detail" pages/tables render a `Links` table showing backreferences that were populated during `linkTemp()`, so a broken link there silently empties a table elsewhere rather than erroring.

### Per-domain page structure

Each game concept (`items`, `monsters`, `npc`, `quests`, `conditions`, `maps`) lives under `src/components/<domain>/` and follows the same shape:
- `<Domain>Page.jsx` — top-level route component, owns the table
- `<Domain>Table.jsx` — the grid (built on `@nadavshaar/react-grid-table`, vendored under `src/@nadavshaar/react-grid-table/`)
- `NameCell.jsx` / `ExpandingName.jsx` — name column rendering, often with expand-to-detail behavior
- `LinksTable.jsx` — renders the cross-referenced backlinks produced by `Main.linkTemp()`

Shared cell renderers used across domains live in `src/components/cells/` (`IconCell`, `BooleanCell`, `RangeCell`, `JsonCell`, `ConditionsCell`, `OtherCell`).

Maps are special-cased under `src/components/maps/`: `GlobalMap.jsx` (world map with segments), `LocalMap.jsx` (per-map tile rendering using the pre-generated `public/backgrounds/*.jpg`), `MapIcon.jsx`, `MapPage.jsx`.

`src/components/CostCalculator.jsx` and `src/components/ExpCalculator.jsx` are pure functions replicating the game's own item-price and monster-experience formulas — keep them numerically in sync with the game logic, not with UI concerns.

### Offline map-image generation (`bin/`)

`bin/generateMapImages.js` is a Node (not browser) script using `node-canvas` to rasterize `.tmx` map layers into JPGs ahead of time, because doing this in-browser per page load would be too slow. It has its own XML parser (`bin/xmlParser.js`) and map parser (`bin/mapParser.js`) — these are close ports of `src/utils/MapParser.jsx` but are separate CommonJS files (no shared module) since they run under Node against the filesystem instead of `fetch`. **If you fix a map-parsing bug, check whether the equivalent fix is needed in both `src/utils/MapParser.jsx` and `bin/mapParser.js`.**

`bin/getVersion.js` similarly reads the game's Android manifest directly off disk to stamp the version.

### Debug logging

`src/utils/debug.jsx` gates `console.warn` calls behind a `DEBUG` flag (on in non-production `NODE_ENV`). Parsing code uses `debug(...)` / `doIfDebug(...)` liberally to flag data inconsistencies (duplicate IDs, unresolved links, unexpected XML shapes) without throwing — these warnings are the primary signal that game data doesn't match parsing assumptions.