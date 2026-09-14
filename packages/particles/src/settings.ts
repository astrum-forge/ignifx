import { defineSchema, f32, u32, vec3 } from "@ignifx/core";
import type { Schema, Vec3Like } from "@ignifx/core";

// The `particles` project settings section (`docs/architecture/04-extensions.md` §5). Three
// project-wide decisions live here — the budget, the quality multiplier, and the world gravity;
// everything per effect is in the `.particles.json`.

/**
 * The section name as it appears in `ignifx.config.ts`.
 *
 * @public
 */
export const PARTICLES_SETTINGS_SECTION = "particles";

/** How many particles every system together may hold, unless the project says otherwise. */
const DEFAULT_MAX_PARTICLES = 100_000;

/** Standard gravity, matching `@ignifx/physics`'s own default. */
const DEFAULT_GRAVITY: Vec3Like = Object.freeze({ x: 0, y: -9.81, z: 0 });

/**
 * The resolved `particles` settings section.
 *
 * @example
 * ```ts
 * // ignifx.config.ts
 * export default defineConfig({
 *   particles: { maxParticles: 50_000, qualityScale: 1 },
 * });
 * ```
 *
 * @public
 */
export interface ParticlesSettings {
  /**
   * The budget every `ParticleSystem`'s `capacity` is counted against. A system that would push the
   * total over it is clamped to what is left and `IGX-1702` is logged once.
   */
  readonly maxParticles: number;
  /** A `0`–`1` multiplier on every emission rate and burst count, for settings screens. */
  readonly qualityScale: number;
  /**
   * The world gravity, in metres per second squared, a definition's `forces.gravityMultiplier`
   * scales. When `@ignifx/physics` is registered and this stays at its default, the physics
   * section's gravity is used instead.
   */
  readonly gravity: Vec3Like;
}

/**
 * The values used for everything a project omits.
 *
 * @returns The default `particles` section.
 *
 * @public
 */
export function defaultParticlesSettings(): ParticlesSettings {
  return { maxParticles: DEFAULT_MAX_PARTICLES, qualityScale: 1, gravity: { ...DEFAULT_GRAVITY } };
}

/**
 * The schema the `particles` section is validated against.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function particlesSettingsSchema(): Schema {
  return defineSchema({
    maxParticles: u32(DEFAULT_MAX_PARTICLES, {
      min: 0,
      tooltip: "The particle budget every ParticleSystem capacity is counted against.",
    }),
    qualityScale: f32(1, { min: 0, max: 1, tooltip: "A 0-1 multiplier on emission rates and burst counts." }),
    gravity: vec3(DEFAULT_GRAVITY, { tooltip: "The world gravity a gravityMultiplier scales, in m/s^2." }),
  });
}
