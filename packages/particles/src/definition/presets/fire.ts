import type { ParticleDefinitionInput } from "../types.js";

/**
 * A campfire flame: a narrow upward cone of soft, additive, orange-to-yellow puffs that rise, shrink
 * and fade.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function firePresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 256, duration: 2, looping: true, prewarm: true },
    emission: { rateOverTime: 40 },
    shape: { kind: "cone", radius: 0.25, angle: 12 },
    start: {
      lifetime: { min: 0.8, max: 1.4 },
      speed: { min: 1, max: 2 },
      size: { min: 0.35, max: 0.6 },
      rotation: { min: -180, max: 180 },
      color: { min: [1, 0.35, 0.05, 1], max: [1, 0.85, 0.2, 1] },
    },
    forces: {
      gravityMultiplier: -0.25,
      drag: 1,
      noise: { strength: 0.15, frequency: 1.5, scroll: { x: 0, y: 0.6, z: 0 }, octaves: 1 },
    },
    overLifetime: {
      color: {
        gradient: [
          [0, 1, 1, 1, 0],
          [0.15, 1, 1, 1, 1],
          [1, 1, 0.6, 0.3, 0],
        ],
      },
      size: {
        curve: {
          keys: [
            [0, 1, 0, 0],
            [1, 0.15, -1, -1],
          ],
        },
      },
    },
    renderer: { mode: "billboard", blend: "additive" },
  };
}
