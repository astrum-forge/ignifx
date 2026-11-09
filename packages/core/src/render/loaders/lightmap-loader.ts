import { LIGHTMAP_ASSET_TYPE, LIGHTMAP_FILE_EXTENSIONS, LightmapAsset, readLightmapFile } from "../lightmap-asset.js";
import { TEXTURE_ASSET_TYPE } from "../texture-asset.js";
import type { AssetLoader, LoaderContext } from "../../assets/types.js";
import type { TextureAsset } from "../texture-asset.js";

/**
 * Builds the loader for `.lightmap.json` lightmaps (GI Phase 2, step B3). The texture the file names
 * loads as a dependency, so it is released with the lightmap; a texture that fails to load fails
 * the lightmap.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @beta
 */
export function createLightmapLoader(): AssetLoader<LightmapAsset> {
  return {
    type: LIGHTMAP_ASSET_TYPE,
    extensions: LIGHTMAP_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<LightmapAsset> {
      const file = readLightmapFile(await ctx.fetchJson(), ctx.address);
      const texture = await ctx.loadDependency<TextureAsset>(file.texture, { type: TEXTURE_ASSET_TYPE });
      return new LightmapAsset(texture, file.entries);
    },
  };
}
