import { CoreErrorCode } from "../errors/error-codes.js";
import { assertNever, IgnifxError } from "../errors/ignifx-error.js";
import {
  declaredTextureBinding,
  INPUT_SAMPLER_BINDING,
  INPUT_TEXTURE_BINDING,
  POST_EFFECT_BUILTIN_UNIFORMS,
  POST_EFFECT_FUNCTION,
} from "./post-effect.js";
import type { CompiledPostEffect, PostEffectUniformField } from "./post-effect.js";
import type { ShaderAsset } from "./shader-asset.js";
import type { ShaderUniformType } from "./shader-declaration.js";

/**
 * Turns a `// @ignifx post` file into the fragment module and uniform layout Babylon Lite's
 * fullscreen-effect path needs (`docs/plan/2026-09-terrain-particles-shaders.md` §3.3).
 *
 * `mainFragment` is a plain function, not an entry point: Lite hard-codes the entry-point names
 * `effectFullscreenVertex` and `effectFragment` (`lib/effect/effect-renderer.js` 7, 258-260), so the
 * entry point is generated here and forwards to it. `createEffectWrapper` takes a byte length and a
 * raw writer and computes no offsets, so the struct's member offsets are worked out here from WGSL's
 * own alignment rules and kept in step with the generated struct.
 *
 * Everything in this module is device-free and deterministic, so it is asserted in Node. It is
 * reached through `./post-effect-support.ts` so a game with no custom post effect never loads it.
 */

/**
 * Compiles a `// @ignifx post` file into a full fragment module and a uniform layout.
 *
 * @remarks
 * Device-free and deterministic, so the whole thing is unit-testable: the result is a WGSL string
 * and a set of byte offsets. It is memoised per shader asset by {@link compiledPostEffect}, because
 * the chain asks for it on every rebuild.
 *
 * @param shader - The loaded shader asset.
 * @returns The compiled effect.
 * @throws IgnifxError with code `IGX-0709` when the file is not a `post` one, or `IGX-0723` when it
 * declares no `mainFragment` function.
 *
 * @example
 * ```ts
 * const compiled = compilePostEffect(vignette.value);
 * compiled.byName.get("amount")?.byteOffset; // 20, right after the four built-ins
 * ```
 *
 * @internal
 */
export function compilePostEffect(shader: ShaderAsset): CompiledPostEffect {
  if (shader.declaration.kind !== "post") {
    throw new IgnifxError(
      CoreErrorCode.invalidAssetFile,
      `${shader.address} declares @ignifx ${shader.declaration.kind}, not @ignifx post.`,
      {
        context: { file: shader.address, format: "@ignifx post", kind: shader.declaration.kind },
        hint: "A PostProcessStack custom effect takes a .post.wgsl file whose pragma is @ignifx post.",
      },
    );
  }
  if (!new RegExp(`\\bfn\\s+${POST_EFFECT_FUNCTION}\\s*\\(`, "u").test(shader.source)) {
    throw new IgnifxError(
      CoreErrorCode.surfaceHookMissing,
      `${shader.address} declares no ${POST_EFFECT_FUNCTION} function.`,
      {
        context: { asset: shader.address, hook: POST_EFFECT_FUNCTION },
        hint: `Add fn ${POST_EFFECT_FUNCTION}(in: PostInput) -> vec4<f32>; the @fragment entry point is generated.`,
      },
    );
  }
  const declared = shader.declaration.uniforms.filter((uniform) => !isBuiltinUniformName(uniform.name));
  const layout = layOutUniforms([
    ...POST_EFFECT_BUILTIN_UNIFORMS,
    ...declared.map((uniform) => ({ name: uniform.name, type: uniform.type })),
  ]);
  const byName = new Map<string, PostEffectUniformField>();
  for (const field of layout.fields) {
    byName.set(field.name, field);
  }
  return {
    address: shader.address,
    fragmentWGSL: buildFragmentModule(shader, layout.fields),
    uniforms: layout.fields,
    byName,
    uniformByteLength: layout.byteLength,
    textures: shader.declaration.textures,
  };
}

/** The compiled form of each shader asset, so a chain rebuild recompiles nothing. */
let compiled: WeakMap<ShaderAsset, CompiledPostEffect> | null = null;

/**
 * The compiled form of a post-effect shader, compiled once per asset.
 *
 * @remarks
 * Keyed on the `ShaderAsset` itself, so a hot reload — which replaces the asset object — recompiles
 * for free.
 *
 * @param shader - The loaded shader asset.
 * @returns The compiled effect.
 * @throws IgnifxError as {@link compilePostEffect} documents.
 *
 * @internal
 */
export function compiledPostEffect(shader: ShaderAsset): CompiledPostEffect {
  const cache = (compiled ??= new WeakMap<ShaderAsset, CompiledPostEffect>());
  const hit = cache.get(shader);
  if (hit !== undefined) {
    return hit;
  }
  const built = compilePostEffect(shader);
  cache.set(shader, built);
  return built;
}

/**
 * Writes an effect's current values into the bytes its uniform buffer takes.
 *
 * @remarks
 * The built-in clocks and `screenSize` are written by the caller through the same `out` buffer, so
 * this only fills in the declared members: the declaration's default first, then the settings'
 * override. Unknown names are refused, which is what makes a typo in a `.scene.json` visible.
 *
 * @param effect - The compiled effect.
 * @param shader - The shader, for its declared defaults.
 * @param values - The overrides.
 * @param out - The uniform bytes, at least `effect.uniformByteLength` long.
 * @throws IgnifxError with code `IGX-0712` for an undeclared name, or `IGX-0713` for a wrongly
 * shaped value.
 *
 * @internal
 */
export function writePostEffectValues(
  effect: CompiledPostEffect,
  shader: ShaderAsset,
  values: Readonly<Record<string, number | readonly number[]>>,
  out: Float32Array,
): void {
  for (const uniform of shader.declaration.uniforms) {
    const field = effect.byName.get(uniform.name);
    if (field === undefined) {
      continue;
    }
    writeField(field, uniform.defaultValue, effect.address, out);
  }
  // `for…in` rather than `Object.keys`: the chain calls this every frame for every recorded effect
  // and a key array per effect per frame is per-frame allocation (coding standards §7).
  for (const name in values) {
    if (!Object.hasOwn(values, name)) {
      continue;
    }
    const field = effect.byName.get(name);
    const value = values[name];
    if (value === undefined) {
      continue;
    }
    if (field === undefined || isBuiltinUniformName(name)) {
      throw new IgnifxError(
        CoreErrorCode.unknownShaderBinding,
        `${effect.address} declares no uniform named ${name}.`,
        {
          context: { material: effect.address, asset: effect.address, name },
          hint: `It declares ${[...effect.byName.keys()].join(", ")}.`,
        },
      );
    }
    writeField(field, value, effect.address, out);
  }
}

/** The result of laying out a uniform struct. */
interface UniformLayout {
  /** The members, in struct order. */
  readonly fields: readonly PostEffectUniformField[];
  /** The struct's size, in bytes. */
  readonly byteLength: number;
}

/**
 * Computes the byte offsets WGSL gives a struct of these members, in this order.
 *
 * @remarks
 * The rules are the WGSL specification's: a member's offset is its predecessor's end rounded up to
 * the member's alignment, and the struct's size is the last member's end rounded up to the struct's
 * alignment — the largest member alignment, and in the **uniform** address space never less than
 * 16. `vec3<f32>` is the one that catches people out: 16-aligned, 12 wide (plan §3.4).
 *
 * @param members - The members, in declaration order.
 * @returns The layout.
 */
function layOutUniforms(
  members: readonly { readonly name: string; readonly type: ShaderUniformType }[],
): UniformLayout {
  const fields: PostEffectUniformField[] = [];
  let offset = 0;
  // WGSL's uniform address space rounds a struct's alignment up to a multiple of 16, so the block's
  // size is always a multiple of 16 whatever its members are.
  let structAlignment = 16;
  for (const member of members) {
    const alignment = typeAlignment(member.type);
    const size = typeSize(member.type);
    structAlignment = Math.max(structAlignment, alignment);
    offset = roundUp(offset, alignment);
    fields.push({
      name: member.name,
      type: member.type,
      components: componentCount(member.type),
      byteOffset: offset,
    });
    offset += size;
  }
  return { fields, byteLength: roundUp(offset, structAlignment) };
}

/**
 * A WGSL type's alignment in the uniform address space, in bytes.
 *
 * @param type - The type.
 * @returns The alignment.
 */
function typeAlignment(type: ShaderUniformType): number {
  switch (type) {
    case "vec2<f32>": {
      return 8;
    }
    case "vec3<f32>":
    case "vec4<f32>":
    case "mat4x4<f32>": {
      return 16;
    }
    case "f32":
    case "u32":
    case "i32": {
      return 4;
    }
    default: {
      return assertNever(type, "shader uniform type");
    }
  }
}

/**
 * A WGSL type's size, in bytes.
 *
 * @param type - The type.
 * @returns The size.
 */
function typeSize(type: ShaderUniformType): number {
  switch (type) {
    case "vec2<f32>": {
      return 8;
    }
    case "vec3<f32>": {
      return 12;
    }
    case "vec4<f32>": {
      return 16;
    }
    case "mat4x4<f32>": {
      return 64;
    }
    case "f32":
    case "u32":
    case "i32": {
      return 4;
    }
    default: {
      return assertNever(type, "shader uniform type");
    }
  }
}

/**
 * How many floats one uniform of a declared type occupies.
 *
 * @remarks
 * A private copy of `material-plugin.ts`'s `uniformComponentCount`. `PostProcessStack` is in every
 * game's static graph, and importing it from there would drag `defineMaterialPlugin` and the
 * reserved-name table into a bundle that draws no custom shader at all.
 *
 * @param type - The declared WGSL type.
 * @returns The component count: 1, 2, 3, 4, or 16.
 */
function componentCount(type: ShaderUniformType): number {
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
 * Rounds a value up to a multiple of an alignment.
 *
 * @param value - The value.
 * @param alignment - The alignment, a power of two.
 * @returns The rounded value.
 */
function roundUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/**
 * The whole fragment module: bindings, generated structs, the author's file, and the entry point
 * Lite's pipeline looks for.
 *
 * @param shader - The shader asset.
 * @param fields - The uniform members, in struct order.
 * @returns The WGSL.
 */
function buildFragmentModule(shader: ShaderAsset, fields: readonly PostEffectUniformField[]): string {
  const members = fields.map((field) => `${field.name}:${field.type},`).join("");
  const lines: string[] = [
    `struct PostUniforms{${members}}`,
    "@group(0)@binding(0)var<uniform>shaderUniforms:PostUniforms;",
    `@group(0)@binding(${String(INPUT_TEXTURE_BINDING)})var inputTexture:texture_2d<f32>;`,
    `@group(0)@binding(${String(INPUT_SAMPLER_BINDING)})var inputTextureSampler:sampler;`,
  ];
  // `for…of` with an index: the iterator yields the element type rather than `T | undefined`, and
  // this runs once per compiled shader rather than per frame.
  let index = -1;
  for (const declaration of shader.declaration.textures) {
    index += 1;
    const binding = declaredTextureBinding(index);
    const type = declaration.array ? "texture_2d_array<f32>" : "texture_2d<f32>";
    lines.push(
      `@group(0)@binding(${String(binding)})var ${declaration.name}:${type};`,
      `@group(0)@binding(${String(binding + 1)})var ${declaration.name}Sampler:sampler;`,
    );
  }
  lines.push(
    "struct PostInput{uv:vec2<f32>,position:vec2<f32>,}",
    shader.source,
    "@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{",
    "var ignifxPostInput:PostInput;",
    "ignifxPostInput.uv=fragment.uv;",
    "ignifxPostInput.position=fragment.position.xy;",
    `return ${POST_EFFECT_FUNCTION}(ignifxPostInput);`,
    "}",
  );
  return lines.join("\n");
}

/**
 * Writes one member's value into the uniform bytes.
 *
 * @param field - The member.
 * @param value - The value.
 * @param asset - The shader's address, for diagnostics.
 * @param out - The uniform floats.
 * @throws IgnifxError with code `IGX-0713` when the shape does not match.
 */
function writeField(
  field: PostEffectUniformField,
  value: number | readonly number[],
  asset: string,
  out: Float32Array,
): void {
  const index = field.byteOffset / 4;
  if (typeof value === "number") {
    if (field.components !== 1) {
      throw mismatch(field, asset, "a single number");
    }
    out[index] = value;
    return;
  }
  if (value.length !== field.components) {
    throw mismatch(field, asset, `${String(value.length)} floats`);
  }
  out.set(value instanceof Float32Array ? value : Float32Array.from(value), index);
}

/**
 * The `IGX-0713` failure a wrongly shaped value produces.
 *
 * @param field - The member.
 * @param asset - The shader's address.
 * @param actual - What the caller passed.
 * @returns The error to throw.
 */
function mismatch(field: PostEffectUniformField, asset: string, actual: string): IgnifxError {
  return new IgnifxError(
    CoreErrorCode.shaderValueMismatch,
    `${field.name} on ${asset} expects ${field.type} (${String(field.components)} floats), not ${actual}.`,
    {
      context: { name: field.name, material: asset, expected: field.type, actual },
      hint: "A post effect's values are numbers and numeric arrays; a colour takes its three or four components.",
    },
  );
}

/**
 * Whether a name is one of the four uniforms every post effect gets for free.
 *
 * @param name - The candidate.
 * @returns `true` when the engine writes it.
 */
function isBuiltinUniformName(name: string): boolean {
  for (const builtin of POST_EFFECT_BUILTIN_UNIFORMS) {
    if (builtin.name === name) {
      return true;
    }
  }
  return false;
}
