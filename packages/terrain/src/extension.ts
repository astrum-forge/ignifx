import { defineExtension, Phase } from "@ignifx/core";
import { createHeightmapLoader, createTerrainLoader } from "./assets/loader.js";
import { TerrainScatter } from "./components/terrain-scatter.js";
import { Terrain } from "./components/terrain.js";
import { TERRAIN_ERROR_MESSAGES } from "./errors.js";
import { TERRAIN_LOD_ORDER, TerrainLodSystem } from "./lod/terrain-lod-system.js";
import { VERSION } from "./version.js";
import type { Extension, ExtensionContext } from "@ignifx/core";

/**
 * The `@ignifx/terrain` extension (`docs/architecture/04-extensions.md` §1).
 *
 * `terrain()` registers the two asset loaders, the `Terrain` and `TerrainScatter` components, and
 * the `PreRender` LOD system, and declares the `materialPlugins` rendering feature the splat
 * surface shader needs — Babylon Lite installs the plugin bridges once, before the scene is
 * registered, so that declaration has to happen at extension registration.
 *
 * The package contributes no service and no settings section: the plan defines neither, and the one
 * project-wide knob a quality slider wants is `Terrain.lodBias`, which differs per terrain.
 */

/**
 * The `@ignifx/terrain` extension factory.
 *
 * @returns The extension descriptor to pass to `createApp`.
 *
 * @example
 * ```ts
 * const app = await createApp({ canvas, extensions: [terrain()] });
 * ```
 *
 * @public
 */
export const terrain: () => Extension = defineExtension(() => ({
  name: "@ignifx/terrain",
  version: VERSION,
  engine: ">=0.0.0 <1.0.0",
  requires: ["@ignifx/core"],
  register(ctx: ExtensionContext): void {
    ctx.registerErrorCodes(TERRAIN_ERROR_MESSAGES);
    ctx.requireRenderingFeature("materialPlugins");
    ctx.registerAssetLoader(createHeightmapLoader());
    ctx.registerAssetLoader(createTerrainLoader());
    ctx.registerComponents([Terrain, TerrainScatter]);
    ctx.registerSystem(new TerrainLodSystem(), { phase: Phase.PreRender, order: TERRAIN_LOD_ORDER });
  },
}));
