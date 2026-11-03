import {
  addComputeDispatch,
  addTask,
  computeStorageBufferBinding,
  computeStorageTextureBinding,
  computeTextureBinding,
  computeUniformBufferBinding,
  createComputeBindingSet,
  createComputeDispatch,
  createComputeShader,
  createComputeStorageTexture2D,
  createComputeTask,
  createComputeTextureResource,
  createStorageBuffer,
  createUniformBuffer,
  updateUniformBuffer,
} from "@babylonjs/lite";
import type { EngineContext, SceneContext, Texture2D } from "@babylonjs/lite";

/**
 * Auto exposure for the HDR render path (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G14).
 * Its own chunk: `../engine.ts` imports it only when `rendering.hdr` and
 * `rendering.autoExposure.enabled` are both on (`CONSTITUTION.md` §2.5).
 *
 * ```text
 * scene ─→ hdr ─→ [histogram] ─→ [average + adapt] ─→ exposure (1×1 r32float) ─→ output pass
 * ```
 *
 * - **Histogram.** A 64×64 grid of texels, spread over the whole target whatever its size, is
 *   binned by `log2` luminance into 256 bins; bin 0 takes everything darker than the range, such as
 *   a black clear, and is left out of the average.
 * - **Average.** One workgroup reads the bins (and zeroes them for the next frame), drops the
 *   darkest and brightest {@link AUTO_EXPOSURE_PERCENTILES} of the counted texels, and averages the
 *   rest in `log2` space: the scene's metered EV.
 * - **Adaptation.** The metered EV is clamped to `[minEv, maxEv]` and the current EV eases towards
 *   it, `speedUp` when the scene got brighter and `speedDown` when it got darker; the first frame
 *   snaps. The pass writes `log2` of the multiplier that maps the current EV to middle grey (0.18),
 *   plus `compensation`, so an unwritten texture (0) means "×1".
 * - **The output pass** multiplies the linear colour by `exp2` of that texel before the
 *   `Environment`'s exposure and curve (`./hdr-output.ts`).
 */

/**
 * The auto exposure knobs, in EV (stops, `log2` units) and per-second rates.
 *
 * @internal
 */
export interface AutoExposureOptions {
  /** The darkest metered EV the exposure follows: darker scenes are not brightened further. */
  readonly minEv: number;
  /** The brightest metered EV the exposure follows: brighter scenes are not darkened further. */
  readonly maxEv: number;
  /** Adaptation rate, per second, when the scene gets brighter. */
  readonly speedUp: number;
  /** Adaptation rate, per second, when the scene gets darker. */
  readonly speedDown: number;
  /** Stops added to the computed exposure; positive is brighter. */
  readonly compensation: number;
}

/**
 * What {@link installAutoExposure} hands the output pass.
 *
 * @internal
 */
export interface AutoExposurePass {
  /** A 1×1 `r32float` texture holding `log2` of the exposure multiplier; 0 until the first run. */
  readonly exposureTexture: Texture2D;
  /** The per-frame work: uploads the frame's delta time with the knobs. */
  update(): void;
}

/**
 * The fraction of counted texels dropped at each end of the histogram before averaging.
 *
 * @internal
 */
export const AUTO_EXPOSURE_PERCENTILES = { low: 0.1, high: 0.9 } as const;

/**
 * The `log2` luminance range the histogram covers; bins 1–255 split it evenly.
 *
 * @internal
 */
export const AUTO_EXPOSURE_LOG_RANGE = { min: -12, max: 12 } as const;

/** The task's name in the frame graph. */
const TASK_NAME = "ignifx:auto-exposure";

/** The edge of the sample grid: 64×64 texels, four workgroups of 16×16 a side. */
const GRID = 64;

/** The workgroup edge of the histogram pass. */
const WORKGROUP_EDGE = 16;

/** The bin count; also the average pass's workgroup size. */
const BINS = 256;

/** Floats in the parameter block: dt, minEv, maxEv, speedUp, speedDown, compensation, low, high. */
const PARAM_FLOATS = 8;

/** The longest frame the adaptation integrates, in seconds, so a stall does not jump the exposure. */
const MAX_DELTA_SECONDS = 0.25;

/**
 * The WGSL shared by both passes.
 *
 * @returns The parameter struct and the histogram constants.
 */
function sharedWgsl(): string {
  return [
    "struct Params{dt:f32,minEv:f32,maxEv:f32,speedUp:f32,speedDown:f32,compensation:f32,low:f32,high:f32};",
    `const BINS:u32=${String(BINS)}u;`,
    `const LOG_MIN:f32=${AUTO_EXPOSURE_LOG_RANGE.min.toFixed(1)};`,
    `const LOG_MAX:f32=${AUTO_EXPOSURE_LOG_RANGE.max.toFixed(1)};`,
  ].join("\n");
}

/**
 * Builds the histogram pass: one texel per invocation, binned in workgroup memory and then added to
 * the global bins.
 *
 * @returns The WGSL, entry point `main`.
 *
 * @internal
 */
export function autoExposureHistogramWgsl(): string {
  return [
    sharedWgsl(),
    `const GRID:f32=${GRID.toFixed(1)};`,
    "@group(0)@binding(0)var hdrColor:texture_2d<f32>;",
    "@group(0)@binding(1)var<storage,read_write>histogram:array<atomic<u32>,256>;",
    "var<workgroup>localBins:array<atomic<u32>,256>;",
    "fn binOf(luminance:f32)->u32{",
    "if(luminance<exp2(LOG_MIN)){return 0u;}",
    "let t=clamp((log2(luminance)-LOG_MIN)/(LOG_MAX-LOG_MIN),0.0,1.0);",
    "return min(1u+u32(t*f32(BINS-2u)+0.5),BINS-1u);",
    "}",
    `@compute @workgroup_size(${String(WORKGROUP_EDGE)},${String(WORKGROUP_EDGE)})`,
    "fn main(@builtin(global_invocation_id)id:vec3<u32>,@builtin(local_invocation_index)localIndex:u32){",
    "atomicStore(&localBins[localIndex],0u);",
    "workgroupBarrier();",
    "let size=textureDimensions(hdrColor);",
    "let pixel=vec2<u32>((vec2<f32>(id.xy)+0.5)/GRID*vec2<f32>(size));",
    "let texel=textureLoad(hdrColor,min(pixel,size-vec2<u32>(1u)),0).rgb;",
    "let luminance=dot(max(texel,vec3<f32>(0.0)),vec3<f32>(0.2126,0.7152,0.0722));",
    "atomicAdd(&localBins[binOf(luminance)],1u);",
    "workgroupBarrier();",
    "let count=atomicLoad(&localBins[localIndex]);",
    "if(count>0u){atomicAdd(&histogram[localIndex],count);}",
    "}",
  ].join("\n");
}

/**
 * Builds the average-and-adapt pass: 256 invocations load and clear the bins, then the first one
 * walks them once.
 *
 * @returns The WGSL, entry point `main`.
 *
 * @internal
 */
export function autoExposureAverageWgsl(): string {
  return [
    sharedWgsl(),
    "@group(0)@binding(0)var<uniform>params:Params;",
    "@group(0)@binding(1)var<storage,read_write>histogram:array<atomic<u32>,256>;",
    "@group(0)@binding(2)var<storage,read_write>state:array<f32,4>;",
    "@group(0)@binding(3)var exposure:texture_storage_2d<r32float,write>;",
    "var<workgroup>bins:array<u32,256>;",
    `@compute @workgroup_size(${String(BINS)})`,
    "fn main(@builtin(local_invocation_index)localIndex:u32){",
    "bins[localIndex]=atomicExchange(&histogram[localIndex],0u);",
    "workgroupBarrier();",
    "if(localIndex!=0u){return;}",
    "var total=0.0;",
    "for(var i=1u;i<BINS;i++){total+=f32(bins[i]);}",
    "var current=state[0];",
    "var goal=current;",
    "if(total>0.0){",
    "let lowCut=total*params.low;",
    "let highCut=total*params.high;",
    "var seen=0.0;var sum=0.0;var weight=0.0;",
    "for(var i=1u;i<BINS;i++){",
    "let count=f32(bins[i]);",
    "let kept=clamp(seen+count,lowCut,highCut)-clamp(seen,lowCut,highCut);",
    "seen+=count;",
    "let binLog=LOG_MIN+(f32(i)-1.0)/f32(BINS-2u)*(LOG_MAX-LOG_MIN);",
    "sum+=kept*binLog;weight+=kept;",
    "}",
    "if(weight>0.0){goal=clamp(sum/weight,params.minEv,params.maxEv);}",
    "}",
    "if(state[1]<0.5){",
    "if(total>0.0){current=goal;state[1]=1.0;}",
    "}else{",
    "let speed=select(params.speedDown,params.speedUp,goal>current);",
    "current+=(goal-current)*(1.0-exp(-params.dt*max(speed,0.0)));",
    "}",
    "state[0]=current;",
    "let value=select(0.0,log2(0.18)+params.compensation-current,state[1]>0.5);",
    "textureStore(exposure,vec2<i32>(0,0),vec4<f32>(value,0.0,0.0,1.0));",
    "}",
  ].join("\n");
}

/**
 * Builds the auto exposure passes over the HDR scene target and appends them to the frame graph.
 *
 * @remarks
 * Call it after the scene task and before the output tasks, so the frame meters the colour it is
 * about to present. The HDR texture's compute view is validated asynchronously by Lite
 * (`createComputeTextureResource`), so the dispatches join the task once that settles; until then
 * the exposure texture reads 0 and the output pass multiplies by 1. A resize swaps the texture
 * behind the facade, which Lite's compute bindings notice by themselves
 * (`lib/compute/compute-texture-resource.js`, `_validateComputeTextureResource`).
 *
 * @param engine - The engine.
 * @param scene - The scene whose frame graph gets the task.
 * @param hdrTexture - The linear scene colour, `rgba16float`.
 * @param options - The knobs.
 * @returns The exposure texture and the per-frame update.
 *
 * @internal
 */
export function installAutoExposure(
  engine: EngineContext,
  scene: SceneContext,
  hdrTexture: Texture2D,
  options: AutoExposureOptions,
): AutoExposurePass {
  const task = createComputeTask(engine, TASK_NAME);
  addTask(scene, task);
  const histogram = createStorageBuffer(engine, BINS * 4, { label: "ignifx:auto-exposure-histogram", writable: true });
  const state = createStorageBuffer(engine, 16, { label: "ignifx:auto-exposure-state", writable: true });
  const exposure = createComputeStorageTexture2D(engine, {
    width: 1,
    height: 1,
    format: "r32float",
    label: "ignifx:auto-exposure",
  });
  const params = new Float32Array(PARAM_FLOATS);
  params[1] = options.minEv;
  params[2] = options.maxEv;
  params[3] = options.speedUp;
  params[4] = options.speedDown;
  params[5] = options.compensation;
  params[6] = AUTO_EXPOSURE_PERCENTILES.low;
  params[7] = AUTO_EXPOSURE_PERCENTILES.high;
  const uniforms = createUniformBuffer(engine, params, { label: "ignifx:auto-exposure-params" });

  const histogramShader = createComputeShader(engine, {
    name: "ignifx:auto-exposure-histogram",
    computeSource: autoExposureHistogramWgsl(),
    entryPoint: "main",
    bindings: [
      computeTextureBinding("hdrColor", { group: 0, binding: 0, sampleType: "unfilterable-float" }),
      computeStorageBufferBinding("histogram", { group: 0, binding: 1, access: "read-write" }),
    ],
  });
  const averageShader = createComputeShader(engine, {
    name: "ignifx:auto-exposure-average",
    computeSource: autoExposureAverageWgsl(),
    entryPoint: "main",
    bindings: [
      computeUniformBufferBinding("params", { group: 0, binding: 0 }),
      computeStorageBufferBinding("histogram", { group: 0, binding: 1, access: "read-write" }),
      computeStorageBufferBinding("state", { group: 0, binding: 2, access: "read-write" }),
      computeStorageTextureBinding("exposure", { group: 0, binding: 3, format: "r32float" }),
    ],
  });

  void createComputeTextureResource(engine, hdrTexture, { sampleType: "unfilterable-float" }).then((hdrColor) => {
    const groups = GRID / WORKGROUP_EDGE;
    addComputeDispatch(
      task,
      createComputeDispatch(histogramShader, createComputeBindingSet(histogramShader, { hdrColor, histogram }), {
        size: { x: groups, y: groups },
      }),
    );
    addComputeDispatch(
      task,
      createComputeDispatch(
        averageShader,
        createComputeBindingSet(averageShader, { params: uniforms, histogram, state, exposure }),
        { size: { x: 1 } },
      ),
    );
  });

  let last = -1;
  return {
    exposureTexture: exposure.sampledTexture,
    update(): void {
      const now = performance.now();
      params[0] = last < 0 ? 0 : Math.min(Math.max((now - last) / 1000, 0), MAX_DELTA_SECONDS);
      last = now;
      updateUniformBuffer(engine, uniforms, params);
    },
  };
}
