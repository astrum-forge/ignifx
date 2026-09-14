import type { MaterialAsset } from "./material-asset.js";
import type { ShaderAsset } from "./shader-asset.js";
import type { ShaderMaterialDefinition } from "./shader-material-definition.js";
import type { ShaderMaterialRegistry, ShaderMaterialState } from "./shader-material.js";
import type { SurfaceShaderBinding, SurfaceShaderInit } from "./surface-shader.js";
import type { TextureAsset } from "./texture-asset.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { ShaderMaterialAdapter } from "../lite/gpu/shader-material.js";

/**
 * The gate the always-loaded render modules reach the custom-shader layers through
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1, "Bundle cost").
 *
 * The material loader, the post-process stack and the `PreRender` uniform writer are in every app's
 * static graph. A static import of `./shader-material.ts` or `./surface-shader.ts` from them would
 * put the pragma parser, the material state and Babylon Lite's shader pipeline in every entry chunk.
 * They call {@link shaderSupport} and {@link surfaceShaderSupport} instead, and the `.wgsl` loader is
 * what awaits the matching `load…` function. A `ShaderAsset` can only come from that loader, so the
 * layer a synchronous builder needs is always in memory by the time it asks.
 */

/** The part of `./shader-material.ts` the always-loaded render modules call. */
export interface ShaderSupport {
  /** Builds the live state behind a `"shader"` material. */
  buildShaderMaterialState(
    app: App,
    shader: ShaderAsset,
    definition: ShaderMaterialDefinition,
    textures: readonly AssetHandle<TextureAsset>[],
  ): ShaderMaterialState;
  /** The per-app shader material registry. */
  shaderMaterialsOf(app: App): ShaderMaterialRegistry;
  /** The Babylon Lite adapter, once it has loaded. */
  shaderMaterialAdapter(): ShaderMaterialAdapter | null;
  /** Loads the Babylon Lite half, which is a second chunk a project with no `.wgsl` never fetches. */
  loadShaderMaterialAdapter(): Promise<void>;
}

/** The part of `./surface-shader.ts` the material asset calls. */
export interface SurfaceShaderSupport {
  /** Compiles and attaches a material's surface shaders. */
  attachSurfaceShaders(
    material: MaterialAsset,
    app: App | null,
    surfaces: readonly SurfaceShaderInit[],
  ): readonly SurfaceShaderBinding[];
  /** Removes every surface shader from a material. */
  detachSurfaceShaders(material: MaterialAsset): void;
  /** The surface shaders attached to a material. */
  surfaceShaders(material: MaterialAsset): readonly SurfaceShaderBinding[];
  /** One attached surface shader, by name. */
  surfaceShaderBinding(material: MaterialAsset, name: string): SurfaceShaderBinding;
}

/** The dynamically imported custom-WGSL layer, memoised for the process. */
let shaderLayer: ShaderSupport | null = null;

/** The dynamically imported surface-shader layer, memoised for the process. */
let surfaceLayer: SurfaceShaderSupport | null = null;

/**
 * Loads the custom-WGSL layer and its Babylon Lite adapter, once per process.
 *
 * @returns The layer.
 *
 * @internal
 */
export async function loadShaderSupport(): Promise<ShaderSupport> {
  // The assignment is what checks `ShaderSupport` against the module it stands for.
  const loaded: ShaderSupport = shaderLayer ?? (await import("./shader-material.js"));
  shaderLayer = loaded;
  await loaded.loadShaderMaterialAdapter();
  return loaded;
}

/**
 * The custom-WGSL layer, if it has been loaded.
 *
 * @returns The layer, or `null` before any `.wgsl` has been loaded.
 *
 * @internal
 */
export function shaderSupport(): ShaderSupport | null {
  return shaderLayer;
}

/**
 * Loads the surface-shader layer, once per process.
 *
 * @returns The layer.
 *
 * @internal
 */
export async function loadSurfaceShaderSupport(): Promise<SurfaceShaderSupport> {
  const loaded: SurfaceShaderSupport = surfaceLayer ?? (await import("./surface-shader.js"));
  surfaceLayer = loaded;
  return loaded;
}

/**
 * The surface-shader layer, if it has been loaded.
 *
 * @returns The layer, or `null` before any `.surface.wgsl` has been loaded.
 *
 * @internal
 */
export function surfaceShaderSupport(): SurfaceShaderSupport | null {
  return surfaceLayer;
}
