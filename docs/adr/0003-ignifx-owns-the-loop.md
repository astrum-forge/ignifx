# ADR-0003 · ignifx owns the frame loop: fixed timestep, simulation scene, engine-driven animation

**Status:** Accepted · **Date:** 2026-09-05

## Context

In Babylon Lite, `createHavokWorld` inserts a step callback at the front of `scene._beforeRender`, runs exactly one Havok step per rendered frame (no accumulator), and cannot be unregistered through public API; glTF animation groups added to a scene are advanced by a hook that runs after user callbacks; `onBeforeRender` callbacks run in reverse registration order; `stepScene(engine, scene, deltaMs)` runs a scene's update on a null engine. `CONSTITUTION.md` §2.1 and §3.2 require deterministic fixed-step simulation and a single loop definition.

## Options considered

1. **Let Lite step physics once per frame** — simplest; matches Babylon.js defaults. Cons: not fixed-step under variable frame rates; no interpolation; `lateUpdate` before animation.
2. **Drive Lite's render scene `_update` multiple times per frame** — uses private API; re-runs animation hooks per step.
3. **Host physics on a separate headless simulation scene stepped by ignifx; detach animation groups from Lite and advance them with `updateAnimationManager`** — public API only; full control of ordering and step count.

## Decision

Option 3. One ignifx callback per world runs the whole frame (`docs/architecture/01-lifecycle-and-time.md` §3). Physics lives on a null-engine `SceneContext` and is stepped with `stepScene` inside ignifx's accumulator loop; interpolation is implemented by ignifx. Animation groups are removed from asset containers before `addToScene` and advanced in `PostUpdate` by ignifx-owned `AnimationManager`s. Sprite animation likewise runs on ignifx's clock.

## Consequences

- Determinism and Unity-order semantics (`update → animation → lateUpdate`) are guaranteed regardless of Lite's internal ordering.
- Two Lite scenes per world (render + simulation); bodies bind to the same `SceneNode`s.
- Upstream requests: a public physics step and an `onBeforeRender` disposer; the pinned Babylon Lite version (`pnpm-workspace.yaml` catalog) has neither. If Lite adds them, the adapter simplifies with no public change. The third request, collision events with body identities, was delivered upstream and is adopted (ADR-0013).
- Risk: a future Lite version could couple physics to the render scene; the adapter compatibility suite will catch it at upgrade time.

## Validation

The Lite and Havok behaviour the loop is built around; the adapter is `packages/core/src/lite/{node,loop,scene}.ts` and `packages/physics/src/lite/**`. Each entry was re-read on 2026-11-15 against the pinned Babylon Lite version, in its `index.d.ts` or `lib/` sources, unless it is marked as carried over. No test was re-run for this list.

Frame callbacks and stepping

- `onBeforeRender` puts a callback at the front of the scene's list and the list is walked front to back, so a callback registered later runs earlier. `createHavokWorld` registers its step the same way: an ignifx callback registered after it runs before the physics step.
- There is no public way to unregister a before-render callback (Havok's own remover is a private field), so `registerFrameCallback` returns a handle that guards a flag.
- `stepScene(engine, scene, deltaMs)` sets the engine's delta and runs the scene's update once. A callback receives `scene.fixedDeltaMs` when that is set and the step's delta otherwise, so ignifx never sets `scene.fixedDeltaMs`.
- Havok performs exactly one world step per scene step, at the world's fixed timestep when set and the step's delta otherwise, capped at 100 ms, with no accumulator. The accumulator is ignifx's.
- Adding a container that has animation groups installs a Lite hook that advances them, which is why the loader removes the groups before `addToScene`.

Transforms

- A transform node needs no scene: `worldMatrix` is valid as soon as the node exists. (carried over; not re-checked against the pinned version)
- Lite documents `Mat4` as opaque storage, so the adapter copies a world matrix element by element.
- A per-component write (`position.x = v`) is silent when the value is unchanged; the bulk `set` and `copyFrom` always notify.
- `setParent` preserves the world transform. Lite has no reparent that keeps local values, so the adapter's `linkParent` assigns `parent` and maintains the `children` arrays itself. (carried over; not re-checked against the pinned version)
- `setSubtreeVisible` materialises the cascade at write time: a node linked under a hidden parent afterwards does not inherit the state, so ignifx writes visibility unconditionally.

Physics on the simulation scene

- `createHavokWorld` works on a null-engine scene with `defaultRenderTask: false`, in Node as well as in the browser, so physics tests need no GPU. (carried over; pinned by `simulation-scene.test.ts`, not re-run)
- Under Node, `@babylonjs/havok` cannot fetch its `.wasm` from a `file:` URL; the module is instantiated from bytes passed as Emscripten's `wasmBinary` (`packages/physics/src/lite/havok-module.ts`). (carried over; not re-checked against the installed Havok build)
- After a step Lite writes a dynamic body's pose into its node's local position and rotation, so a body's entity must be a root entity (`IGX-0907`).
- Before a step Lite copies node to body only for animated bodies and bodies with a pre-step set. A dynamic body never reads its node, so an interpolated display pose cannot reach the solver; a kinematic body needs its authoritative pose restored first, which the `FixedUpdate -100` system does.
- Havok's first step under-integrates gravity (about 0.61 of one increment); every later step adds exactly `g·h²`. (carried over; pinned by `free-fall.test.ts`, not re-run)

Determinism

- The same 600 steps produce the same hash in two runs, in interleaved runs, and on a real WebGPU engine in Chromium. The committed baselines are `EXPECTED_HASH` and `EXPECTED_APP_HASH` (`packages/core/test/lite/fixtures/determinism-expected.ts`, `packages/core/test/determinism/fixtures/expected.ts`) and `EXPECTED_PHYSICS_HASH` (`packages/physics/test/determinism/fixtures/expected.ts`). (carried over; not re-run)
- The determinism fixtures avoid `Math.sin`, `Math.cos`, `Math.sqrt` and division, because ECMAScript lets an implementation approximate them and a Node-versus-Chromium comparison would then be unfair.
