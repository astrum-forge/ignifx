import type { ParticleDefinitionInput } from "../types.js";

/**
 * Autumn leaves over a six-metre patch: few, tumbling, orange-to-brown flakes that fall slowly and
 * wander on noise, in world space.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function leavesPresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 128, duration: 6, looping: true, prewarm: true, simulationSpace: "world" },
    emission: { rateOverTime: 6 },
    shape: { kind: "box", size: { x: 6, y: 0.1, z: 6 } },
    start: {
      lifetime: { min: 4, max: 7 },
      speed: { min: -0.4, max: -0.8 },
      size: { min: 0.1, max: 0.18 },
      rotation: { min: -180, max: 180 },
      color: { min: [0.9, 0.45, 0.1, 1], max: [0.45, 0.25, 0.08, 1] },
    },
    forces: {
      gravityMultiplier: 0.05,
      drag: 0.5,
      noise: { strength: 0.6, frequency: 0.6, scroll: { x: 0.2, y: 0, z: 0.1 }, octaves: 2 },
    },
    overLifetime: {
      rotation: { min: -120, max: 120 },
      color: {
        gradient: [
          [0, 1, 1, 1, 1],
          [0.9, 1, 1, 1, 1],
          [1, 1, 1, 1, 0],
        ],
      },
    },
    renderer: { mode: "billboard", blend: "alpha" },
  };
}
