/**
 * The Game panel's view (engine ask E8): the open scene through its own main camera, rendered into
 * a render texture beside the editor camera's frame (`setGameView`, `gameViewFrame`). A 2D scene's
 * `Camera2D` is drawn by a second sprite pass instead (`../lite/sprite-game-view.ts`). Neither waits
 * on an animation frame for long: a hidden host gets none, so the renderer draws the frame itself.
 */

import { Camera, RENDERING_SETTINGS_SECTION } from "@ignifx/core";
import { InvalidParamsError, RpcFailure } from "../channel.js";
import { GAME_VIEW_DEFAULT_SIZE, isGameViewFrameParams, isSetGameViewParams, RpcErrorCode } from "../protocol/index.js";
import { encodeBlob, encodeCapture } from "./screenshot.js";
import {
  camera2DShot,
  centredLayerView,
  IDENTITY_LAYER_VIEW,
  levelCamera2D,
  twoDLayersOf,
  twoDServiceOf,
} from "./view-2d.js";
import type { DocumentMirror } from "./document.js";
import type { SpriteLayerDraw } from "../lite/sprite-game-view.js";
import type { GameViewFrameResult, GameViewState } from "../protocol/index.js";
import type { App, RenderingSettings, RenderTexture } from "@ignifx/core";

/**
 * How long a frame request waits for an animation frame before the renderer draws one itself, in
 * milliseconds: a little over one frame at 60 Hz, so a visible view still renders on its own beat.
 */
export const GAME_VIEW_FRAME_WAIT_MS = 20;

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
   * `gameViewFrame`: renders the document camera, a `Camera` into the texture or a `Camera2D`
   * through the sprite pass, and answers it as an image.
   *
   * @param app - The scene view's app.
   * @param mirror - The open document.
   * @param params - `{ format, quality?, width?, height? }`.
   * @returns The image and the camera's document uid, or no image when the document has no camera.
   */
  async frame(app: App, mirror: DocumentMirror, params: unknown): Promise<GameViewFrameResult> {
    if (!isGameViewFrameParams(params)) {
      throw new InvalidParamsError(
        'gameViewFrame takes { format: "png" | "jpeg", quality?, width?, height? } with sides from 1 to 2048.',
      );
    }
    if (!this.#enabled || this.#texture === null) {
      throw new RpcFailure(
        RpcErrorCode.invalidRequest,
        'The game view is off; send "setGameView" with enabled: true first.',
      );
    }
    if (params.width !== undefined || params.height !== undefined) {
      this.set(app, { enabled: true, width: params.width ?? this.#width, height: params.height ?? this.#height });
    }
    const texture = this.#texture;
    const size = { width: this.#width, height: this.#height };
    const quality = params.quality ?? DEFAULT_JPEG_QUALITY;
    const camera = documentCamera(app, mirror);
    if (camera !== null) {
      const uid = (mirror.documentEntityOf(camera.entity) ?? camera.entity).uid;
      await app.renderer.renderToTexture(camera, texture, { maxWaitMs: GAME_VIEW_FRAME_WAIT_MS });
      const capture = await texture.readPixels();
      const dataUrl = await encodeCapture(capture, size, params.format, quality);
      return { dataUrl, ...size, camera: uid };
    }
    const camera2D = levelCamera2D(app, mirror.scene);
    const layers = twoDLayersOf(app);
    const twoD = twoDServiceOf(app);
    if (camera2D === null || layers === null || twoD === null) {
      return { dataUrl: null, ...size, camera: null };
    }
    const uid = (mirror.documentEntityOf(camera2D.entity) ?? camera2D.entity).uid;
    // A frame first, so the sprites show the document as it is now, not as the last frame left it.
    await app.renderer.nextFrame({ maxWaitMs: GAME_VIEW_FRAME_WAIT_MS });
    const shot = camera2DShot(camera2D, size.width, size.height, twoD.pixelsPerUnit);
    const world = centredLayerView(shot, size.width, size.height, twoD.pixelsPerUnit);
    const draws: SpriteLayerDraw[] = layers.map(({ layer, screenSpace }) => {
      const view = screenSpace ? IDENTITY_LAYER_VIEW : world;
      return { layer, x: view.x, y: view.y, zoom: view.zoom, rotation: view.rotation };
    });
    const { renderSpriteGameView } = await import("../lite/sprite-game-view.js");
    // Read per render, so a changed `rendering.clearColor` shows on the next frame.
    const { clearColor } = app.settings.section<RenderingSettings>(RENDERING_SETTINGS_SECTION);
    const type = params.format === "png" ? "image/png" : "image/jpeg";
    const blob = await renderSpriteGameView(app.lite.engine, draws, { ...size, clear: clearColor }, type, quality);
    return { dataUrl: await encodeBlob(blob, type), ...size, camera: uid };
  }

  /** Frees the texture. */
  dispose(): void {
    this.#texture?.dispose();
    this.#texture = null;
    this.#enabled = false;
  }
}
