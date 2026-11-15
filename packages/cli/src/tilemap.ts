/**
 * `@ignifx/cli/tilemap`: the pure Tiled and LDtk tilemap converter behind
 * `ignifx import tilemap`, for tools such as an editor's importer. It reads and writes no file
 * itself, has no import-time side effects, and does not pull in the scaffolder.
 *
 * @packageDocumentation
 */

export { CliError, CliErrorCode } from "./errors.js";
export {
  convertTilemapSource,
  type ConvertedTilemapSource,
  type ConvertTilemapSourceOptions,
  type TilemapSourceDocument,
  type TilemapSourceKind,
  type TilemapSourceReader,
} from "./tilemap-source/convert.js";
export { DEFAULT_TILEMAP_SOURCE_LIMITS, type TilemapSourceLimits } from "./tilemap-source/model.js";
