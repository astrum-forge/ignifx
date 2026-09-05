import type { Entity } from "./entity.js";
import type { Component } from "../component/component.js";
import type { EntityHandle } from "../handles/handle.js";
import type { LiteSceneNode } from "../lite/node.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { Signal } from "../signal/signal.js";
import type { TagSet } from "../tags/tag-set.js";
import type { Transform } from "../transform/transform.js";
import type { WorldHost } from "../world/world-host.js";

/**
 * The engine-owned state of an entity, kept behind a module symbol for the same reasons as a
 * component's: the world, the lifecycle queue, and the destroy flush all need to read and write it,
 * while game code has no way to name it.
 */

/**
 * The key the engine state hangs off an entity.
 *
 * @internal
 */
export const ENTITY_INTERNALS: unique symbol = Symbol("ignifx.entity.internals");

/**
 * The engine-owned state of one entity.
 *
 * @internal
 */
export interface EntityInternals {
  /** The world that owns the entity. */
  readonly host: WorldHost;
  /** The Babylon Lite node the entity's transform is a view over. */
  readonly node: LiteSceneNode;
  /** The dense runtime handle. */
  readonly handle: EntityHandle;
  /** The stable ULID. */
  readonly uid: string;
  /** Monotonic creation serial; sibling order and dispatch tie-breaks read it. */
  readonly serial: number;
  /** The free-form tags, with the world's index kept current through the set's observer. */
  readonly tags: TagSet;
  /** The entity's transform, assigned the moment the constructor has built it. */
  transform: Transform | null;
  /** The display name; not unique and never used for lookup by the engine. */
  name: string;
  /** The scene instance that owns the entity. */
  scene: SceneInstance;
  /** The parent, or `null` for a root. */
  parent: Entity | null;
  /** The children, in creation order. */
  children: Entity[];
  /** The components, in attach order. The transform is always index 0. */
  components: Component[];
  /** The entity's own active flag. */
  active: boolean;
  /** `active` and every ancestor's `active`, materialised on change rather than walked per read. */
  activeInHierarchy: boolean;
  /** The layer slot, `0..31`. */
  layer: number;
  /** The immovability hint; settable only before the entity's first `awake`. */
  isStatic: boolean;
  /** `true` once any of the entity's components has run `awake`, which freezes `isStatic`. */
  hasAwoken: boolean;
  /** `true` from the moment `destroy()` is called. */
  isDestroyed: boolean;
  /** `true` once the destroy flush has released the entity. */
  isReleased: boolean;
  /** `true` while the entity sits in the destroy queue, so it is queued at most once. */
  isDestroyQueued: boolean;
  /** Lazily created signals; `null` until something asks for them. */
  onChildAdded: Signal<Entity> | null;
  /** Lazily created. */
  onChildRemoved: Signal<Entity> | null;
  /** Lazily created. */
  onParentChanged: Signal<Entity | null> | null;
  /** Lazily created. */
  onActiveChanged: Signal<boolean> | null;
  /** Lazily created. */
  onDestroyed: Signal<Entity> | null;
}

/**
 * Reads an entity's engine-owned state.
 *
 * @param entity - The entity.
 * @returns Its internal state.
 *
 * @internal
 */
export function entityInternals(entity: Entity): EntityInternals {
  return entity[ENTITY_INTERNALS];
}
