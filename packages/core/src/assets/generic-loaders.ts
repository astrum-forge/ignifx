import type { AssetLoader, LoaderContext } from "./types.js";

/**
 * Built-in JSON, text, and binary loaders, registered by the core extension.
 */

/**
 * Parsed JSON, for `.json` addresses.
 *
 * @remarks
 * The value is whatever the file contained; a loader that needs certainty about its shape validates
 * it with a schema (`docs/architecture/06-serialization-and-scene-format.md` §8). Longer suffixes
 * win the extension match, so registering a `.scene.json` loader takes those addresses away from
 * this one without any ordering rule.
 *
 * @example
 * ```ts
 * const config = app.assets.load<{ readonly hp: number }>("data/player.json");
 * ```
 *
 * @public
 */
export const jsonAssetLoader: AssetLoader = Object.freeze({
  type: "json",
  extensions: Object.freeze([".json"]),
  load: (ctx: LoaderContext): Promise<unknown> => ctx.fetchJson(),
});

/**
 * UTF-8 text, for `.txt`, `.md`, and `.csv` addresses.
 *
 * @public
 */
export const textAssetLoader: AssetLoader<string> = Object.freeze({
  type: "text",
  extensions: Object.freeze([".txt", ".md", ".csv"]),
  load: (ctx: LoaderContext): Promise<string> => ctx.fetchText(),
});

/**
 * Raw bytes, for `.bin` and `.wasm` addresses — the path `ignifx.assets.public` binaries such as
 * Havok's WASM take (`docs/architecture/05-assets-and-loading.md` §7).
 *
 * @public
 */
export const binaryAssetLoader: AssetLoader<ArrayBuffer> = Object.freeze({
  type: "binary",
  extensions: Object.freeze([".bin", ".wasm"]),
  load: (ctx: LoaderContext): Promise<ArrayBuffer> => ctx.fetchBytes(),
});

/**
 * The generic loaders in registration order.
 *
 * @internal
 */
export const GENERIC_ASSET_LOADERS: readonly AssetLoader[] = Object.freeze([
  jsonAssetLoader,
  textAssetLoader,
  binaryAssetLoader,
]);
