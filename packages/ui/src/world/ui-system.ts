import { Quat, Vec3 } from "@ignifx/core";
import { HudText } from "../text/hud-text.js";
import { WorldText2D } from "../text/world-text-2d.js";
import { WorldText } from "../text/world-text.js";
import { WorldAnchor } from "./world-anchor.js";
import type { UiHost } from "../dom/host.js";
import type { I18nService } from "../i18n/i18n-service.js";
import type { TextRuntime } from "../text/text-runtime.js";
import type {
  App,
  Camera,
  MutableQuat,
  MutableVec3,
  System,
  SystemContext,
  Transform,
  Vec3Like,
  World,
} from "@ignifx/core";

/**
 * The one system `@ignifx/ui` registers (`docs/architecture/01-lifecycle-and-time.md` §3,
 * `13-ui.md` §2: *"Updated in `PreRender` after camera sync, in batch, using
 * `Camera.worldToScreen`"*).
 *
 * ## Ordering
 *
 * `@ignifx/core`'s `RenderSyncSystem` runs at `PreRender` order **900**
 * (`packages/core/src/render/render-sync-system.ts` 63) and is what refreshes the render target's
 * size on every `Camera` and writes the frame's transforms onto the Lite cameras. Every projection
 * this system performs would be a frame stale, and would divide by last frame's viewport, if it ran
 * before that. {@link UI_SYNC_ORDER} is therefore **1100**: after core's sync, and inside the
 * `[1001, 9999]` band `RegisterSystemOptions` reserves for extensions
 * (`packages/core/src/app/types.ts` 649). Nothing else in the engine occupies it — physics
 * interpolation is at `-500`, 2D sync at `-450`, audio at `-400`.
 *
 * ## What it does
 *
 * One pass per component kind, in the order a frame needs them: create the text renderer if this is
 * the first frame, project every `WorldAnchor` and every `WorldText2D` once, then re-shape whatever
 * text changed. Projection uses the world's main camera; with no camera nothing is projected and
 * every anchored element is hidden, which is what a loading screen with no scene looks like.
 */

/**
 * The `PreRender` order the UI system runs at.
 *
 * @remarks
 * After `RENDER_SYNC_ORDER` (900), which is the frame's camera synchronisation, and inside the
 * extension band. See the module's own remarks.
 *
 * @public
 */
export const UI_SYNC_ORDER = 1100;

/**
 * What the system is built with.
 *
 * @public
 */
export interface UiSystemOptions {
  /** The app, for the render surface's size and the Lite scene. */
  readonly app: App;
  /** The overlay host, for the layout the anchors are placed in. */
  readonly host: UiHost;
  /** The text renderer's life. */
  readonly runtime: TextRuntime;
  /** The localization service `i18nKey` is resolved through. */
  readonly i18n: I18nService;
}

/**
 * Projects world anchors and re-shapes text once per frame.
 *
 * @public
 */
export class UiSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/ui-sync";

  readonly #options: UiSystemOptions;

  readonly #point: MutableVec3 = new Vec3();

  readonly #screen: MutableVec3 = new Vec3();

  readonly #cameraPosition: MutableVec3 = new Vec3();

  readonly #cameraRotation: MutableQuat = new Quat();

  readonly #targetSize = { width: 1, height: 1 };

  /**
   * Builds the system. The extension does this; a game never constructs one.
   *
   * @param options - The app, the host, the text runtime, and the localization service.
   *
   * @internal
   */
  constructor(options: UiSystemOptions) {
    this.#options = options;
  }

  /**
   * Builds the overlay, now that the engine and its canvas exist.
   *
   * @remarks
   * This is the only hook that fires inside `createApp` **after** the Lite engine was created:
   * `register` runs before it, and `onStart` runs only when a game calls `app.start()`, which a
   * headless tool never does. `@ignifx/2d` uses the same hook for the same reason.
   *
   * @param _world - The new world, which the overlay does not need.
   */
  onWorldCreated(_world: World): void {
    this.#options.host.mount();
  }

  /**
   * Runs one frame's synchronisation.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    const { app, host, runtime, i18n } = this.#options;
    runtime.ensureRenderer();
    this.#readTargetSize(app);
    const camera = ctx.world.mainCamera;
    const hasCamera = camera !== null;
    if (hasCamera) {
      camera.transform.positionToRef(this.#cameraPosition);
      camera.transform.rotationToRef(this.#cameraRotation);
    }
    this.#syncAnchors(ctx.world, camera, host);
    this.#syncWorldText2D(ctx.world, camera, runtime, i18n);
    this.#syncHudText(ctx.world, runtime, i18n);
    this.#syncWorldText(ctx.world, app, i18n, hasCamera);
  }

  /**
   * Reads the render target's size, in device pixels; a headless app reports 1x1.
   *
   * @param app - The app, for its render surface.
   */
  #readTargetSize(app: App): void {
    const surface = app.renderer.surface;
    this.#targetSize.width = surface === null ? 1 : Math.max(1, surface.width);
    this.#targetSize.height = surface === null ? 1 : Math.max(1, surface.height);
  }

  /**
   * Projects and places every anchored element.
   *
   * @param world - The world.
   * @param camera - The main camera, or `null`.
   * @param host - The overlay host.
   */
  #syncAnchors(world: World, camera: Camera | null, host: UiHost): void {
    const anchors = world.components(WorldAnchor);
    if (anchors.length === 0) {
      return;
    }
    const layout = host.layout;
    const mapping = host.pixelMapping;
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      if (anchor === undefined || anchor.element === null) {
        continue;
      }
      if (camera === null) {
        anchor.place(0, 0, false, 0, layout.width, layout.height, mapping);
        continue;
      }
      const inFront = this.#project(camera, anchor.transform, anchor.offset);
      anchor.place(
        this.#screen.x,
        this.#screen.y,
        inFront,
        this.#distanceToCamera(),
        layout.width,
        layout.height,
        mapping,
      );
    }
  }

  /**
   * Projects and re-shapes every world-anchored pixel label.
   *
   * @param world - The world.
   * @param camera - The main camera, or `null`.
   * @param runtime - The text renderer's life.
   * @param i18n - The localization service.
   */
  #syncWorldText2D(world: World, camera: Camera | null, runtime: TextRuntime, i18n: I18nService): void {
    const labels = world.components(WorldText2D);
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      if (label === undefined) {
        continue;
      }
      if (camera === null) {
        label.sync(runtime, i18n, 0, 0, false);
        continue;
      }
      const inFront = this.#project(camera, label.transform, label.offset);
      label.sync(runtime, i18n, this.#screen.x, this.#screen.y, inFront);
    }
  }

  /**
   * Re-shapes and places every screen-anchored pixel label.
   *
   * @param world - The world.
   * @param runtime - The text renderer's life.
   * @param i18n - The localization service.
   */
  #syncHudText(world: World, runtime: TextRuntime, i18n: I18nService): void {
    const labels = world.components(HudText);
    for (let index = 0; index < labels.length; index += 1) {
      labels[index]?.sync(runtime, i18n, this.#targetSize.width, this.#targetSize.height);
    }
  }

  /**
   * Re-shapes and places every world-space sign.
   *
   * @param world - The world.
   * @param app - The app, for the Lite scene.
   * @param i18n - The localization service.
   * @param hasCamera - Whether a billboard has a rotation to copy.
   */
  #syncWorldText(world: World, app: App, i18n: I18nService, hasCamera: boolean): void {
    const signs = world.components(WorldText);
    if (signs.length === 0) {
      return;
    }
    const scene = app.lite.scene;
    const rotation = hasCamera ? this.#cameraRotation : null;
    for (let index = 0; index < signs.length; index += 1) {
      signs[index]?.sync(scene, i18n, rotation);
    }
  }

  /**
   * Projects an entity's offset position onto the render target.
   *
   * @param camera - The main camera.
   * @param transform - The entity's transform.
   * @param offset - The world-space offset to add first.
   * @returns `true` when the point is in front of the camera.
   */
  #project(camera: Camera, transform: Transform, offset: Vec3Like): boolean {
    transform.positionToRef(this.#point);
    this.#point.x += offset.x;
    this.#point.y += offset.y;
    this.#point.z += offset.z;
    return camera.worldToScreen(this.#point, this.#screen);
  }

  /**
   * How far the point last projected is from the camera.
   *
   * @returns The distance, in metres.
   */
  #distanceToCamera(): number {
    const dx = this.#point.x - this.#cameraPosition.x;
    const dy = this.#point.y - this.#cameraPosition.y;
    const dz = this.#point.z - this.#cameraPosition.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
