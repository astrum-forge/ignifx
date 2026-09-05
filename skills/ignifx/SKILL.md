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
modify code, scenes, or assets for an ignifx project. The engine is at its Phase 1 kernel: the app,
the frame loop, entities, transforms, components, scripts, schemas, coroutines, signals, layers, and
math are real; rendering, assets, input, physics, audio, and the toolkits arrive in later phases.

## Environment

| Item                | Value                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine version      | unreleased (`0.0.0`); Phase 1 kernel — `@ignifx/core` and the `ignifx` umbrella only                                                                      |
| Babylon Lite        | 1.27.0 (pinned; do not call Lite APIs directly outside adapter code)                                                                                      |
| Node / pnpm         | 24 LTS / 11                                                                                                                                               |
| Browser requirement | WebGPU (Chrome/Edge 113+, Safari 26+, Firefox 141+ Windows / 145+ Apple Silicon); Electron needs `--enable-unsafe-webgpu` (handled by `@ignifx/electron`) |
| Headless            | Node 24, no GPU: `createApp({ headless: true })` plus `app.step(dt)`                                                                                      |
| Commands            | `pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm build` · `pnpm check` (all gates)                                                                     |
| Helper scripts      | `node scripts/check-webgpu.mjs` · `node scripts/new-script.mjs <Name>`                                                                                    |

## Mental model

```
App (createApp) ─ owns ─▶ World ─ owns ─▶ SceneInstance* ─ owns ─▶ Entity* ─ has ─▶ Transform + Component*
                                                                                     └─ Script = Component with lifecycle callbacks
Frame: PreUpdate → awake/onEnable → [fixedUpdate × N] → start → update → coroutines
       → PostUpdate → lateUpdate → destroy flush → PreRender → render
```

- One obvious way per task; no globals: reach everything from `this.app`, `this.world`, `this.entity`.
- Units: metres, seconds, degrees. Left-handed, Y up, +Z forward. 2D is Y up with pixels-per-unit.
- Unity mapping: GameObject → `Entity`, MonoBehaviour → `Script`, prefab → instanced scene. Godot
  mapping: Node → `Entity`, PackedScene → scene asset, signal → `Signal`.
- Every phase runs every frame; only the fixed loop and the three script update callbacks pause.

## First app

A rendering app. `createApp` resolves once the WebGPU engine and every extension are ready;
`app.start()` hands the frame loop to Babylon Lite.

```ts
import { Script, createApp, f32 } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/** Spins its entity around Y. `speed` is a serialized field, in degrees per second. */
class Spinner extends Script.define({ speed: f32(90) }) implements ScriptCallbacks {
  static typeId = "demo/Spinner";

  update(dt: number): void {
    this.transform.rotate({ x: 0, y: this.speed * dt, z: 0 });
  }
}

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx needs a <canvas> element on the page.");
}

const app = await createApp({ canvas, extensions: [] });
app.registerComponents([Spinner]);

const cube = app.world.createEntity("Cube");
cube.addComponent(Spinner, { speed: 120 });

await app.start();
```

The same game logic without a GPU, which is how tests and tools run it:

```ts
import { Script, createApp, createManualClock, f32 } from "@ignifx/core";

class Spinner extends Script.define({ speed: f32(90) }) {
  static typeId = "demo/Spinner";

  update(dt: number): void {
    this.transform.rotate({ x: 0, y: this.speed * dt, z: 0 });
  }
}

const app = await createApp({ headless: true, clock: createManualClock() });
app.registerComponents([Spinner]);
const cube = app.world.createEntity("Cube");
cube.addComponent(Spinner);

await app.start();
for (let frame = 0; frame < 600; frame += 1) {
  app.step(1 / 60); // ten seconds, one fixed step per call
}
app.log.info("spun to", cube.transform.localEulerAngles.y);
app.dispose();
```

## Core APIs

### `createApp(options?): Promise<App>`

| Option       | Type                            | Default                          | Notes                                                                                 |
| ------------ | ------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `headless`   | `boolean`                       | `true` when no `canvas` is given | Lite's null engine; the only mode where `app.step` is legal                           |
| `canvas`     | `RenderSurface`                 | —                                | `HTMLCanvasElement \| OffscreenCanvas`; rejects `IGX-0701` when WebGPU is unavailable |
| `extensions` | `readonly Extension[]`          | `[]`                             | Registered after the implicit `coreExtension()`                                       |
| `settings`   | `SettingsInput`                 | `{}`                             | Sections: `layers`, `sortingLayers`, `time`                                           |
| `clock`      | `Clock`                         | `createPerformanceClock()`       | Tests pass `createManualClock()`                                                      |
| `mode`       | `"development" \| "production"` | `"development"`                  | Development adds phase timings, full messages, strict checks                          |
| `logSink`    | `LogSink`                       | `createConsoleSink()`            | `createMemorySink()` captures records in tests                                        |
| `logLevel`   | `LogThreshold`                  | `"info"`                         | Lowest level `app.log` writes; `"debug"` shows the kernel's own diagnostics           |

### `App`

| Member                                                  | What it is                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `world`, `time`, `settings`, `diagnostics`, `log`       | The world, the `Time` service, resolved settings, counters, the logger         |
| `services`, `coroutines`, `platform`, `version`         | `ServiceRegistry`, `CoroutineHost`, `{ kind: "browser" \| "node" }`, `VERSION` |
| `start()`, `stop()`, `pause()`, `resume()`, `dispose()` | `start` is `async`; `stop` may be followed by `start` again                    |
| `step(deltaSeconds)`                                    | Headless only; throws `IGX-0105` otherwise                                     |
| `registerComponents(types)`                             | Makes game components known to the registry                                    |
| `isRunning`, `isHeadless`                               | Loop and mode state                                                            |
| `onError`                                               | `Signal<ErrorReport>` — every callback, coroutine, system, extension failure   |
| `lite`                                                  | `{ engine, scene }`; unstable escape hatch                                     |

### `Entity`

| Group      | Members                                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy  | `parent`, `children`, `setParent(parent, options?)`, `root()`, `isDescendantOf(other)`, `findChild(predicate, deep?)`, `find(path)`                                                                            |
| Components | `addComponent(Type, init?)`, `getComponent`, `requireComponent`, `getComponents`, `getComponentInChildren`, `getComponentsInChildren`, `getComponentInParent`, `hasComponent`, `removeComponent`, `components` |
| Lifecycle  | `active`, `activeInHierarchy`, `isStatic`, `isDestroyed`, `destroy()`, `destroyImmediate()`                                                                                                                    |
| Identity   | `uid` (ULID), `handle`, `name`, `layer`, `tags`, `world`, `scene`, `transform`                                                                                                                                 |
| Signals    | `onChildAdded`, `onChildRemoved`, `onParentChanged`, `onActiveChanged`, `onDestroyed`                                                                                                                          |

`World` adds `createEntity(name?, options?)`, `getEntity(uid)`, `getEntityByHandle(handle)`,
`findByName`, `findAllByName`, `findByTag`, `components(Type)`, `activeScene`, `scenes`, `layers`,
`registry`, and the `onEntityCreated`/`onEntityDestroyed`/`onSceneLoaded`/`onSceneUnloaded` signals.

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
| `onCollisionEnter/Stay/Exit`, `onTriggerEnter/Exit`         | Declared now; delivered by `@ignifx/physics` later               | Per event          |

Statics on a script class are written plainly — `static typeId`, `requires`, `allowMultiple`,
`executionOrder`, `updateWhenPaused` — with no `override` keyword. They are not members of
`Component`/`Script`; the class-token types match them structurally (`ComponentStatics`,
`ScriptStatics`) and the registry applies the defaults. Callbacks take no `override` either.

### Schema kinds

Declared with `Script.define({...})` / `Component.define({...})`. Every kind takes `FieldOptions`
last (`min`, `max`, `step`, `tooltip`, `group`, `hidden`, `readonly`, `transient`).

| Kind                                           | Field value                  | JSON encoding                                            |
| ---------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `f32(d?)`, `f64(d?)`, `i32(d?)`, `u32(d?)`     | `number`                     | number (canonicalized; `NaN`/`Infinity` → `IGX-0601`)    |
| `bool(d?)`                                     | `boolean`                    | boolean                                                  |
| `str(d?)`                                      | `string`                     | string                                                   |
| `vec2(d?)`, `vec3(d?)`, `vec4(d?)`, `quat(d?)` | `Vec2Like`…`QuatLike`        | array of numbers                                         |
| `color(d?)`                                    | `ColorLike`                  | `[r, g, b, a]` in sRGB 0–1                               |
| `enumOf(values, default)`                      | the string union             | the string value                                         |
| `entityRef<E>()`                               | `E \| null`, tracked         | `{ "$entity": "<uid>" }` or `null`                       |
| `componentRef(Type)`                           | `C \| null`, tracked         | `{ "$component": "<uid>" }` or `null`                    |
| `asset(TypeToken)`                             | `AssetRefValue<A> \| null`   | `{ "$asset": "<address>" }` or `null` (loads in Phase 2) |
| `array(item, d?)`                              | `T[]`                        | array                                                    |
| `record(fields)`, `map(value)`                 | struct / `Record<string, T>` | object                                                   |
| `optional(inner)`                              | `T \| null`                  | inner encoding or `null`                                 |
| `layerMask(names?)`                            | `readonly string[]`          | array of layer names                                     |
| `curve(d?)`                                    | `CurveValue`                 | `{ "keys": [[t, v, inTangent, outTangent], …] }`         |
| `custom(codec)`                                | whatever the codec returns   | whatever `serialize` returns                             |

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

| Member                                              | Notes                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `connect(handler, options?)`                        | Returns a `Disconnect`; `ConnectOptions` is `{ once?, deferred?, owner? }`           |
| `emit(value)`                                       | Synchronous unless the connection is `deferred`                                      |
| `disconnect(handler)`, `clear()`, `connectionCount` | Housekeeping                                                                         |
| `owner`                                             | Any `SignalOwner` — every `Entity` and `Component` is one; always pass `owner: this` |
| `deferred: true`                                    | Delivery moves to the next `EndOfFrame`; needs the app's queue, else `IGX-0103`      |

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
    ctx.registerSystem({ name: "game/demo.tick" }, { phase: Phase.Update, order: 1001 });
  },
}));
```

`ExtensionContext` offers `app`, `log`, `registerComponent(s)`, `registerSystem`, `registerService`,
`defineAppProperty`, `registerSettings`, `settings`, `require`, `tryGet`, `registerErrorCodes`, and
`onDispose`. Registration order errors: `IGX-0402` (`requires` cycle), `IGX-0403` (missing),
`IGX-0404` (engine range), `IGX-0406` (duplicate name), `IGX-0401` (app property defined twice).

### Errors

Misuse throws `IgnifxError` with a stable `code`, a `context` record, and a `hint`; `isIgnifxError`
narrows an `unknown`. Codes are `IGX-####`, where the first two digits are the area.

| Range  | Area                           | Range         | Area                               |
| ------ | ------------------------------ | ------------- | ---------------------------------- |
| `01xx` | Lifecycle, app, time           | `06xx`        | Serialization and schemas          |
| `02xx` | Components and registration    | `07xx`        | Rendering (`IGX-0701` = no WebGPU) |
| `03xx` | Scenes, layers, parenting      | `08xx`–`13xx` | Input, physics, audio, 2D, 3D, UI  |
| `04xx` | Extensions, services, settings | `14xx`–`15xx` | Platform, devtools                 |
| `05xx` | Assets                         | `9xxx`        | Third-party extensions             |

`CoreErrorCode` names every code the kernel throws and `CORE_ERROR_MESSAGES` holds their templates.
Runtime failures inside callbacks, coroutines, systems, and extensions are reported through
`app.onError` as an `ErrorReport` rather than thrown at the caller.

## Recipes

Task-oriented recipes arrive in Phase 11, generated from `examples/recipes/`.

## File formats

Scene, prefab, material, atlas, tilemap, input, and animator formats arrive in Phase 2; schema value
encoding is documented in [`references/concepts/scripting.md`](references/concepts/scripting.md) §4.

## Gotchas (top 10)

1. **`fixedUpdate` runs 0…N times per frame.** Integrate with its `dt` argument, never with
   `app.time.deltaTime`.
2. **No `async` lifecycle callbacks.** A promise continuation lands outside every phase; use a
   coroutine and `yield waitSeconds(…)` or `yield promise`.
3. **`.lite` escape hatches are unstable.** `app.lite`, `world.lite`, `transform.lite` expose
   Babylon Lite objects with no stability guarantee; ask for a first-class API instead.
4. **WebGPU only, no fallback.** Probe with `isWebGpuAvailable()`; `createApp({ canvas })` rejects
   with `IGX-0701` when no adapter is available.
5. **`active = false` hides, `destroy()` removes.** Lite disposes a mesh removed from its last
   scene, permanently — never unhook Lite objects to hide something.
6. **`start` order between unrelated scripts is not guaranteed.** Only `static executionOrder`
   and creation order are; coordinate with a `Signal`.
7. **`Signal.connect` inside a script needs `{ owner: this }`**, so the connection dies with the
   script. `{ deferred: true }` on a standalone signal throws `IGX-0103`.
8. **`entity.find(path)` is for tests and tools only.** Link objects with tracked `entityRef` /
   `componentRef` fields, or `requireComponent`.
9. **`app.step(dt)` is headless-only** (`IGX-0105` otherwise), and every member of a disposed app
   throws `IGX-0106`.
10. **Degrees in the public API; world getters allocate.** A radian API carries a `Rad` suffix, and
    `transform.position`/`.forward`/… allocate — use `positionToRef(out)` in hot paths.

The full list, with error codes, is in [`references/gotchas.md`](references/gotchas.md).

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

| Topic                               | Read                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Frame order, callbacks, `Time`      | [`references/concepts/lifecycle.md`](references/concepts/lifecycle.md)     |
| World, entities, transforms, layers | [`references/concepts/scene-graph.md`](references/concepts/scene-graph.md) |
| Components, schemas, coroutines     | [`references/concepts/scripting.md`](references/concepts/scripting.md)     |
| Extensions, services, settings      | [`references/concepts/extensions.md`](references/concepts/extensions.md)   |
| Assets (Phase 2)                    | [`references/concepts/assets.md`](references/concepts/assets.md)           |
| Every exact signature               | [`references/api/core.md`](references/api/core.md)                         |
| Design rationale                    | `docs/architecture/`, `docs/adr/`                                          |

`docs/migrations/` exists only after 1.0.
