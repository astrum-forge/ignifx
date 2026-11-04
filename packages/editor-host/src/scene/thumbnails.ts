/**
 * `renderThumbnail` (engine ask E8): a model or prefab rendered on its own, in a second app the
 * host keeps for the purpose, through `app.renderer.renderToTexture`.
 *
 * The stage is a separate app on a 1x1 `OffscreenCanvas`, built from the project's own options, so
 * a thumbnail never shows the open document, never lights it, and is never lit by it. It is
 * created on the first request and lives until the host is disposed.
 *
 * The channel runs `renderThumbnail` beside its one-at-a-time queue, so the frames a thumbnail
 * waits for hold up no other request; thumbnails queue among themselves here, one stage at a time.
 */

import { Camera, Light } from "@ignifx/core";
import { InvalidParamsError } from "../channel.js";
import { entityWorldBounds } from "../lite/gizmos.js";
import { isRenderThumbnailParams, THUMBNAIL_DEFAULT_SIZE } from "../protocol/index.js";
import { GAME_VIEW_FRAME_WAIT_MS } from "./game-view.js";
import { encodeCapture } from "./screenshot.js";
import type { WorldBounds } from "../lite/gizmos.js";
import type { RenderThumbnailParams, ThumbnailResult } from "../protocol/index.js";
import type { App, Entity, RenderTexture, SceneFile, SceneInstance } from "@ignifx/core";

/** The JPEG quality when the request gives none, as for `screenshot`. */
const DEFAULT_JPEG_QUALITY = 0.9;

/** The stage camera's vertical field of view, in degrees. */
const STAGE_FOV = 35;

/** The texture is this many times the image's side, and scaled down when encoded. */
const SUPERSAMPLE = 2;

/** How many frames a load is given to build its meshes before the thumbnail is taken anyway. */
const MAX_SETTLE_FRAMES = 120;

/** How many frames in a row the bounds must hold still before the thumbnail is taken. */
const STILL_FRAMES = 2;

/**
 * How many frames in a row nothing may draw, with no asset of the stage still loading, before the
 * subject is taken to be empty (a failed model, a prefab without meshes). A loaded model builds its
 * meshes in the first frame.
 */
const EMPTY_FRAMES = 4;

/** The direction from the subject to the camera: in front, above and to the right. */
const VIEW_DIRECTION = { x: 0.55, y: 0.45, z: -0.7 };

/** What a thumbnail is of. */
type ThumbnailKind = "model" | "prefab";

/** The stage app and its fixed objects. */
interface Stage {
  /** The app. */
  readonly app: App;
  /** The camera that frames each subject. */
  readonly camera: Camera;
}

/**
 * Types the requested asset.
 *
 * @param params - Checked parameters.
 * @returns The address and what it is.
 * @throws InvalidParamsError for an asset that is neither a model nor a prefab.
 */
export function thumbnailSubject(params: RenderThumbnailParams): {
  readonly address: string;
  readonly kind: ThumbnailKind;
} {
  const asset = params.asset;
  const address = typeof asset === "string" ? asset : asset.$asset;
  const type = typeof asset === "string" ? undefined : asset.type;
  const lower = address.toLowerCase();
  if (type === "model" || (type === undefined && (lower.endsWith(".glb") || lower.endsWith(".gltf")))) {
    return { address, kind: "model" };
  }
  if (
    type === "scene" ||
    type === "prefab" ||
    (type === undefined && (lower.endsWith(".prefab.json") || lower.endsWith(".scene.json")))
  ) {
    return { address, kind: "prefab" };
  }
  throw new InvalidParamsError(
    `renderThumbnail renders models (.glb, .gltf) and prefabs (.prefab.json); ${address} is neither.`,
  );
}

/**
 * The one-entity scene file that shows a subject.
 *
 * @param address - The asset address.
 * @param kind - What it is.
 * @returns The file.
 */
export function thumbnailScene(address: string, kind: ThumbnailKind): SceneFile {
  const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } as const;
  const entity =
    kind === "model"
      ? {
          uid: "thumbnail-subject",
          name: "Thumbnail",
          parent: null,
          transform,
          components: [
            { uid: "thumbnail-model", type: "ignifx/Model", props: { model: { $asset: address, type: "model" } } },
          ],
        }
      : {
          uid: "thumbnail-subject",
          name: "Thumbnail",
          parent: null,
          transform,
          instance: { scene: { $asset: address } },
        };
  return { format: "ignifx.scene", formatVersion: 1, name: "thumbnail", entities: [entity] };
}

/** Renders thumbnails on a stage app of their own. */
export class ThumbnailRenderer {
  readonly #createApp: () => Promise<App>;

  #stage: Promise<Stage> | null = null;

  #texture: RenderTexture | null = null;

  #loads = 0;

  /** The previous thumbnail, which the next waits for: the stage shows one subject at a time. */
  #queue: Promise<unknown> = Promise.resolve();

  /** Whether the stage's assets have a load in flight, from their last progress report. */
  #isLoading = false;

  #isDisposed = false;

  /**
   * Keeps the factory; nothing is created until the first thumbnail.
   *
   * @param createApp - Creates the stage app from the project's options, unstarted.
   */
  constructor(createApp: () => Promise<App>) {
    this.#createApp = createApp;
  }

  /**
   * `renderThumbnail`: loads the asset alone on the stage, frames it, renders it and encodes it.
   *
   * @param params - `{ asset, size?, format, quality? }`.
   * @returns The image, once the thumbnails asked for before it are done.
   */
  async render(params: unknown): Promise<ThumbnailResult> {
    const run = this.#queue.then(async () => this.#render(params));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Renders one thumbnail; {@link ThumbnailRenderer.render} runs them one at a time.
   *
   * @param params - The request's `params`.
   * @returns The image.
   */
  async #render(params: unknown): Promise<ThumbnailResult> {
    if (!isRenderThumbnailParams(params)) {
      throw new InvalidParamsError(
        'renderThumbnail takes { asset: address | { $asset, type? }, size?: 1 to 1024, format: "png" | "jpeg", quality? }.',
      );
    }
    const { address, kind } = thumbnailSubject(params);
    const stage = await (this.#stage ??= this.#open());
    const { app, camera } = stage;
    this.#loads += 1;
    const instance = await app.world.loadSceneFile(thumbnailScene(address, kind), {
      address: `__ignifx_thumbnail__/${String(this.#loads)}.scene.json`,
      mode: "single",
    });
    try {
      const bounds = await settledBounds(app, instance, () => this.#isLoading);
      frameCamera(camera, bounds);
      await nextFrame();
      const size = params.size ?? THUMBNAIL_DEFAULT_SIZE;
      const texture = this.#textureOf(app, size * SUPERSAMPLE);
      await app.renderer.renderToTexture(camera, texture, { maxWaitMs: GAME_VIEW_FRAME_WAIT_MS });
      const capture = await texture.readPixels();
      const dataUrl = await encodeCapture(
        capture,
        { width: size, height: size },
        params.format,
        params.quality ?? DEFAULT_JPEG_QUALITY,
      );
      return { dataUrl, width: size, height: size };
    } finally {
      await app.world.unloadScene(instance);
    }
  }

  /** Disposes the stage app, now or once it has been created. */
  dispose(): void {
    this.#isDisposed = true;
    this.#texture = null;
    this.#stage?.then(
      (stage) => {
        stage.app.dispose();
      },
      () => null,
    );
  }

  /**
   * Creates and starts the stage: a persistent scene with the camera and two lights.
   *
   * @returns The stage.
   */
  async #open(): Promise<Stage> {
    const app = await this.#createApp();
    app.assets.onProgress.connect((progress) => {
      this.#isLoading = progress.loaded < progress.total;
    });
    const scene = app.world.createScene("thumbnail-stage", { persistent: true });
    const eye = app.world.createEntity("Thumbnail Camera", { scene });
    const camera = eye.addComponent(Camera, { fov: STAGE_FOV, near: 0.01, far: 1000 });
    const sky = app.world.createEntity("Thumbnail Sky", { scene });
    sky.addComponent(Light, { type: "hemispheric", intensity: 0.8 });
    const sun = app.world.createEntity("Thumbnail Sun", { scene });
    sun.transform.localPosition.set(4, 6, -5);
    sun.transform.lookAt({ x: 0, y: 0, z: 0 });
    sun.addComponent(Light, { type: "directional", intensity: 2 });
    await app.start();
    if (this.#isDisposed) {
      app.dispose();
    }
    return { app, camera };
  }

  /**
   * The stage's texture at a side, created again when the side changes.
   *
   * @param app - The stage app.
   * @param side - The side in pixels.
   * @returns The texture.
   */
  #textureOf(app: App, side: number): RenderTexture {
    const current = this.#texture;
    if (current !== null && current.width === side && !current.isDisposed) {
      return current;
    }
    current?.dispose();
    const texture = app.renderer.createRenderTexture(side, side);
    this.#texture = texture;
    return texture;
  }
}

/**
 * Waits one animation frame.
 *
 * @returns A promise that settles in the next frame callback.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Waits until a loaded subject's meshes exist and hold still, then measures them. It stops early
 * when nothing has drawn for a few frames and nothing is loading, as nothing will.
 *
 * @param app - The stage app.
 * @param instance - The loaded subject.
 * @param isLoading - Whether the stage still has an asset load in flight.
 * @returns Its world bounds; a unit box at the origin when nothing draws.
 */
async function settledBounds(app: App, instance: SceneInstance, isLoading: () => boolean): Promise<WorldBounds> {
  const settle = boundsSettler();
  let last: WorldBounds | null = null;
  for (let frame = 0; frame < MAX_SETTLE_FRAMES; frame += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one frame at a time is the point
    await nextFrame();
    last = unionBounds(app, instance.roots);
    if (settle(last, isLoading())) {
      break;
    }
  }
  return last ?? { min: { x: -0.5, y: -0.5, z: -0.5 }, max: { x: 0.5, y: 0.5, z: 0.5 } };
}

/**
 * Decides, frame by frame, when a thumbnail's subject has settled: its bounds held still for
 * `STILL_FRAMES` frames, or nothing has drawn for `EMPTY_FRAMES` frames with nothing loading.
 *
 * @returns A function that takes each frame's bounds (`null` when nothing draws) and whether an
 * asset is loading, and answers true once the subject has settled.
 *
 * @internal
 */
export function boundsSettler(): (bounds: WorldBounds | null, isLoading: boolean) => boolean {
  let last: WorldBounds | null = null;
  let still = 0;
  let empty = 0;
  return (bounds, isLoading) => {
    still = bounds !== null && last !== null && sameBounds(bounds, last) ? still + 1 : 0;
    empty = bounds === null && !isLoading ? empty + 1 : 0;
    last = bounds;
    return still >= STILL_FRAMES || empty >= EMPTY_FRAMES;
  };
}

/**
 * The union of entities' world bounds.
 *
 * @param app - The stage app.
 * @param entities - The entities.
 * @returns The box, or `null` when none draws.
 */
function unionBounds(app: App, entities: readonly Entity[]): WorldBounds | null {
  let result: WorldBounds | null = null;
  for (const entity of entities) {
    const box = entityWorldBounds(app.lite, entity);
    if (box === null) {
      continue;
    }
    result =
      result === null
        ? box
        : {
            min: {
              x: Math.min(result.min.x, box.min.x),
              y: Math.min(result.min.y, box.min.y),
              z: Math.min(result.min.z, box.min.z),
            },
            max: {
              x: Math.max(result.max.x, box.max.x),
              y: Math.max(result.max.y, box.max.y),
              z: Math.max(result.max.z, box.max.z),
            },
          };
  }
  return result;
}

/**
 * Tells whether two boxes are equal.
 *
 * @param a - One box.
 * @param b - The other.
 * @returns True for the same corners.
 */
function sameBounds(a: WorldBounds, b: WorldBounds): boolean {
  return (
    a.min.x === b.min.x &&
    a.min.y === b.min.y &&
    a.min.z === b.min.z &&
    a.max.x === b.max.x &&
    a.max.y === b.max.y &&
    a.max.z === b.max.z
  );
}

/**
 * Places the stage camera so a box fills the view, with its clip planes around it.
 *
 * @param camera - The stage camera.
 * @param bounds - The subject's bounds.
 */
export function frameCamera(camera: Camera, bounds: WorldBounds): void {
  const center = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  const radius = Math.max(Math.hypot(bounds.max.x - center.x, bounds.max.y - center.y, bounds.max.z - center.z), 0.01);
  const distance = (radius / Math.sin(((STAGE_FOV / 2) * Math.PI) / 180)) * 1.05;
  const length = Math.hypot(VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z);
  camera.transform.localPosition.set(
    center.x + (VIEW_DIRECTION.x / length) * distance,
    center.y + (VIEW_DIRECTION.y / length) * distance,
    center.z + (VIEW_DIRECTION.z / length) * distance,
  );
  camera.transform.lookAt(center);
  camera.near = Math.max(distance - radius * 1.5, distance / 1000);
  camera.far = distance + radius * 1.5;
}
