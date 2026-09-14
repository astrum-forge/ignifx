import { Phase, Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { defineSpriteAtlas } from "../../src/atlas/definition.js";
import { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import { buildAtlas } from "../../src/lite/atlas.js";
import { pickSprite } from "../../src/lite/sprite-layer.js";
import { TwoDRuntime } from "../../src/service/runtime.js";
import { TwoDSyncSystem } from "../../src/service/sync-system.js";
import { TwoDService } from "../../src/service/two-d-service.js";
import { defaultTwoDSettings } from "../../src/settings.js";
import { SpriteRenderer } from "../../src/sprite/sprite-renderer.js";
import { createTwoDApp } from "../support/app.js";
import type { FrameRect } from "../../src/lite/atlas.js";
import type { LiteAtlasTexture, LiteSprite2DLayer, LiteSpriteRenderer } from "../../src/lite/types.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { AssetHandle, AssetState } from "@ignifx/core";

/**
 * `app.twoD.createSpriteBatch` on the null engine
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §2.2).
 *
 * A `Sprite2DLayer` is a plain object over a `Float32Array`, so the whole batch — layer creation,
 * every write, `count`, `hide` and teardown — runs under Node against an atlas whose Lite half is
 * real and whose texture is a stand-in. What the batch stores is read back through
 * `pickSprite2D`, which is Lite's own reader of the instance slots: with the layer's centre pivot a
 * hit at point `P` reports `u = (P.x - positionPx.x) / sizePx.x + 0.5`, so one pick recovers a
 * slot's exact position and size, and a zero-sized (hidden) slot is skipped entirely.
 *
 * The browser suite covers the one thing this cannot: that the slots reach the screen.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Two 32x32 frames over a stub texture, both centre-pivoted. */
function rects(): readonly FrameRect[] {
  return [
    { name: "a", x: 0, y: 0, w: 32, h: 32, pivotX: 0.5, pivotY: 0.5, sourceW: 32, sourceH: 32 },
    { name: "b", x: 32, y: 0, w: 32, h: 32, pivotX: 0.5, pivotY: 0.5, sourceW: 32, sourceH: 32 },
  ];
}

/** A loaded atlas whose Lite half is real; `uploaded: false` is what a headless app holds. */
function atlasAsset(uploaded = true): SpriteAtlasAsset {
  const definition = defineSpriteAtlas({
    image: "x.png",
    frames: [
      { name: "a", x: 0, y: 0, w: 32, h: 32 },
      { name: "b", x: 32, y: 0, w: 32, h: 32 },
    ],
  });
  const texture = { width: 64, height: 32 } as unknown as LiteAtlasTexture;
  const lite = uploaded ? buildAtlas(texture, 64, 32, rects(), false) : null;
  return new SpriteAtlasAsset("2d/stub.atlas.json", definition, lite, null);
}

/** The asset handle shape `createSpriteBatch` reads: an address, a state, and a value. */
function atlasHandle(atlas: SpriteAtlasAsset, state: AssetState = "loaded"): AssetHandle<SpriteAtlasAsset> {
  return { address: atlas.address, state, value: atlas } as unknown as AssetHandle<SpriteAtlasAsset>;
}

/** A runtime, the sync system driving it, and the service that hands out batches. */
interface Rig {
  readonly runtime: TwoDRuntime;
  readonly service: TwoDService;
  readonly attached: LiteSprite2DLayer[];
  readonly tick: () => void;
}

/** Builds a rig over a headless app with the swapchain-bound renderer faked. */
async function createRig(): Promise<Rig> {
  const created = await createTwoDApp();
  harness = created;
  const attached: LiteSprite2DLayer[] = [];
  const runtime = new TwoDRuntime({
    app: created.app,
    settings: defaultTwoDSettings(),
    sortingLayers: ["Background", "Default", "Foreground"],
    createRenderer: (): LiteSpriteRenderer => ({ layers: [] }) as unknown as LiteSpriteRenderer,
    attachLayer: (_renderer, layer): void => {
      attached.push(layer);
    },
    detachLayer: (): void => {},
    destroyRenderer: (): void => {},
  });
  const system = new TwoDSyncSystem(runtime);
  return {
    runtime,
    service: new TwoDService(runtime),
    attached,
    tick: (): void => {
      system.update({ world: created.app.world, time: created.app.time, phase: Phase.PreRender, dt: 1 / 60 });
    },
  };
}

/** The Lite layer a sorting layer's sprites landed in. */
function layerOf(rig: Rig, sortingLayer: string): LiteSprite2DLayer {
  const entry = rig.runtime.layers.describe().find((candidate) => candidate.sortingLayer === sortingLayer);
  if (entry === undefined) {
    throw new Error(`no layer for ${sortingLayer}`);
  }
  return entry.layer;
}

/** Whether any sprite in a layer covers a layer-pixel point. */
function covers(layer: LiteSprite2DLayer, xPx: number, yPx: number): boolean {
  return pickSprite([layer], xPx, yPx) !== null;
}

describe("creating a batch", () => {
  it("claims one slot per unit of capacity in a single layer", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 64 });
    expect(batch.capacity).toBe(64);
    expect(batch.count).toBe(0);
    const entries = rig.runtime.layers.describe();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.count).toBe(64);
    expect(batch.lite.handles).toHaveLength(64);
  });

  it("pre-allocates the Lite layer for the whole crowd", async () => {
    // Lite grows an instance array by doubling; a batch that says how many sprites it needs up
    // front pays for none of those reallocations.
    const rig = await createRig();
    rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 5000 });
    const layer = layerOf(rig, "Default");
    // oxlint-disable-next-line no-underscore-dangle -- `_capacity` is Lite's only witness that the instance array was sized once instead of grown nine times.
    expect((layer as unknown as { _capacity: number })._capacity).toBe(5000);
  });

  it("draws nothing until a slot is both written and inside count", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
    const layer = layerOf(rig, "Default");
    expect(covers(layer, 0, 0)).toBe(false);
    batch.write(0, 0, 0, 0.32, 0.32, 0, 0, 1, 1, 1, 1);
    // Written, but `count` is still 0.
    expect(covers(layer, 0, 0)).toBe(false);
    batch.count = 1;
    expect(covers(layer, 0, 0)).toBe(true);
  });

  it("shares a layer with the sprites whose key it matches", async () => {
    const rig = await createRig();
    addSprite();
    rig.tick();
    rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 8 });
    expect(rig.runtime.layers.describe()).toHaveLength(1);
    expect(rig.runtime.layers.describe()[0]?.count).toBe(9);
  });

  it("refuses a capacity that is not a whole number of at least one", async () => {
    const rig = await createRig();
    const atlas = atlasHandle(atlasAsset());
    expect(() => rig.service.createSpriteBatch({ atlas, capacity: 0 })).toThrow(/IGX-1114/u);
    expect(() => rig.service.createSpriteBatch({ atlas, capacity: -4 })).toThrow(/IGX-1114/u);
    expect(() => rig.service.createSpriteBatch({ atlas, capacity: 1.5 })).toThrow(/IGX-1114/u);
  });

  it("refuses an atlas handle that has not finished loading", async () => {
    const rig = await createRig();
    const atlas = atlasHandle(atlasAsset(), "loading");
    expect(() => rig.service.createSpriteBatch({ atlas, capacity: 4 })).toThrow(/IGX-1117/u);
  });

  it("refuses a sorting layer the project does not declare", async () => {
    const rig = await createRig();
    expect(() =>
      rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4, sortingLayer: "Nope" }),
    ).toThrow(/IGX-1107/u);
  });
});

/** An entity carrying a sprite with a loaded stub atlas, on a sorting layer. */
function addSprite(sortingLayer = "Default"): SpriteRenderer {
  const world = harness?.app.world;
  if (world === undefined) {
    throw new Error("no world");
  }
  const sprite = world.createEntity("s").addComponent(SpriteRenderer);
  sprite.sprite = atlasHandle(atlasAsset());
  sprite.sortingLayer = sortingLayer;
  return sprite;
}

describe("writing a slot", () => {
  it("converts world metres to layer pixels through pixelsPerUnit and the Y flip", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 2 });
    batch.count = 1;
    // 1.5 m right and 0.5 m up at 100 px per metre is (150, -50) in layer pixels, because layer
    // pixels run +Y down. A 0.32 m square is 32 px.
    batch.write(0, 1.5, 0.5, 0.32, 0.32, 0, 0, 1, 1, 1, 1);
    const layer = layerOf(rig, "Default");
    const hit = pickSprite([layer], 150, -50);
    expect(hit?.u).toBeCloseTo(0.5, 6);
    expect(hit?.v).toBeCloseTo(0.5, 6);
    // The quad spans 32 px, so 16 px out is the edge and 17 px out is past it.
    expect(covers(layer, 150 + 15, -50)).toBe(true);
    expect(covers(layer, 150 + 17, -50)).toBe(false);
    expect(covers(layer, 150, -50 - 17)).toBe(false);
  });

  it("puts a slot exactly where the sync system puts an equivalent SpriteRenderer", async () => {
    // The whole point of the conversion: a batch slot and a sprite fed the same world position,
    // size and rotation land on the same layer pixel. A 2:1 scale and a 30-degree turn make the
    // assertion sensitive to the size, the pivot and the rotation's sign at once.
    const rig = await createRig();
    const sprite = addSprite("Background");
    sprite.entity.transform.position2D = new Vec2(1.5, 0.5);
    sprite.entity.transform.rotation2D = 30;
    sprite.entity.transform.localScale2D = new Vec2(2, 1);
    rig.tick();
    const batch = rig.service.createSpriteBatch({
      atlas: atlasHandle(atlasAsset()),
      capacity: 1,
      sortingLayer: "Foreground",
    });
    batch.count = 1;
    batch.write(0, 1.5, 0.5, 0.64, 0.32, 0, 30, 1, 1, 1, 1);

    const spriteHit = pickSprite([layerOf(rig, "Background")], 160, -44);
    const batchHit = pickSprite([layerOf(rig, "Foreground")], 160, -44);
    expect(spriteHit).not.toBeNull();
    expect(batchHit).not.toBeNull();
    expect(batchHit?.u).toBeCloseTo(spriteHit?.u ?? Number.NaN, 6);
    expect(batchHit?.v).toBeCloseTo(spriteHit?.v ?? Number.NaN, 6);
  });

  it("falls back to frame 0 for an index the atlas does not have", async () => {
    // Lite throws on an out-of-range frame; a `SpriteRenderer` draws frame 0 instead, and a batch
    // driven by a frame-over-time curve needs the same tolerance.
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 1 });
    batch.count = 1;
    expect(() => batch.write(0, 0, 0, 0.32, 0.32, 9, 0, 1, 1, 1, 1)).not.toThrow();
    expect(() => batch.write(0, 0, 0, 0.32, 0.32, -1, 0, 1, 1, 1, 1)).not.toThrow();
    expect(() => batch.write(0, 0, 0, 0.32, 0.32, 1.7, 0, 1, 1, 1, 1)).not.toThrow();
    expect(covers(layerOf(rig, "Default"), 0, 0)).toBe(true);
  });

  it("refuses a slot the batch does not have", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 2 });
    expect(() => batch.write(2, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1)).toThrow(/IGX-1115/u);
    expect(() => batch.write(-1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1)).toThrow(/IGX-1115/u);
    expect(() => batch.hide(7)).toThrow(/IGX-1115/u);
  });

  it("mirrors a slot on demand without moving it", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 1 });
    batch.count = 1;
    batch.write(0, 0, 0, 0.32, 0.32, 0, 0, 1, 1, 1, 1, true, true);
    // A flip is stored as reversed UVs, so the quad the picker sees is unchanged.
    expect(covers(layerOf(rig, "Default"), 0, 0)).toBe(true);
    expect(batch.lite.handles).toHaveLength(1);
  });
});

describe("count", () => {
  it("hides the slots that fall out of range and reveals them again", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
    batch.count = 2;
    batch.write(0, 0, 0, 0.32, 0.32, 0, 0, 1, 1, 1, 1);
    batch.write(1, 1, 0, 0.32, 0.32, 0, 0, 1, 1, 1, 1);
    const layer = layerOf(rig, "Default");
    expect(covers(layer, 0, 0)).toBe(true);
    expect(covers(layer, 100, 0)).toBe(true);
    batch.count = 1;
    expect(covers(layer, 0, 0)).toBe(true);
    expect(covers(layer, 100, 0)).toBe(false);
    // Raising it again brings the slot back with the geometry it last carried, unwritten.
    batch.count = 2;
    expect(covers(layer, 100, 0)).toBe(true);
  });

  it("never reveals a slot that was never written", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
    batch.count = 4;
    expect(covers(layerOf(rig, "Default"), 0, 0)).toBe(false);
  });

  it("refuses a count outside zero to capacity", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
    expect(() => {
      batch.count = 5;
    }).toThrow(/IGX-1115/u);
    expect(() => {
      batch.count = -1;
    }).toThrow(/IGX-1115/u);
    expect(() => {
      batch.count = 1.5;
    }).toThrow(/IGX-1115/u);
    expect(batch.count).toBe(0);
  });

  it("costs nothing to set the count it already has", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
    batch.count = 2;
    batch.count = 2;
    expect(batch.count).toBe(2);
  });
});

describe("hide", () => {
  it("hides a slot inside count until it is written again", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 2 });
    batch.count = 2;
    batch.write(0, 0, 0, 0.32, 0.32, 0, 0, 1, 1, 1, 1);
    const layer = layerOf(rig, "Default");
    batch.hide(0);
    expect(covers(layer, 0, 0)).toBe(false);
    // A `count` round trip must not resurrect a slot the caller explicitly hid.
    batch.count = 0;
    batch.count = 2;
    expect(covers(layer, 0, 0)).toBe(false);
    batch.write(0, 0, 0, 0.32, 0.32, 0, 0, 1, 1, 1, 1);
    expect(covers(layer, 0, 0)).toBe(true);
  });
});

describe("disposal", () => {
  it("gives every slot back to the layer and is idempotent", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 8 });
    expect(rig.runtime.layers.describe()[0]?.count).toBe(8);
    batch.dispose();
    expect(rig.runtime.layers.describe()[0]?.count).toBe(0);
    expect(batch.lite.handles).toHaveLength(0);
    expect(() => batch.dispose()).not.toThrow();
  });

  it("leaves the sprites it shared a layer with alone", async () => {
    const rig = await createRig();
    const sprite = addSprite();
    rig.tick();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
    batch.dispose();
    expect(rig.runtime.layers.describe()[0]?.count).toBe(1);
    expect(sprite.placement()).not.toBeNull();
  });

  it("refuses every further use", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 2 });
    batch.dispose();
    expect(() => batch.write(0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1)).toThrow(/IGX-1116/u);
    expect(() => batch.hide(0)).toThrow(/IGX-1116/u);
    expect(() => {
      batch.count = 1;
    }).toThrow(/IGX-1116/u);
  });

  it("tolerates an app that was disposed first", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
    rig.runtime.dispose();
    expect(() => batch.dispose()).not.toThrow();
  });

  it("goes quiet instead of throwing when the layer is torn down under it", async () => {
    // `app.dispose()` empties every layer, which kills the batch's handles. Writing through a dead
    // handle is a raw Lite throw, so the batch has to notice.
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
    batch.count = 4;
    batch.write(0, 0, 0, 0.32, 0.32, 0, 0, 1, 1, 1, 1);
    rig.runtime.dispose();
    expect(() => batch.write(0, 1, 1, 0.32, 0.32, 0, 0, 1, 1, 1, 1)).not.toThrow();
    expect(() => batch.hide(1)).not.toThrow();
    expect(() => {
      batch.count = 0;
    }).not.toThrow();
    expect(batch.lite.handles).toEqual([]);
  });

  it("disposes at the end of a using block", async () => {
    const rig = await createRig();
    {
      using batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset()), capacity: 4 });
      expect(batch.capacity).toBe(4);
    }
    expect(rig.runtime.layers.describe()[0]?.count).toBe(0);
  });
});

describe("headless", () => {
  it("holds state and writes nothing when the atlas was never uploaded", async () => {
    const rig = await createRig();
    const batch = rig.service.createSpriteBatch({ atlas: atlasHandle(atlasAsset(false)), capacity: 4 });
    expect(batch.capacity).toBe(4);
    expect(batch.lite.handles).toEqual([]);
    // No layer was built, so nothing can be drawn — but the state is all there.
    expect(rig.runtime.layers.describe()).toEqual([]);
    batch.count = 3;
    expect(batch.count).toBe(3);
    expect(() => batch.write(0, 1, 2, 0.32, 0.32, 0, 0, 1, 1, 1, 1)).not.toThrow();
    expect(() => batch.hide(0)).not.toThrow();
    expect(() => batch.write(9, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1)).toThrow(/IGX-1115/u);
    expect(() => batch.dispose()).not.toThrow();
  });
});
