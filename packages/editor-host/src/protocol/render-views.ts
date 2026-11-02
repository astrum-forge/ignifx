// A copy of `packages/editor-protocol/src/render-views.ts` from `astrum-forge/ignifx-editor` (protocol 0.3).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * Protocol 0.3, additive (engine ask E8): the scene host's second views, rendered through the
 * engine's render textures. The Game panel's view is the document's own camera rendered beside the
 * editor camera (`setGameView`, `gameViewFrame`); a thumbnail is an asset rendered on its own
 * (`renderThumbnail`). Both answer images in the shape of `screenshot`'s.
 */
import { isRecord } from "./rpc.js";
import { isFiniteNumber, isSceneFileAssetRef, isString, isUidString, optionalField } from "./scene-file.js";
import { ScreenshotFormat } from "./scene.js";
import type { RpcSuccessResponse } from "./rpc.js";
import type { SceneFileAssetRef } from "./scene-file.js";
import type { RpcRequestWithParams } from "./scene.js";

/**
 * Editor → scene host: the render-view methods, answered after `ready` like every `SceneMethod`.
 *
 * @remarks
 * A host lists `HostCapability.gameView` when it answers the first two and
 * `HostCapability.thumbnails` when it answers the third; one that does not answers
 * `RpcErrorCode.methodNotFound`. Additive in 0.3.
 *
 * @public
 */
export const RenderViewMethod = {
  /** Turns the Game panel's view on, off, or to a new size. Answers {@link GameViewState}. */
  setGameView: "setGameView",
  /**
   * Renders the open scene through its own main camera, the one the game would use, and answers
   * the image: {@link GameViewFrameResult}. Fails with `RpcErrorCode.noScene` while no scene is
   * open and `RpcErrorCode.invalidRequest` while the game view is off.
   */
  gameViewFrame: "gameViewFrame",
  /** Renders one model or prefab asset on its own and answers the image: {@link ThumbnailResult}. */
  renderThumbnail: "renderThumbnail",
} as const;

/**
 * The union of the names in `RenderViewMethod`.
 *
 * @public
 */
export type RenderViewMethod = (typeof RenderViewMethod)[keyof typeof RenderViewMethod];

/**
 * The largest width and height, in pixels, of the game view.
 *
 * @public
 */
export const GAME_VIEW_MAX_SIZE = 2048;

/**
 * The game view's size until `setGameView` gives one: 640 by 360.
 *
 * @public
 */
export const GAME_VIEW_DEFAULT_SIZE = { width: 640, height: 360 } as const;

/**
 * The largest side, in pixels, of a thumbnail.
 *
 * @public
 */
export const THUMBNAIL_MAX_SIZE = 1024;

/**
 * A thumbnail's side when the request gives none.
 *
 * @public
 */
export const THUMBNAIL_DEFAULT_SIZE = 128;

/**
 * The parameters of `setGameView`.
 *
 * @public
 */
export interface SetGameViewParams {
  /** Whether the view renders. Off frees its texture. */
  readonly enabled: boolean;
  /** The width in pixels, 1 to {@link GAME_VIEW_MAX_SIZE}; absent to keep the current one. */
  readonly width?: number;
  /** The height in pixels, 1 to {@link GAME_VIEW_MAX_SIZE}; absent to keep the current one. */
  readonly height?: number;
}

/**
 * The answer to `setGameView`: the view as the host now has it.
 *
 * @public
 */
export interface GameViewState {
  /** Whether the view renders. */
  readonly enabled: boolean;
  /** Its width in pixels. */
  readonly width: number;
  /** Its height in pixels. */
  readonly height: number;
}

/**
 * The parameters of `gameViewFrame`.
 *
 * @public
 */
export interface GameViewFrameParams {
  /** The image format. */
  readonly format: ScreenshotFormat;
  /** The JPEG quality, from 0 to 1; the host's default (0.9) when absent. Ignored for PNG. */
  readonly quality?: number;
}

/**
 * The answer to `gameViewFrame`.
 *
 * @public
 */
export interface GameViewFrameResult {
  /**
   * The image as a PNG or JPEG data URL, at the game view's size; `null` when the open scene has
   * no enabled camera, so there is nothing to show.
   */
  readonly dataUrl: string | null;
  /** The image width in pixels. */
  readonly width: number;
  /** The image height in pixels. */
  readonly height: number;
  /** The uid of the entity whose camera was rendered, or `null` with no image. */
  readonly camera: string | null;
}

/**
 * The parameters of `renderThumbnail`.
 *
 * @public
 */
export interface RenderThumbnailParams {
  /**
   * The asset: its address, or a reference whose `type` is `"model"` or `"scene"` (a prefab). An
   * address alone is typed by its extension: `.glb`/`.gltf` for a model, `.prefab.json` or
   * `.scene.json` for a prefab.
   */
  readonly asset: string | SceneFileAssetRef;
  /** The square image's side in pixels, 1 to {@link THUMBNAIL_MAX_SIZE}; {@link THUMBNAIL_DEFAULT_SIZE} when absent. */
  readonly size?: number;
  /** The image format. */
  readonly format: ScreenshotFormat;
  /** The JPEG quality, from 0 to 1; the host's default (0.9) when absent. Ignored for PNG. */
  readonly quality?: number;
}

/**
 * The answer to `renderThumbnail`.
 *
 * @public
 */
export interface ThumbnailResult {
  /** The image as a PNG or JPEG data URL. */
  readonly dataUrl: string;
  /** The image width in pixels. */
  readonly width: number;
  /** The image height in pixels. */
  readonly height: number;
}

/**
 * Editor → scene host: one of the `RenderViewMethod`s.
 *
 * @public
 */
export type RenderViewRequest =
  | RpcRequestWithParams<typeof RenderViewMethod.setGameView, SetGameViewParams>
  | RpcRequestWithParams<typeof RenderViewMethod.gameViewFrame, GameViewFrameParams>
  | RpcRequestWithParams<typeof RenderViewMethod.renderThumbnail, RenderThumbnailParams>;

/**
 * The success answer to `setGameView`.
 *
 * @public
 */
export type SetGameViewResponse = RpcSuccessResponse<GameViewState>;

/**
 * The success answer to `gameViewFrame`.
 *
 * @public
 */
export type GameViewFrameResponse = RpcSuccessResponse<GameViewFrameResult>;

/**
 * The success answer to `renderThumbnail`.
 *
 * @public
 */
export type ThumbnailResponse = RpcSuccessResponse<ThumbnailResult>;

/**
 * Tells whether a value is a whole number from 1 to a maximum.
 *
 * @param value - The value to test.
 * @param max - The largest value allowed.
 * @returns True for an integer in range.
 */
function isSide(value: unknown, max: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= max;
}

/**
 * Tells whether a value is an image format and, when present, a quality from 0 to 1.
 *
 * @param value - The record to test.
 * @returns True for a known format and a quality in range when given.
 */
function hasImageFormat(value: Readonly<Record<string, unknown>>): boolean {
  const format = value["format"];
  return (
    (format === ScreenshotFormat.png || format === ScreenshotFormat.jpeg) &&
    optionalField(value, "quality", (quality) => isFiniteNumber(quality) && quality >= 0 && quality <= 1)
  );
}

/**
 * Tells whether a value is a PNG or JPEG data URL.
 *
 * @param value - The value to test.
 * @returns True for a `data:image/png;base64,…` or `data:image/jpeg;base64,…` string.
 */
function isImageDataUrl(value: unknown): value is string {
  return isString(value) && /^data:image\/(?:png|jpeg);base64,/u.test(value);
}

/**
 * Checks the parameters of `setGameView`.
 *
 * @param value - The received `params`.
 * @returns True for a boolean `enabled` and sizes in range when given.
 *
 * @public
 */
export function isSetGameViewParams(value: unknown): value is SetGameViewParams {
  return (
    isRecord(value) &&
    typeof value["enabled"] === "boolean" &&
    optionalField(value, "width", (width) => isSide(width, GAME_VIEW_MAX_SIZE)) &&
    optionalField(value, "height", (height) => isSide(height, GAME_VIEW_MAX_SIZE))
  );
}

/**
 * Checks the result of `setGameView`.
 *
 * @param value - The received `result`.
 * @returns True for a boolean `enabled` and sizes in range.
 *
 * @public
 */
export function isGameViewState(value: unknown): value is GameViewState {
  return (
    isRecord(value) &&
    typeof value["enabled"] === "boolean" &&
    isSide(value["width"], GAME_VIEW_MAX_SIZE) &&
    isSide(value["height"], GAME_VIEW_MAX_SIZE)
  );
}

/**
 * Checks the parameters of `gameViewFrame`.
 *
 * @param value - The received `params`.
 * @returns True for a known format and a quality from 0 to 1 when given.
 *
 * @public
 */
export function isGameViewFrameParams(value: unknown): value is GameViewFrameParams {
  return isRecord(value) && hasImageFormat(value);
}

/**
 * Checks the result of `gameViewFrame`.
 *
 * @param value - The received `result`.
 * @returns True for an image and a camera uid, or `null` for both, and sizes in range.
 *
 * @public
 */
export function isGameViewFrameResult(value: unknown): value is GameViewFrameResult {
  if (!isRecord(value) || !isSide(value["width"], GAME_VIEW_MAX_SIZE) || !isSide(value["height"], GAME_VIEW_MAX_SIZE)) {
    return false;
  }
  const dataUrl = value["dataUrl"];
  const camera = value["camera"];
  return dataUrl === null ? camera === null : isImageDataUrl(dataUrl) && isUidString(camera);
}

/**
 * Checks the parameters of `renderThumbnail`.
 *
 * @param value - The received `params`.
 * @returns True for an address or asset reference, a size in range when given, and a known format.
 *
 * @public
 */
export function isRenderThumbnailParams(value: unknown): value is RenderThumbnailParams {
  if (!isRecord(value) || !hasImageFormat(value)) {
    return false;
  }
  const asset = value["asset"];
  return (
    ((isString(asset) && asset.length > 0) || isSceneFileAssetRef(asset)) &&
    optionalField(value, "size", (size) => isSide(size, THUMBNAIL_MAX_SIZE))
  );
}

/**
 * Checks the result of `renderThumbnail`.
 *
 * @param value - The received `result`.
 * @returns True for an image and sizes in range.
 *
 * @public
 */
export function isThumbnailResult(value: unknown): value is ThumbnailResult {
  return (
    isRecord(value) &&
    isImageDataUrl(value["dataUrl"]) &&
    isSide(value["width"], THUMBNAIL_MAX_SIZE) &&
    isSide(value["height"], THUMBNAIL_MAX_SIZE)
  );
}
