# Lifecycle and time

When things happen in a frame, which callbacks a `Script` may implement, and how a headless app is
stepped. Engine `0.0.0`; rationale in `docs/architecture/01-lifecycle-and-time.md`.

## 1. Frame order

One frame runs top to bottom, driven by Babylon Lite's render loop in a browser and by `app.step(dt)`
headless. "Scripts" means every effectively enabled `Script`, ordered by `(static executionOrder
ascending, creation order ascending)`.

1. **EndOfFrame** — `Phase.EndOfFrame` systems; deferred signal handlers queued last frame.
2. **Time begins** — `unscaledDeltaTime = min(rawDelta, maximumDeltaTime)`, `deltaTime = unscaledDeltaTime * timeScale`, `frameCount` increments.
3. **PreUpdate** — `Phase.PreUpdate` systems. The asset service delivers everything that finished
   loading since the previous frame here (`ignifx/asset-delivery`, order −900): handle states flip
   and `handle.promise` settles at this one point, never mid-phase.
4. **Lifecycle flush A** — `awake()` for components attached since the last flush that are effectively enabled, then `onEnable()` for components that just became effectively enabled.
5. **Fixed loop** — while the accumulator holds a whole step: `Phase.FixedUpdate` systems with `order < 0`, `fixedUpdate(fixedDeltaTime)` on scripts, `Phase.FixedUpdate` systems with `order >= 0`, then coroutines waiting on `waitFixedUpdate()`. Skipped entirely while `time.paused` is `true`.
6. **Lifecycle flush B** — `start()` for effectively enabled scripts that have never started.
7. **Update** — `Phase.Update` systems with `order < 0`, `update(deltaTime)` on scripts, coroutine resumes (`yield`, `waitSeconds`, `waitUntil`, `waitWhile`, settled promises), then `Phase.Update` systems with `order >= 0`.
8. **PostUpdate** — `Phase.PostUpdate` systems (animation lands here in a later phase).
9. **LateUpdate** — `lateUpdate(deltaTime)` on scripts.
10. **Destroy flush** — tracked `entityRef`/`componentRef` fields pointing at doomed objects are nulled, then `onDisable()` and `onDestroy()` run for everything queued this frame, children before parents and, within an entity, components in attach order.
11. **PreRender** — `Phase.PreRender` systems, ending with `ignifx/render-sync` (order 900), which
    reconciles the render components with the Lite scene; the browser then renders.

Only steps 5, 7 and 9 are skipped while the app is paused (step 5 unconditionally): every other phase keeps running, so a pause screen still renders.

## 2. Script callbacks

Callbacks are **not** members of `Script`: implement the ones you need as ordinary methods and the
scheduler finds them by prototype inspection, once per class. `implements ScriptCallbacks` is
optional and only turns on signature checking.

| Callback          | When                                                                                                                                                | How often          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `awake()`         | Flush A of the first frame in which the component is effectively enabled; nested and synchronous when the component is added from inside a callback | Once per component |
| `onEnable()`      | Flush A, right after `awake`, and again after every transition back to effectively enabled                                                          | Every transition   |
| `start()`         | Flush B, after the fixed loop of that same frame                                                                                                    | Once per component |
| `fixedUpdate(dt)` | Each fixed step; `dt === time.fixedDeltaTime`                                                                                                       | 0…N per frame      |
| `update(dt)`      | Each frame; `dt === time.deltaTime`                                                                                                                 | Once per frame     |
| `lateUpdate(dt)`  | Each frame, after `update` and `PostUpdate`                                                                                                         | Once per frame     |
| `onDisable()`     | Synchronously at the transition away from effectively enabled, and in the destroy flush                                                             | Every transition   |
| `onDestroy()`     | Destroy flush of the frame `destroy()` was called in (at once for `destroyImmediate()`)                                                             | Once               |

`onApplicationPause(paused)`/`onApplicationFocus(focused)` fire per document-visibility or focus
transition; `onCollisionEnter/Stay/Exit` and `onTriggerEnter/Exit` are declared on `ScriptCallbacks`
now and delivered by `@ignifx/physics` in a later phase. Rules the kernel enforces:

- A component added with `enabled = false` receives **no** `awake` until it is first enabled.
- `start` never runs twice, even after a disable/enable cycle; a script destroyed during `update` does not receive `lateUpdate` that frame.
- `start` order between unrelated scripts is not guaranteed beyond `executionOrder`; use a `Signal`. Inside `fixedUpdate`, integrate with the `dt` argument, never with `app.time.deltaTime`.

## 3. Activation, enabling, destruction

| Concept                          | API                                                    | Effect                                                                                                  |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Entity flag / effective state    | `entity.active` / `entity.activeInHierarchy`           | Toggling `active` cascades `onEnable`/`onDisable` over the subtree                                      |
| Component flag / effective state | `component.enabled` / `component.isEnabledInHierarchy` | `Transform` cannot be disabled (`IGX-0205`)                                                             |
| Deferred destroy                 | `entity.destroy()` / `component.destroy()`             | Queued to the destroy flush; `isDestroyed` is `true` at once, and mutating afterwards throws `IGX-0101` |
| Immediate destroy                | `entity.destroyImmediate()`                            | Tools and tests only; throws `IGX-0102` inside a lifecycle callback                                     |

Tracked `entityRef`/`componentRef` fields are ordinary properties the engine sets to `null` in the destroy flush, before any `onDestroy`. Plain class fields are not tracked — check `isDestroyed`.

## 4. Pausing

`app.pause()` sets `time.paused`; `app.resume()` clears it. While paused the fixed loop does not run
at all and scripts skip `fixedUpdate`, `update`, and `lateUpdate` unless the class sets
`static updateWhenPaused = true`. Unscaled time keeps advancing and every other phase still
runs, so menus and pause screens render normally.

## 5. Headless stepping

`createApp({ headless: true })` uses Babylon Lite's null engine and renders nothing: GPU work is
skipped, `MeshRenderer`/`Model` keep their state without touching the scene, and screenshots reject
with `IGX-0707` (see [`rendering.md`](rendering.md) §7). `app.step(dt)`
runs one frame with `rawDelta = dt`; it throws `IGX-0105` on a rendering app and `IGX-0106` on a
disposed one. A constant `dt` equal to `time.fixedDeltaTime` runs exactly one fixed step per call,
which is what makes a headless run reproduce across Node and Chromium.

## 6. `Time` (`app.time`)

Seconds everywhere unless the name ends in `Ms`.

| Property                | Meaning                                                             | Writable | Default |
| ----------------------- | ------------------------------------------------------------------- | -------- | ------- |
| `deltaTime`             | Scaled seconds since the previous frame; what `update` receives     | no       | —       |
| `unscaledDeltaTime`     | Frame delta after the `maximumDeltaTime` clamp, before `timeScale`  | no       | —       |
| `fixedDeltaTime`        | Size of one fixed step; what `fixedUpdate` receives                 | yes      | `1/60`  |
| `maximumDeltaTime`      | Upper clamp on one frame's raw delta                                | yes      | `0.1`   |
| `timeScale`             | Multiplier from unscaled to scaled time; `0` freezes the simulation | yes      | `1`     |
| `paused`                | Set through `app.pause()`/`app.resume()`                            | yes      | `false` |
| `time` / `unscaledTime` | Scaled / unscaled seconds since the first frame                     | no       | `0`     |
| `fixedTime`             | Scaled seconds advanced by fixed steps                              | no       | `0`     |
| `realtimeSinceStartup`  | Wall clock since app creation, unaffected by pause or `timeScale`   | no       | —       |
| `frameCount`            | Frames started                                                      | no       | `0`     |
| `inFixedStep`           | `true` while the fixed loop is running                              | no       | `false` |
| `fixedStepAlpha`        | Leftover accumulator / `fixedDeltaTime`, in `[0, 1)`                | no       | —       |

Writing zero or a negative `fixedDeltaTime`/`maximumDeltaTime` throws `IGX-0108`.

## 7. Examples

A script implements only the callbacks it needs, and reports them through a `Signal`:

```ts run
import { Script, Signal } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

export class LifecycleProbe extends Script implements ScriptCallbacks {
  static typeId = "demo/LifecycleProbe";

  /** Emits the name of every callback this script receives. */
  readonly onCallback = new Signal<string>();

  awake(): void {
    this.onCallback.emit("awake");
  }

  update(dt: number): void {
    this.onCallback.emit(`update ${String(dt)}`);
  }

  onDestroy(): void {
    this.onCallback.emit("onDestroy");
  }
}
```

A deterministic headless loop, the shape every unit test uses:

```ts run
import { Script, createApp, createManualClock, f32 } from "@ignifx/core";

class Drift extends Script.define({ speed: f32(1) }) {
  static typeId = "demo/Drift";

  update(dt: number): void {
    this.transform.localPosition.z += this.speed * dt;
  }
}

const app = await createApp({ headless: true, clock: createManualClock() });
app.registerComponents([Drift]);
const entity = app.world.createEntity("Drifter");
entity.addComponent(Drift, { speed: 2 });

await app.start();
for (let frame = 0; frame < 600; frame += 1) {
  app.step(1 / 60);
}
app.log.info("z after 10 seconds", entity.transform.localPosition.z);
app.dispose();
```
