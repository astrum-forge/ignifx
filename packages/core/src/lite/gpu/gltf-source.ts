import { loadGltf } from "@babylonjs/lite";
import type { AssetContainer, EngineContext } from "@babylonjs/lite";

/**
 * Babylon Lite's glTF **parser**, alone in a module so that it can be dynamically imported
 * (`docs/architecture/07-rendering.md` §2.4, `CONSTITUTION.md` §2.5).
 *
 * `loadGltf` (`index.d.ts` 6821) reaches Lite's whole `loader-gltf` tree — the parser, the PBR
 * material builder, and the accessor decoders — about 12 KB unminified in 1.27.0. The rest of
 * `./gltf.ts` is not like that: `addToScene`, `cloneTransformNode` and `removeFromScene` are what a
 * live `Model` component calls every time one is attached, so they belong in the entry chunk. Only
 * the parse step is per-asset, and it is already asynchronous, so moving it behind a dynamic import
 * costs a game that loads a model one chunk fetch it was going to pay for in bytes anyway, and
 * costs a game that loads none nothing at all.
 *
 * Everything here is `@internal` and needs a device: `loadGltf` uploads vertex buffers and textures.
 */

/**
 * Parses a glTF or GLB asset into a container.
 *
 * @param engine - The engine that will own the GPU resources.
 * @param source - The `.glb`/`.gltf` bytes, or a URL for Lite to fetch itself.
 * @returns The container.
 *
 * @internal
 */
export function loadGltfSource(engine: EngineContext, source: ArrayBuffer | string): Promise<AssetContainer> {
  return loadGltf(engine, source);
}
