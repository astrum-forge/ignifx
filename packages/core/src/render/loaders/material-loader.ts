import { CoreErrorCode } from "../../errors/error-codes.js";
import { IgnifxError } from "../../errors/ignifx-error.js";
import {
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
import { shaderMaterialDefinition } from "../shader-material-definition.js";
import { loadShaderSupport, loadSurfaceShaderSupport } from "../shader-support.js";
import type { AssetHandle, AssetLoader, LoaderContext } from "../../assets/types.js";
import type { MaterialAlphaMode } from "../../lite/material.js";
import type { ColorLike } from "../../math/types.js";
import type { JsonValue } from "../../schema/json.js";
import type { MaterialAsset, MaterialDefinition, MaterialKind } from "../material-asset.js";
import type { ShaderAsset } from "../shader-asset.js";
import type { ShaderMaterialDefinition } from "../shader-material-definition.js";
import type { SurfaceShaderInit, SurfaceShaderReference } from "../surface-shader.js";
import type { TextureAsset } from "../texture-asset.js";

/** Babylon Lite's own default plugin priority; a `surfaces` entry that names none takes it. */
const SURFACE_PRIORITY = 500;

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
 *
 * ## `"type": "shader"` is stricter, on purpose
 *
 * A shader material's `values` and `defines` are checked against the `.wgsl` file's own
 * `// @ignifx` declarations, and an undeclared name (`IGX-0712`) or a value of the wrong shape
 * (`IGX-0713`) fails the load. A PBR property that does not exist is a typo with an obvious
 * fallback — the default; a uniform that does not exist has none, and a shader that silently
 * ignores half its material is the failure mode custom shaders are hardest to debug from
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1). The same file is checked at build time
 * by `@ignifx/vite-plugin`, so this is the last line rather than the first.
 *
 * ```jsonc
 * {
 *   "format": "ignifx.material",
 *   "formatVersion": 1,
 *   "type": "shader",
 *   "name": "dissolve",
 *   "shader": "shaders/dissolve.wgsl",
 *   "values": { "progress": 0.25, "edgeColor": [1, 0.6, 0.2] },
 *   "textures": { "noiseTexture": "textures/noise.png" },
 *   "defines": { "SOFT_EDGE": true }
 * }
 * ```
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
      if (kind === "shader") {
        return loadShaderMaterial(ctx, file);
      }
      const slots = kind === "pbr" ? PBR_TEXTURE_SLOTS : STANDARD_TEXTURE_SLOTS;
      const addresses = readTextureAddresses(file, slots);
      const references = readSurfaceReferences(file, ctx.address);
      const textures = await loadTextures(ctx, addresses);
      const surfaces = await loadSurfaceShaders(ctx, references);
      const definition =
        kind === "pbr" ? readPbr(file, addresses, references) : readStandard(file, addresses, references);
      return buildMaterialAsset(definition, textures, { app: ctx.app, shader: null, surfaces });
    },
    unload(value: MaterialAsset): void {
      // A `"shader"` material registers itself with the `PreRender` uniform writer and connects to
      // its shader's `onReplaced`; both have to go when the last holder lets go. A PBR or Standard
      // material owns nothing of the kind and this is a no-op for it.
      value.dispose();
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
  // The array and `null` cases are gone, so what is
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
 * @param surfaces - The `.surface.wgsl` references the file declared.
 * @returns The declaration.
 */
function readPbr(
  file: Record<string, unknown>,
  textures: Record<string, string>,
  surfaces: readonly SurfaceShaderReference[],
): MaterialDefinition {
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
    surfaces,
  });
}

/**
 * Reads the Standard properties over their defaults.
 *
 * @param file - The file body.
 * @param textures - Slot name to address.
 * @param surfaces - The `.surface.wgsl` references the file declared.
 * @returns The declaration.
 */
function readStandard(
  file: Record<string, unknown>,
  textures: Record<string, string>,
  surfaces: readonly SurfaceShaderReference[],
): MaterialDefinition {
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
    surfaces,
  });
}

/**
 * Reads the `surfaces` array: a list of `.surface.wgsl` references, each an address string, an
 * `{ "$asset": … }` reference, or an object carrying `shader` and optionally `name`, `values`,
 * `textures`, `enabled`, `priority`.
 *
 * @param file - The file body.
 * @param address - The material's address, for diagnostics.
 * @returns The references, in the order the file listed them.
 * @throws IgnifxError with code `IGX-0709` when an entry names no shader.
 */
function readSurfaceReferences(file: Record<string, unknown>, address: string): readonly SurfaceShaderReference[] {
  const raw = file["surfaces"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const references: SurfaceShaderReference[] = [];
  for (const entry of raw) {
    const shader = readShaderReference(entry);
    if (shader === "") {
      throw new IgnifxError(CoreErrorCode.invalidAssetFile, `${address} declares a surface with no shader.`, {
        context: { file: address, format: MATERIAL_FILE_FORMAT },
        hint: 'Each entry of "surfaces" is an address, or { "shader": "shaders/<name>.surface.wgsl" }.',
      });
    }
    if (typeof entry === "string") {
      references.push({ shader, name: "", values: {}, textures: {}, enabled: true, priority: SURFACE_PRIORITY });
      continue;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object read by name.
    const record = entry as Record<string, unknown>;
    references.push({
      shader,
      name: readString(record, "name", ""),
      values: readValues(record),
      textures: readTextureRecord(record),
      enabled: readBoolean(record, "enabled", true),
      priority: readNumber(record, "priority", SURFACE_PRIORITY),
    });
  }
  return references;
}

/**
 * Reads one `surfaces` entry's shader address, accepting a bare address, an `{ "$asset": … }`
 * reference, or an object whose `shader` field is either.
 *
 * @param entry - The JSON value.
 * @returns The address, or `""` when there is none.
 */
function readShaderReference(entry: unknown): string {
  if (typeof entry === "string") {
    return entry;
  }
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return "";
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object read by name.
  const record = entry as Record<string, unknown>;
  const shader = record["shader"];
  if (typeof shader === "string") {
    return shader;
  }
  if (typeof shader !== "object" || shader === null || Array.isArray(shader)) {
    return "";
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object read by name.
  const asset = (shader as Record<string, unknown>)["$asset"];
  return typeof asset === "string" ? asset : "";
}

/**
 * Loads every surface shader the material names, and the textures each one binds.
 *
 * @remarks
 * A surface shader that fails to load fails the **material**, unlike a texture: a missing normal map
 * is a visual defect, a missing shader is a material that does not exist. The requests are issued
 * together rather than in sequence, because no shader's textures depend on another shader.
 *
 * @param ctx - The loader context.
 * @param references - What the file declared.
 * @returns The inits {@link buildMaterialAsset} attaches, in order.
 */
async function loadSurfaceShaders(
  ctx: LoaderContext,
  references: readonly SurfaceShaderReference[],
): Promise<readonly SurfaceShaderInit[]> {
  if (references.length > 0) {
    // Pulls the surface-shader layer into memory before `buildMaterialAsset` reaches for it. The
    // `.wgsl` loader below does the same, so this is belt and braces for a material whose shaders
    // were preloaded elsewhere.
    await loadSurfaceShaderSupport();
  }
  const loads = references.map(async (reference): Promise<SurfaceShaderInit> => {
    const [shader, resolved] = await Promise.all([
      ctx.loadDependency<ShaderAsset>(reference.shader),
      loadNamedTextures(ctx, reference.textures),
    ]);
    const textures: Record<string, AssetHandle<TextureAsset>> = {};
    const names = Object.keys(resolved.addresses);
    for (let index = 0; index < names.length; index += 1) {
      const handle = resolved.handles[index];
      const name = names[index];
      if (handle !== undefined && name !== undefined) {
        textures[name] = handle;
      }
    }
    return {
      shader,
      ...(reference.name === "" ? {} : { name: reference.name }),
      values: reference.values,
      textures,
      enabled: reference.enabled,
      priority: reference.priority,
    };
  });
  return Promise.all(loads);
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

/**
 * Loads a `"shader"` material: the `.wgsl`, then its textures, then the values and defines checked
 * against what the file declares.
 *
 * @param ctx - The loader context.
 * @param file - The file body.
 * @returns The material.
 * @throws IgnifxError with code `IGX-0709` when the file names no shader, `IGX-0719` when the
 * shader's pragmas are malformed, `IGX-0712` for an undeclared value or define, or `IGX-0713` for a
 * value of the wrong shape.
 */
async function loadShaderMaterial(ctx: LoaderContext, file: Record<string, unknown>): Promise<MaterialAsset> {
  const address = readString(file, "shader", "");
  if (address === "") {
    throw new IgnifxError(CoreErrorCode.invalidAssetFile, `${ctx.address} declares no shader.`, {
      context: { file: ctx.address, format: MATERIAL_FILE_FORMAT },
      hint: 'A shader material carries "shader": "shaders/<name>.wgsl".',
    });
  }
  const shader = await ctx.loadDependency<ShaderAsset>(address);
  const requested = readTextureRecord(file);
  const [resolved] = await Promise.all([loadNamedTextures(ctx, requested), loadShaderSupport()]);
  const definition: ShaderMaterialDefinition = shaderMaterialDefinition({
    shader: address,
    name: readString(file, "name", address),
    values: readValues(file),
    textures: resolved.addresses,
    defines: readDefines(file),
  });
  return buildMaterialAsset(definition, resolved.handles, { app: ctx.app, shader: shader.value });
}

/**
 * Reads the `textures` record, accepting a bare address string or an `{ "$asset": … }` reference.
 *
 * @param file - The file body.
 * @returns Sampler name to address.
 */
function readTextureRecord(file: Record<string, unknown>): Record<string, string> {
  const record: Record<string, string> = {};
  const declared = file["textures"];
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) {
    return record;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object read by name.
  const entries = declared as Record<string, unknown>;
  for (const name of Object.keys(entries)) {
    const value: unknown = entries[name];
    if (typeof value === "string" && value !== "") {
      record[name] = value;
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object read by name.
      const address = (value as Record<string, unknown>)["$asset"];
      if (typeof address === "string" && address !== "") {
        record[name] = address;
      }
    }
  }
  return record;
}

/**
 * Loads the textures a shader material binds by name, dropping the ones that failed.
 *
 * @remarks
 * A texture that fails to load is dropped from **both** the record and the handle list, so the two
 * stay aligned and the sampler falls back to its declared 1x1 texture — the same "a missing map is
 * a visual defect, not a failed level" rule the PBR path follows.
 *
 * @param ctx - The loader context.
 * @param requested - Sampler name to address.
 * @returns The addresses that loaded and their handles, in the same order.
 */
async function loadNamedTextures(
  ctx: LoaderContext,
  requested: Record<string, string>,
): Promise<{ readonly addresses: Record<string, string>; readonly handles: readonly AssetHandle<TextureAsset>[] }> {
  const names = Object.keys(requested);
  const requests: Promise<AssetHandle<TextureAsset> | null>[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const address = requested[names[index] ?? ""] ?? "";
    requests.push(ctx.loadDependency<TextureAsset>(address).catch((): null => null));
  }
  const settled = await Promise.all(requests);
  const addresses: Record<string, string> = {};
  const handles: AssetHandle<TextureAsset>[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const handle = settled[index];
    const name = names[index];
    const address = name === undefined ? undefined : requested[name];
    if (handle === null || handle === undefined || name === undefined || address === undefined) {
      continue;
    }
    addresses[name] = address;
    handles.push(handle);
  }
  return { addresses, handles };
}

/**
 * Reads the `values` record: a number, or an array of numbers for a vector, matrix, or sRGB colour.
 *
 * @param file - The file body.
 * @returns Uniform name to value; entries of any other shape are dropped and fail later as
 * `IGX-0712`/`IGX-0713` only if they name something the shader declares.
 */
function readValues(file: Record<string, unknown>): Record<string, number | readonly number[]> {
  const values: Record<string, number | readonly number[]> = {};
  const declared = file["values"];
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) {
    return values;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object read by name.
  const entries = declared as Record<string, unknown>;
  for (const name of Object.keys(entries)) {
    const value: unknown = entries[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      values[name] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const numbers: number[] = [];
      for (const element of value) {
        numbers.push(typeof element === "number" && Number.isFinite(element) ? element : 0);
      }
      values[name] = numbers;
    }
  }
  return values;
}

/**
 * Reads the `defines` record.
 *
 * @param file - The file body.
 * @returns Define name to value.
 */
function readDefines(file: Record<string, unknown>): Record<string, boolean | number> {
  const defines: Record<string, boolean | number> = {};
  const declared = file["defines"];
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) {
    return defines;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object read by name.
  const entries = declared as Record<string, unknown>;
  for (const name of Object.keys(entries)) {
    const value: unknown = entries[name];
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      defines[name] = value;
    }
  }
  return defines;
}
