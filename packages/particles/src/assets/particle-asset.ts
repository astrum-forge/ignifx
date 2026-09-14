import { PARTICLE_ASSET_TYPE } from "../definition/types.js";
import type { ParticleDefinition } from "../definition/types.js";
import type { AssetHandle, TextureAsset } from "@ignifx/core";

// The loaded `.particles.json` document (`docs/architecture/05-assets-and-loading.md` §5). It owns
// no device resources: `app.particles` builds the shader, the lookup texture and the material on
// first use and shares them between every system playing the same asset.

/**
 * A parsed particle document.
 *
 * @example
 * ```ts
 * const handle = app.assets.load<ParticleAsset>("fx/fire.particles.json").retain();
 * await handle.promise;
 * handle.value.definition.main.capacity; // 1000
 * ```
 *
 * @public
 */
export class ParticleAsset {
  /** The asset type name, so `assetRef` and the inspector can round-trip a reference. */
  static assetType: string = PARTICLE_ASSET_TYPE;

  /** Where the document was loaded from, or the `memory:` address it was published at. */
  readonly address: string;

  /** The parsed, baked document. */
  readonly definition: ParticleDefinition;

  /** The texture the renderer samples, or `null` for the procedural soft disc. */
  readonly texture: AssetHandle<TextureAsset> | null;

  readonly #ownsTexture: boolean;

  /**
   * Wraps a parsed document.
   *
   * @param address - Where it came from.
   * @param definition - The parsed document.
   * @param texture - The renderer's texture handle, or `null`.
   * @param ownsTexture - Whether {@link ParticleAsset.dispose} releases the texture handle. The
   * loader's dependency is released by the asset service; an in-memory asset holds its own.
   *
   * @internal
   */
  constructor(
    address: string,
    definition: ParticleDefinition,
    texture: AssetHandle<TextureAsset> | null = null,
    ownsTexture: boolean = false,
  ) {
    this.address = address;
    this.definition = definition;
    this.texture = texture;
    this.#ownsTexture = ownsTexture;
  }

  /**
   * Releases what the asset holds beyond its data. The `particles` asset type's `unload` runs it
   * when the last holder releases the handle.
   */
  dispose(): void {
    if (this.#ownsTexture) {
      this.texture?.release();
    }
  }
}
