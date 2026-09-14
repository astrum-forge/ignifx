import { CoreErrorCode } from "../errors/error-codes.js";
import { assertNever, IgnifxError } from "../errors/ignifx-error.js";
import { SHADER_UNIFORM_TYPES } from "./shader-declaration.js";
import type { ShaderTextureDeclaration, ShaderUniformDeclaration, ShaderUniformType } from "./shader-declaration.js";

/**
 * The raw Babylon Lite material-plugin points, as a `@beta` escape hatch
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.2, ADR-0024).
 *
 * `@beta` because the meaning of each point is whatever the surrounding Lite template declares at
 * that line; ignifx's stable contract is the three hooks of `./surface-shader.ts`. Four rules read
 * out of `@babylonjs/lite@1.27.0`'s `lib/` on 2026-09-08:
 *
 * - Plugin uniforms and samplers are **fragment-stage only** on both families
 *   (`lib/material/plugin/plugin-bridge-shared.js` 99), and there is no vertex helper-function
 *   channel, so vertex code may read only attributes, `mesh.world` and the scene block, and must be
 *   statements rather than functions.
 * - `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION` is injected **twice** — Lite maps it to the two
 *   adjacent PBR slots `AI` and `NI` — so its code must be idempotent or guard itself with a flag
 *   set at an earlier point, and must declare nothing at statement level.
 * - Only PBR carries `CUSTOM_FRAGMENT_UPDATE_DIFFUSE` after `CUSTOM_FRAGMENT_UPDATE_ALPHA`;
 *   Standard's template orders them the other way and has no `AI`/`NI`/`MF` slots.
 * - `roughness` and `metallic` are `let` in the PBR template and cannot be written.
 */

/**
 * The Babylon Lite injection points a {@link MaterialPluginDefinition} may fill in.
 *
 * @remarks
 * The names are Lite's own (`MaterialPluginPoint`, `index.d.ts` 7084) and are taught verbatim,
 * because a plugin's code is written against the template around the point.
 *
 * @beta
 */
export const LITE_MATERIAL_PLUGIN_POINTS = [
  "CUSTOM_FRAGMENT_DEFINITIONS",
  "CUSTOM_FRAGMENT_MAIN_BEGIN",
  "CUSTOM_FRAGMENT_UPDATE_ALPHA",
  "CUSTOM_FRAGMENT_UPDATE_DIFFUSE",
  "CUSTOM_FRAGMENT_BEFORE_LIGHTS",
  "CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION",
  "CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR",
  "CUSTOM_VERTEX_MAIN_BEGIN",
  "CUSTOM_VERTEX_UPDATE_WORLDPOS",
  "CUSTOM_VERTEX_MAIN_END",
] as const;

/**
 * One of Babylon Lite's ten material-plugin injection points.
 *
 * @beta
 */
export type LiteMaterialPluginPoint = (typeof LITE_MATERIAL_PLUGIN_POINTS)[number];

/**
 * The default priority Babylon Lite gives a plugin with none (`index.d.ts` 7057).
 *
 * @beta
 */
export const MATERIAL_PLUGIN_DEFAULT_PRIORITY = 500;

/**
 * How many `texture`/`sampler` pairs one material's plugins may declare together.
 *
 * @remarks
 * Measured on a device on 2026-09-08 (spike S0.2): a fully textured PBR material — base colour,
 * normal, ORM, emissive — with image-based lighting and one PCF shadow light already binds seven
 * textures and seven samplers of the sixteen per stage that every WebGPU implementation guarantees,
 * SwiftShader included, and Lite requests no higher `requiredLimits`. Nine is what is left, and it
 * drops to eight with a second shadow light and seven with a lightmap, so a material that means to
 * be portable should stay well under the cap.
 *
 * @beta
 */
export const MATERIAL_PLUGIN_SAMPLER_BUDGET = 9;

/**
 * The WGSL names the PBR and Standard templates already own, which a plugin may not reuse for a
 * uniform field or a sampler.
 *
 * @remarks
 * A plugin's fields land in the host's own uniform block and its samplers in the host's own bind
 * group, so a collision is a duplicate WGSL declaration and the whole material stops compiling with
 * a message that names neither the plugin nor the field. Refusing at attach time is the difference
 * between a sentence and a shader dump. Read from `pbr-template.js` `_baseMaterialUboFields` and
 * `_baseBindings`, and `standard-template.js` `materialStruct` and `_baseBindings`.
 *
 * @beta
 */
export const MATERIAL_PLUGIN_RESERVED_NAMES: readonly string[] = Object.freeze([
  // Blocks and entry points the templates declare.
  "material",
  "mesh",
  "scene",
  "lights",
  "pluginUbo",
  "shadowParams",
  "main",
  // PBR material uniform fields.
  "environmentIntensity",
  "directIntensity",
  "reflectance",
  "materialAlpha",
  "baseColorFactor",
  "metallicFactor",
  "roughnessFactor",
  "normalScale",
  "lightFalloffMode",
  "anisotropyParams",
  // PBR samplers.
  "baseColorTexture",
  "baseColorSampler",
  "normalTexture",
  "normalSampler_",
  "ormTexture",
  "ormSampler",
  "emissiveTexture",
  "emissiveSampler",
  "specGlossTexture",
  "specGlossSampler",
  // Standard samplers (`standard-template.js` uses two-letter names).
  "dT",
  "dS",
  "mat",
  "up",
]);

/**
 * What a raw material plugin declares: a name, the values and textures it wants beside the host
 * material's own, and the WGSL it injects.
 *
 * @beta
 */
export interface MaterialPluginDefinition {
  /** The plugin's identity. It is part of Lite's pipeline cache key, so it must be stable. */
  readonly name: string;
  /** Lower runs first; Lite's own default is {@link MATERIAL_PLUGIN_DEFAULT_PRIORITY}. */
  readonly priority: number;
  /** The uniform fields appended to the host material's uniform block. Fragment stage only. */
  readonly uniforms: readonly ShaderUniformDeclaration[];
  /** The `texture`/`sampler` pairs added to the host material's bind group. Fragment stage only. */
  readonly textures: readonly ShaderTextureDeclaration[];
  /** The WGSL to inject, by point. Vertex points take statements; there are no vertex helpers. */
  readonly code: Readonly<Partial<Record<LiteMaterialPluginPoint, string>>>;
}

/**
 * The properties {@link defineMaterialPlugin} accepts; everything but `name` and `code` has a
 * default.
 *
 * @beta
 */
export interface MaterialPluginDefinitionInit {
  /** The plugin's identity. */
  readonly name: string;
  /** Lower runs first. Defaults to {@link MATERIAL_PLUGIN_DEFAULT_PRIORITY}. */
  readonly priority?: number;
  /** The uniform fields. Defaults to none. */
  readonly uniforms?: readonly ShaderUniformDeclaration[];
  /** The samplers. Defaults to none. */
  readonly textures?: readonly ShaderTextureDeclaration[];
  /** The WGSL to inject, by point. */
  readonly code: Readonly<Partial<Record<LiteMaterialPluginPoint, string>>>;
}

/** Matches a WGSL identifier. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Matches a legal plugin name: an identifier, optionally with `.`, `:`, or `-` inside it. */
const PLUGIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:[.:-][A-Za-z0-9_]+)*$/;

/**
 * Validates a raw material-plugin declaration and fills in its defaults.
 *
 * @remarks
 * Nothing here reaches a device: the result is plain data that `attachSurfaceShaders` and
 * `attachMaterialPlugin` turn into a Lite plugin. The checks are the ones whose failure would
 * otherwise surface as a WGSL compile error with no mention of the plugin — an empty `code`, a
 * duplicate or reserved binding name, a name that is not a WGSL identifier, an unknown injection
 * point, or more samplers than {@link MATERIAL_PLUGIN_SAMPLER_BUDGET}.
 *
 * The **surface-shader compiler produces one of these**, so a bug in this validation is a bug in
 * every surface shader too, which is why it lives here rather than inside the compiler.
 *
 * @param definition - The declaration.
 * @returns The same declaration with `priority`, `uniforms`, and `textures` filled in.
 * @throws IgnifxError with code `IGX-0723` when `code` fills in no point, `IGX-0712` when a name is
 * not a legal, unique, unreserved WGSL identifier or a point name is unknown, or `IGX-0726` when the
 * plugin alone exceeds the sampler budget.
 *
 * @example
 * ```ts
 * const tint = defineMaterialPlugin({
 *   name: "tint",
 *   code: { CUSTOM_FRAGMENT_UPDATE_ALPHA: "baseColor = baseColor * vec3<f32>(1.0, 0.5, 0.5);" },
 * });
 * ```
 *
 * @beta
 */
export function defineMaterialPlugin(definition: MaterialPluginDefinitionInit): MaterialPluginDefinition {
  const name = definition.name;
  if (!PLUGIN_NAME.test(name)) {
    throw new IgnifxError(
      CoreErrorCode.unknownShaderBinding,
      `${JSON.stringify(name)} is not a legal material-plugin name.`,
      {
        context: { plugin: name, name },
        hint: "Start with a letter or underscore; letters, digits, underscores, and inner . : - follow.",
      },
    );
  }
  const points = Object.keys(definition.code);
  let filled = 0;
  for (const point of points) {
    if (!isLiteMaterialPluginPoint(point)) {
      throw new IgnifxError(CoreErrorCode.unknownShaderBinding, `${name} declares no Lite point named ${point}.`, {
        context: { plugin: name, name: point, point },
        hint: `The ten points are ${LITE_MATERIAL_PLUGIN_POINTS.join(", ")}.`,
      });
    }
    if ((definition.code[point] ?? "").trim().length > 0) {
      filled += 1;
    }
  }
  if (filled === 0) {
    throw new IgnifxError(CoreErrorCode.surfaceHookMissing, `${name} injects no WGSL at any Lite point.`, {
      context: { plugin: name, name },
      hint: "Fill in at least one of the ten points, or do not attach the plugin.",
    });
  }
  const uniforms = definition.uniforms ?? [];
  const textures = definition.textures ?? [];
  const seen = new Set<string>();
  for (const uniform of uniforms) {
    assertBindingName(name, uniform.name, seen);
    assertUniformType(name, uniform.name, uniform.type);
  }
  for (const texture of textures) {
    assertBindingName(name, texture.name, seen);
    assertBindingName(name, `${texture.name}Sampler`, seen);
  }
  if (textures.length > MATERIAL_PLUGIN_SAMPLER_BUDGET) {
    throw new IgnifxError(
      CoreErrorCode.surfaceSamplerBudgetExceeded,
      `${name} declares ${String(textures.length)} samplers; a material's plugins may declare ${String(MATERIAL_PLUGIN_SAMPLER_BUDGET)} together.`,
      {
        context: { plugin: name, samplers: textures.length, budget: MATERIAL_PLUGIN_SAMPLER_BUDGET },
        hint: "Pack the maps into fewer textures — an RGBA control map rather than four masks.",
      },
    );
  }
  return {
    name,
    priority: definition.priority ?? MATERIAL_PLUGIN_DEFAULT_PRIORITY,
    uniforms,
    textures,
    code: definition.code,
  };
}

/**
 * Whether a string is one of Lite's ten injection points.
 *
 * @param value - The candidate.
 * @returns `true` when Lite accepts it.
 *
 * @beta
 */
export function isLiteMaterialPluginPoint(value: string): value is LiteMaterialPluginPoint {
  for (const point of LITE_MATERIAL_PLUGIN_POINTS) {
    if (point === value) {
      return true;
    }
  }
  return false;
}

/**
 * How many floats one uniform of a declared type occupies on the CPU side.
 *
 * @param type - The declared WGSL type.
 * @returns The component count: 1, 2, 3, 4, or 16.
 *
 * @internal
 */
export function uniformComponentCount(type: ShaderUniformType): number {
  switch (type) {
    case "vec2<f32>": {
      return 2;
    }
    case "vec3<f32>": {
      return 3;
    }
    case "vec4<f32>": {
      return 4;
    }
    case "mat4x4<f32>": {
      return 16;
    }
    case "f32":
    case "u32":
    case "i32": {
      return 1;
    }
    default: {
      return assertNever(type, "shader uniform type");
    }
  }
}

/**
 * Refuses a binding name that is not a unique, unreserved WGSL identifier.
 *
 * @param plugin - The plugin's name, for the message.
 * @param binding - The candidate name.
 * @param seen - The names already taken by this plugin; the accepted name is added.
 * @throws IgnifxError with code `IGX-0712`.
 */
function assertBindingName(plugin: string, binding: string, seen: Set<string>): void {
  if (!IDENTIFIER.test(binding)) {
    throw new IgnifxError(
      CoreErrorCode.unknownShaderBinding,
      `${plugin} declares ${JSON.stringify(binding)}, which is not a WGSL identifier.`,
      { context: { plugin, name: binding }, hint: "Use letters, digits, and underscores, starting with a letter." },
    );
  }
  if (MATERIAL_PLUGIN_RESERVED_NAMES.includes(binding)) {
    throw new IgnifxError(
      CoreErrorCode.unknownShaderBinding,
      `${plugin} declares ${binding}, which Babylon Lite's own PBR or Standard shader already owns.`,
      { context: { plugin, name: binding }, hint: "Rename it; a plugin shares the host material's WGSL namespace." },
    );
  }
  if (seen.has(binding)) {
    throw new IgnifxError(CoreErrorCode.unknownShaderBinding, `${plugin} declares ${binding} twice.`, {
      context: { plugin, name: binding },
      hint: "Every uniform and texture of one plugin needs its own name.",
    });
  }
  seen.add(binding);
}

/**
 * Refuses a uniform type Lite's plugin bridge cannot carry.
 *
 * @param plugin - The plugin's name, for the message.
 * @param binding - The uniform's name.
 * @param type - The declared type.
 * @throws IgnifxError with code `IGX-0712`.
 */
function assertUniformType(plugin: string, binding: string, type: ShaderUniformType): void {
  if (!SHADER_UNIFORM_TYPES.includes(type)) {
    throw new IgnifxError(CoreErrorCode.unknownShaderBinding, `${plugin}.${binding} declares the type ${type}.`, {
      context: { plugin, name: binding, type },
      hint: `The plugin uniform types are ${SHADER_UNIFORM_TYPES.join(", ")}.`,
    });
  }
}
