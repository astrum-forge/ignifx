/**
 * The scene view's 2D side: the 2D editor camera's arithmetic, and the parts of `@ignifx/2d` the
 * host reads. The host does not import `@ignifx/2d` (it is not a dependency of this package): it
 * reaches `app.twoD` and the 2D component classes by their names, through the project's own copy,
 * the way `@ignifx/physics-2d` finds a `Tilemap` by its type id (`11-2d-toolkit.md` §2.5).
 */

import { Camera } from "@ignifx/core";
import { ViewMode } from "../protocol/index.js";
import type { App, Component, ComponentType, ConcreteComponentType, Entity, SceneInstance } from "@ignifx/core";

/** The type id of `@ignifx/2d`'s `Camera2D`. */
export const CAMERA_2D_TYPE = "ignifx/Camera2D";

/** The type id of `@ignifx/2d`'s `SpriteRenderer`. */
export const SPRITE_RENDERER_TYPE = "ignifx/SpriteRenderer";

/** The type id of `@ignifx/2d`'s `Tilemap`. */
export const TILEMAP_TYPE = "ignifx/Tilemap";

/** `@ignifx/2d`'s default pixels per unit, used when the project has no 2D toolkit. */
export const DEFAULT_PIXELS_PER_UNIT = 100;

/**
 * The wheel's zoom steps, in screen pixels per layer pixel (`Camera2D.zoom`): with a pixels-per-unit
 * equal to the art's, a source pixel spans a whole number of screen pixels from 1 up (S0.2 §5).
 */
export const ZOOM_STEPS: readonly number[] = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/** The farthest out a frame may zoom. */
const MIN_ZOOM = 1 / 64;

/** The farthest in a frame may zoom. */
const MAX_ZOOM = 64;

/** How much room a frame leaves around what it fits, as a factor of its size. */
const FRAME_MARGIN = 1.2;

/** The smallest extent a frame fits, in metres, so a point or a sliver does not zoom in forever. */
const MIN_FRAME_EXTENT = 0.5;

/** An axis-aligned rectangle of the 2D world, in metres, +Y up. */
export interface Box2D {
  /** The left edge. */
  readonly minX: number;
  /** The bottom edge. */
  readonly minY: number;
  /** The right edge. */
  readonly maxX: number;
  /** The top edge. */
  readonly maxY: number;
}

/** What the 2D editor camera shows. */
export interface View2D {
  /** The world x at the view's centre, in metres. */
  readonly centerX: number;
  /** The world y at the view's centre, in metres. */
  readonly centerY: number;
  /** Screen pixels per layer pixel, as `Camera2D.zoom`. */
  readonly zoom: number;
  /** Layer pixels per metre. */
  readonly pixelsPerUnit: number;
  /** The view's backing-store width, in pixels. */
  readonly widthPx: number;
  /** The view's backing-store height, in pixels. */
  readonly heightPx: number;
}

/**
 * The next zoom step in or out from a zoom, which need not be a step itself.
 *
 * @param zoom - The current zoom.
 * @param direction - `1` to zoom in, `-1` to zoom out.
 * @returns The nearest step beyond `zoom` that way, or the last step when there is none.
 */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => step > zoom * 1.0001) ?? ZOOM_STEPS.at(-1) ?? zoom;
  }
  return ZOOM_STEPS.findLast((step) => step < zoom * 0.9999) ?? ZOOM_STEPS[0] ?? zoom;
}

/**
 * The half-height a camera shows at a zoom: the inverse of `Camera2D`'s
 * `zoom = heightPx / (2 · size · PPU)`.
 *
 * @param zoom - Screen pixels per layer pixel.
 * @param heightPx - The view's backing-store height.
 * @param pixelsPerUnit - Layer pixels per metre.
 * @returns The half-height, in metres.
 */
export function orthographicSizeFor(zoom: number, heightPx: number, pixelsPerUnit: number): number {
  return heightPx / (2 * zoom * pixelsPerUnit);
}

/**
 * The zoom at which a camera shows a half-height: `Camera2D`'s own rule.
 *
 * @param orthographicSize - The half-height, in metres.
 * @param heightPx - The view's backing-store height.
 * @param pixelsPerUnit - Layer pixels per metre.
 * @returns The zoom.
 */
export function zoomForSize(orthographicSize: number, heightPx: number, pixelsPerUnit: number): number {
  return heightPx / (2 * orthographicSize * pixelsPerUnit);
}

/**
 * The world point under a backing-store pixel of the view.
 *
 * @param view - The view.
 * @param x - The pixel x, from the left edge.
 * @param y - The pixel y, from the top edge.
 * @returns The point, in metres, +Y up.
 */
export function screenToWorld2D(view: View2D, x: number, y: number): { readonly x: number; readonly y: number } {
  const scale = view.zoom * view.pixelsPerUnit;
  return {
    x: view.centerX + (x - view.widthPx / 2) / scale,
    y: view.centerY - (y - view.heightPx / 2) / scale,
  };
}

/**
 * Where the view's centre goes when it zooms about a pixel, so the world point under that pixel
 * stays under it.
 *
 * @param view - The view before the zoom.
 * @param x - The pixel x.
 * @param y - The pixel y.
 * @param zoom - The new zoom.
 * @returns The new centre.
 */
export function zoomAbout(
  view: View2D,
  x: number,
  y: number,
  zoom: number,
): { readonly centerX: number; readonly centerY: number } {
  const anchor = screenToWorld2D(view, x, y);
  const scale = zoom * view.pixelsPerUnit;
  return {
    centerX: anchor.x - (x - view.widthPx / 2) / scale,
    centerY: anchor.y + (y - view.heightPx / 2) / scale,
  };
}

/**
 * The centre and zoom that fit a rectangle in the view, with a margin.
 *
 * @param box - The rectangle.
 * @param widthPx - The view's backing-store width.
 * @param heightPx - The view's backing-store height.
 * @param pixelsPerUnit - Layer pixels per metre.
 * @returns The centre and the zoom.
 */
export function fitView(
  box: Box2D,
  widthPx: number,
  heightPx: number,
  pixelsPerUnit: number,
): { readonly centerX: number; readonly centerY: number; readonly zoom: number } {
  const width = Math.max(box.maxX - box.minX, MIN_FRAME_EXTENT) * FRAME_MARGIN * pixelsPerUnit;
  const height = Math.max(box.maxY - box.minY, MIN_FRAME_EXTENT) * FRAME_MARGIN * pixelsPerUnit;
  const zoom = Math.min(widthPx / width, heightPx / height);
  return {
    centerX: (box.minX + box.maxX) / 2,
    centerY: (box.minY + box.maxY) / 2,
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) && zoom > 0 ? zoom : 1)),
  };
}

/**
 * Grows a rectangle to take in another.
 *
 * @param box - The rectangle so far, or `null`.
 * @param other - The one to take in.
 * @returns Their union.
 */
function union(box: Box2D | null, other: Box2D): Box2D {
  return box === null
    ? other
    : {
        minX: Math.min(box.minX, other.minX),
        minY: Math.min(box.minY, other.minY),
        maxX: Math.max(box.maxX, other.maxX),
        maxY: Math.max(box.maxY, other.maxY),
      };
}

// -------------------------------------------------------------------------------------------
// `@ignifx/2d`, by data
// -------------------------------------------------------------------------------------------

/** What the host reads of a `TwoDPick`. */
export interface TwoDPickLike {
  /** The entity carrying the sprite hit. */
  readonly entity: Entity;
}

/** What the host passes to `app.twoD.pickAt`, as `@ignifx/2d`'s `TwoDPickOptions`. */
export interface TwoDPickOptionsLike {
  /** Restricts the pick to the sprites of the entities this accepts. */
  readonly filter?: (entity: Entity) => boolean;
  /** Whether sprites the game marks `pickable: false` count too. */
  readonly includeUnpickable?: boolean;
}

/** What the host uses of `app.twoD`, `@ignifx/2d`'s `TwoDService`. */
export interface TwoDServiceLike {
  /** `"sprite"`, where sprites are the whole frame, or `"mixed"`. */
  readonly mode: string;
  /** Layer pixels per metre. */
  readonly pixelsPerUnit: number;
  /**
   * Picks the topmost sprite under a backing-store pixel.
   *
   * @param xPx - The pixel x.
   * @param yPx - The pixel y.
   * @param options - Which sprites count.
   * @returns The hit, or `null`.
   */
  pickAt(xPx: number, yPx: number, options?: TwoDPickOptionsLike): TwoDPickLike | null;
}

/** What the host reads and writes of a `Camera2D`. */
export interface Camera2DLike extends Component {
  /** The half-height it shows, in metres. */
  orthographicSize: number;
  /** Highest enabled wins. */
  priority: number;
  /** Whether zoom and position snap to whole pixels. */
  pixelPerfect: boolean;
}

/** What the host reads of a `SpriteRenderer`. */
interface SpriteLike extends Component {
  /** The world rectangle of the unrotated quad, as the last frame's sync measured it. */
  readonly bounds: {
    readonly min: { readonly x: number; readonly y: number };
    readonly max: { readonly x: number; readonly y: number };
  };
}

/** What the host reads of a `Tilemap`. */
interface TilemapLike extends Component {
  /** Metres per cell; `0` before the map has loaded. */
  readonly cellSize: number;
  /** How many layers the map has. */
  readonly layerCount: number;
  /**
   * A layer's size, in cells.
   *
   * @param layer - The layer's index.
   * @returns The size.
   */
  layerSize(layer: number): { readonly x: number; readonly y: number };
}

/**
 * The app's 2D service, when the project registers `@ignifx/2d`.
 *
 * @param app - The app.
 * @returns `app.twoD`, or `null`.
 */
export function twoDServiceOf(app: App): TwoDServiceLike | null {
  const service: unknown = Reflect.get(app, "twoD");
  if (typeof service !== "object" || service === null) {
    return null;
  }
  const pickAt: unknown = Reflect.get(service, "pickAt");
  const mode: unknown = Reflect.get(service, "mode");
  const pixelsPerUnit: unknown = Reflect.get(service, "pixelsPerUnit");
  if (typeof pickAt !== "function" || typeof mode !== "string" || typeof pixelsPerUnit !== "number") {
    return null;
  }
  return {
    mode,
    pixelsPerUnit,
    pickAt: (xPx, yPx, options): TwoDPickLike | null => {
      const hit: unknown = Reflect.apply(pickAt, service, [xPx, yPx, options]);
      const entity: unknown = typeof hit === "object" && hit !== null ? Reflect.get(hit, "entity") : null;
      return isEntity(entity) ? { entity } : null;
    },
  };
}

/**
 * Tells whether a value is an entity of some world.
 *
 * @param value - The value.
 * @returns True for an object with a uid, a scene and a transform.
 */
function isEntity(value: unknown): value is Entity {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "uid") === "string" &&
    typeof Reflect.get(value, "transform") === "object"
  );
}

/**
 * Tells whether a component type can be constructed, which `addComponent` needs.
 *
 * @param type - The type.
 * @returns True for a class.
 */
function isConcrete(type: ComponentType): type is ConcreteComponentType {
  return typeof type === "function";
}

/**
 * A registered component class, by type id.
 *
 * @param app - The app.
 * @param typeId - The type id.
 * @returns The class, or `null` when the project does not register it.
 */
export function componentTypeOf(app: App, typeId: string): ConcreteComponentType | null {
  const type = app.world.registry.get(typeId);
  return type !== null && isConcrete(type) ? type : null;
}

/**
 * Tells whether a component is a `Camera2D`.
 *
 * @param component - The component.
 * @returns True when it has the fields the host drives.
 */
export function isCamera2DLike(component: Component | null): component is Camera2DLike {
  return (
    component !== null &&
    typeof Reflect.get(component, "orthographicSize") === "number" &&
    typeof Reflect.get(component, "priority") === "number" &&
    typeof Reflect.get(component, "pixelPerfect") === "boolean"
  );
}

/**
 * Tells whether a component is a `SpriteRenderer`.
 *
 * @param component - The component.
 * @returns True when it reports world bounds.
 */
function isSpriteLike(component: Component): component is SpriteLike {
  const bounds: unknown = Reflect.get(component, "bounds");
  return typeof bounds === "object" && bounds !== null && "min" in bounds && "max" in bounds;
}

/**
 * Tells whether a component is a `Tilemap`.
 *
 * @param component - The component.
 * @returns True when it reports its cell size and layer sizes.
 */
function isTilemapLike(component: Component): component is TilemapLike {
  return (
    typeof Reflect.get(component, "cellSize") === "number" &&
    typeof Reflect.get(component, "layerCount") === "number" &&
    typeof Reflect.get(component, "layerSize") === "function"
  );
}

/**
 * The 2D world rectangle entities cover: each sprite's quad and each tilemap's extent under them,
 * plus every entity's position, so an entity with nothing drawn, or a sprite not yet synced, still
 * counts.
 *
 * @param app - The app whose registry names the 2D classes.
 * @param entities - The entities.
 * @returns The rectangle, or `null` for none.
 */
export function boundsOf2D(app: App, entities: readonly Entity[]): Box2D | null {
  const sprite = componentTypeOf(app, SPRITE_RENDERER_TYPE);
  const tilemap = componentTypeOf(app, TILEMAP_TYPE);
  let box: Box2D | null = null;
  for (const entity of entities) {
    const position = entity.transform.position;
    box = union(box, { minX: position.x, minY: position.y, maxX: position.x, maxY: position.y });
    for (const component of sprite === null ? [] : entity.getComponentsInChildren(sprite, true)) {
      if (isSpriteLike(component)) {
        const { min, max } = component.bounds;
        // An unsynced sprite reports an empty box at the origin; its position already counts.
        if (max.x > min.x && max.y > min.y) {
          box = union(box, { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y });
        }
      }
    }
    for (const component of tilemap === null ? [] : entity.getComponentsInChildren(tilemap, true)) {
      const extent = isTilemapLike(component) ? tilemapBox(component) : null;
      if (extent !== null) {
        box = union(box, extent);
      }
    }
  }
  return box;
}

/**
 * A tilemap's world rectangle: from its entity's origin, its widest and tallest layer in cells.
 *
 * @param map - The tilemap.
 * @returns The rectangle, or `null` before the map has loaded.
 */
function tilemapBox(map: TilemapLike): Box2D | null {
  let columns = 0;
  let rows = 0;
  for (let layer = 0; layer < map.layerCount; layer += 1) {
    const size = map.layerSize(layer);
    columns = Math.max(columns, size.x);
    rows = Math.max(rows, size.y);
  }
  if (map.cellSize <= 0 || columns === 0 || rows === 0) {
    return null;
  }
  const origin = map.entity.transform.position;
  return {
    minX: origin.x,
    minY: origin.y,
    maxX: origin.x + columns * map.cellSize,
    maxY: origin.y + rows * map.cellSize,
  };
}

/**
 * The highest-priority enabled `Camera2D` of a scene instance: the camera the level is played through.
 *
 * @param app - The app.
 * @param scene - The document's scene instance.
 * @returns The camera, or `null`.
 */
export function levelCamera2D(app: App, scene: SceneInstance | null): Camera2DLike | null {
  const type = componentTypeOf(app, CAMERA_2D_TYPE);
  if (type === null || scene === null) {
    return null;
  }
  let best: Camera2DLike | null = null;
  for (const camera of app.world.components(type)) {
    if (isCamera2DLike(camera) && camera.entity.scene === scene && camera.isEnabledInHierarchy) {
      if (best === null || camera.priority > best.priority) {
        best = camera;
      }
    }
  }
  return best;
}

/**
 * The editor camera a scene is made for: 2D when the project draws sprites only
 * (`twoD.mode: "sprite"`, which skips the 3D pass), or when the scene's cameras are all `Camera2D`
 * and it has at least one; 3D otherwise, and always without `@ignifx/2d`.
 *
 * @param app - The app, after the scene opened (a scene file can override `twoD.mode`).
 * @param scene - The document's scene instance.
 * @returns The mode.
 */
export function sceneViewMode(app: App, scene: SceneInstance | null): ViewMode {
  const twoD = twoDServiceOf(app);
  if (twoD === null) {
    return ViewMode.threeD;
  }
  if (twoD.mode === "sprite") {
    return ViewMode.twoD;
  }
  const camera2D = componentTypeOf(app, CAMERA_2D_TYPE);
  const inScene = (component: Component): boolean => component.entity.scene === scene;
  const has2D = camera2D !== null && app.world.components(camera2D).some(inScene);
  const has3D = app.world.components(Camera).some(inScene);
  return has2D && !has3D ? ViewMode.twoD : ViewMode.threeD;
}
