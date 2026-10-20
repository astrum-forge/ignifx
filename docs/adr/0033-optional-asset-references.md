# ADR-0033 · Optional asset references

**Status:** Proposed · **Date:** 2026-10-20 · **Deciders:** Astrum Forge Studios (owner)

## Context

A scene load fails when any `$asset` it names fails to load: the scene loader awaits every dependency with `Promise.all` (`packages/core/src/serialization/scene-loader.ts`, `loadDependencies`). Some assets are optional by design. `templates/3d-third-person` plays a footstep clip and an ambient pad that a browser may refuse to decode, and the game should then run without them. So `HeroAnimation.footstep` and the ambient `AudioSource` cannot be scene fields; `src/main.ts` loads the clips itself, catches the failure, and assigns them after the load (engine PR #46, gap 3; all three other templates have the same pattern, PR #52).

An unresolved `$entity` already degrades to `null` with `IGX-0602`; an asset cannot. Constraints: a failure must stay visible (`CONSTITUTION.md` §2.1), the file must round-trip (`06-serialization-and-scene-format.md` §1), and adding to the format is allowed before 1.0 (§4.2).

## Options considered

1. **The component declares the field optional.** `asset(AudioClip, { optional: true })`. The loader waits for every dependency with `Promise.allSettled`; when one failed, a field declared optional receives the **failed handle** (its `state` is `"failed"`, its `error` says why) and the load reports `IGX-0602`; any other field fails the load with the original error, as today. The file does not change. Keeping the handle rather than `null` keeps the address, so a save (or the editor's `readBack`) writes the reference back instead of losing it.
2. **The file marks the reference optional.** `{ "$asset": "sfx/step.wav", "optional": true }`. The loader needs no schema, and each scene chooses. But every scene repeats a choice that belongs to the component (only code that checks `handle.state` survives a failed load), and the editor needs a per-reference toggle.
3. **Every asset reference degrades, like `$entity`.** Simplest. But a missing mesh or material would load as an invisible level with a log line, which hides real errors (§2.1), and every engine component would have to cope with failed handles.

## Decision

Recommended: option 1. An asset field declared `optional` tolerates a failed load; every other asset field keeps failing the scene.

## Consequences

- The templates' footstep and ambient clips become scene fields, and `main.ts` loses its separate clip loading.
- A component with an optional field must check `handle.state === "loaded"` before reading `value`. The TSDoc of `asset()` says so.
- A non-optional failure now surfaces when the scene is built rather than when the scene asset loads. The error is the same `AssetLoadError`.
- Editor: `describeSchemas()` carries the flag (an `x-ignifx-optional` keyword), so the inspector can show a failed optional reference as a warning instead of an error.
- No existing file changes, and no file churn.
- If accepted: an `optional` option for `asset()` (`packages/core/src/schema/field-kinds.ts`), `allSettled` and the per-field decision in `scene-loader.ts` and `load.ts`, the same in `loadSceneDependencies`, tests for both outcomes, doc 06 §3 and §4 step 2, the skill's `references/formats/scene.md`, API report, and a changeset (minor: additive).
