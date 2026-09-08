# ignifx

## 0.2.1

### Patch Changes

- Updated dependencies [7adf987]
- Updated dependencies [21a4ba7]
- Updated dependencies [6a39fae]
- Updated dependencies [6a39fae]
- Updated dependencies [388b0f6]
- Updated dependencies [6a39fae]
- Updated dependencies [ef054ec]
  - @ignifx/3d@0.2.1
  - @ignifx/input@0.2.1
  - @ignifx/physics-2d@0.2.1
  - @ignifx/physics@0.2.1
  - @ignifx/core@0.2.1
  - @ignifx/devtools@0.2.1
  - @ignifx/electron@0.2.1
  - @ignifx/ui@0.2.1
  - @ignifx/2d@0.2.1
  - @ignifx/audio@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
- Updated dependencies [c8fb925]
  - @ignifx/core@0.2.0
  - @ignifx/2d@0.2.0
  - @ignifx/3d@0.2.0
  - @ignifx/audio@0.2.0
  - @ignifx/devtools@0.2.0
  - @ignifx/electron@0.2.0
  - @ignifx/input@0.2.0
  - @ignifx/physics@0.2.0
  - @ignifx/physics-2d@0.2.0
  - @ignifx/ui@0.2.0

## 0.1.0

### Minor Changes

- 5bf13be: API review: the umbrella stops re-exporting other packages' `@internal` symbols
  
  **Breaking.** Fourteen symbols leave the umbrella's public surface. Ten were marked `@internal` in
  the package that declared them and reached `ignifx` only because that package's barrel exported them
  (`asDomCanvas`, `resolveDomTarget`, `resolveDevtoolsTarget`, `isValidLayer`, `TextRuntime`,
  `TextRuntimeOptions`, `UiHostOptions`, `UiSystemOptions`, `I18nServiceOptions`,
  `DevtoolsServiceOptions`); the other four are the duplicate or renamed names their own packages
  retired in this release (`MATERIAL_ALPHA_MODE_NAMES`, `MaterialAlphaModeName`, `PlayStateOptions`,
  and `Capsule2DDirection`/`CAPSULE_2D_DIRECTIONS`, now `CapsuleDirection2D`/`CAPSULE_DIRECTIONS_2D`).
  
  `CONSTITUTION.md` §5.4 makes release tags mandatory, and the umbrella is the surface a game imports:
  a symbol its own package calls internal has no business being re-exported from it. See each
  package's own changeset for what replaced what.
- 9ab633d: Phase 1 kernel: the ignifx runtime core
  
  `@ignifx/core` now ships the engine kernel, and the `ignifx` umbrella re-exports all of it: `createApp` with the `App` contract (start/stop/pause/resume/dispose, headless `step`, services, frozen project settings, `onError`, diagnostics, logging, platform info) and the extension host (`Extension`, `ExtensionContext`, `defineExtension`, `coreExtension`, topologically ordered registration with engine-range checks, services, app-property definition, settings sections, error-code registration); `Time`, the six-phase scheduler with its fixed-timestep loop, lifecycle flushes, destroy queue, and generator coroutines (`waitSeconds`, `waitSecondsRealtime`, `waitFixedUpdate`, `waitUntil`, `waitWhile`); `World`, `SceneInstance`, `Entity`, `Transform`, `Component`, `Script`, the `ScriptCallbacks`/`ComponentHooks` signature interfaces, `Component.define`/`Script.define` with the full schema field-kind set, component registration and `typeId`s, `Signal`, `TagSet`, `LayerTable`/`LayerMask`; the math module (`Vec2`, `Vec3`, `Vec4`, `Quat`, `Mat4`, `Color`, scalar helpers) with allocation-free `ToRef` variants structurally compatible with Babylon Lite's interfaces; and `IgnifxError` with the `IGX-####` code space (`CoreErrorCode`, `ErrorRange`). Documentation lands with it: the entry Agent Skill documents `createApp`, `Entity`, `Script`, `Time`, and `Signal` with examples the harness compiles, plus concept references for the lifecycle, scene graph, scripting, and extensions, and a gotcha list. Component and script statics (`typeId`, `schema`, `requires`, `allowMultiple`, `executionOrder`, `updateWhenPaused`) are declared structurally on the new `ComponentStatics`/`ScriptStatics` interfaces rather than on the `Component`/`Script` classes, so a subclass writes a plain `static typeId = "mygame/Mover"` with no `override` modifier under `noImplicitOverride`; `ComponentRegistry` reads each one once per class and supplies the defaults.
  
  **Breaking**
  
  The Phase 0 toolchain-spike API is removed: `createHeadlessRuntime`, `createRenderEngine`, and the other spike exports no longer exist. Use `createApp({ headless: true })` for a GPU-free app driven by `app.step(dt)`, and `createApp({ canvas })` for a rendering app started with `await app.start()`. Pre-1.0 breaking changes ship without a deprecation window (`CONSTITUTION.md` §4.2).
- 69b2c56: Phase 2: the render components, the GPU assets, and the rendering settings
  
  `@ignifx/core` grows the public rendering surface `docs/architecture/07-rendering.md` describes, on top of the Phase 2 adapter.
  
  Components: `Camera` (perspective and orthographic, priority-based selection, `screenToRay`/`worldToScreen`), `Light` (directional, point, spot, hemispheric, with the shadow declaration ADR-0002 validated), `MeshRenderer` (a `MeshAsset` plus materials, layers, casting, picking), `Model` (a loaded `ModelAsset` instantiated under the entity, with a node map and `attachToNode`), `Environment` (image-based lighting, skybox, fog, clear colour, tone mapping) and `PostProcessStack` (bloom, SMAA, image processing, recorded as one frame-graph chain).
  
  Assets: `MeshAsset` with the primitive factories, `ModelAsset`, `TextureAsset`, `MaterialAsset` (PBR and Standard, plus the `ignifx.material` file format), `EnvironmentAsset` (plus the `ignifx.environment` description) and `FontAsset`, each behind a GPU loader the core extension registers. `Assets.register` publishes an in-code asset at a `memory:` address so an `asset()` field can hold one without a file, and an `asset()` field now decodes to a **loaded `AssetHandle`** rather than to an address record.
  
  Services and settings: `app.renderer` (screenshots, GPU picking, resolution scale, frame and task timings, the default material), `world.mainCamera`, `world.raycastRender`, the `rendering` settings section (`msaaSamples`, `alphaMode`, `srgb`, `format`, `maxDevicePixelRatio`, `useHighPrecisionMatrix`, `useFloatingOrigin`, `requiredLimits`, `clearColor`, `brdfLut`, and the `features` opt-ins), the `PreRender` render-sync system, ADR-0014's boot warm-up, and device-loss recovery fanned out to `app.events`.
  
  Five error codes are added: `IGX-0705` (two enabled `Environment` components), `IGX-0706` (no enabled camera), `IGX-0707` (a screenshot was asked for with no render loop running), `IGX-0708` (a material file names a family this build cannot construct) and `IGX-0709` (a file is not the ignifx description format it claims).
- 69b2c56: Phase 2: the asset service, the scene format, and the Agent Skill that documents them
  
  `@ignifx/core` gains the runtime half of the asset pipeline (`docs/architecture/05-assets-and-loading.md`). `app.assets` resolves addresses through the manifest `@ignifx/vite-plugin` generates, answers `load`/`loadAsync`/`loadAll`/`preloadGroup` with reference-counted `AssetHandle`s (`state`, `value`, `promise`, `progress`, `error`, `refCount`, `retain`, `release`, `[Symbol.dispose]`, `onReplaced`), schedules fetches through a priority queue with a concurrency limit and retries, cancels them through an `AbortSignal`, and collects zero-reference assets after `gcDelay`. Completed loads are delivered by one `PreUpdate` system, so a handle's state flips and its promise settles at exactly one point per frame. `Assets.register` publishes an in-code value at a `memory:` address, `AssetLoader`/`LoaderContext` is the extension-facing contract behind `ctx.registerAssetType`/`ctx.registerAssetLoader`, and `binaryAssetLoader`, `jsonAssetLoader`, and `textAssetLoader` ship with the core extension beside the GPU loaders.
  
  Serialization is complete for the `ignifx.scene` format (`06-serialization-and-scene-format.md`, ADR-0005): `SceneFile` and its entity, component, transform, instance, and override records; `serializeScene`, `serializeEntity`, `serializeComponent`, `stringifySceneFile`, `validateSceneFile`, `computeSceneHash`, `sceneFileJsonSchema`, `parseOverridePath`, `UidRemap`, `createSceneAsset`, `createSceneLoader`, `instantiateScene`, and `assertSceneDependenciesLoaded`. The world drives them through `loadScene` (single or additive, cancellable, with progress), `unloadScene`, `instantiate`, `instantiateAsync`, and `moveEntityToScene`; `SceneInstance` now carries the `AssetHandle<SceneAsset>` it was built from and its uid remap. `app.events` joins `App` as the engine-wide signal table — `onSceneLoaded`, `onSceneUnloaded`, `onDeviceLost`, `onDeviceRecovered`, `onDeviceRecoveryFailed`.
  
  Documentation lands with it. The entry Agent Skill documents the render components, the mesh and material factories, `app.assets`, scene and prefab loading, `app.renderer`, and the `rendering` and `assets` settings sections, with examples the harness compiles; there is a new `references/concepts/rendering.md`, a rewritten `assets.md`, hand-written `references/formats/scene.md` and `material.md` beside the generated tables, the first two generated recipes ("load a model", "spawn a prefab") extracted from `examples/recipes/`, and seventeen new gotchas covering the feature opt-ins, runtime material warm-up, handle ownership, and colour encoding.
  
  **Breaking**
  
  - `asset(TypeToken)` fields now hold `AssetHandle<A> | null` at runtime instead of `AssetRefValue<A> | null`. Read `field.value` for the asset and `field.address` for the address; the file encoding, `{ "$asset": "<address>" }`, is unchanged.
  - `CoreErrorCode.cryptoUnavailable` moved from `IGX-1401` to `IGX-1420`. `IGX-1401`–`IGX-1419` belong to `@ignifx/cli` (`docs/architecture/00-overview.md` §2), so the kernel's code was in the wrong half of the platform range.
  - `SceneInstance.asset` is typed `AssetHandle<SceneAsset> | null` rather than `null`, so code that relied on it narrowing to `null` no longer compiles.
  
  Pre-1.0 breaking changes ship without a deprecation window (`CONSTITUTION.md` §4.2).
- 4cfb15f: Phase 3: player input
  
  `@ignifx/input` ships, and the `ignifx` umbrella re-exports all of it. Registering `input()` gives a game `app.input` — a typed property paired with a `declare module "@ignifx/core"` augmentation — plus the `inputactions` asset type, the `PlayerInput` component, the `input` project settings section, an `input` diagnostics group, and the `PreUpdate` system (order `-950`, before core's asset delivery at `-900`) that resolves a frame's input before any script callback runs.
  
  **Devices.** `Keyboard` (physical `KeyboardEvent.code` names, so WASD survives AZERTY, plus `anyKey`), `Mouse`, the unified `Pointer`, `Touch` with a primary slot and ten numbered ones, four `Gamepad` slots in the W3C standard mapping (sticks flipped so up is positive, `dpad` synthesised as a `vector2`, a remap table for common non-standard pads, and `rumble(intensity, seconds)` through `vibrationActuator`), and a `Virtual` device whose controls are created on demand for on-screen sticks and buttons. Every control resolves once to an integer index into a `Float32Array`, so no frame does a string lookup. DOM events are queued with a monotonic sequence number and applied once, in `PreUpdate`; `blur` and `visibilitychange` queue a release of everything so a key held while the page loses focus does not stick.
  
  **Actions.** `InputAction` (`button`/`axis`/`vector2`, `isPressed`, `wasPressedThisFrame`, `wasReleasedThisFrame`, an allocation-free live `vector` view, and `onStarted`/`onPerformed`/`onCanceled` signals reported through `app.onError`), `ActionMap` as the context switch, and `app.input.actions.get(name)` searching the enabled maps (`IGX-0801`). Edge flags are computed once per frame and hold for the whole frame, every fixed step included. Actions whose controls changed resolve first, in the arrival order of the events that changed them.
  
  **Bindings.** The path grammar `<Device>/control`, sub-controls (`<Gamepad>/dpad/up`), and a zero-based device slot written `<Gamepad>{1}/leftStick`; the `2DVector`, `1DAxis`, and `ButtonWithModifier` composites; and the `deadzone`, `invert`, `scale`, `clamp`, and `normalize` processors, parsed from strings once at load time into precompiled chains. Control schemes switch on the last device used and drive `currentScheme`/`onControlSchemeChanged`; a scheme tag does not filter resolution unless `input.strictSchemes` is set.
  
  **Assets and persistence.** The `.input.json` format `ignifx.inputactions` version 1, its loader, `defineInputActions({ … })` for the same document in code, `inputActionsJsonSchema()` and `describeInputActionsFormat()` for the build-time validator and the docs harness, and `app.input.loadActions(...)` which merges by map name. `performInteractiveRebind(action, options)` resolves with the highest-magnitude actuation of a frame and writes `binding.overridePath`; `saveOverrides()`/`loadOverrides(json)` persist overrides as an `ignifx.inputoverrides` document.
  
  **The rest.** Pointer lock (`request()`/`exit()`/`locked`/`onChange`, with `<Mouse>/delta` still reporting while locked), `cursor.visible`, `uiHasFocus` suppression of keyboard actions, the pooled per-frame `app.input.events` stream, `PlayerInput` for per-player device slots, and `simulate({ "<Keyboard>/w": 1 })` plus `simulateEvent(...)` so headless tests drive the identical pipeline.
- 8947b19: Phase 4: 3D physics on Havok through Babylon Lite.
  
  `@ignifx/physics` simulates rigid bodies on its own null-engine scene, stepped by ignifx's fixed
  loop (ADR-0003), so the simulation advances at a fixed rate regardless of frame rate, is
  deterministic on one platform and build, and runs headless with no GPU.
  
  - `physics()` extension: the `physics` settings section, the `physicsmaterial` asset loader, the
    `09xx` diagnostic codes, the `physics` diagnostics group, and three systems — restore poses at
    `FixedUpdate -100`, step and dispatch at `FixedUpdate 100`, interpolate at `PreRender -500`.
  - `Rigidbody` with dynamic, kinematic, and static bodies, forces, impulses, velocities, teleports,
    frozen rotation axes, and `collisionEvents` auto-detected from the scripts on the entity.
  - `BoxCollider`, `SphereCollider`, `CapsuleCollider`, `CylinderCollider`, `MeshCollider`, and
    `HeightfieldCollider`; several on one entity form one compound body, and a collider-only entity
    gets an implicit static body with the `IGX-0901` moved-static diagnostic.
  - `CharacterController`: a kinematic capsule with collide-and-slide, support classification, skin
    width, crouching, and dynamic-body pushing.
  - Trigger and collision callbacks delivered to both entities through the kernel's script-callback
    hook, with pooled event objects. Collision identities need
    `physics({ collisionIdentities: "internal" })` until Babylon Lite reports them upstream (ADR-0013).
  - `app.physics`: `raycast`, `shapeCast`, `overlap`, `distanceToNearest`, world gravity, and the
    wireframe debug viewer.
  - Collision layers and the project collision matrix, mapped onto Havok's 32-bit filters.
  - `PhysicsMaterial` and the `ignifx.physicsmaterial` file format.
- c7f3bb1: Phase 5: audio
  
  `@ignifx/audio` ships the subsystem `docs/architecture/10-audio.md` describes. Registering `audio()` gives a game `app.audio`, three components, two asset types, the `audio` settings section, the `audio` diagnostics group, and one `PreRender` system.
  
  `app.audio` (`AudioService`) owns the mixer tree — named `AudioBus` gains chained parent to child, built from the `defaultBuses` setting or from an `.audio.json` (`ignifx.audiobuses`, with `parseAudioBusesFile` and a loader) — plus `masterVolume`, `bus`/`tryBus`/`createBus`, `playOneShot`, the active `listener`, `onStateChanged`, and the `lite.engine` escape hatch. `state` reads `"locked"` until the audio context runs: browsers refuse to make a sound before a user gesture and Babylon Lite quietly drops a non-looping play made while the context is suspended, so every `play()` made while locked is held on its source and flushed, in order, by `unlock()` or by Lite's own `resumeOnInteraction`.
  
  Components: `AudioSource` (clip, bus, volume, pitch, loop, `playOnAwake`, `maxInstances`, spatial placement with cone angles in degrees, stereo pan; `play`/`playOneShot`/`stop(fade)`/`pause`/`resume`, `isPlaying`, `instanceCount`, `onEnded`), `AudioListener` (one active pair of ears, attached to the entity's Lite node), and `MusicPlayer` (a `Script` with a playlist, `play(clip, { fadeIn })`, `crossfadeTo(clip, seconds)`, `stop({ fadeOut })`, `next()`, routed to the `Music` bus and surviving a `"single"` scene load from a persistent scene). Assets: `AudioClip` for `.mp3 .ogg .wav .webm .flac`, static by default and streaming through a `{ "audio": { "streaming": true } }` sidecar.
  
  **Audio is testable under Node.** The one `AudioBackend` contract has two implementations: `WebAudioBackend` wraps Lite's engine and is the only module that imports `@babylonjs/lite`; `HeadlessBackend` is pure TypeScript that keeps the same state — playing, paused, instance counts, gains, oldest-instance stealing — and *simulates* playback, ending an instance after `clip.duration / playbackRate` seconds of engine time advanced by the `PreRender` pump from the frame delta. Fades are interpolated by the service rather than handed to Lite's `RampOptions`, so a two-second crossfade takes two seconds of game time on both backends, and `onEnded` is raised from the pump so it lands at a defined point in the frame instead of on Lite's audio-thread callback. A gameplay test steps the app and reads real answers.
  
  Ten error codes are added: `IGX-1001` (unknown bus), `IGX-1002` (a spatial source playing with no listener), `IGX-1003`–`IGX-1006` (a malformed `.audio.json`: bad header, unreadable version, duplicate bus name, a parent not declared before its child), `IGX-1007` (no Web Audio in this host), `IGX-1008` (a clip that would not decode), `IGX-1009` (a streaming clip on a context that cannot stream) and `IGX-1010` (the service used after disposal).
- a0625fb: Phase 6: 2D toolkit
  
  `@ignifx/2d` ships the subsystem `docs/architecture/11-2d-toolkit.md` §1–§7 describes. Registering `twoD()` gives a game `app.twoD`, seven components plus the `Camera2DFollow` script, three asset types with their loaders and importers, the `twoD` settings section, and two systems: sprite and camera synchronisation in `PreRender` (order `-450`) and sprite animation in `PostUpdate` (order `0`).
  
  **Rendering.** A second Babylon Lite rendering context — a `SpriteRenderer` — is created on the app's surface and registered *after* the render scene, so 2D composites on top. One `Sprite2DLayer` exists per (sorting layer × atlas × blend mode × screen-space) tuple, because Lite binds a layer to one atlas and one blend mode for its life. `twoD.mode: "mixed"` passes `clear: false` so a 2.5D game keeps its 3D frame underneath; the default `"sprite"` mode owns the frame.
  
  **Coordinates.** The world stays metres with +Y up (ADR-0011); the adapter is the only place that flips into Lite's +Y-down pixel space, at `twoD.pixelsPerUnit` (default 100). A sprite's rotation is negated on the way in and a camera's view rotation is not — the two flips cancel for a view and do not for a quad.
  
  **Sorting.** `SortingLayerTable` resolves the core `sortingLayers` section into Lite draw orders. `orderInLayer` becomes a Y-sort bias on a Y-sorted layer and falls back to insertion order on one that is not, which is what §1 specifies.
  
  **Components.** `Camera2D` (orthographic half-height, pixel-perfect integer zoom against a reference resolution, travel bounds, follow fields), `SpriteRenderer` (atlas frame, tint, flip, sorting, blend, pivot override, screen-space, pickable, world AABB), `SpriteAnimator` (clips on ignifx's clock, so `timeScale`, `pause()` and frame events behave as they do for 3D), `Tilemap` and `TilemapRenderer` (chunked rendering that materialises only the chunks the camera sees, animated tiles, runtime edits, and the merged collision surface `@ignifx/physics-2d` consumes), `ParallaxLayer`, and `SpriteLayerEffect` (a per-layer WGSL fragment shader with an `fx.params` vec4, plus a built-in `tint`).
  
  **Assets.** `ignifx.spriteatlas` (`.atlas.json`), `ignifx.spriteanimation` (`.spriteanim.json`) and `ignifx.tilemap` (`.tilemap.json`), each with a loader that tolerates the null engine. `"sprites/hero.atlas.json#frame:idle_0"` addresses one frame of a shared atlas. Importers for TexturePacker, Aseprite (atlas and tags), a uniform grid, Tiled `.tmj` and LDtk `.ldtk` are pure functions a build step or a test can call with no app.
  
  **Picking.** `app.twoD.pickAt(x, y)` resolves a viewport pixel to the `SpriteRenderer` that drew it, on the CPU with no readback and no frame of latency.
  
  New diagnostic codes: `IGX-1102` an atlas frame with no 1-px extruded border (logged, not thrown), `IGX-1103`/`IGX-1104`/`IGX-1105` an unreadable atlas, animation or tilemap document, `IGX-1106` an unknown frame, `IGX-1107` an undeclared sorting layer, `IGX-1108` an unknown clip, `IGX-1109` an unsupported import, `IGX-1110` a duplicate tile-object factory, `IGX-1111` a cell outside its layer, `IGX-1112` a second `twoD()` on one app, `IGX-1113` a custom `SpriteLayerEffect` with no WGSL body. `IGX-1101` is left to `@ignifx/physics-2d`.
- a0625fb: Implement Phase 6 2D physics on Rapier 2D (ADR-0006, `docs/architecture/11-2d-toolkit.md` §8).
  
  `physics2d()` registers `app.physics2d`, the `physics2d` settings section, the `ignifx.physicsmaterial` loader, the `IGX-11xx` diagnostics, and the three systems that put 2D physics in the frame — restore poses at `FixedUpdate −100`, step Rapier and dispatch events at `FixedUpdate 100`, interpolate at `PreRender −500`.
  
  - **Components:** `Rigidbody2D` (dynamic/kinematic/static, exact `mass`, gravity scale, per-body damping, frozen rotation, forces, impulses, torque, teleport), `BoxCollider2D`, `CircleCollider2D`, `CapsuleCollider2D`, `PolygonCollider2D`, `EdgeCollider2D`, `TilemapCollider2D`, and `CharacterController2D` with slopes, autostep, snap-to-ground, and one-way platforms.
  - **Events:** `onCollisionEnter`/`Stay`/`Exit` and `onTriggerEnter`/`Exit` — the 3D callback names, carrying pooled `Collision2D` / `TriggerEvent2D` payloads. Rapier reports both colliders, so both identities are always present and no ADR-0013-style waiver is needed.
  - **Queries:** `raycast`, `raycastAll`, `overlapCircle`, `overlapBox`, and `shapeCast`, all shape-accurate and all reporting the exact collider they hit.
  - **Layers:** the project collision matrix maps onto Rapier's interaction groups. Rapier's groups are 16 bits wide, so only the first sixteen layers filter; a collider above them reports `IGX-1152` and falls back to layer 0.
  - **Determinism:** a committed baseline hash over 600 fixed steps, reproduced across apps and across processes. `@dimforge/rapier2d-compat` is Rapier's main build, which guarantees local determinism only.
- d349254: Phase 7: the 3D toolkit
  
  `@ignifx/3d` ships the subsystem `docs/architecture/12-3d-toolkit.md` describes, minus the sections it marks Phase 7b. Registering `threeD()` gives a game `app.navigation`, twelve components, the `animator` asset type, the `threeD` settings section, and four systems: `Animator` in `PostUpdate` at order `10`, `Billboard` at `20`, `LodGroup` in `PreRender` at `-10`, and the navigation crowd in `FixedUpdate` at `200`, after physics.
  
  **Characters.** `ThirdPersonController` moves relative to the main camera's yaw on a `CharacterController`, with coyote time, jump buffering, air control, an optional `shapeCast` step probe, and configurable action names. `FirstPersonController` splits yaw onto the body and pitch onto a `cameraPivot` child, requests pointer lock on the first `pointerdown`, and crouches through `setHeight`. `RigidbodyMover` (with a `torqueSteering` mode), `PlatformMover` (a kinematic lift that carries its riders), and `Projectile` round out §1.3. The movement arithmetic — camera-relative direction, turn-towards, coyote and buffer timers, slope projection — is a pure module, so it is tested a frame at a time with no physics world.
  
  **Slope handling is not `supportState`.** Babylon Lite's character controller defaults `staticFriction` to `0` (`index.d.ts` 8310), so it reports *every* incline as `sliding` and `isGrounded` as `false`, at ten degrees as readily as at sixty. `ThirdPersonController.isGrounded` therefore classifies the ground itself, from the contact normal against `CharacterController.slopeLimit`, and cancels the down-slope creep the ground-stick bias would otherwise produce. A character stands still on a 30° ramp, walks up it, and slides down a 60° one.
  
  **`ThirdPersonCamera`** is an orbit rig in `lateUpdate` — after the `Animator` has posed the frame — with damping, a shoulder offset, and a `shapeCast` boom that pulls in instantly and eases back out.
  
  **`Animator`** runs an `ignifx.animator` document (`.animator.json`): parameters (`float`/`int`/`bool`/`trigger`), layers with bone masks and additive blending, states with clips or 1D blend trees, transitions with conditions, exit times, interruptibility and `from: "any"`, and animation events. The state machine is a **pure module** with no Babylon Lite in it, so transitions, exit times, trigger consumption, blend-tree thresholds and events are all verified headlessly; the Lite adapter applies its weights, speeds and playheads and advances a per-animator `AnimationManager` on ignifx's clock, so `timeScale` and `app.pause()` behave.
  
  **Navigation** bakes a navmesh from `MeshRenderer`s on a layer mask or from world-space geometry handed over directly, and runs Recast crowds on the fixed step. `NavMeshSurface`, `NavMeshAgent`, `NavMeshObstacle`, and `app.navigation.findPath`/`closestPoint`/`raycast`. **It runs headlessly**: Babylon Lite inlines the Recast WebAssembly as a `data:` URL, so a plain Node process bakes a mesh, routes a path around a wall, and walks an agent to its destination with no configuration at all — which is why the navigation suite is a node suite rather than a browser one. `docs/adr/0017-navigation-wasm.md` records the measurement, the cost (1.45 MiB raw / 441 KiB gzip / 190 KiB brotli, in a lazily imported chunk), and the Phase 12 follow-up.
  
  **`LodGroup`** and **`Billboard`** ship from §6; `DayNightCycle`, `SimpleWater`, `FogVolume`, `CameraBrain` and `VirtualCamera` remain Phase 7b.
  
  **Three Babylon Lite limitations, verified against 1.27.0, documented rather than worked around.** There is no navmesh serialization — no `getNavMeshData`, no `buildFromNavMeshData` — so `.navmesh.bin` and `ignifx bake navmesh` are not implementable and `NavMeshSurface.prebaked` warns and bakes at runtime. There is no `removeAgent`, so a destroyed agent parks rather than freeing its crowd slot. And `addAnimationGroup` binds a clip to one manager while a cloned skinned mesh shares the template's skeleton, so two `Model`s of one `.glb` cannot be animated independently; the second animator reports the refusal on `app.onError` rather than throwing mid-frame.
  
  New codes: `IGX-1201` through `IGX-1214`.
- d349254: Phase 8: UI
  
  `@ignifx/ui` ships the subsystem `docs/architecture/13-ui.md` describes. Registering `ui()` gives a game `app.ui`, `app.i18n`, four components, the `i18n` asset type, the `ui` settings section, and one `PreRender` system at order `1100` — after `@ignifx/core`'s camera synchronisation at `900`, because every projection needs this frame's camera.
  
  **The overlay.** One absolutely positioned `<div>` over the canvas, `pointer-events: none`, holding one `<div>` per named layer at z-index `10`, `20`, `30`… Games mount React, Svelte, Vue or plain DOM into it. Three scaling modes: `"css"` (one UI unit is one CSS pixel), `"fit"` (one reference pixel, letterboxed to keep aspect), and `"dpi"` (one **backing-store** pixel — the space `Camera.worldToScreen`, `HudText` and `captureScreenshot()` all work in, so an element at `left: 100px` lands on render-target column 100). The layout follows the canvas through a `ResizeObserver` and the window's `resize`, and `app.ui.pixelMapping` converts between the two pixel spaces. Safe-area insets are exposed as `--ignifx-safe-*` custom properties.
  
  **Focus routing.** `InputService.uiHasFocus` is a plain settable property whose own documentation says `@ignifx/ui` assigns it, so this package owns the policy and defines it as text entry — `<textarea>`, `<select>`, `contenteditable`, and an `<input>` whose type is not button-like or slider-like — with `data-ignifx-focus="capture"`/`"ignore"` as the override. A focused `<button>` deliberately keeps gameplay running. A press on an interactive UI element never reaches gameplay in the first place, because `@ignifx/input` reads `pointerdown` from the canvas and the overlay is the canvas's sibling; a *drag* still moves `<Pointer>/delta`, and `app.ui.pointerOverUi` is the hook for that until `@ignifx/input` gains a pointing-device equivalent of `uiHasFocus`.
  
  **Text.** `WorldAnchor` keeps a game-supplied DOM element on an entity's screen position, with clamping, behind-camera handling and distance scaling. `HudText`, `WorldText2D` and `WorldText` draw through Babylon Lite's text renderer: pixel-space text anchored to one of nine points of the render target, pixel-space text at an entity's projected position, and a 3D renderable in the scene. Fonts come from core's `FontAsset`. Changing `text` or `color` re-shapes in place; changing `font`, `fontSize`, `maxWidth`, `align` or `lineHeight` rebuilds the block, because Lite's `updateDefaultTextData` reuses the size and layout options the block was created with.
  
  **Helpers.** `Dialog`, `Toast` and `LoadingScreen` are plain DOM classes with one injected stylesheet and `ignifx-ui-*` class hooks; a pause menu is `new Dialog(app.ui, { title, buttons })` plus `app.pause()`, and a boot screen is `new LoadingScreen(app.ui).bindTo(app.assets)`. `VirtualJoystick` and `VirtualButton` write `@ignifx/input`'s virtual device, replacing the widget the 2D templates carried in Phase 6; they reach the device structurally rather than by importing `@ignifx/input`, which is what keeps that peer genuinely optional.
  
  **Localization.** `app.i18n` loads `ignifx.i18n` documents (`.i18n.json`, asset type `i18n`) that carry every locale in one file, with `{name}` interpolation and ICU-style plurals — `=0`-style exact matches, the active locale's CLDR categories through `Intl.PluralRules`, and `#` for the number. A missing key renders as the key; `select`, number and date skeletons and ICU apostrophe quoting are out of scope. All three text components accept an `i18nKey` and re-shape on `onLocaleChanged`.
  
  **Two Babylon Lite limitations, verified against 1.27.0 and documented rather than worked around.** `addTextRenderable` pushes a *deferred* scene builder that only `buildScene` drains, once, when the scene is registered — so a `WorldText` that first gets its text after `app.start()` does not draw and logs `IGX-1308`; `WorldText2D` owns a text layer and has no such restriction. And there is no `removeTextRenderable`: a destroyed `WorldText` empties its block and zeroes its opacity, which draws nothing and frees its GPU buffers, but the record stays in the scene's renderable list until the scene is disposed.
  
  New diagnostic codes: `IGX-1301` a second `ui()`, `IGX-1302` an unreadable `.i18n.json`, `IGX-1303` an undeclared locale, `IGX-1304` an unparseable message, `IGX-1305` a touch widget without `@ignifx/input`, `IGX-1306` a text component with no font, `IGX-1307` a DOM member on a host with no document, `IGX-1308` a `WorldText` built too late for Lite to draw.

### Patch Changes

- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
- Updated dependencies [d349254]
- Updated dependencies [a0625fb]
- Updated dependencies [737ee13]
- Updated dependencies [7be9401]
- Updated dependencies [b511cad]
- Updated dependencies [0e6801c]
- Updated dependencies [d349254]
- Updated dependencies [5bf13be]
- Updated dependencies [5bf13be]
- Updated dependencies [5bf13be]
- Updated dependencies [5bf13be]
- Updated dependencies [5bf13be]
- Updated dependencies [5bf13be]
- Updated dependencies [85b9642]
- Updated dependencies [7ca9efe]
- Updated dependencies [7ca9efe]
- Updated dependencies [7ca9efe]
- Updated dependencies [d049484]
- Updated dependencies [d349254]
- Updated dependencies [9ab633d]
- Updated dependencies [737ee13]
- Updated dependencies [0ea4c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [69b2c56]
- Updated dependencies [4cfb15f]
- Updated dependencies [8947b19]
- Updated dependencies [a3730b2]
- Updated dependencies [8947b19]
- Updated dependencies [c7f3bb1]
- Updated dependencies [a0625fb]
- Updated dependencies [a0625fb]
- Updated dependencies [d349254]
- Updated dependencies [d349254]
- Updated dependencies [b511cad]
- Updated dependencies [1d18250]
  - @ignifx/2d@0.1.0
  - @ignifx/core@0.1.0
  - @ignifx/3d@0.1.0
  - @ignifx/devtools@0.1.0
  - @ignifx/electron@0.1.0
  - @ignifx/physics-2d@0.1.0
  - @ignifx/ui@0.1.0
  - @ignifx/audio@0.1.0
  - @ignifx/input@0.1.0
  - @ignifx/physics@0.1.0
