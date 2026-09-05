# 02 · Scene Graph: World, Scenes, Entities, Transforms

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/core` · **Related:** `01-lifecycle-and-time.md`, `03-scripting-and-components.md`, `06-serialization-and-scene-format.md`, ADR-0005

---

## 1. Objects and ownership

```
World ──owns──▶ SceneInstance ──owns──▶ Entity (roots) ──owns──▶ Entity (children) ──owns──▶ Component
                                                          │
                                                          └──always has──▶ Transform ──wraps──▶ Babylon Lite SceneNode
```

- The **World** owns every entity. Entities belong to exactly one `SceneInstance` (the scene file they were loaded from, or the _active scene_ for entities created in code).
- **Parent/child** is a tree: an entity has at most one parent; roots have `parent === null`. Reparenting across scene instances moves the entity's ownership to the new parent's scene.
- **Transform** is a component that exists on every entity, cannot be removed, and is a _view_ over the entity's Babylon Lite `SceneNode`. There is no second copy of position/rotation/scale anywhere in ignifx: physics, animation, and scripts all read and write the same node (Lite's Havok integration and animation write node TRS directly, which is why ignifx must not cache its own copy).

## 2. `World`

```ts
interface World {
  readonly app: App;
  readonly scenes: readonly SceneInstance[];
  activeScene: SceneInstance; // default owner for entities created in code

  createEntity(
    name?: string,
    options?: { parent?: Entity; scene?: SceneInstance; position?: Vec3Like; rotation?: QuatLike },
  ): Entity;
  getEntity(uid: string): Entity | null;
  getEntityByHandle(handle: EntityHandle): Entity | null;
  findByName(name: string): Entity | null; // first match, depth-first; prototyping only
  findAllByName(name: string): Entity[];
  findByTag(tag: string): readonly Entity[]; // indexed, O(1) to obtain, live read-only view
  components<T extends Component>(type: ComponentType<T>): readonly T[]; // live per-type registry used by systems

  loadScene(scene: AssetRef<SceneAsset> | string, options?: LoadSceneOptions): Promise<SceneInstance>;
  unloadScene(instance: SceneInstance): Promise<void>;
  instantiate(scene: SceneAsset, options?: InstantiateOptions): Entity; // scene asset already loaded
  instantiateAsync(scene: AssetRef<SceneAsset> | string, options?: InstantiateOptions): Promise<Entity>;
  moveEntityToScene(entity: Entity, scene: SceneInstance): void; // roots only

  readonly onSceneLoaded: Signal<SceneInstance>;
  readonly onSceneUnloaded: Signal<SceneInstance>;
  readonly onEntityCreated: Signal<Entity>;
  readonly onEntityDestroyed: Signal<Entity>;

  readonly lite: { readonly scene: SceneContext; readonly simulationScene: SceneContext | null }; // unstable escape hatch
}

interface LoadSceneOptions {
  mode?: "single" | "additive";
  signal?: AbortSignal;
  onProgress?: (p: LoadProgress) => void;
  setActive?: boolean;
}
interface InstantiateOptions {
  parent?: Entity | null;
  scene?: SceneInstance;
  name?: string;
  position?: Vec3Like;
  rotation?: QuatLike;
  worldSpace?: boolean;
}
```

- `mode: "single"` (default) unloads every scene instance except those marked `persistent` (see §6) before loading. `"additive"` keeps existing scenes.
- Loading is asynchronous and yields to the frame loop; entities of a loading scene are not visible to queries until the whole scene is constructed. Then `awake` runs in tree order (`01-lifecycle-and-time.md` §4).
- `instantiate` is synchronous when the scene asset is already loaded (its dependencies must be loaded too; the asset system guarantees this for a loaded scene asset). It throws `IGX-0301` otherwise. `instantiateAsync` loads first.

## 3. `SceneInstance`

```ts
interface SceneInstance {
  readonly uid: string; // instance id, distinct from the asset address
  readonly asset: AssetHandle<SceneAsset> | null; // null for the implicit default scene
  readonly name: string;
  readonly roots: readonly Entity[];
  readonly isLoaded: boolean;
  persistent: boolean; // survives "single" loads (Unity DontDestroyOnLoad equivalent, at scene granularity)
  readonly onUnloading: Signal<void>;
}
```

- Every app starts with one implicit, empty, persistent scene instance named `"default"` so `createEntity` works before any file is loaded.
- Unloading a scene destroys its root entities through the normal destroy path (children before parents, `onDisable` then `onDestroy`), then releases the assets it loaded.

## 4. `Entity`

```ts
interface Entity {
  readonly uid: string; // ULID; stable across save/load; key for references in files
  readonly handle: EntityHandle; // dense runtime id; invalid after destroy
  name: string;
  readonly world: World;
  readonly scene: SceneInstance;
  readonly transform: Transform;
  readonly parent: Entity | null;
  readonly children: readonly Entity[];
  active: boolean; // own flag
  readonly activeInHierarchy: boolean;
  layer: number; // 0..31; see §7
  readonly tags: TagSet; // add(tag) / has(tag) / delete(tag) / values()
  readonly isDestroyed: boolean;
  readonly isStatic: boolean; // hint: transform will not change after awake (batching, physics static)

  // hierarchy
  setParent(parent: Entity | null, options?: { worldPositionStays?: boolean }): void; // default true
  find(path: string): Entity | null; // "Body/Arm.L", "../Sibling"; prototyping and tooling only
  findChild(predicate: (e: Entity) => boolean, deep?: boolean): Entity | null;
  isDescendantOf(other: Entity): boolean;
  root(): Entity;

  // components
  addComponent<T extends Component>(type: ComponentType<T>, init?: ComponentInit<T>): T;
  getComponent<T extends Component>(type: ComponentType<T>): T | null;
  requireComponent<T extends Component>(type: ComponentType<T>): T; // throws IGX-0201
  getComponents<T extends Component>(type: ComponentType<T>): T[];
  getComponentInChildren<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T | null;
  getComponentsInChildren<T extends Component>(type: ComponentType<T>, includeInactive?: boolean): T[];
  getComponentInParent<T extends Component>(type: ComponentType<T>): T | null;
  hasComponent(type: ComponentType): boolean;
  removeComponent(component: Component): void; // queues destroy of that component
  readonly components: readonly Component[];

  destroy(): void;
  destroyImmediate(): void;

  readonly onChildAdded: Signal<Entity>;
  readonly onChildRemoved: Signal<Entity>;
  readonly onParentChanged: Signal<Entity | null>;
  readonly onActiveChanged: Signal<boolean>;
  readonly onDestroyed: Signal<Entity>;
}
```

Rules:

- `getComponent` matches by class identity **and** inheritance (`getComponent(Script)` returns the first script). Cost is linear in the entity's component count; cache results in `awake`.
- `find(path)` is deliberately fragile (the Godot `get_node` lesson). Serialized references (`06-serialization-and-scene-format.md`) and `requireComponent` are the supported way to link objects; `find` is allowed only in tests, examples, and tools; the linter flags it anywhere else.
- `isStatic` is set in files (or before `awake`) and cannot change afterwards. It lets the 2D batcher, physics, and navmesh treat the entity as immovable.
- `name` is not unique and never used for lookup by the engine.
- **Tracked references.** Fields declared with `entityRef`/`componentRef` are tracked: when the target is destroyed, the engine sets the field to `null` in the same destroy flush, before any `onDestroy` of the holder. Plain class fields holding entities or components are not tracked; check `isDestroyed` before use.

## 5. `Transform`

`Transform` is the view over the Lite `SceneNode` (`position`, `rotationQuaternion`, `rotation` Euler proxy, `scaling`, `parent`, `worldMatrix`, `worldMatrixVersion`, `visible`, `metadata`).

```ts
interface Transform extends Component {
  // local (relative to parent)
  readonly localPosition: MutableVec3;   // live view; `.x += 1` writes through; `.set(x,y,z)`; `.copyFrom(v)`
  readonly localRotation: MutableQuat;   // live view
  readonly localScale: MutableVec3;      // live view
  localEulerAngles: Vec3;                // degrees, XYZ; getter returns a fresh value, setter converts
  // world
  position: Vec3;                        // getter allocates or use positionToRef(out)
  rotation: Quat;
  eulerAngles: Vec3;                     // degrees
  lossyScale: Vec3;                      // read-only
  positionToRef(out: MutableVec3): MutableVec3; rotationToRef(out: MutableQuat): MutableQuat;
  readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3;     // world unit vectors (+Z, +X, +Y)
  forwardToRef(out: MutableVec3): MutableVec3; // and rightToRef/upToRef
  readonly worldMatrix: Mat4;            // lazily recomputed by Lite; read-only
  readonly worldMatrixVersion: number;   // increases when worldMatrix changes; snapshot to detect movement
  readonly localMatrix: Mat4;

  translate(delta: Vec3Like, space?: "local" | "world"): void;      // default "local"
  rotate(eulerDegrees: Vec3Like, space?: "local" | "world"): void;
  rotateAround(point: Vec3Like, axis: Vec3Like, degrees: number): void;
  lookAt(target: Vec3Like, up?: Vec3Like): void;
  setPositionAndRotation(position: Vec3Like, rotation: QuatLike): void;
  transformPoint(local: Vec3Like, out?: MutableVec3): MutableVec3; // returns `out`, or a fresh Vec3 when omitted
  transformDirection(...); inverseTransformPoint(...); inverseTransformDirection(...);

  // 2D conveniences (Y up; Z is depth)
  position2D: Vec2; localPosition2D: Vec2; rotation2D: number /* degrees about +Z */; localScale2D: Vec2;

  readonly lite: SceneNode;              // unstable escape hatch
}
```

- `MutableVec3`/`MutableQuat` are the structural interfaces Lite's `ObservableVec3`/`ObservableQuat` already satisfy (`x/y/z(/w)`, `set`, `copyFrom`). ignifx's own `Vec3`/`Quat` classes implement the same interfaces and add math methods, so a `Vec3` can be passed anywhere a `Vec3Like` is expected without conversion.
- World-space setters decompose against the parent's world matrix (`mat4Decompose`) and write local values. They are more expensive than local writes; hot code writes local values.
- Reading `worldMatrix` triggers Lite's lazy recomputation up the parent chain; it is cached until a TRS value changes (`worldMatrixVersion` bumps).
- Scale is non-uniform capable; negative scale is allowed but shadows and physics shapes treat it as unsupported (diagnostic in development).

### 5.1 Parenting details

- ignifx creates one Lite `TransformNode` per entity (`createTransformNode(name)`); pure transform nodes are **not** added to the Lite scene (they are only matrix providers). Renderable Lite objects created by components (`Mesh`, `LightBase`, `Camera`, `TextRenderable`, …) are parented under the entity's node and added with `addToScene`.
- `setParent(parent, { worldPositionStays: true })` delegates to Lite's `setParent(child, parentNode)`, which preserves the world transform (except under singular parent matrices, where only position is preserved; see Lite docs). With `worldPositionStays: false`, ignifx links `node.parent`/`children` directly and local values are kept.
- The active-in-hierarchy state is materialized down the subtree on change; Lite visibility follows via `setSubtreeVisible(node, visible)`.

## 6. Scenes as assets, prefabs as instanced scenes

- A scene file (`06-serialization-and-scene-format.md`) describes a tree of entities. There is one file format for levels and prefabs (ADR-0005); the `.prefab.json` suffix is a convention for scenes meant to be instantiated many times.
- An entity in a scene file may be an **instance** of another scene asset: `{"instance": {"scene": "prefabs/enemy.prefab.json", "overrides": [...]}}`. On load the instanced scene's entities are created under that entity, and overrides (property patches addressed by the _instanced_ file's entity/component uids) are applied. Nested instances are allowed to any depth; cycles are rejected (`IGX-0302`).
- At runtime, `Entity.prefab` (`{ asset, instanceRoot }`) identifies entities that came from an instance, so tooling can show the link. The engine itself does not maintain a live link back to the prefab after load; "apply changes to prefab" is editor work, post-1.0.
- `persistent` scene instances model Unity's `DontDestroyOnLoad`; moving a single entity between scenes uses `moveEntityToScene`.

## 7. Layers and tags

- **Layers** are 32 slots. Names live in project settings (`ignifx.config.ts` → `layers: ["Default", "Ground", "Player", ...]`); slots 0–7 are reserved for engine defaults (`Default`, `TransparentFX`, `IgnoreRaycast`, `Water`, `UI`, and three reserved). Layers drive physics collision matrices and raycast masks now, and camera culling masks after 1.0. `world.layers.mask("Player", "Enemy")` builds a bitmask from names (the form scripts use); `LayerMask.of(...slots)` takes slot numbers and `LayerMask.fromNames(table, names)` is the standalone equivalent. Files store layers by **name**, never by index, so reordering the list is safe; an unknown name loads as `Default` with diagnostic `IGX-0303`, and `ignifx rename-layer <old> <new>` rewrites files.
- **Tags** are free-form strings on a set; the world indexes them for `findByTag`. Tags are for grouping and lookup, never for behaviour dispatch.
- 2D **sorting layers** are a separate ordered list in project settings (`11-2d-toolkit.md`).

## 8. Signals and messaging

```ts
class Signal<T = void> {
  connect(
    handler: (value: T) => void,
    options?: { once?: boolean; deferred?: boolean; owner?: Component | Entity },
  ): Disconnect;
  emit(value: T): void;
  disconnect(handler): void;
  clear(): void;
  readonly connectionCount: number;
}
```

- `deferred: true` queues delivery to the next `EndOfFrame` phase (Godot's `CONNECT_DEFERRED`).
- `owner` auto-disconnects the handler when the owner is destroyed. Scripts should always pass `owner: this`; the linter flags `connect` calls inside scripts without an owner.
- Convention: **call down, signal up**. A parent calls methods on children it owns; a child emits signals that parents subscribe to. There is no `sendMessage`/broadcast-by-name facility (Unity lesson).
- Engine-wide events live on `app.events` as typed signals (`app.events.onSceneLoaded`, etc.); extensions add their own via module augmentation. Phase 1 ships the world-level signals only (`world.onEntityCreated`, `onEntityDestroyed`, `onSceneLoaded`, `onSceneUnloaded`); `app.events` arrives with the asset and scene loading of Phase 2.

## 9. Queries for systems

- `world.components(Type)` is the primary iteration API for systems and is O(1) to obtain and stable within a phase. Registration happens at `addComponent`; removal at the destroy flush.
- Extensions needing spatial queries (culling, 2D chunking) maintain their own acceleration structures fed by `worldMatrixVersion` change detection; the core does not ship a spatial index.

## 10. Identity and metadata bridging

- `entity.uid` is generated with ULID on creation and preserved by files. Loading the same scene twice (two instances) generates _fresh_ uids per instance for runtime entities while keeping the _file-local_ uids for override addressing; the mapping is stored on the `SceneInstance`.
- Every Lite node created by ignifx gets `metadata.ignifx = { entity: EntityHandle, component?: ComponentHandle }` so Lite picking results and physics bodies map back to entities.
- File references (`$entity`, `$component`) never cross scene files. Runtime links between scene instances (a persistent HUD scene reading the gameplay scene's player) use `world.findByTag`, `world.getEntity(uid)` for persistent scenes with known uids, or, preferably, a script in a persistent scene that registers itself in `app.services` (documented as the `cross-scene-links` recipe).
