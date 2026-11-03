import {
  addTaskBefore,
  buildFrameGraphTask,
  createEffectRenderTask,
  createEffectWrapper,
  createSurfaceRenderTargetTexture,
  disposeEffectWrapper,
  disposeRenderTargetTexture,
  getFrameGraph,
  onRenderTargetTextureResize,
  setEffectTexture,
  setEffectUniforms,
} from "@babylonjs/lite";
import type { HdrOutputHandle } from "./render-path.js";
import type {
  EffectWrapper,
  EngineContext,
  RenderTarget,
  RenderTargetTextureResult,
  SceneContext,
  Task,
  Texture2D,
} from "@babylonjs/lite";

/**
 * HDR bloom (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G12): a downsample/upsample
 * chain on the linear `rgba16float` scene target, recorded before the HDR output pass so the glow
 * is tone mapped with the rest of the frame. Its own chunk: `../../render/hdr-bloom-support.ts`
 * imports it only when a `PostProcessStack` asks for bloom under `rendering.hdr`
 * (`CONSTITUTION.md` §2.5).
 *
 * ```text
 * scene → hdr ─ down₀ → mip₀ ─ down₁ → mip₁ … → mip₅
 *               mip₄ += up(mip₅) … mip₀ += up(mip₁)
 *         hdr  = mix(hdr, up(mip₀), intensity) ──→ output pass
 * ```
 *
 * - **Downsample** is the 13-tap filter of Jimenez, "Next generation post processing in Call of
 *   Duty: Advanced Warfare" (SIGGRAPH 2014): five overlapping 2×2 boxes, the centre one weighted
 *   0.5. The first level weights each box by `1 / (1 + luma)` (Karis average), so one very bright
 *   texel cannot flicker into a frame-sized blob, and applies the optional soft-knee threshold.
 * - **Upsample** is a 9-tap tent, blended into the next larger mip as
 *   `mip = mix(mip, tent(smaller), radius)`, so `radius` decides how much of the wide, low mips
 *   reaches the image while the weights still sum to one.
 * - **Composite** writes into the HDR target itself through the blend unit, so the output pass's
 *   input never changes and nothing is rebound: `hdr = mix(hdr, bloom, intensity)` with no
 *   threshold (energy-conserving: the image is redistributed, not brightened), `hdr += bloom ·
 *   intensity` with one.
 * - Each mip is a surface-scaled target (`{ surface, scale }`), so a resize reallocates it with
 *   the frame graph; the resize callbacks rebind the readers' bind groups.
 * - Lite has no task removal, so {@link HdrBloom.dispose} disables the tasks and makes their
 *   `record` a no-op: a later frame-graph rebuild still walks them.
 */

/**
 * How many mips the chain builds: half resolution down to 1/64.
 *
 * @internal
 */
export const HDR_BLOOM_MIP_COUNT = 6;

/**
 * The format of every mip; the same as the scene target, so values above 1 survive.
 *
 * @internal
 */
export const HDR_BLOOM_FORMAT: GPUTextureFormat = "rgba16float";

/** Uniform floats per pass: one `vec4`. */
const UNIFORM_FLOATS = 4;

/**
 * The tuning a `PostProcessStack`'s `bloom` record feeds the chain.
 *
 * @internal
 */
export interface HdrBloomTuning {
  /** How much glow is mixed in, 0–1. */
  readonly intensity: number;
  /** How far the glow spreads, 0–1: the weight of each lower mip when it is upsampled. */
  readonly radius: number;
  /** The linear luminance below which nothing glows; `0` lets every pixel contribute. */
  readonly threshold: number;
}

/**
 * A recorded HDR bloom chain.
 *
 * @internal
 */
export interface HdrBloom {
  /** The mip chain, largest first. */
  readonly mips: readonly Texture2D[];
  /** How many frame-graph tasks it recorded. */
  readonly taskCount: number;
  /**
   * Switches every task of the chain on or off.
   *
   * @param enabled - `false` to skip the chain; the HDR target then reaches the output pass as is.
   */
  setEnabled(enabled: boolean): void;
  /**
   * Uploads the tuning, when it changed.
   *
   * @param tuning - The values.
   */
  apply(tuning: HdrBloomTuning): void;
  /** Disables the tasks, makes them inert to a rebuild, and frees the mips and effects. */
  dispose(): void;
}

/** The blend that turns a pass's `vec4(rgb, a)` into `dst·(1 − a) + rgb`. */
const MIX_BLEND: GPUBlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "zero", dstFactor: "one" },
};

/**
 * The uniform block, texture, sampler and helpers every pass declares.
 *
 * @returns The WGSL.
 */
function passHeaderWgsl(): string {
  return [
    "struct BloomUniforms{params:vec4<f32>};",
    "@group(0)@binding(0)var<uniform>bloom:BloomUniforms;",
    "@group(0)@binding(1)var source:texture_2d<f32>;",
    "@group(0)@binding(2)var sourceSampler:sampler;",
    // Lite's fullscreen triangle puts uv (0,0) at the bottom left; textures start at the top left.
    "fn bloomUv(fragment:EffectVertexOutput)->vec2<f32>{return vec2<f32>(fragment.uv.x,1.0-fragment.uv.y);}",
    "fn tap(uv:vec2<f32>,offset:vec2<f32>,texel:vec2<f32>)->vec3<f32>{",
    "let c=textureSampleLevel(source,sourceSampler,uv+offset*texel,0.0).rgb;",
    "return min(max(c,vec3<f32>(0.0)),vec3<f32>(65000.0));",
    "}",
  ].join("\n");
}

/**
 * The downsample pass: 13 taps, a Karis average and the soft-knee threshold on the first level.
 *
 * @remarks
 * `params` is `(threshold, knee, isFirstLevel, unused)`.
 *
 * @returns The WGSL, with Lite's `effectFragment` entry point.
 *
 * @internal
 */
export function bloomDownsampleWgsl(): string {
  return [
    passHeaderWgsl(),
    "fn boxWeight(c:vec3<f32>,first:bool)->f32{",
    "if(!first){return 1.0;}",
    "return 1.0/(1.0+dot(c,vec3<f32>(0.2126,0.7152,0.0722)));",
    "}",
    "fn knee(c:vec3<f32>,threshold:f32,soft:f32)->vec3<f32>{",
    "if(threshold<=0.0){return c;}",
    "let b=max(c.r,max(c.g,c.b));",
    "var s=clamp(b-threshold+soft,0.0,2.0*soft);",
    "s=s*s/(4.0*soft+1e-5);",
    "return c*(max(s,b-threshold)/max(b,1e-5));",
    "}",
    "@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{",
    "let uv=bloomUv(fragment);",
    "let texel=1.0/vec2<f32>(textureDimensions(source,0));",
    "let first=bloom.params.z>0.5;",
    "let a=tap(uv,vec2<f32>(-2.0,-2.0),texel);let b=tap(uv,vec2<f32>(0.0,-2.0),texel);",
    "let c=tap(uv,vec2<f32>(2.0,-2.0),texel);let d=tap(uv,vec2<f32>(-2.0,0.0),texel);",
    "let e=tap(uv,vec2<f32>(0.0,0.0),texel);let f=tap(uv,vec2<f32>(2.0,0.0),texel);",
    "let g=tap(uv,vec2<f32>(-2.0,2.0),texel);let h=tap(uv,vec2<f32>(0.0,2.0),texel);",
    "let i=tap(uv,vec2<f32>(2.0,2.0),texel);let j=tap(uv,vec2<f32>(-1.0,-1.0),texel);",
    "let k=tap(uv,vec2<f32>(1.0,-1.0),texel);let l=tap(uv,vec2<f32>(-1.0,1.0),texel);",
    "let m=tap(uv,vec2<f32>(1.0,1.0),texel);",
    "let g0=(j+k+l+m)*0.25;let g1=(a+b+d+e)*0.25;let g2=(b+c+e+f)*0.25;",
    "let g3=(d+e+g+h)*0.25;let g4=(e+f+h+i)*0.25;",
    "let w0=0.5*boxWeight(g0,first);let w1=0.125*boxWeight(g1,first);let w2=0.125*boxWeight(g2,first);",
    "let w3=0.125*boxWeight(g3,first);let w4=0.125*boxWeight(g4,first);",
    "var color=(g0*w0+g1*w1+g2*w2+g3*w3+g4*w4)/(w0+w1+w2+w3+w4);",
    "if(first){color=knee(color,bloom.params.x,bloom.params.y);}",
    "return vec4<f32>(color,1.0);",
    "}",
  ].join("\n");
}

/**
 * The upsample and composite pass: a 9-tap tent of the smaller mip, scaled, with the blend weight
 * in alpha.
 *
 * @remarks
 * `params` is `(scale, alpha, unused, unused)`; with {@link MIX_BLEND} the target becomes
 * `target·(1 − alpha) + tent·scale`.
 *
 * @returns The WGSL, with Lite's `effectFragment` entry point.
 *
 * @internal
 */
export function bloomUpsampleWgsl(): string {
  return [
    passHeaderWgsl(),
    "@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{",
    "let uv=bloomUv(fragment);",
    "let texel=1.0/vec2<f32>(textureDimensions(source,0));",
    "var color=tap(uv,vec2<f32>(0.0,0.0),texel)*4.0;",
    "color+=(tap(uv,vec2<f32>(-1.0,0.0),texel)+tap(uv,vec2<f32>(1.0,0.0),texel)",
    "+tap(uv,vec2<f32>(0.0,-1.0),texel)+tap(uv,vec2<f32>(0.0,1.0),texel))*2.0;",
    "color+=tap(uv,vec2<f32>(-1.0,-1.0),texel)+tap(uv,vec2<f32>(1.0,-1.0),texel)",
    "+tap(uv,vec2<f32>(-1.0,1.0),texel)+tap(uv,vec2<f32>(1.0,1.0),texel);",
    "return vec4<f32>(color*(bloom.params.x/16.0),bloom.params.y);",
    "}",
  ].join("\n");
}

/**
 * Writes every pass's uniforms for a tuning.
 *
 * @remarks
 * Laid out as `HDR_BLOOM_MIP_COUNT` downsample blocks, then `HDR_BLOOM_MIP_COUNT − 1` upsample
 * blocks (smallest first), then the composite: the order the tasks run in. Values are clamped to
 * their documented ranges, so an inspector typo cannot blow the frame up.
 *
 * @param tuning - The values.
 * @param out - `(2 · HDR_BLOOM_MIP_COUNT) · 4` floats, overwritten.
 *
 * @internal
 */
export function writeHdrBloomUniforms(tuning: HdrBloomTuning, out: Float32Array): void {
  const threshold = Math.max(0, tuning.threshold);
  const radius = Math.min(1, Math.max(0, tuning.radius));
  const intensity = Math.max(0, tuning.intensity);
  out.fill(0);
  for (let level = 0; level < HDR_BLOOM_MIP_COUNT; level += 1) {
    const base = level * UNIFORM_FLOATS;
    out[base] = threshold;
    out[base + 1] = threshold * 0.5;
    out[base + 2] = level === 0 ? 1 : 0;
  }
  for (let step = 0; step < HDR_BLOOM_MIP_COUNT - 1; step += 1) {
    const base = (HDR_BLOOM_MIP_COUNT + step) * UNIFORM_FLOATS;
    out[base] = radius;
    out[base + 1] = radius;
  }
  const composite = (2 * HDR_BLOOM_MIP_COUNT - 1) * UNIFORM_FLOATS;
  out[composite] = intensity;
  // With a threshold only the highlights are in the chain, so the glow is added; without one the
  // chain holds the whole image and mixing keeps the frame's energy.
  out[composite + 1] = threshold > 0 ? 0 : Math.min(1, intensity);
}

/** One pass of the chain: its effect, the texture it reads and its task. */
interface BloomPass {
  readonly effect: EffectWrapper;
  readonly task: Task;
  readonly source: () => Texture2D;
}

/**
 * Builds the HDR bloom chain and inserts it before the HDR output pass.
 *
 * @remarks
 * Before the scene is registered the tasks are only inserted, and `registerScene`'s build records
 * them in order; after, each is recorded on the spot (`buildFrameGraphTask`), as
 * `appendPostProcessTask` in `./post-process.ts` does.
 *
 * @param engine - The engine, which is also the primary surface.
 * @param scene - The scene whose frame graph holds the HDR output pass.
 * @param hdr - The HDR half of the scene's presenter.
 * @param isFrameGraphBuilt - Whether the scene has been registered.
 * @returns The chain, enabled, with zero tuning until {@link HdrBloom.apply} runs.
 *
 * @internal
 */
export function installHdrBloom(
  engine: EngineContext,
  scene: SceneContext,
  hdr: HdrOutputHandle,
  isFrameGraphBuilt: boolean,
): HdrBloom {
  const mips: RenderTargetTextureResult[] = [];
  for (let level = 0; level < HDR_BLOOM_MIP_COUNT; level += 1) {
    mips.push(
      createSurfaceRenderTargetTexture(engine, {
        lbl: `ignifx:bloom-mip-${String(level)}`,
        format: HDR_BLOOM_FORMAT,
        samples: 1,
        size: { surface: engine, scale: 0.5 ** (level + 1) },
      }),
    );
  }
  const mipAt = (level: number): RenderTargetTextureResult => {
    const mip = mips[level];
    if (mip === undefined) {
      throw new RangeError(`HDR bloom has no mip ${String(level)}.`);
    }
    return mip;
  };
  const downsample = bloomDownsampleWgsl();
  const upsample = bloomUpsampleWgsl();
  const passes: BloomPass[] = [];
  const addPass = (name: string, fragmentWGSL: string, source: () => Texture2D, target: RenderTarget): void => {
    const blended = fragmentWGSL === upsample;
    const effect = createEffectWrapper(engine, {
      name,
      fragmentWGSL,
      bindings: [
        { name: "bloom", binding: 0, kind: "uniform", uniformByteLength: UNIFORM_FLOATS * 4 },
        { name: "source", binding: 1, kind: "texture" },
        { name: "sourceSampler", binding: 2, kind: "sampler", textureBinding: 1 },
      ],
      ...(blended ? { blend: MIX_BLEND } : {}),
    });
    setEffectTexture(effect, 1, source());
    setEffectUniforms(effect, new Float32Array(UNIFORM_FLOATS));
    const task = createEffectRenderTask({ name, effect, target, clear: !blended }, engine, scene);
    passes.push({ effect, task, source });
  };
  for (let level = 0; level < HDR_BLOOM_MIP_COUNT; level += 1) {
    const source = level === 0 ? (): Texture2D => hdr.sceneTarget.texture : (): Texture2D => mipAt(level - 1).texture;
    addPass(`ignifx:bloom-down-${String(level)}`, downsample, source, mipAt(level).rt);
  }
  for (let level = HDR_BLOOM_MIP_COUNT - 2; level >= 0; level -= 1) {
    addPass(`ignifx:bloom-up-${String(level)}`, upsample, () => mipAt(level + 1).texture, mipAt(level).rt);
  }
  addPass("ignifx:bloom-composite", upsample, () => mipAt(0).texture, hdr.sceneTarget.rt);

  const graph = getFrameGraph(scene);
  for (const pass of passes) {
    addTaskBefore(scene, pass.task, hdr.outputTask);
    if (isFrameGraphBuilt) {
      buildFrameGraphTask(graph, pass.task);
    }
  }

  // A resize swaps the textures behind the facades; a wrapper's cached bind group keeps the old
  // view until a texture write marks it dirty.
  const rebind = (): void => {
    for (const pass of passes) {
      setEffectTexture(pass.effect, 1, pass.source());
    }
  };
  const unsubscribe = [hdr.sceneTarget, ...mips].map((target) => onRenderTargetTextureResize(target, rebind));

  const uniforms = new Float32Array(passes.length * UNIFORM_FLOATS);
  const scratch = new Float32Array(UNIFORM_FLOATS);
  let isDisposed = false;
  let applied: HdrBloomTuning = { intensity: Number.NaN, radius: Number.NaN, threshold: Number.NaN };
  return {
    mips: mips.map((mip) => mip.texture),
    taskCount: passes.length,
    setEnabled(enabled: boolean): void {
      for (const pass of passes) {
        pass.task.executionEnabled = enabled && !isDisposed;
      }
    },
    apply(tuning: HdrBloomTuning): void {
      if (
        isDisposed ||
        (applied.intensity === tuning.intensity &&
          applied.radius === tuning.radius &&
          applied.threshold === tuning.threshold)
      ) {
        return;
      }
      applied = { intensity: tuning.intensity, radius: tuning.radius, threshold: tuning.threshold };
      writeHdrBloomUniforms(tuning, uniforms);
      for (let index = 0; index < passes.length; index += 1) {
        const pass = passes[index];
        if (pass === undefined) {
          continue;
        }
        scratch.set(uniforms.subarray(index * UNIFORM_FLOATS, (index + 1) * UNIFORM_FLOATS));
        setEffectUniforms(pass.effect, scratch);
      }
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      for (const stop of unsubscribe) {
        stop();
      }
      for (const pass of passes) {
        pass.task.executionEnabled = false;
        // Lite cannot remove a task, and a frame-graph rebuild records every task, disabled or not.
        pass.task.record = inertRecord;
        disposeEffectWrapper(pass.effect);
      }
      for (const mip of mips) {
        disposeRenderTargetTexture(mip);
      }
    },
  };
}

/** What a disposed pass records: nothing. */
function inertRecord(): void {
  // Intentionally empty; see `HdrBloom.dispose`.
}
