import { CoreErrorCode } from "../../errors/error-codes.js";
import { IgnifxError } from "../../errors/ignifx-error.js";
import {
  assertMaterialKindSupported,
  buildMaterialAsset,
  MATERIAL_ASSET_TYPE,
  MATERIAL_FILE_EXTENSION,
  MATERIAL_FILE_FORMAT,
  MATERIAL_FORMAT_VERSION,
  MATERIAL_KINDS,
  PBR_TEXTURE_SLOTS,
  pbrMaterialDefinition,
  STANDARD_TEXTURE_SLOTS,
  standardMaterialDefinition,
} from "../material-asset.js";
import type { AssetHandle, AssetLoader, LoaderContext } from "../../assets/types.js";
import type { MaterialAlphaMode } from "../../lite/material.js";
import type { ColorLike } from "../../math/types.js";
import type { JsonValue } from "../../schema/json.js";
import type { MaterialAsset, MaterialDefinition, MaterialKind } from "../material-asset.js";
import type { TextureAsset } from "../texture-asset.js";

/**
 * The `material` asset loader: `.material.json` to `MaterialAsset`
 * (`docs/architecture/05-assets-and-loading.md` §5, `06-serialization-and-scene-format.md` §6).
 *
 * ## The file
 *
 * ```json
 * {
 *   "format": "ignifx.material",
 *   "formatVersion": 1,
 *   "type": "pbr",
 *   "name": "Gold",
 *   "baseColor": [1, 0.77, 0.34, 1],
 *   "metallic": 1,
 *   "roughness": 0.25,
 *   "baseColorTexture": { "$asset": "textures/gold-albedo.png" }
 * }
 * ```
 *
 * Colours are sRGB arrays of four numbers, the same encoding a `color()` schema field uses
 * (`06-serialization-and-scene-format.md` §3), and textures are `{ "$asset": … }` references pulled
 * in with `ctx.loadDependency` so their reference counts and their progress fold into this load.
 *
 * ## Missing and malformed values do not fail the load
 *
 * A material is content, and `CONSTITUTION.md` §3.9 wants content problems to degrade rather than
 * stop a game. A property of the wrong type takes its default; a texture that fails to load leaves
 * its slot unbound and the material draws without it. Only two things throw: a file that is not an
 * `ignifx.material` at all (`IGX-0709`), and one that declares a family this build cannot construct
 * (`IGX-0708`).
 */

/**
 * Builds the loader for `.material.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createMaterialLoader());
 * ```
 *
 * @public
 */
export function createMaterialLoader(): AssetLoader<MaterialAsset> {
  return {
    type: MATERIAL_ASSET_TYPE,
    extensions: [MATERIAL_FILE_EXTENSION],
    async load(ctx: LoaderContext): Promise<MaterialAsset> {
      const parsed: unknown = await ctx.fetchJson();
      const file = readMaterialFile(parsed, ctx.address);
      const kind = readKind(file, ctx.address);
      assertMaterialKindSupported(kind, ctx.address);
      const slots = kind === "pbr" ? PBR_TEXTURE_SLOTS : STANDARD_TEXTURE_SLOTS;
      const addresses = readTextureAddresses(file, slots);
      const textures = await loadTextures(ctx, addresses);
      const definition = kind === "pbr" ? readPbr(file, addresses) : readStandard(file, addresses);
      return buildMaterialAsset(definition, textures);
    },
  };
}

/**
 * Reads and checks a `.material.json`'s header.
 *
 * @param parsed - The parsed JSON.
 * @param address - The address, for diagnostics.
 * @returns The file body.
 * @throws IgnifxError with code `IGX-0709` when the header is missing or `IGX-0603` when the format
 * version is not readable.
 */
function readMaterialFile(parsed: unknown, address: string): Record<string, unknown> {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw notAMaterial(address);
  }
  // Boundary assertion (coding standards §5.2): the array and `null` cases are gone, so what is
  // left is a JSON object read by name.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const file = parsed as Record<string, unknown>;
  if (file["format"] !== MATERIAL_FILE_FORMAT) {
    throw notAMaterial(address);
  }
  const version = file["formatVersion"];
  if (version !== MATERIAL_FORMAT_VERSION) {
    throw new IgnifxError(
      CoreErrorCode.unsupportedFormatVersion,
      `${address} declares format version ${String(version)}, which this build cannot read.`,
      {
        context: { file: address, version: String(version) },
        hint: `This build reads ${MATERIAL_FILE_FORMAT} version ${String(MATERIAL_FORMAT_VERSION)}.`,
      },
    );
  }
  return file;
}

/**
 * Builds the "not a material file" failure.
 *
 * @param address - The address that failed.
 * @returns The error to throw.
 */
function notAMaterial(address: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidAssetFile, `${address} is not an ${MATERIAL_FILE_FORMAT} file.`, {
    context: { file: address, format: MATERIAL_FILE_FORMAT },
    hint: `A material file carries { "format": "${MATERIAL_FILE_FORMAT}", "formatVersion": ${String(MATERIAL_FORMAT_VERSION)} }.`,
  });
}

/**
 * Reads the file's `type` discriminator.
 *
 * @param file - The file body.
 * @param address - The address, for diagnostics.
 * @returns The declared family; `"pbr"` when the file names none.
 * @throws IgnifxError with code `IGX-0708` when the file names a family that is not a family.
 */
function readKind(file: Record<string, unknown>, address: string): MaterialKind {
  const declared = file["type"];
  if (declared === undefined) {
    return "pbr";
  }
  for (const kind of MATERIAL_KINDS) {
    if (declared === kind) {
      return kind;
    }
  }
  throw new IgnifxError(
    CoreErrorCode.unsupportedMaterialKind,
    `${address} declares the material kind ${JSON.stringify(declared)}, which this build cannot construct.`,
    {
      context: { asset: address, kind: JSON.stringify(declared) },
      hint: `Declare one of ${MATERIAL_KINDS.join(", ")}.`,
    },
  );
}

/**
 * Collects the `{ "$asset": … }` addresses the file bound to texture slots, in slot order.
 *
 * @param file - The file body.
 * @param slots - The slot names this family understands.
 * @returns Slot name to address, for the slots the file bound.
 */
function readTextureAddresses(file: Record<string, unknown>, slots: readonly string[]): Record<string, string> {
  const addresses: Record<string, string> = {};
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot === undefined) {
      continue;
    }
    const value = file[slot];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object read by name.
    const address = (value as Record<string, unknown>)["$asset"];
    if (typeof address === "string" && address !== "") {
      addresses[slot] = address;
    }
  }
  return addresses;
}

/**
 * Loads every bound texture as a dependency, in slot order.
 *
 * @remarks
 * A texture that fails to load leaves its slot unbound rather than failing the material: a missing
 * normal map is a visual defect, not a reason for a level not to start.
 *
 * @param ctx - The loader context.
 * @param addresses - Slot name to address.
 * @returns The handles, in the same order as `Object.keys(addresses)`.
 */
async function loadTextures(
  ctx: LoaderContext,
  addresses: Record<string, string>,
): Promise<readonly AssetHandle<TextureAsset>[]> {
  const slots = Object.keys(addresses);
  const requests: Promise<AssetHandle<TextureAsset> | null>[] = [];
  for (let index = 0; index < slots.length; index += 1) {
    const address = addresses[slots[index] ?? ""] ?? "";
    requests.push(ctx.loadDependency<TextureAsset>(address).catch((): null => null));
  }
  const settled = await Promise.all(requests);
  const handles: AssetHandle<TextureAsset>[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const handle = settled[index];
    if (handle !== null && handle !== undefined) {
      handles.push(handle);
    }
  }
  return handles;
}

/**
 * Reads the PBR properties over their defaults.
 *
 * @param file - The file body.
 * @param textures - Slot name to address.
 * @returns The declaration.
 */
function readPbr(file: Record<string, unknown>, textures: Record<string, string>): MaterialDefinition {
  return pbrMaterialDefinition({
    name: readString(file, "name", ""),
    baseColor: readColor(file, "baseColor", { r: 1, g: 1, b: 1, a: 1 }),
    metallic: readNumber(file, "metallic", 1),
    roughness: readNumber(file, "roughness", 1),
    normalScale: readNumber(file, "normalScale", 1),
    emissive: readColor(file, "emissive", { r: 0, g: 0, b: 0, a: 1 }),
    occlusionStrength: readNumber(file, "occlusionStrength", 1),
    alphaMode: readAlphaMode(file),
    alphaCutoff: readNumber(file, "alphaCutoff", 0.5),
    alpha: readNumber(file, "alpha", 1),
    doubleSided: readBoolean(file, "doubleSided", false),
    unlit: readBoolean(file, "unlit", false),
    environmentIntensity: readNumber(file, "environmentIntensity", 1),
    textures,
  });
}

/**
 * Reads the Standard properties over their defaults.
 *
 * @param file - The file body.
 * @param textures - Slot name to address.
 * @returns The declaration.
 */
function readStandard(file: Record<string, unknown>, textures: Record<string, string>): MaterialDefinition {
  return standardMaterialDefinition({
    name: readString(file, "name", ""),
    diffuse: readColor(file, "diffuse", { r: 1, g: 1, b: 1, a: 1 }),
    specular: readColor(file, "specular", { r: 1, g: 1, b: 1, a: 1 }),
    specularPower: readNumber(file, "specularPower", 64),
    emissive: readColor(file, "emissive", { r: 0, g: 0, b: 0, a: 1 }),
    alpha: readNumber(file, "alpha", 1),
    alphaCutoff: readNumber(file, "alphaCutoff", 0),
    doubleSided: readBoolean(file, "doubleSided", false),
    unlit: readBoolean(file, "unlit", false),
    textures,
  });
}

/**
 * Reads the `alphaMode` discriminator.
 *
 * @param file - The file body.
 * @returns The declared mode, or `"opaque"`.
 */
function readAlphaMode(file: Record<string, unknown>): MaterialAlphaMode {
  const value = file["alphaMode"];
  return value === "mask" || value === "blend" ? value : "opaque";
}

/**
 * Reads a number property.
 *
 * @param file - The file body.
 * @param key - The property name.
 * @param fallback - What to use when it is absent or not a finite number.
 * @returns The value.
 */
function readNumber(file: Record<string, unknown>, key: string, fallback: number): number {
  const value = file[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Reads a boolean property.
 *
 * @param file - The file body.
 * @param key - The property name.
 * @param fallback - What to use when it is absent or not a boolean.
 * @returns The value.
 */
function readBoolean(file: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = file[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Reads a string property.
 *
 * @param file - The file body.
 * @param key - The property name.
 * @param fallback - What to use when it is absent or not a string.
 * @returns The value.
 */
function readString(file: Record<string, unknown>, key: string, fallback: string): string {
  const value = file[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads an sRGB colour written as `[r, g, b]` or `[r, g, b, a]`.
 *
 * @param file - The file body.
 * @param key - The property name.
 * @param fallback - What to use when the property is absent or malformed.
 * @returns The colour.
 */
function readColor(file: Record<string, unknown>, key: string, fallback: ColorLike): ColorLike {
  const value: unknown = file[key];
  if (!Array.isArray(value) || value.length < 3) {
    return fallback;
  }
  const channels: readonly JsonValue[] = value;
  return {
    r: channel(channels[0], fallback.r),
    g: channel(channels[1], fallback.g),
    b: channel(channels[2], fallback.b),
    a: channel(channels[3], 1),
  };
}

/**
 * Reads one colour channel.
 *
 * @param value - The JSON element.
 * @param fallback - What to use when it is not a finite number.
 * @returns The channel.
 */
function channel(value: JsonValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
