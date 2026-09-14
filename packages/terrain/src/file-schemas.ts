import { array, bool, defineSchema, f32, record, str, u32 } from "@ignifx/core";
import { TERRAIN_FORMAT, TERRAIN_FORMAT_VERSION } from "./definition/types.js";
import type { Schema } from "@ignifx/core";

/**
 * The declarative schema of the one file format `@ignifx/terrain` reads
 * (`docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * It is for **documentation and tooling**: `defineTerrain` validates with hand-written checks that
 * name the offending field. A test asserts that a document the loader accepts also validates here.
 */

/**
 * The `ignifx.terrain` document schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function terrainFileSchema(): Schema {
  return defineSchema({
    format: str(TERRAIN_FORMAT, { tooltip: "Always ignifx.terrain." }),
    formatVersion: u32(TERRAIN_FORMAT_VERSION, { tooltip: "The document version this build reads." }),
    name: str("", { tooltip: "A human-readable name; the file's basename when empty." }),
    size: record(
      {
        width: f32(512, { min: 0, tooltip: "Extent along X, in metres." }),
        depth: f32(512, { min: 0, tooltip: "Extent along Z, in metres." }),
        height: f32(80, { min: 0, tooltip: "The height a full-scale sample reaches, in metres." }),
      },
      { tooltip: "The terrain's extent, in metres." },
    ),
    resolution: u32(513, { min: 3, tooltip: "Samples per side; 2^n + 1." }),
    heightmap: record(
      { source: str("", { tooltip: "A .r16 or PNG address, relative to this document." }) },
      { tooltip: "Where the heights come from; omit it for noise." },
    ),
    noise: record(
      {
        seed: u32(1, { tooltip: "The seed; the same seed always produces the same field." }),
        octaves: u32(6, { min: 1, max: 16, tooltip: "How many octaves are summed." }),
        frequency: f32(0.004, { min: 0, tooltip: "The first octave's frequency, in cycles per metre." }),
        lacunarity: f32(2, { min: 0, tooltip: "How much the frequency grows per octave." }),
        persistence: f32(0.5, { min: 0, tooltip: "How much the amplitude shrinks per octave." }),
        ridged: bool(false, { tooltip: "Sharp crests rather than rolling hills." }),
        terraces: u32(0, { tooltip: "How many flat steps the height is quantised into; 0 leaves it smooth." }),
      },
      { tooltip: "The seeded fractal noise used when there is no heightmap." },
    ),
    chunks: record(
      {
        size: u32(64, { min: 1, tooltip: "Quads per chunk side." }),
        lodLevels: u32(4, { min: 1, max: 8, tooltip: "How many LOD meshes each chunk carries." }),
        lodDistance: f32(96, { min: 0, tooltip: "Metres at which level 1 takes over; each level doubles it." }),
        skirtDepth: f32(2, { min: 0, tooltip: "How far every LOD mesh's edges hang down, in metres." }),
      },
      { tooltip: "How the field is cut into chunks." },
    ),
    layers: array(
      record({
        name: str("", { tooltip: "The layer's name; what a splat rule and a TerrainScatter refer to." }),
        albedo: str("", { tooltip: "The albedo texture's address; empty for a flat colour." }),
        normal: str("", { tooltip: "The tangent-space normal map's address; empty for none." }),
        tiling: f32(8, { min: 0, tooltip: "How many metres one repeat of the textures spans." }),
        triplanar: bool(false, { tooltip: "Whether the layer projects along all three axes." }),
      }),
      [],
      { tooltip: "The layers, 1 to 8, in control-channel order." },
    ),
    splat: record(
      {
        control: array(str(), [], { tooltip: "RGBA control map addresses; the second covers layers 5-8." }),
      },
      { tooltip: "Painted splat weights; omit it to generate them from rules." },
    ),
    splatRules: array(
      record({
        layer: str("", { tooltip: "The layer the rule paints." }),
        height: array(f32(), [], { tooltip: "The [min, max] height band, in metres." }),
        slope: array(f32(), [], { tooltip: "The [min, max] slope band, in degrees." }),
      }),
      [],
      { tooltip: "Rules that generate the splat weights." },
    ),
    material: record(
      {
        roughness: f32(0.9, { min: 0, max: 1, tooltip: "Roughness factor for the whole surface." }),
        metallic: f32(0, { min: 0, max: 1, tooltip: "Metallic factor for the whole surface." }),
      },
      { tooltip: "The PBR factors every layer shares; per-layer roughness is not available." },
    ),
  });
}
