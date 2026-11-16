---
name: ignifx
description: Builds 2D and 3D web games with the ignifx TypeScript game engine (WebGPU-only, Babylon Lite based, browser and Electron). Use when creating or editing ignifx apps, entities, scripts, scenes, prefabs, assets, input actions, physics, audio, sprites, or tilemaps, or when the user mentions ignifx, @ignifx packages, createApp, Script lifecycle, or ignifx scene JSON.
license: Apache-2.0
metadata:
  ignifx-version: "0.21.0"
  babylon-lite-version: "1.34.0"
---

# ignifx

## What this is / when to use

ignifx is a code-first TypeScript game engine for browsers and Electron. It renders exclusively
through WebGPU via Babylon Lite (`@babylonjs/lite`), and it is designed for indie 2D (top-down,
side-scrolling) and 3D (third-person, first-person) games. Use this skill whenever you write or
modify code, scenes, or assets for an ignifx project. This page covers the kernel in `@ignifx/core`: the
app and frame loop, entities, transforms, components, scripts, schemas, coroutines, signals,
rendering, assets, scenes and prefabs, and custom shaders. Input, physics, audio, the 2D and 3D
toolkits, UI, particles, terrain, Electron, devtools and the editor host are extensions, each with
its own skill (see "Adding extensions").

## Environment

| Item | Value |
| --- | --- |
| Engine version | the `ignifx-version` in this file's frontmatter, shared by `@ignifx/core`, every extension under "Adding extensions", the tools `@ignifx/vite-plugin` and `@ignifx/cli`, and the `ignifx` umbrella |
| Babylon Lite | 1.34.0 (pinned; do not call Lite APIs directly outside adapter code) |
| Node / pnpm | 24 LTS / 11 |
| Browser requirement | WebGPU (Chrome/Edge 113+, Safari 26+, Firefox 141+ Windows / 145+ Apple Silicon); Electron needs `--enable-unsafe-webgpu` (handled by `@ignifx/electron`) |
| Headless | Node 24, no GPU: `createApp({ headless: true })` plus `app.step(dt)` |
| Build | Vite 8 with `ignifx()` from `@ignifx/vite-plugin`: asset manifest, `.meta.json` sidecars, JSON validation, HMR |
| New project | `npx --package=@ignifx/cli create-ignifx <dir> [--template <name>] [--desktop]`; templates `2d-topdown` (default), `2d-sidescroller`, `3d-third-person`, `3d-first-person` |
| Project commands | A scaffolded project has `pnpm dev`, `pnpm build`, `pnpm preview` and `pnpm typecheck`; `--desktop` adds `pnpm dev:desktop`, `pnpm build:desktop` and `pnpm dist:desktop`. It has no test script |
| Skill scripts | In `scripts/` beside this file, run with `node`: `check-webgpu.mjs`, `new-script.mjs <Name>` ([`scripts/README.md`](scripts/README.md)) |

## Mental model

```
App (createApp) ─ owns ─▶ World ─ owns ─▶ SceneInstance* ─ owns ─▶ Entity* ─ has ─▶ Transform + Component*
       │                                                                            └─ Script = Component with lifecycle callbacks
       ├─ assets  (addresses ─▶ AssetHandle<T>, reference counted)
       └─ renderer (surface, features, warm-up, picking, screenshots)

Frame: PreUpdate (asset delivery) → awake/onEnable → [fixedUpdate × N] → start → update → coroutines
       → PostUpdate → lateUpdate → destroy flush → PreRender (render sync) → render
```

- One obvious way per task; no globals: reach everything from `this.app`, `this.world`, `this.entity`.
- Units: metres, seconds, degrees. Left-handed, Y up, +Z forward. 2D is Y up with pixels-per-unit.
- Unity mapping: GameObject → `Entity`, MonoBehaviour → `Script`, prefab → instanced scene. Godot
  mapping: Node → `Entity`, PackedScene → scene asset, signal → `Signal`.
- Every phase runs every frame; only the fixed loop and the three script update callbacks pause.

## First app

A camera, a shadow-casting light, a ground plane, and a spinning PBR cube. `createApp` resolves once
the WebGPU engine and every extension are ready; `app.start()` hands the frame loop to Babylon Lite.

```ts
import {
  Camera,
  Light,
  MeshAsset,
  MeshRenderer,
  Script,
  createApp,
  createMaterialAsset,
  f32,
  pbrMaterialDefinition,
} from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

class Spinner extends Script.define({ speed: f32(90) }) implements ScriptCallbacks {
  static typeId = "demo/Spinner"; // `speed` is a serialized field, degrees per second

  update(dt: number): void {
    this.transform.rotate({ x: 0, y: this.speed * dt, z: 0 });
  }
}

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx needs a <canvas> element on the page.");
}

// Shadows are a Babylon Lite opt-in, declared before the scene is registered (IGX-0704).
const app = await createApp({ canvas, settings: { rendering: { features: { shadows: true } } } });
app.registerComponents([Spinner]);

const eye = app.world.createEntity("Main Camera");
eye.transform.localPosition.set(0, 2.5, -4.5);
eye.transform.lookAt({ x: 0, y: 0.6, z: 0 });
eye.addComponent(Camera, { fov: 55, far: 100 });
const sun = app.world.createEntity("Sun");
sun.transform.localPosition.set(3, 6, -2);
sun.transform.lookAt({ x: 0, y: 0, z: 0 });
const light = sun.addComponent(Light, { type: "directional", intensity: 3 });
light.shadows.enabled = true;
const ground = app.world.createEntity("Ground");
ground.addComponent(MeshRenderer, {
  mesh: MeshAsset.ground(app, { width: 20, height: 20 }),
  castShadows: false,
});
const ember = createMaterialAsset(
  app,
  pbrMaterialDefinition({ name: "ember", baseColor: { r: 0.93, g: 0.42, b: 0.16, a: 1 }, roughness: 0.35 }),
  [],
);
const cube = app.world.createEntity("Cube");
cube.transform.localPosition.set(0, 0.65, 0);
cube.addComponent(MeshRenderer, { mesh: MeshAsset.box(app, { size: 1.3 }), materials: [ember] });
cube.addComponent(Spinner, { speed: 120 });
await app.start();
```

Without a GPU — how tests and tools run it — `createApp({ headless: true, clock: createManualClock() })`, then `app.step(1 / 60)` per frame and `app.dispose()`; the extensions example below is exactly that shape. Pump frames rather than stepping a big delta (`app.step(dt)` is clamped by `time.maximumDeltaTime`, `0.1` s), and expect one `IGX-0706` warning from a world with no `Camera` — harmless headless, and `logLevel: "error"` silences it.

### Adding extensions

Extensions register in `createApp({ extensions })`; each adds an `app.<name>` service, components, asset types and a settings section. `ignifx` re-exports `@ignifx/core` and all of them but `@ignifx/editor-host`. Headless apps drive input with `simulate` and advance audio playback by the frame delta, so both are testable without a device.

**Each extension package ships its own skill** with the detail, at `skills/<name>/SKILL.md` inside the package, where `<name>` is the package name without `@ignifx/`: `node_modules/@ignifx/<name>/skills/<name>/SKILL.md` in an installed project, `packages/<name>/skills/<name>/SKILL.md` in the engine repository. Read it before using the extension.

| Package (factory) | Adds |
| --- | --- |
| `@ignifx/input` (`input()`) | `app.input`: action maps, bindings, `PlayerInput`, rebinding |
| `@ignifx/audio` (`audio()`) | `app.audio`: buses, `AudioSource`, `AudioListener`, `MusicPlayer` |
| `@ignifx/physics` (`physics()`) | `app.physics`: 3D bodies, colliders, `CharacterController`, queries (Havok) |
| `@ignifx/physics-2d` (`physics2d()`) | `app.physics2d`: 2D bodies, colliders, `CharacterController2D`, queries (Rapier) |
| `@ignifx/2d` (`twoD()`) | `app.twoD`: sprites, atlases, tilemaps, sorting layers, `Camera2D` |
| `@ignifx/3d` (`threeD()`) | `app.navigation`, character controllers, `ThirdPersonCamera`, `Animator`, `LodGroup`; needs `physics()` and `input()` |
| `@ignifx/ui` (`ui()`) | `app.ui`: DOM overlay, HUD and world text, dialogs, touch controls, `app.i18n` |
| `@ignifx/particles` (`particles()`) | `app.particles`, `ParticleSystem`, `.particles.json` effects and presets |
| `@ignifx/particles-2d` (`particles2D()`) | `ParticleSystem2D`: the same effects drawn as sprites; needs `twoD()` and `particles()` |
| `@ignifx/terrain` (`terrain()`) | `Terrain`: heightmaps or noise, level of detail, height queries, `TerrainScatter` |
| `@ignifx/electron` (`electron()`) | Desktop builds: the game window, the `ignifx://` protocol, the preload bridge, file storage |
| `@ignifx/devtools` (`devtools()`) | `app.devtools`: the debug overlay; backtick toggles it |
| `@ignifx/editor-host` (`editorHostPlugin()`, a Vite plugin) | Opens the project in the ignifx editor; development only |

```ts run
import { audio, AudioSource, createApp, defineInputActions, input } from "ignifx";
const app = await createApp({ headless: true, extensions: [input(), audio()] });
const jump = { name: "jump", bindings: [{ path: "<Keyboard>/space" }] };
app.input.loadActions(defineInputActions({ maps: [{ name: "Player", actions: [jump] }] }));
// A clip comes from `app.assets.load<AudioClip>("sfx/jump.wav")`, awaited before `start()` so it
// settles without a frame; it is left out here because this block is executed by the docs harness.
const source = app.world.createEntity("Player").addComponent(AudioSource, { bus: "SFX" });
await app.start();
app.input.simulate({ "<Keyboard>/space": 1 });
app.step(1 / 60); // the source awakes; `jump.wasPressedThisFrame` now holds for this whole frame
source.play({ volume: 0.8 }); // in a browser, queued (not lost) while app.audio.state is "locked"
app.audio.bus("SFX").volume = 0.5;
```

## Core APIs

### `createApp(options?): Promise<App>`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `headless` | `boolean` | `true` when no `canvas` is given | Lite's null engine; the only mode where `app.step` is legal |
| `canvas` | `RenderSurface` | — | `HTMLCanvasElement \| OffscreenCanvas`; rejects `IGX-0701` when WebGPU is unavailable |
| `extensions` | `readonly Extension[]` | `[]` | Registered after the implicit `coreExtension()` |
| `settings` | `SettingsInput` | `{}` | Core sections `layers`, `sortingLayers`, `time`, `assets`, `rendering`; `describeSettings(app)` lists all; data in `ignifx.settings.json`, `ignifx.config.ts` wins a section |
| `assets` | `AssetsCreateOptions` | — | Supplies the manifest ahead of the network fetch |
| `fetch` | `FetchLike` | `globalThis.fetch` | How a Node app maps addresses to files |
| `clock` | `Clock` | `createPerformanceClock()` | Tests pass `createManualClock()` |
| `mode` | `"development" \| "production"` | `"development"` | Development adds phase timings, full messages, strict checks |
| `logSink` | `LogSink` | `createConsoleSink()` | `createMemorySink()` captures records in tests |
| `logLevel` | `LogThreshold` | `"info"` | Lowest level `app.log` writes; `"debug"` shows the kernel's own diagnostics |
| `editMode` | `boolean` | `false` | An editor's scene view: scripts and simulation stay still (see "Edit mode" below) |
| `storage` | `StorageBackend \| FileStorageOptions` | IndexedDB in a browser, in memory elsewhere | Where `app.storage` writes; `{ directory }` is a directory tree under Node |
| `hotReload` | `HotReloadOptions` | `{ reloadScenes: false }` | Whether a changed scene file rebuilds the live instances built from it |

### `App`

| Member | What it is |
| --- | --- |
| `world`, `time`, `settings`, `diagnostics`, `log` | The world, the `Time` service, resolved settings, counters, the logger |
| `assets`, `renderer`, `events` | The asset service, the render service, the engine-wide signal table |
| `tweens`, `hotReload` | The app-wide tween list (`app.tweens.to(...)`), script and scene hot reload |
| `services`, `coroutines`, `platform`, `storage`, `version` | `ServiceRegistry`, `CoroutineHost`, `{ kind, os, isMobile, hasPointerLock, hasGamepads, webgpu, locale, reducedMotion }`, the async key-value store (`get`/`set`/`delete`/`keys`/`namespace`) behind save games and settings — [`concepts/platform-and-storage.md`](references/concepts/platform-and-storage.md), `VERSION` |
| `start()`, `stop()`, `pause()`, `resume()`, `dispose()` | `start` is `async`; `stop` may be followed by `start` again |
| `step(deltaSeconds)` | Headless only; throws `IGX-0105` otherwise |
| `registerComponents(types)` | Makes game components known to the registry |
| `isRunning`, `isHeadless`, `isEditMode` | Loop and mode state |
| `onError` | `Signal<ErrorReport>` — every callback, coroutine, system, extension failure |
| `lite` | `{ engine, scene }`; unstable escape hatch |

`app.events` carries `onSceneLoaded`, `onSceneUnloaded`, `onDeviceLost` (`{ reason, message }`),
`onDeviceRecovered`, and `onDeviceRecoveryFailed`. Connect with `{ owner: this }` from a script.

### `Entity`

| Group | Members |
| --- | --- |
| Hierarchy | `parent`, `children`, `setParent(parent, options?)`, `root()`, `isDescendantOf(other)`, `findChild(predicate, deep?)`, `find(path)` |
| Components | `addComponent(Type, init?)`, `getComponent`, `requireComponent`, `getComponents`, `getComponentInChildren`, `getComponentsInChildren`, `getComponentInParent`, `hasComponent`, `removeComponent`, `components` |
| Lifecycle | `active`, `activeInHierarchy`, `isStatic`, `isDestroyed`, `destroy()`, `destroyImmediate()` |
| Identity | `uid` (ULID), `handle`, `name`, `layer`, `tags`, `world`, `scene`, `prefab`, `transform` |
| Signals | `onChildAdded`, `onChildRemoved`, `onParentChanged`, `onActiveChanged`, `onDestroyed` |

`World` adds `createEntity(name?, options?)`, `getEntity(uid)`, `getEntityByHandle(handle)`,
`findByName`, `findAllByName`, `findByTag`, `components(Type)`, `activeScene`, `scenes`, `layers`,
`registry`, `mainCamera`, `raycastRender(ray, options?)`, the scene API below, and the
`onEntityCreated`/`onEntityDestroyed`/`onSceneLoaded`/`onSceneUnloaded` signals.

### `Transform`

| Kind | Members | Cost |
| --- | --- | --- |
| Local live views | `localPosition`, `localRotation`, `localScale` | free; mutate in place |
| Local values | `localEulerAngles`, `localMatrix`, `localPosition2D`, `localScale2D` | getter allocates |
| World getters | `position`, `rotation`, `eulerAngles`, `lossyScale`, `forward`, `right`, `up` | **allocates each call** |
| World `ToRef` | `positionToRef`, `rotationToRef`, `eulerAnglesToRef`, `localEulerAnglesToRef`, `lossyScaleToRef`, `forwardToRef`, `rightToRef`, `upToRef` | allocation-free; `out` must be a `Vec3` (written through `out.set`), not a `{ x, y, z }` literal — `Vec3Like` is an input-only shape |
| Operations | `translate`, `rotate`, `rotateAround`, `lookAt`, `setPositionAndRotation` | degrees |
| Spaces | `transformPoint`, `transformDirection`, `inverseTransformPoint`, `inverseTransformDirection` | optional `out` |
| 2D | `position2D`, `localPosition2D`, `rotation2D`, `localScale2D` | degrees about +Z |
| Matrices | `worldMatrix`, `worldMatrixVersion`, `lite` | lazily recomputed |

### Rendering components

Fields and defaults: [`formats/components.md`](references/formats/components.md); how
they behave: [`concepts/rendering.md`](references/concepts/rendering.md); reflection probes, light probes, lightmaps and the probe bake: [`concepts/baked-lighting.md`](references/concepts/baked-lighting.md).

| Component | Key fields | Notes |
| --- | --- | --- |
| `Camera` | `projection`, `fov`, `orthographicSize`, `near`, `far`, `viewport`, `clearColor`, `priority` | The entity's transform is the view; highest `priority` renders. Methods: `screenToRay(x, y)`, `worldToScreen(point, out)`, `screenToWorldPoint`, `viewportToWorldPoint`, `getViewMatrix(out)`, `getProjectionMatrix(out)` |
| `Light` | `type`, `color`, `intensity`, `range`, `spotAngle`, `shadows`, `includeOnly`, `exclude` | `shadows` needs the `shadows` feature; point/hemispheric cast none |
| `MeshRenderer` | `mesh`, `materials`, `castShadows`, `receiveShadows`, `renderOrder`, `pickable` | `allowMultiple`; only `materials[0]` draws (Babylon Lite has one material per mesh); `displayHidden` hides it without saving anything |
| `Model` | `model`, `materialOverrides`, `castShadows`, `receiveShadows`, `pickable` | `nodes`, `attachToNode(name, entity)`; shadows cover the whole subtree; `animations`/`skeletons` are beta |
| `Environment` | `environment`, `rotation`, `blur`, `skybox`, `fog`, `imageProcessing`, `clearColor` | One per world; a second logs `IGX-0705` |
| `PostProcessStack` | `bloom`, `smaa`, `imageProcessing` | Needs the `postProcessing` feature (`IGX-0710`); `imageProcessing` always runs last |
| `ReflectionProbe` (`@beta`) | `size`, `refreshMode`, `boxProjection`, `blendDistance`, `cullingMask` | A cube map nearby PBR materials reflect; `refresh()` recaptures |
| `LightProbeVolume` (`@beta`) | `probes`, `intensity` | Diffuse light from a baked `.probes.json` grid |

### Meshes and materials in code

| Call | Answers |
| --- | --- |
| `MeshAsset.box / sphere / plane / ground / cylinder / capsule / torus (app, options?)` | `AssetHandle<MeshAsset>` at a `memory:` address |
| `MeshAsset.fromData(app, name, { positions, normals, indices, uvs? })` | The same, from your own geometry |
| `pbrMaterialDefinition(overrides?)`, `standardMaterialDefinition(overrides?)` | A `MaterialDefinition` |
| `createMaterialAsset(app, definition, textures)` | `AssetHandle<MaterialAsset>` |
| `materialAsset.clone(app)`, `.setBaseColor`, `.setMetallicRoughness`, `.setAlpha` | A per-object copy, and live edits |
| `shaderMaterialDefinition({ shader, values?, textures?, defines? })` | A material built on your own `.wgsl` |
| `pbrMaterialDefinition({ surfaces: [...] })`, `materialAsset.surface(name)` | `.surface.wgsl` layers on PBR, and their values |
| `InstancedMeshRenderer` — `setMatrices(slab, count)`, `setCount`, `markDirty(range)` | Thousands of copies of one mesh, one draw call |

A scene file names a primitive through a `.mesh.json` file (`{ "format": "ignifx.mesh",
"formatVersion": 1, "primitive": "box", "options": { "size": 1 } }`); a primitive built in code is an
in-code asset and cannot be serialized into a scene file (`IGX-0602`). Custom shaders, their pragma
declarations and the WGSL rules are in [`formats/wgsl.md`](references/formats/wgsl.md)
and [`concepts/rendering.md`](references/concepts/rendering.md) §6.

### `app.assets`

Full page: [`concepts/assets.md`](references/concepts/assets.md).

| Member | Notes |
| --- | --- |
| `load(ref, options?)` / `loadAsync` / `loadAll` / `preloadGroup` | A handle immediately, awaited, in bulk, or by manifest group label |
| `get(address)`, `release(handleOrAddress)`, `gc()`, `gcDelay` | Cache lookup without a refcount change, and collection |
| `register(value, { type, address? })` | Publish an in-code value at a `memory:` address |
| `manifest`, `resolveUrl(address)`, `onProgress` | The generated table and the address → URL mapping |

`AssetHandle<T>`: `address`, `type`, `state`, `value` (`IGX-0501` unless loaded), `promise`,
`progress`, `error`, `refCount`, `retain()`, `release()`, `[Symbol.dispose]()`, `onReplaced`.
`LoadOptions`: `signal`, `priority`, `type`, `onProgress`. **Every `load` needs one `release`**, and
while the app runs, loads deliver in `PreUpdate` (state flips next frame); before `app.start()` they settle at once, so preload, `await`, then start.

An `asset(TypeToken)` schema field holds the **loaded handle**; the file stores
`{ "$asset": "<address>" }`. The scene loader resolves every reference before writing props, so
`awake` can read `this.mesh.value`, and the field never owns the reference count.

### Scenes and prefabs

| Call | Notes |
| --- | --- |
| `world.loadScene(ref, options?)` | `mode: "single" \| "additive"`, `signal`, `onProgress`, `setActive` |
| `world.unloadScene(instance)` | Destroys the entities, releases the handles |
| `world.instantiate(sceneAsset, options?)` | Synchronous; `parent`, `name`, `position`, `rotation`, `worldSpace` |
| `world.instantiateAsync(ref, options?)` | Loads first, then instantiates |
| `serializeScene(source, options?)` | `SceneInstance` or roots → `SceneFile`; `flatten`, `name`, `onIssue` |
| `stringifySceneFile`, `validateSceneFile`, `computeSceneHash` | Write, check, and hash a file |

A prefab and a level are one format, `ignifx.scene`. `SceneInstance` carries `uid`,
`name`, `roots`, `isLoaded`, `persistent`, `settings`, `asset`, `remap`, `onUnloading`. A file cannot
name a code-built primitive — see [`formats/scene.md`](references/formats/scene.md).

### `app.renderer` and the `rendering` settings

`surface` (the canvas, `null` headless), `pixelRatio`, `resolutionScale`, `setSize(w, h)` (`OffscreenCanvas` only), `features`,
`requireFeature(name)`, `warmUp(materials)`, `pickAsync(x, y, options?)`, `captureScreenshot()`,
`drawCalls`, `gpuFrameTimeMs`, `profileTasks`, `taskTimings()`, `openOverlay()` (`@beta`: an editor's gizmo layer), `animateMaterialsInEditMode` (an edit-mode app's shader clock; `true` by default).

The `rendering` settings section is read once, at `createApp`. `features` holds `shadows`, `postProcessing`, `skeletons`, `boneControl`, `stencil`, `lightmaps`, `materialPlugins`, `asyncPipelines` and `deviceLostRecovery`, all `false` by default and refused after start with `IGX-0704`. The rest: `msaaSamples`, `alphaMode`, `srgb`, `format`, `maxDevicePixelRatio`, `useHighPrecisionMatrix`, `useFloatingOrigin`, `requiredLimits`, `hdr`, `taa`, `ambientOcclusion`, `autoExposure`, `clearColor`, `brdfLut` and `quality` (`"low"`, `"medium"`, `"high"` or the default `"custom"`). Defaults and what each does: [`concepts/rendering.md`](references/concepts/rendering.md) §4.

### `Script` callbacks and their timing

Callbacks are not members of `Script`; implement the ones you need, optionally with
`implements ScriptCallbacks` for signature checking.

| Callback | Timing in the frame | How often |
| --- | --- | --- |
| `awake()` | Flush A of the first frame the component is effectively enabled | Once per component |
| `onEnable()` | Flush A, after `awake`, and on every later transition to enabled | Every transition |
| `start()` | Flush B, after the fixed loop, before `update` | Once per component |
| `fixedUpdate(dt)` | Inside the fixed loop; `dt === time.fixedDeltaTime` | 0…N per frame |
| `update(dt)` | Update phase; `dt === time.deltaTime` | Once per frame |
| `lateUpdate(dt)` | After `update` and `PostUpdate` | Once per frame |
| `onDisable()` | Synchronously at the transition, and in the destroy flush | Every transition |
| `onDestroy()` | Destroy flush, after the tracked references are nulled | Once |
| `onApplicationPause(paused)`, `onApplicationFocus(focused)` | Visibility and focus changes | Per transition |
| `onCollisionEnter/Stay/Exit`, `onTriggerEnter/Exit` | After the fixed step, by `@ignifx/physics` (see its skill) | Per event |

Statics (`static typeId`, `requires`, `allowMultiple`, `executionOrder`, `updateWhenPaused`, `runInEditMode`) and callbacks are written plainly with no `override`: they are not members of `Component`/`Script`; the class-token types match them structurally (`ComponentStatics`, `ScriptStatics`) and the registry applies the defaults. **Edit mode** (`createApp({ editMode: true })`, an editor's scene view): no script gets a callback unless its class sets `static runInEditMode = true`, and nothing simulates — [`concepts/lifecycle.md`](references/concepts/lifecycle.md) §8.

### Schema kinds

Declared with `Script.define({...})` / `Component.define({...})`. Every kind takes `FieldOptions`
last (`min`, `max`, `step`, `tooltip`, `group`, `hidden`, `readonly`, `transient`).

| Kind | Field value | JSON encoding |
| --- | --- | --- |
| `f32(d?)`, `f64(d?)`, `i32(d?)`, `u32(d?)` | `number` | number (canonicalized; `NaN`/`Infinity` → `IGX-0601`) |
| `bool(d?)` | `boolean` | boolean |
| `str(d?)` | `string` | string |
| `vec2(d?)`, `vec3(d?)`, `vec4(d?)`, `quat(d?)` | `Vec2Like`…`QuatLike` | array of numbers |
| `color(d?)` | `ColorLike` | `[r, g, b, a]` in sRGB 0–1 |
| `enumOf(values, default)` | the string union | the string value |
| `entityRef<E>()` | `E \| null`, tracked | `{ "$entity": "<uid>" }` or `null` |
| `componentRef(Type)` | `C \| null`, tracked | `{ "$component": "<uid>" }` or `null` |
| `asset(TypeToken)` | `AssetHandle<A> \| null` | `{ "$asset": "<address>" }` or `null` |
| `array(item, d?)` | `T[]` | array |
| `record(fields)`, `map(value)` | struct / `Record<string, T>` | object |
| `optional(inner)` | `T \| null` | inner encoding or `null` |
| `layerMask(names?)` | `readonly string[]` | array of layer names |
| `curve(d?)` | `CurveValue` | `{ "keys": [[t, v, inTangent, outTangent], …] }` |
| `custom(codec)` | whatever the codec returns | whatever `serialize` returns |

### `Time` (`app.time`)

| Property | Meaning | Default |
| --- | --- | --- |
| `deltaTime` / `unscaledDeltaTime` | Scaled / clamped-but-unscaled frame delta | — |
| `fixedDeltaTime` | One fixed step; writable between frames | `1/60` |
| `maximumDeltaTime` | Clamp on a raw frame delta; writable | `0.1` |
| `timeScale` | Scaled = unscaled × this; writable, `0` freezes | `1` |
| `paused` | Set via `app.pause()` / `app.resume()` | `false` |
| `time` / `unscaledTime` / `fixedTime` | Seconds since the first frame | `0` |
| `realtimeSinceStartup` | Wall clock, unaffected by pause or `timeScale` | — |
| `frameCount`, `inFixedStep`, `fixedStepAlpha` | Frame counter, fixed-loop flag, interpolation alpha | — |

### `Signal<T>`

`connect(handler, options?)` returns a `Disconnect`; `ConnectOptions` is `{ once?, deferred?, owner? }`.
`emit(value)` is synchronous unless the connection is `deferred` (delivery moves to the next
`EndOfFrame`; a standalone signal throws `IGX-0103`). `disconnect(handler)`, `clear()`,
`connectionCount`, `owner`. Always pass `owner: this` from a script.

### Coroutines

`startCoroutine(routine)` / `stopCoroutine(handle)` / `stopAllCoroutines()` on a `Script`, plus the
`app.coroutines` host. A `Coroutine` is `Generator<CoroutineYield, void, unknown>`.

| Yield | Resumes |
| --- | --- |
| `yield` / `yield null` | Next frame, after every `update()` |
| `waitSeconds(s)` | After `s` scaled seconds (inclusive, relative `1e-6` tolerance) |
| `waitSecondsRealtime(s)` | After `s` unscaled seconds |
| `waitFixedUpdate()` | After the next fixed step |
| `waitUntil(pred)` / `waitWhile(pred)` | When the predicate flips, checked in the Update phase |
| `yield handle` | When that coroutine finishes |
| `yield promise` | First `Update` after it settles; the value is the `yield` result, a rejection is thrown in |

### `defineExtension`

```ts run
import { Phase, defineExtension } from "@ignifx/core";
import type { Extension, ExtensionContext } from "@ignifx/core";

export const demo: (options?: void) => Extension = defineExtension<void>(() => ({
  name: "game/demo",
  version: "1.0.0",
  engine: ">=0.1.0 <1.0.0",
  requires: ["@ignifx/core"],
  register(ctx: ExtensionContext): void {
    ctx.requireRenderingFeature("skeletons");
    ctx.registerSystem({ name: "game/demo.tick" }, { phase: Phase.Update, order: 1001 });
  },
}));
```

`ExtensionContext` offers `app`, `log`, `registerComponent(s)`, `registerSystem`, `registerService`, `defineAppProperty`, `registerSettings`, `settings`, `require`, `tryGet`, `registerAssetType`, `registerAssetLoader`, `requireRenderingFeature`, `registerErrorCodes`, and `onDispose`. Registration errors: `IGX-0402` (`requires` cycle), `IGX-0403` (missing), `IGX-0404` (engine range), `IGX-0406` (duplicate name), `IGX-0401` (app property defined twice).

### Errors

Misuse throws `IgnifxError` with a stable `code`, a `context` record, and a `hint`; `isIgnifxError`
narrows an `unknown`. `AssetLoadError` adds `address` and `url`. Codes are `IGX-####`, where the
first two digits are the area.

| Range | Area | Range | Area |
| --- | --- | --- | --- |
| `01xx` | Lifecycle, app, time, tweens | `10xx` | Audio |
| `02xx` | Components and registration | `11xx` | 2D (`1150` up: 2D physics) |
| `03xx` | Scenes, layers, parenting | `12xx` | 3D |
| `04xx` | Extensions, services, settings | `13xx` | UI |
| `05xx` | Assets (`0550` up: the Vite plugin) | `14xx` | Platform and storage (`1401`–`1419`: the CLI; `1460` up: Electron) |
| `06xx` | Serialization and schemas (`0650` up: the Vite plugin) | `15xx` | Diagnostics and devtools |
| `07xx` | Rendering (`IGX-0701` = no WebGPU) | `16xx` | Terrain |
| `08xx` | Input | `17xx` | Particles, 3D and 2D |
| `09xx` | 3D physics | `18xx` | Editor host |

`9xxx` is reserved for extensions published outside the `@ignifx` scope. `CoreErrorCode` names every kernel code; `CORE_ERROR_MESSAGES` holds the templates. Runtime failures inside callbacks, coroutines, systems, extensions, and the asset pipeline reach `app.onError` as an `ErrorReport` rather than being thrown at the caller.

## Recipes

Task-sized examples, each compiled from a real source file, are indexed with one line apiece in [`recipes/README.md`](references/recipes/README.md): loading models and prefabs, instancing, save games, binding and rebinding input, 3D and 2D character controllers, physics queries, the third-person camera, tweens, sprite animation, tilemaps, custom shaders, particles, terrain, baked light probes and lightmaps, audio, a pause menu, and devtools counters. Each subsystem skill carries further recipes of its own.

## File formats

Every ignifx JSON file carries a `format` string and a `formatVersion`, and `@ignifx/vite-plugin` validates it at build time. [`formats/README.md`](references/formats/README.md) indexes a page for every format; the ones the kernel owns:

- [`formats/scene.md`](references/formats/scene.md): `.scene.json` and `.prefab.json`, with every built-in component's fields in [`formats/components.md`](references/formats/components.md).
- [`formats/material.md`](references/formats/material.md) and [`formats/wgsl.md`](references/formats/wgsl.md): `.material.json` and the `// @ignifx` shader pragmas.
- `.mesh.json`, `.environment.json`, `.probes.json`, `.lightmap.json` and each extension's files (`.input.json`, `.audio.json`, `.atlas.json`, `.tilemap.json`, `.animator.json`, `.particles.json`, `.terrain.json`, `.i18n.json`, …) have generated field tables there, bundled as [`formats/ignifx.schemas.json`](references/formats/ignifx.schemas.json).

`assets.manifest.json` and the `.meta.json` sidecar are documented in the `@ignifx/vite-plugin` package's `README.md`.

## Gotchas (top 12)

1. **Rendering features are declared before `app.start()`.** All are `false` by default and refused afterwards with `IGX-0704`: set `settings.rendering.features`, or call `ctx.requireRenderingFeature(name)` from an extension. `postProcessing` is the one people forget: a `PostProcessStack` without it logs `IGX-0710` and does nothing.
2. **A mesh added at runtime appears a few frames late.** A material family that did not exist when the scene was registered is compiled on Babylon Lite's runtime path: about 3 extra frames, against 0–2 for a warmed one. `app.start()` warms the `boot` preload group; use `app.renderer.warmUp(materials)` for anything loaded later, a shader material included.
3. **One `Environment` per world** (a second logs `IGX-0705`), **point and hemispheric lights cast no shadows** (`IGX-0703`), and **a world with no enabled camera renders nothing** (`IGX-0706`).
4. **Assets are delivered in `PreUpdate` once the app runs.** A load requested in `update` is ready on the _next_ frame at the earliest, and `handle.value` throws `IGX-0501` until then. In a headless test that has called `app.start()`, nothing settles until you `app.step()`; `await` loads _before_ `start()` instead, where they settle as they finish.
5. **Pair every `load` with a `release`**; `using` works. An `asset()` field is not a holder: the scene instance that loaded the asset releases it.
6. **`active = false` hides, `destroy()` removes.** Lite disposes a mesh removed from its last scene, permanently — never unhook Lite objects to hide something.
7. **`fixedUpdate` runs 0…N times per frame.** Integrate with its `dt` argument, never with `app.time.deltaTime`. And no `async` lifecycle callbacks: use a coroutine.
8. **`.lite` escape hatches are unstable.** `app.lite`, `world.lite`, `transform.lite`, `asset.lite` expose Babylon Lite objects with no stability guarantee; ask for a first-class API.
9. **WebGPU only, no fallback.** Probe with `isWebGpuAvailable()`; `createApp({ canvas })` rejects with `IGX-0701` when no adapter is available.
10. **Degrees in the public API; world getters allocate.** A radian API carries a `Rad` suffix, and `transform.position`/`.forward`/… allocate — use `positionToRef(out)` in hot paths.
11. **Hot reload `"patch"` keeps state and skips every lifecycle callback.** Change a field layout and write `static hotReload = "recreate"`, or the engine re-creates anyway with an `IGX-0207` warning; wire it with `acceptHotReload(app)` from `virtual:ignifx/scripts`.
12. **A custom shader declares itself in its `.wgsl`.** `// @ignifx system time` is read as `shaderUniforms.time`, a `@ignifx shader` file is unlit, and a `.surface.wgsl` needs a PBR host and the `materialPlugins` feature (`IGX-0716`, `IGX-0723`). Read [`formats/wgsl.md`](references/formats/wgsl.md) first.

The full kernel list, with error codes, is in [`references/gotchas.md`](references/gotchas.md). Each extension's gotchas are in the Gotchas section of its own skill.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

| Topic | Read |
| --- | --- |
| Frame order, callbacks, `Time` | [`concepts/lifecycle.md`](references/concepts/lifecycle.md) |
| World, entities, scenes, prefabs | [`concepts/scene-graph.md`](references/concepts/scene-graph.md) |
| Components, schemas, coroutines, hot reload | [`concepts/scripting.md`](references/concepts/scripting.md) |
| Cameras, lights, meshes, shaders, the renderer | [`concepts/rendering.md`](references/concepts/rendering.md) |
| Reflection probes, light probes, lightmaps | [`concepts/baked-lighting.md`](references/concepts/baked-lighting.md) |
| Addresses, handles, loaders | [`concepts/assets.md`](references/concepts/assets.md) |
| Extensions, services, settings | [`concepts/extensions.md`](references/concepts/extensions.md) |
| `app.platform`, `app.storage`, saves | [`concepts/platform-and-storage.md`](references/concepts/platform-and-storage.md) |
| Every exact signature | `references/api/<entry>.md`, one generated page per package entry point, listed in [`api/README.md`](references/api/README.md). The pages are large: search them for a symbol instead of reading them whole |
| An extension | Its own skill (the table under "Adding extensions") |

This skill ships in the `ignifx` package (`node_modules/ignifx/skills/ignifx/` in an installed project, `skills/ignifx/` in the engine repository), and every path above is relative to this file.

`docs/migrations/` exists only after 1.0.
