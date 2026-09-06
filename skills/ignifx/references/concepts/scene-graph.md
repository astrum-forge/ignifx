# Scene graph

`World`, `SceneInstance`, `Entity`, `Transform`, tags, layers, signals, and — since Phase 2 — scene
files, prefabs, and instancing. Rationale in `docs/architecture/02-scene-graph.md`.

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
| `loadScene(ref, options?)`                                                    | `Promise<SceneInstance>`      | Loads a `.scene.json` and everything it references               |
| `unloadScene(instance)`                                                       | `Promise<void>`               | Destroys its entities and releases its asset handles             |
| `instantiate(asset, options?)` / `instantiateAsync(ref, options?)`            | `Entity` / `Promise<Entity>`  | Stamps out a prefab; answers with one root entity                |
| `moveEntityToScene(entity, instance)`                                         | `void`                        | Moves a **root** and its subtree; `IGX-0309` for a child         |
| `mainCamera`                                                                  | `Camera \| null`              | The enabled camera with the highest `priority`                   |
| `raycastRender(ray, options?)`                                                | `RenderPick \| null`          | Synchronous CPU pick against renderable meshes                   |
| `onEntityCreated` / `onEntityDestroyed` / `onSceneLoaded` / `onSceneUnloaded` | `Signal<…>`                   | World-level events, also mirrored on `app.events`                |
| `lite`                                                                        | `{ scene, simulationScene }`  | Unstable escape hatch; `simulationScene` is `null` until physics |

Every app starts with one implicit, **persistent** `SceneInstance` named `"default"`, so
`createEntity` works immediately and entities created in code survive a `"single"` scene load.

## 2. Scenes, prefabs, and instancing

A scene file and a prefab file are the same format, `ignifx.scene` (ADR-0005): `.scene.json` is a
level, `.prefab.json` is a thing you stamp out. Fields in
[`../formats/ignifx.scene.md`](../formats/ignifx.scene.md); structure and overrides in
[`../formats/scene.md`](../formats/scene.md).

```ts
import { createApp } from "@ignifx/core";
import type { SceneAsset } from "@ignifx/core";

const app = await createApp({ headless: true });

// "single" (the default) unloads every non-persistent instance first; "additive" keeps them.
const level = await app.world.loadScene("levels/level01.scene.json", { mode: "additive" });
level.persistent = true;

// A prefab is a loaded SceneAsset, stamped out synchronously.
const prefab = await app.assets.loadAsync<SceneAsset>("prefabs/enemy.prefab.json");
const enemy = app.world.instantiate(prefab.value, { position: { x: 4, y: 0, z: 2 } });
app.log.info("spawned", enemy.name, "into", level.name);
prefab.release();
```

- **`loadScene(ref, options?)`** — `mode` (`"single" | "additive"`), `signal`, `onProgress`,
  `setActive` (defaults to `true` for a single load, `false` for an additive one), and
  `strictInstanceHashes`. The asset and every dependency it names are loaded **before** the first
  entity exists, which is what lets `awake` read an `asset()` field; construction then happens in one
  synchronous block, and `awake`/`onEnable` run before the promise settles. An abort is `IGX-0502`.
- **`instantiate(asset, options?)`** — `parent`, `scene`, `name`, `position`, `rotation`,
  `worldSpace`, `strictInstanceHashes`. Synchronous, because a `SceneAsset` arrives with its
  dependencies loaded. A file with one root answers with that root; a file with several gets a
  container entity named after the scene, so the call always answers with exactly one entity. Every
  entity gets a fresh uid and an `entity.prefab` link. `instantiateAsync(ref)` loads first.
- **`SceneInstance`** — `uid`, `name`, `roots`, `isLoaded`, `persistent`, `settings`,
  `onUnloading`, `asset` (the `AssetHandle<SceneAsset>` it was built from, or `null`), and `remap`
  (the file-uid → runtime-object table, a `UidRemap`). Instances are created by the kernel and the
  loader; a game reads them off `world.scenes` and sets `world.activeScene`.
- **Saving** — `serializeScene(instanceOrRoots, options?)` produces a `SceneFile`;
  `stringifySceneFile(file)` renders it, `validateSceneFile(value)` checks one, and
  `computeSceneHash(file)` is what instance hashes compare against.

## 3. `Entity`

| Group      | Members                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity   | `uid` (ULID, stable across files), `handle` (dense, invalid after destroy), `name`, `world`, `scene`, `transform`, `prefab` (the instance link, or `null`)                                                                                        |
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
(`Quat.fromEulerRad`). The space is left-handed, Y up, +Z forward. Writing a world-space setter
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

```ts run
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

```ts run
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
