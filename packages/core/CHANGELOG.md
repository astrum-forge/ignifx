# @ignifx/core

## 0.2.1

### Patch Changes

- 388b0f6: `PostProcessStack` fields are live: a slider bound to `bloom.threshold` now changes the picture
  
  The stack built its chain once, the first time any effect was enabled, and every `sync` after that
  only flipped the chain's `executionEnabled` to match the component. The bloom and SMAA records were
  read at that one moment and never again, so `post.bloom.threshold = 0.4` on a running game did
  nothing — the website's bloom example had four sliders and none of them moved the frame — and
  `post.bloom.enabled = false` on a one-effect chain left bloom running, because the chain's identity
  was checked only while no chain existed yet.
  
  Lite's `BloomPostProcessTask` exposes `weight`, `kernel`, `threshold` and `exposure` as writable
  fields and `updateUniforms()` re-uploads every sub-pass from them; `SmaaPostProcessTask` documents
  the same for `threshold`, `maxSearchSteps`, `diagonalDetection` and `cornerDetection` (verified
  against `@babylonjs/lite@1.27.0`, `index.d.ts` 1287 and 11622). The chain now keeps a typed handle
  to each of those tasks and, once per frame, uploads whatever changed since the last upload — a frame
  in which nothing moved uploads nothing. The one tuning Lite fixes at creation is bloom's
  `bloomScale`, which sizes the blur targets, so `bloom.scale` joins "which effects, in which order"
  in the chain's identity: a change to any of them disposes the old chain and records a new one. Lite
  cannot remove a task from a frame graph, so the old tasks stay in it, disabled and with their GPU
  resources freed, at one branch per frame each — toggling an effect's `enabled` in a settings menu
  costs a rebuild per click, whereas toggling the whole component's `enabled` keeps the chain and
  skips it, which is what the templates' settings screens do.
  
  What a game author sees: an inspector edit, a settings slider or a script write to any bloom or SMAA
  field takes effect on the next frame, and turning a single effect off actually turns it off.
  
  Public API change: none. `PostProcessChain.applySettings` and the two adapter functions it calls are
  `@internal`.

## 0.2.0

### Minor Changes

- c8fb925: `Environment` switches the world's image-based lighting at runtime, and reports a `skybox` it cannot honour
  
  Assigning a different **loaded** `AssetHandle<EnvironmentAsset>` to `Environment.environment` now
  moves the scene onto that asset's own cube map instead of only re-aiming whatever the asset loader
  had installed. Babylon Lite 1.27.0 declares no public way to replace a registered scene's
  environment, so the adapter writes the single field every consumer of it reads — `scene._envTextures`,
  the field `loadEnvironment` assigns and Lite's own device-lost recovery replaces — through
  `installSceneEnvironment` in `src/lite/gpu/environment.ts`, whose header records the `lib/` line
  behind each claim; a browser test pins the name. The diffuse harmonics follow on the next frame and
  the specular reflection one frame later, when the render-sync system fires the frame's one
  `rebuildSceneRenderables` (a PBR bind group holds the cube map's texture view, so only a rebuild
  re-binds it). Installing also re-applies rotation, blur, and image processing, because
  `loadEnvironment` overwrites `scene.imageProcessing` on every load. Both assets keep their GPU
  resources while their handles are retained, so switching back and forth is free. Assigning `null`
  means "stop steering", not "go dark": Lite has no inverse of `loadEnvironment`, so the last
  installed environment keeps lighting the scene and `Environment.installed` keeps naming it.
  
  `Environment.skybox` is now read every frame, but it still cannot change the background, and that is
  Lite's shape rather than an oversight: Lite builds the background inside `loadEnvironment`, as a
  `Renderable` with no visibility flag, no size, and no handle, queued in the scene's deferred
  builders and drained only by `registerScene`. So the `.environment.json` stays the authority, a
  `skybox` record *set* to something the installed environment did not deliver logs the new
  `IGX-0711` once per component instead of being silently ignored — a field still at its schema default
  reports nothing — and an environment loaded after `app.start()` gets no background at all. A
  declaration that enables a skybox and names no image now passes the `.env` as its own `skyboxUrl`,
  which selects Lite's HDR cube background over the flat box painted in a snapshot of the clear
  colour — so a bare `.env` finally draws a real background. A world that switches environments at
  runtime wants `skyboxEnabled: false` and an `Environment.clearColor`.
  
  New public API: `EnvironmentSkyboxSettings` (the named type of the `skybox` record) and
  `CoreErrorCode.skyboxFixedAtLoad` (`IGX-0711`).

### Patch Changes

- c8fb925: `IGX-0706` is not logged when another rendering context draws the frame through a camera of its own
  
  A world with a `Camera2D` and no 3D `Camera` is a correct `@ignifx/2d` `"sprite"`-mode scene, and
  the render-sync system warned at it once per world: "this world has no enabled camera, so nothing is
  drawn", of which the second half was false. `Renderer` gains an `@internal` `addCameraSource(probe)`
  — returning a `Disconnect` — that an extension owning a second rendering context on the same surface
  calls from `register`; the sync system asks the registered probes only in a frame where no enabled
  `Camera` was found, so a well-formed 3D scene pays nothing. A claim also clears the once-only latch,
  so the sequence "app starts on an empty world, the 2D camera arrives, the 2D camera is destroyed"
  warns exactly as the same sequence does for a `Camera`.
  
  No public API change: the new member is `@internal`.

## 0.1.0

### Minor Changes

- 737ee13: Script and scene hot reload (`app.hotReload`)
  
  `app.hotReload.apply(modules)` swaps script classes in a running game, matching each replacement to the class registered under its `typeId`. The default `"patch"` policy swaps live instances' prototypes: the objects, their field values, and their running coroutines survive, no lifecycle callback re-runs, and the statics are re-read, so a changed `executionOrder` reorders dispatch. `static hotReload = "recreate"` instead serializes each instance through its schema, destroys it (`onDisable`/`onDestroy`), and rebuilds it from the new class with the same uid and the same position on the entity, so `awake`/`onEnable`/`start` run again and tracked references find the replacement. A `"patch"` class whose schema *shape* changed is re-created anyway, with an `IGX-0207` warning. `static onHotReload(previous)` runs once on the new class for class-level migration. `apply` is a flush-time operation and refuses to run inside a lifecycle callback (`IGX-0208`).
  
  `app.hotReload.reloadScene(instance)` rebuilds one scene instance from its asset's current value (`IGX-1506` when it has none), and `createApp({ hotReload: { reloadScenes: true } })` does it automatically whenever a scene file is replaced. Everything works headlessly with no bundler, which is how it is tested. `ComponentRegistry.replace(type)` is the additive registry primitive behind it.
- b511cad: `app.platform` and `app.storage`
  
  `app.platform` answers the whole of `docs/architecture/14-platform-electron.md` §1 rather than just `kind`: `os`, `isMobile`, `hasPointerLock`, `hasGamepads`, `locale`, `reducedMotion`, and `webgpu` (`{ adapterInfo, features, limits }`, `null` in a headless app and on a host without WebGPU). `kind` gained `"electron"`, which `@ignifx/electron`'s renderer extension sets through the `@internal` `platformInternals(app.platform).setKind(…)`. Detection is split into a host scrape and a pure interpretation, so every operating-system and mobile heuristic is unit-tested without a browser. The record is no longer frozen.
  
  `app.storage` is new: `get`, `set`, `delete`, `keys(prefix?)`, and `namespace(name)`, asynchronous on every backend. Values are JSON — with numbers canonicalized the way scene files canonicalize them, so two saves of the same state are byte-identical — or bytes, from a `Blob`, an `ArrayBuffer`, or any typed array, which read back as a `Uint8Array`. A namespace is a backend scope rather than a key prefix, so `namespace("saves")` cannot see the root's keys or a sibling's. Three backends ship: `IndexedDbStorageBackend` (the browser default, one `ignifx` database and one `values` store keyed `[namespace, key]`), `MemoryStorageBackend` (the headless default), and `createFileStorageBackend({ directory })` (a directory tree, written atomically through a temporary file and a rename, with a key encoding that survives `/`, `..`, Windows device names, and case-insensitive file systems). `createApp({ storage })` takes a backend or `{ directory }`, and `StorageBackend` is the contract `@ignifx/electron`'s file-system backend implements.
  
  New codes: `IGX-1421` (invalid namespace), `IGX-1422` (invalid key), `IGX-1423` (value with no JSON form), `IGX-1424` (out of quota), `IGX-1425` (backend failure), `IGX-1426` (unreadable stored value).
- 0e6801c: `app.renderer.surface`
  
  The renderer exposes the canvas the app draws into as `surface` (`RenderSurface | null`; `null` under a headless app), so an extension that adds a second rendering context — `@ignifx/2d`'s sprite renderer — can create it on the app's surface without reaching through `app.lite.engine`.
- d349254: Core: `app.tweens`
  
  `docs/architecture/12-3d-toolkit.md` §4 puts tweening in the kernel, because both toolkits use it and because a tween is a clock consumer like any other. `app.tweens.to(target, props, options)` moves any object's numeric, `Vec2`, `Vec3`, or `Quat` fields over time and hands back a `Tween`.
  
  **What it does.** Component-wise interpolation for vectors, shortest-arc slerp for quaternions, and a plain lerp for numbers. `duration`, `ease`, `delay`, `loop` (extra cycles; `-1` forever), `yoyo`, `updateWhenPaused`, and `onComplete`. Easing is a name from `EASING_NAMES` — `linear`, `quadIn/Out/InOut`, `cubicIn/Out/InOut`, `sineInOut`, `backOut`, `elasticOut`, `bounceOut` — or a custom `(t: number) => number`. The handle carries `pause`/`resume`/`stop`/`complete`, `progress`, `isPlaying`/`isPaused`/`isDone`, and an `onComplete` signal alongside the callback; `stop` leaves the value where it stands and never completes, `complete` jumps to the end and fires.
  
  **Where it runs.** A `PostUpdate` system at order `-100`, ahead of `@ignifx/2d`'s sprite clock (`0`) and `@ignifx/3d`'s `Animator` (`10`), so a tween driving an animation parameter is read in the same frame it is written. It advances on `time.deltaTime`, so `time.timeScale` slows it and `app.pause()` freezes it; a tween created with `updateWhenPaused: true` runs on `time.unscaledDeltaTime` instead. Every tween dies with the app.
  
  **Two details that make it behave.** Endpoints are latched when the tween's delay elapses rather than when it is created, so two tweens queued on one property chain instead of fighting. And a channel decides once, from a property descriptor, whether writing means mutating the value in place (`Transform.localPosition` hands back the live vector) or assigning back through a setter (`Transform.position` hands back a copy) — which is why both work.
  
  New codes: `IGX-0109` (a tween option outside its domain) and `IGX-0110` (a field that is not tweenable, or not writable).
- 5bf13be: API review: the render name tables are `@public`, the duplicate alpha-mode spellings are gone, and
  `Quat`'s radian helpers use the abbreviation the coding standard prescribes
  
  **Breaking.**
  
  - `MaterialAlphaModeName` is removed. It was a bare alias of `MaterialAlphaMode`, which the barrel
    already exported; use `MaterialAlphaMode`.
  - `MATERIAL_ALPHA_MODE_NAMES` is removed. It was a re-typing of `MATERIAL_ALPHA_MODES`, which the
    barrel already exported and which now carries the same `@public` tag; use `MATERIAL_ALPHA_MODES`.
  - `Quat.fromEulerRadians`, `Quat.fromEulerRadiansToRef` and `Quat.toEulerRadiansToRef` are renamed to
    `Quat.fromEulerRad`, `Quat.fromEulerRadToRef` and `Quat.toEulerRadToRef`, and their `xRadians`,
    `yRadians`, `zRadians` parameters to `xRad`, `yRad`, `zRad`. `docs/standards/coding-standards.md`
    §5.1's units row gives `fromEulerRad` as its own literal example of the rule; the shipped names
    spelled the unit out instead. The degree-taking `Quat.fromEuler`/`fromEulerToRef`/`toEulerToRef`
    are unchanged.
  - `isValidLayer` is no longer exported from the barrel. It is `@internal`, nothing outside
    `@ignifx/core` used it, and `packages/ignifx` re-exported it into the umbrella's public surface.
    Layer names and indices are validated by `LayerTable`.
  
  **Changed.** `MATERIAL_ALPHA_MODES`, `MaterialAlphaMode`, `SHADOW_TECHNIQUES` and
  `TONE_MAPPING_NAMES` are `@public`. All four were already exported from the barrel and from the
  umbrella, and three public types are derived from them (`MaterialAlphaMode`, `ShadowTechniqueName`,
  `ToneMappingCurve`), so API Extractor reported five `ae-incompatible-release-tags` /
  `ae-internal-missing-underscore` contradictions on a surface that was public in fact. The seven
  sibling tables in `src/render/**` (`LIGHT_TYPES`, `MATERIAL_KINDS`, `CANVAS_ALPHA_MODES`,
  `PROJECTIONS`, `FOG_MODE_NAMES`, `EASING_NAMES`, `TWEEN_VALUE_KINDS`) were already `@public`.
  Nothing about the values, the derived unions or the runtime changed.
- 7ca9efe: A `PostProcessStack` configured before `app.start()` now works, `Diagnostics` gains
  `groupOrRegister`, and Lite's error table and glTF parser leave the entry chunk
  
  **Fixed.** Enabling `bloom` (or any effect) on a `PostProcessStack` **before** `app.start()` used to
  present a black page: the chain recorded its first frame-graph task immediately, and at that point
  the offscreen scene colour it samples had never been built, so Lite raised error 107 —
  `PostProcessTask "ignifx:bloom-extract-highlights": sourceTexture has no color texture` — and WebGPU
  rejected the whole frame. A chain built before the scene is registered now only appends its tasks;
  `registerScene`'s own `frameGraph.build()` records them, in array order, after the scene task that
  allocates the colour. Configuring a stack before or after `start()` reaches the same first frame.
  
  **Added.** `app.diagnostics.groupOrRegister(name, counterNames)` returns an existing counter group or
  registers it. `registerGroup` throws `IGX-1503` on a duplicate, which is right for an extension that
  registers once and wrong for a script whose `awake` runs per instance and again after a scene
  reload; `group(name) ?? registerGroup(name, …)` had to be written out at every call site. When the
  group already exists it comes back exactly as first registered and the new `counterNames` are
  ignored, because counters are indexed and renumbering them under a live subsystem would corrupt
  its readings.
  
  **Changed (bundle).** Two things that every build carried and few builds use are now behind dynamic
  imports: Babylon Lite's 43 KB error-message table, which `enableErrorDecoding` pulled into the entry
  chunk of every build because `createApp`'s `mode` defaults to `"development"`, and Lite's glTF
  parser, which the always-registered `model` loader pulled in even for a game that loads no model.
  Both call sites were already asynchronous. Measured on `examples/hello-cube`, the entry chunk fell
  from 284,181 to 268,634 gzipped bytes (−15,547, −5.5%) with the total over all chunks unchanged.
  
  **Documentation.** `FrameSample.cpuMs` and `createApp`'s `mode` no longer claim the Vite plugin sets
  the build mode: nothing does, `mode` defaults to `"development"` in a production `vite build` too,
  and a project that wants production behaviour passes `mode` itself. `Logger`'s example no longer
  suggests a message interpolates `{placeholder}` tokens — it does not, and they print verbatim.
  Phase-era "arrives in Phase N" notes for work that either shipped (scene loading, layer masks, the
  3D animator) or was never implemented (shader materials, PBR extensions) now describe what the build
  actually does.
- 9ab633d: Phase 1 kernel: the ignifx runtime core
  
  `@ignifx/core` now ships the engine kernel, and the `ignifx` umbrella re-exports all of it: `createApp` with the `App` contract (start/stop/pause/resume/dispose, headless `step`, services, frozen project settings, `onError`, diagnostics, logging, platform info) and the extension host (`Extension`, `ExtensionContext`, `defineExtension`, `coreExtension`, topologically ordered registration with engine-range checks, services, app-property definition, settings sections, error-code registration); `Time`, the six-phase scheduler with its fixed-timestep loop, lifecycle flushes, destroy queue, and generator coroutines (`waitSeconds`, `waitSecondsRealtime`, `waitFixedUpdate`, `waitUntil`, `waitWhile`); `World`, `SceneInstance`, `Entity`, `Transform`, `Component`, `Script`, the `ScriptCallbacks`/`ComponentHooks` signature interfaces, `Component.define`/`Script.define` with the full schema field-kind set, component registration and `typeId`s, `Signal`, `TagSet`, `LayerTable`/`LayerMask`; the math module (`Vec2`, `Vec3`, `Vec4`, `Quat`, `Mat4`, `Color`, scalar helpers) with allocation-free `ToRef` variants structurally compatible with Babylon Lite's interfaces; and `IgnifxError` with the `IGX-####` code space (`CoreErrorCode`, `ErrorRange`). Documentation lands with it: the entry Agent Skill documents `createApp`, `Entity`, `Script`, `Time`, and `Signal` with examples the harness compiles, plus concept references for the lifecycle, scene graph, scripting, and extensions, and a gotcha list. Component and script statics (`typeId`, `schema`, `requires`, `allowMultiple`, `executionOrder`, `updateWhenPaused`) are declared structurally on the new `ComponentStatics`/`ScriptStatics` interfaces rather than on the `Component`/`Script` classes, so a subclass writes a plain `static typeId = "mygame/Mover"` with no `override` modifier under `noImplicitOverride`; `ComponentRegistry` reads each one once per class and supplies the defaults.
  
  **Breaking**
  
  The Phase 0 toolchain-spike API is removed: `createHeadlessRuntime`, `createRenderEngine`, and the other spike exports no longer exist. Use `createApp({ headless: true })` for a GPU-free app driven by `app.step(dt)`, and `createApp({ canvas })` for a rendering app started with `await app.start()`. Pre-1.0 breaking changes ship without a deprecation window (`CONSTITUTION.md` §4.2).
- 0ea4c56: Fixes from the Phase 11 skill evaluation
  
  - `SceneAssetToken` lets a script declare a scene or prefab field with `asset(SceneAssetToken)`; `AssetTypeToken.prototype` is optional so a plain token can name an asset that has no class. Previously a prefab handle could only be held as an untyped property.
  - `create-ignifx` skips `out/`, `release/` and `coverage/` (desktop build output) at every depth and skips symlinks instead of following them; a template checkout that had been built used to be copied wholesale and to crash on the packaged Electron app's framework links.
- 69b2c56: Phase 2: the Babylon Lite render adapter
  
  `@ignifx/core` grows the adapter layer the render components sit on (`docs/architecture/07-rendering.md`, ADR-0002 Validation). It is `@internal` throughout — nothing here is public API yet — and it is split in two: `src/lite/**` for the parts the null engine can run (cameras, lights, shadow settings, materials, CPU ray picking, screenshot sampling, feature opt-ins, engine option mapping) and `src/lite/gpu/**` for the parts that need a WebGPU device (meshes, textures, environments, glTF, post-processing, the GPU picker, frame capture, device-loss recovery, shadow generators, material warm-up, GPU timing).
  
  Spikes S2.1–S2.3 are retired with pixel proofs in Chromium: a `FreeCamera` parented under an entity node moves the rendered image with the node, the orthographic toggle and the y-flipping viewport mapping behave as the numeric tests predict, a PCF directional generator darkens the ground where a caster blocks the light, and a forced device loss recovers to a byte-identical frame. S2.2 measured frames-to-visible for a mesh added after `registerScene` — three extra frames for a cold material family, zero to two for a warmed one — which is what ADR-0014 proposes a default warm-up policy for. S2.4's "instancing shares GPU buffers" is proved structurally: clones hold the identical `_gpu` wrapper and bump its reference count.
  
  Two error codes are added: `IGX-0703` (shadows requested from a light kind Lite cannot shadow) and `IGX-0704` (a rendering feature toggled after the scene was registered — Lite accepts a late opt-in silently, so ignifx has to refuse it itself).
- 69b2c56: Phase 2: the render components, the GPU assets, and the rendering settings
  
  `@ignifx/core` grows the public rendering surface `docs/architecture/07-rendering.md` describes, on top of the Phase 2 adapter.
  
  Components: `Camera` (perspective and orthographic, priority-based selection, `screenToRay`/`worldToScreen`), `Light` (directional, point, spot, hemispheric, with the shadow declaration ADR-0002 validated), `MeshRenderer` (a `MeshAsset` plus materials, layers, casting, picking), `Model` (a loaded `ModelAsset` instantiated under the entity, with a node map and `attachToNode`), `Environment` (image-based lighting, skybox, fog, clear colour, tone mapping) and `PostProcessStack` (bloom, SMAA, image processing, recorded as one frame-graph chain).
  
  Assets: `MeshAsset` with the primitive factories, `ModelAsset`, `TextureAsset`, `MaterialAsset` (PBR and Standard, plus the `ignifx.material` file format), `EnvironmentAsset` (plus the `ignifx.environment` description) and `FontAsset`, each behind a GPU loader the core extension registers. `Assets.register` publishes an in-code asset at a `memory:` address so an `asset()` field can hold one without a file, and an `asset()` field now decodes to a **loaded `AssetHandle`** rather than to an address record.
  
  Services and settings: `app.renderer` (screenshots, GPU picking, resolution scale, frame and task timings, the default material), `world.mainCamera`, `world.raycastRender`, the `rendering` settings section (`msaaSamples`, `alphaMode`, `srgb`, `format`, `maxDevicePixelRatio`, `useHighPrecisionMatrix`, `useFloatingOrigin`, `requiredLimits`, `clearColor`, `brdfLut`, and the `features` opt-ins), the `PreRender` render-sync system, ADR-0014's boot warm-up, and device-loss recovery fanned out to `app.events`.
  
  Five error codes are added: `IGX-0705` (two enabled `Environment` components), `IGX-0706` (no enabled camera), `IGX-0707` (a screenshot was asked for with no render loop running), `IGX-0708` (a material file names a family this build cannot construct) and `IGX-0709` (a file is not the ignifx description format it claims).
- 69b2c56: Phase 2: fix the two rendering defects the visual golden suite found
  
  **Breaking.** A `PostProcessStack` now needs `rendering.features.postProcessing`, and a `Light` no longer parents its Babylon Lite light under the entity's node.
  
  The Phase 2 visual suite (`tests/visual/`) rendered the exit-criterion scenes on SwiftShader and compared them against committed images. It found two defects that every existing test had missed, both because those tests asserted that the image _changed_ rather than what it changed **to** (ADR-0002, "Corrections after the visual suite").
  
  **A post-process chain presented a black frame.** The chain's first effect sampled the swapchain, which Babylon Lite configures with no `usage` — `RENDER_ATTACHMENT` only — so the bind group failed validation and Chromium rejected the whole frame. Post-processing is now a declared rendering feature, `postProcessing`, because the fix picks the scene's whole frame graph and that is decided at `createSceneContext`: with it on, the scene renders into an offscreen colour target and a copy task composites it onto the swapchain, a chain reads that offscreen target, and its last effect writes the swapchain, at which point the copy is switched off. Every target is sized by the surface, so a canvas resize is handled by the frame-graph rebuild Lite already does — the old chain was sized once and could not follow a resize at all. `imageProcessing` is always recorded last, whatever `order` says, because Lite's grading pass writes the swapchain and hands nothing on. A stack attached without the feature logs the new `IGX-0710` once and is inert.
  
  **A shadow-casting light shaded from the wrong direction and cast nothing.** Lite composes a light's world matrix as `parentWorld × localMatrixFromDirection(direction, position)` and the shader reads that matrix, while the shadow frustum is fitted from `direction`/`position` directly — so parenting the light and also writing a world direction onto it applied the entity's rotation twice. ignifx no longer parents a Lite light: the adapter creates every kind unparented and the component writes the entity's world pose onto the light's own observables each frame it moves — the forward axis for a directional or spot light, the **up** axis for a hemispheric light's sky direction, and the position for anything that has one. That write is also the "this light moved" nudge the lights uniform buffer needs.
  
  The regression tests are the assertions the old ones were missing: brightness and direction rather than difference, at MSAA 1 and 4 and across a canvas resize, plus named-band sampling that proves which hemisphere of a ball a light lights and that turning its entity 180 degrees swaps it.
  
  **A `Model` cast no shadow and received none.** `Model` declared `castShadows` and `receiveShadows` and applied neither — the render-sync system's caster rebuild walked only `MeshRenderer`s — so an instantiated glTF never reached a shadow generator's caster list and the glTF viewer's floor was a shadow catcher with nothing to catch. A model's cloned subtree is now walked once, at instantiation, and every mesh in it casts into `setShadowTaskCasterMeshes` while `castShadows` is on and carries Lite's per-mesh `receiveShadows`. Destroying a model raises the renderer's caster-rebuild flag, because a destroyed component has left the world's list before the next reconciliation and cannot report the change itself. The caster lists are also held until the frame's pending `rebuildSceneRenderables` has resolved: Lite's shadow task looks each caster material's build group up in the scene and throws inside the frame when it is not there yet, which is exactly what a caster added at runtime — a `Model` whose glTF has just settled — would otherwise hit.
  
  **`rendering.clearColor` was never applied.** The settings section declared a clear colour and nothing read it, so a project that named one — and left `Camera.clearColor` at `null` with no `Environment` — got Babylon Lite's mid grey. It is now written onto the render scene as the scene is created, which fixes the precedence in place: `Camera.clearColor` on the main camera (written every frame) beats `Environment.clearColor` (written when it changes) beats the setting (written once) beats Lite's default. Every one of them is sRGB and is decoded to linear by the single writer they now share.
- 69b2c56: Phase 2: the asset service, the scene format, and the Agent Skill that documents them
  
  `@ignifx/core` gains the runtime half of the asset pipeline (`docs/architecture/05-assets-and-loading.md`). `app.assets` resolves addresses through the manifest `@ignifx/vite-plugin` generates, answers `load`/`loadAsync`/`loadAll`/`preloadGroup` with reference-counted `AssetHandle`s (`state`, `value`, `promise`, `progress`, `error`, `refCount`, `retain`, `release`, `[Symbol.dispose]`, `onReplaced`), schedules fetches through a priority queue with a concurrency limit and retries, cancels them through an `AbortSignal`, and collects zero-reference assets after `gcDelay`. Completed loads are delivered by one `PreUpdate` system, so a handle's state flips and its promise settles at exactly one point per frame. `Assets.register` publishes an in-code value at a `memory:` address, `AssetLoader`/`LoaderContext` is the extension-facing contract behind `ctx.registerAssetType`/`ctx.registerAssetLoader`, and `binaryAssetLoader`, `jsonAssetLoader`, and `textAssetLoader` ship with the core extension beside the GPU loaders.
  
  Serialization is complete for the `ignifx.scene` format (`06-serialization-and-scene-format.md`, ADR-0005): `SceneFile` and its entity, component, transform, instance, and override records; `serializeScene`, `serializeEntity`, `serializeComponent`, `stringifySceneFile`, `validateSceneFile`, `computeSceneHash`, `sceneFileJsonSchema`, `parseOverridePath`, `UidRemap`, `createSceneAsset`, `createSceneLoader`, `instantiateScene`, and `assertSceneDependenciesLoaded`. The world drives them through `loadScene` (single or additive, cancellable, with progress), `unloadScene`, `instantiate`, `instantiateAsync`, and `moveEntityToScene`; `SceneInstance` now carries the `AssetHandle<SceneAsset>` it was built from and its uid remap. `app.events` joins `App` as the engine-wide signal table — `onSceneLoaded`, `onSceneUnloaded`, `onDeviceLost`, `onDeviceRecovered`, `onDeviceRecoveryFailed`.
  
  Documentation lands with it. The entry Agent Skill documents the render components, the mesh and material factories, `app.assets`, scene and prefab loading, `app.renderer`, and the `rendering` and `assets` settings sections, with examples the harness compiles; there is a new `references/concepts/rendering.md`, a rewritten `assets.md`, hand-written `references/formats/scene.md` and `material.md` beside the generated tables, the first two generated recipes ("load a model", "spawn a prefab") extracted from `examples/recipes/`, and seventeen new gotchas covering the feature opt-ins, runtime material warm-up, handle ownership, and colour encoding.
  
  **Breaking**
  
  - `asset(TypeToken)` fields now hold `AssetHandle<A> | null` at runtime instead of `AssetRefValue<A> | null`. Read `field.value` for the asset and `field.address` for the address; the file encoding, `{ "$asset": "<address>" }`, is unchanged.
  - `CoreErrorCode.cryptoUnavailable` moved from `IGX-1401` to `IGX-1420`. `IGX-1401`–`IGX-1419` belong to `@ignifx/cli` (`docs/architecture/00-overview.md` §2), so the kernel's code was in the wrong half of the platform range.
  - `SceneInstance.asset` is typed `AssetHandle<SceneAsset> | null` rather than `null`, so code that relied on it narrowing to `null` no longer compiles.
  
  Pre-1.0 breaking changes ship without a deprecation window (`CONSTITUTION.md` §4.2).
- a3730b2: Kernel hooks for physics extensions
  
  `ExtensionContext` gains three `@beta` members for extension authors, so that `@ignifx/physics` can be written without reaching into core's internals (`docs/architecture/04-extensions.md` §1, §3, `09-physics.md` §1, §2.1, §4):
  
  - `dispatchScriptCallback(entity, kind, argument)` delivers one physics callback — `PhysicsCallbackName` is `"onCollisionEnter" | "onCollisionStay" | "onCollisionExit" | "onTriggerEnter" | "onTriggerExit"` — to every effectively-enabled `Script` on an entity that implements it, in component order, through the same guarded call site the frame loop uses. Systems still never call script callbacks themselves (`03-scripting-and-components.md` §6). A handler that throws is reported to `app.onError` with `source: "lifecycle"` and the running phase, and the remaining scripts still receive the callback; a destroyed or inactive entity receives nothing; nothing is allocated per call. Calling it outside the fixed loop throws `IGX-0409` in development and delivers anyway in production.
  - `entityImplements(entity, kind)` answers whether any script on an entity implements a physics callback, ignoring `enabled` so that `Rigidbody.collisionEvents` auto-detection only changes when a component is added or removed. The general form is public on the registry as `ComponentRegistry.implementsCallback(type, kind)`, reading the bit mask the registry computes once per class.
  - `setSimulationScene(scene)` publishes the scene an extension simulates in as `world.lite.simulationScene`, and `null` clears it. Handing a world a second, different simulation scene throws `IGX-0410`.
  
  `Entity` gains `onComponentAdded` and `onComponentRemoved` (`@public`), the missing piece an extension needs to learn that an entity's component set changed: `onComponentAdded` emits synchronously at the end of `addComponent`, after the component's `onAttach`; `onComponentRemoved` emits in the destroy flush once the component has left `entity.components`. Both are created lazily on first access and are owner-safe, so an entity that nothing observes pays nothing.
  
  `World.lite` now returns a stable `WorldLiteHandles` object updated in place instead of a fresh literal per read, so the escape hatch allocates nothing per frame, and its `simulationScene` is typed `LiteScene | null`. `ScriptCallbackKind` and `PhysicsCallbackName` are exported from the package entry point.

### Patch Changes

- a0625fb: `defineExtension` factories see `undefined`
  
  `defineExtension`'s factory parameter is typed `(options: O | undefined) => Extension`, which is what the caller can actually pass; the unsafe cast is gone. Factories written as `(options = {}) => …` are unchanged; a factory that read `options.x` without a default now fails to typecheck instead of throwing at runtime.
- 7be9401: Asset loads settle while the app is not running
  
  Before `app.start()` and after `app.stop()` there is no frame to deliver a completed load in, so `app.assets` now delivers it as soon as it finishes: a game can `await` its preloads and then start, and a headless test can `await` a handle without stepping. Once the loop runs, delivery stays in `PreUpdate`, as before. Retry backoff before `start()` runs on the wall clock. An abort during a retry backoff now cancels the retry and fails the handle with `IGX-0502`; previously the next attempt ran anyway.
- 8947b19: Kernel and build fixes surfaced by Phase 4
  
  - `ExtensionContext.setSimulationScene(null)` is a no-op while the app is being disposed. `App.dispose()` disposes the world before the extensions, and `World.dispose()` has already dropped the scene, so a clear from an extension's `dispose` — which the hook's own documentation recommends — used to throw `IGX-0106`.
  - `ignifx.assets.public` entries that begin with `node_modules/` are resolved through the extension's own `node_modules` and then each ancestor directory, so a dependency's file (Havok's `.wasm`, declared by `@ignifx/physics`) is found under a hoisting package manager as well as under pnpm.
- 1d18250: Publishing metadata: every package now declares `repository`, and provenance is off while the source repository is private
  
  Each manifest gains the `repository` field (`git+https://github.com/astrum-forge/ignifx.git` with the package's `directory`), which is what npm shows on a package page and what it matches a Trusted Publisher and a provenance attestation against.
  
  `publishConfig.provenance` is `false` rather than `true`. npm has not generated provenance from a private source repository since 2023-07-25, and npm Trusted Publishing — which the release workflow uses, and which normally produces an attestation with no flag at all — does not change that. `astrum-forge/ignifx` is private today, so a publish with provenance requested cannot succeed. Making the repository public is what restores it; nothing else has to change. The deviation from `CONSTITUTION.md` §9.4 is recorded in `docs/adr/0009-monorepo-tooling.md`.
  
  No runtime code changed.
