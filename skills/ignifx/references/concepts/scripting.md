# Scripting: components, schemas, coroutines

How game code is written: `Component` for data a system owns, `Script` for data with lifecycle callbacks, and a declarative schema instead of decorators (ADR-0004). Rationale in `docs/architecture/03-scripting-and-components.md`.

## 1. `Component` versus `Script`

|               | `Component`                                                       | `Script`                                                |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Callbacks     | `onAttach?()` / `onDetach?()` from the `ComponentHooks` interface | the `ScriptCallbacks` interface (see `lifecycle.md` §2) |
| Driven by     | a system an extension registered                                  | the kernel's scheduler                                  |
| Extra statics | `typeId`, `schema`, `requires`, `allowMultiple`                   | those plus `executionOrder`, `updateWhenPaused`         |

Both reach everything the same way from inside a method — `this.entity`, `this.transform`,
`this.world`, `this.app`, `this.uid`, `this.handle`, `this.enabled`, `this.isEnabledInHierarchy`,
`this.isDestroyed`, `this.onDestroyed`, `this.getComponent(Type)`, `this.requireComponent(Type)`,
`this.destroy()` — and there are no globals. Callbacks are found by prototype inspection, so an
empty `update() {}` costs a call per frame while not declaring it costs nothing.

## 2. Declaring serialized fields

`Script.define(schema)` / `Component.define(schema)` return a base class carrying the field types,
applying a fresh default per instance, and holding the schema for the serializer and the inspector.

```ts
import { Component, Script, array, componentRef, entityRef, enumOf, f32, i32, vec3 } from "@ignifx/core";
import type { Entity, ScriptCallbacks } from "@ignifx/core";

export class Health extends Component.define({ hitPoints: i32(100) }) {
  static typeId = "mygame/Health";
}

export class Mover
  extends Script.define({
    speed: f32(5, { min: 0, max: 50, tooltip: "Units per second" }),
    mode: enumOf(["walk", "run"] as const, "walk"),
    offset: vec3({ x: 0, y: 1, z: 0 }),
    target: entityRef<Entity>(),
    follow: componentRef(Health),
    waypoints: array(vec3()),
  })
  implements ScriptCallbacks
{
  static typeId = "mygame/Mover";
  static requires = [Health];
  static allowMultiple = false;
  static executionOrder = -10;

  /** Runtime-only state is an ordinary class field with a name no schema field uses. */
  private travelled = 0;

  update(dt: number): void {
    this.transform.translate({ x: 0, y: 0, z: this.speed * dt });
    this.travelled += this.speed * dt;
  }
}
```

Field kinds: `f32`, `f64`, `i32`, `u32`, `bool`, `str`, `vec2`, `vec3`, `vec4`, `quat`, `color`,
`enumOf`, `entityRef`, `componentRef`, `asset`, `array`, `record`, `map`, `optional`, `layerMask`, `curve`, `custom`. Every kind takes a `FieldOptions` object last: `min`, `max`, `step`, `tooltip`, `group`, `hidden`, `readonly`, `transient`.

Rules: a field name that collides with a `Component` member (`enabled`, `update`, …) throws
`IGX-0607` at definition time; `entityRef`/`componentRef` fields are **tracked**, so the engine nulls
them in the destroy flush when the target dies, before any `onDestroy` (plain class fields are not);
non-serialized state is an ordinary class field with a name no schema field uses; and changing a
schema is a file-format change, which before 1.0 simply invalidates old files (`CONSTITUTION.md` §4.2).

## 3. `typeId` and registration

- `typeId` is explicit and namespaced, `<package-or-game>/<Name>`, never derived from the class name
  (minifiers rename classes). A subclass writes it plainly: `static typeId = "mygame/Mover"`, with
  no `override` keyword. `Component`/`Script` deliberately do **not** declare these statics — under
  the mandated `noImplicitOverride` that would force `static override` on every one of them — so the
  class-token types (`ComponentStatics`, `ScriptStatics`) match them structurally and the registry
  reads them once per class. The same holds for `requires`, `allowMultiple`, `executionOrder`, and
  `updateWhenPaused`, and for lifecycle callbacks, which are not members of `Script` either.
- Register before any scene that uses the component loads: `app.registerComponents([Mover, Health])`
  from a game, `ctx.registerComponents([...])` from an extension. Two classes with the same `typeId`
  throw `IGX-0203`; serializing a class without one throws `IGX-0204`.
- `static requires = [Health]` auto-adds and validates dependencies on attach (`IGX-0201`);
  `static allowMultiple = false` limits the entity to one (`IGX-0202`).

## 4. Value encoding

What each kind becomes in a scene file. The full format, with instances and overrides, is in
[`../formats/scene.md`](../formats/scene.md).

| Kind                       | JSON                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `f32 f64 i32 u32`          | number (canonicalized to 1e-6; `NaN`/`Infinity` rejected with `IGX-0601`)                   |
| `bool` / `str`             | boolean / string                                                                            |
| `vec2 vec3 vec4 quat`      | array of numbers                                                                            |
| `color`                    | `[r, g, b, a]` in sRGB 0–1                                                                  |
| `enumOf`                   | the string value                                                                            |
| `entityRef`                | `{ "$entity": "<uid>" }` or `null`                                                          |
| `componentRef`             | `{ "$component": "<uid>" }` or `null`                                                       |
| `asset`                    | `{ "$asset": "<address>", "type"?: "<type>" }` or `null`                                    |
| `array` / `record` / `map` | array / object / object                                                                     |
| `optional`                 | the inner encoding or `null`                                                                |
| `layerMask`                | array of layer names, so renames survive                                                    |
| `curve` / `custom`         | `{ "keys": [[t, v, inTangent, outTangent], …] }` / whatever the codec's `serialize` returns |

The **runtime** value of an `asset()` field is the loaded `AssetHandle`, not the address: the scene
loader resolves every reference before it writes the props, so `awake` can read `this.mesh.value`
straight away. The field never owns the reference count — the scene instance that loaded the asset
releases it — and an in-code (`memory:`) asset serializes as `null` with `IGX-0602`. See
[`assets.md`](assets.md) §4.

## 5. Coroutines

Frame-sequenced logic uses generators resumed by the scheduler, never `async` methods (a promise continuation would run after the whole frame, outside every phase). `Coroutine` is `Generator<CoroutineYield, void, unknown>`.

```ts
import { Script, waitFixedUpdate, waitSeconds, waitUntil } from "@ignifx/core";
import type { Coroutine, ScriptCallbacks } from "@ignifx/core";

export class Door extends Script implements ScriptCallbacks {
  static typeId = "mygame/Door";

  private isOpen = false;

  *open(): Coroutine {
    yield waitSeconds(0.5); // scaled time; waitSecondsRealtime ignores timeScale
    this.transform.localPosition.y += 2;
    yield; // resume next frame, after every update()
    yield waitFixedUpdate(); // after the next fixed step
    yield waitUntil(() => this.isOpen);
  }

  start(): void {
    this.startCoroutine(this.open());
  }
}
```

- Resume points: `yield`/`yield null` (next frame), `waitSeconds`, `waitSecondsRealtime`,
  `waitFixedUpdate`, `waitUntil`, `waitWhile`, `yield someCoroutineHandle` (when it finishes), and
  `yield somePromise` (the first `Update` after it settles; the value is delivered as the `yield`
  expression, a rejection is thrown into the generator).
- Timed waits are inclusive with a relative `1e-6` tolerance, so `waitSeconds(1)` resumes on the frame
  that reaches one second, not the one after it. `startCoroutine` runs the body up to its first
  `yield` immediately, unless the owning script is not effectively enabled.
- A coroutine is paused while its script is not effectively enabled and cancelled when the script or
  entity is destroyed. `stopCoroutine(handle)`, `stopAllCoroutines()`, and the app-level
  `app.coroutines` host (`start`, `stop`, `stopAll`, `cancelAll`, `setPaused`) round it out. An
  exception inside a coroutine is reported through `app.onError` and cancels that coroutine only.

## 6. Tweens

`app.tweens` moves a value over time on ignifx's clock, so a coroutine that hand-rolls a lerp is
almost always the wrong shape. It lives in core, so both toolkits use it.

```ts
import { createApp } from "ignifx";

const app = await createApp({ headless: true });
const door = app.world.createEntity("Door");

const tween = app.tweens.to(
  door.transform,
  { position: { x: 0, y: 3, z: 0 } },
  { duration: 0.8, ease: "cubicInOut", onComplete: (): void => app.log.info("open") },
);
tween.onComplete.connect((finished): void => app.log.info("progress {p}", finished.progress));

await app.start();
app.step(0.4);
```

- **Targets** are any object. A field is tweenable when it is a `number`, or an object with
  `x`/`y`(`/z`(`/w`)) components — `Vec2`, `Vec3`, and `Quat`, and anything shaped like them.
  Quaternions **slerp** along the shortest arc; everything else interpolates component-wise. A field
  that is neither is `IGX-0110`, and a bad option is `IGX-0109`.
- **Options.** `duration` (seconds, required), `ease`, `delay`, `loop`, `yoyo`, `updateWhenPaused`,
  `onComplete`. `loop` counts _extra_ cycles, so `loop: 2` runs three; `-1` repeats until stopped.
- **Easing** is a name from `EASING_NAMES` — `linear`, `quadIn/Out/InOut`, `cubicIn/Out/InOut`,
  `sineInOut`, `backOut`, `elasticOut`, `bounceOut` — or your own `(t: number) => number`.
- **The handle** has `pause()`, `resume()`, `stop()`, `complete()`, `progress`, `isPlaying`,
  `isPaused`, `isDone`, and `onComplete`. `stop()` leaves the value where it stands and never
  completes; `complete()` jumps to the end and fires. `app.tweens.stopAll()` and
  `stopAllOf(target)` clear them in bulk.
- **Timing.** Tweens advance in `PostUpdate`, ahead of both toolkits' animation systems, on
  `time.deltaTime` — so `time.timeScale` slows them and `app.pause()` freezes them. A tween created
  with `updateWhenPaused: true` runs on `time.unscaledDeltaTime` instead, which is what a menu
  animation wants. Every tween dies with the app.
- **Start values are latched when the delay elapses**, not when the tween is created, so two tweens
  queued on one property chain rather than fight.

## 7. Patterns and anti-patterns

| Do                                                                      | Instead of                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Cache lookups in `awake`: `this.health = this.requireComponent(Health)` | calling `getComponent` every frame                       |
| Emit a `Signal` upward, call methods downward                           | name-based messaging or a broadcast helper               |
| Link objects with `entityRef`/`componentRef`                            | `entity.find("Body/Arm.L")` outside tests and tools      |
| Keep `fixedUpdate` pure simulation, integrating with its `dt`           | `app.time.deltaTime` or wall-clock time inside it        |
| Sequence with coroutines; compose small scripts with `requires`         | `async awake()`, one large script, or a global singleton |
| Move long work into a coroutine, a system, or a worker                  | looping over everything in `update`                      |
| Move a value with `app.tweens.to(...)`                                  | a coroutine that lerps by hand on `deltaTime`            |

## 8. Hot reload

`app.hotReload` swaps script classes in a running game (`@ignifx/vite-plugin` drives it in `vite dev`;
it works headlessly with no bundler). Two policies, chosen per class:

| `static hotReload`  | What happens to live instances                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"patch"` (default) | The prototype is swapped: same objects, every field value kept, coroutines still running, **no** lifecycle callback re-run. Statics are re-read, so a changed `executionOrder` reorders dispatch.                                      |
| `"recreate"`        | Each instance is serialized through its schema, destroyed (`onDisable`, `onDestroy`), and rebuilt from the new class with the same uid and position — so `awake`, `onEnable`, and `start` run again, and its coroutines are cancelled. |

```ts
import { createApp, f32, Script } from "@ignifx/core";

class Mover extends Script.define({ speed: f32(1) }) {
  static typeId = "mygame/Mover";
  travelled = 0;
  update(dt: number): void {
    this.travelled += this.speed * dt;
  }
}

// What Vite hands the engine after the file is edited: the same typeId, a new class.
class NextMover extends Script.define({ speed: f32(1) }) {
  static typeId = "mygame/Mover";
  travelled = 0;
  update(dt: number): void {
    this.travelled += this.speed * dt * 2;
  }
}

const app = await createApp({ headless: true });
app.registerComponents([Mover]);
const mover = app.world.createEntity("Player").addComponent(Mover, { speed: 3 });
app.step(1 / 60);

const report = app.hotReload.apply([{ types: [NextMover] }]);
app.log.info(report.kind, report.typeIds, mover.travelled); // "patch" ["mygame/Mover"] 0.05
app.dispose();
```

- Wire a real game up in one line: `import { acceptHotReload, scripts } from "virtual:ignifx/scripts"`,
  then `app.registerComponents(scripts)` and `acceptHotReload(app)`. In a production build
  `acceptHotReload` is an empty function and none of the client ships.
- **Change a field layout → `static hotReload = "recreate"`.** A patched instance keeps whatever its
  old constructor assigned, so a new field would read `undefined`. The engine notices anyway: a
  `"patch"` class whose schema shape changed is re-created with an `IGX-0207` warning.
- `static onHotReload(previous)` runs once on the **new** class, with the class it replaces, for
  class-level transient state. It is not per instance: under `"patch"` the instances are the same
  objects, and under `"recreate"` their state comes from the schema by design.
- `apply` is a flush-time operation: calling it from inside a lifecycle callback is `IGX-0208`.
  `app.hotReload.reloadScene(instance)` rebuilds one scene from its file, and
  `createApp({ hotReload: { reloadScenes: true } })` does it whenever a scene file changes.
