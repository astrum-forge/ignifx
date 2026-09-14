/**
 * The parts of the procedural terrain the panel never changes: its extent, its chunking, its four
 * tinted layers, the rules that paint them, and the shot.
 *
 * The layers carry a `color` and no `albedo`, which is the one thing a terrain built in code cannot
 * have: assembling a texture array needs decoded images, and only the `.terrain.json` loader
 * fetches those. A tinted terrain is the right trade here — every slider rebuilds the whole asset,
 * and rebuilding four texture arrays each time would be the slowest thing on screen.
 */

import { Environment, Light } from "ignifx";
import type { App, TerrainChunksDefinition, TerrainLayerInput, TerrainSize, TerrainSplatRuleInput } from "ignifx";

/** The field: 384 m across, 257 samples a side, eight chunks each way. */
export const FIELD: {
  readonly size: TerrainSize;
  readonly resolution: number;
  readonly chunks: TerrainChunksDefinition;
} = {
  size: { width: 384, depth: 384, height: 62 },
  // 2^8 + 1. Small enough that a rebuild is a few tens of milliseconds, which is what makes a
  // slider feel like a slider rather than a button.
  resolution: 257,
  chunks: { size: 32, lodLevels: 4, lodDistance: 110, skirtDepth: 2 },
};

/** The four layers, bottom to top. Order is channel order in the generated control map. */
export const LAYERS: readonly TerrainLayerInput[] = [
  { name: "sand", color: [0.82, 0.74, 0.55] },
  { name: "grass", color: [0.33, 0.46, 0.22] },
  { name: "rock", color: [0.42, 0.41, 0.39] },
  { name: "snow", color: [0.92, 0.94, 0.97] },
];

/**
 * Where each layer appears.
 *
 * @remarks
 * A rule claims a height band, a slope band, or both; the generator feathers every edge by a tenth
 * of the band's width, so the layers blend instead of stepping. A texel no rule reaches falls to
 * the first layer, which is why `sand` names no band at all.
 */
export const SPLAT_RULES: readonly TerrainSplatRuleInput[] = [
  { layer: "sand", height: [0, 9] },
  { layer: "grass", height: [5, 34], slope: [0, 34] },
  { layer: "rock", slope: [28, 90] },
  { layer: "snow", height: [46, 62], slope: [0, 44] },
];

/** The sky the field stands against. */
export const SKY = { r: 0.6, g: 0.71, b: 0.83, a: 1 } as const;

/** The fog colour: brighter than {@link SKY}, because fog is composited before tone mapping. */
export const HAZE = { r: 0.64, g: 0.75, b: 0.86, a: 1 } as const;

/** The opening shot: a slow turntable around the middle of the field. */
export const SHOT = { yaw: 34, pitch: 16, distance: 400, target: { x: 0, y: 20, z: 0 } } as const;

/**
 * Lights the field and builds its sky.
 *
 * @remarks
 * The sun is a direction and nothing else here: this scene casts no shadows, so the light's node
 * never has to sit above the ground the way a shadow-casting one does.
 *
 * @param app - The app the entities belong to.
 * @returns The environment, so the caller can drive its fog.
 */
export function createSky(app: App): Environment {
  const sun = app.world.createEntity("Sun");
  sun.transform.lookAt({ x: 0.5, y: -0.74, z: 0.45 });
  sun.addComponent(Light, { type: "directional", intensity: 3.2, color: { r: 1, g: 0.96, b: 0.88, a: 1 } });
  app.world.createEntity("Sky light").addComponent(Light, {
    type: "hemispheric",
    intensity: 0.9,
    color: SKY,
    groundColor: { r: 0.28, g: 0.27, b: 0.24, a: 1 },
  });
  const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: SKY });
  sky.imageProcessing.toneMapping = "aces";
  // Exponential-squared fog, so distance reads as depth rather than as a curtain at a fixed range.
  sky.fog.mode = "exp2";
  // Brighter than the clear colour: the fog colour is composited before tone mapping, so a haze
  // that matches the sky on paper reads darker than it on screen.
  sky.fog.color = HAZE;
  sky.fog.density = 0.0011;
  return sky;
}
