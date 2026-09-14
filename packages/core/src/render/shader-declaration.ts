/**
 * The vocabulary a `// @ignifx` pragma declares: the three authoring forms, the WGSL types and
 * attribute names Babylon Lite accepts, the uniforms ignifx supplies, and the parsed declaration
 * itself (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1).
 *
 * Split from `./shader-pragma.ts` so these few hundred bytes can stay in the barrel while the parser
 * lives in a chunk only the `.wgsl` loader fetches (`./shader-support.ts`).
 */

/**
 * The three authoring forms the form directive names, in the order the documentation lists them.
 *
 * @public
 */
export const SHADER_KINDS = ["shader", "surface", "post"] as const;

/**
 * Which of the three authoring forms a `.wgsl` file is: a full custom material, a surface shader
 * that hooks into the engine's lit materials, or a full-screen post effect.
 *
 * @public
 */
export type ShaderKind = (typeof SHADER_KINDS)[number];

/**
 * The WGSL types a declared uniform may have — Babylon Lite's set (`index.d.ts` 11445).
 *
 * @public
 */
export const SHADER_UNIFORM_TYPES = [
  "f32",
  "u32",
  "i32",
  "vec2<f32>",
  "vec3<f32>",
  "vec4<f32>",
  "mat4x4<f32>",
] as const;

/**
 * The union of the uniform types a declaration may name.
 *
 * @public
 */
export type ShaderUniformType = (typeof SHADER_UNIFORM_TYPES)[number];

/**
 * The vertex attributes a shader material can bind — Babylon Lite's fixed set
 * (`index.d.ts` 11295). A name outside this list is reported with its line.
 *
 * @public
 */
export const SHADER_ATTRIBUTE_NAMES = [
  "position",
  "normal",
  "uv",
  "uv2",
  "tangent",
  "color",
  "joints",
  "weights",
  "joints1",
  "weights1",
] as const;

/**
 * The union of the attribute names a declaration may name.
 *
 * @public
 */
export type ShaderAttributeName = (typeof SHADER_ATTRIBUTE_NAMES)[number];

/**
 * The uniforms Babylon Lite fills in itself every frame, read in WGSL as `shaderSystem.<name>`
 * (`index.d.ts` 11432).
 *
 * @remarks
 * Two of them lie under `rendering.useFloatingOrigin`: `cameraPosition` reads `(0, 0, 0)` and the
 * world matrices are camera-relative. With instancing on, `world`, `worldView`, and
 * `worldViewProjection` are **not** instance-aware — the shader composes
 * `shaderSystem.world * mat4x4(input.world0, input.world1, input.world2, input.world3)`.
 *
 * @public
 */
export const LITE_SYSTEM_UNIFORM_NAMES = [
  "world",
  "view",
  "projection",
  "viewProjection",
  "worldView",
  "worldViewProjection",
  "cameraPosition",
  "screenSize",
  "alphaCutoff",
] as const;

/**
 * The union of the Babylon Lite system uniform names.
 *
 * @public
 */
export type LiteSystemUniformName = (typeof LITE_SYSTEM_UNIFORM_NAMES)[number];

/**
 * The uniforms **ignifx** fills in every frame, read in WGSL as `shaderUniforms.<name>`
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1). Babylon Lite has no clock and no light
 * bindings for a shader material, so these are the engine's own addition.
 *
 * @public
 */
export const IGNIFX_UNIFORM_NAMES = [
  "time",
  "unscaledTime",
  "deltaTime",
  "mainLightDirection",
  "mainLightColor",
  "ambientColor",
] as const;

/**
 * The union of the ignifx-provided uniform names.
 *
 * @public
 */
export type IgnifxUniformName = (typeof IGNIFX_UNIFORM_NAMES)[number];

/**
 * The WGSL type of each ignifx-provided uniform, which is what the custom uniform block is laid out
 * from.
 *
 * @internal
 */
export const IGNIFX_UNIFORM_TYPES: Readonly<Record<IgnifxUniformName, ShaderUniformType>> = Object.freeze({
  time: "f32",
  unscaledTime: "f32",
  deltaTime: "f32",
  mainLightDirection: "vec3<f32>",
  mainLightColor: "vec3<f32>",
  ambientColor: "vec3<f32>",
});

/**
 * The 1x1 fallback textures a declaration can bind when nothing else is.
 *
 * @public
 */
export const SHADER_TEXTURE_FALLBACKS = ["white", "black", "transparent"] as const;

/**
 * Which 1x1 texture is bound to a declared sampler that nothing has filled in
 * (Godot's `hint_default_*`).
 *
 * @public
 */
export type ShaderTextureFallback = (typeof SHADER_TEXTURE_FALLBACKS)[number];

/**
 * How a shader material composites its fragments.
 *
 * @public
 */
export const SHADER_BLEND_MODES = ["opaque", "alpha", "additive", "premultiplied"] as const;

/**
 * The blend modes a declaration may ask for.
 *
 * @public
 */
export type ShaderBlendMode = (typeof SHADER_BLEND_MODES)[number];

/**
 * Which faces are drawn. `"front"` is accepted by the grammar and refused by the parser, because
 * Babylon Lite 1.27.0 exposes only `backFaceCulling`.
 *
 * @public
 */
export const SHADER_CULL_MODES = ["back", "front", "none"] as const;

/**
 * The face-culling modes a declaration may ask for. `"front"` is refused: Babylon Lite 1.27.0
 * exposes only `backFaceCulling`.
 *
 * @public
 */
export type ShaderCullMode = (typeof SHADER_CULL_MODES)[number];

/**
 * Which instance streams the vertex stage reads.
 *
 * @public
 */
export const SHADER_INSTANCING_MODES = ["none", "matrices", "matrices-colors"] as const;

/**
 * How a declaration expects to be drawn: one mesh at a time, or thin-instanced with a matrix slab
 * and optionally a per-instance colour.
 *
 * @public
 */
export type ShaderInstancingMode = (typeof SHADER_INSTANCING_MODES)[number];

/**
 * One `// @ignifx uniform …` line: a value a material sets and the vertex or fragment stage reads
 * as `shaderUniforms.<name>`.
 *
 * @public
 */
export interface ShaderUniformDeclaration {
  /** The WGSL identifier. */
  readonly name: string;
  /** The WGSL type. */
  readonly type: ShaderUniformType;
  /**
   * The value a material starts with. A colour default is the **sRGB** value the file wrote; the
   * material layer decodes it to linear on the way to the GPU.
   */
  readonly defaultValue: number | readonly number[];
  /** Whether the value is a colour, declared with `color(…)` or the bare `color` modifier. */
  readonly color: boolean;
  /** The inclusive slider bounds an inspector should offer, or `null`. */
  readonly range: readonly [number, number] | null;
  /** The slider increment an inspector should use, or `null`. */
  readonly step: number | null;
  /** One sentence describing the uniform, or `null`. */
  readonly tooltip: string | null;
}

/**
 * One `// @ignifx texture …` line: a `texture_2d<f32>` (or `texture_2d_array<f32>`) plus the
 * `<name>Sampler` Babylon Lite generates beside it.
 *
 * @public
 */
export interface ShaderTextureDeclaration {
  /** The WGSL identifier; the sampler is `<name>Sampler`. */
  readonly name: string;
  /** Whether the texture holds sRGB-encoded colour, which the texture import needs to know. */
  readonly srgb: boolean;
  /** Whether the texture is a tangent-space normal map. */
  readonly normal: boolean;
  /**
   * Which 1x1 texture is bound when a material binds nothing, or `null` for the implicit `"white"`.
   *
   * @remarks
   * A declared sampler that nothing fills in cannot be left unbound: Babylon Lite refuses to build
   * a bind group for it (error 309), so *something* is always bound.
   */
  readonly fallback: ShaderTextureFallback | null;
  /** Whether the binding is a `texture_2d_array<f32>` rather than a `texture_2d<f32>`. */
  readonly array: boolean;
}

/**
 * One `// @ignifx storage …` line: a read-only storage buffer the shader indexes.
 *
 * @public
 */
export interface ShaderStorageDeclaration {
  /** The WGSL identifier. */
  readonly name: string;
  /** The WGSL variable type, verbatim, for example `array<Particle>`. */
  readonly type: string;
}

/**
 * One `// @ignifx define …` line: a WGSL `const` a material may override.
 *
 * @public
 */
export interface ShaderDefineDeclaration {
  /** The WGSL identifier. */
  readonly name: string;
  /** The value; a boolean compiles to `bool`, a number to `f32`. */
  readonly value: boolean | number;
}

/**
 * The three hooks a `.surface.wgsl` file may provide.
 *
 * @public
 */
export const SURFACE_HOOK_NAMES = ["displace", "surface", "composite"] as const;

/**
 * One of the three surface-shader hooks.
 *
 * @public
 */
export type SurfaceHookName = (typeof SURFACE_HOOK_NAMES)[number];

/**
 * The uniform block name a surface shader reads its declared uniforms from.
 *
 * @public
 */
export const SURFACE_UNIFORM_BLOCK = "surfaceUniforms";

/**
 * The pipeline state a `// @ignifx blend …` line declares.
 *
 * @public
 */
export interface ShaderPipelineState {
  /** How fragments are composited. */
  readonly blend: ShaderBlendMode;
  /** Which faces are drawn. */
  readonly cull: ShaderCullMode;
  /**
   * Whether the draw writes depth. Defaults to `true` for an opaque surface and `false` for a
   * blended one — Babylon Lite's own rule — unless the file says `depthWrite on` explicitly.
   */
  readonly depthWrite: boolean;
  /** Whether the draw depth-tests at all; `false` compiles `depthCompare: "always"`. */
  readonly depthTest: boolean;
  /** Whether the surface samples the opaque scene colour behind it. Requires a blended surface. */
  readonly transmissive: boolean;
  /** Which instance streams the vertex stage reads. */
  readonly instancing: ShaderInstancingMode;
}

/**
 * Everything a `.wgsl` file declares about itself — the parsed pragmas, with defaults filled in.
 *
 * @public
 */
export interface ShaderDeclaration {
  /** Which of the three authoring forms the file is. */
  readonly kind: ShaderKind;
  /** The vertex attributes the vertex stage reads. A `"shader"` file always includes `position`. */
  readonly attributes: readonly ShaderAttributeName[];
  /** The Babylon Lite system uniforms, read as `shaderSystem.<name>`. */
  readonly system: readonly LiteSystemUniformName[];
  /** The ignifx-provided uniforms, read as `shaderUniforms.<name>` and written every frame. */
  readonly ignifx: readonly IgnifxUniformName[];
  /** The custom uniforms, read as `shaderUniforms.<name>`. */
  readonly uniforms: readonly ShaderUniformDeclaration[];
  /** The samplers, each generating `<name>` and `<name>Sampler`. */
  readonly textures: readonly ShaderTextureDeclaration[];
  /** The read-only storage buffers. */
  readonly storage: readonly ShaderStorageDeclaration[];
  /** The WGSL `const` declarations a material may override. */
  readonly defines: readonly ShaderDefineDeclaration[];
  /** The pipeline state. */
  readonly pipeline: ShaderPipelineState;
}
