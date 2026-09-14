import type { ParticleDefinitionInput } from "../types.js";

/**
 * Snow over a ten-metre patch: slow, soft flakes that drift sideways on noise as they fall, in world
 * space. Place the emitter entity above the ground.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function snowPresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 1000, duration: 6, looping: true, prewarm: true, simulationSpace: "world" },
    emission: { rateOverTime: 80 },
    shape: { kind: "box", size: { x: 10, y: 0.1, z: 10 } },
    start: {
      lifetime: { min: 5, max: 8 },
      speed: { min: -0.6, max: -1.2 },
      size: { min: 0.03, max: 0.07 },
      rotation: { min: -180, max: 180 },
      color: [1, 1, 1, 0.9],
    },
    forces: {
      noise: { strength: 0.4, frequency: 0.4, scroll: { x: 0.1, y: 0, z: 0.05 }, octaves: 1 },
    },
    overLifetime: {
      color: {
        gradient: [
          [0, 1, 1, 1, 0],
          [0.1, 1, 1, 1, 1],
          [0.9, 1, 1, 1, 1],
          [1, 1, 1, 1, 0],
        ],
      },
      rotation: { min: -45, max: 45 },
    },
    renderer: { mode: "billboard", blend: "alpha" },
  };
}
