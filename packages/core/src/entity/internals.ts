import type { Entity } from "./entity.js";
import type { AssetHandle } from "../assets/types.js";
import type { Component } from "../component/component.js";
import type { EntityHandle } from "../handles/handle.js";
import type { LiteSceneNode } from "../lite/node.js";
import type { SceneInstance } from "../scene/scene-instance.js";
import type { SceneAsset } from "../serialization/scene-asset.js";
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
 * Where an entity came from, for the entities a scene file's `instance` entry produced. The scene
 * loader fills it in; `Entity.prefab` and the serializer's override diffing read it
 * (`docs/architecture/02-scene-graph.md` §6, `06-serialization-and-scene-format.md` §5).
 *
 * @internal
 */
export interface EntityOrigin {
  /** The uid the entity carries in the scene file that declared it, which overrides address. */
  readonly sourceUid: string;
  /**
   * The instance root this entity sits *inside*, or `null` when the scene file declared it
   * directly. An instance root is inside its own parent instance, if any, not inside itself.
   */
  readonly instanceRoot: Entity | null;
  /** Set when this entity *is* the root of an instance. */
  readonly instanced: EntityInstanceLink | null;
  /** Expanded component uid to the uid that component carries in the file that declared it. */
  readonly componentSourceUids: ReadonlyMap<string, string>;
}

/**
 * The instanced scene an instance root stands for.
 *
 * @internal
 */
export interface EntityInstanceLink {
  /** The address of the instanced scene. */
  readonly address: string;
  /** The handle it was loaded through, when the asset service resolved one. */
  readonly asset: AssetHandle<SceneAsset> | null;
  /** The scene value, so the serializer can diff current state against it. */
  readonly scene: SceneAsset;
}

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
  /**
   * Where the entity came from when a scene file's `instance` entry produced it, or `null` for an
   * entity a scene declared itself or code created (`docs/architecture/02-scene-graph.md` §6).
   */
  origin: EntityOrigin | null;
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
  onComponentAdded: Signal<Component> | null;
  /** Lazily created. */
  onComponentRemoved: Signal<Component> | null;
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
