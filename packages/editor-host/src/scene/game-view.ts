/**
 * The Game panel's view (engine ask E8): the open scene through its own main camera, rendered into
 * a render texture beside the editor camera's frame (`setGameView`, `gameViewFrame`).
 */

import { Camera } from "@ignifx/core";
import { InvalidParamsError, RpcFailure } from "../channel.js";
import { GAME_VIEW_DEFAULT_SIZE, isGameViewFrameParams, isSetGameViewParams, RpcErrorCode } from "../protocol/index.js";
import { encodeCapture } from "./screenshot.js";
import type { DocumentMirror } from "./document.js";
import type { GameViewFrameResult, GameViewState } from "../protocol/index.js";
import type { App, RenderTexture } from "@ignifx/core";

/** The JPEG quality when the request gives none, as for `screenshot`. */
const DEFAULT_JPEG_QUALITY = 0.9;

/**
 * The camera the game would render the open scene through: the enabled document camera with the
 * highest priority, the first one on a tie, as the engine picks its main camera.
 *
 * @param app - The scene view's app.
 * @param mirror - The open document.
 * @returns The camera, or `null` when the document has no enabled one.
 */
export function documentCamera(app: App, mirror: DocumentMirror): Camera | null {
  const scene = mirror.scene;
  let best: Camera | null = null;
  for (const camera of app.world.components(Camera)) {
    if (camera.entity.scene !== scene || !camera.isEnabledInHierarchy) {
      continue;
    }
    if (best === null || camera.priority > best.priority) {
      best = camera;
    }
  }
  return best;
}

/** The game view's state and texture. */
export class GameView {
  #enabled = false;

  #width: number = GAME_VIEW_DEFAULT_SIZE.width;

  #height: number = GAME_VIEW_DEFAULT_SIZE.height;

  #texture: RenderTexture | null = null;

  /**
   * `setGameView`: turns the view on or off, or resizes it. Off frees the texture.
   *
   * @param app - The scene view's app.
   * @param params - `{ enabled, width?, height? }`.
   * @returns The view as it now is.
   */
  set(app: App, params: unknown): GameViewState {
    if (!isSetGameViewParams(params)) {
      throw new InvalidParamsError(
        "setGameView takes { enabled: boolean, width?, height? } with sides from 1 to 2048.",
      );
    }
    const width = params.width ?? this.#width;
    const height = params.height ?? this.#height;
    if (!params.enabled || width !== this.#width || height !== this.#height) {
      this.#texture?.dispose();
      this.#texture = null;
    }
    this.#enabled = params.enabled;
    this.#width = width;
    this.#height = height;
    if (this.#enabled) {
      this.#texture ??= app.renderer.createRenderTexture(width, height);
    }
    return { enabled: this.#enabled, width, height };
  }

  /**
   * `gameViewFrame`: renders the document camera into the texture on the next frame and answers it
   * as an image.
   *
   * @param app - The scene view's app.
   * @param mirror - The open document.
   * @param params - `{ format, quality? }`.
   * @returns The image and the camera's document uid, or no image when the document has no camera.
   */
  async frame(app: App, mirror: DocumentMirror, params: unknown): Promise<GameViewFrameResult> {
    if (!isGameViewFrameParams(params)) {
      throw new InvalidParamsError('gameViewFrame takes { format: "png" | "jpeg", quality? }.');
    }
    const texture = this.#texture;
    if (!this.#enabled || texture === null) {
      throw new RpcFailure(
        RpcErrorCode.invalidRequest,
        'The game view is off; send "setGameView" with enabled: true first.',
      );
    }
    const size = { width: this.#width, height: this.#height };
    const camera = documentCamera(app, mirror);
    if (camera === null) {
      return { dataUrl: null, ...size, camera: null };
    }
    const uid = (mirror.documentEntityOf(camera.entity) ?? camera.entity).uid;
    await app.renderer.renderToTexture(camera, texture);
    const capture = await texture.readPixels();
    const dataUrl = await encodeCapture(capture, size, params.format, params.quality ?? DEFAULT_JPEG_QUALITY);
    return { dataUrl, ...size, camera: uid };
  }

  /** Frees the texture. */
  dispose(): void {
    this.#texture?.dispose();
    this.#texture = null;
    this.#enabled = false;
  }
}
