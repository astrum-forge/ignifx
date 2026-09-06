import { color, Component, createDefaults, defineSchema, enumOf, str, vec4 } from "@ignifx/core";
import { twoDError, TwoDErrorCode } from "../errors.js";
import { DEFAULT_SORTING_LAYER } from "../service/sorting-layers.js";
import type { Schema, Vec4Like } from "@ignifx/core";

/**
 * `SpriteLayerEffect` (`docs/architecture/11-2d-toolkit.md` §6): a per-layer custom fragment shader.
 *
 * Lite's 2D path has no lighting model, so effects are what a 2D game reaches for instead: a tint,
 * a dissolve, water, a heat shimmer. A layer created with a `customShader`
 * (`Sprite2DLayerOptions.customShader`, `index.d.ts` 11934) runs a WGSL fragment body with a
 * built-in `fx.time` clock and a `fx.params` vec4 the component writes every frame through
 * `setSprite2DShaderParams` (`index.d.ts` 11074).
 *
 * ## The one-shader-per-layer constraint
 *
 * `Sprite2DLayer.customShader` is `readonly` and is only set at creation. A layer's shader
 * therefore cannot change once sprites are in it, so `SpriteLayerEffect` has to exist **before**
 * the first sprite on its sorting layer is synced — put it in the scene file, or add it in
 * `awake`, not halfway through a level.
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
