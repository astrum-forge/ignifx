---
name: ignifx
description: Builds 2D and 3D web games with the ignifx TypeScript game engine (WebGPU-only, Babylon Lite based, browser and Electron). Use when creating or editing ignifx apps, entities, scripts, scenes, prefabs, assets, input actions, physics, audio, sprites, or tilemaps, or when the user mentions ignifx, @ignifx packages, createApp, Script lifecycle, or ignifx scene JSON.
license: Apache-2.0
metadata:
  ignifx-version: "0.0.0-unreleased"
  babylon-lite-version: "1.27.0"
---

# ignifx

## What this is / when to use

ignifx is a code-first TypeScript game engine for browsers and Electron. It renders exclusively
through WebGPU via Babylon Lite (`@babylonjs/lite`), and it is designed for indie 2D (top-down,
side-scrolling) and 3D (third-person, first-person) games. Use this skill whenever you write or
modify code, scenes, or assets for an ignifx project. The engine covers the kernel (app, frame loop,
entities, transforms, components, scripts, schemas, coroutines, signals, layers, math) **and**
rendering, assets, and the scene/prefab file format; input, physics, audio, and the 2D/3D/UI
toolkits arrive in later phases.

## Environment

| Item                | Value                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine version      | unreleased (`0.0.0`); `@ignifx/core`, `@ignifx/input`, `@ignifx/audio`, `@ignifx/physics`, `@ignifx/2d`, `@ignifx/physics-2d`, `@ignifx/3d`, `@ignifx/ui`, `@ignifx/vite-plugin`, and the `ignifx` umbrella |
| Babylon Lite        | 1.27.0 (pinned; do not call Lite APIs directly outside adapter code)                                                                                                                                        |
| Node / pnpm         | 24 LTS / 11                                                                                                                                                                                                 |
| Browser requirement | WebGPU (Chrome/Edge 113+, Safari 26+, Firefox 141+ Windows / 145+ Apple Silicon); Electron needs `--enable-unsafe-webgpu` (handled by `@ignifx/electron`)                                                   |
| Headless            | Node 24, no GPU: `createApp({ headless: true })` plus `app.step(dt)`                                                                                                                                        |
| Extensions          | `createApp({ canvas, extensions: [input(), audio(), physics()] })` — each adds its `app.<name>` service; all re-exported from `ignifx`                                                                      |
| Build               | Vite 8 with `ignifx()` from `@ignifx/vite-plugin`: asset manifest, `.meta.json` sidecars, JSON validation, HMR                                                                                              |
| Commands            | `pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm build` · `pnpm check` (all gates) · `node scripts/check-webgpu.mjs` · `node scripts/new-script.mjs <Name>`                                              |

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

Without a GPU — how tests and tools run it — `createApp({ headless: true, clock: createManualClock() })`, then `app.step(1 / 60)` per frame and `app.dispose()`; the extensions example below is exactly that shape.

### Adding extensions

Extensions register in `createApp({ extensions })`; each adds an `app.<name>` service, scripts, asset types, and a settings section, and has a subsystem skill with the detail. Everything below is also re-exported from `ignifx`. Headless apps drive input with `simulate` and advance audio playback by the frame delta, so both are testable without a device.

| Package (factory)                    | Adds                                                                                                                                                                                                                                                                                                                                                                                                        | Skill                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `@ignifx/input` (`input()`)          | `app.input`, `PlayerInput`, `.input.json` actions (`inputactions`), the `input` settings section                                                                                                                                                                                                                                                                                                            | `packages/input/skills/input/SKILL.md`           |
| `@ignifx/audio` (`audio()`)          | `app.audio` (buses, one-shots, unlock), `AudioSource`, `AudioListener`, `MusicPlayer`, `.audio.json` buses (`audiobuses`), `audioclip`, the `audio` settings section                                                                                                                                                                                                                                        | `packages/audio/skills/audio/SKILL.md`           |
| `@ignifx/2d` (`twoD()`)              | `app.twoD`: `Camera2D`, `SpriteRenderer`, `SpriteAnimator`, atlases, `Tilemap`/`TilemapRenderer`, sorting layers and Y-sort, pixel-perfect cameras, `ParallaxLayer`, 2D picking; `pixelsPerUnit` defaults to 100                                                                                                                                                                                            | `packages/2d/skills/2d/SKILL.md`                 |
| `@ignifx/ui` (`ui()`)                | `app.ui`: DOM overlay root, named layers, `"css"`/`"fit"`/`"dpi"` scaling, safe-area variables, focus routing into `app.input.uiHasFocus`; `WorldAnchor`; `HudText`/`WorldText`/`WorldText2D` on Lite text; `Dialog`/`Toast`/`LoadingScreen`; `VirtualJoystick`/`VirtualButton` (need `@ignifx/input`); `app.i18n` with `.i18n.json` (`i18n`)                                                               | `packages/ui/skills/ui/SKILL.md`                 |
| `@ignifx/3d` (`threeD()`)            | `app.navigation` with `NavMeshSurface`/`NavMeshAgent`/`NavMeshObstacle` on Recast (headless too — the wasm is inlined); `ThirdPersonController`/`FirstPersonController`, `RigidbodyMover`/`PlatformMover`/`Projectile`; `ThirdPersonCamera` with wall collision; `Animator` with blend trees, masks and events from `.animator.json` (`animator`); `LodGroup`, `Billboard`. Needs `physics()` and `input()` | `packages/3d/skills/3d/SKILL.md`                 |
| `@ignifx/physics` (`physics()`)      | `app.physics`: 3D rigid bodies on Havok — `Rigidbody`, box/sphere/capsule/cylinder/mesh/heightfield colliders, triggers, `CharacterController`, the layer matrix, raycasts and shape queries, render interpolation; simulates on its own null-engine scene stepped by the fixed loop, so it runs headless                                                                                                   | `packages/physics/skills/physics/SKILL.md`       |
| `@ignifx/physics-2d` (`physics2d()`) | `app.physics2d`: 2D physics on Rapier — `Rigidbody2D`, box/circle/capsule/polygon/edge/tilemap colliders, triggers, `CharacterController2D` with slopes, autostep, snap-to-ground and one-way platforms, 2D queries; runs headless (the WebAssembly is inlined)                                                                                                                                             | `packages/physics-2d/skills/physics-2d/SKILL.md` |

```ts
import { audio, AudioClip, AudioSource, createApp, defineInputActions, input } from "ignifx";
const app = await createApp({ headless: true, extensions: [input(), audio()] });
const jump = { name: "jump", bindings: [{ path: "<Keyboard>/space" }] };
app.input.loadActions(defineInputActions({ maps: [{ name: "Player", actions: [jump] }] }));
const clip = app.assets.load<AudioClip>("sfx/jump.wav");
await clip.promise; // settles as soon as it loads: the app is not running yet
const source = app.world.createEntity("Player").addComponent(AudioSource, { clip, bus: "SFX" });
await app.start();
app.input.simulate({ "<Keyboard>/space": 1 });
app.step(1 / 60); // the source awakes; `jump.wasPressedThisFrame` now holds for this whole frame
source.play({ volume: 0.8 }); // in a browser, queued (not lost) while app.audio.state is "locked"
app.audio.bus("SFX").volume = 0.5;
```

## Core APIs

### `createApp(options?): Promise<App>`

| Option       | Type                            | Default                          | Notes                                                                                 |
| ------------ | ------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `headless`   | `boolean`                       | `true` when no `canvas` is given | Lite's null engine; the only mode where `app.step` is legal                           |
| `canvas`     | `RenderSurface`                 | —                                | `HTMLCanvasElement \| OffscreenCanvas`; rejects `IGX-0701` when WebGPU is unavailable |
| `extensions` | `readonly Extension[]`          | `[]`                             | Registered after the implicit `coreExtension()`                                       |
| `settings`   | `SettingsInput`                 | `{}`                             | Sections: `layers`, `sortingLayers`, `time`, `assets`, `rendering`                    |
| `assets`     | `AssetsCreateOptions`           | —                                | Supplies the manifest ahead of the network fetch                                      |
| `fetch`      | `FetchLike`                     | `globalThis.fetch`               | How a Node app maps addresses to files                                                |
| `clock`      | `Clock`                         | `createPerformanceClock()`       | Tests pass `createManualClock()`                                                      |
| `mode`       | `"development" \| "production"` | `"development"`                  | Development adds phase timings, full messages, strict checks                          |
| `logSink`    | `LogSink`                       | `createConsoleSink()`            | `createMemorySink()` captures records in tests                                        |
| `logLevel`   | `LogThreshold`                  | `"info"`                         | Lowest level `app.log` writes; `"debug"` shows the kernel's own diagnostics           |

### `App`

| Member                                                  | What it is                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `world`, `time`, `settings`, `diagnostics`, `log`       | The world, the `Time` service, resolved settings, counters, the logger         |
| `assets`, `renderer`, `events`                          | The asset service, the render service, the engine-wide signal table            |
| `services`, `coroutines`, `platform`, `version`         | `ServiceRegistry`, `CoroutineHost`, `{ kind: "browser" \| "node" }`, `VERSION` |
| `start()`, `stop()`, `pause()`, `resume()`, `dispose()` | `start` is `async`; `stop` may be followed by `start` again                    |
| `step(deltaSeconds)`                                    | Headless only; throws `IGX-0105` otherwise                                     |
| `registerComponents(types)`                             | Makes game components known to the registry                                    |
| `isRunning`, `isHeadless`                               | Loop and mode state                                                            |
| `onError`                                               | `Signal<ErrorReport>` — every callback, coroutine, system, extension failure   |
| `lite`                                                  | `{ engine, scene }`; unstable escape hatch                                     |

`app.events` carries `onSceneLoaded`, `onSceneUnloaded`, `onDeviceLost` (`{ reason, message }`),
`onDeviceRecovered`, and `onDeviceRecoveryFailed`. Connect with `{ owner: this }` from a script.

### `Entity`

| Group      | Members                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy  | `parent`, `children`, `setParent(parent, options?)`, `root()`, `isDescendantOf(other)`, `findChild(predicate, deep?)`, `find(path)`                                                                            |
| Components | `addComponent(Type, init?)`, `getComponent`, `requireComponent`, `getComponents`, `getComponentInChildren`, `getComponentsInChildren`, `getComponentInParent`, `hasComponent`, `removeComponent`, `components` |
| Lifecycle  | `active`, `activeInHierarchy`, `isStatic`, `isDestroyed`, `destroy()`, `destroyImmediate()`                                                                                                                    |
| Identity   | `uid` (ULID), `handle`, `name`, `layer`, `tags`, `world`, `scene`, `prefab`, `transform`                                                                                                                       |
| Signals    | `onChildAdded`, `onChildRemoved`, `onParentChanged`, `onActiveChanged`, `onDestroyed`                                                                                                                          |

`World` adds `createEntity(name?, options?)`, `getEntity(uid)`, `getEntityByHandle(handle)`,
`findByName`, `findAllByName`, `findByTag`, `components(Type)`, `activeScene`, `scenes`, `layers`,
`registry`, `mainCamera`, `raycastRender(ray, options?)`, the scene API below, and the
`onEntityCreated`/`onEntityDestroyed`/`onSceneLoaded`/`onSceneUnloaded` signals.

### `Transform`

| Kind             | Members                                                                                                                                   | Cost                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Local live views | `localPosition`, `localRotation`, `localScale`                                                                                            | free; mutate in place   |
| Local values     | `localEulerAngles`, `localMatrix`, `localPosition2D`, `localScale2D`                                                                      | getter allocates        |
| World getters    | `position`, `rotation`, `eulerAngles`, `lossyScale`, `forward`, `right`, `up`                                                             | **allocates each call** |
| World `ToRef`    | `positionToRef`, `rotationToRef`, `eulerAnglesToRef`, `localEulerAnglesToRef`, `lossyScaleToRef`, `forwardToRef`, `rightToRef`, `upToRef` | allocation-free         |
| Operations       | `translate`, `rotate`, `rotateAround`, `lookAt`, `setPositionAndRotation`                                                                 | degrees                 |
| Spaces           | `transformPoint`, `transformDirection`, `inverseTransformPoint`, `inverseTransformDirection`                                              | optional `out`          |
| 2D               | `position2D`, `localPosition2D`, `rotation2D`, `localScale2D`                                                                             | degrees about +Z        |
| Matrices         | `worldMatrix`, `worldMatrixVersion`, `lite`                                                                                               | lazily recomputed       |

### Rendering components

Fields and defaults: [`references/formats/components.md`](references/formats/components.md); how
they behave: [`references/concepts/rendering.md`](references/concepts/rendering.md).

| Component          | Key fields                                                                                   | Notes                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Camera`           | `projection`, `fov`, `orthographicSize`, `near`, `far`, `viewport`, `clearColor`, `priority` | The entity's transform is the view; highest `priority` renders                                            |
| `Light`            | `type`, `color`, `intensity`, `range`, `spotAngle`, `shadows`, `includeOnly`, `exclude`      | `shadows` needs the `shadows` feature; point/hemispheric cast none                                        |
| `MeshRenderer`     | `mesh`, `materials`, `castShadows`, `receiveShadows`, `renderOrder`, `pickable`              | `allowMultiple`; only `materials[0]` draws in this Lite version                                           |
| `Model`            | `model`, `materialOverrides`, `castShadows`, `receiveShadows`, `pickable`                    | `nodes`, `attachToNode(name, entity)`; shadows cover the whole subtree; `animations`/`skeletons` are beta |
| `Environment`      | `environment`, `rotation`, `blur`, `skybox`, `fog`, `imageProcessing`, `clearColor`          | One per world; a second logs `IGX-0705`                                                                   |
| `PostProcessStack` | `bloom`, `smaa`, `imageProcessing`                                                           | Needs the `postProcessing` feature (`IGX-0710`); `imageProcessing` always runs last                       |

`Camera` methods: `screenToRay(x, y)`, `worldToScreen(point, out)`, `screenToWorldPoint`,
`viewportToWorldPoint`, `getViewMatrix(out)`, `getProjectionMatrix(out)`.

### Meshes and materials in code

| Call                                                                                   | Answers                                         |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `MeshAsset.box / sphere / plane / ground / cylinder / capsule / torus (app, options?)` | `AssetHandle<MeshAsset>` at a `memory:` address |
| `MeshAsset.fromData(app, name, { positions, normals, indices, uvs? })`                 | The same, from your own geometry                |
| `pbrMaterialDefinition(overrides?)`, `standardMaterialDefinition(overrides?)`          | A `MaterialDefinition`                          |
| `createMaterialAsset(app, definition, textures)`                                       | `AssetHandle<MaterialAsset>`                    |
| `materialAsset.clone(app)`, `.setBaseColor`, `.setMetallicRoughness`, `.setAlpha`      | A per-object copy, and live edits               |

There is no mesh **file** format: geometry is a primitive built in code or part of a `ModelAsset`.
An in-code asset cannot be serialized into a scene file (`IGX-0602`).

### `app.assets`

Full page: [`references/concepts/assets.md`](references/concepts/assets.md).

| Member                                                           | Notes                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `load(ref, options?)` / `loadAsync` / `loadAll` / `preloadGroup` | A handle immediately, awaited, in bulk, or by manifest group label |
| `get(address)`, `release(handleOrAddress)`, `gc()`, `gcDelay`    | Cache lookup without a refcount change, and collection             |
| `register(value, { type, address? })`                            | Publish an in-code value at a `memory:` address                    |
| `manifest`, `resolveUrl(address)`, `onProgress`                  | The generated table and the address → URL mapping                  |

`AssetHandle<T>`: `address`, `type`, `state`, `value` (`IGX-0501` unless loaded), `promise`,
`progress`, `error`, `refCount`, `retain()`, `release()`, `[Symbol.dispose]()`, `onReplaced`.
`LoadOptions`: `signal`, `priority`, `type`, `onProgress`. **Every `load` needs one `release`**, and
while the app runs, loads deliver in `PreUpdate` (state flips next frame); before `app.start()` they settle at once, so preload, `await`, then start.

An `asset(TypeToken)` schema field holds the **loaded handle**; the file stores
`{ "$asset": "<address>" }`. The scene loader resolves every reference before writing props, so
`awake` can read `this.mesh.value`, and the field never owns the reference count.

### Scenes and prefabs

| Call                                                          | Notes                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `world.loadScene(ref, options?)`                              | `mode: "single" \| "additive"`, `signal`, `onProgress`, `setActive`  |
| `world.unloadScene(instance)`                                 | Destroys the entities, releases the handles                          |
| `world.instantiate(sceneAsset, options?)`                     | Synchronous; `parent`, `name`, `position`, `rotation`, `worldSpace`  |
| `world.instantiateAsync(ref, options?)`                       | Loads first, then instantiates                                       |
| `serializeScene(source, options?)`                            | `SceneInstance` or roots → `SceneFile`; `flatten`, `name`, `onIssue` |
| `stringifySceneFile`, `validateSceneFile`, `computeSceneHash` | Write, check, and hash a file                                        |

A prefab and a level are one format, `ignifx.scene` (ADR-0005). `SceneInstance` carries `uid`,
`name`, `roots`, `isLoaded`, `persistent`, `settings`, `asset`, `remap`, `onUnloading`.

### `app.renderer` and the `rendering` settings

`surface` (the canvas, `null` headless), `pixelRatio`, `resolutionScale`, `setSize(w, h)` (`OffscreenCanvas` only), `features`,
`requireFeature(name)`, `warmUp(materials)`, `pickAsync(x, y, options?)`, `captureScreenshot()`,
`drawCalls`, `gpuFrameTimeMs`, `profileTasks`, `taskTimings()`.

The `rendering` section is read once, at `createApp`: `features` (`shadows`, `postProcessing`,
`skeletons`, `boneControl`, `stencil`, `lightmaps`, `materialPlugins`, `asyncPipelines`,
`deviceLostRecovery` — all `false` by default and refused after start with `IGX-0704`),
`msaaSamples` (1 or 4, default 4),
`alphaMode`, `srgb`, `format`, `maxDevicePixelRatio`, `useHighPrecisionMatrix`, `useFloatingOrigin`,
`requiredLimits`, `clearColor` (a colour object; a `Camera.clearColor` beats an `Environment.clearColor`,
which beats this), `brdfLut` (`DEFAULT_BRDF_LUT_ADDRESS`). There is no
`powerPreference`. The `assets` section takes `root`, `preload`, `concurrency`, `gcDelay`, `retries`.

### `Script` callbacks and their timing

Callbacks are not members of `Script`; implement the ones you need, optionally with
`implements ScriptCallbacks` for signature checking.

| Callback                                                    | Timing in the frame                                              | How often          |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | ------------------ |
| `awake()`                                                   | Flush A of the first frame the component is effectively enabled  | Once per component |
| `onEnable()`                                                | Flush A, after `awake`, and on every later transition to enabled | Every transition   |
| `start()`                                                   | Flush B, after the fixed loop, before `update`                   | Once per component |
| `fixedUpdate(dt)`                                           | Inside the fixed loop; `dt === time.fixedDeltaTime`              | 0…N per frame      |
| `update(dt)`                                                | Update phase; `dt === time.deltaTime`                            | Once per frame     |
| `lateUpdate(dt)`                                            | After `update` and `PostUpdate`                                  | Once per frame     |
| `onDisable()`                                               | Synchronously at the transition, and in the destroy flush        | Every transition   |
| `onDestroy()`                                               | Destroy flush, after the tracked references are nulled           | Once               |
| `onApplicationPause(paused)`, `onApplicationFocus(focused)` | Visibility and focus changes                                     | Per transition     |
| `onCollisionEnter/Stay/Exit`, `onTriggerEnter/Exit`         | After the fixed step, by `@ignifx/physics` (see its skill)       | Per event          |

Statics (`static typeId`, `requires`, `allowMultiple`, `executionOrder`, `updateWhenPaused`) and callbacks are written plainly with no `override`: they are not members of `Component`/`Script`; the class-token types match them structurally (`ComponentStatics`, `ScriptStatics`) and the registry applies the defaults.

### Schema kinds

Declared with `Script.define({...})` / `Component.define({...})`. Every kind takes `FieldOptions`
last (`min`, `max`, `step`, `tooltip`, `group`, `hidden`, `readonly`, `transient`).

| Kind                                           | Field value                  | JSON encoding                                         |
| ---------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| `f32(d?)`, `f64(d?)`, `i32(d?)`, `u32(d?)`     | `number`                     | number (canonicalized; `NaN`/`Infinity` → `IGX-0601`) |
| `bool(d?)`                                     | `boolean`                    | boolean                                               |
| `str(d?)`                                      | `string`                     | string                                                |
| `vec2(d?)`, `vec3(d?)`, `vec4(d?)`, `quat(d?)` | `Vec2Like`…`QuatLike`        | array of numbers                                      |
| `color(d?)`                                    | `ColorLike`                  | `[r, g, b, a]` in sRGB 0–1                            |
| `enumOf(values, default)`                      | the string union             | the string value                                      |
| `entityRef<E>()`                               | `E \| null`, tracked         | `{ "$entity": "<uid>" }` or `null`                    |
| `componentRef(Type)`                           | `C \| null`, tracked         | `{ "$component": "<uid>" }` or `null`                 |
| `asset(TypeToken)`                             | `AssetHandle<A> \| null`     | `{ "$asset": "<address>" }` or `null`                 |
| `array(item, d?)`                              | `T[]`                        | array                                                 |
| `record(fields)`, `map(value)`                 | struct / `Record<string, T>` | object                                                |
| `optional(inner)`                              | `T \| null`                  | inner encoding or `null`                              |
| `layerMask(names?)`                            | `readonly string[]`          | array of layer names                                  |
| `curve(d?)`                                    | `CurveValue`                 | `{ "keys": [[t, v, inTangent, outTangent], …] }`      |
| `custom(codec)`                                | whatever the codec returns   | whatever `serialize` returns                          |

### `Time` (`app.time`)

| Property                                      | Meaning                                             | Default |
| --------------------------------------------- | --------------------------------------------------- | ------- |
| `deltaTime` / `unscaledDeltaTime`             | Scaled / clamped-but-unscaled frame delta           | —       |
| `fixedDeltaTime`                              | One fixed step; writable between frames             | `1/60`  |
| `maximumDeltaTime`                            | Clamp on a raw frame delta; writable                | `0.1`   |
| `timeScale`                                   | Scaled = unscaled × this; writable, `0` freezes     | `1`     |
| `paused`                                      | Set via `app.pause()` / `app.resume()`              | `false` |
| `time` / `unscaledTime` / `fixedTime`         | Seconds since the first frame                       | `0`     |
| `realtimeSinceStartup`                        | Wall clock, unaffected by pause or `timeScale`      | —       |
| `frameCount`, `inFixedStep`, `fixedStepAlpha` | Frame counter, fixed-loop flag, interpolation alpha | —       |

### `Signal<T>`

`connect(handler, options?)` returns a `Disconnect`; `ConnectOptions` is `{ once?, deferred?, owner? }`.
`emit(value)` is synchronous unless the connection is `deferred` (delivery moves to the next
`EndOfFrame`; a standalone signal throws `IGX-0103`). `disconnect(handler)`, `clear()`,
`connectionCount`, `owner`. Always pass `owner: this` from a script.

### Coroutines

`startCoroutine(routine)` / `stopCoroutine(handle)` / `stopAllCoroutines()` on a `Script`, plus the
`app.coroutines` host. A `Coroutine` is `Generator<CoroutineYield, void, unknown>`.

| Yield                                 | Resumes                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `yield` / `yield null`                | Next frame, after every `update()`                                                         |
| `waitSeconds(s)`                      | After `s` scaled seconds (inclusive, relative `1e-6` tolerance)                            |
| `waitSecondsRealtime(s)`              | After `s` unscaled seconds                                                                 |
| `waitFixedUpdate()`                   | After the next fixed step                                                                  |
| `waitUntil(pred)` / `waitWhile(pred)` | When the predicate flips, checked in the Update phase                                      |
| `yield handle`                        | When that coroutine finishes                                                               |
| `yield promise`                       | First `Update` after it settles; the value is the `yield` result, a rejection is thrown in |

### `defineExtension`

```ts
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

| Range  | Area                           | Range         | Area                               |
| ------ | ------------------------------ | ------------- | ---------------------------------- |
| `01xx` | Lifecycle, app, time           | `06xx`        | Serialization and schemas          |
| `02xx` | Components and registration    | `07xx`        | Rendering (`IGX-0701` = no WebGPU) |
| `03xx` | Scenes, layers, parenting      | `08xx`–`13xx` | Input, physics, audio, 2D, 3D, UI  |
| `04xx` | Extensions, services, settings | `14xx`–`15xx` | Platform, devtools                 |
| `05xx` | Assets                         | `9xxx`        | Third-party extensions             |

`CoreErrorCode` names every kernel code; `CORE_ERROR_MESSAGES` holds the templates. Runtime failures inside callbacks, coroutines, systems, extensions, and the asset pipeline reach `app.onError` as an `ErrorReport` rather than being thrown at the caller.

## Recipes

| Recipe (generated from `examples/recipes/`, so it compiles) | Task                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| [`load-a-model`](references/recipes/load-a-model.md)        | Load a `.glb` and show it with a `Model` component                 |
| [`spawn-a-prefab`](references/recipes/spawn-a-prefab.md)    | Load a `.prefab.json` as a `SceneAsset` and stamp copies of it out |

## File formats

| Page                                                                                                                                                                                                                    | Covers                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`formats/scene.md`](references/formats/scene.md)                                                                                                                                                                       | `.scene.json` / `.prefab.json`: entities, instances, overrides                    |
| [`formats/ignifx.scene.md`](references/formats/ignifx.scene.md)                                                                                                                                                         | The scene file's top-level fields (generated)                                     |
| [`formats/material.md`](references/formats/material.md)                                                                                                                                                                 | `.material.json`: PBR and Standard, texture slots                                 |
| [`formats/ignifx.material.md`](references/formats/ignifx.material.md)                                                                                                                                                   | The material file's fields (generated)                                            |
| [`formats/ignifx.environment.md`](references/formats/ignifx.environment.md)                                                                                                                                             | `.environment.json`: IBL, BRDF table, skybox (generated)                          |
| [`formats/inputactions.md`](references/formats/inputactions.md)                                                                                                                                                         | `.input.json`: maps, actions, paths, composites, processors                       |
| [`formats/ignifx.audiobuses.md`](references/formats/ignifx.audiobuses.md)                                                                                                                                               | `.audio.json`: the bus tree (`Master` root, volumes, children)                    |
| [`formats/ignifx.physicsmaterial.md`](references/formats/ignifx.physicsmaterial.md)                                                                                                                                     | `.physicsmaterial.json`: friction, restitution, combine rules                     |
| [`formats/ignifx.spriteatlas.md`](references/formats/ignifx.spriteatlas.md) · [`ignifx.spriteanimation.md`](references/formats/ignifx.spriteanimation.md) · [`ignifx.tilemap.md`](references/formats/ignifx.tilemap.md) | `.atlas.json`, `.spriteanim.json`, `.tilemap.json`: 2D frames, clips, tile layers |
| [`formats/ignifx.i18n.md`](references/formats/ignifx.i18n.md)                                                                                                                                                           | `.i18n.json`: every locale's messages, ICU-style plurals                          |
| [`formats/ignifx.animator.md`](references/formats/ignifx.animator.md)                                                                                                                                                   | `.animator.json`: parameters, layers, states, transitions, 1D blend trees         |
| [`formats/components.md`](references/formats/components.md)                                                                                                                                                             | Every built-in component's fields and defaults (generated)                        |
| [`formats/ignifx.schemas.json`](references/formats/ignifx.schemas.json)                                                                                                                                                 | All of the above bundled, for tools and validators                                |

`assets.manifest.json` (format `ignifx.manifest`, version 1) and the `.meta.json` sidecar are
documented in `@ignifx/vite-plugin`'s `README.md`, together with `virtual:ignifx/manifest` and
`virtual:ignifx/scripts`.

## Gotchas (top 16)

1. **Rendering features are declared before `app.start()`.** `shadows`, `postProcessing`,
   `skeletons`, `stencil`, `deviceLostRecovery` and the rest are `false` by default and refused
   afterwards with `IGX-0704`. Set `settings.rendering.features`, or call
   `ctx.requireRenderingFeature(name)` from an extension. `postProcessing` is the one people forget:
   a `PostProcessStack` without it logs `IGX-0710` and does nothing.
2. **A mesh added at runtime appears a few frames late.** Spike S2.2 measured **3 extra frames**
   for a cold material family against 0–2 for a warmed one. `app.start()` warms the `boot` preload
   group; use `app.renderer.warmUp(materials)` for anything loaded later (ADR-0014).
3. **One `Environment` per world** (a second logs `IGX-0705`), **point and hemispheric lights cast
   no shadows** (`IGX-0703`), and **a world with no enabled camera renders nothing** (`IGX-0706`).
4. **Assets are delivered in `PreUpdate` once the app runs.** A load requested in `update` is ready
   on the _next_ frame at the earliest, and `handle.value` throws `IGX-0501` until then. In a
   headless test that has called `app.start()`, nothing settles until you `app.step()`; `await`
   loads _before_ `start()` instead, where they settle as they finish.
5. **Pair every `load` with a `release`.** Handles are shared and reference-counted; `using` works.
   An `asset()` field is not a holder — the scene instance that loaded the asset releases it.
6. **`active = false` hides, `destroy()` removes.** Lite disposes a mesh removed from its last
   scene, permanently — never unhook Lite objects to hide something.
7. **`fixedUpdate` runs 0…N times per frame.** Integrate with its `dt` argument, never with
   `app.time.deltaTime`. And no `async` lifecycle callbacks: use a coroutine.
8. **`.lite` escape hatches are unstable.** `app.lite`, `world.lite`, `transform.lite`,
   `asset.lite` expose Babylon Lite objects with no stability guarantee; ask for a first-class API.
9. **WebGPU only, no fallback.** Probe with `isWebGpuAvailable()`; `createApp({ canvas })` rejects
   with `IGX-0701` when no adapter is available.
10. **Degrees in the public API; world getters allocate.** A radian API carries a `Rad` suffix, and
    `transform.position`/`.forward`/… allocate — use `positionToRef(out)` in hot paths.
11. **Browsers start audio locked.** `app.audio.state` is `"locked"` until a user gesture or `app.audio.unlock()`; plays made before then are queued, not lost. Headless apps are never locked.
12. **Physics needs a completed fixed step and, by default, has no collision identities.** Queries throw `IGX-0902` before the first step; `collision.other` is `null` unless `physics({ collisionIdentities: "internal" })` is on, so triggers are the default gameplay mechanism; `MeshCollider` needs a GPU app.
13. **2D physics filters by the project's first sixteen layers only.** Rapier's interaction groups are 16 bits; a 2D collider on a higher layer logs `IGX-1152` and falls back to layer 0. Queries throw `IGX-1153` before the first fixed step, as in 3D.
14. **`twoD.pixelsPerUnit` is 100 by default**, so a 32-px sprite is 0.32 m; set it to your art's pixel size (16, 32) or everything looks tiny. 2D is +Y up in metres; the adapter flips into Lite's pixel space.
15. **A click on UI never reaches gameplay, but a drag does.** Input reads `pointerdown` from the canvas and the overlay is its sibling, while `pointermove`/`pointerup` come from the window — so the UI host sets `app.input.uiHasPointer` during such a drag and pointing-device actions read as released. Pointer positions are backing-store pixels, the space `pickAsync` and `worldToScreen` use. Only _text_ fields set `app.input.uiHasFocus`. `WorldText` must exist before `app.start()` (`IGX-1308`); spawn `WorldText2D` mid-game instead.
16. **Two `Model`s of one `.glb` cannot be animated independently.** Lite binds an animation group to one manager and a cloned skinned mesh shares the template's skeleton, so a second `Animator` is refused the clips (reported on `app.onError`). Load the `.glb` under a second address for a second animated character.

The full list, with error codes, is in [`references/gotchas.md`](references/gotchas.md).

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

| Topic                                 | Read                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame order, callbacks, `Time`        | [`references/concepts/lifecycle.md`](references/concepts/lifecycle.md)                                                                                                                                                                                                                                                                                                                                    |
| World, entities, scenes, prefabs      | [`references/concepts/scene-graph.md`](references/concepts/scene-graph.md)                                                                                                                                                                                                                                                                                                                                |
| Components, schemas, coroutines       | [`references/concepts/scripting.md`](references/concepts/scripting.md)                                                                                                                                                                                                                                                                                                                                    |
| Cameras, lights, meshes, the renderer | [`references/concepts/rendering.md`](references/concepts/rendering.md)                                                                                                                                                                                                                                                                                                                                    |
| Addresses, handles, loaders           | [`references/concepts/assets.md`](references/concepts/assets.md)                                                                                                                                                                                                                                                                                                                                          |
| Extensions, services, settings        | [`references/concepts/extensions.md`](references/concepts/extensions.md)                                                                                                                                                                                                                                                                                                                                  |
| Every exact signature                 | [`api/core.md`](references/api/core.md) · [`api/input.md`](references/api/input.md) · [`api/audio.md`](references/api/audio.md) · [`api/physics.md`](references/api/physics.md) · [`api/physics-2d.md`](references/api/physics-2d.md) · [`api/2d.md`](references/api/2d.md) · [`api/ui.md`](references/api/ui.md) · [`api/3d.md`](references/api/3d.md) · the subsystem skills under `packages/*/skills/` |
| Design rationale                      | `docs/architecture/`, `docs/adr/`                                                                                                                                                                                                                                                                                                                                                                         |

`docs/migrations/` exists only after 1.0.
