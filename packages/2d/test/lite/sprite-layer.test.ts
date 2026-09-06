import { describe, expect, it } from "vitest";
import { buildAtlas, frameIndexOf, toSpriteFrames } from "../../src/lite/atlas.js";
import {
  addSprite,
  blendModeFor,
  centreView,
  clearLayer,
  compileLayerShader,
  createLayer,
  createSpriteScratch,
  pickSprite,
  removeSprite,
  setShaderParams,
  setYSort,
  setYSortOrder,
  spriteIndexOf,
  updateSprite,
  visibleBounds,
  writeScratch,
  writeView,
  Y_SORT_BIAS_STEP,
} from "../../src/lite/sprite-layer.js";
import type { FrameRect } from "../../src/lite/atlas.js";
import type { Bounds2D, SpriteAtlas, Texture2D } from "@babylonjs/lite";

/**
 * The CPU half of the sprite adapter, on the null engine.
 *
 * A `Sprite2DLayer` is a plain object over a `Float32Array` and a `SpriteAtlas` is
 * `{ texture, textureSizePx, frames, premultipliedAlpha }` — pure data whose only GPU-bound member
 * is the texture, which nothing on this path dereferences. That is what lets the whole sprite
 * pipeline, including picking and Y-sort, be exercised in Node; the browser suite covers only what
 * genuinely needs a device.
 */

/** A texture stand-in. Nothing on this path dereferences it; only the atlas record holds it. */
function stubTexture(width: number, height: number): Texture2D {
  return { width, height } as unknown as Texture2D;
}

/** Four 32x32 frames in a 64x64 sheet, in reading order. */
function heroRects(): readonly FrameRect[] {
  const rects: FrameRect[] = [];
  const names = ["idle_0", "idle_1", "run_0", "run_1"];
  for (let index = 0; index < names.length; index += 1) {
    rects.push({
      name: names[index] ?? "",
      x: (index % 2) * 32,
      y: Math.floor(index / 2) * 32,
      w: 32,
      h: 32,
      pivotX: 0.5,
      pivotY: 0.5,
      sourceW: 32,
      sourceH: 32,
    });
  }
  return rects;
}

/** The hero atlas as Lite holds it. */
function heroAtlas(): SpriteAtlas {
  return buildAtlas(stubTexture(64, 64), 64, 64, heroRects(), false);
}

/** A layer holding the hero atlas, with the adapter's defaults. */
function heroLayer(): ReturnType<typeof createLayer> {
  return createLayer(heroAtlas(), { blend: "alpha", order: 0, capacity: 4, customShader: null });
}

describe("atlas records", () => {
  it("normalises pixel rectangles into top-down UVs", () => {
    const frames = toSpriteFrames(heroRects(), 64, 64);
    expect(frames).toHaveLength(4);
    expect(frames[0]?.uvMin).toEqual([0, 0]);
    expect(frames[0]?.uvMax).toEqual([0.5, 0.5]);
    expect(frames[3]?.uvMin).toEqual([0.5, 0.5]);
    expect(frames[3]?.uvMax).toEqual([1, 1]);
    expect(frames[0]?.sourceSizePx).toEqual([32, 32]);
  });

  it("refuses to divide by a zero texture size", () => {
    const frames = toSpriteFrames(heroRects(), 0, 0);
    expect(Number.isFinite(frames[0]?.uvMax[0] ?? Number.NaN)).toBe(true);
  });

  it("assembles the record Lite reads", () => {
    const atlas = heroAtlas();
    expect(atlas.textureSizePx).toEqual([64, 64]);
    expect(atlas.premultipliedAlpha).toBe(false);
    expect(atlas.frames).toHaveLength(4);
  });

  it("finds a frame by name", () => {
    const atlas = heroAtlas();
    expect(frameIndexOf(atlas, "run_0")).toBe(2);
    expect(frameIndexOf(atlas, "nope")).toBe(-1);
  });
});

describe("blend modes", () => {
  it("maps every documented name to a distinct Lite descriptor", () => {
    const seen = new Set<unknown>();
    for (const name of ["alpha", "premultiplied", "additive", "multiply", "opaque"] as const) {
      const descriptor = blendModeFor(name);
      expect(descriptor).toBeDefined();
      seen.add(descriptor);
    }
    expect(seen.size).toBe(5);
  });
});

describe("layers", () => {
  it("pins the pivot to the centre, because Lite has one pivot per layer", () => {
    // `Sprite2DLayer.pivot` is a layer-wide uniform and `SpriteFrame.pivot` is ignored by the 2D
    // pipeline, so ignifx keeps the layer centred and moves each sprite instead.
    const layer = heroLayer();
    expect(layer.pivot).toEqual([0.5, 0.5]);
    expect(layer.depth).toBe("none");
    expect(layer.order).toBe(0);
    expect(layer.count).toBe(0);
  });

  it("carries an order and a compiled custom shader", () => {
    const shader = compileLayerShader("return vec4f(1.0);");
    const layer = createLayer(heroAtlas(), { blend: "additive", order: 7, capacity: 1, customShader: shader });
    expect(layer.order).toBe(7);
    expect(layer.customShader).toBe(shader);
    setShaderParams(layer, 1, 2, 3, 4);
    expect(layer.shaderParams).toEqual([1, 2, 3, 4]);
  });
});

describe("sprites", () => {
  it("adds, updates and removes through a reusable props record", () => {
    const layer = heroLayer();
    const scratch = createSpriteScratch();
    writeScratch(scratch, 10, -20, 32, 32, 1, 0, 1, 1, 1, 1, false, false, true);
    const handle = addSprite(layer, scratch);
    expect(layer.count).toBe(1);
    expect(spriteIndexOf(handle)).toBe(0);
    writeScratch(scratch, 50, -60, 16, 16, 2, 0.5, 1, 0, 0, 0.5, true, false, true);
    updateSprite(handle, scratch);
    expect(layer.count).toBe(1);
    expect(removeSprite(handle)).toBe(true);
    expect(layer.count).toBe(0);
    expect(spriteIndexOf(handle)).toBe(-1);
    expect(removeSprite(handle)).toBe(false);
  });

  it("swap-removes, which moves the last sprite into the freed slot", () => {
    const layer = heroLayer();
    const scratch = createSpriteScratch();
    const handles = [];
    for (let index = 0; index < 3; index += 1) {
      writeScratch(scratch, index * 10, 0, 32, 32, 0, 0, 1, 1, 1, 1, false, false, true);
      handles.push(addSprite(layer, scratch));
    }
    expect(handles.map((handle) => spriteIndexOf(handle))).toEqual([0, 1, 2]);
    const first = handles[0];
    const last = handles[2];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first !== undefined && last !== undefined) {
      removeSprite(first);
      expect(layer.count).toBe(2);
      // The last sprite now occupies index 0. Anything mapping index to component must do the same.
      expect(spriteIndexOf(last)).toBe(0);
    }
  });

  it("grows past its initial capacity", () => {
    const layer = createLayer(heroAtlas(), { blend: "alpha", order: 0, capacity: 1, customShader: null });
    const scratch = createSpriteScratch();
    for (let index = 0; index < 20; index += 1) {
      writeScratch(scratch, index, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
      addSprite(layer, scratch);
    }
    expect(layer.count).toBe(20);
  });

  it("empties a layer without dropping it", () => {
    const layer = heroLayer();
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 32, 32, 0, 0, 1, 1, 1, 1, false, false, true);
    addSprite(layer, scratch);
    clearLayer(layer);
    expect(layer.count).toBe(0);
  });
});

describe("Y-sort", () => {
  it("turns on and off", () => {
    const layer = heroLayer();
    setYSort(layer, true);
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 100, 32, 32, 0, 0, 1, 1, 1, 1, false, false, true);
    const handle = addSprite(layer, scratch);
    setYSortOrder(handle, 2);
    expect(Y_SORT_BIAS_STEP).toBeGreaterThan(100_000);
    setYSort(layer, false);
    expect(() => setYSort(layer, false)).not.toThrow();
  });

  it("lets orderInLayer dominate world Y", () => {
    // The bias is added to the pixel Y before sorting; one unit of `orderInLayer` has to outweigh
    // any plausible scene height, which is what the step size buys.
    expect(Y_SORT_BIAS_STEP).toBeGreaterThanOrEqual(10_000 * 100);
  });
});

describe("views", () => {
  it("writes a raw view and refuses a zero zoom", () => {
    const layer = heroLayer();
    writeView(layer.view, 10, 20, 2, 0.5);
    expect(layer.view.positionPx).toEqual([10, 20]);
    expect(layer.view.zoom).toBe(2);
    expect(layer.view.rotation).toBe(0.5);
    writeView(layer.view, 0, 0, 0, 0);
    expect(layer.view.zoom).toBe(1);
  });

  it("centres a view on a layer-pixel point", () => {
    const layer = heroLayer();
    centreView(layer.view, 100, 200, 640, 360, 1, 0);
    // `positionPx` is the point that lands at the viewport's TOP-LEFT, not its centre.
    expect(layer.view.positionPx[0]).toBeCloseTo(100 - 320, 6);
    expect(layer.view.positionPx[1]).toBeCloseTo(200 - 180, 6);
  });

  it("guards a zero zoom when centring", () => {
    const layer = heroLayer();
    centreView(layer.view, 0, 0, 100, 100, 0, 0);
    expect(layer.view.zoom).toBe(1);
  });

  it("reports the world box a view can see", () => {
    const layer = heroLayer();
    centreView(layer.view, 0, 0, 640, 360, 1, 0);
    const bounds: Bounds2D = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    visibleBounds(layer.view, 640, 360, bounds);
    expect(bounds.minX).toBeCloseTo(-320, 6);
    expect(bounds.maxX).toBeCloseTo(320, 6);
    expect(bounds.minY).toBeCloseTo(-180, 6);
    expect(bounds.maxY).toBeCloseTo(180, 6);
  });
});

describe("picking", () => {
  it("hits a sprite under a viewport pixel and misses elsewhere", () => {
    const layer = heroLayer();
    writeView(layer.view, 0, 0, 1, 0);
    const scratch = createSpriteScratch();
    // A 32x32 sprite centred at (100, 100) in layer pixels covers 84..116 on both axes.
    writeScratch(scratch, 100, 100, 32, 32, 0, 0, 1, 1, 1, 1, false, false, true);
    addSprite(layer, scratch);
    const hit = pickSprite([layer], 100, 100);
    expect(hit).not.toBeNull();
    expect(hit?.spriteIndex).toBe(0);
    expect(hit?.u).toBeCloseTo(0.5, 3);
    expect(hit?.v).toBeCloseTo(0.5, 3);
    expect(pickSprite([layer], 0, 0)).toBeNull();
  });

  it("misses an empty layer list", () => {
    expect(pickSprite([], 0, 0)).toBeNull();
  });
});
