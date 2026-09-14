/**
 * The three effects the village wears, and where they stand.
 *
 * @remarks
 * Every document here is a `.particles.json` the 3D system would play unchanged — the same file
 * format, the same modules, the same evaluator. What makes them 2D is the component: a
 * `ParticleSystem2D` writes each live particle into a sprite batch on a sorting layer instead of
 * uploading spawn records to the GPU, so the particles sort, blend and pan with the tiles.
 *
 * Two rules of the 2D renderer shape the numbers below (`packages/particles-2d/skills/`):
 *
 * - **Sizes are metres.** One metre is one 16-pixel tile here, so a flame of `0.5` is eight pixels.
 * - **Only X and Y are drawn.** A shape that spreads along Z — a `circle`, which lies in the ground
 *   plane — looks like a line, so the two directional effects use a wide `cone`, which spreads
 *   along X and travels along +Y.
 */

import { particleDefinition } from "ignifx";
import type {
  App,
  AssetHandle,
  ParticleDefinition,
  SpriteAnimationAsset,
  SpriteAtlasAsset,
  TilemapAsset,
  Vec2Like,
} from "ignifx";

/** The documents and atlases the level loads, by address. */
export const ADDRESSES = {
  map: "2d/village.tilemap.json",
  tiles: "2d/tiny-town.atlas.json",
  villager: "2d/villager.atlas.json",
  villagerClips: "2d/villager.spriteanim.json",
  flame: "2d/fx-flame.atlas.json",
  dust: "2d/fx-dust.atlas.json",
  spark: "2d/fx-spark.atlas.json",
} as const;

/** The sorting layers, back to front. The tilemap's own three come from its document. */
export const SORTING_LAYERS: readonly string[] = ["Ground", "Terrain", "Dust", "Default", "Sparks", "Canopy"];

/** The map is forty by twenty cells of one metre, and the camera may not leave it. */
export const LEVEL_SIZE = { x: 40, y: 20 } as const;

/** The design resolution the pixel-perfect camera fits a whole-number zoom to. */
export const REFERENCE_RESOLUTION = { x: 320, y: 180 } as const;

/**
 * Where the villager starts, in metres.
 *
 * @remarks
 * The map's object layer says the same thing — `tilemap/main.ts` shows the `spawnTilemapObjects`
 * route — but reading it here would be a lesson about tilemaps in an example about particles.
 */
export const VILLAGER_START: Vec2Like = { x: 10.5, y: 6 };

/** Where the two braziers stand, in metres. */
export const TORCHES: readonly Vec2Like[] = [
  { x: 7.5, y: 6.2 },
  { x: 13.5, y: 6.2 },
];

/** Where the coin floats, in metres. */
export const COIN: Vec2Like = { x: 10.5, y: 9.2 };

/**
 * The brazier flame: the `fire` preset, shrunk to a village's scale and pinned to one spot.
 *
 * @returns The document.
 */
export function torchDefinition(): ParticleDefinition {
  return particleDefinition("fire", {
    main: { capacity: 64, duration: 1.5 },
    emission: { rateOverTime: 16 },
    shape: { kind: "cone", radius: 0.05, angle: 12 },
    start: {
      lifetime: { min: 0.5, max: 0.9 },
      speed: { min: 0.8, max: 1.4 },
      size: { min: 0.45, max: 0.75 },
    },
    forces: { gravityMultiplier: -0.05, drag: 1.4 },
  });
}

/**
 * The footstep puff: dust emitted **per metre walked**, not per second.
 *
 * @remarks
 * `simulationSpace: "world"` is what leaves a puff behind on the road rather than dragging it along
 * under her feet, and `rateOverDistance` is why there is no script: the emitter measures how far its
 * entity moved this frame and spawns from that.
 *
 * @returns The document.
 */
export function footstepDefinition(): ParticleDefinition {
  return particleDefinition("dust", {
    main: { capacity: 96, duration: 2, prewarm: false, simulationSpace: "world" },
    emission: { rateOverTime: 0, rateOverDistance: 5 },
    shape: { kind: "cone", radius: 0.12, angle: 70 },
    start: {
      lifetime: { min: 0.35, max: 0.75 },
      speed: { min: 0.2, max: 0.6 },
      size: { min: 0.18, max: 0.34 },
      color: [0.86, 0.8, 0.68, 0.7],
    },
    forces: { drag: 3, noise: null },
  });
}

/**
 * The coin glint: the `sparkle` preset, drawn from a four-frame sheet.
 *
 * @remarks
 * `renderer.sheet` is the one document field the 2D renderer reads differently: tile **n** of the
 * sheet is frame **n** of the atlas, so a four-tile sheet and a four-frame atlas line up and the
 * star opens and closes.
 *
 * @returns The document.
 */
export function sparkleDefinition(): ParticleDefinition {
  return particleDefinition("sparkle", {
    main: { capacity: 48, duration: 1.2 },
    emission: { rateOverTime: 9 },
    shape: { kind: "sphere", radius: 0.35, thickness: 0.6 },
    start: { lifetime: { min: 0.4, max: 0.9 }, size: { min: 0.3, max: 0.55 } },
    renderer: { sheet: { tiles: { x: 4, y: 1 }, frameOverTime: { fps: 9 } } },
  });
}

/** Everything the level is built from, once every load has settled. */
export interface LevelAssets {
  /** The Tiled map, as `importTiledMap` wrote it. */
  readonly map: AssetHandle<TilemapAsset>;
  /** The tileset the map draws from. */
  readonly tiles: AssetHandle<SpriteAtlasAsset>;
  /** The villager's sheet. */
  readonly villager: AssetHandle<SpriteAtlasAsset>;
  /** Her walk and idle clips. */
  readonly clips: AssetHandle<SpriteAnimationAsset>;
  /** The brazier flame's atlas. */
  readonly flame: AssetHandle<SpriteAtlasAsset>;
  /** The footstep puff's atlas. */
  readonly dust: AssetHandle<SpriteAtlasAsset>;
  /** The four-frame sparkle sheet's atlas. */
  readonly spark: AssetHandle<SpriteAtlasAsset>;
}

/**
 * Loads the seven documents the level is built from.
 *
 * @remarks
 * Awaited before `app.start()`, where a completed load settles at once; started after it, a load is
 * delivered in a later frame's `PreUpdate` — and a `ParticleSystem2D` whose atlas has not arrived
 * reports `IGX-1754` and draws nothing.
 *
 * @param app - The app being set up.
 * @returns The map, the atlases and the clips.
 */
export async function loadLevel(app: App): Promise<LevelAssets> {
  const [map, tiles, villager, clips, flame, dust, spark] = await Promise.all([
    app.assets.loadAsync<TilemapAsset>(ADDRESSES.map),
    app.assets.loadAsync<SpriteAtlasAsset>(ADDRESSES.tiles),
    app.assets.loadAsync<SpriteAtlasAsset>(ADDRESSES.villager),
    app.assets.loadAsync<SpriteAnimationAsset>(ADDRESSES.villagerClips),
    app.assets.loadAsync<SpriteAtlasAsset>(ADDRESSES.flame),
    app.assets.loadAsync<SpriteAtlasAsset>(ADDRESSES.dust),
    app.assets.loadAsync<SpriteAtlasAsset>(ADDRESSES.spark),
  ]);
  return { map, tiles, villager, clips, flame, dust, spark };
}

/**
 * How many sprites the 2D layers are holding: the tiles, the villager, and every live particle.
 *
 * @param app - The running app.
 * @returns The total.
 */
export function spritesDrawn(app: App): number {
  let total = 0;
  const layers = app.twoD.layers;
  for (let index = 0; index < layers.length; index += 1) {
    total += layers[index]?.count ?? 0;
  }
  return total;
}
