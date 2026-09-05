# 03 · Scripting and Components

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/core` · **Related:** `01-lifecycle-and-time.md`, `02-scene-graph.md`, `06-serialization-and-scene-format.md`, ADR-0004

The scripting model is the part of ignifx users touch most. It follows Unity's component/`MonoBehaviour` shape, with three deliberate differences: fields are declared through a schema instead of reflection or decorators, execution order is explicit, and frame-sequenced logic uses synchronous coroutines rather than `async` functions.

---

## 1. `Component`

```ts
abstract class Component {
  static readonly typeId: string; // required for serializable components, e.g. "mygame/Mover"
  static readonly schema?: Schema; // serialized fields; see §3
  static readonly requires?: readonly ComponentType[]; // auto-added and validated on attach
  static readonly allowMultiple: boolean = true; // false → one per entity (IGX-0202 on violation)

  readonly uid: string;
  readonly entity: Entity;
  readonly transform: Transform;
  readonly world: World;
  readonly app: App;
  enabled: boolean; // own flag; default true
  readonly isEnabledInHierarchy: boolean; // enabled && entity.activeInHierarchy
  readonly isDestroyed: boolean;

  destroy(): void;
  getComponent<T extends Component>(type: ComponentType<T>): T | null; // sugar for entity.getComponent
  requireComponent<T extends Component>(type: ComponentType<T>): T;

  // Hooks available to every component (systems-owned components use these; scripts use the lifecycle in §2)
  protected onAttach?(): void; // after fields are assigned, before awake; may run while entity is inactive
  protected onDetach?(): void; // just before removal, after onDestroy
}
```

- Components are constructed by the engine (`entity.addComponent(Type, init)` or scene load). A component class must have a no-argument constructor; initial values come from schema defaults, then from the file or the `init` object.
- Engine-owned components (`MeshRenderer`, `Rigidbody`, `AudioSource`, …) are plain `Component`s updated by systems. They may also react to field changes through setters, but never register per-frame callbacks.

## 2. `Script`

```ts
abstract class Script extends Component {
  static executionOrder: number = 0; // lower runs first within a phase
  static updateWhenPaused: boolean = false;

  awake?(): void;
  onEnable?(): void;
  start?(): void;
  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  lateUpdate?(dt: number): void;
  onDisable?(): void;
  onDestroy?(): void;
  onCollisionEnter?(c: Collision): void;
  onCollisionStay?(c: Collision): void;
  onCollisionExit?(c: Collision): void;
  onTriggerEnter?(t: TriggerEvent): void;
  onTriggerExit?(t: TriggerEvent): void;
  onApplicationPause?(paused: boolean): void;
  onApplicationFocus?(focused: boolean): void;

  startCoroutine(routine: Coroutine): CoroutineHandle;
  stopCoroutine(handle: CoroutineHandle): void;
  stopAllCoroutines(): void;
}
```

- The scheduler detects which callbacks a class implements once per class (prototype inspection at registration) and only iterates scripts that implement a given callback. An empty `update() {}` therefore costs a call; not defining it costs nothing.
- Callback timing and guarantees are defined in `01-lifecycle-and-time.md` §4. Callbacks are ordinary methods; `this` is the script.
- Scripts reach engine services through `this.app` (`this.app.time`, `this.app.input`, `this.app.audio`, …). Extensions add typed properties to `App` via module augmentation (§7), so `this.app.physics` is fully typed when `@ignifx/physics` is installed and a compile error when it is not.

## 3. Declaring serialized fields

Serialized fields are declared with a schema passed to `Script.define` / `Component.define`. The returned base class carries the field types, applies defaults in the constructor, and attaches the schema for the serializer, the inspector, and the docs harness. No decorators, no reflection (ADR-0004).

```ts
import {
  Script,
  f32,
  i32,
  bool,
  str,
  vec3,
  color,
  enumOf,
  entityRef,
  componentRef,
  asset,
  array,
  record,
} from "@ignifx/core";
import { AudioClip } from "@ignifx/audio";

export class Mover extends Script.define({
  speed: f32(5, { min: 0, max: 50, tooltip: "Units per second" }),
  jumpHeight: f32(2),
  loops: i32(1),
  active: bool(true),
  label: str(""),
  offset: vec3({ x: 0, y: 1, z: 0 }),
  tint: color("#ffffff"),
  mode: enumOf(["walk", "run"] as const, "walk"),
  target: entityRef(), // Entity | null, resolved by uid at load
  follow: componentRef(Camera), // Camera | null
  clip: asset(AudioClip), // AssetRef<AudioClip>; loaded with the scene (see 05-assets-and-loading.md)
  waypoints: array(vec3()),
  stats: record({ hp: i32(10), armor: f32(0) }),
}) {
  static typeId = "mygame/Mover";

  update(dt: number) {
    this.transform.translate({ x: 0, y: 0, z: this.speed * dt }); // `speed` is typed number
  }
}
```

- Field kinds: `f32`, `f64`, `i32`, `u32`, `bool`, `str`, `vec2`, `vec3`, `vec4`, `quat`, `color`, `enumOf`, `entityRef`, `componentRef`, `asset`, `array`, `record`, `map`, `optional`, `layerMask`, `curve` (animation curve), `custom` (with explicit `serialize`/`deserialize`).
- Options carry inspector metadata (`tooltip`, `min`, `max`, `step`, `hidden`, `readonly`, `group`) and validation. Validation runs at load in development builds.
- Non-serialized runtime state is declared as ordinary class fields; the linter warns when a class field is named like a schema field.
- `entityRef`/`componentRef` fields are `null` until the scene that contains both ends is fully constructed; they are guaranteed resolved before `awake`. They are tracked: the engine nulls them when the target is destroyed (`02-scene-graph.md` §4). A file reference can only point inside the same scene file (or an instanced sub-scene of it); cross-scene links are runtime patterns (`02-scene-graph.md` §10).
- Changing a schema is a **file-format change** for that component; before 1.0 files are simply invalid and must be re-authored, after 1.0 the component provides a `migrate(fromVersion, data)` hook (`06-serialization-and-scene-format.md` §7).

## 4. Registration and type ids

- Every serializable component must be registered with the app before scenes that use it are loaded: extensions register theirs in `register(ctx)`; a game registers its scripts with `app.registerComponents([...])` (templates keep a `scripts/index.ts` barrel that exports the list).
- `typeId` is explicit and namespaced (`<package-or-game>/<Name>`), never derived from the class name (minification, renames). Registering two classes with the same `typeId` throws `IGX-0203`.
- Scripts that are never serialized (added only from code) may omit `typeId`; attempting to serialize them throws `IGX-0204`.

## 5. Coroutines

```ts
import { waitSeconds, waitSecondsRealtime, waitFixedUpdate, waitUntil, waitWhile } from "@ignifx/core";

class Spawner extends Script {
  *spawnLoop() {
    while (true) {
      const enemy = this.world.instantiate(this.enemyPrefab.value, { position: this.transform.position });
      const asset = yield this.app.assets.load(this.nextWave); // promise → resumes on first Update after settle
      yield waitSeconds(2);
      yield waitUntil(() => enemy.isDestroyed);
      yield; // next frame
    }
  }
  start() {
    this.startCoroutine(this.spawnLoop());
  }
}
```

- Semantics are defined in `01-lifecycle-and-time.md` §5. Coroutines are paused while the script is not effectively enabled and cancelled on destroy.
- A coroutine may `yield` another coroutine handle to wait for it. Nested generators are delegated with `yield*`.
- Errors inside coroutines are reported through `app.onError` with the script and entity identified; the coroutine is cancelled, other scripts are unaffected.

## 6. Systems (for extension authors)

```ts
interface System {
  readonly name: string;
  update?(ctx: SystemContext): void; // called in the registered phase
  onWorldCreated?(world: World): void;
  onWorldDisposed?(world: World): void;
  dispose?(): void;
}
interface SystemContext {
  readonly world: World;
  readonly time: Time;
  readonly phase: Phase;
  readonly dt: number;
}

ctx.registerSystem(new SpriteSyncSystem(), { phase: Phase.PreRender, order: 100 });
```

- Phases: `EndOfFrame`, `PreUpdate`, `FixedUpdate`, `Update`, `PostUpdate`, `PreRender` (see `01-lifecycle-and-time.md` §3). Within a phase, systems run by ascending `order`; ties are broken by registration order. Core systems use orders in `[-1000, 1000]`; extensions should use `[1001, 9999]` unless they must interleave with core.
- Systems iterate components with `world.components(Type)`. They must not hold references to destroyed components; subscribe to `onEntityDestroyed` or check `isDestroyed`.
- Systems never call script callbacks directly; the scheduler does.

## 7. Typed service access

Extensions expose services on `App` through declaration merging:

```ts
// in @ignifx/input
declare module "@ignifx/core" {
  interface App {
    readonly input: InputService;
  }
}
```

- Inside `register(ctx)`, the extension calls `ctx.registerService(InputService, instance)` and `ctx.defineAppProperty("input", () => instance)`. The property is defined once per app; a second definition throws `IGX-0401`.
- Scripts use `this.app.input.actions.get("jump")`. Tests can construct an `App` with a subset of extensions; TypeScript then reports missing services at compile time only if the augmenting package is not imported, so shared game code that must work with or without an extension uses `app.services.tryGet(InputService)`.

## 8. Patterns the standard endorses

- **Cache lookups in `awake`.** `this.rb = this.requireComponent(Rigidbody)`.
- **Signals up, calls down.** Emit `Signal`s for things that happened; call methods on children you own.
- **Prefer references over paths.** Use `entityRef`/`componentRef` fields; `entity.find("...")` is allowed only in tests, examples, and tools.
- **Keep `fixedUpdate` pure simulation.** Read input state captured at frame start (`app.input` values are stable during the whole frame); do not read wall-clock time.
- **No `async` lifecycle callbacks.** `async awake()` is rejected by the linter; use coroutines or the asset system's promise handling.
- **One responsibility per script.** Compose behaviours from several small scripts rather than one large one; use `requires` to express dependencies.

## 9. Anti-patterns the standard rejects

- String-based messaging (`sendMessage`, name-based dispatch).
- Global singletons for game state; use a persistent scene with a `GameState` script, or `app.services`.
- Mutating `transform` from `onCollision*` callbacks of the _other_ entity's script; each script manages its own entity.
- Long-running work in `update`; move to coroutines, systems, or workers.
