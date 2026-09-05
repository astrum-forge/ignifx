# ADR-0003 · ignifx owns the frame loop: fixed timestep, simulation scene, engine-driven animation

**Status:** Accepted · **Date:** 2026-09-05

## Context
Verified against `@babylonjs/lite@1.27.0`: Lite's `createHavokWorld` inserts a step callback at the front of `scene._beforeRender`, runs exactly one Havok step per rendered frame (no accumulator), and cannot be unregistered through public API; glTF animation groups added to a scene are advanced by a hook that runs after user callbacks; `onBeforeRender` callbacks run in reverse registration order; `stepScene(engine, scene, deltaMs)` runs a scene's update on a null engine. `CONSTITUTION.md` §2.1 and §3.2 require deterministic fixed-step simulation and a single loop definition.

## Options considered
1. **Let Lite step physics once per frame** — simplest; matches Babylon.js defaults. Cons: not fixed-step under variable frame rates; no interpolation; `lateUpdate` before animation.
2. **Drive Lite's render scene `_update` multiple times per frame** — uses private API; re-runs animation hooks per step.
3. **Host physics on a separate headless simulation scene stepped by ignifx; detach animation groups from Lite and advance them with `updateAnimationManager`** — public API only; full control of ordering and step count.

## Decision
Option 3. One ignifx callback per world runs the whole frame (`docs/architecture/01-lifecycle-and-time.md` §3). Physics lives on a null-engine `SceneContext` and is stepped with `stepScene` inside ignifx's accumulator loop; interpolation is implemented by ignifx. Animation groups are removed from asset containers before `addToScene` and advanced in `PostUpdate` by ignifx-owned `AnimationManager`s. Sprite animation likewise runs on ignifx's clock.

## Consequences
- Determinism and Unity-order semantics (`update → animation → lateUpdate`) are guaranteed regardless of Lite's internal ordering.
- Two Lite scenes per world (render + simulation); bodies bind to the same `SceneNode`s.
- Upstream requests: public `stepPhysicsWorld`, `onBeforeRender` disposer, collision events with body identities. If Lite adds them, the adapter simplifies with no public change.
- Risk: a future Lite version could couple physics to the render scene; the adapter compatibility suite will catch it at upgrade time.
