/**
 * Where the scene view's grid draws each frame (engine ask E31): plain arithmetic over the editor
 * cameras' state, so it runs and is tested without a GPU. `../lite/grid.ts` draws the result.
 */

import type { View2D } from "./view-2d.js";

/** The grid's spacing until `setGrid` changes it, in metres. */
export const DEFAULT_GRID_SIZE = 1;

/** Every how many minor lines a major line falls. */
const MAJOR_EVERY = 10;

/** The 3D grid's spacing grows tenfold for each tenfold of eye height above this many minor lines. */
const GROUND_LINES_PER_HEIGHT = 25;

/** The 3D grid reaches this many eye heights from the eye before it has faded out. */
const GROUND_REACH_PER_HEIGHT = 40;

/** The 3D grid reaches at least this many lines from the eye. */
const GROUND_MIN_REACH_LINES = 100;

/** The 2D grid's lines are never closer than this, in screen pixels; denser ones step up tenfold. */
const MIN_LINE_GAP_PX = 8;

/** From this zoom (screen pixels per layer pixel) the 2D grid draws every layer pixel. */
export const PIXEL_GRID_ZOOM = 8;

/** A world point, in metres. */
interface Point3 {
  /** Across. */
  readonly x: number;
  /** Up. */
  readonly y: number;
  /** Along. */
  readonly z: number;
}

/** One frame's grid. */
export interface GridPlacement {
  /** `"ground"`: the `y = 0` plane of the 3D view. `"screen"`: the `z = 0` plane, over the 2D view. */
  readonly plane: "ground" | "screen";
  /** The centre's world x, in metres. */
  readonly centerX: number;
  /** The centre's other coordinate, in metres: world z on the ground, world y on the screen plane. */
  readonly centerY: number;
  /** The side of the square the grid covers, in metres. */
  readonly extent: number;
  /** The spacing of the minor lines, in metres. */
  readonly step: number;
  /** Every how many minor lines a major line falls. */
  readonly majorEvery: number;
}

/**
 * The 3D view's ground grid: centred under the eye, coarser the higher the eye is, and large enough
 * that it fades out before its edge is in view.
 *
 * @param eye - The editor camera's position, in metres.
 * @param size - The spacing `setGrid` asked for, in metres.
 * @param far - The camera's far plane, in metres; the grid stays inside it.
 * @returns The placement.
 */
export function groundGridPlacement(eye: Point3, size: number, far: number): GridPlacement {
  const height = Math.max(Math.abs(eye.y), size);
  const decades = Math.max(0, Math.floor(Math.log10(height / (size * GROUND_LINES_PER_HEIGHT))));
  const step = size * 10 ** decades;
  const reach = Math.min(Math.max(height * GROUND_REACH_PER_HEIGHT, step * GROUND_MIN_REACH_LINES), far * 0.9);
  return { plane: "ground", centerX: eye.x, centerY: eye.z, extent: reach * 2, step, majorEvery: MAJOR_EVERY };
}

/**
 * The 2D view's grid: lines `size` apart (tenfold coarser while they would be closer than a few
 * screen pixels), or one line per layer pixel from {@link PIXEL_GRID_ZOOM} on, with a major line
 * every `size`. It covers the whole view.
 *
 * @param view - What the 2D editor camera shows.
 * @param size - The spacing `setGrid` asked for, in metres.
 * @returns The placement.
 */
export function screenGridPlacement(view: View2D, size: number): GridPlacement {
  const pixelsPerMetre = Math.max(view.zoom * view.pixelsPerUnit, Number.MIN_VALUE);
  const extent = (2 * Math.max(view.widthPx, view.heightPx)) / pixelsPerMetre;
  const base = { plane: "screen", centerX: view.centerX, centerY: view.centerY, extent } as const;
  if (view.zoom >= PIXEL_GRID_ZOOM && view.pixelsPerUnit > 0) {
    const step = 1 / view.pixelsPerUnit;
    return { ...base, step, majorEvery: Math.max(1, Math.round(size / step)) };
  }
  let step = size;
  while (step * pixelsPerMetre < MIN_LINE_GAP_PX) {
    step *= MAJOR_EVERY;
  }
  return { ...base, step, majorEvery: MAJOR_EVERY };
}
