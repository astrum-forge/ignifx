# 00 · Architecture Overview

**Status:** Design standard (pre-1.0) · **Governs:** every `@ignifx/*` package · **Precedence:** see `CONSTITUTION.md` §10.1

This document defines the shape of ignifx: the objects a game is made of, how the packages are layered, and the boundary around Babylon Lite. Every other architecture document refines one part of this picture.

---

## 1. The mental model

```
App                         one per game; owns time, services, the extension host
 └─ World                   the live simulation: entity registry, phases, render scene
     ├─ SceneInstance*      one per loaded scene file (single or additive)
     │   └─ Entity*         a node in the scene tree; always has a Transform
     │       └─ Component*  data + behaviour attached to an entity
     │            └─ Script a Component that receives lifecycle callbacks
     └─ Systems             engine services that run in fixed phases (input, physics, animation, render sync…)
```

- **App** is the root object. `const app = await createApp({ canvas, extensions: [...] })`. There are no globals: everything is reached from the `app`, or from the `entity`/`world` a script belongs to (`CONSTITUTION.md` §3.6).
- **World** is the running simulation. It owns exactly one Babylon Lite render `SceneContext` and (when physics is registered) one headless simulation `SceneContext` (see `09-physics.md`). MVP supports one world per app; multiple worlds are a post-1.0 topic.
- **Scene** is a file (`*.scene.json`, or `*.prefab.json` as a naming convention for scenes meant to be instanced). A scene is a tree of entities and components. Loading a scene into the world produces a `SceneInstance`; instantiating a scene under an entity is what other engines call a *prefab* (see `06-serialization-and-scene-format.md`, ADR-0005).
- **Entity** is the node of the scene tree (Unity `GameObject`, Godot `Node`). It always has a `Transform`, a stable id, a name, tags, a layer, an active flag, and an ordered list of components.
- **Component** is typed data attached to an entity and owned by a system (e.g. `MeshRenderer`, `Rigidbody`, `AudioSource`). Components declare a serialization schema.
- **Script** extends `Component` and receives the engine lifecycle callbacks (`awake`, `start`, `fixedUpdate`, `update`, `lateUpdate`, …). This is the Unity `MonoBehaviour` role and the primary way game code is written (see `01-lifecycle-and-time.md`, `03-scripting-and-components.md`).
- **System** is engine-level logic that runs once per phase over many components (input polling, physics stepping, animation advance, render sync). Systems are registered by extensions and are not attached to entities.
- **Extension** is a package that registers components, systems, asset loaders, and services with an app (see `04-extensions.md`). Core features are extensions too (`CONSTITUTION.md` §8.1).

## 2. Package layout

All published packages live under the `@ignifx` npm scope and share one version line (fixed versioning). The names below are final for the MVP.

| Package | Role | Depends on |
|---|---|---|
| `@ignifx/core` | App, World, Entity, Component, Script, Transform, Time, phases, Signal, scene loading, assets, serialization/schemas, extension host, math, the Babylon Lite adapter (engine, render scene, `Camera`, `Light`, `MeshRenderer`, `Model`, `Environment`, materials), headless mode | `@babylonjs/lite` |
| `@ignifx/input` | Action maps, bindings, keyboard/mouse/pointer/gamepad/touch devices, pointer lock, rebinding | core |
| `@ignifx/physics` | 3D physics on Havok through Lite: `Rigidbody`, colliders, triggers, `CharacterController`, queries, layer matrix, interpolation | core, `@babylonjs/havok` |
| `@ignifx/physics-2d` | 2D physics: `Rigidbody2D`, colliders 2D, `CharacterController2D`, queries (backend per ADR-0006) | core, `@ignifx/2d` |
| `@ignifx/audio` | Audio engine wrapper, bus tree, `AudioSource`, `AudioListener`, `AudioClip` assets, unlock handling | core |
| `@ignifx/2d` | `Camera2D`, `SpriteRenderer`, `SpriteAnimator`, atlases, `Tilemap`, sorting layers, pixel-perfect, parallax | core |
| `@ignifx/3d` | `CharacterController3D` helpers, third-person and first-person rigs, `Animator` state machine, `NavMeshAgent` | core, physics |
| `@ignifx/ui` | DOM overlay UI host, input focus routing, world/HUD text components | core |
| `@ignifx/electron` | Main-process window factory with WebGPU flags, typed preload bridge, file-system storage backend | core |
| `@ignifx/devtools` | Stats overlay, scene tree and component inspector, physics debug view, script hot reload | core |
| `@ignifx/vite-plugin` | Asset manifest generation, scene/prefab JSON validation, WASM/asset handling, HMR hooks | — |
| `@ignifx/cli` | `create-ignifx` scaffolder (templates), asset tooling commands | — |
| `ignifx` | Umbrella: re-exports core and the standard extensions with a one-call `createGame()`; ships the Agent Skill | all of the above except electron/devtools/vite-plugin/cli |

Non-published workspace members: `templates/*` (2d-topdown, 2d-sidescroller, 3d-third-person, 3d-first-person), `examples/*`, `website/` (public site, separate deploy), `docs/`, `skills/`.

### 2.1 Layering rule

```
templates, examples            (may use anything)
   ▲
@ignifx/electron, @ignifx/devtools, ignifx (umbrella)
   ▲
@ignifx/input  @ignifx/physics  @ignifx/physics-2d  @ignifx/audio  @ignifx/2d  @ignifx/3d  @ignifx/ui
   ▲
@ignifx/core
   ▲
@babylonjs/lite (+ @babylonjs/havok, @webgpu/types)
```

A package may import only from packages below it and from peers it declares in its `ignifx` manifest (`04-extensions.md`). Circular package dependencies are forbidden and checked in CI.

### 2.2 Package internals

Every runtime package follows the same skeleton:

```
packages/<name>/
  package.json          "type": "module", exports: { ".": { types, import } }, sideEffects: false
  src/
    index.ts            explicit public barrel — every public symbol is re-exported here, nothing else
    lite/               the ONLY directory allowed to import "@babylonjs/lite" (see §3)
    <feature>/          one directory per feature; no barrel files inside features
  test/                 Vitest unit tests (headless) and browser tests (*.browser.test.ts)
  api/<name>.api.md     generated API report (see coding standards)
```

## 3. The Babylon Lite adapter boundary

Babylon Lite (`@babylonjs/lite`, pinned exactly; 1.27.0 at the time of writing) is a plain-data, function-based, tree-shakable WebGPU renderer that ships a new minor version every few days and states that backward compatibility is not a first-class goal. ignifx therefore isolates it (`CONSTITUTION.md` §3.4):

- **Import rule.** Only files under `src/lite/**` of a package may `import … from "@babylonjs/lite"`. A lint rule enforces this. Math types from Lite are re-exported through `@ignifx/core`'s own math module, not imported directly by feature code.
- **Ownership.** ignifx owns the scene tree; Lite's `SceneContext` owns render data. An ignifx `Transform` wraps a Lite `SceneNode` one-to-one (Lite nodes carry `position`/`rotationQuaternion`/`scaling` as observable values, a lazily computed `worldMatrix`, and a `worldMatrixVersion` counter), so there is no per-frame transform copy. Renderable components (`MeshRenderer`, `Light`, `Camera`, …) create Lite objects parented under the entity's node and register them with `addToScene`/`removeFromScene`.
- **Escape hatches.** Where a component wraps a Lite object it exposes it through a single, explicitly named accessor (`meshRenderer.lite`, `world.lite.scene`, `app.lite.engine`). These accessors are typed with Lite's types, documented as *unstable*, and excluded from the stability guarantees of Article IV.
- **No Lite types in schemas.** Serialized data never contains Lite objects; it contains asset references and plain numbers.
- **Upgrade procedure.** Bumping the pinned Lite version is its own pull request that (1) re-generates the adapter's compatibility test report, (2) runs the browser visual suite, and (3) updates the pinned version in the workspace catalog and in `SKILL.md`'s environment section.

### 3.1 Facts about Lite that shape ignifx (verified against `@babylonjs/lite@1.27.0` `index.d.ts`)

| Lite fact | Consequence for ignifx |
|---|---|
| `createEngine(canvas)` is async and throws when WebGPU is unavailable; there is no fallback | `createApp` performs a capability check first and rejects with a typed `WebGpuUnavailableError`; templates render a friendly message |
| The render loop is `startEngine(engine)` (rAF) and scene logic runs in `onBeforeRender(scene, cb(deltaMs))`; callbacks registered later run earlier; there is no `onAfterRender` | ignifx registers exactly one Lite callback per world and runs its whole frame inside it (`01-lifecycle-and-time.md`) |
| Headless: `createNullEngine()` + `createSceneContext(engine, { defaultRenderTask: false })` + `stepScene(engine, scene, deltaMs)` | ignifx headless mode and all unit tests use this path; `app.step()` is deterministic |
| `createHavokWorld(scene, hknp)` inserts its own step callback at the front of the scene's callback list and performs exactly one `HP_World_Step` per frame at `setPhysicsTimestepMs` (no accumulator) | ignifx hosts the physics world on a separate headless simulation scene and steps it from its own fixed-timestep loop (ADR-0003, `09-physics.md`) |
| glTF animation groups attached with `addToScene` are advanced by a hook that runs after user callbacks; `AnimationManager` supports manual advance via `updateAnimationManager(manager, deltaMs)` | ignifx advances animation itself between `update` and `lateUpdate` so `lateUpdate` sees posed skeletons, matching Unity's order |
| `onPhysicsCollision` events carry point/normal/impulse but no body identities; `onPhysicsTriggerBodies` carries `bodyA`/`bodyB` | Collision routing to entities needs an upstream addition (or an adapter-internal drain); tracked as a Phase 4 risk in the plan |
| Meshes removed from their last scene are disposed permanently; hide with `visible`/`setSubtreeVisible` instead | Entity deactivation toggles visibility; only `destroy()` removes from the scene |
| Sprites: `SpriteRenderer` + `Sprite2DLayer` (pixel space, +Y down, per-layer `Sprite2DView` camera, Y-sort, blend modes, picking) and depth-hosted layers for 3D scenes | `@ignifx/2d` maps world units (Y up) to layer pixels through pixels-per-unit; `Camera2D` drives `Sprite2DView` |
| Audio engine is a full port of Babylon's Audio V2 (buses, static/streaming sounds, spatial with `attachedTo`, unlock) | `@ignifx/audio` is a thin layer: bus tree conventions, components, asset integration |
| Error messages are compact codes unless `enableErrorDecoding()` is called | Development builds call it at app creation; production builds lazy-load `decodeError` in the global error handler |

## 4. Coordinate system and units

- **Left-handed, Y up, +Z forward** for 3D (identical to Unity and to Babylon Lite). Rotations are quaternions internally; Euler helpers use degrees in the public API.
- **2D is Y up** with `pixelsPerUnit` (default 100) mapping world units to sprite pixels; the 2D adapter performs the flip into Lite's Y-down layer space. Depth (Z) in 2D is used only for sorting-layer fallbacks; sorting is by (sorting layer, order in layer, optional Y-sort).
- **Units:** metres and seconds in every public API. Babylon Lite works in milliseconds; conversions live inside adapters only.
- **Time** is exposed in seconds through the `Time` service (`01-lifecycle-and-time.md`).

## 5. Identity

- Entities and components carry a `uid` (string, ULID) that is stable across saves and loads and is the key used by references inside scene files.
- At runtime, systems use dense numeric handles (`EntityHandle`) for fast lookups; `uid` is for files and tooling.
- Lite's `SceneNode.metadata` is used by the adapter to point back to the owning entity (`metadata.ignifx = { entity: EntityHandle, component?: ComponentHandle }`) so picking results resolve to entities.

## 6. Error handling and diagnostics

- Misuse throws `IgnifxError` with a stable `code` (`IGX-####`), an actionable message in development, and a compact message in production (`CONSTITUTION.md` §3.9).
- Every system exposes counters to `app.diagnostics` (frame time, fixed steps per frame, entity/component counts, draw calls and GPU time from Lite). `@ignifx/devtools` renders them.

## 7. What is deliberately out of scope for the MVP

- A visual editor. The runtime is editor-ready (schemas, inspector metadata, stable ids) but no editor ships before 1.0.
- Multiple worlds per app, and multiple simultaneous render cameras (multi-viewport). Single active camera in the MVP; extra cameras via Lite render tasks after 1.0.
- Networking. Deterministic fixed-step simulation is designed so that lockstep or server-authoritative networking can be added as an extension later.
- WebXR (Lite's XR path is not yet runnable in shipping browsers).
