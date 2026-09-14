import type { ParticleDefinitionInput } from "../types.js";

/**
 * A slow grey plume: a wider cone than the fire, buoyant, drifting on noise, growing as it thins.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function smokePresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 128, duration: 4, looping: true, prewarm: true, renderOrder: 1 },
    emission: { rateOverTime: 12 },
    shape: { kind: "cone", radius: 0.3, angle: 20 },
    start: {
      lifetime: { min: 2, max: 3.5 },
      speed: { min: 0.6, max: 1.2 },
      size: { min: 0.5, max: 0.9 },
      rotation: { min: -180, max: 180 },
      color: { min: [0.35, 0.35, 0.38, 1], max: [0.6, 0.6, 0.62, 1] },
    },
    forces: {
      gravityMultiplier: -0.05,
      drag: 0.6,
      noise: { strength: 0.35, frequency: 0.8, scroll: { x: 0.1, y: 0.3, z: 0 }, octaves: 2 },
    },
    overLifetime: {
      color: {
        gradient: [
          [0, 1, 1, 1, 0],
          [0.2, 1, 1, 1, 0.5],
          [1, 1, 1, 1, 0],
        ],
      },
      size: {
        curve: {
          keys: [
            [0, 0.6, 0, 1],
            [1, 1.6, 1, 0],
          ],
        },
      },
      rotation: { min: -20, max: 20 },
    },
    renderer: { mode: "billboard", blend: "premultiplied" },
  };
}
