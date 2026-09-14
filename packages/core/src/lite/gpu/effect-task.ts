import {
  createCopyToTextureTask,
  createEffectRenderTask,
  createEffectWrapper,
  createRenderTargetTexture,
  disposeEffectWrapper,
  setEffectTexture,
  setEffectUniforms,
} from "@babylonjs/lite";
import type {
  EffectBindingLayout,
  EffectWrapper,
  EngineContext,
  RenderTarget,
  SceneContext,
  Task,
  Texture2D,
} from "@babylonjs/lite";

/**
 * The Babylon Lite half of custom post effects (`docs/plan/2026-09-terrain-particles-shaders.md`
 * §3.3).
 *
 * Everything here is `@internal` and every entry point needs a device.
 *
 * Lite's only public custom-pass path is `createEffectWrapper` + `createEffectRenderTask`
 * (`index.d.ts` 2461, 2452) — the generic `PostProcessTaskConfig` is not exported. The task writes a
 * `RenderTarget` while the wrapper **samples a `Texture2D`**, and a `createRenderTarget` target
 * exposes no `Texture2D`, so a chain that mixes built-ins with custom effects needs links that are
 * both: {@link createEffectChainLink} is `createRenderTargetTexture` (2998), which hands back
 * `{ rt, texture }`.
 *
 * Those links are **eager**, which the chain depends on twice over: an eager target is never
 * reallocated and `disposeRenderTarget` refuses to free one (`lib/engine/render-target.js` 20, 48),
 * so a wrapper's cached bind group cannot end up holding a destroyed view, and an effect that writes
 * the equally eager swapchain can be disposed without destroying it. The price is that a link is
 * fixed size (Lite error 571), so a canvas resize rebuilds the chain.
 *
 * Two more Lite rules: `getEffectPipeline` hard-codes the entry-point names `effectFullscreenVertex`
 * and `effectFragment` and prepends its own vertex module — which declares `EffectVertexOutput` — to
 * the fragment source (`lib/effect/effect-renderer.js` 258-260, 274); and a `sampler` binding with
 * no `textureBinding` falls back to the wrapper's first texture slot (line 342), so
 * {@link createCustomEffect} sets `textureBinding` on every sampler.
 */

/**
 * A Babylon Lite fullscreen effect, re-exported under an ignifx name.
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @internal
 */
export type LiteEffect = EffectWrapper;

/**
 * A colour target that is also a sampled texture: what a chain of custom effects ping-pongs through.
 *
 * @internal
 */
export interface EffectChainLink {
  /** The render target a task writes. */
  readonly target: RenderTarget;
  /** The sampled texture the next effect reads. */
  readonly texture: Texture2D;
}

/**
 * What {@link createCustomEffect} needs.
 *
 * @internal
 */
export interface CustomEffectOptions {
  /** A debug label for the GPU resources. */
  readonly name: string;
  /** The whole fragment module, including its `effectFragment` entry point. */
  readonly fragmentWGSL: string;
  /** How large the effect's single uniform buffer is, in bytes. */
  readonly uniformByteLength: number;
  /** Whether each declared texture beyond the chain input is a `2d-array` view. */
  readonly declaredTextures: readonly { readonly array: boolean }[];
}

/**
 * Creates one fullscreen effect: its shader module, bind-group layout, uniform buffer, and texture
 * slots.
 *
 * @remarks
 * The binding layout is fixed and shared with the generated WGSL: `0` the uniform block, `1` and `2`
 * the chain's current colour and its sampler, then a texture/sampler pair per declared texture.
 * Nothing is compiled here — Lite builds the pipeline lazily, on the first `record()`.
 *
 * @param engine - The engine that owns the GPU resources.
 * @param options - The shader, the uniform size, and the declared textures.
 * @returns The effect wrapper. Bind its textures before recording a task for it.
 *
 * @internal
 */
export function createCustomEffect(engine: EngineContext, options: CustomEffectOptions): EffectWrapper {
  const bindings: EffectBindingLayout[] = [
    { name: "shaderUniforms", binding: 0, kind: "uniform", uniformByteLength: options.uniformByteLength },
    { name: "inputTexture", binding: 1, kind: "texture" },
    { name: "inputTextureSampler", binding: 2, kind: "sampler", textureBinding: 1 },
  ];
  for (let index = 0; index < options.declaredTextures.length; index += 1) {
    const declared = options.declaredTextures[index];
    const binding = 3 + index * 2;
    const layout: EffectBindingLayout = { name: `texture${String(index)}`, binding, kind: "texture" };
    if (declared?.array === true) {
      // The bind-group layout reads `viewDimension` straight off this field
      // (`bindingLayoutEntry`, `lib/effect/effect-renderer.js` 302).
      bindings.push({ ...layout, viewDimension: "2d-array" });
    } else {
      bindings.push(layout);
    }
    bindings.push({ name: `sampler${String(index)}`, binding: binding + 1, kind: "sampler", textureBinding: binding });
  }
  return createEffectWrapper(engine, { name: options.name, fragmentWGSL: options.fragmentWGSL, bindings });
}

/**
 * Binds a texture to one of an effect's texture slots.
 *
 * @remarks
 * Also marks the wrapper's bind group dirty, which is the only thing that does, so this is what has
 * to be called after a link is rebuilt or a declared texture is swapped.
 *
 * @param effect - The effect wrapper.
 * @param binding - The binding index.
 * @param texture - The texture.
 *
 * @internal
 */
export function bindCustomEffectTexture(effect: EffectWrapper, binding: number, texture: Texture2D): void {
  setEffectTexture(effect, binding, texture);
}

/**
 * Uploads an effect's uniform bytes.
 *
 * @remarks
 * A plain `queue.writeBuffer`, so it is safe to call every frame and costs nothing on a frame where
 * the bytes did not change — which is why the caller compares first.
 *
 * @param effect - The effect wrapper.
 * @param data - The bytes; no longer than the declared `uniformByteLength`.
 *
 * @internal
 */
export function writeCustomEffectUniforms(effect: EffectWrapper, data: Float32Array): void {
  setEffectUniforms(effect, data);
}

/**
 * Records one fullscreen effect as a frame-graph task writing `target`.
 *
 * @remarks
 * The task clears its target and draws a fullscreen triangle, so the whole target is overwritten and
 * the clear costs nothing. Append it with `appendPostProcessTask` from `./post-process.ts`.
 *
 * @param engine - The engine.
 * @param scene - The scene whose frame graph will hold it.
 * @param name - A debug label.
 * @param effect - The effect wrapper, with every texture already bound.
 * @param target - The colour target it writes; the surface swapchain for the last effect.
 * @returns The task.
 *
 * @internal
 */
export function createCustomEffectTask(
  engine: EngineContext,
  scene: SceneContext,
  name: string,
  effect: EffectWrapper,
  target: RenderTarget,
): Task {
  return createEffectRenderTask({ name, effect, target, clear: true }, engine, scene);
}

/**
 * Frees an effect wrapper's GPU resources.
 *
 * @param effect - The effect wrapper.
 *
 * @internal
 */
export function disposeCustomEffect(effect: EffectWrapper): void {
  disposeEffectWrapper(effect);
}

/**
 * Creates one ping-pong link of an effect chain: a colour target that is also a sampled texture.
 *
 * @remarks
 * Eager and fixed size, which Lite requires of a sampled render target (error 571) and which the
 * chain needs anyway, because an effect wrapper caches the texture view in its bind group. A resize
 * therefore rebuilds the chain rather than reallocating the link.
 *
 * @param engine - The engine that owns the texture.
 * @param format - The colour format; the surface's, so a built-in pass can write it.
 * @param width - The width in backing-store pixels.
 * @param height - The height in backing-store pixels.
 * @param label - A debug label.
 * @returns The link.
 *
 * @internal
 */
export function createEffectChainLink(
  engine: EngineContext,
  format: GPUTextureFormat,
  width: number,
  height: number,
  label: string,
): EffectChainLink {
  const created = createRenderTargetTexture(engine, {
    lbl: label,
    format,
    samples: 1,
    size: { width: Math.max(1, width), height: Math.max(1, height) },
  });
  return { target: created.rt, texture: created.texture };
}

/**
 * Frees a chain link's GPU texture.
 *
 * @remarks
 * `disposeRenderTarget` refuses to free an eager target, which is what keeps
 * `EffectRenderTask.dispose` from destroying a shared link, so the texture has to be destroyed here
 * instead.
 *
 * @param link - The link.
 *
 * @internal
 */
export function disposeEffectChainLink(link: EffectChainLink): void {
  link.texture.texture.destroy();
}

/**
 * Records a task that copies one colour target into another.
 *
 * @remarks
 * The chain uses it once, and only when its **first** effect is a custom one: the scene colour the
 * render path drew into is a canvas-sized, non-eager `RenderTarget` with no `Texture2D`, so it
 * cannot be sampled by an effect wrapper. One copy into a link makes it samplable. A chain that
 * starts with bloom or SMAA needs no copy, because those write a link directly.
 *
 * @param engine - The engine.
 * @param scene - The scene whose frame graph will hold it.
 * @param name - A debug label.
 * @param source - The target to read.
 * @param target - The target to write; externally owned, so the task does not rebuild or free it.
 * @returns The task.
 *
 * @internal
 */
export function createChainCopyTask(
  engine: EngineContext,
  scene: SceneContext,
  name: string,
  source: RenderTarget,
  target: RenderTarget,
): Task {
  return createCopyToTextureTask(
    { name, sourceTexture: source, targetTexture: target, ownsTargetTexture: false },
    engine,
    scene,
  );
}
