import {
  createFreeCamera,
  disableOrthographicCamera,
  enableOrthographicCamera,
  getEffectiveAspectRatio,
  getProjectionMatrix,
  getViewMatrix,
  getViewProjectionMatrix,
  resolveCameraViewport,
  type Camera,
  type FreeCamera,
  type OrthographicBounds,
  type PixelViewport,
  type Ray,
  type SceneContext,
  type SceneNode,
} from "@babylonjs/lite";
import { Mat4 } from "../math/mat4.js";
import { degToRad } from "../math/math-utils.js";
import type { MutableMat4Like, MutableVec3Like } from "./node.js";
import type { Vec3Like } from "../math/types.js";

/**
 * Camera half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §2.1). It owns the
 * Lite `FreeCamera` a `Camera` component wraps: projection, clip planes, viewport, and the
 * screen/world conversions the component exposes as methods.
 *
 * Everything here is `@internal`; the `Camera` component is the public surface.
 *
 * ## What Lite does with a camera (verified against `@babylonjs/lite@1.27.0`)
 *
 * - `createFreeCamera(position, target)` (`index.d.ts` 2535, `lib/camera/free-camera.js`) builds a
 *   camera whose **local** matrix is `lookAtWorldLH(position, target, up)` and whose world matrix
 *   is `parentWorld × local`. So a camera created at the origin looking down `+Z` and parented to
 *   an entity node has exactly the entity's world transform — that is what makes spike S2.1 work
 *   and why the adapter never writes `camera.position` for a parented camera.
 * - `getViewMatrix(camera)` (`index.d.ts` 6013, `lib/camera/camera.js`) is the *inverse* of the
 *   world matrix, built by transposing the rotation block and negating the translation, cached
 *   against `worldMatrixVersion`. It therefore follows the parent automatically.
 * - `getProjectionMatrix(camera, aspectRatio)` (`index.d.ts` 5955) is a **reverse-depth**
 *   left-handed projection (near maps to clip depth 1, far to 0) and switches to the orthographic
 *   projector whenever `camera.ortho` is set.
 * - `resolveCameraViewport(camera, w, h)` (`index.d.ts` 9941, `lib/camera/viewport.js`) converts a
 *   Babylon-style normalized viewport, whose `y` is measured **from the bottom**, into integer
 *   render-target pixels whose `y` is measured **from the top**: `y0 = clamp01(1 - y - height)`.
 *
 * ## Units
 *
 * Lite stores the vertical field of view and the spot-cone angle in radians; ignifx public API is
 * in degrees (coding standards §5.1). The conversion happens here, at the boundary, and nowhere
 * else.
 */

/**
 * The Babylon Lite camera an ignifx `Camera` component owns, re-exported under an ignifx name so
 * feature code can name the type without importing `@babylonjs/lite` (`CONSTITUTION.md` §3.4,
 * coding standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteCamera = FreeCamera;

/**
 * The live orthographic bounds `enableOrthographicCamera` returns, re-exported under an ignifx name.
 *
 * @internal
 */
export type LiteOrthographicBounds = OrthographicBounds;

/**
 * A ray whose `origin` and `direction` are written in place. Lite's `Ray` uses three-element
 * tuples, which are mutable, so {@link screenToRay} can fill a caller-owned ray without allocating
 * (coding standards §7).
 *
 * @internal
 */
export type MutableRay = Ray;

/** Scratch inverse view-projection matrix, created on first use (coding standards §4). */
let inverseViewProjection: Mat4 | null = null;

/**
 * Creates the Lite camera an ignifx `Camera` component owns and parents it under the entity's
 * transform node.
 *
 * @remarks
 * The camera is created at the local origin looking down local `+Z`, ignifx's forward axis
 * (ADR-0011). Its own position and target are never touched again: the entity's node supplies the
 * transform, so the component has no follow logic (`docs/architecture/07-rendering.md` §2.1).
 *
 * @param parent - The entity's transform node, or `null` for a camera in world space.
 * @returns The camera. It is not attached to any scene; call {@link setSceneCamera} for that.
 *
 * @example
 * ```ts
 * const camera = createCameraUnderNode(entityNode);
 * setCameraPerspective(camera, 60);
 * setSceneCamera(scene, camera);
 * ```
 *
 * @internal
 */
export function createCameraUnderNode(parent: SceneNode | null): FreeCamera {
  const camera = createFreeCamera({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  camera.parent = parent;
  return camera;
}

/**
 * Re-parents a camera, keeping its local position and target — the entity's node defines the view.
 *
 * @remarks
 * Unlike `linkParent` in `./node.ts` this does not maintain the parent's `children` array. Lite
 * types `SceneNode.children` as `SceneNode[]` and a camera is not a scene node; nothing in Lite
 * walks an ignifx transform node's children either, because ignifx transform nodes are never added
 * to a scene (`docs/architecture/02-scene-graph.md` §5.1). The `parent` link alone is what
 * `worldMatrix` reads.
 *
 * @param camera - The camera to move.
 * @param parent - The new parent node, or `null` to detach the camera to world space.
 *
 * @internal
 */
export function setCameraParent(camera: FreeCamera, parent: SceneNode | null): void {
  camera.parent = parent;
}

/**
 * Switches a camera to a perspective projection with the given vertical field of view.
 *
 * @param camera - The camera to configure.
 * @param fovDegrees - The vertical field of view, in degrees.
 *
 * @internal
 */
export function setCameraPerspective(camera: Camera, fovDegrees: number): void {
  camera.fov = degToRad(fovDegrees);
  if (camera.ortho !== null && camera.ortho !== undefined) {
    disableOrthographicCamera(camera);
  }
}

/**
 * Switches a camera to an orthographic projection of the given half-height.
 *
 * @remarks
 * Only `halfHeight` is set; the four clip planes are left `null` so Lite derives them from the
 * half-height and the render target's aspect ratio (`OrthographicBounds`, `index.d.ts` 7803),
 * which is the behaviour `Camera.orthographicSize` promises. Calling this twice replaces the
 * bounds object, so the adapter keeps the returned handle and mutates it through
 * {@link setCameraOrthographicSize} instead.
 *
 * @param camera - The camera to configure.
 * @param halfHeight - Half of the visible height, in metres.
 * @returns The live bounds object; assigning to its fields takes effect on the next frame.
 *
 * @internal
 */
export function setCameraOrthographic(camera: Camera, halfHeight: number): OrthographicBounds {
  const existing = camera.ortho;
  if (existing !== null && existing !== undefined) {
    existing.halfHeight = halfHeight;
    return existing;
  }
  return enableOrthographicCamera(camera, { halfHeight });
}

/**
 * Changes the half-height of an orthographic camera. Halving it doubles the zoom.
 *
 * @param bounds - The bounds {@link setCameraOrthographic} returned.
 * @param halfHeight - The new half-height, in metres.
 *
 * @internal
 */
export function setCameraOrthographicSize(bounds: OrthographicBounds, halfHeight: number): void {
  bounds.halfHeight = halfHeight;
}

/**
 * Sets the near and far clip planes.
 *
 * @param camera - The camera to configure.
 * @param near - The near plane distance, in metres.
 * @param far - The far plane distance, in metres.
 *
 * @internal
 */
export function setCameraClipPlanes(camera: Camera, near: number, far: number): void {
  camera.nearPlane = near;
  camera.farPlane = far;
}

/**
 * Sets the camera's normalized viewport, in Babylon's convention: the origin is the **bottom** left
 * of the render target.
 *
 * @remarks
 * The viewport object is reused when one is already installed, so a per-frame viewport animation
 * allocates nothing (coding standards §7).
 *
 * @param camera - The camera to configure.
 * @param x - The left edge, 0 to 1.
 * @param y - The bottom edge, 0 to 1.
 * @param width - The width, 0 to 1.
 * @param height - The height, 0 to 1.
 *
 * @internal
 */
export function setCameraViewport(camera: Camera, x: number, y: number, width: number, height: number): void {
  const existing = camera.viewport;
  if (existing === undefined) {
    camera.viewport = { x, y, width, height };
    return;
  }
  existing.x = x;
  existing.y = y;
  existing.width = width;
  existing.height = height;
}

/**
 * Restores the camera's viewport to the full render target.
 *
 * @param camera - The camera to configure.
 *
 * @internal
 */
export function resetCameraViewport(camera: Camera): void {
  setCameraViewport(camera, 0, 0, 1, 1);
}

/**
 * Resolves a camera's normalized viewport to integer render-target pixels.
 *
 * @remarks
 * Lite flips the y axis here: the normalized viewport measures `y` from the bottom (Babylon), the
 * pixel viewport measures it from the top (WebGPU). Verified in `lib/camera/viewport.js`, which
 * computes `y = floor(clamp01(1 - v.y - v.height) * targetHeight)`.
 *
 * @param camera - The camera, or `null` for the full target.
 * @param targetWidth - The render target width, in pixels.
 * @param targetHeight - The render target height, in pixels.
 * @returns A fresh pixel viewport. **Allocates** — Lite builds the object; do not call per frame.
 *
 * @internal
 */
export function resolveViewportPixels(camera: Camera | null, targetWidth: number, targetHeight: number): PixelViewport {
  return resolveCameraViewport(camera, targetWidth, targetHeight);
}

/**
 * The aspect ratio Lite projects with: the render target's ratio scaled by the camera's viewport.
 *
 * @param camera - The camera, or `null` for an unrestricted viewport.
 * @param targetWidth - The render target width, in pixels.
 * @param targetHeight - The render target height, in pixels.
 * @returns Width divided by height.
 *
 * @internal
 */
export function cameraAspectRatio(camera: Camera | null, targetWidth: number, targetHeight: number): number {
  return getEffectiveAspectRatio(camera, targetWidth, targetHeight);
}

/**
 * Copies the camera's view matrix (the inverse of its world matrix) into `out`.
 *
 * @param camera - The camera to read.
 * @param out - A sink of at least 16 elements, written column-major.
 * @returns `out`, for chaining.
 *
 * @internal
 */
export function readViewMatrix(camera: Camera, out: MutableMat4Like): MutableMat4Like {
  return copyMatrix(getViewMatrix(camera), out);
}

/**
 * Copies the camera's projection matrix into `out`.
 *
 * @param camera - The camera to read.
 * @param aspectRatio - Width divided by height, from {@link cameraAspectRatio}.
 * @param out - A sink of at least 16 elements, written column-major.
 * @returns `out`, for chaining.
 *
 * @internal
 */
export function readProjectionMatrix(camera: Camera, aspectRatio: number, out: MutableMat4Like): MutableMat4Like {
  return copyMatrix(getProjectionMatrix(camera, aspectRatio), out);
}

/**
 * Copies the camera's combined view-projection matrix into `out`.
 *
 * @param camera - The camera to read.
 * @param aspectRatio - Width divided by height, from {@link cameraAspectRatio}.
 * @param out - A sink of at least 16 elements, written column-major.
 * @returns `out`, for chaining.
 *
 * @internal
 */
export function readViewProjectionMatrix(camera: Camera, aspectRatio: number, out: MutableMat4Like): MutableMat4Like {
  return copyMatrix(getViewProjectionMatrix(camera, aspectRatio), out);
}

/**
 * Makes a camera the one a scene renders through, or clears it.
 *
 * @remarks
 * Lite renders through exactly one camera per scene (`SceneContext.camera`, `index.d.ts` 10072);
 * a scene with no camera draws nothing. Choosing between several enabled ignifx cameras by
 * `priority` is the component layer's job.
 *
 * @param scene - The render scene.
 * @param camera - The camera to render through, or `null` for none.
 *
 * @internal
 */
export function setSceneCamera(scene: SceneContext, camera: Camera | null): void {
  scene.camera = camera;
}

/**
 * Builds a world-space ray through a point on the render target.
 *
 * @remarks
 * This reproduces Lite's own `createPickingRay` (`lib/picking/ray.js`), which is not exported from
 * the package, and the coordinate handling of `pickAsync` (`lib/picking/gpu-picker.js` lines
 * 176–193): the pixel is made relative to the camera's **pixel** viewport, the projection uses that
 * viewport's aspect ratio, and the normalized device coordinates are
 * `(2x/w - 1, 1 - 2y/h)`. Because the projection is reverse-depth, clip depth `1` unprojects to the
 * near plane and `0` to the far plane.
 *
 * The ray is written into `out`, so a picking loop allocates nothing.
 *
 * @param camera - The camera to look through.
 * @param x - The pixel x inside the viewport, measured from its left edge.
 * @param y - The pixel y inside the viewport, measured from its top edge.
 * @param viewportWidth - The viewport width, in pixels.
 * @param viewportHeight - The viewport height, in pixels.
 * @param out - The ray to fill.
 * @returns `out` when the ray could be built, or `null` when the view-projection matrix is
 * singular (a zero-sized viewport, or a degenerate projection).
 *
 * @example
 * ```ts
 * const ray: MutableRay = { origin: [0, 0, 0], direction: [0, 0, 1], length: 1 };
 * const viewport = resolveViewportPixels(camera, canvas.width, canvas.height);
 * screenToRay(camera, px - viewport.x, py - viewport.y, viewport.width, viewport.height, ray);
 * ```
 *
 * @internal
 */
export function screenToRay(
  camera: Camera,
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  out: MutableRay,
): MutableRay | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }
  const inverse = (inverseViewProjection ??= new Mat4());
  const viewProjection = getViewProjectionMatrix(camera, viewportWidth / viewportHeight);
  if (!Mat4.invertToRef(viewProjection, inverse)) {
    return null;
  }
  const ndcX = (2 * x) / viewportWidth - 1;
  const ndcY = 1 - (2 * y) / viewportHeight;
  const origin = out.origin;
  const direction = out.direction;
  unproject(inverse, ndcX, ndcY, 1, origin);
  unproject(inverse, ndcX, ndcY, 0, direction);
  const dx = direction[0] - origin[0];
  const dy = direction[1] - origin[1];
  const dz = direction[2] - origin[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(length > 0)) {
    return null;
  }
  const inverseLength = 1 / length;
  direction[0] = dx * inverseLength;
  direction[1] = dy * inverseLength;
  direction[2] = dz * inverseLength;
  out.length = length;
  return out;
}

/**
 * Projects a world-space point onto the render target.
 *
 * @remarks
 * `out.x`/`out.y` are pixels inside the camera's viewport, measured from its **top** left, matching
 * {@link screenToRay}'s input; `out.z` is the clip-space depth, which is `1` at the near plane and
 * `0` at the far plane because Lite's projection is reverse-depth.
 *
 * @param camera - The camera to look through.
 * @param point - The world-space point.
 * @param viewportWidth - The viewport width, in pixels.
 * @param viewportHeight - The viewport height, in pixels.
 * @param out - Receives the pixel position and the clip depth.
 * @returns `true` when the point is in front of the camera; `false` when it is behind it, in which
 * case `out` holds the mirrored projection and should be ignored.
 *
 * @internal
 */
export function worldToScreen(
  camera: Camera,
  point: Vec3Like,
  viewportWidth: number,
  viewportHeight: number,
  out: MutableVec3Like,
): boolean {
  const viewProjection = getViewProjectionMatrix(camera, viewportWidth / viewportHeight);
  const x = point.x;
  const y = point.y;
  const z = point.z;
  const clipX =
    element(viewProjection, 0) * x +
    element(viewProjection, 4) * y +
    element(viewProjection, 8) * z +
    element(viewProjection, 12);
  const clipY =
    element(viewProjection, 1) * x +
    element(viewProjection, 5) * y +
    element(viewProjection, 9) * z +
    element(viewProjection, 13);
  const clipZ =
    element(viewProjection, 2) * x +
    element(viewProjection, 6) * y +
    element(viewProjection, 10) * z +
    element(viewProjection, 14);
  const clipW =
    element(viewProjection, 3) * x +
    element(viewProjection, 7) * y +
    element(viewProjection, 11) * z +
    element(viewProjection, 15);
  if (clipW === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return false;
  }
  const inverseW = 1 / clipW;
  out.x = (clipX * inverseW + 1) * 0.5 * viewportWidth;
  out.y = (1 - clipY * inverseW) * 0.5 * viewportHeight;
  out.z = clipZ * inverseW;
  return clipW > 0;
}

/**
 * Reads one element of a matrix-like value.
 *
 * @remarks
 * `noUncheckedIndexedAccess` widens every index read to `number | undefined`, and a matrix has no
 * holes, so the fallback is unreachable. Funnelling every read through one function keeps that
 * single dead branch in one place instead of scattering thirty of them through the hot paths.
 *
 * @param matrix - The matrix to read.
 * @param index - The column-major element index, 0 to 15.
 * @returns The element.
 */
function element(matrix: { readonly [index: number]: number }, index: number): number {
  return matrix[index] ?? 0;
}

/**
 * Unprojects one normalized device coordinate through an inverse view-projection matrix.
 *
 * @param inverse - The inverted view-projection matrix.
 * @param ndcX - The device x, -1 to 1.
 * @param ndcY - The device y, -1 to 1.
 * @param depth - The clip depth: `1` for the near plane, `0` for the far plane.
 * @param out - Receives the world-space point.
 */
function unproject(inverse: Mat4, ndcX: number, ndcY: number, depth: number, out: [number, number, number]): void {
  const e = inverse.elements;
  const x = element(e, 0) * ndcX + element(e, 4) * ndcY + element(e, 8) * depth + element(e, 12);
  const y = element(e, 1) * ndcX + element(e, 5) * ndcY + element(e, 9) * depth + element(e, 13);
  const z = element(e, 2) * ndcX + element(e, 6) * ndcY + element(e, 10) * depth + element(e, 14);
  const w = element(e, 3) * ndcX + element(e, 7) * ndcY + element(e, 11) * depth + element(e, 15);
  const inverseW = w === 0 ? 0 : 1 / w;
  out[0] = x * inverseW;
  out[1] = y * inverseW;
  out[2] = z * inverseW;
}

/**
 * Copies 16 matrix elements into an output sink.
 *
 * @param source - The matrix to read.
 * @param out - The sink to write.
 * @returns `out`.
 */
function copyMatrix(source: { readonly [index: number]: number }, out: MutableMat4Like): MutableMat4Like {
  for (let i = 0; i < 16; i++) {
    out[i] = element(source, i);
  }
  return out;
}
