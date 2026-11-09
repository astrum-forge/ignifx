import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { TextureAsset } from "./texture-asset.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { Vec2Like } from "../math/types.js";

/**
 * Lightmaps (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B3): a baked texture that static
 * `MeshRenderer`s sample through their second UV set, and the per-entity placement of each renderer
 * in it. Everything here is plain data and runs in Node; the GPU half is `./gpu/lightmaps.ts`.
 */

/**
 * The asset type lightmaps are registered under.
 *
 * @public
 */
export const LIGHTMAP_ASSET_TYPE = "lightmap";

/**
 * The address extensions that select the lightmap loader.
 *
 * @public
 */
export const LIGHTMAP_FILE_EXTENSIONS: readonly string[] = Object.freeze([".lightmap.json"]);

/**
 * The `format` header every `.lightmap.json` carries.
 *
 * @public
 */
export const LIGHTMAP_FILE_FORMAT = "ignifx-lightmap";

/**
 * The `formatVersion` this engine reads and writes.
 *
 * @public
 */
export const LIGHTMAP_FORMAT_VERSION = 1;

/**
 * Where one renderer's UV2 square sits in a lightmap atlas: the lightmap is sampled at
 * `uv2 · scale + offset`.
 *
 * @public
 */
export interface LightmapPlacement {
  /** The atlas-space size of the renderer's UV2 square; each component above 0. */
  readonly scale: Vec2Like;
  /** The atlas-space position of the square's `(0, 0)` corner. */
  readonly offset: Vec2Like;
}

/**
 * The placement every entity without an entry gets: the whole texture.
 *
 * @public
 */
export const IDENTITY_LIGHTMAP_PLACEMENT: LightmapPlacement = Object.freeze({
  scale: Object.freeze({ x: 1, y: 1 }),
  offset: Object.freeze({ x: 0, y: 0 }),
});

/**
 * A lightmap as a `.lightmap.json` stores it.
 *
 * @public
 */
export interface LightmapFileData {
  /** The texture's asset address, resolved like any other address against the asset root. */
  readonly texture: string;
  /** Per-entity placements, keyed by entity uid; an entity without one samples the whole texture. */
  readonly entries: Readonly<Record<string, LightmapPlacement>>;
}

/**
 * A loaded lightmap: a texture and where each entity's UV2 square sits in it.
 *
 * @remarks
 * A `MeshRenderer` names it in its `lightmap` record. Only placements equal to
 * {@link IDENTITY_LIGHTMAP_PLACEMENT} are honoured for now: Babylon Lite 1.34's lightmap fragment
 * samples `uv2` without a transform, so a renderer with another placement logs `IGX-0735` once and
 * samples the whole texture until the atlas transform lands (GI plan §5, spike P2).
 *
 * @example
 * ```ts
 * const lightmap = await app.assets.loadAsync<LightmapAsset>("lighting/hall.lightmap.json");
 * entity.isStatic = true;
 * entity.addComponent(MeshRenderer, { mesh, lightmap: { asset: lightmap, mode: "add", level: 1, gamma: false, uv2: true } });
 * ```
 *
 * @beta
 */
export class LightmapAsset {
  /** The type name the asset service registers lightmaps under. */
  static assetType: string = LIGHTMAP_ASSET_TYPE;

  /** The baked texture. The asset does not own the handle: its loader or creator does. */
  readonly texture: AssetHandle<TextureAsset>;

  /** Per-entity placements, keyed by entity uid. */
  readonly entries: Readonly<Record<string, LightmapPlacement>>;

  /**
   * Wraps a texture and its checked placements. Use the loader or {@link createLightmapAsset}.
   *
   * @param texture - The baked texture.
   * @param entries - Placements already checked by `readLightmapEntries`.
   *
   * @internal
   */
  constructor(texture: AssetHandle<TextureAsset>, entries: Readonly<Record<string, LightmapPlacement>>) {
    this.texture = texture;
    this.entries = entries;
  }

  /**
   * The placement of one entity's UV2 square.
   *
   * @param entityId - The entity's uid.
   * @returns Its entry, or {@link IDENTITY_LIGHTMAP_PLACEMENT} when it has none.
   */
  placementOf(entityId: string): LightmapPlacement {
    return Object.hasOwn(this.entries, entityId)
      ? (this.entries[entityId] ?? IDENTITY_LIGHTMAP_PLACEMENT)
      : IDENTITY_LIGHTMAP_PLACEMENT;
  }
}

/**
 * Publishes a lightmap built in code, such as a texture from `TextureAsset.fromPixels`.
 *
 * @param app - The app.
 * @param texture - The baked texture; the caller keeps owning the handle.
 * @param entries - Per-entity placements, keyed by entity uid. Defaults to none.
 * @returns A handle a `MeshRenderer`'s `lightmap.asset` can take.
 * @throws IgnifxError with code `IGX-0709` when a placement is malformed.
 *
 * @beta
 */
export function createLightmapAsset(
  app: App,
  texture: AssetHandle<TextureAsset>,
  entries: Readonly<Record<string, LightmapPlacement>> = {},
): AssetHandle<LightmapAsset> {
  return app.assets.register(new LightmapAsset(texture, readLightmapEntries(entries, "lightmap entries")), {
    type: LIGHTMAP_ASSET_TYPE,
  });
}

/**
 * Turns a lightmap description into the JSON a `.lightmap.json` file holds.
 *
 * @param data - The texture address and placements.
 * @returns The file contents, with the format header.
 *
 * @beta
 */
export function writeLightmapFile(data: LightmapFileData): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  for (const id of Object.keys(data.entries).toSorted()) {
    const placement = data.entries[id];
    if (placement !== undefined) {
      entries[id] = {
        scale: { x: placement.scale.x, y: placement.scale.y },
        offset: { x: placement.offset.x, y: placement.offset.y },
      };
    }
  }
  return {
    format: LIGHTMAP_FILE_FORMAT,
    formatVersion: LIGHTMAP_FORMAT_VERSION,
    texture: data.texture,
    entries,
  };
}

/**
 * Reads a parsed `.lightmap.json`.
 *
 * @param parsed - The parsed JSON.
 * @param address - The file's address, for the error.
 * @returns The texture address and checked placements.
 * @throws IgnifxError with code `IGX-0709` when the header, the texture or a placement is wrong.
 *
 * @internal
 */
export function readLightmapFile(parsed: unknown, address: string): LightmapFileData {
  const file = asRecord(parsed);
  if (file === null || file["format"] !== LIGHTMAP_FILE_FORMAT || file["formatVersion"] !== LIGHTMAP_FORMAT_VERSION) {
    throw invalid(address, `it must start with { "format": "${LIGHTMAP_FILE_FORMAT}", "formatVersion": 1 }`);
  }
  const texture = file["texture"];
  if (typeof texture !== "string" || texture.trim() === "") {
    throw invalid(address, "texture must be the lightmap texture's asset address");
  }
  return { texture, entries: readLightmapEntries(file["entries"] ?? {}, address) };
}

/**
 * Checks a set of per-entity placements.
 *
 * @remarks
 * A placement may leave out `scale` or `offset`; the missing half takes the identity's.
 *
 * @param value - The candidate `entries` object.
 * @param address - Where it came from, for the error.
 * @returns Checked copies, keyed by entity uid.
 * @throws IgnifxError with code `IGX-0709` on a malformed placement.
 *
 * @internal
 */
export function readLightmapEntries(value: unknown, address: string): Readonly<Record<string, LightmapPlacement>> {
  const record = asRecord(value);
  if (record === null) {
    throw invalid(address, "entries must be an object keyed by entity id");
  }
  const entries: Record<string, LightmapPlacement> = {};
  for (const id of Object.keys(record)) {
    const entry = asRecord(record[id]);
    const scale = entry === null ? null : readVec2(entry["scale"], IDENTITY_LIGHTMAP_PLACEMENT.scale, (n) => n > 0);
    const offset = entry === null ? null : readVec2(entry["offset"], IDENTITY_LIGHTMAP_PLACEMENT.offset, () => true);
    if (id === "" || scale === null || offset === null) {
      throw invalid(
        address,
        `entries["${id}"] must be { scale?: { x, y }, offset?: { x, y } } with finite numbers and a scale above 0`,
      );
    }
    entries[id] = { scale, offset };
  }
  return entries;
}

/**
 * Whether a placement is the identity, the only one Babylon Lite 1.34 can draw (GI plan §5, P2).
 *
 * @param placement - The placement.
 * @returns `true` for scale `(1, 1)` and offset `(0, 0)`.
 *
 * @internal
 */
export function isIdentityLightmapPlacement(placement: LightmapPlacement): boolean {
  const { scale, offset } = placement;
  return scale.x === 1 && scale.y === 1 && offset.x === 0 && offset.y === 0;
}

/**
 * Reads `{ x, y }` whose components are finite and pass a check, or takes a default when absent.
 *
 * @param value - The candidate, `undefined` when the field is absent.
 * @param fallback - The value an absent field takes.
 * @param check - The per-component test beyond finiteness.
 * @returns A copy, or `null` when it is malformed.
 */
function readVec2(value: unknown, fallback: Vec2Like, check: (n: number) => boolean): Vec2Like | null {
  if (value === undefined) {
    return { x: fallback.x, y: fallback.y };
  }
  const record = asRecord(value);
  const x = record?.["x"];
  const y = record?.["y"];
  if (typeof x !== "number" || typeof y !== "number" || ![x, y].every((n) => Number.isFinite(n) && check(n))) {
    return null;
  }
  return { x, y };
}

/**
 * Narrows a value to a plain record.
 *
 * @param value - The candidate.
 * @returns The record, or `null` for anything else.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // Boundary narrowing of parsed JSON (coding standards §5.2).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Record<string, unknown>;
}

/**
 * The error for a malformed lightmap.
 *
 * @param address - Where it came from.
 * @param problem - What is wrong.
 * @returns The error.
 */
function invalid(address: string, problem: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidAssetFile, `${address} is not an ${LIGHTMAP_FILE_FORMAT} file.`, {
    context: { file: address, format: LIGHTMAP_FILE_FORMAT },
    hint: `Fix the file: ${problem}.`,
  });
}
