import {
  createShaderMaterial,
  createTexture2DArrayFromPixels,
  createTexture2DFromPixels,
  enableShaderMaterialUniformCaching,
  setShaderMatrix,
  setShaderStorageBuffer,
  setShaderTexture,
  setShaderUniform,
} from "@babylonjs/lite";
import { readSceneEnvironment } from "./environment.js";
import type {
  EngineContext,
  SceneContext,
  ShaderAttributeName,
  ShaderMaterial,
  ShaderSystemUniformName,
  ShaderUniformType,
  StorageBuffer,
  Texture2D,
} from "@babylonjs/lite";

/**
 * The custom-WGSL half of the Babylon Lite adapter: `createShaderMaterial`, the `setShader*`
 * setters, and the 1x1 fallback textures a declared sampler falls back to
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1, ADR-0024). Everything here is `@internal`.
 *
 * Lite exports one barrel, so a static import of `createShaderMaterial` anywhere in the reachable
 * graph pulls `lib/material/shader/**` into every entry chunk. This module is therefore reached with
 * `await import(...)` from `../../render/shader-support.ts`, and only loading a `.wgsl` triggers the
 * fetch. `./storage-buffer.ts` is a separate file for the same reason: `StorageBufferAsset`
 * allocates synchronously, so it cannot wait for this chunk.
 *
 * Two Lite facts it is written around:
 *
 * - Nothing may be left unbound: `createShaderBindGroup` throws (errors 309 and 310) when a declared
 *   sampler has no texture or a declared storage buffer has no buffer, which is what
 *   {@link createFallbackTexture} exists for.
 * - There is no front-face culling; `ShaderMaterialOptions` carries only `backFaceCulling`
 *   (`lib/material/shader/shader-pipeline.js`), so the pragma parser refuses `cull front`.
 */

/**
 * A Babylon Lite custom WGSL material, re-exported under an ignifx name
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteShaderMaterial = ShaderMaterial;

/** The RGBA bytes of each 1x1 fallback texture. */
const FALLBACK_PIXELS: Readonly<Record<string, readonly [number, number, number, number]>> = Object.freeze({
  white: [255, 255, 255, 255],
  black: [0, 0, 0, 255],
  transparent: [0, 0, 0, 0],
});

/**
 * One declared uniform in the form Babylon Lite's factory takes: either the name of a system
 * uniform it fills in itself, or a custom declaration with its initial value.
 *
 * @internal
 */
export type ShaderUniformEntry =
  | ShaderSystemUniformName
  | {
      /** The WGSL identifier. */
      readonly name: string;
      /** The WGSL type. */
      readonly type: ShaderUniformType;
      /** The initial value, **linear** for a colour. */
      readonly defaultValue: number | readonly number[];
    };

/**
 * One declared sampler in the form Babylon Lite's factory takes.
 *
 * @internal
 */
export interface ShaderSamplerEntry {
  /** The WGSL identifier; Lite generates `<name>Sampler` beside it. */
  readonly name: string;
  /** `"2d-array"` for a `texture_2d_array<f32>` binding. */
  readonly viewDimension: "2d" | "2d-array";
}

/**
 * One declared storage buffer in the form Babylon Lite's factory takes.
 *
 * @internal
 */
export interface ShaderStorageEntry {
  /** The WGSL identifier. */
  readonly name: string;
  /** The WGSL variable type, verbatim. */
  readonly type: string;
}

/**
 * Everything Babylon Lite's `createShaderMaterial` needs, in ignifx's own vocabulary so that the
 * mapping from a `ShaderDeclaration` can be built and asserted without a device or a Lite import
 * (`src/render/shader-material.ts`).
 *
 * @remarks
 * A `null` blend state or depth comparison means "leave Babylon Lite's own default in place", so
 * this module never restates a Lite default that could change.
 *
 * @internal
 */
export interface ShaderMaterialBuildOptions {
  /** The material's name, used in pipeline and shader-module labels. */
  readonly name: string;
  /** The WGSL source, handed to Lite as both the vertex and the fragment source. */
  readonly source: string;
  /**
   * Whether the scene renders through `rendering.hdr`, where the fragment's display colour is
   * decoded to linear before it is written (see {@link linearOutputFragment}). Absent means `false`.
   */
  readonly linearOutput?: boolean;
  /** The vertex attributes the vertex stage reads; `position` is mandatory. */
  readonly attributes: readonly ShaderAttributeName[];
  /** The system and custom uniforms, in binding-declaration order. */
  readonly uniforms: readonly ShaderUniformEntry[];
  /** The samplers. */
  readonly samplers: readonly ShaderSamplerEntry[];
  /** The read-only storage buffers. */
  readonly storageBuffers: readonly ShaderStorageEntry[];
  /** The WGSL `const` declarations, resolved from the file's defaults and the material's overrides. */
  readonly defines: Readonly<Record<string, boolean | number>>;
  /** Whether the thin-instance RGBA stream is bound and injected into `VertexInput`. */
  readonly useThinInstanceColors: boolean;
  /** Whether the surface is alpha-blended. */
  readonly needAlphaBlending: boolean;
  /** Which of Lite's two blend equations to use when no explicit state is given. */
  readonly blendMode: "alpha" | "additive";
  /** An explicit colour-target blend state, which replaces the derived one; `null` to derive it. */
  readonly blend: GPUBlendState | null;
  /** Whether the surface samples the opaque scene colour behind it. */
  readonly transmissive: boolean;
  /** Whether back faces are culled. */
  readonly backFaceCulling: boolean;
  /** Whether the draw writes depth. */
  readonly depthWrite: boolean;
  /** The depth comparison, or `null` for Lite's own reverse-Z default. */
  readonly depthCompare: GPUCompareFunction | null;
}

/**
 * Builds a Babylon Lite custom WGSL material.
 *
 * @remarks
 * Validation is eager and compilation is lazy, so this runs under the null engine; the pipeline is
 * compiled the first time a mesh wearing the material is drawn.
 *
 * @param options - The sources and the declared attribute, uniform, sampler, and storage layout.
 * @returns The material.
 * @throws Error from Babylon Lite when the declaration is not one it can build.
 *
 * @internal
 */
export function createShaderMaterialFromOptions(options: ShaderMaterialBuildOptions): ShaderMaterial {
  const premultiplied = options.blend?.color.srcFactor === "one";
  return createShaderMaterial({
    name: options.name,
    vertexSource: options.source,
    fragmentSource:
      options.linearOutput === true ? linearOutputFragment(options.source, premultiplied) : options.source,
    attributes: options.attributes,
    uniforms: options.uniforms,
    samplers: options.samplers,
    storageBuffers: options.storageBuffers,
    defines: options.defines,
    useThinInstanceColors: options.useThinInstanceColors,
    needAlphaBlending: options.needAlphaBlending,
    blendMode: options.blendMode,
    ...(options.blend === null ? {} : { blend: options.blend }),
    transmissive: options.transmissive,
    backFaceCulling: options.backFaceCulling,
    depthWrite: options.depthWrite,
    ...(options.depthCompare === null ? {} : { depthCompare: options.depthCompare }),
  });
}

/** The name a wrapped `mainFragment` is renamed to. */
const WRAPPED_FRAGMENT = "ignifxDisplayFragment";

/**
 * Wraps a custom shader's `mainFragment` so that, under `rendering.hdr`, it writes linear colour
 * (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G3).
 *
 * @remarks
 * A custom shader writes the colour that is displayed: with HDR off it lands on the swapchain as
 * is. With HDR on it lands in the linear scene target and the output pass encodes it, so the
 * wrapper decodes it first with the exact inverse of that encode (`pow(c, 2.2)`). The user's entry
 * point loses its `@fragment` and is renamed; a new `mainFragment` with the same parameters calls
 * it. A premultiplied colour is divided by alpha before the decode and multiplied after it, so the
 * blend still sees premultiplied colour. Only a single `@location(0) vec4<f32>` return can be
 * wrapped; anything else (a struct of outputs) is returned unchanged.
 *
 * @param source - The `.wgsl` file.
 * @param premultiplied - Whether the material blends premultiplied colour.
 * @returns The fragment source.
 *
 * @internal
 */
export function linearOutputFragment(source: string, premultiplied: boolean): string {
  const entry = /@fragment\s+fn\s+mainFragment\s*\(/u.exec(source);
  if (entry === null) {
    return source;
  }
  const open = entry.index + entry[0].length - 1;
  const close = matchingParen(source, open);
  if (close < 0) {
    return source;
  }
  const after = source.slice(close + 1);
  const result = /^\s*->\s*@location\(\s*0\s*\)\s*vec4\s*<\s*f32\s*>\s*\{/u.exec(after);
  if (result === null) {
    return source;
  }
  const parameters = source.slice(open + 1, close);
  const names = parameterNames(parameters);
  const decode = premultiplied
    ? "select(pow(max(c.rgb,vec3<f32>(0.0)),vec3<f32>(2.2)),pow(max(c.rgb/c.a,vec3<f32>(0.0)),vec3<f32>(2.2))*c.a,c.a>0.0)"
    : "pow(max(c.rgb,vec3<f32>(0.0)),vec3<f32>(2.2))";
  return [
    // A plain function may not carry the entry point's `@location(0)` on its return type.
    `${source.slice(0, entry.index)}fn ${WRAPPED_FRAGMENT}(${stripAttributes(parameters)})->vec4<f32>{${after.slice(result[0].length)}`,
    `@fragment fn mainFragment(${parameters})->@location(0) vec4<f32>{`,
    `let c=${WRAPPED_FRAGMENT}(${names.join(",")});`,
    `return vec4<f32>(${decode},c.a);`,
    "}",
  ].join("\n");
}

/**
 * Finds the parenthesis that closes the one at `open`.
 *
 * @param text - The source.
 * @param open - The index of a `(`.
 * @returns The index of its `)`, or `-1`.
 */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Removes WGSL attributes (`@builtin(position)`, `@location(0)`, `@interpolate(flat)`) from a
 * parameter list, which a plain function's parameters may not carry.
 *
 * @param parameters - The parameter list.
 * @returns The list without attributes.
 */
function stripAttributes(parameters: string): string {
  return parameters.replaceAll(/@\w+\s*(\([^)]*\))?\s*/gu, "");
}

/**
 * The parameter names of a WGSL parameter list, attributes stripped.
 *
 * @param parameters - The text between an entry point's parentheses.
 * @returns The names, in order.
 */
function parameterNames(parameters: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  const take = (end: number): void => {
    const piece = stripAttributes(parameters.slice(start, end)).trim();
    const colon = piece.indexOf(":");
    if (colon > 0) {
      names.push(piece.slice(0, colon).trim());
    }
  };
  for (let index = 0; index < parameters.length; index += 1) {
    const char = parameters[index];
    if (char === "(" || char === "<") {
      depth += 1;
    } else if (char === ")" || char === ">") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      take(index);
      start = index + 1;
    }
  }
  take(parameters.length);
  return names;
}

/**
 * Writes a declared scalar, vector, or matrix uniform.
 *
 * @remarks
 * Lite compares the incoming numbers with the ones it holds and bumps the material's uniform
 * version only when one changed, so calling this every frame with an unchanged value costs a few
 * comparisons and no upload (`lib/material/shader/shader-material.js`, `setUniformValue`).
 *
 * @param material - The material to write to.
 * @param name - The declared uniform name.
 * @param value - The value; its length must match the declared type.
 * @throws Error from Babylon Lite when the name is not declared or the length is wrong.
 *
 * @internal
 */
export function writeShaderUniform(
  material: ShaderMaterial,
  name: string,
  value: number | readonly number[] | Float32Array,
): void {
  setShaderUniform(material, name, value);
}

/**
 * Writes a declared `mat4x4<f32>` uniform from sixteen column-major floats.
 *
 * @param material - The material to write to.
 * @param name - The declared uniform name.
 * @param value - The matrix.
 *
 * @internal
 */
export function writeShaderMatrix(material: ShaderMaterial, name: string, value: Float32Array): void {
  setShaderMatrix(material, name, value);
}

/**
 * Binds or clears a declared sampler's texture.
 *
 * @param material - The material to write to.
 * @param name - The declared sampler name.
 * @param texture - The texture, or `null` to unbind. An unbound sampler makes the material
 * unbuildable, so ignifx always binds a fallback instead.
 *
 * @internal
 */
export function writeShaderTexture(material: ShaderMaterial, name: string, texture: Texture2D | null): void {
  setShaderTexture(material, name, texture);
}

/**
 * Binds or clears a declared storage buffer.
 *
 * @param material - The material to write to.
 * @param name - The declared storage buffer name.
 * @param buffer - The buffer, or `null` to unbind.
 *
 * @internal
 */
export function writeShaderStorageBuffer(material: ShaderMaterial, name: string, buffer: StorageBuffer | null): void {
  setShaderStorageBuffer(material, name, buffer);
}

/**
 * The 1x1 texture a declared-but-unbound sampler is filled with, created on first use and shared for
 * the life of the app.
 *
 * @param engine - The engine that owns the texture.
 * @param cache - The app's fallback textures, keyed by kind; a miss is created and stored.
 * @param fallback - `"white"`, `"black"`, or `"transparent"`; `null` means white.
 * @param array - `true` for a one-layer `texture_2d_array<f32>`.
 * @returns The texture.
 *
 * @internal
 */
export function resolveFallbackTexture(
  engine: EngineContext,
  cache: Map<string, Texture2D>,
  fallback: string | null,
  array: boolean,
): Texture2D {
  const kind = fallback ?? "white";
  const key = array ? `${kind}:array` : kind;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const created = createFallbackTexture(engine, kind, array);
  cache.set(key, created);
  return created;
}

/**
 * Creates the 1x1 texture a declared-but-unbound sampler is filled with.
 *
 * @remarks
 * Babylon Lite refuses to build a bind group for a sampler with nothing bound (error 309), so a
 * material whose file declares `// @ignifx texture noise` and whose `.material.json` binds nothing
 * would be undrawable. One 1x1 texture per fallback kind per app is what makes it legal, which is
 * also Godot's `hint_default_white` behaviour.
 *
 * @param engine - The engine that owns the texture.
 * @param fallback - `"white"`, `"black"`, or `"transparent"`.
 * @param array - `true` for a one-layer `texture_2d_array<f32>`, which is what a sampler declared
 * `array` binds.
 * @returns The texture.
 *
 * @internal
 */
export function createFallbackTexture(engine: EngineContext, fallback: string, array: boolean): Texture2D {
  const rgba = FALLBACK_PIXELS[fallback] ?? FALLBACK_PIXELS["white"];
  const pixels = Uint8Array.from(rgba ?? [255, 255, 255, 255]);
  return array
    ? createTexture2DArrayFromPixels(engine, pixels, 1, 1, 1, { mipMaps: false })
    : createTexture2DFromPixels(engine, pixels, 1, 1, {});
}

/**
 * Turns on Babylon Lite's cached uniform serialization plans for shader materials.
 *
 * @remarks
 * Process-global and idempotent: it installs two writer functions that keep a `WeakMap` of layout
 * plans per material and rewrite only the custom uniform slots whose value changed
 * (`lib/material/shader/enable-shader-material-uniform-caching.js`). That is exactly the shape of
 * ignifx's per-frame `time` upload, so the adapter enables it as it loads rather than making every
 * project remember to.
 *
 * @internal
 */
export function enableShaderUniformCaching(): void {
  enableShaderMaterialUniformCaching();
}

/**
 * Reads the installed environment's ambient irradiance — the `L00` band of its diffuse spherical
 * harmonics — into `out`.
 *
 * @remarks
 * `EnvironmentTextures.sphericalHarmonics` is declared: 36 floats in a stride-4 layout beginning
 * `[L00.rgb, 0, …]` (`index.d.ts`), the same block Babylon Lite writes into the scene uniform buffer
 * as `scene.vSphericalL00` and friends (`lib/scene/scene-ubo-extras.js`, `writeEnvUbo`). So the
 * value ignifx uploads as `ambientColor` is exactly what a shader could read for itself as
 * `scene.vSphericalL00.rgb`, which is the documented alternative for a shader that would rather not
 * declare the uniform. Reaching the slot goes through `./environment.ts`, which is the one place
 * ignifx touches the undeclared `scene._envTextures` field
 * (`docs/architecture/07-rendering.md` §2.5, §8).
 *
 * @param scene - The render scene.
 * @param out - Receives the three linear channels; left untouched when nothing is installed.
 * @returns `true` when an environment supplied harmonics.
 *
 * @internal
 */
export function readSceneAmbient(scene: SceneContext, out: Float32Array): boolean {
  const harmonics = readSceneEnvironment(scene)?.sphericalHarmonics;
  if (harmonics === undefined || harmonics.length < 3) {
    return false;
  }
  out[0] = harmonics[0] ?? 0;
  out[1] = harmonics[1] ?? 0;
  out[2] = harmonics[2] ?? 0;
  return true;
}

/**
 * The subset of this module `src/render/shader-material.ts` reaches through its dynamic `import()`,
 * named so the memo has a type that does not have to be written as `typeof import(…)` (which the
 * `consistent-type-imports` rule forbids).
 *
 * @remarks
 * Assigning the imported module namespace to this type is what checks the two against each other,
 * so a signature that drifts is a compile error rather than a runtime surprise.
 *
 * @internal
 */
export interface ShaderMaterialAdapter {
  /** {@link createShaderMaterialFromOptions}. */
  readonly createShaderMaterialFromOptions: (options: ShaderMaterialBuildOptions) => ShaderMaterial;
  /** {@link writeShaderUniform}. */
  readonly writeShaderUniform: (
    material: ShaderMaterial,
    name: string,
    value: number | readonly number[] | Float32Array,
  ) => void;
  /** {@link writeShaderMatrix}. */
  readonly writeShaderMatrix: (material: ShaderMaterial, name: string, value: Float32Array) => void;
  /** {@link writeShaderTexture}. */
  readonly writeShaderTexture: (material: ShaderMaterial, name: string, texture: Texture2D | null) => void;
  /** {@link writeShaderStorageBuffer}. */
  readonly writeShaderStorageBuffer: (material: ShaderMaterial, name: string, buffer: StorageBuffer | null) => void;
  /** {@link resolveFallbackTexture}. */
  readonly resolveFallbackTexture: (
    engine: EngineContext,
    cache: Map<string, Texture2D>,
    fallback: string | null,
    array: boolean,
  ) => Texture2D;
  /** {@link enableShaderUniformCaching}. */
  readonly enableShaderUniformCaching: () => void;
  /** {@link readSceneAmbient}. */
  readonly readSceneAmbient: (scene: SceneContext, out: Float32Array) => boolean;
}
