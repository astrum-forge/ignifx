import { MATERIAL_ALPHA_MODES } from "../lite/material.js";
import { describeSchema } from "../schema/describe.js";
import { describeSceneFileFormat } from "../serialization/scene-file.js";
import { Camera } from "./camera.js";
import { ENVIRONMENT_FILE_FORMAT, ENVIRONMENT_FORMAT_VERSION } from "./environment-asset.js";
import { Environment } from "./environment.js";
import { Light } from "./light.js";
import { MATERIAL_FILE_FORMAT, MATERIAL_FORMAT_VERSION, MATERIAL_KINDS } from "./material-asset.js";
import { MeshRenderer } from "./mesh-renderer.js";
import { Model } from "./model.js";
import { PostProcessStack } from "./post-process-stack.js";
import type { SchemaDescription } from "../schema/describe.js";

/**
 * The documentation harness's view of everything `@ignifx/core` declares
 * (`scripts/README.md`, "Schema discovery convention";
 * `docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * `pnpm docs:schemas` imports the built entry point, calls {@link describeSchemas}, and turns the
 * result into `references/formats/<format>.md` and `ignifx.schemas.json`. The **function** form is
 * what a package uses rather than a `schemas` object, because building the record means calling
 * `describeSchema` for every component and module scope holds declarations only
 * (`CONSTITUTION.md` §3.5).
 *
 * ## Two corrections to the convention
 *
 * The harness requires every key to be a namespaced `<package>/<Name>` type id
 * (`scripts/lib/schema-source.ts` rejects a key with no `/`), and it groups entries onto a page by
 * their `format`. A *file* format is not a component and has no type id, so the three file formats
 * below are keyed `ignifx/scene-file`, `ignifx/material-file`, and `ignifx/environment-file` while
 * declaring `format: "ignifx.scene"`, `"ignifx.material"`, and `"ignifx.environment"`. The wave-1
 * hand-off asked for the key `"ignifx.scene"`; that key fails the namespacing check, and the
 * grouping — which is what actually decides the page — comes from `format` either way.
 */

/**
 * Describes every component and file format this package declares, for the documentation harness.
 *
 * @returns The records, keyed by namespaced type id.
 *
 * @example
 * ```ts
 * const schemas = describeSchemas();
 * schemas["ignifx/Camera"].fields["fov"].default; // 60
 * ```
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return {
    "ignifx/Camera": describeSchema("ignifx/Camera", Camera.schema, {
      description: "The camera an entity renders the world through; the entity's transform is the view.",
    }),
    "ignifx/Light": describeSchema("ignifx/Light", Light.schema, {
      description: "A directional, point, spot, or hemispheric light, with optional shadow casting.",
    }),
    "ignifx/MeshRenderer": describeSchema("ignifx/MeshRenderer", MeshRenderer.schema, {
      description: "Draws one clone of a mesh asset with a material.",
    }),
    "ignifx/Model": describeSchema("ignifx/Model", Model.schema, {
      description: "One instance of a loaded glTF, cloned under the entity's node.",
    }),
    "ignifx/Environment": describeSchema("ignifx/Environment", Environment.schema, {
      description: "The world's image-based lighting, skybox, fog, image processing, and clear colour.",
    }),
    "ignifx/PostProcessStack": describeSchema("ignifx/PostProcessStack", PostProcessStack.schema, {
      description: "Bloom, SMAA, and image processing, inserted into the scene's frame graph.",
    }),
    "ignifx/scene-file": describeSceneFileFormat(),
    "ignifx/material-file": describeMaterialFileFormat(),
    "ignifx/environment-file": describeEnvironmentFileFormat(),
  };
}

/**
 * Describes the `ignifx.material` file format
 * (`docs/architecture/06-serialization-and-scene-format.md` §6, `07-rendering.md` §2.6).
 *
 * @returns The description of the top-level file fields.
 *
 * @public
 */
export function describeMaterialFileFormat(): SchemaDescription {
  return {
    title: "Material file",
    format: MATERIAL_FILE_FORMAT,
    description:
      'A PBR or Standard material: colours in sRGB, factors unitless, textures as { "$asset": … } references.',
    fields: {
      format: { kind: "str", default: MATERIAL_FILE_FORMAT, description: `Always "${MATERIAL_FILE_FORMAT}".` },
      formatVersion: {
        kind: "u32",
        default: MATERIAL_FORMAT_VERSION,
        description: "The file format version; 1 before ignifx 1.0.",
      },
      type: {
        kind: "enum",
        default: "pbr",
        description: `The material family: ${MATERIAL_KINDS.join(", ")}. "shader" is declared but not implemented; it is rejected with IGX-0708.`,
      },
      name: { kind: "str", default: "", description: "A human-readable name; glTF overrides match on it." },
      baseColor: { kind: "color", default: [1, 1, 1, 1], description: "PBR: sRGB base colour and alpha." },
      metallic: { kind: "f32", default: 1, description: "PBR: metallic factor, 0 to 1." },
      roughness: { kind: "f32", default: 1, description: "PBR: roughness factor, 0 to 1." },
      normalScale: { kind: "f32", default: 1, description: "PBR: normal map strength." },
      emissive: { kind: "color", default: [0, 0, 0, 1], description: "sRGB emissive colour." },
      occlusionStrength: { kind: "f32", default: 1, description: "PBR: how strongly occlusion darkens." },
      alphaMode: {
        kind: "enum",
        default: "opaque",
        description: `How alpha is read: ${MATERIAL_ALPHA_MODES.join(", ")}.`,
      },
      alphaCutoff: { kind: "f32", default: 0.5, description: 'The cutoff a "mask" material discards below.' },
      alpha: { kind: "f32", default: 1, description: "Overall material alpha, 0 to 1." },
      doubleSided: { kind: "bool", default: false, description: "Whether back faces are drawn." },
      unlit: { kind: "bool", default: false, description: "Whether lighting is skipped entirely." },
      environmentIntensity: { kind: "f32", default: 1, description: "PBR: environment map contribution." },
      diffuse: { kind: "color", default: [1, 1, 1, 1], description: "Standard: sRGB diffuse colour." },
      specular: { kind: "color", default: [1, 1, 1, 1], description: "Standard: sRGB specular colour." },
      specularPower: { kind: "f32", default: 64, description: "Standard: specular exponent." },
      baseColorTexture: { kind: "asset", default: null, description: "PBR: the base colour map (sRGB)." },
      metallicRoughnessTexture: { kind: "asset", default: null, description: "PBR: the packed ORM map." },
      normalTexture: { kind: "asset", default: null, description: "The tangent-space normal map." },
      emissiveTexture: { kind: "asset", default: null, description: "The emissive map (sRGB)." },
      occlusionTexture: { kind: "asset", default: null, description: "PBR: a separate occlusion map." },
      diffuseTexture: { kind: "asset", default: null, description: "Standard: the diffuse map (sRGB)." },
      specularTexture: { kind: "asset", default: null, description: "Standard: the specular map." },
      opacityTexture: { kind: "asset", default: null, description: "Standard: the opacity map." },
    },
  };
}

/**
 * Describes the `ignifx.environment` file format
 * (`docs/architecture/06-serialization-and-scene-format.md` §6, `07-rendering.md` §2.5).
 *
 * @returns The description of the top-level file fields.
 *
 * @public
 */
export function describeEnvironmentFileFormat(): SchemaDescription {
  return {
    title: "Environment file",
    format: ENVIRONMENT_FILE_FORMAT,
    description: "An image-based lighting environment, its BRDF lookup table, and its skybox.",
    fields: {
      format: { kind: "str", default: ENVIRONMENT_FILE_FORMAT, description: `Always "${ENVIRONMENT_FILE_FORMAT}".` },
      formatVersion: {
        kind: "u32",
        default: ENVIRONMENT_FORMAT_VERSION,
        description: "The file format version; 1 before ignifx 1.0.",
      },
      environment: { kind: "str", default: "", description: "The .env address holding the prefiltered cube map." },
      brdfLut: { kind: "str", default: "", description: "The RGBD BRDF table; empty takes rendering.brdfLut." },
      skybox: { kind: "str", default: "", description: "A .dds or .env skybox address; empty for none." },
      skyboxSize: { kind: "f32", default: 20, description: "The skybox cube's size, in metres." },
      skyboxEnabled: { kind: "bool", default: true, description: "Whether a skybox is drawn at all." },
      blur: { kind: "f32", default: 0, description: "How blurred the specular reflection is, 0 to 1." },
      rotation: { kind: "f32", default: 0, description: "Rotation around world Y, in degrees." },
    },
  };
}
