import type { ParticleDefinitionInput } from "../types.js";

/**
 * One blast: a single burst of fast fireballs from a small sphere that brake hard, swell, and fade.
 * Non-looping; `onStopped` fires when the last one is gone.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function explosionPresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 256, duration: 1, looping: false },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: 150, cycles: 1 }] },
    shape: { kind: "sphere", radius: 0.15, randomDirection: 0.2 },
    start: {
      lifetime: { min: 0.6, max: 1.4 },
      speed: { min: 4, max: 9 },
      size: { min: 0.3, max: 0.7 },
      rotation: { min: -180, max: 180 },
      color: { min: [1, 0.3, 0.05, 1], max: [1, 0.7, 0.2, 1] },
    },
    forces: { gravityMultiplier: 0.3, drag: 2.5 },
    overLifetime: {
      color: {
        gradient: [
          [0, 1, 1, 1, 1],
          [0.5, 1, 0.8, 0.6, 0.8],
          [1, 0.3, 0.3, 0.3, 0],
        ],
      },
      size: {
        curve: {
          keys: [
            [0, 0.4, 0, 3],
            [0.3, 1, 0, 0],
            [1, 0.7, -0.5, 0],
          ],
        },
      },
      rotation: { min: -60, max: 60 },
    },
    renderer: { mode: "billboard", blend: "additive" },
  };
}
