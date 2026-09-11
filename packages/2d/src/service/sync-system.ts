import { Vec2 } from "@ignifx/core";
import { Camera2D } from "../camera/camera-2d.js";
import { centreView, createSpriteScratch, updateSprite, writeScratch, writeView } from "../lite/sprite-layer.js";
import { pivotedPositionToRef, spriteRotationToLite, viewRotationToLite, worldToPixelsToRef } from "../math/coords.js";
import { SpriteRenderer } from "../sprite/sprite-renderer.js";
import { TilemapRenderer } from "../tilemap/tilemap-renderer.js";
import { Tilemap } from "../tilemap/tilemap.js";
import type { SpriteLayerRegistry } from "./layer-registry.js";
import type { TwoDRuntime } from "./runtime.js";
import type { SpriteScratch } from "../lite/sprite-layer.js";
import type { MutableVec2, System, SystemContext, Vec2Like, World } from "@ignifx/core";

/**
 * Sync changed sprites and camera views in `PreRender`, before audio and core render sync.
 * Unchanged sprites need only a transform-version check; static sprites sync once.
 */

/**
 * The `PreRender` order the 2D sync system runs at.
 *
 * @remarks
 * `-450`, not the `-400` `docs/architecture/11-2d-toolkit.md` §2.2 names, because audio's pump
 * already holds `-400`. See the module's own remarks.
 *
 * @public
 */
export const TWO_D_SYNC_ORDER = -450;

/**
 * Writes sprites and camera views into Babylon Lite once per frame.
 *
 * @public
 */
export class TwoDSyncSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/2d-sync";

  readonly #runtime: TwoDRuntime;

  readonly #scratch: SpriteScratch = createSpriteScratch();

  readonly #pixels: MutableVec2 = new Vec2();

  readonly #position: MutableVec2 = new Vec2();

  readonly #boundsMin: MutableVec2 = new Vec2();

  readonly #boundsMax: MutableVec2 = new Vec2();

  /** Sprites seen this frame, so the ones that vanished can be dropped. */
  readonly #seen = new Set<SpriteRenderer>();

  /** Sprites that were placed in a layer on a previous frame. */
  readonly #placed = new Set<SpriteRenderer>();

  /**
   * Builds the system. The extension does this; a game never constructs one.
   *
   * @param runtime - The 2D runtime state: settings, the layer registry, and the Lite renderer.
   *
   * @internal
   */
  constructor(runtime: TwoDRuntime) {
    this.#runtime = runtime;
  }

  /**
   * Runs one frame's synchronisation.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    this.#runtime.ensureRenderer();
    this.#runtime.collectEffects(ctx.world);
    const camera = selectCamera(ctx.world);
    this.#runtime.setMainCamera(camera);
    this.#syncSprites(ctx.world);
    this.#syncViews(camera);
    this.#syncTilemaps(ctx.world);
    this.#runtime.writeEffectParams();
  }

  /**
   * Connects the scene hook to a new world.
   *
   * @remarks
   * This is the only hook that fires for every world. `register` runs before the world exists and
   * `onStart` runs only when a game calls `app.start()`, so a headless tool that loads a scene
   * without ever starting a loop would otherwise never see its `settings.twoD` block.
   *
   * @param world - The new world.
   */
  onWorldCreated(world: World): void {
    this.#runtime.attachWorld(world);
  }

  /**
   * Drops every layer when the world goes away.
   *
   * @param _world - The world being disposed.
   */
  onWorldDisposed(_world: World): void {
    this.#runtime.detachWorld();
    this.#placed.clear();
    this.#seen.clear();
  }

  /**
   * Brings each `TilemapRenderer`'s materialised chunks in line with what the camera can see.
   *
   * @remarks
   * This runs **after** the views have been written, because the chunk window is derived from the
   * camera's visible bounds and those live on a layer's view. A frame where the camera did not move
   * and no tile changed builds nothing.
   *
   * @param world - The world to walk.
   */
  #syncTilemaps(world: World): void {
    const runtime = this.#runtime;
    const renderers = world.components(TilemapRenderer);
    if (renderers.length === 0) {
      return;
    }
    const bounds = runtime.cameraBounds();
    for (let index = 0; index < renderers.length; index += 1) {
      const renderer = renderers[index];
      if (renderer === undefined || !renderer.isEnabledInHierarchy) {
        continue;
      }
      const map = renderer.entity.getComponent(Tilemap);
      if (map === null) {
        continue;
      }
      renderer.sync(map, runtime.layers, bounds, runtime.pixelsPerUnit);
    }
  }

  /**
   * Reconciles every `SpriteRenderer` against its Lite layer.
   *
   * @param world - The world to walk.
   */
  #syncSprites(world: World): void {
    const registry = this.#runtime.layers;
    const pixelsPerUnit = this.#runtime.pixelsPerUnit;
    const sprites = world.components(SpriteRenderer);
    this.#seen.clear();
    let synced = 0;
    for (let index = 0; index < sprites.length; index += 1) {
      const sprite = sprites[index];
      if (sprite === undefined) {
        continue;
      }
      this.#seen.add(sprite);
      const atlas = sprite.atlas;
      if (atlas === null || atlas.lite.atlas === null) {
        // Still loading, failed, or headless: nothing to draw, and nothing to pay for.
        continue;
      }
      const entity = sprite.entity;
      const isStatic = entity.isStatic;
      const matrixVersion = entity.transform.worldMatrixVersion;
      const placement = sprite.placement();
      const key = layerKeyOf(sprite, atlas.address);
      if (placement !== null && placement.key !== key) {
        // The sorting layer, atlas, blend, or space changed: the sprite moves, handle and all.
        registry.remove(sprite);
        this.#placed.delete(sprite);
        sprite.invalidate();
      }
      if (sprite.placement() !== null && !sprite.needsSync(isStatic, matrixVersion)) {
        continue;
      }
      this.#writeSprite(sprite, atlas.frameCount, pixelsPerUnit);
      const current = sprite.placement();
      if (current === null) {
        registry.place(sprite, atlas, this.#scratch);
        this.#placed.add(sprite);
        const placed = sprite.placement();
        if (placed !== null) {
          registry.applyOrderInLayer(placed.key, placed.handle, sprite.orderInLayer);
        }
      } else {
        updateSprite(current.handle, this.#scratch);
        registry.applyOrderInLayer(current.key, current.handle, sprite.orderInLayer);
      }
      sprite.markSynced(
        isStatic,
        matrixVersion,
        this.#boundsMin.x,
        this.#boundsMin.y,
        this.#boundsMax.x,
        this.#boundsMax.y,
      );
      synced += 1;
    }
    this.#dropVanished(registry);
    this.#runtime.reportSynced(synced, sprites.length);
  }

  /**
   * Removes sprites whose components are gone from the world.
   *
   * @param registry - The layer registry.
   */
  #dropVanished(registry: SpriteLayerRegistry): void {
    if (this.#placed.size === 0) {
      return;
    }
    for (const sprite of this.#placed) {
      if (!this.#seen.has(sprite) || sprite.isDestroyed) {
        registry.remove(sprite);
        this.#placed.delete(sprite);
      }
    }
  }

  /**
   * Writes one sprite's props into the reusable scratch record, and its world AABB into the two
   * scratch vectors the caller reads back.
   *
   * @param sprite - The component.
   * @param frameCount - How many frames the atlas has, so an out-of-range frame draws frame 0.
   * @param pixelsPerUnit - The pixels one metre spans.
   */
  #writeSprite(sprite: SpriteRenderer, frameCount: number, pixelsPerUnit: number): void {
    const atlas = sprite.atlas;
    const frame = sprite.frame >= 0 && sprite.frame < frameCount ? sprite.frame : 0;
    const info = atlas?.frame(frame) ?? null;
    const frameWidth = info?.widthPx ?? 0;
    const frameHeight = info?.heightPx ?? 0;
    const transform = sprite.entity.transform;
    const matrix = transform.worldMatrix;
    // Read the world matrix directly: `position2D`, `rotation2D` and `localScale2D` all allocate,
    // and `rotation2D` is the *local* angle, not the world one (`transform.ts` 349).
    const worldX = matrix[12] ?? 0;
    const worldY = matrix[13] ?? 0;
    const scaleX = Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0);
    const scaleY = Math.hypot(matrix[4] ?? 0, matrix[5] ?? 1);
    const rotationDegrees = Math.atan2(matrix[1] ?? 0, matrix[0] ?? 1) * RAD_TO_DEG;
    const rotation = spriteRotationToLite(rotationDegrees);
    const widthPx = frameWidth * scaleX;
    const heightPx = frameHeight * scaleY;
    const anchor = worldToPixelsToRef(worldX, worldY, pixelsPerUnit, this.#pixels);
    const pivot = sprite.pivotOverride ?? info?.pivot ?? CENTRE_PIVOT;
    const placed = pivotedPositionToRef(anchor.x, anchor.y, pivot, widthPx, heightPx, rotation, this.#position);
    const tint = sprite.color;
    writeScratch(
      this.#scratch,
      placed.x,
      placed.y,
      widthPx,
      heightPx,
      frame,
      rotation,
      tint.r,
      tint.g,
      tint.b,
      tint.a,
      sprite.flipX,
      sprite.flipY,
      sprite.isEnabledInHierarchy,
    );
    // The world AABB of the unrotated quad, which `SpriteRenderer.bounds` reports.
    const halfWidth = widthPx / (2 * pixelsPerUnit);
    const halfHeight = heightPx / (2 * pixelsPerUnit);
    const centreX = worldX + ((0.5 - pivot.x) * widthPx) / pixelsPerUnit;
    const centreY = worldY - ((0.5 - pivot.y) * heightPx) / pixelsPerUnit;
    this.#boundsMin.x = centreX - halfWidth;
    this.#boundsMin.y = centreY - halfHeight;
    this.#boundsMax.x = centreX + halfWidth;
    this.#boundsMax.y = centreY + halfHeight;
  }

  /**
   * Writes the camera's view onto every world layer, and the identity view onto screen-space ones.
   *
   * @param camera - The active camera, or `null`.
   */
  #syncViews(camera: Camera2D | null): void {
    const runtime = this.#runtime;
    const width = runtime.viewportWidthPx;
    const height = runtime.viewportHeightPx;
    if (camera === null) {
      runtime.layers.forEachLayer((layer): void => {
        writeView(layer.view, 0, 0, 1, 0);
      });
      return;
    }
    const transform = camera.entity.transform;
    const matrix = transform.worldMatrix;
    camera.resolve(matrix[12] ?? 0, matrix[13] ?? 0, width, height, runtime.pixelsPerUnit);
    const centre = worldToPixelsToRef(camera.centre.x, camera.centre.y, runtime.pixelsPerUnit, this.#pixels);
    const rotation = viewRotationToLite(Math.atan2(matrix[1] ?? 0, matrix[0] ?? 1) * RAD_TO_DEG);
    const zoom = camera.zoom;
    const centreX = centre.x;
    const centreY = centre.y;
    runtime.layers.forEachLayer((layer, screenSpace): void => {
      if (screenSpace) {
        writeView(layer.view, 0, 0, 1, 0);
        return;
      }
      centreView(layer.view, centreX, centreY, width, height, zoom, rotation);
    });
    runtime.applyParallax();
  }
}

/** Degrees per radian, so the sync loop does not import a constant it would only divide by. */
const RAD_TO_DEG = 180 / Math.PI;

/** The pivot used when neither the component nor the frame declares one. */
const CENTRE_PIVOT: Vec2Like = Object.freeze({ x: 0.5, y: 0.5 });

/**
 * The layer key a sprite currently belongs to.
 *
 * @param sprite - The component.
 * @param atlasAddress - Its atlas's address.
 * @returns The key.
 */
function layerKeyOf(sprite: SpriteRenderer, atlasAddress: string): string {
  return `${sprite.sortingLayer}|${atlasAddress}|${sprite.blend}|${sprite.screenSpace ? "screen" : "world"}`;
}

/**
 * Picks the camera the frame draws through: the highest-priority enabled `Camera2D`.
 *
 * @param world - The world to search.
 * @returns The camera, or `null` when the world has none enabled.
 *
 * @public
 */
export function selectCamera(world: World): Camera2D | null {
  const cameras = world.components(Camera2D);
  let best: Camera2D | null = null;
  for (let index = 0; index < cameras.length; index += 1) {
    const camera = cameras[index];
    if (camera === undefined || !camera.isEnabledInHierarchy) {
      continue;
    }
    if (best === null || camera.priority > best.priority) {
      best = camera;
    }
  }
  return best;
}
