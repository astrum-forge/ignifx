import { defineParticles } from "../definition/define-particles.js";
import { PARTICLE_ASSET_TYPE, PARTICLE_FILE_EXTENSIONS } from "../definition/types.js";
import { ParticleAsset } from "./particle-asset.js";
import type { ParticleDefinition, ParticleDefinitionInput } from "../definition/types.js";
import type { App, AssetHandle, AssetLoader, LoaderContext, TextureAsset } from "@ignifx/core";

// The `particles` asset loader (`docs/architecture/05-assets-and-loading.md` §5) and the in-memory
// factory that skips the file. The one dependency it pulls in is the renderer's texture, so that
// texture's reference count and load progress follow the document's.

/**
 * Builds the loader for `.particles.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createParticleLoader());
 * ```
 *
 * @public
 */
export function createParticleLoader(): AssetLoader<ParticleAsset> {
  return {
    type: PARTICLE_ASSET_TYPE,
    extensions: PARTICLE_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<ParticleAsset> {
      const raw = await ctx.fetchJson<ParticleDefinitionInput>();
      const definition = defineParticles(raw, ctx.address);
      const texture = definition.renderer.texture;
      const handle = texture === null ? null : await ctx.loadDependency<TextureAsset>(texture);
      return new ParticleAsset(ctx.address, definition, handle, false);
    },
    unload(value: ParticleAsset): void {
      value.dispose();
    },
  };
}

/**
 * Publishes a definition built in code as a `particles` asset, so a `ParticleSystem`'s `definition`
 * field can hold it without a file. A `renderer.texture` starts loading here; the system draws the
 * procedural disc until it arrives. The handle has one holder, the caller.
 *
 * @param app - The app whose asset service publishes it.
 * @param definition - The definition, from {@link defineParticles} or a preset.
 * @param name - A human-readable name for diagnostics; defaults to `"particles"`.
 * @returns The handle, already loaded.
 *
 * @example
 * ```ts
 * const fire = particleAssetFromDefinition(app, particleDefinition("fire"));
 * campfire.addComponent(ParticleSystem, { definition: fire });
 * ```
 *
 * @public
 */
export function particleAssetFromDefinition(
  app: App,
  definition: ParticleDefinition,
  name: string = "particles",
): AssetHandle<ParticleAsset> {
  const address = definition.renderer.texture;
  const texture = address === null ? null : app.assets.load<TextureAsset>(address);
  return app.assets.register(new ParticleAsset(name, definition, texture, true), { type: PARTICLE_ASSET_TYPE });
}
