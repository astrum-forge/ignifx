import type { AssetRef } from "./types.js";

/**
 * The two helpers that build and recognise an {@link AssetRef}
 * (`docs/architecture/05-assets-and-loading.md` §2).
 *
 * A reference deliberately has no `.load()` sugar: §2 calls it "the serializable form used in
 * schemas and files", and a method would not survive `JSON.stringify`, the schema codec, or a
 * structured clone into a worker. The way to turn one into a handle is `app.assets.load(ref)`.
 */

/**
 * Builds an asset reference.
 *
 * @typeParam T - The loaded value type the reference points at; a compile-time marker only.
 * @param address - The address, fragment included.
 * @param type - The asset type, when the extension does not identify it.
 * @returns A frozen reference, safe to hold as a module constant.
 *
 * @example
 * ```ts
 * const hero = assetRef<ModelAsset>("models/hero.glb");
 * const run = assetRef<AnimationClip>("models/hero.glb#animation:Run");
 * const handle = app.assets.load(hero);
 * ```
 *
 * @public
 */
export function assetRef<T = unknown>(address: string, type?: string): AssetRef<T> {
  return Object.freeze(type === undefined ? { address } : { address, type });
}

/**
 * Reports whether a value is an asset reference rather than a plain address.
 *
 * @param value - The candidate.
 * @returns `true` when the value is an object with a string `address`.
 *
 * @example
 * ```ts
 * const address = isAssetRef(input) ? input.address : input;
 * ```
 *
 * @public
 */
export function isAssetRef(value: unknown): value is AssetRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate: { address?: unknown } = value;
  return typeof candidate.address === "string";
}

/**
 * Reads the address out of whichever form a caller passed.
 *
 * @param ref - An address or a reference.
 * @returns The address.
 *
 * @internal
 */
export function addressOf(ref: AssetRef | string): string {
  return typeof ref === "string" ? ref : ref.address;
}

/**
 * Reads the declared type out of whichever form a caller passed.
 *
 * @param ref - An address or a reference.
 * @returns The type the reference declares, or `null` when it declares none.
 *
 * @internal
 */
export function declaredTypeOf(ref: AssetRef | string): string | null {
  return typeof ref === "string" ? null : (ref.type ?? null);
}
