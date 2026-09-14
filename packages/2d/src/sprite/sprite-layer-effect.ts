import { color, Component, createDefaults, defineSchema, enumOf, str, vec4 } from "@ignifx/core";
import { twoDError, TwoDErrorCode } from "../errors.js";
import { DEFAULT_SORTING_LAYER } from "../service/sorting-layers.js";
import type { Schema, Vec4Like } from "@ignifx/core";

/**
 * Apply a custom fragment shader to a sorting layer. The shader is fixed when the layer is
 * created, so add the effect before that layer's first sprite sync, such as in the scene or `awake`.
 */

/**
 * The built-in effects, in the order an inspector should list them.
 *
 * @public
 */
export const SPRITE_EFFECT_KINDS = ["tint", "custom"] as const;

/**
 * Which shader a `SpriteLayerEffect` installs.
 *
 * @public
 */
export type SpriteEffectKind = (typeof SPRITE_EFFECT_KINDS)[number];

/**
 * The WGSL body of the built-in `tint` effect.
 *
 * @remarks
 * Multiplies the sampled texel by `fx.params.rgb` and scales its alpha by `fx.params.a`, which is
 * a per-layer tint that a per-sprite `color` cannot express — every sprite in the layer fades
 * together, in one uniform write, rather than in one instance write each.
 *
 * @public
 */
export const TINT_EFFECT_WGSL =
  "let texel = textureSample(atlasTex, atlasSamp, uv); return vec4f(texel.rgb * fx.params.rgb, texel.a * fx.params.a);";

/**
 * A per-layer shader effect.
 *
 * @example
 * ```ts
 * const dusk = app.world.createEntity({ name: "dusk" }).addComponent(SpriteLayerEffect);
 * dusk.sortingLayer = "Default";
 * dusk.kind = "tint";
 * dusk.tint = { r: 0.6, g: 0.6, b: 0.9, a: 1 };
 * ```
 *
 * @public
 */
export class SpriteLayerEffect extends Component {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/SpriteLayerEffect";

  /** One effect per entity; several entities may each drive a different sorting layer. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = spriteLayerEffectSchema();

  /** Which sorting layer the effect applies to. */
  declare sortingLayer: string;

  /** Which shader to install. */
  declare kind: SpriteEffectKind;

  /** The colour the `tint` effect multiplies by, written into `fx.params`. */
  declare tint: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

  /** The `fx.params` vec4 a `custom` shader reads. */
  declare params: Vec4Like;

  /** The WGSL fragment body a `custom` effect installs. */
  declare shader: string;

  /**
   * Builds an effect with the schema's defaults.
   */
  constructor() {
    super();
    Object.assign(this, createDefaults(SpriteLayerEffect.schema));
  }

  /**
   * The WGSL fragment body this effect installs.
   *
   * @returns The shader source.
   * @throws IgnifxError with code `IGX-1113` when `kind` is `"custom"` and `shader` is empty.
   */
  source(): string {
    if (this.kind === "tint") {
      return TINT_EFFECT_WGSL;
    }
    if (this.shader === "") {
      throw twoDError(TwoDErrorCode.missingShaderSource, "A custom SpriteLayerEffect needs a WGSL fragment body.", {
        context: { sortingLayer: this.sortingLayer, entity: this.entity.uid },
        hint: 'Set `effect.shader` to a WGSL body, or use kind: "tint".',
      });
    }
    return this.shader;
  }

  /**
   * The `fx.params` vec4 to write this frame.
   *
   * @param out - The four numbers to fill.
   * @returns `out`.
   *
   * @internal
   */
  writeParams(out: Float32Array): Float32Array {
    if (this.kind === "tint") {
      out[0] = this.tint.r;
      out[1] = this.tint.g;
      out[2] = this.tint.b;
      out[3] = this.tint.a;
      return out;
    }
    out[0] = this.params.x;
    out[1] = this.params.y;
    out[2] = this.params.z;
    out[3] = this.params.w;
    return out;
  }
}

/**
 * The `SpriteLayerEffect` schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function spriteLayerEffectSchema(): Schema {
  return defineSchema({
    sortingLayer: str(DEFAULT_SORTING_LAYER, { tooltip: "Which sorting layer the effect applies to." }),
    kind: enumOf(SPRITE_EFFECT_KINDS, "tint", { tooltip: "Which shader to install." }),
    tint: color("#ffffffff", { tooltip: "The colour the tint effect multiplies by." }),
    params: vec4({ x: 0, y: 0, z: 0, w: 0 }, { tooltip: "The fx.params vec4 a custom shader reads." }),
    shader: str("", { tooltip: "The WGSL fragment body a custom effect installs." }),
  });
}
