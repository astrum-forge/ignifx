import {
  LIGHT_PROBE_ASSET_TYPE,
  LIGHT_PROBE_FILE_EXTENSIONS,
  LightProbeAsset,
  readLightProbeFile,
} from "../light-probe-asset.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";

/**
 * Builds the loader for `.probes.json` light-probe grids (GI Phase 2, step B2). It needs no device,
 * so a grid loads in Node too.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @beta
 */
export function createLightProbeLoader(): AssetLoader<LightProbeAsset> {
  return {
    type: LIGHT_PROBE_ASSET_TYPE,
    extensions: LIGHT_PROBE_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<LightProbeAsset> {
      return new LightProbeAsset(readLightProbeFile(await ctx.fetchJson(), ctx.address));
    },
  };
}
