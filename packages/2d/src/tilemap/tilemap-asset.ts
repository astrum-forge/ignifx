import { resolveRelative } from "../assets/relative.js";
import { defineTilemap, TILEMAP_ASSET_TYPE, TILEMAP_FILE_EXTENSIONS } from "./definition.js";
import type { TilemapDefinition, TilemapInput } from "./definition.js";
import type { AssetLoader, LoaderContext } from "@ignifx/core";

/**
 * The `tilemap` asset type and its loader (`docs/architecture/05-assets-and-loading.md` §5,
 * `11-2d-toolkit.md` §2.5).
 *
 * A `.tilemap.json` document is pure data — tile ids, tilesets, objects — so the loader needs no
 * device and behaves identically under a headless app, which is what lets a headless test assert
 * collision geometry and object spawning. The atlases the tilesets name are loaded by
 * `TilemapRenderer`, not here: a map with six tilesets in a scene that only shows one chunk should
 * not upload six textures at load time.
 */

/**
 * A loaded tilemap document.
 *
 * @example
 * ```ts
 * const map = await app.assets.load<TilemapAsset>("2d/level-1.tilemap.json").promise;
 * map.definition.layers.length; // 2
 * ```
 *
 * @public
 */
export class TilemapAsset {
  /** The type name the asset service registers tilemaps under. */
  static assetType: string = TILEMAP_ASSET_TYPE;

  /** The address the document was loaded from. */
  readonly address: string;

  /** The parsed document, with every tile layer decoded to a dense array. */
  readonly definition: TilemapDefinition;

  /** Each tileset's atlas address, resolved against this document's address. */
  readonly atlasAddresses: readonly string[];

  /**
   * Wraps a parsed document. The `tilemap` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param definition - The parsed document.
   *
   * @internal
   */
  constructor(address: string, definition: TilemapDefinition) {
    this.address = address;
    this.definition = definition;
    const atlases: string[] = [];
    for (let index = 0; index < definition.tilesets.length; index += 1) {
      const tileset = definition.tilesets[index];
      atlases.push(tileset === undefined ? "" : resolveRelative(address, tileset.atlas));
    }
    this.atlasAddresses = atlases;
  }

  /**
   * The atlas address a tileset's tiles come from.
   *
   * @param tilesetIndex - The tileset's index in the document.
   * @returns The address, or `""` when the index is out of range.
   */
  atlasFor(tilesetIndex: number): string {
    return this.atlasAddresses[tilesetIndex] ?? "";
  }
}

/**
 * Builds the loader for `.tilemap.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createTilemapLoader());
 * ```
 *
 * @public
 */
export function createTilemapLoader(): AssetLoader<TilemapAsset> {
  return {
    type: TILEMAP_ASSET_TYPE,
    extensions: TILEMAP_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<TilemapAsset> {
      const raw = await ctx.fetchJson<TilemapInput>();
      return new TilemapAsset(ctx.address, defineTilemap(raw, ctx.address));
    },
  };
}
