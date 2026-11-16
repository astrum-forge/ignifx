# 00 · Architecture Overview

**Status:** Design standard; describes the engine as built (pre-1.0) · **Governs:** every `@ignifx/*` package · **Precedence:** see `CONSTITUTION.md` §10.1

This document defines the shape of ignifx: the objects a game is made of, how the packages are layered, and the boundary around Babylon Lite. Every other architecture document refines one part of this picture.

**Source map**

- `pnpm-workspace.yaml`: Workspace members and the version catalog, including the exact `@babylonjs/lite` pin.
- `.dependency-cruiser.cjs`: §2.1 as data (`ALLOWED_IMPORTS`, `TEST_ONLY_IMPORTS`); `pnpm deps` runs it.
- `tools/eslint-plugin-ignifx/src/rules/no-lite-outside-adapter.ts`: The import rule of §3.
- `packages/<name>/src/index.ts`, `packages/<name>/api/<name>.api.md`: Each package's public barrel and its generated API report.
- `packages/core/src/app/app.ts`: `createApp`, the `App`, start-up and disposal.
- `packages/core/src/lite/`: Core's Lite adapter; `node.ts` holds the `metadata.ignifx` bridge of §5.
- `packages/core/src/errors/`, `packages/core/src/ids/ulid.ts`, `packages/core/src/diagnostics/`: `IgnifxError` and the code registry, uids, `app.diagnostics`.
- `packages/ignifx/src/index.ts`: The umbrella's re-exports.

Invariants:

- A package imports only from the layers below it and the peers in its manifest; a change to the layering changes §2.1 and `.dependency-cruiser.cjs` together (§2.1).
- Only `src/lite/**` imports `@babylonjs/lite`; Lite objects leave a package only through a named `.lite` accessor, and never enter a schema (§3).
- One Lite `onBeforeRender` callback per world; physics is stepped by ignifx on its own headless scene (§3.1).
- Public APIs speak metres, seconds and degrees in a left-handed, Y-up space; milliseconds stay inside adapters (§4).
- A `uid` is stable across save and load; handles are run-time only (§5).
- Misuse throws `IgnifxError` with a registered `IGX-####` code (§6).

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
- **World** is the running simulation. It owns exactly one Babylon Lite render `SceneContext` and (when physics is registered) one headless simulation `SceneContext` (see `09-physics.md`). An app has one world (§7).
- **Scene** is a file (`*.scene.json`, or `*.prefab.json` as a naming convention for scenes meant to be instanced). A scene is a tree of entities and components. Loading a scene into the world produces a `SceneInstance`; instantiating a scene under an entity is what other engines call a _prefab_ (see `06-serialization-and-scene-format.md`, ADR-0005).
- **Entity** is the node of the scene tree (Unity `GameObject`, Godot `Node`). It always has a `Transform`, a stable id, a name, tags, a layer, an active flag, and an ordered list of components.
- **Component** is typed data attached to an entity and owned by a system (e.g. `MeshRenderer`, `Rigidbody`, `AudioSource`). Components declare a serialization schema.
- **Script** extends `Component` and receives the engine lifecycle callbacks (`awake`, `start`, `fixedUpdate`, `update`, `lateUpdate`, …). This is the Unity `MonoBehaviour` role and the primary way game code is written (see `01-lifecycle-and-time.md`, `03-scripting-and-components.md`).
- **System** is engine-level logic that runs once per phase over many components (input polling, physics stepping, animation advance, render sync). Systems are registered by extensions and are not attached to entities.
- **Extension** is a package that registers components, systems, asset loaders, and services with an app (see `04-extensions.md`). Core features are extensions too (`CONSTITUTION.md` §8.1).
- **Edit mode** (`createApp({ editMode: true })`) runs the same loop for an editor's scene view: the one call site that delivers script callbacks skips every script whose class does not set `static runInEditMode = true`, the fixed loop does not run, and each system runs, holds its clock, or is skipped as it declared at registration (`03-scripting-and-components.md` §10, ADR-0028).

## 2. Package layout

All published packages live under the `@ignifx` npm scope (plus the unscoped umbrella `ignifx`) and share one version line (fixed versioning). "Depends on" lists the `@ignifx/*` packages and engine libraries a package builds on; `.dependency-cruiser.cjs` is the enforced list.

- **`@ignifx/core`** (depends on `@babylonjs/lite`): App, World, Entity, Component, Script, Transform, Time, phases, Signal, scene loading, assets, serialization and schemas, the extension host, math, headless mode, and the Babylon Lite adapter (engine, render scene, `Camera`, `Light`, `MeshRenderer`, `Model`, `Environment`, materials, shader materials, surface shaders, post effects, `InstancedMeshRenderer`, `StorageBufferAsset`, baked lighting).
- **`@ignifx/input`** (core): action maps, bindings, keyboard, mouse, pointer, gamepad and touch devices, pointer lock, rebinding.
- **`@ignifx/physics`** (core, `@babylonjs/havok`): 3D physics on Havok through Lite: `Rigidbody`, colliders, triggers, `CharacterController`, queries, layer matrix, interpolation.
- **`@ignifx/physics-2d`** (core, `@ignifx/2d`): 2D physics: `Rigidbody2D`, 2D colliders, `CharacterController2D`, queries (backend per ADR-0006).
- **`@ignifx/audio`** (core): audio engine wrapper, bus tree, `AudioSource`, `AudioListener`, `AudioClip` assets, unlock handling.
- **`@ignifx/2d`** (core): `Camera2D`, `SpriteRenderer`, `SpriteAnimator`, `SpriteBatch`, atlases, `Tilemap`, sorting layers, pixel-perfect rendering, parallax.
- **`@ignifx/3d`** (core, physics, input): `FirstPersonController`, `ThirdPersonController`, `ThirdPersonCamera`, `RigidbodyMover`, the `Animator` state machine, navigation (`NavMeshSurface`, `NavMeshAgent`, `NavMeshObstacle`), `LodGroup`, `Billboard`.
- **`@ignifx/ui`** (core, input): DOM overlay UI host, input focus routing, widgets, world and HUD text components.
- **`@ignifx/particles`** (core): stateless GPU particles: `ParticleSystem`, `.particles.json` definitions and presets, `app.particles`; built on core's shader, storage-buffer and instancing API (ADR-0025).
- **`@ignifx/particles-2d`** (core, particles, `@ignifx/2d`): `ParticleSystem2D`, the same definitions evaluated on the CPU into a `SpriteBatch`.
- **`@ignifx/terrain`** (core): `Terrain` (heightmap or noise, chunked LOD, splat surface shader, queries, sculpting), `TerrainScatter`, `.terrain.json`; physics coupling by data (`colliderInit()`) (ADR-0026).
- **`@ignifx/electron`** (core): main-process window factory with WebGPU flags, typed preload bridge, file-system storage backend.
- **`@ignifx/devtools`** (core, ui, input, audio, physics, physics-2d): stats overlay, scene tree and component inspector, physics debug view, script hot reload.
- **`@ignifx/editor-host`** (core; vite-plugin for `./vite`): the ignifx editor's host inside a project: `startEditorHost` for the scene view, the play view's controls behind `virtual:ignifx/editor`, the editor protocol over a `MessagePort`, and a development-only Vite plugin at `@ignifx/editor-host/vite` (`17-editor-host.md`).
- **`@ignifx/vite-plugin`** (no `@ignifx/*` import): asset manifest generation, scene and prefab JSON validation, WASM and asset handling, HMR hooks.
- **`@ignifx/cli`** (no `@ignifx/*` import): two bins, `create-ignifx` (the scaffolder, which carries the templates) and `ignifx` (asset tooling commands). There is no `create-ignifx` package.
- **`ignifx`** (every runtime package above, including electron and devtools; not editor-host, vite-plugin or cli): the umbrella. It re-exports core and the extensions from one entry and ships the Agent Skill.

Other workspace members, none published: `templates/*` (2d-topdown, 2d-sidescroller, 3d-third-person, 3d-first-person), `examples/*`, `tools/*` (the ESLint plugin), `benchmarks`, `tests/visual`, `tests/templates`. The public site is a separate repository, `astrum-forge/ignifx-website`, built from the published packages (ADR-0027).

### 2.1 Layering rule

```
templates, examples            (may use anything)
   ▲
@ignifx/electron, @ignifx/devtools, @ignifx/editor-host, ignifx (umbrella)
   ▲
@ignifx/particles-2d ──▶ @ignifx/2d, @ignifx/particles
   ▲
@ignifx/input  @ignifx/physics  @ignifx/physics-2d  @ignifx/audio  @ignifx/2d  @ignifx/3d  @ignifx/ui  @ignifx/particles  @ignifx/terrain
   ▲
@ignifx/core (+ shader materials, surface shaders, post effects, InstancedMeshRenderer, StorageBufferAsset, TextureAsset.fromPixels)
   ▲
@babylonjs/lite (+ @babylonjs/havok, @webgpu/types)
```

A package may import only from packages below it and from peers it declares in its `ignifx` manifest (`04-extensions.md`): `@ignifx/ui` and `@ignifx/3d` declare input, `@ignifx/3d` declares physics, `@ignifx/physics-2d` declares `@ignifx/2d`, and `@ignifx/devtools` declares ui, input, audio and both physics packages. Circular dependencies are forbidden, between modules and between packages. `.dependency-cruiser.cjs` holds the rule as data and CI runs it (`pnpm deps`).

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

Babylon Lite (`@babylonjs/lite`, pinned to an exact version in the `pnpm-workspace.yaml` catalog) is a plain-data, function-based, tree-shakable WebGPU renderer that ships a new minor version every few days and states that backward compatibility is not a first-class goal. ignifx therefore isolates it (`CONSTITUTION.md` §3.4):

- **Import rule.** Only files under `src/lite/**` of a package may `import … from "@babylonjs/lite"`. A lint rule and a dependency-cruiser rule enforce this; the adapter tests under a package's `test/` are the one exception, because they pin Lite behaviour by calling Lite. The same rule covers `@babylonjs/havok` and the 2D physics library. Math types from Lite are re-exported through `@ignifx/core`'s own math module, not imported directly by feature code.
- **Ownership.** ignifx owns the scene tree; Lite's `SceneContext` owns render data. An ignifx `Transform` wraps a Lite `SceneNode` one-to-one (Lite nodes carry `position`/`rotationQuaternion`/`scaling` as observable values, a lazily computed `worldMatrix`, and a `worldMatrixVersion` counter), so there is no per-frame transform copy. Renderable components (`MeshRenderer`, `Camera`, …) create Lite objects parented under the entity's node and register them with `addToScene`/`removeFromScene`; a `Light` is the exception, posed in world space (§3.1).
- **Escape hatches.** Where a component wraps a Lite object it exposes it through a single, explicitly named accessor (`meshRenderer.lite`, `world.lite.scene`, `app.lite.engine`). These accessors are typed with Lite's types, documented as _unstable_, and excluded from the stability guarantees of Article IV.
- **No Lite types in schemas.** Serialized data never contains Lite objects; it contains asset references and plain numbers.
- **Upgrade procedure.** Bumping the pinned Lite version is its own pull request (`CONSTITUTION.md` §4.6) that (1) runs the adapter tests under `packages/*/test/lite/`, which pin the Lite behaviour the adapters rely on, (2) runs the headless and browser visual suites, and (3) updates the pinned version in the workspace catalog and in `skills/ignifx/SKILL.md`.

### 3.1 Facts about Lite that shape ignifx

These hold for the pinned Babylon Lite version (`pnpm-workspace.yaml` catalog); re-check them against its `index.d.ts` at every bump.

- **Lite:** `createEngine(canvas)` is async and throws when WebGPU is unavailable; there is no fallback. **ignifx:** `createApp` performs a capability check first and rejects with `IgnifxError` code `IGX-0701` (WebGPU unavailable); templates render a friendly message.
- **Lite:** The render loop is `startEngine(engine)` (rAF) and scene logic runs in `onBeforeRender(scene, cb(deltaMs))`; callbacks registered later run earlier; there is no `onAfterRender`. **ignifx:** ignifx registers exactly one Lite callback per world and runs its whole frame inside it (`01-lifecycle-and-time.md`).
- **Lite:** Headless: `createNullEngine()` + `createSceneContext(engine, { defaultRenderTask: false })` + `stepScene(engine, scene, deltaMs)`. **ignifx:** ignifx headless mode and all unit tests use this path; `app.step()` is deterministic.
- **Lite:** `createHavokWorld(scene, hknp)` inserts its own step callback at the front of the scene's callback list and performs exactly one `HP_World_Step` per frame at `setPhysicsTimestepMs` (no accumulator). **ignifx:** ignifx hosts the physics world on a separate headless simulation scene and steps it from its own fixed-timestep loop (ADR-0003, `09-physics.md`).
- **Lite:** glTF animation groups attached with `addToScene` are advanced by a hook that runs after user callbacks; `AnimationManager` supports manual advance via `updateAnimationManager(manager, deltaMs)`. **ignifx:** ignifx advances animation itself between `update` and `lateUpdate` so `lateUpdate` sees posed skeletons, matching Unity's order.
- **Lite:** `onPhysicsCollision` events carry both bodies (`collider`, `collidedAgainst`) as well as point/normal/impulse; `onPhysicsTriggerBodies` carries `bodyA`/`bodyB`. **ignifx:** Collisions and triggers reach both entities with `other` set (`09-physics.md` §4).
- **Lite:** Meshes removed from their last scene are disposed permanently; hide with `visible`/`setSubtreeVisible` instead. **ignifx:** Entity deactivation toggles visibility; only `destroy()` removes from the scene.
- **Lite:** Lights are scene nodes: a light's `direction` is local and is rotated by its `worldMatrix`, and a point or spot light shines from `worldMatrix[12..14]`. **ignifx:** `Light` keeps its Lite light unparented and unrotated and writes the entity's world pose into it each frame the entity moved (`src/lite/light.ts`).
- **Lite:** Sprites: `SpriteRenderer` + `Sprite2DLayer` (pixel space, +Y down, per-layer `Sprite2DView` camera, Y-sort, blend modes, picking) and depth-hosted layers for 3D scenes. **ignifx:** `@ignifx/2d` maps world units (Y up) to layer pixels through pixels-per-unit; `Camera2D` drives `Sprite2DView`.
- **Lite:** Audio engine is a full port of Babylon's Audio V2 (buses, static/streaming sounds, spatial with `attachedTo`, unlock). **ignifx:** `@ignifx/audio` is a thin layer: bus tree conventions, components, asset integration.
- **Lite:** Error messages are compact codes unless `enableErrorDecoding()` is called. **ignifx:** Development builds install the decoder at app creation through a dynamic import, so its message table stays out of a production entry chunk; production builds report the compact codes (`07-rendering.md` §5).

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

## 7. What is deliberately out of scope

- A visual editor inside the engine. The editor is a separate product (`astrum-forge/ignifx-editor`) built on the runtime through `@ignifx/editor-host` (`17-editor-host.md`) and developed alongside the engine (ADR-0032). The runtime is editor-ready (schemas, inspector metadata, stable ids, edit mode) and stays editor-free: nothing in a game depends on the editor.
- Multiple worlds per app, and multiple simultaneous render cameras on screen (multi-viewport). One camera draws the canvas; others can render into textures through Lite render tasks (`07-rendering.md` §2.11).
- Networking. Deterministic fixed-step simulation is designed so that lockstep or server-authoritative networking can be added as an extension later.
- WebXR.
