import { Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Camera2D } from "../src/camera/camera-2d.js";
import { SpriteRenderer } from "../src/sprite/sprite-renderer.js";
import { defineTilemap } from "../src/tilemap/definition.js";
import { TilemapAsset } from "../src/tilemap/tilemap-asset.js";
import { TilemapRenderer } from "../src/tilemap/tilemap-renderer.js";
import { Tilemap } from "../src/tilemap/tilemap.js";
import { createTwoDBrowserApp, fixtureAssets, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { TwoDBrowserApp } from "./support/browser-harness.js";
import type { SpriteAtlasAsset } from "../src/atlas/sprite-atlas-asset.js";
import type { TilemapInput } from "../src/tilemap/definition.js";

/**
 * **Spike S6.1 — sprite sync at scale** (`docs/plan/engineering-plan.md` Phase 6).
 *
 * 10 000 static tiles (a 100x100 `Tilemap`) plus 1 000 moving `SpriteRenderer`s. The question is
 * the **CPU cost of the sync system**, not the GPU cost: the CI adapter is SwiftShader and would
 * dominate any end-to-end frame time, so the measurement wraps `performance.now()` around the
 * sync itself. The budget is the one coding standards §7 sets for a 2D template: the sync stays
 * under 2 ms per frame for the 1 000 movers.
 *
 * The second half of the spike is the chunking claim: a static tilemap must cost **zero** per-frame
 * sync work once its chunks are up. `app.twoD.syncedLastFrame` is the counter that says so.
 */

let harness: TwoDBrowserApp | null = null;

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

/** A 100x100 map whose every cell is tile 1. */
function bigMap(): TilemapAsset {
  const tiles: number[] = Array.from({ length: MAP_EDGE * MAP_EDGE }, () => 1);
  const input: TilemapInput = {
    tileWidth: 32,
    width: MAP_EDGE,
    height: MAP_EDGE,
    tilesets: [{ name: "hero", atlas: "2d/hero.atlas.json", firstId: 1, tiles: [{ id: 0, frame: "run_0" }] }],
    layers: [{ name: "ground", width: MAP_EDGE, height: MAP_EDGE, tiles }],
  };
  return new TilemapAsset("2d/big.tilemap.json", defineTilemap(input));
}

describe("S6.1 sprite sync at scale", () => {
  it("keeps the sync under budget with 10 000 static tiles and 1 000 movers", async () => {
    const running = await createTwoDBrowserApp({
      width: 256,
      height: 256,
      assets: fixtureAssets(),
      options: { pixelsPerUnit: 100 },
    });
    harness = running;
    const eye = running.world.createEntity("Camera");
    const camera = eye.addComponent(Camera2D);
    camera.orthographicSize = 5;
    const handle = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    await running.advance(SETTLE_FRAMES);
    await handle.promise;

    // The tilemap: 10 000 cells, chunked at the documented 32.
    const level = running.world.createEntity("level");
    const tilemap = level.addComponent(Tilemap);
    tilemap.map = { state: "loaded", value: bigMap() } as never;
    const tiles = level.addComponent(TilemapRenderer);
    tiles.atlas = handle.retain();

    // The movers: 1 000 sprites that all change transform every frame.
    const movers: SpriteRenderer[] = [];
    for (let index = 0; index < MOVERS; index += 1) {
      const entity = running.world.createEntity(`m${String(index)}`);
      entity.transform.position2D = new Vec2((index % 40) * 0.1 - 2, Math.floor(index / 40) * 0.1 - 2);
      const sprite = entity.addComponent(SpriteRenderer);
      sprite.sprite = handle.retain();
      sprite.frame = 2;
      movers.push(sprite);
    }
    await running.advance(SETTLE_FRAMES * 2);

    const chunkedTiles = tiles.spriteCount;

    // `app.step` is only legal with the render loop stopped, which is exactly what this spike
    // wants: the sample is CPU work with no presented frame and no SwiftShader rasterisation in it.
    running.app.stop();

    /** Runs `frames` steps and returns their median and worst CPU milliseconds. */
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
        running.app.step(1 / 60);
        samples.push(performance.now() - started);
      }
      const sorted = samples.toSorted((left, right) => left - right);
      return { median: sorted[sorted.length >> 1] ?? Number.NaN, worst: sorted.at(-1) ?? Number.NaN };
    };

    // Warm the JIT, then take the idle baseline and the loaded sample.
    measure(5, true);
    const idle = measure(20, false);
    const loaded = measure(20, true);
    const syncedWhileIdle = running.app.twoD.syncedLastFrame;

    // Reported, not just asserted, so a human can see the curve (benchmarks/README.md).
    globalThis.console.log(
      `S6.1 movers=${String(MOVERS)} tiles=${String(MAP_EDGE * MAP_EDGE)} chunkedTiles=${String(chunkedTiles)} ` +
        `loadedMedianMs=${loaded.median.toFixed(4)} loadedWorstMs=${loaded.worst.toFixed(4)} ` +
        `idleMedianMs=${idle.median.toFixed(4)} idleWorstMs=${idle.worst.toFixed(4)} ` +
        `syncedWhileIdle=${String(syncedWhileIdle)}`,
    );
    const median = loaded.median;

    expect(running.app.twoD.spriteCount).toBe(MOVERS);
    expect(median).toBeLessThan(SYNC_BUDGET_MS);
    // With nothing moving, a frame carrying 1 000 sprites and a 100x100 map writes nothing at all.
    expect(syncedWhileIdle).toBe(0);
    // Chunking: the camera sees a fraction of a 100x100 map, so far fewer than 10 000 sprites exist.
    expect(chunkedTiles).toBeGreaterThan(0);
    expect(chunkedTiles).toBeLessThan(MAP_EDGE * MAP_EDGE);
    expect(running.errors).toEqual([]);
  }, 60_000);

  it("touches zero sprites on a frame where nothing moved", async () => {
    const running = await createTwoDBrowserApp({
      width: 128,
      height: 128,
      assets: fixtureAssets(),
      options: { pixelsPerUnit: 100 },
    });
    harness = running;
    const eye = running.world.createEntity("Camera");
    eye.addComponent(Camera2D).orthographicSize = 5;
    const handle = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    await running.advance(SETTLE_FRAMES);
    await handle.promise;

    const level = running.world.createEntity("level");
    const tilemap = level.addComponent(Tilemap);
    tilemap.map = { state: "loaded", value: bigMap() } as never;
    level.isStatic = true;
    const tiles = level.addComponent(TilemapRenderer);
    tiles.atlas = handle.retain();
    await running.advance(SETTLE_FRAMES * 2);

    const before = tiles.spriteCount;
    await running.advance(4);
    // The tilemap is up, the camera has not moved: no chunk is built and no sprite is written.
    expect(tiles.spriteCount).toBe(before);
    expect(running.app.twoD.syncedLastFrame).toBe(0);
    expect(running.errors).toEqual([]);
  }, 60_000);
});
