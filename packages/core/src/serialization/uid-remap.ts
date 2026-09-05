import type { AssetHandle } from "../assets/types.js";
import type { Component } from "../component/component.js";
import type { Entity } from "../entity/entity.js";
import type { ReferenceDecoder, ReferenceEncoder } from "../schema/encode.js";

/**
 * The per-instance mapping from the uids a scene file carries to the runtime objects built from it
 * (`docs/architecture/02-scene-graph.md` §10). Loading the same scene twice produces two remaps, so
 * two instances of one prefab never resolve each other's references.
 *
 * @remarks
 * The "file uid" side of the table is the uid an entity carries in the *expanded* file — the same
 * uid for entities declared by the scene itself, and a freshly minted one for each copy an
 * `instance` entry expands, because a prefab instanced twice would otherwise contribute the same
 * uid twice.
 *
 * @public
 */
export class UidRemap {
  readonly #entities = new Map<string, Entity>();

  readonly #components = new Map<string, Component>();

  /**
   * How many entities the remap holds.
   *
   * @returns The entity count.
   */
  get size(): number {
    return this.#entities.size;
  }

  /**
   * Records the entity a file uid produced.
   *
   * @param fileUid - The uid the expanded file carries.
   * @param entity - The entity built from it.
   *
   * @internal
   */
  addEntity(fileUid: string, entity: Entity): void {
    this.#entities.set(fileUid, entity);
  }

  /**
   * Records the component a file uid produced.
   *
   * @param fileUid - The uid the expanded file carries.
   * @param component - The component built from it.
   *
   * @internal
   */
  addComponent(fileUid: string, component: Component): void {
    this.#components.set(fileUid, component);
  }

  /**
   * Resolves a file uid to its entity.
   *
   * @param fileUid - The uid read from the file.
   * @returns The entity, or `null` when the file declares no such entity.
   */
  entity(fileUid: string): Entity | null {
    return this.#entities.get(fileUid) ?? null;
  }

  /**
   * Resolves a file uid to its component.
   *
   * @param fileUid - The uid read from the file.
   * @returns The component, or `null` when the file declares no such component.
   */
  component(fileUid: string): Component | null {
    return this.#components.get(fileUid) ?? null;
  }

  /**
   * Every entity the remap holds, in the order the file declared them.
   *
   * @returns The live iterator over `[fileUid, entity]` pairs.
   */
  entries(): IterableIterator<readonly [string, Entity]> {
    return this.#entities.entries();
  }

  /** Drops every entry; the scene instance calls it on unload. */
  clear(): void {
    this.#entities.clear();
    this.#components.clear();
  }
}

/**
 * How an `asset()` field's address becomes the handle the component holds
 * (`docs/architecture/05-assets-and-loading.md` §3). The scene loader supplies one over the
 * dependency handles the `SceneAsset` already retains.
 *
 * @param address - The address the file carries.
 * @param type - The asset type the field or the file declared, or `null`.
 * @returns The loaded handle, or `null` when nothing loaded stands at that address.
 *
 * @internal
 */
export type AssetResolver = (address: string, type: string | null) => AssetHandle | null;

/**
 * Resolves nothing — the decoder a caller with no asset service passes.
 *
 * @returns `null`, always.
 *
 * @internal
 */
export function noAssets(): null {
  return null;
}

/**
 * The {@link ReferenceDecoder} over a remap: this is what makes `entityRef`/`componentRef` fields
 * resolve to the *instance's own* objects rather than to another instance of the same prefab
 * (`docs/architecture/06-serialization-and-scene-format.md` §4 step 5), and what turns an
 * `asset()` field's address into the handle the scene already loaded.
 *
 * @param remap - The table filled while the scene was being constructed.
 * @param assets - How an asset address becomes a handle; defaults to resolving nothing, which makes
 * every `asset()` field `null` with an `IGX-0602` issue.
 * @returns The decoder to hand `decodeProps`.
 *
 * @internal
 */
export function remapDecoder(remap: UidRemap, assets: AssetResolver = noAssets): ReferenceDecoder {
  return {
    entity: (uid: string): unknown => remap.entity(uid),
    component: (uid: string): unknown => remap.component(uid),
    asset: (address: string, type: string | null): unknown => assets(address, type),
  };
}

/**
 * The {@link ReferenceEncoder} the serializer uses: an entity or component is addressable only when
 * the file being written contains it, which is exactly "it is in the membership set"
 * (`docs/architecture/06-serialization-and-scene-format.md` §2 — "File references never cross scene
 * files").
 *
 * @param entities - The entities the file will contain.
 * @param components - The components the file will contain.
 * @returns The encoder to hand `encodeProps`.
 *
 * @internal
 */
export function membershipEncoder(entities: ReadonlySet<Entity>, components: ReadonlySet<Component>): ReferenceEncoder {
  return {
    entityUid: (value: unknown): string | null => {
      // Boundary check: `entityRef` fields hold entities, and `has` is the membership test that
      // makes the narrowing sound without an assertion.
      return isEntity(value) && entities.has(value) ? value.uid : null;
    },
    componentUid: (value: unknown): string | null => {
      return isComponent(value) && components.has(value) ? value.uid : null;
    },
  };
}

/**
 * Narrows an unknown reference value to an entity, structurally: the encoder only ever asks about
 * values a `entityRef` field held, and membership in the file's entity set is the real test.
 *
 * @param value - The field value.
 * @returns `true` when the value is an object carrying a string `uid`.
 */
function isEntity(value: unknown): value is Entity {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "uid") === "string";
}

/**
 * Narrows an unknown reference value to a component.
 *
 * @param value - The field value.
 * @returns `true` when the value is an object carrying a string `uid`.
 */
function isComponent(value: unknown): value is Component {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "uid") === "string";
}
