import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { stringifySceneFile } from "./scene-file.js";
import type { SceneFile } from "./scene-file.js";
import type { AssetHandle } from "../assets/types.js";

/**
 * What the scene loader produces for a `*.scene.json` or `*.prefab.json` address: the parsed file,
 * every asset it pulled in, and the content hash instance overrides are recorded against
 * (`docs/architecture/05-assets-and-loading.md` §2, `06-serialization-and-scene-format.md` §2).
 *
 * @remarks
 * The handles are already loaded and retained by the asset. That is what lets
 * `world.instantiate(sceneAsset)` be synchronous: everything the file references — textures,
 * materials, and the scene assets its `instance` entries name — is in memory by the time the
 * `SceneAsset` exists (`02-scene-graph.md` §2).
 *
 * @public
 */
export interface SceneAsset {
  /** The address the asset was loaded from. */
  readonly address: string;
  /** The parsed, validated file. */
  readonly file: SceneFile;
  /** Every asset the file references, already loaded, in resolution order. */
  readonly dependencies: readonly AssetHandle[];
  /** The content hash of {@link SceneAsset.file}, as `sha256:<hex>`. */
  readonly hash: string;
}

/** The hash algorithm and the prefix it is written under. */
const HASH_ALGORITHM = "SHA-256";

/** The prefix `instance.hash` values carry. */
const HASH_PREFIX = "sha256:";

/**
 * The content hash of a scene file: SHA-256 over the canonical JSON text, so two saves of the same
 * state hash the same and an edited prefab does not
 * (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @param file - The file to hash.
 * @returns The hash as `sha256:<64 lowercase hex digits>`.
 * @throws IgnifxError with code `IGX-1420` when the host exposes no Web Crypto `subtle`.
 *
 * @example
 * ```ts
 * const hash = await computeSceneHash(serializeScene(instance)); // "sha256:9f2c…"
 * ```
 *
 * @public
 */
export async function computeSceneHash(file: SceneFile): Promise<string> {
  // The DOM lib declares `globalThis.crypto` as always present. Node before 19, workers without a
  // secure context, and locked-down embedders do not have `subtle`, so the assertion models the
  // absence the types deny (coding standards §5.2).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const webCrypto = globalThis.crypto as Crypto | undefined;
  const subtle: SubtleCrypto | undefined = webCrypto?.subtle;
  if (subtle === undefined || typeof subtle.digest !== "function") {
    throw new IgnifxError(CoreErrorCode.cryptoUnavailable, "This host does not expose Web Crypto subtle.", {
      context: { file: file.name },
      hint: "Scene content hashes need crypto.subtle; run on a secure context or Node 19+.",
    });
  }
  const bytes = new TextEncoder().encode(stringifySceneFile(file));
  const digest = await subtle.digest(HASH_ALGORITHM, bytes);
  return HASH_PREFIX + toHex(new Uint8Array(digest));
}

/**
 * Builds a `SceneAsset` from a file that is already in memory — the shape the loader returns, and
 * the one tests and tools use when there is no asset service in play.
 *
 * @param address - The address the asset stands at.
 * @param file - The parsed file.
 * @param dependencies - Every asset the file references, already loaded.
 * @returns The asset, with its content hash computed.
 *
 * @example
 * ```ts
 * const prefab = await createSceneAsset("prefabs/enemy.prefab.json", enemyFile, []);
 * ```
 *
 * @public
 */
export async function createSceneAsset(
  address: string,
  file: SceneFile,
  dependencies: readonly AssetHandle[] = [],
): Promise<SceneAsset> {
  return { address, file, dependencies, hash: await computeSceneHash(file) };
}

/**
 * Finds the loaded scene asset an `instance.scene` reference names, among a scene's dependencies.
 *
 * @param asset - The scene whose `instance` entry is being expanded.
 * @param address - The address the reference carries.
 * @returns The dependency handle and its value, or `null` when nothing loaded stands at that
 * address.
 *
 * @internal
 */
export function findSceneDependency(
  asset: SceneAsset,
  address: string,
): { readonly handle: AssetHandle<SceneAsset>; readonly value: SceneAsset } | null {
  const dependencies = asset.dependencies;
  for (let index = 0; index < dependencies.length; index += 1) {
    const handle = dependencies[index];
    if (handle === undefined || handle.address !== address || handle.state !== "loaded") {
      continue;
    }
    const value: unknown = handle.value;
    if (!isSceneAsset(value)) {
      continue;
    }
    // Boundary assertion (coding standards §5.2): `isSceneAsset` has just established the shape,
    // and `AssetHandle<T>` differs from `AssetHandle` only in the type of `value`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { handle: handle as AssetHandle<SceneAsset>, value };
  }
  return null;
}

/**
 * Reports whether a loaded asset value is a scene.
 *
 * @param value - The handle's value.
 * @returns `true` when the value carries a scene file and a hash.
 *
 * @internal
 */
export function isSceneAsset(value: unknown): value is SceneAsset {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const file: unknown = Reflect.get(value, "file");
  return typeof Reflect.get(value, "hash") === "string" && typeof file === "object" && file !== null;
}

/** Lowercase hexadecimal digits, indexed by nibble. */
const HEX_DIGITS = "0123456789abcdef";

/**
 * Formats bytes as lowercase hexadecimal.
 *
 * @param bytes - The digest.
 * @returns The hex string.
 */
function toHex(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    text += (HEX_DIGITS[byte >> 4] ?? "0") + (HEX_DIGITS[byte & 0xf] ?? "0");
  }
  return text;
}
