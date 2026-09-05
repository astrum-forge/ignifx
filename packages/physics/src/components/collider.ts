import { asset, bool, Component, createDefaults, optional, record, str, vec3, f32 } from "@ignifx/core";
import { PhysicsMaterial } from "../material.js";
import { PhysicsHostKey } from "../runtime/runtime-key.js";
import type { LitePhysicsShape, LitePhysicsWorld } from "../lite/havok.js";
import type { PhysicsMaterialValues } from "../settings.js";
import type { AssetHandle, ComponentHooks, LiteSceneNode, MutableVec3, Schema, Vec3Like } from "@ignifx/core";

/**
 * The collider contract (`docs/architecture/09-physics.md` §2.2). Every collider shares four
 * fields — `center`, `isTrigger`, a material, and a layer override — and answers two questions the
 * body builder asks: what Havok shape it is, and how big its local bounding box is.
 *
 * ## The one correction to §2.2
 *
 * §2.2 writes the material field as `material: asset(PhysicsMaterial) | inline { … }`. A schema
 * field has exactly one kind (ADR-0004), so the union is split into two fields:
 * {@link Collider.material} (an asset reference) and {@link Collider.inlineMaterial} (a record).
 * The asset wins, the inline record is the fallback, and `physics.defaultMaterial` is the last
 * resort.
 *
 * ## Shape sizes and scale
 *
 * Sizes are authored in local units and multiplied by the entity's lossy scale when the shape is
 * built. Havok has no way to rescale a built shape, so changing the scale afterwards needs
 * {@link Collider.rebuild}, exactly as §2.2 says.
 */

/**
 * The fields every collider declares. It is a function because a field kind is a function call and
 * module scope holds declarations only (`CONSTITUTION.md` §3.5).
 *
 * @returns The shared field declarations, ready to spread into a collider's own schema.
 *
 * @public
 */
export function colliderFields(): Schema {
  return {
    center: vec3(),
    isTrigger: bool(false),
    material: asset(PhysicsMaterial),
    inlineMaterial: optional(
      record({
        friction: f32(0.6, { min: 0 }),
        staticFriction: f32(0.6, { min: 0 }),
        restitution: f32(0, { min: 0, max: 1 }),
      }),
    ),
    layerOverride: str(""),
  };
}

/**
 * The base class of every collider. It is never registered on its own; `entity.getComponents` and
 * `world.components` accept it because the concrete colliders extend it.
 *
 * @public
 */
export abstract class Collider extends Component implements ComponentHooks {
  /** Several colliders on one entity form one compound body (`09-physics.md` §2.2). */
  static allowMultiple = true;

  /** The shape's offset from the entity origin, in local units. */
  declare center: Vec3Like;

  /** When `true` the shape reports overlaps and resolves no contacts. */
  declare isTrigger: boolean;

  /** A `.physicsmaterial.json` reference; wins over {@link Collider.inlineMaterial}. */
  declare material: AssetHandle<PhysicsMaterial> | null;

  /** An inline surface, used when {@link Collider.material} is `null`. */
  declare inlineMaterial: PhysicsMaterialValues | null;

  /** The name of the layer this collider filters as, or `""` to use `entity.layer`. */
  declare layerOverride: string;

  /**
   * Applies the shared defaults. A concrete collider calls `super()` and then applies its own.
   */
  constructor() {
    super();
    Object.assign(this, createDefaults(colliderFields()));
  }

  /** Marks the entity's body for a rebuild at the start of the next fixed step. */
  onAttach(): void {
    this.rebuild();
  }

  /** Marks the entity's body for a rebuild, which removes this collider from it. */
  onDetach(): void {
    this.rebuild();
  }

  /**
   * Rebuilds the entity's body and shapes at the start of the next fixed step. Call it after
   * changing a size, a centre, `isTrigger`, or the entity's scale.
   *
   * @example
   * ```ts
   * box.size = { x: 2, y: 2, z: 2 };
   * box.rebuild();
   * ```
   */
  rebuild(): void {
    this.app.services.tryGet(PhysicsHostKey)?.runtime?.markDirty(this.entity);
  }

  /**
   * Resolves the surface this collider presents to Havok.
   *
   * @param fallback - The world's `physics.defaultMaterial`.
   * @returns The asset's values, the inline values, or the fallback.
   */
  resolveMaterial(fallback: PhysicsMaterialValues): PhysicsMaterialValues {
    return this.material?.value ?? this.inlineMaterial ?? fallback;
  }

  /**
   * Builds the Havok shape this collider stands for.
   *
   * @param world - The Havok world.
   * @param scale - The entity's lossy scale.
   * @param node - The entity's Lite node, for the colliders that read geometry from it.
   * @returns The shape handle.
   *
   * @internal
   */
  abstract createShape(world: LitePhysicsWorld, scale: Vec3Like, node: LiteSceneNode): LitePhysicsShape;

  /**
   * Writes the half-extents of this collider's local bounding box, scale applied. The service's
   * `overlap` and `shapeCast` use it to resolve entities that Lite's queries do not identify.
   *
   * @param scale - The entity's lossy scale.
   * @param out - The vector to write.
   *
   * @internal
   */
  abstract halfExtentsToRef(scale: Vec3Like, out: MutableVec3): void;
}
