import { EDITOR_ONLY_METADATA_KEY } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { drawnMeshes } from "../src/lite/drawn-meshes.js";
import { isPickRectParams, isPickRectResult, PICK_RECT_MAX_ENTITIES } from "../src/protocol/index.js";
import { projectBox, projectBox2D, rectInBackingPixels, rectMatches, unionProjected } from "../src/scene/rect-pick.js";
import { screenToWorld2D } from "../src/scene/view-2d.js";
import type { AppLiteHandles } from "@ignifx/core";

/**
 * `pickRect`'s arithmetic without a device: the rectangle's unit rule, the projection of a box's
 * corners through a camera's matrices, and the two match modes. `scene-view.browser.test.ts` and
 * `scene-view-2d.browser.test.ts` pick real scenes.
 */

/** The identity, column-major: a camera at the origin looking along +Z, +Y up (Babylon's left hand). */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A 90° perspective at aspect 1: x and y over z, `w = z`. */
const PERSPECTIVE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0.1, 0];

/** The view's size in backing pixels. */
const SIDE = 200;

/**
 * A unit cube around a point.
 *
 * @param x - The centre's x.
 * @param y - The centre's y.
 * @param z - The centre's z.
 * @returns The box.
 */
function cube(x: number, y: number, z: number): { min: number[]; max: number[] } {
  return { min: [x - 0.5, y - 0.5, z - 0.5], max: [x + 0.5, y + 0.5, z + 0.5] };
}

describe("pickRect's guards", () => {
  it("check the parameters", () => {
    expect(isPickRectParams({ x0: 0, y0: 0, x1: 10, y1: 10, unit: "css" })).toBe(true);
    expect(isPickRectParams({ x0: 10, y0: 10, x1: 0, y1: 0, unit: "backing", mode: "contain" })).toBe(true);
    expect(isPickRectParams({ x0: 0, y0: 0, x1: 10, y1: 10, unit: "css", mode: "touch" })).toBe(false);
    expect(isPickRectParams({ x0: 0, y0: 0, x1: 10, unit: "css" })).toBe(false);
    expect(isPickRectParams({ x0: 0, y0: 0, x1: Number.NaN, y1: 1, unit: "css" })).toBe(false);
    expect(isPickRectParams({ x0: 0, y0: 0, x1: 1, y1: 1 })).toBe(false);
  });

  it("check the answer and its cap", () => {
    expect(isPickRectResult({ entities: ["A", "B"], truncated: false })).toBe(true);
    expect(isPickRectResult({ entities: [], truncated: true })).toBe(true);
    expect(isPickRectResult({ entities: [""], truncated: false })).toBe(false);
    expect(isPickRectResult({ entities: [] })).toBe(false);
    const tooMany = Array.from({ length: PICK_RECT_MAX_ENTITIES + 1 }, (_, index) => `E${String(index)}`);
    expect(isPickRectResult({ entities: tooMany, truncated: true })).toBe(false);
  });
});

describe("the pickRect rectangle", () => {
  const surface = { width: 400, height: 200, clientWidth: 200, clientHeight: 100 };

  it("orders the corners, scales CSS pixels to backing pixels and clips to the canvas", () => {
    expect(rectInBackingPixels({ x0: 50, y0: 40, x1: 10, y1: 20, unit: "css" }, surface)).toEqual({
      minX: 20,
      minY: 40,
      maxX: 100,
      maxY: 80,
    });
    expect(rectInBackingPixels({ x0: -10, y0: -10, x1: 1000, y1: 1000, unit: "backing" }, surface)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 400,
      maxY: 200,
    });
  });

  it("is null when it lies wholly outside the canvas", () => {
    expect(rectInBackingPixels({ x0: 500, y0: 0, x1: 600, y1: 10, unit: "backing" }, surface)).toBeNull();
    expect(rectInBackingPixels({ x0: -20, y0: -20, x1: -10, y1: -10, unit: "css" }, surface)).toBeNull();
  });
});

describe("a box projected through a camera", () => {
  it("lands where the perspective puts its corners", () => {
    // A unit cube 2 m ahead: its corners span x/z from -0.5/1.5 to 0.5/1.5, a third of the view.
    const box = projectBox(cube(0, 0, 2), null, IDENTITY, PERSPECTIVE, SIDE, SIDE);
    expect(box?.clipped).toBe(false);
    expect(box?.rect.minX).toBeCloseTo(100 - 100 / 3);
    expect(box?.rect.maxX).toBeCloseTo(100 + 100 / 3);
    expect(box?.rect.minY).toBeCloseTo(100 - 100 / 3);
    expect(box?.rect.maxY).toBeCloseTo(100 + 100 / 3);
  });

  it("puts +Y up the screen and applies the world matrix first", () => {
    const up = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 3, 10, 1];
    const box = projectBox(cube(0, 0, 0), up, IDENTITY, PERSPECTIVE, SIDE, SIDE);
    expect(box).not.toBeNull();
    expect(box?.rect.maxY ?? Number.NaN).toBeLessThan(100);
  });

  it("is null wholly behind the camera, and cut at the camera plane when it crosses it", () => {
    expect(projectBox(cube(0, 0, -3), null, IDENTITY, PERSPECTIVE, SIDE, SIDE)).toBeNull();
    const crossing = projectBox(cube(0, 0, 0.2), null, IDENTITY, PERSPECTIVE, SIDE, SIDE);
    expect(crossing?.clipped).toBe(true);
    expect(Number.isFinite(crossing?.rect.minX)).toBe(true);
    expect(crossing?.rect.minX ?? 0).toBeLessThan(0);
    expect(crossing?.rect.maxX ?? 0).toBeGreaterThan(SIDE);
  });
});

describe("the match modes", () => {
  const rect = { minX: 50, minY: 50, maxX: 150, maxY: 150 };
  const inside = { rect: { minX: 60, minY: 60, maxX: 140, maxY: 140 }, clipped: false };
  const across = { rect: { minX: 140, minY: 60, maxX: 200, maxY: 100 }, clipped: false };
  const away = { rect: { minX: 160, minY: 60, maxX: 200, maxY: 100 }, clipped: false };

  it("intersect counts any overlap", () => {
    expect(rectMatches(inside, rect, "intersect")).toBe(true);
    expect(rectMatches(across, rect, "intersect")).toBe(true);
    expect(rectMatches(away, rect, "intersect")).toBe(false);
  });

  it("contain counts only a box wholly inside and wholly in front of the camera", () => {
    expect(rectMatches(inside, rect, "contain")).toBe(true);
    expect(rectMatches(across, rect, "contain")).toBe(false);
    expect(rectMatches({ ...inside, clipped: true }, rect, "contain")).toBe(false);
  });

  it("joins an entity's meshes into one box", () => {
    const joined = unionProjected(unionProjected(undefined, inside), { ...away, clipped: true });
    expect(joined).toEqual({ rect: { minX: 60, minY: 60, maxX: 200, maxY: 140 }, clipped: true });
    expect(rectMatches(joined, rect, "contain")).toBe(false);
  });
});

describe("a 2D box projected through the 2D editor camera", () => {
  it("is the inverse of screenToWorld2D", () => {
    const view = { centerX: 3, centerY: -2, zoom: 2, pixelsPerUnit: 16, widthPx: 320, heightPx: 180 };
    const screen = projectBox2D(view, { minX: 1, minY: -4, maxX: 5, maxY: 0 });
    expect(screenToWorld2D(view, screen.minX, screen.maxY)).toEqual({ x: 1, y: -4 });
    expect(screenToWorld2D(view, screen.maxX, screen.minY)).toEqual({ x: 5, y: 0 });
    expect(screen.minY).toBeLessThan(screen.maxY);
  });
});

describe("drawnMeshes", () => {
  it("attributes meshes to their nearest owner and skips hidden, unpickable and editor-only meshes, as pick does", () => {
    const owner = { name: "entity" };
    const mesh = (extra: Record<string, unknown>): Record<string, unknown> => ({
      parent: owner,
      boundMin: [0, 0, 0],
      boundMax: [1, 1, 1],
      worldMatrix: new Float32Array(16),
      ...extra,
    });
    const meshes = [
      mesh({ id: "drawn" }),
      mesh({ id: "hidden", visible: false }),
      mesh({ id: "unpickable", pickable: false }),
      mesh({ id: "grid", metadata: { [EDITOR_ONLY_METADATA_KEY]: true } }),
      mesh({ id: "stray", parent: null }),
    ];
    const handles = { scene: { meshes } } as unknown as AppLiteHandles;
    const drawn = drawnMeshes(handles, new Map([[owner, "E"]]));
    expect(drawn.map((entry) => entry.owner)).toEqual(["E"]);
    expect(drawn[0]?.world).toBe(meshes[0]?.["worldMatrix"]);
  });
});
