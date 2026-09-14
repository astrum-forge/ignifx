import { SHADER_ASSET_TYPE } from "@ignifx/core";
import type { App, AssetHandle, ShaderAsset } from "@ignifx/core";

/**
 * Publishing generated WGSL as shader assets: a terrain's splat shader is generated from its layer
 * shape and a foliage material's shader from its options, so neither exists as a file an address
 * could fetch.
 *
 * Both go through core's ordinary `.wgsl` loader from a `data:` address
 * (`docs/architecture/05-assets-and-loading.md` §2 passes `data:` URLs through untouched), because
 * that loader is the only place the pragma parser and Babylon Lite's shader layers are reachable.
 * The address is a pure function of the source, so two terrains of the same shape share one asset.
 */

/**
 * A `data:` address that fetches to a WGSL source, so the ordinary shader loader can load it.
 *
 * @param source - The `.wgsl` text.
 * @returns The address.
 *
 * @public
 */
export function shaderSourceAddress(source: string): string {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(source)}`;
}

/**
 * Loads generated WGSL as a `ShaderAsset`.
 *
 * @remarks
 * The type has to be given: a `data:` address has no `.wgsl` suffix to infer it from. Before
 * `app.start()` the load settles as soon as it finishes; afterwards it settles in the next frame's
 * `PreUpdate`, so call this from setup code rather than a lifecycle callback.
 *
 * @param app - The app whose asset service loads it.
 * @param source - The `.wgsl` or `.surface.wgsl` text.
 * @returns The handle, with one holder — the caller.
 * @throws IgnifxError with code `IGX-0719` when the source's pragmas cannot be read.
 *
 * @example
 * ```ts
 * const shader = await loadGeneratedShader(app, terrainSplatShaderSource(spec));
 * ```
 *
 * @public
 */
export function loadGeneratedShader(app: App, source: string): Promise<AssetHandle<ShaderAsset>> {
  return app.assets.loadAsync<ShaderAsset>(shaderSourceAddress(source), { type: SHADER_ASSET_TYPE });
}
