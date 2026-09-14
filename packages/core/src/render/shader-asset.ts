import type { ShaderDeclaration, ShaderKind } from "./shader-declaration.js";

/**
 * One `.wgsl` file: its text and the declaration its `// @ignifx` pragmas carry
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1, ADR-0024).
 *
 * The asset is the program plus the schema of what a material may set on it, never the values. It
 * needs no device, so a `.wgsl` loads completely in Node. Two facts an author has to know:
 *
 * - The whole file is handed to Babylon Lite as **both** the vertex and the fragment source
 *   (`lib/material/shader/shader-pipeline.js` 66–79), so structs and helpers are shared and the file
 *   must compile in both stages — `textureSample` is fragment-only; vertex code uses
 *   `textureSampleLevel` or `textureLoad`.
 * - Lite's system uniforms are read as `shaderSystem.<name>`; everything else, including the
 *   uniforms ignifx supplies, as `shaderUniforms.<name>`.
 */

/**
 * The asset type shaders are registered under.
 *
 * @public
 */
export const SHADER_ASSET_TYPE = "shader";

/**
 * The address extensions that select the shader loader.
 *
 * @remarks
 * `.surface.wgsl` and `.post.wgsl` both end in `.wgsl`, so one extension covers all three forms.
 *
 * @public
 */
export const SHADER_FILE_EXTENSIONS: readonly string[] = Object.freeze([".wgsl"]);

/**
 * A loaded `.wgsl` file: its source and what its pragmas declare
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1).
 *
 * @remarks
 * Shaders are shared: many materials reference one shader asset, and each material holds its own
 * values. Editing the file in development re-parses the declaration and rebuilds every material
 * built from it in place (`docs/architecture/05-assets-and-loading.md` §7).
 *
 * @example
 * ```ts
 * const dissolve = await app.assets.loadAsync<ShaderAsset>("shaders/dissolve.wgsl");
 * dissolve.value.declaration.uniforms.map((uniform) => uniform.name); // ["progress", "edgeColor"]
 * ```
 *
 * @public
 */
export class ShaderAsset {
  /** The type name the asset service registers shaders under. */
  static assetType: string = SHADER_ASSET_TYPE;

  /** The address the shader was loaded from. */
  readonly address: string;

  /** The whole file, as written. It is handed to Babylon Lite as both the vertex and the fragment source. */
  readonly source: string;

  /** What the file's `// @ignifx` pragmas declare. */
  readonly declaration: ShaderDeclaration;

  /**
   * Wraps a parsed shader file. The `shader` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param source - The whole file.
   * @param declaration - The parsed pragmas.
   *
   * @internal
   */
  constructor(address: string, source: string, declaration: ShaderDeclaration) {
    this.address = address;
    this.source = source;
    this.declaration = declaration;
  }

  /**
   * Which of the three authoring forms the file declared.
   *
   * @returns `"shader"`, `"surface"`, or `"post"`.
   */
  get kind(): ShaderKind {
    return this.declaration.kind;
  }
}
