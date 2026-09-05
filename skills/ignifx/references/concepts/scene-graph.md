# Scene graph

`World`, `SceneInstance`, `Entity`, `Transform`, tags, layers, and signals as the Phase 1 kernel
ships them. Rationale in `docs/architecture/02-scene-graph.md`.

```
World ──▶ SceneInstance ──▶ Entity (roots) ──▶ Entity (children) ──▶ Component
                                       └── always has ──▶ Transform ──▶ Babylon Lite SceneNode
```

## 1. `World` (`app.world`)

| Member                                                                        | Returns                       | Notes                                                            |
| ----------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `createEntity(name?, options?)`                                               | `Entity`                      | `options`: `parent`, `scene`, `position`, `rotation`             |
| `getEntity(uid)` / `getEntityByHandle(handle)`                                | `Entity \| null`              | `uid` is the ULID files use; the handle is a dense runtime id    |
| `findByName(name)` / `findAllByName(name)`                                    | `Entity \| null` / `Entity[]` | Depth-first; prototyping and tooling only                        |
| `findByTag(tag)`                                                              | `readonly Entity[]`           | Live indexed view; order is **not** stable                       |
| `components(Type)`                                                            | `readonly T[]`                | Live per-type registry systems iterate; order is **not** stable  |
| `activeScene`                                                                 | `SceneInstance`               | Default owner of entities created in code; assignable            |
| `scenes`                                                                      | `readonly SceneInstance[]`    | Every loaded instance                                            |
| `layers`                                                                      | `LayerTable`                  | Names resolved from the `layers` settings section                |
| `registry`                                                                    | `ComponentRegistry`           | `typeId` ↔ class, and the derived class metadata                 |
| `onEntityCreated` / `onEntityDestroyed` / `onSceneLoaded` / `onSceneUnloaded` | `Signal<…>`                   | World-level events                                               |
| `lite`                                                                        | `{ scene, simulationScene }`  | Unstable escape hatch; `simulationScene` is `null` until physics |

Scene files, `loadScene`, `instantiate`, and prefabs arrive in Phase 2. Today every app starts with
one implicit, persistent `SceneInstance` named `"default"`, so `createEntity` works immediately.

## 2. `SceneInstance`

`uid`, `name`, `roots`, `isLoaded`, `persistent`, `onUnloading`, and `asset` (always `null` until
scene assets exist). Instances are created by the kernel; a game reads them off `world.scenes`.

## 3. `Entity`

| Group      | Members                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity   | `uid` (ULID, stable across files), `handle` (dense, invalid after destroy), `name`, `world`, `scene`, `transform`                                                                                                                                 |
| Hierarchy  | `parent`, `children`, `setParent(parent, { worldPositionStays })`, `root()`, `isDescendantOf(other)`, `findChild(predicate, deep?)`, `find(path)`                                                                                                 |
| Components | `addComponent(Type, init?)`, `getComponent(Type)`, `requireComponent(Type)`, `getComponents(Type)`, `getComponentInChildren`, `getComponentsInChildren`, `getComponentInParent`, `hasComponent(Type)`, `removeComponent(component)`, `components` |
| State      | `active`, `activeInHierarchy`, `isStatic`, `layer`, `tags`, `isDestroyed`                                                                                                                                                                         |
| Lifecycle  | `destroy()`, `destroyImmediate()`                                                                                                                                                                                                                 |
| Signals    | `onChildAdded`, `onChildRemoved`, `onParentChanged`, `onActiveChanged`, `onDestroyed`                                                                                                                                                             |

- `getComponent` matches by class identity **and** inheritance, and costs a linear scan; cache the
  result in `awake`.
- `requireComponent` throws `IGX-0201` when the component is absent, which is the supported way to
  express a hard dependency together with `static requires`.
- `find(path)` ("`Body/Arm.L`", "`../Sibling`") is deliberately fragile and allowed only in tests,
  examples, and tools. Link objects with `entityRef`/`componentRef` fields instead.
- `setParent` defaults to `worldPositionStays: true`; a cycle throws `IGX-0306`.

## 4. `Transform`

Every entity has exactly one; it cannot be removed (`IGX-0205`) or disabled. It is a **view** over
the entity's Lite `SceneNode`, so there is no second copy of position, rotation, or scale anywhere.

| Kind             | Members                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local live views | `localPosition`, `localRotation`, `localScale` — mutate in place (`.x += 1`, `.set(…)`, `.copyFrom(v)`)                                                 |
| Local values     | `localEulerAngles` (degrees), `localMatrix`, `localPosition2D`, `localScale2D`                                                                          |
| World getters    | `position`, `rotation`, `eulerAngles`, `lossyScale`, `forward`, `right`, `up` — each **allocates**                                                      |
| World `ToRef`    | `positionToRef(out)`, `rotationToRef`, `eulerAnglesToRef`, `localEulerAnglesToRef`, `lossyScaleToRef`, `forwardToRef`, `rightToRef`, `upToRef`          |
| Operations       | `translate(delta, space?)`, `rotate(eulerDegrees, space?)`, `rotateAround(point, axis, degrees)`, `lookAt(target, up?)`, `setPositionAndRotation(p, r)` |
| Spaces           | `transformPoint`, `transformDirection`, `inverseTransformPoint`, `inverseTransformDirection` (each takes an optional `out`)                             |
| 2D               | `position2D`, `localPosition2D`, `rotation2D` (degrees about +Z), `localScale2D`                                                                        |
| Matrices         | `worldMatrix`, `worldMatrixVersion` (bumps whenever the world matrix changes), `lite` (unstable)                                                        |

Units are metres, seconds, and **degrees**; a radian-valued API always carries a `Rad` suffix
(`Quat.fromEulerRadians`). The space is left-handed, Y up, +Z forward. Writing a world-space setter
decomposes against the parent's world matrix, so hot code writes local values.

## 5. Tags and layers

- `entity.tags` is a `TagSet`: `add`, `has`, `delete`, `values()`, `size`, and iteration. The world
  indexes tags for `findByTag`. Tags group and look up; they never dispatch behaviour.
- `entity.layer` is a slot number in `0…31`. Slots 0–7 are reserved (`Default`, `TransparentFX`,
  `IgnoreRaycast`, `Water`, `UI`, and three unnamed); a project's own names from the `layers`
  settings section fill slots 8 upwards, up to 24 of them (`IGX-0305` beyond that, `IGX-0304` on a
  duplicate name).
- `world.layers` is the `LayerTable`: `indexOf(name)` (`-1` when absent), `requireIndex(name)`
  (`IGX-0303`), `nameOf(index)`, `has(name)`, `names`, `count`, and `mask(...names)`.
- `LayerMask` is a bit set: `LayerMask.of(...slotNumbers)`, `LayerMask.fromNames(table, names)`,
  `LayerMask.everything()`, `LayerMask.nothing()`, `LayerMask.fromBits(bits)`, then `has(layer)`,
  `with(layer)`, `without(layer)`, `intersects(other)`, `toNames(table)`, `bits`. Scripts normally
  write `this.world.layers.mask("Player", "Enemy")`.

## 6. Signals

`Signal<T>` is the observer primitive: `connect(handler, options?)` returns a `Disconnect`,
`emit(value)`, `disconnect(handler)`, `clear()`, `connectionCount`. `ConnectOptions` carries
`once`, `deferred` (delivery moves to the next `EndOfFrame`; a signal with no scheduler behind it
throws `IGX-0103`), and `owner` — any `SignalOwner`, which every `Entity` and `Component` is.

Always pass `owner: this` from a script, so the connection is dropped when the script is destroyed.
The convention is **call down, signal up**: a parent calls methods on children it owns, a child
emits a signal its parent connects to. There is no name-based broadcast.

## 7. Examples

Building a hierarchy and reading a world position without allocating:

```ts
import { Vec3, createApp } from "@ignifx/core";

const app = await createApp({ headless: true });
const world = app.world;

const player = world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
player.tags.add("player");
player.layer = world.layers.indexOf("Default");

const hand = world.createEntity("Hand", { parent: player });
hand.transform.localPosition.set(0.4, 1.2, 0.2);

const worldPosition = new Vec3();
hand.transform.positionToRef(worldPosition);
app.log.info("hand at", worldPosition.x, worldPosition.y, worldPosition.z);
```

Connecting a signal with an owner, so it disconnects itself:

```ts
import { Script } from "@ignifx/core";
import type { Entity, ScriptCallbacks } from "@ignifx/core";

export class Spawner extends Script implements ScriptCallbacks {
  static typeId = "demo/Spawner";

  awake(): void {
    this.world.onEntityDestroyed.connect(
      (entity: Entity) => {
        this.app.log.debug("gone", entity.name);
      },
      { owner: this },
    );
  }
}
```
