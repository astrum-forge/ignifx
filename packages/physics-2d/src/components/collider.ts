import { asset, bool, Component, createDefaults, enumOf, f32, optional, record, str, vec2 } from "@ignifx/core";
import { PhysicsMaterial2D } from "../material.js";
import { Physics2DHostKey } from "../runtime/runtime-key.js";
import type { RapierShape2D } from "../lite/rapier/world.js";
import type { Physics2DMaterialValues } from "../settings.js";
import type { AssetHandle, ComponentHooks, Schema, Vec2Like } from "@ignifx/core";

/**
 * The 2D collider contract (`docs/architecture/11-2d-toolkit.md` §8). Every collider shares an
 * offset, the trigger flag, a surface, a layer override, and the one-way platform flag, and answers
 * one question the body builder asks: which Rapier shapes it stands for.
 *
 * ## Corrections to §8
 *
 * - **The material is two fields, not a union.** A schema field has exactly one kind (ADR-0004), so
 *   {@link Collider2D.material} (an asset reference) and {@link Collider2D.inlineMaterial} (a
 *   record) are separate; the asset wins, the inline record is the fallback, and
 *   `physics2d.defaultMaterial` is the last resort. This is the same split `@ignifx/physics` makes.
 * - **Combine rules are collider fields.** Rapier combines two surfaces' friction and restitution
 *   with a per-collider rule (`dynamics/coefficient_combine_rule.d.ts`); the 3D
 *   `ignifx.physicsmaterial` document has no such field, so the knob lives here rather than
 *   forking the asset format.
 * - **A collider may stand for several Rapier colliders.** `TilemapCollider2D` produces one polygon
 *   per merged tile run, so {@link Collider2D.collectShapes} fills a list rather than returning one
 *   shape.
 *
 * ## Sizes and scale
 *
 * Sizes are authored in local metres and multiplied by the entity's lossy scale when the shapes are
 * built. Rapier cannot rescale a built shape, so a later scale change needs
 * {@link Collider2D.rebuild}.
 */

/**
 * How two surfaces' coefficients are combined when they touch, mirroring Rapier's
 * `CoefficientCombineRule`.
 *
 * @public
 */
export const COMBINE_RULES = ["average", "min", "multiply", "max"] as const;

/**
 * The union of {@link COMBINE_RULES}.
 *
 * @public
 */
export type CombineRule = (typeof COMBINE_RULES)[number];

/**
 * One Rapier shape a collider stands for, positioned in the body's local frame.
 *
 * @internal
 */
export interface CollectedShape2D {
  /** The geometry. */
  readonly shape: RapierShape2D;
  /** Where it sits relative to the entity origin, in metres. */
  readonly offset: Vec2Like;
  /** How it is turned about that point, in radians counter-clockwise. */
  readonly rotation: number;
  /** Whether it is solid only when a character controller comes down onto it. */
  readonly oneWay: boolean;
}

/**
 * The fields every 2D collider declares.
 *
 * @returns The shared field declarations, ready to spread into a collider's own schema.
 *
 * @public
 */
export function collider2DFields(): Schema {
  return {
    offset: vec2(),
    isTrigger: bool(false),
    material: asset(PhysicsMaterial2D),
    inlineMaterial: optional(
      record({
        friction: f32(0.6, { min: 0 }),
        restitution: f32(0, { min: 0, max: 1 }),
      }),
    ),
    frictionCombine: enumOf(COMBINE_RULES, "average"),
    restitutionCombine: enumOf(COMBINE_RULES, "average"),
    oneWay: bool(false),
    layerOverride: str(""),
  };
}

/**
 * The base class of every 2D collider.
 *
 * @public
 */
export abstract class Collider2D extends Component implements ComponentHooks {
  /** Several colliders on one entity make one compound body. */
  static allowMultiple = true;

  /** The shape's offset from the entity origin, in local metres. */
  declare offset: Vec2Like;

  /** When `true` the shape reports overlaps and resolves no contacts. */
  declare isTrigger: boolean;

  /** A `.physicsmaterial.json` reference; wins over {@link Collider2D.inlineMaterial}. */
  declare material: AssetHandle<PhysicsMaterial2D> | null;

  /** An inline surface, used when {@link Collider2D.material} is `null`. */
  declare inlineMaterial: Physics2DMaterialValues | null;

  /** How this surface's friction combines with the one it touches. */
  declare frictionCombine: CombineRule;

  /** How this surface's restitution combines with the one it touches. */
  declare restitutionCombine: CombineRule;

  /**
   * Whether this is a one-way platform: a `CharacterController2D` with
   * `onOneWayPlatforms` passes up through it and lands on it coming down. Rigid bodies are
   * unaffected — one-way support is a character-controller feature in the MVP.
   */
  declare oneWay: boolean;

  /** The name of the layer this collider filters as, or `""` to use `entity.layer`. */
  declare layerOverride: string;

  /** Applies the shared defaults. A concrete collider calls `super()` and then applies its own. */
  constructor() {
    super();
    Object.assign(this, createDefaults(collider2DFields()));
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
   * changing a size, an offset, `isTrigger`, or the entity's scale.
   *
   * @example
   * ```ts
   * box.size = { x: 2, y: 2 };
   * box.rebuild();
   * ```
   */
  rebuild(): void {
    this.app.services.tryGet(Physics2DHostKey)?.runtime?.markDirty(this.entity);
  }

  /**
   * Resolves the surface this collider presents to Rapier.
   *
   * @param fallback - The world's `physics2d.defaultMaterial`.
   * @returns The asset's values, the inline values, or the fallback.
   */
  resolveMaterial(fallback: Physics2DMaterialValues): Physics2DMaterialValues {
    return this.material?.value ?? this.inlineMaterial ?? fallback;
  }

  /**
   * Appends the Rapier shapes this collider stands for.
   *
   * @param scale - The entity's lossy scale in the 2D plane.
   * @param out - The list to append to.
   *
   * @internal
   */
  abstract collectShapes(scale: Vec2Like, out: CollectedShape2D[]): void;
}
