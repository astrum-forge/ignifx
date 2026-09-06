import { Phase } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { defineSpriteAtlas } from "../../src/atlas/definition.js";
import { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import { buildAtlas } from "../../src/lite/atlas.js";
import { TwoDRuntime } from "../../src/service/runtime.js";
import { TwoDSyncSystem } from "../../src/service/sync-system.js";
import { defaultTwoDSettings } from "../../src/settings.js";
import { importTiledMap } from "../../src/tilemap/importers/tiled.js";
import { TilemapAsset } from "../../src/tilemap/tilemap-asset.js";
import { TilemapRenderer } from "../../src/tilemap/tilemap-renderer.js";
import { Tilemap } from "../../src/tilemap/tilemap.js";
import { createTwoDApp, readFixtureJson } from "../support/app.js";
import type { FrameRect } from "../../src/lite/atlas.js";
import type { LiteSpriteRenderer } from "../../src/lite/types.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { Texture2D } from "@babylonjs/lite";

/**
 * `TilemapRenderer` (`docs/architecture/11-2d-toolkit.md` §2.5) building and dropping chunks.
 *
 * A chunk that is up and unchanged costs nothing per frame: its sprites are written once, when the
 * chunk is built, and never touched again. That is the property spike S6.1 measures, and it is what
 * makes a 100x100 map free once it is on screen.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The Tiled fixture's tileset names its frames `hero_0` … `hero_3`. */
function rects(): readonly FrameRect[] {
  const out: FrameRect[] = [];
  for (let index = 0; index < 4; index += 1) {
    out.push({
      name: `hero_${String(index)}`,
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
  return out;
}

/** A loaded tile atlas over a stub texture. */
function tileAtlas(): SpriteAtlasAsset {
  const definition = defineSpriteAtlas({
    image: "hero.png",
    frames: rects().map((rect) => ({ name: rect.name, x: rect.x, y: rect.y, w: rect.w, h: rect.h })),
  });
  const texture = { width: 64, height: 64 } as unknown as Texture2D;
  return new SpriteAtlasAsset("2d/hero.atlas.json", definition, buildAtlas(texture, 64, 64, rects(), false), null);
}

/** A stand-in for the swapchain-bound sprite renderer, which needs a device. */
function stubRenderer(): LiteSpriteRenderer {
  return { layers: [], clearColor: { r: 0, g: 0, b: 0, a: 1 } };
}

/** A tilemap entity with a renderer, and the sync system driving it. */
interface Rig {
  readonly map: Tilemap;
  readonly renderer: TilemapRenderer;
  readonly runtime: TwoDRuntime;
  readonly tick: () => void;
}

/** Builds the rig off the Tiled fixture. */
async function createRig(options?: { readonly chunkSize?: number; readonly cull?: boolean }): Promise<Rig> {
  const created = await createTwoDApp();
  harness = created;
  const runtime = new TwoDRuntime({
    app: created.app,
    settings: defaultTwoDSettings(),
    sortingLayers: ["Default"],
    createRenderer: (): LiteSpriteRenderer => stubRenderer(),
    attachLayer: (): void => {},
    detachLayer: (): void => {},
    destroyRenderer: (): void => {},
  });
  const system = new TwoDSyncSystem(runtime);
  const asset = new TilemapAsset("2d/level.tilemap.json", importTiledMap(readFixtureJson("sample.tmj")));
  const entity = created.app.world.createEntity("level");
  const map = entity.addComponent(Tilemap);
  map.map = { state: "loaded", value: asset } as never;
  if (options?.chunkSize !== undefined) {
    map.chunkSize = options.chunkSize;
  }
  const renderer = entity.addComponent(TilemapRenderer);
  renderer.atlas = { state: "loaded", value: tileAtlas() } as never;
  if (options?.cull === false) {
    renderer.cullChunks = false;
  }
  const tick = (): void => {
    system.update({ world: created.app.world, time: created.app.time, phase: Phase.PreRender, dt: 1 / 60 });
  };
  return { map, renderer, runtime, tick };
}

describe("chunk building", () => {
  it("materialises the map's tiles as sprites once", async () => {
    const rig = await createRig();
    rig.tick();
    expect(rig.renderer.chunkCount).toBe(1);
    // The fixture's tile layer carries eight non-empty cells.
    expect(rig.renderer.spriteCount).toBe(8);
    expect(rig.runtime.layers.describe()[0]?.count).toBe(8);
  });

  it("costs nothing on a steady frame", async () => {
    const rig = await createRig();
    rig.tick();
    const before = rig.renderer.spriteCount;
    rig.tick();
    rig.tick();
    expect(rig.renderer.spriteCount).toBe(before);
    expect(rig.renderer.chunkCount).toBe(1);
    // No `SpriteRenderer` exists, so the sprite pass wrote nothing either.
    expect(rig.runtime.syncedLastFrame).toBe(0);
  });

  it("splits a map across several chunks", async () => {
    const rig = await createRig({ chunkSize: 2 });
    rig.tick();
    // A 4x4 map at two cells per chunk is a 2x2 grid of chunks.
    expect(rig.renderer.chunkCount).toBe(4);
    expect(rig.renderer.spriteCount).toBe(8);
  });

  it("rebuilds everything after invalidation", async () => {
    const rig = await createRig();
    rig.tick();
    rig.map.setTile(0, 0, 0, 0);
    rig.renderer.invalidate();
    rig.tick();
    // One cell was cleared, so one sprite fewer.
    expect(rig.renderer.spriteCount).toBe(7);
  });

  it("drops every chunk on request", async () => {
    const rig = await createRig();
    rig.tick();
    rig.renderer.dropAll(rig.runtime.layers);
    expect(rig.renderer.chunkCount).toBe(0);
    expect(rig.renderer.spriteCount).toBe(0);
  });

  it("builds nothing without an atlas", async () => {
    const created = await createTwoDApp();
    harness = created;
    const entity = created.app.world.createEntity("level");
    entity.addComponent(Tilemap);
    const renderer = entity.addComponent(TilemapRenderer);
    expect(renderer.loadedAtlas).toBeNull();
    expect(renderer.chunkCount).toBe(0);
  });

  it("skips a tile whose frame the atlas does not carry", async () => {
    const rig = await createRig();
    // An atlas with only one frame cannot draw the fixture's other tiles.
    const sparse = defineSpriteAtlas({ image: "hero.png", frames: [{ name: "hero_0", x: 0, y: 0, w: 32, h: 32 }] });
    const texture = { width: 32, height: 32 } as unknown as Texture2D;
    const single = [rects()[0]];
    const asset = new SpriteAtlasAsset(
      "2d/one.atlas.json",
      sparse,
      buildAtlas(
        texture,
        32,
        32,
        single.filter((rect) => rect !== undefined),
        false,
      ),
      null,
    );
    rig.renderer.atlas = { state: "loaded", value: asset } as never;
    rig.renderer.invalidate();
    rig.tick();
    expect(rig.renderer.spriteCount).toBeLessThan(8);
    expect(rig.renderer.spriteCount).toBeGreaterThan(0);
  });

  it("draws every chunk when culling is off", async () => {
    const rig = await createRig({ chunkSize: 1, cull: false });
    rig.tick();
    expect(rig.renderer.chunkCount).toBe(16);
  });
});

describe("animated tiles", () => {
  it("ticks on a coarse grid rather than every frame", async () => {
    const rig = await createRig();
    rig.tick();
    // Under a tenth of a second is inside one animation tick: nothing to redraw.
    expect(rig.renderer.advanceAnimation(0.01)).toBe(false);
    expect(rig.renderer.animationClock).toBeCloseTo(0.01, 6);
    // Crossing a tick boundary invalidates, so the chunk picks up the next frame.
    expect(rig.renderer.advanceAnimation(0.2)).toBe(true);
  });

  it("is driven by the runtime on the animation clock", async () => {
    const rig = await createRig();
    rig.tick();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    expect(() => rig.runtime.advanceAnimatedTiles(world, 0.5)).not.toThrow();
    expect(rig.renderer.animationClock).toBeGreaterThan(0);
  });
});

describe("disabled renderers", () => {
  it("builds nothing while disabled", async () => {
    const rig = await createRig();
    rig.renderer.enabled = false;
    rig.tick();
    expect(rig.renderer.chunkCount).toBe(0);
  });
});
