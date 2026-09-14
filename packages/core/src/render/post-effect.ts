import { asJsonObject } from "../serialization/json-view.js";
import type { ShaderAsset } from "./shader-asset.js";
import type { ShaderTextureDeclaration, ShaderUniformType } from "./shader-declaration.js";
import type { TextureAsset } from "./texture-asset.js";
import type { AssetHandle } from "../assets/types.js";
import type { JsonValue } from "../schema/json.js";
import type { CustomFieldCodec } from "../schema/types.js";

/**
 * What a `PostProcessStack` needs to describe a custom `// @ignifx post` effect: its settings record,
 * the uniforms every effect gets for free, and the schema codec its `values` round-trip through
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.3).
 *
 * `PostProcessStack` is in every game's static graph, so the WGSL generator and the uniform layout
 * live in `./post-effect-compiler.ts`, which the `.wgsl` loader pulls in only for a `post` file.
 */

/**
 * The name a `// @ignifx post` file gives its fragment function.
 *
 * @public
 */
export const POST_EFFECT_FUNCTION = "mainFragment";

/**
 * The uniforms every post effect's `shaderUniforms` block carries before the file's own, in this
 * order.
 *
 * @remarks
 * `screenSize` is in backing-store pixels — `canvas.width`/`canvas.height` — like everything else
 * the engine reports (`docs/architecture/07-rendering.md` §3). The three clocks are the app's, so
 * `time` freezes under `app.pause()` and `unscaledTime` does not.
 *
 * @public
 */
export const POST_EFFECT_BUILTIN_UNIFORMS: readonly { readonly name: string; readonly type: ShaderUniformType }[] =
  Object.freeze([
    { name: "screenSize", type: "vec2<f32>" },
    { name: "time", type: "f32" },
    { name: "unscaledTime", type: "f32" },
    { name: "deltaTime", type: "f32" },
  ]);

/**
 * One custom effect on a `PostProcessStack` (`docs/architecture/07-rendering.md` §2.7).
 *
 * @public
 */
export interface CustomEffectSettings {
  /** The `// @ignifx post` shader; `null` records nothing. */
  shader: AssetHandle<ShaderAsset> | null;
  /** Whether the effect runs. */
  enabled: boolean;
  /** Position in the chain; lower runs first, alongside bloom's and SMAA's `order`. */
  order: number;
  /** Overrides of the file's declared uniform defaults, by declared name. */
  values: Record<string, number | readonly number[]>;
  /** Textures for the file's declared samplers, by declared name. */
  textures: Record<string, AssetHandle<TextureAsset> | null>;
}

/**
 * What {@link customEffect} accepts: a shader and whichever fields differ from the defaults.
 *
 * @public
 */
export interface CustomEffectInit {
  /** The `// @ignifx post` shader. */
  readonly shader: AssetHandle<ShaderAsset> | null;
  /** Whether the effect runs. Defaults to `true`. */
  readonly enabled?: boolean;
  /** Position in the chain. Defaults to `10`, which is after the built-ins' defaults. */
  readonly order?: number;
  /** Overrides of the file's declared uniform defaults. */
  readonly values?: Readonly<Record<string, number | readonly number[]>>;
  /** Textures for the file's declared samplers. */
  readonly textures?: Readonly<Record<string, AssetHandle<TextureAsset> | null>>;
}

/**
 * Fills in a custom effect's defaults, so a caller names only what it means to set.
 *
 * @param init - The shader and the fields to set.
 * @returns A complete settings record, ready to push onto `PostProcessStack.custom`.
 *
 * @example
 * ```ts
 * stack.custom.push(customEffect({ shader: vignette, order: 5, values: { amount: 0.6 } }));
 * ```
 *
 * @public
 */
export function customEffect(init: CustomEffectInit): CustomEffectSettings {
  return {
    shader: init.shader,
    enabled: init.enabled ?? true,
    order: init.order ?? 10,
    values: { ...init.values },
    textures: { ...init.textures },
  };
}

/**
 * The binding index of the chain's current colour.
 *
 * @internal
 */
export const INPUT_TEXTURE_BINDING = 1;

/**
 * The binding index of the chain's current colour sampler.
 *
 * @internal
 */
export const INPUT_SAMPLER_BINDING = 2;

/** The first binding index a declared texture takes. */
const FIRST_DECLARED_BINDING = 3;

/**
 * The binding index of one declared texture, and of its sampler.
 *
 * @param index - The texture's index in declaration order.
 * @returns The texture's binding; the sampler is one higher.
 *
 * @internal
 */
export function declaredTextureBinding(index: number): number {
  return FIRST_DECLARED_BINDING + index * 2;
}

/**
 * One member of a compiled effect's uniform struct, with the byte offset the generated WGSL puts it
 * at.
 *
 * @internal
 */
export interface PostEffectUniformField {
  /** The WGSL member name. */
  readonly name: string;
  /** The WGSL type. */
  readonly type: ShaderUniformType;
  /** How many floats the value holds. */
  readonly components: number;
  /** Where the member starts in the uniform buffer, in bytes. */
  readonly byteOffset: number;
}

/**
 * A `// @ignifx post` file compiled into what Babylon Lite's fullscreen effect path needs.
 *
 * @internal
 */
export interface CompiledPostEffect {
  /** The shader's address, for diagnostics and for the chain's identity. */
  readonly address: string;
  /** The whole fragment module: the bindings, the generated structs, the file, and the entry point. */
  readonly fragmentWGSL: string;
  /** The uniform members, built-ins first, in struct order. */
  readonly uniforms: readonly PostEffectUniformField[];
  /** The members by name, for a value write. */
  readonly byName: ReadonlyMap<string, PostEffectUniformField>;
  /** How large the uniform buffer has to be. */
  readonly uniformByteLength: number;
  /** The file's declared samplers, in declaration order. */
  readonly textures: readonly ShaderTextureDeclaration[];
}

/**
 * The codec that round-trips a custom effect's `values` record through a scene file.
 *
 * @remarks
 * A schema field cannot describe these: the uniforms are declared by the `.wgsl`, so `map(f32)`
 * would drop every vector and colour uniform and `map(vec4)` would write `amount: 0.6` as four
 * floats. The codec round-trips exactly what a shader file allows — a number or an array of numbers.
 *
 * @returns The codec, for a `custom()` field.
 *
 * @internal
 */
export function postEffectValuesCodec(): CustomFieldCodec<Record<string, number | readonly number[]>> {
  return {
    createDefault(): Record<string, number | readonly number[]> {
      return {};
    },
    serialize(value: Record<string, number | readonly number[]>): JsonValue {
      const json: Record<string, JsonValue> = {};
      // Lexicographic, so two saves of the same state are byte-identical
      // (`docs/architecture/06-serialization-and-scene-format.md` §1).
      for (const name of Object.keys(value).toSorted()) {
        const entry = value[name];
        json[name] = typeof entry === "number" ? entry : [...(entry ?? [])];
      }
      return json;
    },
    deserialize(json: JsonValue): Record<string, number | readonly number[]> {
      const value: Record<string, number | readonly number[]> = {};
      const object = asJsonObject(json);
      if (object === null) {
        return value;
      }
      for (const name of Object.keys(object)) {
        const entry = object[name];
        if (typeof entry === "number") {
          value[name] = entry;
        } else if (Array.isArray(entry)) {
          value[name] = entry.map((component) => (typeof component === "number" ? component : 0));
        }
      }
      return value;
    },
    jsonSchema: {
      type: "object",
      additionalProperties: {
        oneOf: [{ type: "number" }, { type: "array", items: { type: "number" } }],
      },
    },
  };
}
