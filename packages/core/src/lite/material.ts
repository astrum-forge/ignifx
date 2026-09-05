import {
  createPbrMaterial,
  createShaderMaterial,
  createStandardMaterial,
  enableMaterialTracking,
  markMaterialUboDirty,
  rebuildMaterial,
  setPbrAlphaCutoff,
  setPbrEmissive,
  setPbrUnlit,
  setStandardBumpTexture,
  setStandardEmissiveTexture,
  setStandardOpacityTexture,
  setStandardSpecularTexture,
} from "@babylonjs/lite";
import { assertNever } from "../errors/ignifx-error.js";
import type {
  Material,
  PbrMaterialProps,
  SceneContext,
  ShaderMaterial,
  ShaderMaterialOptions,
  StandardMaterialProps,
  Texture2D,
} from "@babylonjs/lite";

/**
 * Material half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §2.6): the three
 * material kinds a `MaterialAsset` can produce, built from plain ignifx props.
 *
 * Everything here is `@internal`, and every colour that reaches it is **linear** — the sRGB decode
 * belongs to the asset layer.
 *
 * ## What a Lite material is (verified against `@babylonjs/lite@1.27.0`)
 *
 * - A material is plain data plus one private `_buildGroup` function; `createPbrMaterial` is
 *   literally `{ ...props, _buildGroup, _uboVersion: 0 }` (`lib/material/pbr/pbr-material.js`), so
 *   none of these factories touches the GPU and all of them run under the null engine.
 * - **The build group is a per-family singleton.** `getPbrGroupBuilder()`, `getStandardGroupBuilder()`
 *   and `getShaderGroupBuilder()` each memoise one function for the whole process
 *   (`lib/material/pbr/pbr-material.js`, `lib/material/standard/create-standard-material.js`,
 *   `lib/material/shader/shader-material.js` line 123), and a scene keys its renderable groups by
 *   that function (`lib/scene/scene-core.js`, `addToScene`). "Material family" in
 *   `docs/architecture/07-rendering.md` §1.1 therefore means *pbr*, *standard*, *shader* or *node* —
 *   **not** an individual material. Only node materials get a per-material builder
 *   (`lib/material/node/node-material.js`). This is what makes {@link warmUpMaterialFamilies} in
 *   `./gpu/warm-up.ts` cheap: one hidden mesh per family covers every material in it.
 * - Scalar and vector edits only need `markMaterialUboDirty` (`index.d.ts` 6974), which bumps
 *   `_uboVersion`. Anything that changes the compiled feature set — binding or clearing a texture,
 *   flipping `doubleSided`, changing culling — needs {@link rebuildMaterialPipelines}.
 */

/**
 * The Babylon Lite material a `MaterialAsset` owns, re-exported under an ignifx name
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteMaterial = Material;

/**
 * A Babylon Lite physically based material, re-exported under an ignifx name.
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LitePbrMaterial = PbrMaterialProps;

/**
 * A Babylon Lite Babylon-Standard material, re-exported under an ignifx name.
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteStandardMaterial = StandardMaterialProps;

/** glTF's default alpha cutoff, used when a `"mask"` material declares none. */
const DEFAULT_ALPHA_CUTOFF = 0.5;

/**
 * How a material's alpha channel is interpreted, in glTF's vocabulary.
 *
 * @internal
 */
export const MATERIAL_ALPHA_MODES = ["opaque", "mask", "blend"] as const;

/**
 * The union of the alpha modes a material can declare.
 *
 * @internal
 */
export type MaterialAlphaMode = (typeof MATERIAL_ALPHA_MODES)[number];

/**
 * The physically based material properties an ignifx `.material.json` declares
 * (`docs/architecture/06-serialization-and-scene-format.md` §6). Every field is optional; an
 * omitted field leaves Lite's own default in place.
 *
 * @internal
 */
export interface PbrMaterialInput {
  /** A human-readable name, used for glTF material overrides and diagnostics. */
  readonly name?: string;
  /** Linear base colour and alpha, multiplied with the base colour texture. */
  readonly baseColor?: readonly [number, number, number, number];
  /** The base colour texture. Load it with an sRGB format. */
  readonly baseColorTexture?: Texture2D;
  /** Metallic factor, 0 to 1. */
  readonly metallic?: number;
  /** Roughness factor, 0 to 1. */
  readonly roughness?: number;
  /** The packed occlusion/roughness/metallic texture (glTF `ORM`). */
  readonly metallicRoughnessTexture?: Texture2D;
  /** The tangent-space normal map. */
  readonly normalTexture?: Texture2D;
  /** Normal map strength. */
  readonly normalScale?: number;
  /** Linear emissive colour. */
  readonly emissive?: readonly [number, number, number];
  /** The emissive texture. */
  readonly emissiveTexture?: Texture2D;
  /** A separate occlusion texture, sampled on UV1 when the ORM texture is not used for it. */
  readonly occlusionTexture?: Texture2D;
  /** How strongly ambient occlusion darkens the surface, 0 to 1. */
  readonly occlusionStrength?: number;
  /** How the alpha channel is interpreted. */
  readonly alphaMode?: MaterialAlphaMode;
  /** The cutoff below which a `"mask"` material discards a fragment. */
  readonly alphaCutoff?: number;
  /** Overall material alpha, 0 to 1. */
  readonly alpha?: number;
  /** Whether back faces are drawn. */
  readonly doubleSided?: boolean;
  /** Whether lighting is skipped entirely. */
  readonly unlit?: boolean;
  /** How strongly the environment map contributes. */
  readonly environmentIntensity?: number;
}

/**
 * The Babylon-Standard material properties an ignifx `.material.json` declares, for the cheap
 * non-PBR path (`docs/architecture/07-rendering.md` §2.6).
 *
 * @internal
 */
export interface StandardMaterialInput {
  /** A human-readable name. */
  readonly name?: string;
  /** Linear diffuse colour. */
  readonly diffuse?: readonly [number, number, number];
  /** The diffuse texture. */
  readonly diffuseTexture?: Texture2D;
  /** Linear specular colour. */
  readonly specular?: readonly [number, number, number];
  /** Specular exponent; higher values give a tighter highlight. */
  readonly specularPower?: number;
  /** The specular texture. */
  readonly specularTexture?: Texture2D;
  /** Linear emissive colour. */
  readonly emissive?: readonly [number, number, number];
  /** The emissive texture. */
  readonly emissiveTexture?: Texture2D;
  /** The tangent-space normal map. */
  readonly normalTexture?: Texture2D;
  /** The opacity texture. */
  readonly opacityTexture?: Texture2D;
  /** Overall material alpha, 0 to 1. */
  readonly alpha?: number;
  /** The cutoff below which a fragment is discarded. `0` disables the alpha test. */
  readonly alphaCutoff?: number;
  /** Whether back faces are drawn. */
  readonly doubleSided?: boolean;
  /** Whether lighting is skipped entirely. */
  readonly unlit?: boolean;
}

/**
 * Builds a Lite PBR material from ignifx props.
 *
 * @param input - The declared properties.
 * @returns The material. It holds no GPU resource of its own; the textures it references do.
 *
 * @example
 * ```ts
 * const gold = createPbrMaterialFromProps({ baseColor: [1, 0.77, 0.34, 1], metallic: 1, roughness: 0.25 });
 * ```
 *
 * @internal
 */
export function createPbrMaterialFromProps(input: PbrMaterialInput): PbrMaterialProps {
  const props: Partial<PbrMaterialProps> = {};
  if (input.name !== undefined) {
    props.name = input.name;
  }
  if (input.baseColor !== undefined) {
    props.baseColorFactor = [input.baseColor[0], input.baseColor[1], input.baseColor[2], input.baseColor[3]];
  }
  if (input.baseColorTexture !== undefined) {
    props.baseColorTexture = input.baseColorTexture;
  }
  if (input.metallic !== undefined) {
    props.metallicFactor = input.metallic;
  }
  if (input.roughness !== undefined) {
    props.roughnessFactor = input.roughness;
  }
  if (input.metallicRoughnessTexture !== undefined) {
    props.ormTexture = input.metallicRoughnessTexture;
  }
  if (input.normalTexture !== undefined) {
    props.normalTexture = input.normalTexture;
  }
  if (input.normalScale !== undefined) {
    props.normalTextureScale = input.normalScale;
  }
  if (input.emissiveTexture !== undefined) {
    props.emissiveTexture = input.emissiveTexture;
  }
  if (input.occlusionTexture !== undefined) {
    props.occlusionTexture = input.occlusionTexture;
  }
  if (input.occlusionStrength !== undefined) {
    props.occlusionStrength = input.occlusionStrength;
  }
  if (input.alpha !== undefined) {
    props.alpha = input.alpha;
  }
  if (input.doubleSided !== undefined) {
    props.doubleSided = input.doubleSided;
  }
  if (input.environmentIntensity !== undefined) {
    props.environmentIntensity = input.environmentIntensity;
  }
  if (input.alphaMode === "blend") {
    props.alphaBlend = true;
  }
  const material = createPbrMaterial(props);
  if (input.alphaMode === "mask") {
    setPbrAlphaCutoff(material, input.alphaCutoff ?? DEFAULT_ALPHA_CUTOFF);
  }
  if (input.emissive !== undefined) {
    setPbrEmissive(material, [input.emissive[0], input.emissive[1], input.emissive[2]]);
  }
  if (input.unlit === true) {
    setPbrUnlit(material);
  }
  return material;
}

/**
 * Builds a Lite Standard material from ignifx props.
 *
 * @param input - The declared properties.
 * @returns The material.
 *
 * @internal
 */
export function createStandardMaterialFromProps(input: StandardMaterialInput): StandardMaterialProps {
  const material = createStandardMaterial();
  if (input.name !== undefined) {
    material.name = input.name;
  }
  if (input.diffuse !== undefined) {
    writeTriple(material.diffuseColor, input.diffuse);
  }
  if (input.specular !== undefined) {
    writeTriple(material.specularColor, input.specular);
  }
  if (input.emissive !== undefined) {
    writeTriple(material.emissiveColor, input.emissive);
  }
  if (input.specularPower !== undefined) {
    material.specularPower = input.specularPower;
  }
  if (input.alpha !== undefined) {
    material.alpha = input.alpha;
  }
  if (input.alphaCutoff !== undefined) {
    material.alphaCutOff = input.alphaCutoff;
  }
  if (input.doubleSided !== undefined) {
    material.backFaceCulling = !input.doubleSided;
  }
  if (input.unlit !== undefined) {
    material.disableLighting = input.unlit;
  }
  if (input.diffuseTexture !== undefined) {
    material.diffuseTexture = input.diffuseTexture;
  }
  if (input.specularTexture !== undefined) {
    setStandardSpecularTexture(material, input.specularTexture);
  }
  if (input.emissiveTexture !== undefined) {
    setStandardEmissiveTexture(material, input.emissiveTexture);
  }
  if (input.normalTexture !== undefined) {
    setStandardBumpTexture(material, input.normalTexture);
  }
  if (input.opacityTexture !== undefined) {
    setStandardOpacityTexture(material, input.opacityTexture);
  }
  return material;
}

/**
 * Builds a custom WGSL material.
 *
 * @remarks
 * Lite validates the declaration eagerly — a missing `position` attribute, a duplicate uniform
 * name, or an empty source throws immediately (`lib/material/shader/shader-material.js`) — but
 * compiles nothing until the material is first drawn, so this is safe under the null engine.
 *
 * @param options - The WGSL sources and the declared attribute, uniform, and sampler layout.
 * @returns The material.
 *
 * @internal
 */
export function createWgslMaterial(options: ShaderMaterialOptions): ShaderMaterial {
  return createShaderMaterial(options);
}

/**
 * The material a `MeshRenderer` uses when it declares none: a neutral, fully rough dielectric.
 *
 * @returns A fresh material. Callers share one instance per app rather than one per renderer.
 *
 * @internal
 */
export function createDefaultMaterial(): PbrMaterialProps {
  return createPbrMaterialFromProps({
    name: "ignifx:default",
    baseColor: [1, 1, 1, 1],
    metallic: 0,
    roughness: 0.9,
  });
}

/**
 * Replaces a PBR material's linear base colour.
 *
 * @param material - The material to change.
 * @param r - The linear red component.
 * @param g - The linear green component.
 * @param b - The linear blue component.
 * @param a - The alpha component.
 *
 * @internal
 */
export function setPbrBaseColor(material: PbrMaterialProps, r: number, g: number, b: number, a: number): void {
  const factor = material.baseColorFactor;
  if (factor === undefined) {
    material.baseColorFactor = [r, g, b, a];
  } else {
    factor[0] = r;
    factor[1] = g;
    factor[2] = b;
    factor[3] = a;
  }
  markMaterialDirty(material);
}

/**
 * Replaces a PBR material's metallic and roughness factors.
 *
 * @param material - The material to change.
 * @param metallic - The metallic factor, 0 to 1.
 * @param roughness - The roughness factor, 0 to 1.
 *
 * @internal
 */
export function setPbrMetallicRoughness(material: PbrMaterialProps, metallic: number, roughness: number): void {
  material.metallicFactor = metallic;
  material.roughnessFactor = roughness;
  markMaterialDirty(material);
}

/**
 * Replaces a material's overall alpha.
 *
 * @param material - The PBR or Standard material to change.
 * @param alpha - The new alpha, 0 to 1.
 *
 * @internal
 */
export function setMaterialAlpha(material: PbrMaterialProps | StandardMaterialProps, alpha: number): void {
  material.alpha = alpha;
  markMaterialDirty(material);
}

/**
 * Marks a material's uniform block for re-upload on the next frame.
 *
 * @remarks
 * This is the cheap path and covers every scalar, vector, and colour edit. It does **not** cover
 * changes that alter the compiled feature set; those go through {@link rebuildMaterialPipelines}.
 *
 * @param material - The material that changed.
 *
 * @internal
 */
export function markMaterialDirty(material: Material): void {
  markMaterialUboDirty(material);
}

/**
 * Rebuilds the renderables of a material whose compiled feature set changed.
 *
 * @remarks
 * Needed after binding or clearing a texture, changing culling, or toggling a sub-feature
 * (`index.d.ts` 9413). `rebuildFrameGraph` is left off so a component can batch several material
 * edits and rebuild the frame graph once.
 *
 * @param scene - The scene the material renders in.
 * @param material - The material that changed.
 *
 * @internal
 */
export function rebuildMaterialPipelines(scene: SceneContext, material: Material): void {
  rebuildMaterial(scene, material);
}

/**
 * Installs automatic dirty tracking on a material, so property writes mark its uniform block
 * without an explicit {@link markMaterialDirty}.
 *
 * @remarks
 * Lite installs the tracker by rewriting the material's property descriptors, and the module that
 * does it is loaded lazily, so this is asynchronous (`index.d.ts` 4480,
 * `lib/material/observable-material.js`). Opt-in only: it costs an accessor call per write, which
 * the zero-allocation rules (coding standards §7) do not want on every material.
 *
 * @param material - The PBR or Standard material to track.
 * @returns A promise that resolves once the tracker is installed.
 *
 * @internal
 */
export function enableMaterialChangeTracking(material: PbrMaterialProps | StandardMaterialProps): Promise<void> {
  return enableMaterialTracking(material);
}

/**
 * Reports whether Lite will alpha-blend a material declared with this alpha mode.
 *
 * @param mode - The declared alpha mode.
 * @returns `true` for `"blend"`, `false` for `"opaque"` and `"mask"`.
 *
 * @internal
 */
export function isBlendedAlphaMode(mode: MaterialAlphaMode): boolean {
  switch (mode) {
    case "opaque":
    case "mask":
      return false;
    case "blend":
      return true;
    default:
      return assertNever(mode, "material alpha mode");
  }
}

/**
 * Writes three components into a Lite colour tuple in place.
 *
 * @param target - The tuple Lite owns.
 * @param source - The values to copy.
 */
function writeTriple(target: [number, number, number], source: readonly [number, number, number]): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
}
