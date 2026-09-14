import { describeSchema } from "@ignifx/core";
import { PARTICLES_FORMAT } from "./definition/types.js";
import { particlesFileSchema } from "./file-schemas.js";
import { ParticleSystem } from "./gpu/particle-system.js";
import { particlesSettingsSchema } from "./settings.js";
import type { SchemaDescription } from "@ignifx/core";

// What `pnpm docs:schemas` reads (`docs/architecture/16-docs-harness-and-skill.md` §3). These are
// functions rather than a `schemas` object because building the record calls `describeSchema`, and
// module scope holds declarations only (`CONSTITUTION.md` §3.5).

/**
 * Describes the `ignifx.particles` file format.
 *
 * @returns The record `pnpm docs:schemas` renders.
 *
 * @public
 */
export function describeParticlesFormat(): SchemaDescription {
  return describeSchema("ignifx/particles-file", particlesFileSchema(), {
    title: "Particles",
    format: PARTICLES_FORMAT,
    description:
      "A stateless GPU particle effect: capacity and timing, emission rates and bursts, an emitter shape, start values, forces, over-lifetime curves, and the renderer.",
  });
}

/**
 * Describes every component and settings section this package registers.
 *
 * @returns The record `pnpm docs:schemas` renders, keyed by schema id.
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return Object.freeze({
    "ignifx/ParticleSystem": describeSchema("ignifx/ParticleSystem", ParticleSystem.schema, {
      title: "Particle system",
    }),
    "ignifx/particles-settings": describeSchema("ignifx/particles-settings", particlesSettingsSchema(), {
      title: "Particles settings",
      description: "The particles project settings section.",
    }),
    "ignifx/particles-file": describeParticlesFormat(),
  });
}
