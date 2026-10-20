# ADR-0037 · Uid collisions on load are reported and consistent

**Status:** Proposed · **Date:** 2026-10-20 · **Deciders:** Astrum Forge Studios (owner)

## Context

Loading a scene file into a world that already holds an entity with one of the file's uids is silent and lopsided (engine PR #46, gap 14):

- `World.createEntity` gives the **new** entity a fresh uid when its requested uid is taken (`packages/core/src/world/world.ts`, `createEntity`), and reports nothing.
- Its components keep the file's uids with no check (`packages/core/src/serialization/load.ts`, `componentInternals(component).uid = record.uid`).

Example: `world.loadScene("scenes/main.scene.json")` twice without an unload builds a second copy whose entities have new uids but whose components share uids with the first copy. References inside the file still resolve, through the file-local remap. Anything that finds entities by the file's uids does not: the editor host maps document records to live entities with `world.getEntity(record.uid)` (`packages/editor-host/src/scene/document.ts`), so a silent remap there means edits land on the wrong entity or on none.

Constraints: correctness and visible failures (`CONSTITUTION.md` §2.1), one clear way to make a second copy (§2.2: `world.instantiate`, which remaps every uid on purpose), and behaviour changes allowed in a minor release before 1.0 (§4.2).

## Options considered

1. **Remap consistently and report.** An entity whose uid is taken gets a fresh uid, and so do all its components; the load reports a new `IGX-06xx` warning once, with the count and the first uid. A loader option `strictUids` turns it into a throw, as `strictInstanceHashes` does for `IGX-0604`. The editor host sets it.
2. **Always throw.** A collision fails the load with a coded error naming the uid; a second copy must use `world.instantiate`. Simplest rule, but a game that loads a level additively twice, which works today, breaks.
3. **Scope uids per scene instance.** Identity becomes (scene instance, uid), so two copies can coexist without a remap. `world.getEntity(uid)` would need a scene argument, and `$entity` references across scenes would need one too. A larger change to the scene graph than the problem needs.

## Decision

Recommended: option 1. A colliding entity and its components are remapped together and the load says so; `strictUids` makes it an error.

## Consequences

- Nothing silent remains: a second copy works and logs once, and tools that need stable uids opt into the error.
- Component uids are unique in a world whenever entity uids are, which `$component` lookups by tools can rely on.
- Files do not change, and saving the second copy writes its new uids.
- Editor: the host loads with `strictUids: true` and reports the collision instead of mapping the document to the wrong entities.
- If accepted: the collision check and component remap in `load.ts`, the option on `LoadSceneOptions` and `InstantiateSceneOptions`, a new code in `packages/core/src/errors/error-codes.ts`, the host's load call, tests, doc 06 §4 step 4 and `02-scene-graph.md` §10, the API report, and a minor changeset.
