# ADR-0034 · Project documents are ready before a scene is built

**Status:** Proposed · **Date:** 2026-10-20 · **Deciders:** Astrum Forge Studios (owner)

## Context

A scene cannot say that it needs the input actions and the audio buses. Controllers resolve their action names in `awake`, which runs inside `World.loadScene`, so the action maps must be installed before the load. The `input.actions` and `audio.buses` settings exist, but the extensions start those loads in `onStart` and install them a frame later (`packages/input/src/extension.ts`, `startInput`). Every template therefore loads `game.input.json` and `game.audio.json` in `src/main.ts`, installs them by hand, and only then calls `loadScene` (`templates/3d-third-person/src/main.ts`; engine PR #46, gap 6, recurring in all three templates of PR #52). A headless test, a tool, or an editor play view must copy that code or get controllers with no actions.

These documents are project-wide: every scene of a game uses the same actions and buses. Settings are data since ask E6 (`ignifx.settings.json`, engine PR #63), and the editor's Settings panel already edits both keys.

## Options considered

1. **Settings-named documents gate scene builds.** An extension may register a wait with core (`ExtensionContext.addLoadGate(() => Promise<void>)`). The input and audio extensions start loading their settings-named document when the app is created, and `World.loadScene` awaits every gate before it builds entities (after `06` §4 step 2). A failed document fails the load with its own error. No format change; scenes stay free of project data.
2. **A scene lists its prerequisites.** `"settings": { "requires": [{ "$asset": "game.input.json" }] }`, and the owning extension installs each one before entities are built. Each scene repeats project data, two scenes can disagree, every scene file changes, and extensions still need the same "before build" hook as option 1.
3. **Consumers resolve lazily.** Controllers resolve action names on first use, and audio sources resolve their bus when they play. No contract or format change, but every first-party and third-party script that resolves in `awake` must change, and input sent before the maps arrive is silently dropped.

## Decision

Recommended: option 1. A document named in project settings is installed before any scene is built; scenes do not declare it.

## Consequences

- `main.ts` in each template drops its action and bus loading, and the settings files name `input.actions` and `audio.buses`. The comments in three templates' `ignifx.config.ts` explaining why they are not set go.
- A headless test or the editor's play view gets working controllers from `createApp` and `loadScene` alone.
- `loadScene` may wait for two small fetches the first time. Later loads find the gates settled.
- The extension contract grows by one method (public API, §8.1, §8.2), so third-party extensions can gate loads the same way.
- Edit mode does not call `awake` (ADR-0028), so the editor's scene view needs none of this; the play view does.
- If accepted: the gate in `packages/core` (`ExtensionContext`, `World.loadScene`, `world.loadSceneFile`), starting the loads at creation in `@ignifx/input` and `@ignifx/audio`, tests, doc 06 §4, the input and audio skills, the four templates, API reports, and a changeset (minor).
