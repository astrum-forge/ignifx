import type { ParticleDefinitionInput } from "../types.js";

/**
 * Glints on a pickup: still, short-lived, spinning stars that pop in and out over a small sphere.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function sparklePresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 64, duration: 1, looping: true, prewarm: true },
    emission: { rateOverTime: 20 },
    shape: { kind: "sphere", radius: 0.6, thickness: 0.5 },
    start: {
      lifetime: { min: 0.3, max: 0.8 },
      speed: 0,
      size: { min: 0.05, max: 0.12 },
      rotation: { min: -180, max: 180 },
      color: { min: [1, 1, 1, 1], max: [0.6, 0.9, 1, 1] },
    },
    overLifetime: {
      size: {
        curve: {
          keys: [
            [0, 0, 0, 4],
            [0.5, 1, 0, 0],
            [1, 0, -4, 0],
          ],
        },
      },
      rotation: { min: -90, max: 90 },
    },
    renderer: { mode: "billboard", blend: "additive" },
  };
}
