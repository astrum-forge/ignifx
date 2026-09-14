import { describeSchema } from "@ignifx/core";
import { TerrainScatter } from "./components/terrain-scatter.js";
import { Terrain } from "./components/terrain.js";
import { TERRAIN_FORMAT } from "./definition/types.js";
import { terrainFileSchema } from "./file-schemas.js";
import type { SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of everything `@ignifx/terrain` declares
 * (`docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * The **function** form is what a package uses rather than a `schemas` object, because building the
 * record means calling `describeSchema` and module scope holds declarations only
 * (`CONSTITUTION.md` §3.5).
 */

/**
 * Describes the `ignifx.terrain` file format.
 *
 * @returns The record `pnpm docs:schemas` renders.
 *
 * @public
 */
export function describeTerrainFormat(): SchemaDescription {
  return describeSchema("ignifx/terrain-file", terrainFileSchema(), {
    title: "Terrain",
    format: TERRAIN_FORMAT,
    description: "A terrain: size, resolution, a heightmap or seeded noise, chunking, layers, and the splat.",
  });
}

/**
 * Describes every component this package registers, plus the file format.
 *
 * @returns The record `pnpm docs:schemas` renders, keyed by schema id.
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return Object.freeze({
    "ignifx/Terrain": describeSchema("ignifx/Terrain", Terrain.schema, { title: "Terrain" }),
    "ignifx/TerrainScatter": describeSchema("ignifx/TerrainScatter", TerrainScatter.schema, {
      title: "Terrain scatter",
    }),
    "ignifx/terrain-file": describeTerrainFormat(),
  });
}
