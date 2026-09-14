import type { ParticleDefinitionInput } from "../types.js";

/**
 * Motes in a shaft of light: tiny, slow, long-lived specks wandering on noise inside a flat box.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function dustPresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 200, duration: 6, looping: true, prewarm: true },
    emission: { rateOverTime: 12 },
    shape: { kind: "box", size: { x: 4, y: 2, z: 4 }, randomDirection: 1 },
    start: {
      lifetime: { min: 4, max: 8 },
      speed: { min: 0.05, max: 0.15 },
      size: { min: 0.02, max: 0.05 },
      color: [0.9, 0.88, 0.8, 0.6],
    },
    forces: {
      noise: { strength: 0.2, frequency: 0.5, scroll: { x: 0.05, y: 0.02, z: 0.05 }, octaves: 2 },
    },
    overLifetime: {
      color: {
        gradient: [
          [0, 1, 1, 1, 0],
          [0.2, 1, 1, 1, 1],
          [0.8, 1, 1, 1, 1],
          [1, 1, 1, 1, 0],
        ],
      },
    },
    renderer: { mode: "billboard", blend: "alpha" },
  };
}
