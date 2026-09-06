import { Vec2, Phase } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { defineSpriteAtlas } from "../../src/atlas/definition.js";
import { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import { Camera2D } from "../../src/camera/camera-2d.js";
import { buildAtlas } from "../../src/lite/atlas.js";
import { TwoDRuntime } from "../../src/service/runtime.js";
import { TwoDSyncSystem } from "../../src/service/sync-system.js";
import { defaultTwoDSettings } from "../../src/settings.js";
import { SpriteRenderer } from "../../src/sprite/sprite-renderer.js";
import { defineTilemap } from "../../src/tilemap/definition.js";
import { TilemapAsset } from "../../src/tilemap/tilemap-asset.js";
import { TilemapRenderer } from "../../src/tilemap/tilemap-renderer.js";
import { Tilemap } from "../../src/tilemap/tilemap.js";
import { createTwoDApp } from "../support/app.js";
import type { LiteSpriteRenderer } from "../../src/lite/types.js";
import type { TilemapInput } from "../../src/tilemap/definition.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { Texture2D } from "@babylonjs/lite";

/**
 * **Spike S6.1, the Node half** (`docs/plan/engineering-plan.md` Phase 6).
 *
 * The browser half measures the same scene on SwiftShader; this one measures it under Node with no
 * device at all, which isolates the sync system's own arithmetic from anything WebGPU does. The
 * numbers are **reported, not asserted** as a threshold beyond the standards §7 budget: a CI
 * machine's absolute speed is not something a test should gate on
 * (`benchmarks/README.md`'s rule for frame times).
 *
 * One difference from the browser half is load-bearing: a headless app has no surface, so
 * `TwoDRuntime.cameraBounds()` answers `null` and the tilemap renderer materialises **every**
 * chunk. All 10 000 tiles are therefore live sprites here, where the browser run culls to the
 * 1 024 the camera can see.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** How many cells the spike's map spans on each axis. */
const MAP_EDGE = 100;

/** How many moving sprites the spike drives. */
const MOVERS = 1000;

/** The budget, in milliseconds of CPU per frame, coding standards §7 sets for a 2D template. */
const SYNC_BUDGET_MS = 2;

/** Two 32x32 frames over a stub texture, named as the tilemap's tileset expects. */
function atlasAsset(): SpriteAtlasAsset {
  const definition = defineSpriteAtlas({
    image: "x.png",
    frames: [
      { name: "run_0", x: 0, y: 0, w: 32, h: 32 },
      { name: "run_1", x: 32, y: 0, w: 32, h: 32 },
    ],
  });
  const rects = [
    { name: "run_0", x: 0, y: 0, w: 32, h: 32, pivotX: 0.5, pivotY: 0.5, sourceW: 32, sourceH: 32 },
    { name: "run_1", x: 32, y: 0, w: 32, h: 32, pivotX: 0.5, pivotY: 0.5, sourceW: 32, sourceH: 32 },
  ];
  const texture = { width: 64, height: 32 } as unknown as Texture2D;
  return new SpriteAtlasAsset("2d/stub.atlas.json", definition, buildAtlas(texture, 64, 32, rects, false), null);
}

/** A 100x100 map whose every cell is tile 1. */
function bigMap(): TilemapAsset {
  const tiles: number[] = Array.from({ length: MAP_EDGE * MAP_EDGE }, () => 1);
  const input: TilemapInput = {
    tileWidth: 32,
    width: MAP_EDGE,
    height: MAP_EDGE,
    tilesets: [{ name: "hero", atlas: "2d/stub.atlas.json", firstId: 1, tiles: [{ id: 0, frame: "run_0" }] }],
    layers: [{ name: "ground", width: MAP_EDGE, height: MAP_EDGE, tiles }],
  };
  return new TilemapAsset("2d/big.tilemap.json", defineTilemap(input));
}

describe("S6.1 sprite sync at scale, headless", () => {
  it("stays under the per-frame budget and touches nothing while idle", async () => {
    const created = await createTwoDApp();
    harness = created;
    const runtime = new TwoDRuntime({
      app: created.app,
      settings: defaultTwoDSettings(),
      sortingLayers: ["Default"],
      createRenderer: (): LiteSpriteRenderer => ({ layers: [], clearColor: { r: 0, g: 0, b: 0, a: 1 } }),
      attachLayer: (): void => {},
      detachLayer: (): void => {},
      destroyRenderer: (): void => {},
    });
    const system = new TwoDSyncSystem(runtime);
    const world = created.app.world;
    const shared = atlasAsset();

    world.createEntity("Camera").addComponent(Camera2D).orthographicSize = 5;

    const level = world.createEntity("level");
    const tilemap = level.addComponent(Tilemap);
    tilemap.map = { state: "loaded", value: bigMap() } as never;
    const tiles = level.addComponent(TilemapRenderer);
    tiles.atlas = { state: "loaded", value: shared } as never;

    const movers: SpriteRenderer[] = [];
    for (let index = 0; index < MOVERS; index += 1) {
      const entity = world.createEntity(`m${String(index)}`);
      entity.transform.position2D = new Vec2((index % 40) * 0.1 - 2, Math.floor(index / 40) * 0.1 - 2);
      const sprite = entity.addComponent(SpriteRenderer);
      sprite.sprite = { state: "loaded", value: shared } as never;
      movers.push(sprite);
    }

    const tick = (): void => {
      system.update({ world, time: created.app.time, phase: Phase.PreRender, dt: 1 / 60 });
    };
    /** Runs `frames` syncs and returns their median and worst CPU milliseconds. */
    const measure = (frames: number, dirty: boolean): { median: number; worst: number } => {
      const samples: number[] = [];
      for (let frame = 0; frame < frames; frame += 1) {
        if (dirty) {
          const offset = frame * 0.01;
          for (let index = 0; index < movers.length; index += 1) {
            movers[index]?.entity.transform.position2D.set(
              (index % 40) * 0.1 - 2 + offset,
              Math.floor(index / 40) * 0.1 - 2,
            );
          }
        }
        const started = performance.now();
        tick();
        samples.push(performance.now() - started);
      }
      const sorted = samples.toSorted((left, right) => left - right);
      return { median: sorted[sorted.length >> 1] ?? Number.NaN, worst: sorted.at(-1) ?? Number.NaN };
    };

    measure(10, true);
    const idle = measure(60, false);
    const loaded = measure(60, true);

    globalThis.console.log(
      `S6.1-node movers=${String(MOVERS)} tiles=${String(MAP_EDGE * MAP_EDGE)} chunkedTiles=${String(tiles.spriteCount)} ` +
        `loadedMedianMs=${loaded.median.toFixed(4)} loadedWorstMs=${loaded.worst.toFixed(4)} ` +
        `idleMedianMs=${idle.median.toFixed(4)} idleWorstMs=${idle.worst.toFixed(4)} ` +
        `syncedWhileIdle=${String(runtime.syncedLastFrame)}`,
    );

    expect(runtime.spriteCount).toBe(MOVERS);
    expect(loaded.median).toBeLessThan(SYNC_BUDGET_MS);
    // A headless app has no surface, so there is no visible rectangle to cull a chunk against and
    // the whole map materialises. That makes this the *harder* measurement of the two — every one
    // of the 10 000 tiles is a live sprite — and the browser half is where culling is proved.
    expect(tiles.spriteCount).toBe(MAP_EDGE * MAP_EDGE);
    // With nothing moving, the sync writes nothing at all, however many sprites exist.
    expect(runtime.syncedLastFrame).toBe(0);
  }, 60_000);
});
