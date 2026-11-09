import { resolveRelative } from "../assets/relative.js";
import { defineTilemap, TILEMAP_ASSET_TYPE, TILEMAP_FILE_EXTENSIONS } from "./definition.js";
import type { TilemapDefinition, TilemapInput } from "./definition.js";
import type { App, AssetHandle, AssetLoader, LoaderContext } from "@ignifx/core";

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

  /**
   * The address the document was loaded from. For a map built with {@link createTilemapAsset}, the
   * `address` option it was given, or `""`.
   */
  readonly address: string;

  /** The parsed document, with every tile layer decoded to a dense array. */
  readonly definition: TilemapDefinition;

  /** Each tileset's atlas address, resolved against this document's address. */
  readonly atlasAddresses: readonly string[];

  /**
   * Wraps a parsed document. The `tilemap` loader and {@link createTilemapAsset} construct these.
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

/**
 * Options for {@link createTilemapAsset}.
 *
 * @public
 */
export interface CreateTilemapAssetOptions {
  /**
   * Treat the map as if it had been loaded from this address: its tilesets' `atlas` references
   * resolve against it, and an error names it. Default `""`, which reads every `atlas` reference
   * as a project-root address and names the map `"\<inline\>"` in errors.
   */
  readonly address?: string;
}

/**
 * Publishes a tilemap built in code as an asset, so a `Tilemap` component can hold it.
 *
 * @remarks
 * The document goes through the same `defineTilemap` check the `.tilemap.json` loader runs, so a
 * map built here and the same map written to a file are interchangeable, and a bad one fails with
 * the loader's error. The handle is a `memory:` asset (`AssetService.register`): serializing a
 * component that references it writes `null`.
 *
 * @param app - The app.
 * @param input - The document, in the shape a `.tilemap.json` file holds.
 * @param options - The address to resolve the tilesets' atlases against.
 * @returns A handle with one holder, already loaded.
 * @throws IgnifxError with code `IGX-1105` when the document is malformed (see `defineTilemap`).
 *
 * @example
 * ```ts
 * const map = createTilemapAsset(app, {
 *   tileWidth: 16,
 *   width: 2,
 *   height: 1,
 *   tilesets: [{ name: "terrain", atlas: "2d/terrain.atlas.json", firstId: 1, tiles: [] }],
 *   layers: [{ name: "Ground", tiles: [1, 2] }],
 * });
 * world.createEntity("Level").addComponent(Tilemap, { map });
 * ```
 *
 * @public
 */
export function createTilemapAsset(
  app: App,
  input: TilemapInput,
  options: CreateTilemapAssetOptions = {},
): AssetHandle<TilemapAsset> {
  const address = options.address ?? "";
  const definition = defineTilemap(input, address === "" ? undefined : address);
  return app.assets.register(new TilemapAsset(address, definition), { type: TILEMAP_ASSET_TYPE });
}
