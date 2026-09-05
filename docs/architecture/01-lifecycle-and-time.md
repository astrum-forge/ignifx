# 01 · Lifecycle and Time

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/core` · **Related:** ADR-0003, `03-scripting-and-components.md`, `09-physics.md`

This document is the single definition of *when things happen*. Extensions plug into the phases defined here; they never invent their own loop (`CONSTITUTION.md` §3.2).

---

## 1. Who drives the loop

| Mode | Driver | How a frame starts |
|---|---|---|
| Browser / Electron | Babylon Lite's `startEngine(engine)` requestAnimationFrame loop | Lite calls the one `onBeforeRender(renderScene, cb)` callback ignifx registered; `cb(deltaMs)` runs the whole ignifx frame, then returns so Lite records and submits the GPU frame |
| Headless (tests, servers, tools) | `app.step(deltaSeconds)` called by user code | ignifx runs the same frame function; Lite's null engine and `stepScene` are used only for the physics simulation scene |
| Worker (post-MVP) | Same as browser with an `OffscreenCanvas` | unchanged |

Rules:

- ignifx registers **exactly one** Lite before-render callback on the render scene per world. All ignifx work happens inside it, in the order of §3. Extensions never call `onBeforeRender` themselves. (The physics simulation scene carries Lite's own Havok step callback, which ignifx *drives* through `stepScene` and never registers; see `09-physics.md` §1.)
- Because Lite runs callbacks registered *later* first, the world registers its callback after every extension has finished `register()` and before `startEngine`; the adapter asserts this in development builds.
- `app.start()` applies rendering feature opt-ins, runs extension `onStart` hooks, then awaits `registerScene(renderScene)` (or `registerSceneWithShadowSupport`) and `startEngine(engine)`; `app.stop()` calls `stopEngine`. `app.dispose()` follows the order in `07-rendering.md` §7 (physics before scene, audio independently).

## 2. The `Time` service (`app.time`)

All values are **seconds** unless the name ends in `Ms`.

| Property | Meaning | Default |
|---|---|---|
| `deltaTime` | Scaled time since the previous frame; what `update`/`lateUpdate` receive | — |
| `unscaledDeltaTime` | Wall-clock frame delta after the `maximumDeltaTime` clamp | — |
| `fixedDeltaTime` | Size of one fixed step; what `fixedUpdate` receives | `1/60` |
| `timeScale` | Multiplier applied to `unscaledDeltaTime` to produce `deltaTime`; `0` freezes scaled time and fixed steps | `1` |
| `maximumDeltaTime` | Upper clamp on a frame delta. Larger real gaps (tab switch, breakpoint) are dropped, so the game slows instead of spiralling | `0.1` |
| `time` | Scaled seconds since `app.start()` | — |
| `unscaledTime` | Unscaled seconds since `app.start()` | — |
| `fixedTime` | Scaled seconds advanced by fixed steps so far | — |
| `realtimeSinceStartup` | `performance.now()`-based wall clock since app creation, unaffected by pause | — |
| `frameCount` | Number of frames started | `0` |
| `inFixedStep` | `true` while `fixedUpdate` and physics run | `false` |
| `fixedStepAlpha` | `accumulator / fixedDeltaTime` after the fixed loop, in `[0, 1)`; used for interpolation | — |
| `paused` | When `true`, phases `FixedUpdate`…`LateUpdate` skip scripts unless the script sets `static updateWhenPaused = true`; unscaled time keeps running | `false` |

Setting `fixedDeltaTime` at runtime is allowed between frames only (a set during a frame takes effect at the next frame start). The physics extension mirrors it into `setPhysicsTimestep`.

## 3. Frame order

The frame function runs top to bottom. "Scripts" means every enabled `Script` in the world, sorted by `(executionOrder ascending, creation serial ascending)`. "Systems(Phase)" means the systems extensions registered for that phase, sorted by their registration `order`.

```
FRAME START  (Lite callback or app.step)
 0. EndOfFrame work carried over from the previous frame            Systems(EndOfFrame)
 1. Time.beginFrame(rawDelta)
      unscaledDeltaTime = min(rawDelta, maximumDeltaTime)
      deltaTime = unscaledDeltaTime * timeScale
      time += deltaTime; unscaledTime += unscaledDeltaTime; frameCount++
 2. PreUpdate                                                       Systems(PreUpdate)
      input polls devices and resolves action states for this frame
      assets delivers completed loads and hot-reload swaps on the main thread
 3. Lifecycle flush A
      awake()   for components added since the last flush that are in an active hierarchy
      onEnable() for components that became effectively enabled
 4. Fixed loop
      accumulator += deltaTime
      while accumulator >= fixedDeltaTime:
          inFixedStep = true; fixedTime += fixedDeltaTime
          Systems(FixedUpdate, order < 0)      e.g. physics restores authoritative poses
          scripts.fixedUpdate(fixedDeltaTime)
          Systems(FixedUpdate, order >= 0)     e.g. physics steps the simulation scene
          physics event dispatch → scripts.onCollisionEnter/Stay/Exit, onTriggerEnter/Exit
          coroutines waiting on WaitForFixedUpdate resume
          accumulator -= fixedDeltaTime
      inFixedStep = false; fixedStepAlpha = accumulator / fixedDeltaTime
 5. Lifecycle flush B
      start()   for effectively-enabled scripts that have not started yet
 6. Update                                                          Systems(Update, order < 0)
      scripts.update(deltaTime)
      coroutines waiting on next frame / WaitForSeconds / WaitUntil / promises resume
                                                                    Systems(Update, order >= 0)
 7. PostUpdate                                                      Systems(PostUpdate)
      animation: AnimationManager and SpriteAnimationManager advance by deltaTime;
      Animator state machines evaluate; tweens advance
 8. LateUpdate
      scripts.lateUpdate(deltaTime)
 9. Destroy flush
      onDisable() then onDestroy() for components/entities queued by destroy() this frame,
      children before parents; Lite objects removed from the render scene; assets released
10. PreRender                                                       Systems(PreRender)
      physics interpolation writes display poses (alpha = fixedStepAlpha)
      2D adapter syncs sprite instances from transforms; camera adapter syncs viewport/ortho
      audio pumps updateSpatialAudio; ui syncs; diagnostics samples counters
RETURN to Lite → frame graph executes and the frame is presented (no render in headless)
```

Notes:

- **Why physics is split around `fixedUpdate`.** Scripts write forces, velocities, and `CharacterController.move()` requests in `fixedUpdate`; the physics system then steps once with `fixedDeltaTime`; collision and trigger callbacks fire immediately after that step, still inside the fixed loop, so a script can react in the same step.
- **Why animation sits between `update` and `lateUpdate`.** `lateUpdate` is where camera follow logic and bone-relative attachments read final poses. This matches Unity. Babylon Lite would otherwise advance glTF animation *after* our callback; the adapter therefore detaches animation groups from Lite's scene-owned ticking and advances them itself (`12-3d-toolkit.md` §Animator).
- **Destroy before render** matches Unity: an entity destroyed during frame N is not drawn in frame N.
- The fixed loop is bounded by `maximumDeltaTime`; with defaults, at most six fixed steps run per frame. Dropped time is reported in diagnostics.
- The accumulator snaps to the nearest multiple of `fixedDeltaTime` whenever it is within `1e-6 × fixedDeltaTime` of one, so floating-point drift never produces a spurious zero- or double-step frame.

## 4. Script callbacks

| Callback | When | Runs how often |
|---|---|---|
| `awake()` | Right after the component is attached to an entity that is active in the hierarchy inside a loaded world. During scene load, after **all** entities and components of that scene instance are constructed and deserialized, in tree order (parents before children, siblings in file order). Scene-load references are guaranteed resolved. | Once per component |
| `onEnable()` | After `awake`, and whenever the component becomes effectively enabled (`component.enabled && entity.activeInHierarchy`) | Every transition |
| `start()` | In the first frame in which the component is effectively enabled, in flush B (after the fixed loop, before `update`) | Once per component |
| `fixedUpdate(dt)` | Each fixed step, `dt === time.fixedDeltaTime` | 0…N per frame |
| `update(dt)` | Each frame, `dt === time.deltaTime` | Once per frame |
| `lateUpdate(dt)` | Each frame after animation | Once per frame |
| `onDisable()` | When the component stops being effectively enabled, including just before destruction and when the app stops | Every transition |
| `onDestroy()` | In the destroy flush of the frame in which `destroy()` was called (or immediately for `destroyImmediate`) | Once |
| `onCollisionEnter/Stay/Exit(collision)` | Inside the fixed loop after the physics step, on scripts attached to either entity involved | Per contact event |
| `onTriggerEnter/Exit(other)` | Same timing, for trigger shapes | Per overlap event |
| `onApplicationPause(paused)` | When the document becomes hidden/visible (browser) or the window is minimized/restored (Electron) | Per transition |
| `onApplicationFocus(focused)` | On window focus change | Per transition |

Guarantees and constraints:

- A callback never runs on a component whose entity is inactive in the hierarchy, and never on a component whose `enabled` is `false`, except `onDisable`/`onDestroy`.
- For the hierarchy present when a scene instance loads (or a prefab is instantiated), `awake` runs in tree order: an entity's components in component order, and a parent's `awake` calls finish before its children's start. Entities or components created *from inside* a callback are the documented exception: their `awake` runs nested and synchronously, before the creating callback returns. `start` order follows script `executionOrder`, then creation order. Do not depend on `start` order between unrelated scripts; use signals or explicit initialization instead.
- Adding a component from inside a callback runs that component's `awake` immediately (synchronously) if its entity is active; its `start` waits for the next flush B.
- Calling `destroy()` from inside any callback is safe; the object stays valid until the destroy flush of the current frame. `isDestroyed` becomes `true` immediately.
- Callbacks receive `dt` in seconds. Never read `app.time.deltaTime` inside `fixedUpdate` for integration; use the argument.

## 5. Coroutines

Frame-sequenced logic uses generator coroutines resumed synchronously by the scheduler at defined points, never `async` functions (a promise continuation runs after the entire frame, outside any phase).

```ts
class Door extends Script {
  *open() {
    this.audio.play("creak");
    yield waitSeconds(0.5);                // scaled time
    this.transform.localPosition.y += 2;
    yield;                                 // next frame, after update()
    yield waitUntil(() => this.player.isFar());
    yield waitFixedUpdate();
  }
  onEnable() { this.startCoroutine(this.open()); }
}
```

- Resume points: `yield` / `yield null` → next frame after all `update()`s; `waitSeconds(s)` / `waitSecondsRealtime(s)`; `waitFixedUpdate()` → after the next fixed step; `waitUntil(pred)` / `waitWhile(pred)`; `yield coroutineHandle` → when that coroutine finishes; `yield promise` → the first `Update` phase after the promise settles (result delivered as the `yield` expression value).
- A coroutine is **paused** while its script is not effectively enabled and **cancelled** when the script or entity is destroyed. `stopCoroutine(handle)` and `stopAllCoroutines()` exist.
- Exceptions inside a coroutine surface through `app.onError` with the script and entity identified; the coroutine is cancelled.
- On `app.dispose()`, world teardown, or scene unload, every affected coroutine is cancelled and any promise it was waiting on is detached (its continuation never runs). Asset promises owned by a disposed app reject with `IGX-0503`.

## 6. Activation, enabling, and destruction

- `entity.active` is the entity's own flag; `entity.activeInHierarchy` is `active && parent.activeInHierarchy`. Setting `active = false` on a parent disables every descendant's components (`onDisable`), hides its Lite subtree via `setSubtreeVisible`, and pauses their coroutines. Re-activating reverses this (`onEnable`; `start` still runs only once ever).
- `component.enabled` toggles one component. `Transform` cannot be disabled or removed.
- `entity.destroy()` queues the entity and its whole subtree. `component.destroy()` queues one component. Both are processed in the destroy flush (§3 step 9). Queued objects report `isDestroyed === true` immediately and throw `IGX-0101` on further mutation.
- `destroyImmediate()` performs the destroy flush for that object right now. It exists for tooling and tests and is forbidden inside lifecycle callbacks (throws `IGX-0102`).
- Destroying a `SceneInstance` (`world.unloadScene(instance)`) destroys its root entities the same way and releases the assets the scene loaded.

## 7. Pausing and focus

- `app.pause()` sets `time.paused = true`; `app.resume()` clears it. While paused, scripts with `static updateWhenPaused = true` still receive `update`/`lateUpdate` (menus, pause screens); fixed steps and physics do not run; animation does not advance unless the `Animator` is marked `updateWhenPaused`.
- Browsers throttle or stop `requestAnimationFrame` in background tabs; the `maximumDeltaTime` clamp guarantees the simulation does not try to catch up when the tab returns. `onApplicationPause(true)` is delivered when the document becomes hidden, and templates pause by default.
- Electron windows behave like browser tabs; the Electron extension forwards minimize/restore to the same callbacks.

## 8. Headless stepping

```ts
const app = await createApp({ headless: true, extensions: [physics()] });
await app.start();
for (let i = 0; i < 600; i++) app.step(1 / 60);   // deterministic: rawDelta = 1/60 each call
```

- `app.step(dt)` runs §3 with `rawDelta = dt` and no render. Because of the accumulator snapping rule (§3 notes), a fixed `dt` equal to `fixedDeltaTime` runs exactly one fixed step per call.
- Headless mode uses Lite's null engine for the render scene as well, so components that wrap Lite objects still construct (meshes without GPU geometry are skipped by the adapter with a diagnostic, never an error).
- Tests must not depend on wall-clock time; `Time` is injected with a fake clock in headless mode.

## 9. Diagnostics emitted by the loop

`app.diagnostics.frame` publishes, per frame: `rawDeltaMs`, `droppedMs`, `fixedSteps`, `scriptsUpdated`, `coroutinesResumed`, `destroyed`, and per-phase CPU time in development builds. Lite supplies `drawCallCount` and `gpuFrameTimeMs` (when GPU timing is enabled).
