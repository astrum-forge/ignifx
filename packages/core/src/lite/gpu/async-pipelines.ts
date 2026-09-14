import { enableAsyncShaderPipelineCompilation } from "@babylonjs/lite";
import type { EngineContext } from "@babylonjs/lite";

/**
 * The `rendering.features.asyncPipelines` opt-in, in a module of its own.
 *
 * Babylon Lite's async-pipeline hook reaches its shader-material renderable, which is also what the
 * custom-WGSL adapter needs. Importing it from `../render-features.ts` would make that code shared
 * between the entry graph and the shader chunk, and a bundler resolves "shared" by hoisting it into
 * the entry — so a game that enables neither would pay for both (`CONSTITUTION.md` §2.5). The
 * feature is off by default and applied from an `await`ed path, so the extra chunk is fetched only
 * by a game that asked for it.
 */

/**
 * Turns on Babylon Lite's asynchronous shader-pipeline compilation for one engine.
 *
 * @param engine - The engine whose pipelines compile off the critical path.
 *
 * @internal
 */
export function enableAsyncPipelines(engine: EngineContext): void {
  enableAsyncShaderPipelineCompilation(engine);
}
