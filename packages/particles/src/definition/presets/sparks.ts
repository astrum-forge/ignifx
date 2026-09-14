import type { ParticleDefinitionInput } from "../types.js";

/**
 * Embers thrown from a fire: bright stretched streaks in bursts every half second, pulled down by
 * gravity and slowed by drag.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function sparksPresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 200, duration: 2, looping: true },
    emission: {
      rateOverTime: 6,
      bursts: [{ time: 0, count: { min: 12, max: 24 }, cycles: 0, interval: 0.5, probability: 0.8 }],
    },
    shape: { kind: "cone", radius: 0.08, angle: 35 },
    start: {
      lifetime: { min: 0.4, max: 1.2 },
      speed: { min: 3, max: 7 },
      size: 0.035,
      color: { min: [1, 0.75, 0.3, 1], max: [1, 0.95, 0.7, 1] },
    },
    forces: { gravityMultiplier: 1, drag: 0.8 },
    overLifetime: {
      color: {
        gradient: [
          [0, 1, 1, 1, 1],
          [0.7, 1, 1, 1, 1],
          [1, 1, 0.4, 0.1, 0],
        ],
      },
    },
    renderer: { mode: "stretched", blend: "additive", speedScale: 0.04, lengthScale: 1.5 },
  };
}
