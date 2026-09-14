import type { CompiledPostEffect } from "./post-effect.js";
import type { ShaderAsset } from "./shader-asset.js";
import type { CustomEffectOptions, EffectChainLink, LiteEffect } from "../lite/gpu/effect-task.js";
import type { LitePostProcessTask, LiteRenderTarget } from "../lite/gpu/post-process.js";
import type { LiteTexture2D } from "../lite/gpu/texture.js";
import type { LiteEngine, LiteScene } from "../lite/scene.js";

/**
 * The gate `PostProcessStack` and its frame-graph half reach custom post effects through
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.3, "Bundle cost" in §3.1).
 *
 * Every app registers a `PostProcessStack`, so the WGSL generator and Babylon Lite's fullscreen
 * effect path are loaded by the `.wgsl` loader when it parses a `post` file, not imported statically.
 * A custom effect can only name a loaded `ShaderAsset`, so both are in memory before the stack can
 * record one.
 */

/** The part of `./post-effect-compiler.ts` the stack and the chain call. */
export interface PostEffectCompilerSupport {
  /** The compiled form of a post-effect shader, compiled once per asset. */
  compiledPostEffect(shader: ShaderAsset): CompiledPostEffect;
  /** Writes an effect's declared values into its uniform bytes. */
  writePostEffectValues(
    effect: CompiledPostEffect,
    shader: ShaderAsset,
    values: Readonly<Record<string, number | readonly number[]>>,
    out: Float32Array,
  ): void;
}

/** The part of `../lite/gpu/effect-task.ts` the frame-graph half calls. */
export interface EffectTaskSupport {
  /** Creates one fullscreen effect: shader module, bind-group layout, uniform buffer, texture slots. */
  createCustomEffect(engine: LiteEngine, options: CustomEffectOptions): LiteEffect;
  /** Binds a texture to one of an effect's texture slots. */
  bindCustomEffectTexture(effect: LiteEffect, binding: number, texture: LiteTexture2D): void;
  /** Uploads an effect's uniform bytes. */
  writeCustomEffectUniforms(effect: LiteEffect, data: Float32Array): void;
  /** Records one fullscreen effect as a frame-graph task. */
  createCustomEffectTask(
    engine: LiteEngine,
    scene: LiteScene,
    name: string,
    effect: LiteEffect,
    target: LiteRenderTarget,
  ): LitePostProcessTask;
  /** Frees an effect wrapper's GPU resources. */
  disposeCustomEffect(effect: LiteEffect): void;
  /** Creates one ping-pong link: a colour target that is also a sampled texture. */
  createEffectChainLink(
    engine: LiteEngine,
    format: GPUTextureFormat,
    width: number,
    height: number,
    label: string,
  ): EffectChainLink;
  /** Frees a chain link's GPU texture. */
  disposeEffectChainLink(link: EffectChainLink): void;
  /** Records a task that copies one colour target into another. */
  createChainCopyTask(
    engine: LiteEngine,
    scene: LiteScene,
    name: string,
    source: LiteRenderTarget,
    target: LiteRenderTarget,
  ): LitePostProcessTask;
}

/** The dynamically imported compiler, memoised for the process. */
let compilerLayer: PostEffectCompilerSupport | null = null;

/** The dynamically imported Babylon Lite effect adapter, memoised for the process. */
let effectLayer: EffectTaskSupport | null = null;

/**
 * Loads the post-effect compiler and the Babylon Lite effect adapter, once per process.
 *
 * @returns A promise that settles once both are in place.
 *
 * @internal
 */
export async function loadPostEffectSupport(): Promise<void> {
  // The annotations are what check each interface against the module it stands for.
  const [compiler, effects]: [PostEffectCompilerSupport, EffectTaskSupport] = await Promise.all([
    compilerLayer ?? import("./post-effect-compiler.js"),
    effectLayer ?? import("../lite/gpu/effect-task.js"),
  ]);
  compilerLayer = compiler;
  effectLayer = effects;
}

/**
 * The post-effect compiler, if it has been loaded.
 *
 * @returns The module, or `null` before any `.post.wgsl` has been loaded.
 *
 * @internal
 */
export function postEffectCompiler(): PostEffectCompilerSupport | null {
  return compilerLayer;
}

/**
 * The Babylon Lite effect adapter, if it has been loaded.
 *
 * @returns The module, or `null` before any `.post.wgsl` has been loaded.
 *
 * @internal
 */
export function effectTaskSupport(): EffectTaskSupport | null {
  return effectLayer;
}
