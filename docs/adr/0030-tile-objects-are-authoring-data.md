# ADR-0030 · Tile objects are authoring data

**Status:** Accepted (2026-10-20, ratified by the owner) · **Date:** 2026-10-15 · **Deciders:** Astrum Forge Studios (owner)

## Context

A `.tilemap.json` carries an objects layer: named, typed rectangles with custom properties, which the Tiled and LDtk importers also produce (`11-2d-toolkit.md` §2.5). Until now `@ignifx/2d` turned them into entities at runtime. A game registered a factory per object type with `app.twoD.registerTileObjectFactory`, and on every `loadScene` the extension ran the factories for every `Tilemap` in the scene.

The editor-ready templates (engine PR #52, gap 21) showed that this makes the map a second source of entities:

- A scene that lists the player, the props and the pickups itself, so that an editor can show and move them, must not also register the factories, or every object spawns twice.
- An editor's scene view creates the app from the project's extensions and scripts only (`@ignifx/editor-host`), so it cannot run game code that registers factories before the load. That is the pre-load-hook problem of PR #46 gap 1 again.
- The templates baked their objects into their scenes and stopped registering factories, which left the maps' objects layers inert but still generated.

Constraints: scene files are the source of truth for what a level contains (the ignifx editor edits documents, not a live world), core and extensions stay small (`CONSTITUTION.md` §2.3), unused features cost nothing (§2.5), and breaking changes before 1.0 ship in a minor release with a **Breaking** note and no deprecation window (§4.2).

## Options considered

1. **Authoring data only.** The runtime never creates entities from objects. A command, `ignifx import tilemap`, moves a map's objects into a scene file once, as entities, and removes them from the map. The factory API goes. Code can still read `tilemap.definition.objects`.
2. **Keep factories and skip objects already in the scene.** The loader would skip an object when the scene holds an entity tagged with its id. The format has no object id, so one would have to be added and kept unique. Factories still run only in an app whose code registered them, so the editor still shows a different level from the game.
3. **Objects that name prefabs.** An object would carry a prefab address and be instanced on load. No code is needed, but the instances are still a second, runtime-only source of entities: the editor cannot select or move them as scene entities, and a scene saved after the load would write them in.

## Decision

Option 1. A tilemap's objects layer is authoring data.

- `@ignifx/2d` removes `registerTileObjectFactory`, `unregisterTileObjectFactory`, `spawnTilemapObjects`, `TileObjectFactory` and `TileObjectContext`, and stops spawning on scene load. `IGX-1110` (duplicate factory) is retired, not reused.
- The `.tilemap.json` format does not change. `objects` stays optional, the importers keep filling it, and `TilemapDefinition.objects` keeps exposing it to code.
- `ignifx import tilemap <map.tilemap.json> <scene.scene.json> [--parent <entity>]` (`@ignifx/cli`) appends one entity per object: named after the object (or its type when unnamed), tagged with its type, at the object's centre, in the map's order, after the parent's subtree or at the end of the file. It then deletes `objects` from the map, so a second run finds nothing. An entity has no components; the command prints each object's size and properties, because no scene field holds them. The command reads and writes JSON only, because `@ignifx/cli` may not depend on the engine (`.dependency-cruiser.cjs`).
- A game that builds its level in code reads `tilemap.definition.objects` after the map has loaded and creates what it needs.

## Consequences

- A scene file is the whole level: the editor's scene view and the game see the same entities, with no registration step before the load.
- **Breaking** for games that registered factories. The changeset says how to replace them: run `ignifx import tilemap` once, or loop over `tilemap.definition.objects` after the load.
- The templates' generator stops writing objects layers, so the templates' maps carry tiles only.
- An object's size and properties do not survive the import as data. The developer turns them into component fields (a trigger's `size`, a sprite's `frameName`) or replaces the entity with a prefab instance.
- The editor's tilemap painter edits tiles; placing objects is ordinary entity editing in the scene.
- Follow-up: converting a `.tmj` or `.ldtk` file into a `.tilemap.json` from the command line, as the editor plan's importer row expects, needs `importTiledMap` and `importLdtkLevel` in a module the CLI may depend on. That is a separate decision about the CLI's layering.
- Revisit if a game needs runtime-only objects that must not appear in the editor. A component that reads `definition.objects` would cover that without a registry in the extension.
