import { componentInternals } from "../component/internals.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { isValidLayer, MAX_LAYERS } from "../layers/layer-table.js";
import { readCallback } from "../lifecycle/callbacks.js";
import { linkParent, reparentKeepingWorld, setNodeName, setNodeSelfVisible, tagNode } from "../lite/node.js";
import { validateProps } from "../schema/validate.js";
import { Signal } from "../signal/signal.js";
import { TagSet } from "../tags/tag-set.js";
import { attachTransform, transformIsNotRemovable } from "../transform/transform-internals.js";
import { Transform } from "../transform/transform.js";
import { resolvePath } from "./entity-path.js";
import { ENTITY_INTERNALS, entityInternals } from "./internals.js";
import type { EntityInternals } from "./internals.js";
import type { ComponentInit, ComponentType, ConcreteComponentType } from "../component/component-type.js";
import type { Component } from "../component/component.js";
import type { EntityHandle } from "../handles/handle.js";
import type { LiteSceneNode } from "../lite/node.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { Schema } from "../schema/types.js";
import type { TagSetObserver } from "../tags/tag-set.js";
import type { WorldHost } from "../world/world-host.js";
import type { World } from "../world/world.js";

/**
 * A node of the scene tree (`docs/architecture/02-scene-graph.md` §4). Every entity has a stable
 * id, a name, tags, a layer, an active flag, an ordered list of components, and exactly one
 * `Transform` wrapping its Babylon Lite node.
 *
 * @remarks
 * Entities are created by the world, never with `new`: `world.createEntity()` allocates the Lite
 * node, the handle, and the transform together. Destroying one queues its whole subtree for the
 * current frame's destroy flush; it reports `isDestroyed === true` immediately and throws
 * `IGX-0101` on any further structural change (`addComponent`, `removeComponent`, `setParent`,
 * `active`, `layer`, `name`, `isStatic`, `tags.add`/`delete`). Transform writes are deliberately
 * not* guarded: they are the hottest path in the engine and a write to a doomed node is harmless.
 *
 * @example
 * ```ts
 * const player = world.createEntity("Player", { position: { x: 0, y: 1, z: 0 } });
 * player.layer = world.layers.indexOf("Player");
 * player.tags.add("player");
 * const mover = player.addComponent(Mover, { speed: 8 });
 * const gun = world.createEntity("Gun", { parent: player });
 * ```
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- the merged interface below declares one engine-owned property that the constructor always assigns.
export class Entity {
  /**
   * Creates an entity. The world calls this; game code calls `world.createEntity`.
   *
   * @param host - The owning world.
   * @param handle - The dense runtime handle already allocated for this entity.
   * @param uid - The stable identifier.
   * @param node - The Lite node the transform will view.
   * @param name - The display name.
   * @param scene - The scene instance that owns the entity.
   *
   * @internal
   */
  constructor(
    host: WorldHost,
    handle: EntityHandle,
    uid: string,
    node: LiteSceneNode,
    name: string,
    scene: SceneInstance,
  ) {
    const observer: TagSetObserver = (tag, added) => {
      host.notifyTagChanged(this, tag, added);
    };
    this[ENTITY_INTERNALS] = {
      host,
      node,
      handle,
      uid,
      serial: host.nextSerial(),
      tags: new TagSet(observer),
      transform: null,
      name,
      scene,
      parent: null,
      children: [],
      components: [],
      active: true,
      activeInHierarchy: true,
      layer: 0,
      isStatic: false,
      hasAwoken: false,
      isDestroyed: false,
      isReleased: false,
      isDestroyQueued: false,
      onChildAdded: null,
      onChildRemoved: null,
      onParentChanged: null,
      onActiveChanged: null,
      onDestroyed: null,
    };
    tagNode(node, { entity: handle });
    const transform = new Transform();
    attachTransform(transform, node);
    this[ENTITY_INTERNALS].transform = transform;
    this.#attach(transform);
  }

  /**
   * The stable ULID; the key files use to reference this entity.
   *
   * @returns The identifier.
   */
  get uid(): string {
    return entityInternals(this).uid;
  }

  /**
   * The dense runtime handle; `world.getEntityByHandle` stops resolving it after destruction.
   *
   * @returns The handle.
   */
  get handle(): EntityHandle {
    return entityInternals(this).handle;
  }

  /**
   * The display name. Not unique, and never used for lookup by the engine
   * (`docs/architecture/02-scene-graph.md` §4).
   *
   * @returns The name.
   */
  get name(): string {
    return entityInternals(this).name;
  }

  set name(value: string) {
    const internals = this.#mutable("name");
    internals.name = value;
    setNodeName(internals.node, value);
  }

  /**
   * The world that owns the entity.
   *
   * @returns The world.
   */
  get world(): World {
    return entityInternals(this).host.world;
  }

  /**
   * The scene instance the entity belongs to.
   *
   * @returns The owning scene instance.
   */
  get scene(): SceneInstance {
    return entityInternals(this).scene;
  }

  /**
   * The entity's transform. Every entity has one; it can be neither removed nor disabled.
   *
   * @returns The transform.
   */
  get transform(): Transform {
    const transform = entityInternals(this).transform;
    if (transform === null) {
      throw new IgnifxError(CoreErrorCode.componentNotAttached, "This entity has no transform yet.", {
        context: { entity: entityInternals(this).uid },
      });
    }
    return transform;
  }

  /**
   * The parent entity, or `null` when the entity is a root of its scene.
   *
   * @returns The parent, or `null`.
   */
  get parent(): Entity | null {
    return entityInternals(this).parent;
  }

  /**
   * The children, in creation order. The array is live; treat it as read-only.
   *
   * @returns The live child list.
   */
  get children(): readonly Entity[] {
    return entityInternals(this).children;
  }

  /**
   * The components, in attach order. The transform is always first.
   *
   * @returns The live component list.
   */
  get components(): readonly Component[] {
    return entityInternals(this).components;
  }

  /**
   * The free-form tags the world indexes for `world.findByTag`.
   *
   * @returns The tag set.
   */
  get tags(): TagSet {
    return entityInternals(this).tags;
  }

  /**
   * The entity's own active flag. Setting it to `false` disables every component in the subtree
   * (`onDisable`), hides the Lite subtree, and pauses their coroutines; setting it back reverses
   * that with `onEnable`, and `start` still runs only once ever
   * (`docs/architecture/01-lifecycle-and-time.md` §6).
   *
   * @returns The own flag.
   */
  get active(): boolean {
    return entityInternals(this).active;
  }

  set active(value: boolean) {
    const internals = this.#mutable("active");
    if (internals.active === value) {
      return;
    }
    internals.active = value;
    internals.host.lifecycle.refreshActivation(this);
    internals.onActiveChanged?.emit(value);
  }

  /**
   * `active` and every ancestor's `active`. Materialised on change, never walked per read.
   *
   * @returns `true` when the entity and every ancestor are active.
   */
  get activeInHierarchy(): boolean {
    return entityInternals(this).activeInHierarchy;
  }

  /**
   * The layer slot, `0..31` (`docs/architecture/02-scene-graph.md` §7). Layers drive physics
   * collision matrices and raycast masks. Files store the layer *name*, so reordering the project
   * list is safe.
   *
   * @returns The slot index.
   */
  get layer(): number {
    return entityInternals(this).layer;
  }

  set layer(value: number) {
    if (!isValidLayer(value)) {
      throw new IgnifxError(CoreErrorCode.unknownLayer, `${String(value)} is not a layer slot.`, {
        context: { layer: value, limit: MAX_LAYERS },
        hint: "Layers are integers 0 to 31; resolve a name with world.layers.indexOf(name).",
      });
    }
    this.#mutable("layer").layer = value;
  }

  /**
   * The immovability hint: `true` promises that the transform will not change after `awake`, which
   * lets the 2D batcher, physics, and navmesh treat the entity as static.
   *
   * @returns `true` when the entity is marked static.
   */
  get isStatic(): boolean {
    return entityInternals(this).isStatic;
  }

  set isStatic(value: boolean) {
    const internals = this.#mutable("isStatic");
    if (internals.hasAwoken) {
      throw new IgnifxError(
        CoreErrorCode.mutationAfterDestroy,
        "isStatic is set in files or before awake, and cannot change afterwards.",
        { context: { entity: internals.uid, operation: "isStatic" } },
      );
    }
    internals.isStatic = value;
  }

  /**
   * `true` from the moment `destroy()` is called, long before the destroy flush runs.
   *
   * @returns `true` once the entity has been queued for destruction.
   */
  get isDestroyed(): boolean {
    return entityInternals(this).isDestroyed;
  }

  /**
   * Emitted after a child is added, whether by creation or by reparenting.
   *
   * @returns The signal, created on first access.
   */
  get onChildAdded(): Signal<Entity> {
    const internals = entityInternals(this);
    internals.onChildAdded ??= internals.host.createSignal<Entity>();
    return internals.onChildAdded;
  }

  /**
   * Emitted after a child is removed.
   *
   * @returns The signal, created on first access.
   */
  get onChildRemoved(): Signal<Entity> {
    const internals = entityInternals(this);
    internals.onChildRemoved ??= internals.host.createSignal<Entity>();
    return internals.onChildRemoved;
  }

  /**
   * Emitted with the new parent after this entity is reparented.
   *
   * @returns The signal, created on first access.
   */
  get onParentChanged(): Signal<Entity | null> {
    const internals = entityInternals(this);
    internals.onParentChanged ??= internals.host.createSignal<Entity | null>();
    return internals.onParentChanged;
  }

  /**
   * Emitted with the new value when the entity's **own** active flag changes. An ancestor's change
   * does not emit it; read `activeInHierarchy` for the effective state.
   *
   * @returns The signal, created on first access.
   */
  get onActiveChanged(): Signal<boolean> {
    const internals = entityInternals(this);
    internals.onActiveChanged ??= internals.host.createSignal<boolean>();
    return internals.onActiveChanged;
  }

  /**
   * Emitted in the destroy flush, after the entity's components have run `onDestroy`. `Signal`'s
   * `{ owner }` option uses it to detach handlers automatically.
   *
   * @returns The signal, created on first access.
   */
  get onDestroyed(): Signal<Entity> {
    const internals = entityInternals(this);
    internals.onDestroyed ??= new Signal<Entity>();
    return internals.onDestroyed;
  }

  /**
   * Moves the entity under a new parent, or to the root of its scene.
   *
   * @param parent - The new parent, or `null` to detach to the scene root.
   * @param options - How the entity's transform is treated across the move:
   * `worldPositionStays` is `true` by default and keeps the world transform, while `false` keeps
   * the local values.
   * @throws IgnifxError with code `IGX-0306` when the new parent is inside this entity's own
   * subtree, and `IGX-0101` when either entity has been destroyed.
   *
   * @example
   * ```ts
   * gun.setParent(hand);                                   // snaps to the hand, keeping world pose
   * gun.setParent(hand, { worldPositionStays: false });     // keeps its local offset instead
   * ```
   */
  setParent(parent: Entity | null, options?: SetParentOptions): void {
    const internals = this.#mutable("setParent");
    if (parent === internals.parent) {
      return;
    }
    if (parent !== null) {
      if (parent.isDestroyed) {
        throw destroyedError(entityInternals(parent).uid, "setParent");
      }
      if (parent === this || parent.isDescendantOf(this)) {
        throw new IgnifxError(
          CoreErrorCode.parentingCycle,
          `${internals.name} cannot be parented to ${parent.name}, which is inside its own subtree.`,
          { context: { entity: internals.uid, parent: entityInternals(parent).uid } },
        );
      }
    }
    const previous = internals.parent;
    if (previous === null) {
      internals.scene.removeRoot(this);
    } else {
      const siblings = entityInternals(previous).children;
      const index = siblings.indexOf(this);
      if (index >= 0) {
        siblings.splice(index, 1);
      }
    }
    internals.parent = parent;
    if (parent === null) {
      internals.scene.addRoot(this);
    } else {
      entityInternals(parent).children.push(this);
    }
    const keepWorld = options?.worldPositionStays ?? true;
    const parentNode = parent === null ? null : entityInternals(parent).node;
    if (keepWorld) {
      reparentKeepingWorld(internals.node, parentNode);
    } else {
      linkParent(internals.node, parentNode);
    }
    if (parent !== null && entityInternals(parent).scene !== internals.scene) {
      internals.host.moveToScene(this, entityInternals(parent).scene);
    }
    internals.host.lifecycle.refreshActivation(this);
    if (previous !== null) {
      entityInternals(previous).onChildRemoved?.emit(this);
    }
    if (parent !== null) {
      entityInternals(parent).onChildAdded?.emit(this);
    }
    internals.onParentChanged?.emit(parent);
  }

  /**
   * Resolves a path relative to this entity — `"Body/Arm.L"`, `"../Sibling"`, `"/Root/Child"`.
   *
   * @remarks
   * Deliberately fragile, and allowed only in tests, examples, and tools: the
   * `ignifx/no-entity-find-in-src` rule flags it anywhere else. Use `entityRef`/`componentRef`
   * fields or `requireComponent` to link objects (`docs/architecture/02-scene-graph.md` §4).
   *
   * @param path - The path. A leading `/` resolves from the roots of this entity's scene instance;
   * `..` is the parent and `.` is this entity, as whole segments only, so a name may contain dots.
   * @returns The entity, or `null` when the path resolves to nothing.
   */
  find(path: string): Entity | null {
    return resolvePath(this, path);
  }

  /**
   * Finds a descendant satisfying a predicate.
   *
   * @param predicate - Called with each candidate; the first `true` wins.
   * @param deep - `true` (the default) searches the whole subtree depth-first; `false` searches
   * direct children only.
   * @returns The first match, or `null`.
   */
  findChild(predicate: (entity: Entity) => boolean, deep: boolean = true): Entity | null {
    const children = entityInternals(this).children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child === undefined) {
        continue;
      }
      if (predicate(child)) {
        return child;
      }
      if (deep) {
        const found = child.findChild(predicate, true);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Reports whether this entity is anywhere below another in the tree.
   *
   * @param other - The candidate ancestor.
   * @returns `true` when `other` is a strict ancestor of this entity.
   */
  isDescendantOf(other: Entity): boolean {
    let current = entityInternals(this).parent;
    while (current !== null) {
      if (current === other) {
        return true;
      }
      current = entityInternals(current).parent;
    }
    return false;
  }

  /**
   * The topmost ancestor.
   *
   * @returns The root of this entity's branch, which is this entity when it has no parent.
   */
  root(): Entity {
    return rootOf(this);
  }

  /**
   * Attaches a component.
   *
   * @remarks
   * The engine constructs the class with no arguments, assigns its identity, applies schema
   * defaults then `init`, calls `onAttach`, and finally runs the enable transition — so `awake`
   * runs in the next lifecycle flush, or immediately and nested when `addComponent` is called from
   * inside a callback (`docs/architecture/01-lifecycle-and-time.md` §4). Everything a class lists in
   * `static requires` is added first if it is missing.
   *
   * @typeParam T - The component type.
   * @param type - The component class.
   * @param init - Initial values for the class's schema fields.
   * @returns The attached component.
   * @throws IgnifxError with code `IGX-0202` when the class does not allow multiple instances and
   * the entity already has one, `IGX-0605`/`IGX-0606`/`IGX-0607` when `init` does not match the
   * schema, and `IGX-0101` when the entity has been destroyed.
   */
  addComponent<T extends Component>(type: ConcreteComponentType<T>, init?: ComponentInit<T>): T {
    const internals = this.#mutable("addComponent");
    const host = internals.host;
    const info = host.registry.describe(type);
    if (!info.allowMultiple && this.getComponent(type) !== null) {
      throw new IgnifxError(
        CoreErrorCode.multipleComponentsNotAllowed,
        `${type.prototype.constructor.name} does not allow multiple instances on one entity.`,
        { context: { component: type.prototype.constructor.name, entity: internals.uid } },
      );
    }
    for (let index = 0; index < info.requires.length; index += 1) {
      const required = info.requires[index];
      if (required !== undefined && this.getComponent(required) === null) {
        // Boundary assertion (coding standards §5.2): `requires` names classes the engine has to be
        // able to construct; a class listed there without a no-argument constructor is a
        // declaration bug that surfaces here as a construction failure.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        this.addComponent(required as ConcreteComponentType);
      }
    }
    const component = new type();
    const schema = info.schema;
    if (schema !== null && init !== undefined) {
      applyComponentInit(component, schema, init, type.prototype.constructor.name);
    }
    this.#attach(component);
    host.lifecycle.refreshEnabled(component);
    return component;
  }

  /**
   * The first component matching a class, by identity **or** inheritance — `getComponent(Script)`
   * returns the first script.
   *
   * @typeParam T - The component type.
   * @param type - The component class, abstract or concrete.
   * @returns The first match in attach order, or `null`. Cost is linear in the entity's component
   * count, so cache the result in `awake`.
   */
  getComponent<T extends Component>(type: ComponentType<T>): T | null {
    const components = entityInternals(this).components;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (component !== undefined && matches(component, type)) {
        return component;
      }
    }
    return null;
  }

  /**
   * The first component matching a class, requiring it to be there — the supported way to link
   * components (`docs/architecture/03-scripting-and-components.md` §8).
   *
   * @typeParam T - The component type.
   * @param type - The component class.
   * @returns The first match in attach order.
   * @throws IgnifxError with code `IGX-0201` when the entity has no such component.
   */
  requireComponent<T extends Component>(type: ComponentType<T>): T {
    const found = this.getComponent(type);
    if (found === null) {
      const internals = entityInternals(this);
      throw new IgnifxError(
        CoreErrorCode.requiredComponentMissing,
        `${internals.name} has no ${type.prototype.constructor.name}.`,
        {
          context: { component: type.prototype.constructor.name, entity: internals.uid },
          hint: "Add it with entity.addComponent, or declare it in the requiring class's `static requires`.",
        },
      );
    }
    return found;
  }

  /**
   * Every component matching a class, by identity or inheritance.
   *
   * @typeParam T - The component type.
   * @param type - The component class.
   * @returns A freshly allocated array in attach order; empty when there is no match.
   */
  getComponents<T extends Component>(type: ComponentType<T>): T[] {
    const found: T[] = [];
    const components = entityInternals(this).components;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (component !== undefined && matches(component, type)) {
        found.push(component);
      }
    }
    return found;
  }

  /**
   * The first matching component on this entity or anywhere below it, depth-first.
   *
   * @typeParam T - The component type.
   * @param type - The component class.
   * @param includeInactive - `false` (the default) skips entities that are inactive in the
   * hierarchy.
   * @returns The first match, or `null`.
   */
  getComponentInChildren<T extends Component>(type: ComponentType<T>, includeInactive: boolean = false): T | null {
    if (includeInactive || this.activeInHierarchy) {
      const own = this.getComponent(type);
      if (own !== null) {
        return own;
      }
    }
    const children = entityInternals(this).children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child === undefined) {
        continue;
      }
      const found = child.getComponentInChildren(type, includeInactive);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }

  /**
   * Every matching component on this entity and everything below it, depth-first.
   *
   * @typeParam T - The component type.
   * @param type - The component class.
   * @param includeInactive - `false` (the default) skips entities that are inactive in the
   * hierarchy.
   * @returns A freshly allocated array.
   */
  getComponentsInChildren<T extends Component>(type: ComponentType<T>, includeInactive: boolean = false): T[] {
    const found: T[] = [];
    collectInChildren(this, type, includeInactive, found);
    return found;
  }

  /**
   * The first matching component on this entity or any ancestor.
   *
   * @typeParam T - The component type.
   * @param type - The component class.
   * @returns The first match walking up from this entity, or `null`.
   */
  getComponentInParent<T extends Component>(type: ComponentType<T>): T | null {
    return findInParents(this, type);
  }

  /**
   * Reports whether the entity carries a component of a class.
   *
   * @param type - The component class.
   * @returns `true` when at least one matches.
   */
  hasComponent(type: ComponentType): boolean {
    return this.getComponent(type) !== null;
  }

  /**
   * Queues one component for destruction. It stays usable until the destroy flush.
   *
   * @param component - The component to remove; it must be attached to this entity.
   * @throws IgnifxError with code `IGX-0205` when the component is the entity's transform.
   */
  removeComponent(component: Component): void {
    const internals = entityInternals(this);
    if (component === internals.transform) {
      throw transformIsNotRemovable();
    }
    if (componentInternals(component).entity !== this) {
      return;
    }
    internals.host.lifecycle.queueDestroyComponent(component);
  }

  /**
   * Queues this entity and its whole subtree for the current frame's destroy flush. `isDestroyed`
   * becomes `true` immediately; `onDisable` and `onDestroy` run in the flush, children before
   * parents (`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.
   */
  destroy(): void {
    const internals = entityInternals(this);
    if (internals.isReleased) {
      return;
    }
    internals.host.lifecycle.queueDestroyEntity(this);
  }

  /**
   * Runs the destroy flush for this entity right now, rather than at the end of the frame. It
   * exists for tooling and tests.
   *
   * @throws IgnifxError with code `IGX-0102` when called from inside a lifecycle callback, where
   * destroying an object the engine is still iterating would be unsound; use `destroy()` there.
   */
  destroyImmediate(): void {
    entityInternals(this).host.lifecycle.destroyImmediate(this);
  }

  /**
   * Finishes attaching a component: identity, filing, tracked references, and the `onAttach` hook.
   *
   * @param component - The freshly constructed component.
   */
  #attach(component: Component): void {
    const internals = entityInternals(this);
    const host = internals.host;
    const state = componentInternals(component);
    state.entity = this;
    state.uid = host.nextUid();
    state.handle = host.allocateComponentHandle(component);
    state.serial = host.nextSerial();
    // A component instance's `constructor` is its own component class, and `describe` is cached and
    // idempotent, so looking the info up here rather than threading it through costs one map read.
    const info = host.registry.describe(component.constructor);
    state.info = info;
    internals.components.push(component);
    host.store.add(component, info);
    host.references.watch(component);
    readCallback(component, "onAttach")?.call(component);
  }

  /**
   * The internals, with the "not destroyed" precondition checked.
   *
   * @param operation - What was attempted, for the error's context.
   * @returns The internals.
   */
  #mutable(operation: string): EntityInternals {
    const internals = entityInternals(this);
    if (internals.isDestroyed) {
      throw destroyedError(internals.uid, operation);
    }
    return internals;
  }
}

/**
 * The engine-owned state of an entity, declared through interface merging for the same reason as
 * a component's: `isolatedDeclarations` (coding standards §3) rejects a symbol-keyed class field.
 *
 * @public
 */
// Merging is deliberate and safe here: the class constructor assigns the one property the
// interface declares. See the note on `Component`.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see the note above
export interface Entity {
  /**
   * The engine-owned state.
   *
   * @internal
   */
  [ENTITY_INTERNALS]: EntityInternals;
}

/**
 * Options accepted by `Entity.setParent`.
 *
 * @public
 */
export interface SetParentOptions {
  /**
   * `true` (the default) preserves the entity's world transform by rewriting its local values;
   * `false` keeps the local values, so the entity moves with the new parent
   * (`docs/architecture/02-scene-graph.md` §5.1).
   */
  readonly worldPositionStays?: boolean;
}

/**
 * The topmost ancestor of an entity.
 *
 * @param entity - Where to start.
 * @returns The root of that entity's branch.
 */
function rootOf(entity: Entity): Entity {
  let current = entity;
  let parent = entityInternals(current).parent;
  while (parent !== null) {
    current = parent;
    parent = entityInternals(current).parent;
  }
  return current;
}

/**
 * Walks up from an entity looking for a component.
 *
 * @typeParam T - The component type.
 * @param entity - Where to start.
 * @param type - The query class.
 * @returns The first match, or `null`.
 */
function findInParents<T extends Component>(entity: Entity, type: ComponentType<T>): T | null {
  let current: Entity | null = entity;
  while (current !== null) {
    const found = current.getComponent(type);
    if (found !== null) {
      return found;
    }
    current = entityInternals(current).parent;
  }
  return null;
}

/**
 * Reports whether a component matches a query class, by identity or inheritance, from the ancestor
 * chain the registry precomputed.
 *
 * @typeParam T - The component type.
 * @param component - The candidate.
 * @param type - The query class.
 * @returns `true` when the component is an instance of the class.
 */
function matches<T extends Component>(component: Component, type: ComponentType<T>): component is T {
  const info = componentInternals(component).info;
  if (info === null) {
    return false;
  }
  const ancestors = info.ancestors;
  for (let index = 0; index < ancestors.length; index += 1) {
    if (ancestors[index] === type) {
      return true;
    }
  }
  return false;
}

/**
 * Depth-first collection for `Entity.getComponentsInChildren`.
 *
 * @typeParam T - The component type.
 * @param entity - The subtree root.
 * @param type - The query class.
 * @param includeInactive - Whether inactive entities are visited.
 * @param out - Where matches are appended.
 */
function collectInChildren<T extends Component>(
  entity: Entity,
  type: ComponentType<T>,
  includeInactive: boolean,
  out: T[],
): void {
  if (includeInactive || entity.activeInHierarchy) {
    const components = entityInternals(entity).components;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (component !== undefined && matches(component, type)) {
        out.push(component);
      }
    }
  }
  const children = entityInternals(entity).children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child !== undefined) {
      collectInChildren(child, type, includeInactive, out);
    }
  }
}

/**
 * Validates an `init` object against a schema and copies it onto the component.
 *
 * @param component - The component being initialised.
 * @param schema - Its declared fields.
 * @param init - The caller's values.
 * @param typeName - The class name, for the error message.
 */
function applyComponentInit(component: Component, schema: Schema, init: object, typeName: string): void {
  // Boundary assertion (coding standards §5.2): the invariant is that `ComponentInit<T>` only ever
  // names schema fields, so reading it as a string-keyed bag is exactly what the validator and the
  // deserializer do with the same names.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const values = init as Record<string, unknown>;
  const issues = validateProps(schema, values);
  const first = issues[0];
  if (first !== undefined) {
    throw new IgnifxError(first.code, `${typeName}.${first.path === "" ? "<value>" : first.path}: ${first.message}`, {
      context: { component: typeName, field: first.path, issues: issues.length },
    });
  }
  // Boundary assertion (coding standards §5.2): the component's own schema declares these property
  // names, and the values have just been validated against it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const target = component as unknown as Record<string, unknown>;
  for (const name of Object.keys(schema)) {
    const value = values[name];
    if (value !== undefined) {
      target[name] = value;
    }
  }
}

/**
 * Builds the "used after destroy" error.
 *
 * @param uid - The destroyed entity's identifier.
 * @param operation - What was attempted.
 * @returns The error to throw.
 */
function destroyedError(uid: string, operation: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.mutationAfterDestroy, "This entity has been destroyed.", {
    context: { target: "entity", entity: uid, operation },
    hint: "Check isDestroyed before mutating an object you kept a reference to.",
  });
}

/**
 * Applies an entity's effective activation to its Lite subtree.
 *
 * @param entity - The entity whose visibility changed.
 * @param visible - The new effective activation.
 *
 * @internal
 */
export function applyEntityVisibility(entity: Entity, visible: boolean): void {
  setNodeSelfVisible(entityInternals(entity).node, visible);
}
