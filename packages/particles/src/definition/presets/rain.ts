import type { ParticleDefinitionInput } from "../types.js";

/**
 * Rain over a twelve-metre patch: fast, thin, stretched drops falling straight down in world space.
 * Place the emitter entity above the ground.
 *
 * @returns The preset's document, as authored.
 *
 * @public
 */
export function rainPresetInput(): ParticleDefinitionInput {
  return {
    format: "ignifx.particles",
    formatVersion: 1,
    main: { capacity: 2000, duration: 2, looping: true, prewarm: true, simulationSpace: "world" },
    emission: { rateOverTime: 600 },
    shape: { kind: "box", size: { x: 12, y: 0.1, z: 12 } },
    start: {
      lifetime: 1.2,
      speed: { min: -9, max: -11 },
      size: 0.02,
      color: [0.7, 0.8, 1, 0.5],
    },
    forces: { gravityMultiplier: 1 },
    renderer: { mode: "stretched", blend: "alpha", speedScale: 0.03, lengthScale: 1 },
  };
}
