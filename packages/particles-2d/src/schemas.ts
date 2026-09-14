import { describeSchema } from "@ignifx/core";
import { ParticleSystem2D } from "./component/particle-system-2d.js";
import type { SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of what `@ignifx/particles-2d` declares
 * (`docs/architecture/16-docs-harness-and-skill.md` §3, `scripts/README.md`).
 *
 * The `ignifx.particles` **file format** is deliberately absent: `@ignifx/particles` declares it and
 * this package reads the very same document, so describing it twice would render the same table on
 * the formats page twice.
 */

/**
 * Describes every component this package declares.
 *
 * @returns The records, keyed by namespaced type id.
 *
 * @example
 * ```ts
 * const schemas = describeSchemas();
 * schemas["ignifx/ParticleSystem2D"].fields["sortingLayer"].default; // "Default"
 * ```
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return {
    "ignifx/ParticleSystem2D": describeSchema("ignifx/ParticleSystem2D", ParticleSystem2D.schema, {
      description: "Draws a .particles.json effect as sprites on a sorting layer.",
    }),
  };
}
