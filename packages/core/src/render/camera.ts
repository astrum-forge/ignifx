import { Component } from "../component/component.js";
import { entityInternals } from "../entity/internals.js";
import {
  cameraAspectRatio,
  createCameraUnderNode,
  readProjectionMatrix,
  readViewMatrix,
  resolveViewportPixels,
  screenToRay as adapterScreenToRay,
  setCameraClipPlanes,
  setCameraOrthographic,
  setCameraOrthographicSize,
  setCameraParent,
  setCameraPerspective,
  setCameraViewport,
  worldToScreen as adapterWorldToScreen,
} from "../lite/camera.js";
import { createPickRay } from "../lite/picking.js";
import { color, enumOf, f32, i32, optional, record } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import type { RendererImpl } from "./renderer.js";
import type { ComponentHooks } from "../component/component.js";
import type { LiteCamera, LiteOrthographicBounds, MutableRay } from "../lite/camera.js";
import type { Mat4 } from "../math/mat4.js";
import type { ColorLike, MutableVec3, Vec3Like } from "../math/types.js";
import type { Schema } from "../schema/types.js";

/**
 * The `Camera` component (`docs/architecture/07-rendering.md` §2.1): the entity that defines the
 * view.
 *
 * ## The entity's transform *is* the view
 *
 * `createFreeCamera(position, target)` builds a camera whose **local** matrix is
 * `lookAtWorldLH(position, target, up)` and whose world matrix is `parentWorld × local`
 * (`src/lite/camera.ts`). The adapter creates it at the local origin looking down local `+Z`,
 * ignifx's forward axis (ADR-0011), and parents it under the entity's node — so the camera has
 * exactly the entity's world transform and the component has no follow logic of its own. Moving the
 * entity moves the view, with no per-frame copy. Cinemachine-style rigs are scripts in `@ignifx/3d`
 * that drive that transform.
 *
 * ## Decisions the documents left open
 *
 * - **`clearColor` is optional, not "default from scene settings".** §2.1's table says the default
 *   comes from the scene settings, which a plain colour field cannot express: every colour has a
 *   value. The field is `optional(color())` instead, so `null` means "leave the scene's clear
 *   colour alone" — whatever the `rendering.clearColor` setting or an `Environment` last put there
 *   — and a value means "this camera owns it while it is the main camera". The main camera is
 *   written every frame, so it is the strongest of the three (`RendererImpl.applyClearColor`).
 * - **`cullingMask` is not declared at all.** §2.1 marks it post-1.0 (Lite has no per-camera mesh
 *   list yet) and §8 repeats it. A field that serialises but does nothing is worse than no field:
 *   it would round-trip through save files and quietly stop mattering when the feature lands.
 *
 * ## Headless
 *
 * The Lite camera is plain data — `createFreeCamera` touches no device — so a headless `Camera`
 * constructs, keeps its state, and answers `getViewMatrix`. What it cannot answer is anything that
 * needs the render target's pixel size: with no canvas the viewport is 1x1, so `screenToRay` and
 * `worldToScreen` degenerate. `07-rendering.md` §6 says tests assert on component state there.
 */

/** The projections a camera can use. */
/**
 * The `as const` name table behind the public union of the same name.
 *
 * @public
 */
export const PROJECTIONS = ["perspective", "orthographic"] as const;

/**
 * The union of the camera projections.
 *
 * @public
 */
export type CameraProjection = (typeof PROJECTIONS)[number];

/** The render-target size a headless camera pretends to have, so no conversion divides by zero. */
const HEADLESS_TARGET_SIZE = 1;

/**
 * A world-space ray, as `Camera.screenToRay` produces and `world.raycastRender` consumes
 * (`docs/architecture/07-rendering.md` §3).
 *
 * @remarks
 * Both vectors are written in place, so a picking loop reuses one ray and allocates nothing
 * (coding standards §7).
 *
 * @public
 */
export interface Ray {
  /** Where the ray starts, in world space. */
  readonly origin: RayVector;
  /** The unit direction it travels in. */
  readonly direction: RayVector;
  /** How far it reaches, in metres. */
  length: number;
}

/**
 * A writable `{ x, y, z }` a ray's origin and direction are stated in.
 *
 * @remarks
 * Deliberately the minimal shape rather than the math module's `MutableVec3`: the engine's `Vec3`,
 * a plain object literal, and a live view over a Lite node all satisfy it, so nothing has to be
 * converted to build or read a ray.
 *
 * @public
 */
export interface RayVector {
  /** The x component. */
  x: number;
  /** The y component. */
  y: number;
  /** The z component. */
  z: number;
}

/**
 * Creates a reusable ray at the origin pointing along `+Z`.
 *
 * @returns A fresh ray. **Allocates** — make one per call site, not per frame.
 *
 * @example
 * ```ts
 * const ray = createRay();
 * camera.screenToRay(event.offsetX, event.offsetY, ray);
 * ```
 *
 * @public
 */
export function createRay(): Ray {
  return { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, length: Number.MAX_VALUE };
}

/**
 * The camera an entity renders the world through (`docs/architecture/07-rendering.md` §2.1).
 *
 * @remarks
 * A world renders through the enabled camera with the highest `priority`; ties break on creation
 * order. A world with no enabled camera draws nothing and logs `IGX-0706` once.
 *
 * @example
 * ```ts
 * const eye = world.createEntity("Main Camera", { position: { x: 0, y: 2, z: -6 } });
 * eye.addComponent(Camera, { fov: 50, near: 0.05 });
 * ```
 *
 * @public
 */
export class Camera extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/Camera";

  /** At most one camera per entity: two views from one transform would be the same view. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = cameraSchema();

  declare projection: CameraProjection;

  declare fov: number;

  declare orthographicSize: number;

  declare near: number;

  declare far: number;

  declare viewport: { x: number; y: number; width: number; height: number };

  declare clearColor: ColorLike | null;

  declare priority: number;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Camera.schema));
  }

  readonly #ray: MutableRay = createPickRay();

  readonly #targetSize = { width: HEADLESS_TARGET_SIZE, height: HEADLESS_TARGET_SIZE };

  #camera: LiteCamera | null = null;

  #ortho: LiteOrthographicBounds | null = null;

  #appliedProjection: CameraProjection | null = null;

  #appliedFov = Number.NaN;

  #appliedOrthographicSize = Number.NaN;

  #appliedNear = Number.NaN;

  #appliedFar = Number.NaN;

  #appliedViewportX = Number.NaN;

  #appliedViewportY = Number.NaN;

  #appliedViewportWidth = Number.NaN;

  #appliedViewportHeight = Number.NaN;

  /**
   * The Babylon Lite camera this component owns. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The camera, or `null` before the component is attached.
   */
  get lite(): { readonly camera: LiteCamera | null } {
    return { camera: this.#camera };
  }

  /** Creates the Lite camera and parents it under the entity's node. */
  onAttach(): void {
    this.#camera = createCameraUnderNode(entityInternals(this.entity).node);
    this.#apply();
  }

  /**
   * Drops the Lite camera.
   *
   * @remarks
   * A Lite camera holds no GPU resource and is never added to the scene — only assigned to
   * `scene.camera` — so breaking the parent link and forgetting it is the whole teardown. The
   * `PreRender` system re-picks the main camera on the next frame and clears `scene.camera` when
   * this was the last one.
   */
  onDetach(): void {
    const camera = this.#camera;
    this.#camera = null;
    this.#ortho = null;
    if (camera !== null) {
      setCameraParent(camera, null);
    }
  }

  /**
   * Builds a world-space ray through a point on the canvas.
   *
   * @remarks
   * Coordinates are backing-store pixels — the canvas's `width`/`height`, the space
   * {@link Camera.worldToScreen} answers in and `@ignifx/input` reports `<Pointer>/position` in — not
   * CSS pixels; multiply a DOM event's `offsetX`/`offsetY` by `devicePixelRatio` first.
   *
   * @param x - The backing-store pixel x, from the canvas's left edge.
   * @param y - The backing-store pixel y, from the canvas's top edge.
   * @param out - The ray to fill; a fresh one is allocated when omitted.
   * @returns `out`, or `null` when the view-projection matrix is singular — a zero-sized viewport,
   * or a camera that is not attached.
   *
   * @example
   * ```ts
   * const ray = camera.screenToRay(event.offsetX, event.offsetY);
   * const hit = ray === null ? null : world.raycastRender(ray);
   * ```
   */
  screenToRay(x: number, y: number, out: Ray = createRay()): Ray | null {
    const camera = this.#camera;
    if (camera === null) {
      return null;
    }
    const viewport = resolveViewportPixels(camera, this.#width(), this.#height());
    const filled = adapterScreenToRay(
      camera,
      x - viewport.x,
      y - viewport.y,
      viewport.width,
      viewport.height,
      this.#ray,
    );
    if (filled === null) {
      return null;
    }
    writeVec3(out.origin, filled.origin);
    writeVec3(out.direction, filled.direction);
    out.length = filled.length;
    return out;
  }

  /**
   * Projects a world-space point onto the canvas.
   *
   * @param point - The world-space point.
   * @param out - Receives the pixel position in `x`/`y` — measured from the viewport's top left —
   * and the clip depth in `z`, which is `1` at the near plane and `0` at the far plane because
   * Lite's projection is reverse-depth.
   * @returns `true` when the point is in front of the camera; `false` when it is behind it, in which
   * case `out` holds a mirrored projection and should be ignored.
   */
  worldToScreen(point: Vec3Like, out: MutableVec3): boolean {
    const camera = this.#camera;
    if (camera === null) {
      return false;
    }
    const viewport = resolveViewportPixels(camera, this.#width(), this.#height());
    const inFront = adapterWorldToScreen(camera, point, viewport.width, viewport.height, out);
    out.x += viewport.x;
    out.y += viewport.y;
    return inFront;
  }

  /**
   * The world-space point a canvas pixel maps to at a given distance along the view ray.
   *
   * @param x - The backing-store pixel x, from the canvas's left edge (see {@link Camera.screenToRay}).
   * @param y - The backing-store pixel y, from the canvas's top edge.
   * @param distance - How far along the ray to travel, in metres.
   * @param out - Receives the point.
   * @returns `out`, or `null` when no ray could be built.
   */
  screenToWorldPoint(x: number, y: number, distance: number, out: MutableVec3): MutableVec3 | null {
    const ray = this.screenToRay(x, y, rayScratch());
    if (ray === null) {
      return null;
    }
    out.x = ray.origin.x + ray.direction.x * distance;
    out.y = ray.origin.y + ray.direction.y * distance;
    out.z = ray.origin.z + ray.direction.z * distance;
    return out;
  }

  /**
   * The world-space point a **normalized** viewport coordinate maps to.
   *
   * @param u - The horizontal coordinate, `0` at the viewport's left edge and `1` at its right.
   * @param v - The vertical coordinate, `0` at the **bottom** edge and `1` at the top, matching
   * Babylon's viewport convention.
   * @param distance - How far along the ray to travel, in metres.
   * @param out - Receives the point.
   * @returns `out`, or `null` when no ray could be built.
   */
  viewportToWorldPoint(u: number, v: number, distance: number, out: MutableVec3): MutableVec3 | null {
    const camera = this.#camera;
    if (camera === null) {
      return null;
    }
    const viewport = resolveViewportPixels(camera, this.#width(), this.#height());
    return this.screenToWorldPoint(
      viewport.x + u * viewport.width,
      viewport.y + (1 - v) * viewport.height,
      distance,
      out,
    );
  }

  /**
   * Copies the camera's projection matrix into `out`.
   *
   * @param out - A 4x4 matrix that receives the result, column-major.
   * @returns `out`, for chaining.
   */
  getProjectionMatrix(out: Mat4): Mat4 {
    const camera = this.#camera;
    if (camera !== null) {
      readProjectionMatrix(camera, cameraAspectRatio(camera, this.#width(), this.#height()), out.elements);
    }
    return out;
  }

  /**
   * Copies the camera's view matrix — the inverse of its world matrix — into `out`.
   *
   * @param out - A 4x4 matrix that receives the result, column-major.
   * @returns `out`, for chaining.
   */
  getViewMatrix(out: Mat4): Mat4 {
    const camera = this.#camera;
    if (camera !== null) {
      readViewMatrix(camera, out.elements);
    }
    return out;
  }

  /**
   * Writes every field that changed since the last frame onto the Lite camera, and refreshes the
   * render-target size the screen conversions divide by. The `PreRender` system calls it.
   *
   * @param renderer - The rendering service, for the surface size.
   *
   * @internal
   */
  sync(renderer: RendererImpl): void {
    renderer.readTargetSize(this.#targetSize);
    this.#apply();
  }

  /** Writes every field whose value differs from the one last applied. */
  #apply(): void {
    const camera = this.#camera;
    if (camera === null) {
      return;
    }
    const projection: CameraProjection = this.projection;
    if (projection === "orthographic") {
      const bounds = this.#ortho;
      if (this.#appliedProjection !== projection || bounds === null) {
        this.#ortho = setCameraOrthographic(camera, this.orthographicSize);
        this.#appliedOrthographicSize = this.orthographicSize;
      } else if (this.#appliedOrthographicSize !== this.orthographicSize) {
        // Mutating the live bounds rather than calling `enableOrthographicCamera` again keeps the
        // object identity Lite caches against, so a zoom animation allocates nothing.
        setCameraOrthographicSize(bounds, this.orthographicSize);
        this.#appliedOrthographicSize = this.orthographicSize;
      }
    } else if (this.#appliedProjection !== projection || this.#appliedFov !== this.fov) {
      setCameraPerspective(camera, this.fov);
      this.#ortho = null;
      this.#appliedFov = this.fov;
    }
    this.#appliedProjection = projection;
    if (this.#appliedNear !== this.near || this.#appliedFar !== this.far) {
      setCameraClipPlanes(camera, this.near, this.far);
      this.#appliedNear = this.near;
      this.#appliedFar = this.far;
    }
    const viewport = this.viewport;
    if (
      this.#appliedViewportX !== viewport.x ||
      this.#appliedViewportY !== viewport.y ||
      this.#appliedViewportWidth !== viewport.width ||
      this.#appliedViewportHeight !== viewport.height
    ) {
      setCameraViewport(camera, viewport.x, viewport.y, viewport.width, viewport.height);
      this.#appliedViewportX = viewport.x;
      this.#appliedViewportY = viewport.y;
      this.#appliedViewportWidth = viewport.width;
      this.#appliedViewportHeight = viewport.height;
    }
  }

  /**
   * The render target's width in pixels.
   *
   * @returns The width; `1` before the first sync, and under a headless app.
   */
  #width(): number {
    return this.#targetSize.width;
  }

  /**
   * The render target's height in pixels.
   *
   * @returns The height; `1` before the first sync, and under a headless app.
   */
  #height(): number {
    return this.#targetSize.height;
  }
}

/** One reusable ray per module, for the conversions that build one and throw it away. */
let scratchRay: Ray | null = null;

/**
 * The module's scratch ray, created on first use (coding standards §4 — no allocation at module
 * scope, none per call).
 *
 * @returns The shared ray.
 */
function rayScratch(): Ray {
  return (scratchRay ??= createRay());
}

/**
 * Copies a Lite three-element tuple into an ignifx vector.
 *
 * @param out - The vector to fill.
 * @param source - Lite's tuple.
 */
function writeVec3(out: RayVector, source: readonly [number, number, number]): void {
  out.x = source[0];
  out.y = source[1];
  out.z = source[2];
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema. Built inside a function, not at module scope: a schema field is a function
 * call, and module scope holds declarations and immutable constants only
 * (`CONSTITUTION.md` §3.5, coding standards §4).
 */
function cameraSchema(): Schema {
  return defineSchema({
    projection: enumOf(PROJECTIONS, "perspective", { tooltip: "Perspective, or a flat orthographic view." }),
    fov: f32(60, { min: 1, max: 179, tooltip: "Vertical field of view, in degrees." }),
    orthographicSize: f32(5, { min: 0.0001, tooltip: "Half the visible height, in metres." }),
    near: f32(0.1, { min: 0.0001, tooltip: "Near clip plane, in metres." }),
    far: f32(1000, { min: 0.0002, tooltip: "Far clip plane, in metres." }),
    viewport: record(
      {
        x: f32(0, { min: 0, max: 1 }),
        y: f32(0, { min: 0, max: 1 }),
        width: f32(1, { min: 0, max: 1 }),
        height: f32(1, { min: 0, max: 1 }),
      },
      { tooltip: "Normalized viewport; y is measured from the bottom." },
    ),
    clearColor: optional(color("#000000"), { tooltip: "Overrides the scene clear colour while this camera renders." }),
    priority: i32(0, { tooltip: "The enabled camera with the highest priority renders." }),
  });
}
