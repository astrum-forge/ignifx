import {
  createCopyToTextureTask,
  createEffectRenderTask,
  createEffectWrapper,
  createSurfaceRenderTargetTexture,
  disposeEffectWrapper,
  disposeRenderTargetTexture,
  onRenderTargetTextureResize,
  setEffectTexture,
  setEffectUniforms,
} from "@babylonjs/lite";
import { Mat4 } from "../../math/mat4.js";
import type { HdrOutputHandle } from "./render-path.js";
import type { SceneInputs } from "./scene-inputs.js";
import type { EffectWrapper, EngineContext, RenderTargetTextureResult, SceneContext, Task } from "@babylonjs/lite";

/**
 * Temporal anti-aliasing (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, steps G5 and G6;
 * `docs/architecture/07-rendering.md` §2.13). Its own chunk: the renderer imports it only when
 * `rendering.taa.enabled` is on, so a project without TAA loads none of it and its frame graph has
 * none of these tasks (`CONSTITUTION.md` §2.5). HDR only: it runs on linear `rgba16float` colour,
 * between the scene pass and the HDR output pass.
 *
 * ```text
 * scene-inputs (depth, velocity) → scene (jittered) → taa-jitter → taa-resolve → resolved
 *                                                                   resolved ─(copy)─→ history
 *                                                                   resolved ─ taa-output (sharpen) ─→ hdr scene target
 *                                                                   depth ─ taa-depth ─→ previous depth
 * ```
 *
 * - **Jitter.** Every frame the scene pass's view-projection is offset by a Halton (2,3) sub-pixel
 *   step, written over the first 64 bytes of the scene task's scene uniform buffer after the task
 *   wrote its own (the trick Lite's own `createTaaPostProcessTask` uses, `lib/post-process/taa.js`).
 *   Only the GPU copy is jittered: Lite's camera caches, picking, `Camera.worldToScreen` and the
 *   scene-inputs geometry pass all see the clean matrices.
 * - **Reprojection.** Where the geometry pass drew, the previous position comes from the scene-inputs
 *   velocity (the nearest depth in the 3×3 neighbourhood picks the texel). Where it drew nothing (the
 *   sky), the pixel is reprojected through the inverse view-projection and the previous one. Lite
 *   1.34's PBR velocity tracks camera motion only, so a moving PBR mesh relies on the clamp below.
 * - **Clamping.** History is clipped to the variance box of the current 3×3 neighbourhood in YCoCg,
 *   on colour compressed by `c / (1 + max(c))` so bright HDR texels do not flicker.
 * - **Rejection.** History is dropped where the reprojected position leaves the screen, and where
 *   the depth stored last frame at that position disagrees with where this pixel's surface would
 *   have been (a disocclusion).
 * - **Reset.** On the first frame, a resize, a camera cut (a jump further than `cutDistance`, or a
 *   turn over 60° in one frame) and on {@link TaaHandle.reset}.
 */

/**
 * The frame-graph task names, in the order they run after `"scene"`.
 *
 * @internal
 */
export const TAA_TASK_NAMES = {
  jitter: "ignifx:taa-jitter",
  resolve: "ignifx:taa-resolve",
  history: "ignifx:taa-history",
  output: "ignifx:taa-output",
  depth: "ignifx:taa-depth",
} as const;

/**
 * The tuning the TAA chunk reads, resolved from `rendering.taa`.
 *
 * @internal
 */
export interface TaaOptions {
  /** Weight of the current frame, 0–1; lower is smoother and slower to respond. */
  readonly blend: number;
  /** Output sharpening, 0–1. */
  readonly sharpness: number;
  /** Whether history is clipped to the current neighbourhood (off only to debug ghosting). */
  readonly clamp: boolean;
  /** How far the camera may move in one frame, in world units, before history resets. */
  readonly cutDistance: number;
}

/**
 * The installed TAA passes.
 *
 * @internal
 */
export interface TaaHandle {
  /** Drops the history on the next frame, as a camera cut does. */
  reset(): void;
  /** How many times history has been reset, first frame included; for tests and diagnostics. */
  readonly resetCount: number;
  /** The jitter of the last frame, in pixels, each in `[-0.5, 0.5)`. */
  readonly jitter: readonly [number, number];
}

/** How many Halton (2,3) points the jitter cycles through. */
const HALTON_SAMPLES = 8;

/** Cosine of the largest turn in one frame that is not a camera cut (60°). */
const CUT_COSINE = 0.5;

/** Relative depth disagreement above which reprojected history counts as disoccluded. */
const DEPTH_TOLERANCE = 0.05;

/** The resolve's uniform block: inverse view-projection, previous view-projection, params, size. */
const RESOLVE_FLOATS = 40;

/**
 * The `index`-th element of the Halton sequence in `base`.
 *
 * @param index - 1-based index.
 * @param base - The base, 2 or 3.
 * @returns A value in `[0, 1)`.
 *
 * @internal
 */
export function halton(index: number, base: number): number {
  let fraction = 1;
  let result = 0;
  let rest = index;
  while (rest > 0) {
    fraction /= base;
    result += fraction * (rest % base);
    rest = Math.floor(rest / base);
  }
  return result;
}

/**
 * Whether the camera moved far enough between two frames to count as a cut.
 *
 * @param previous - Last frame's eye position and forward axis: `[x, y, z, fx, fy, fz]`.
 * @param current - This frame's, in the same layout.
 * @param cutDistance - The largest jump that is not a cut, in world units.
 * @returns `true` for a cut.
 *
 * @internal
 */
export function isCameraCut(previous: ArrayLike<number>, current: ArrayLike<number>, cutDistance: number): boolean {
  const dx = (current[0] ?? 0) - (previous[0] ?? 0);
  const dy = (current[1] ?? 0) - (previous[1] ?? 0);
  const dz = (current[2] ?? 0) - (previous[2] ?? 0);
  if (dx * dx + dy * dy + dz * dz > cutDistance * cutDistance) {
    return true;
  }
  const dot =
    (current[3] ?? 0) * (previous[3] ?? 0) +
    (current[4] ?? 0) * (previous[4] ?? 0) +
    (current[5] ?? 0) * (previous[5] ?? 0);
  return dot < CUT_COSINE;
}

/**
 * The resolve pass's fragment shader.
 *
 * @returns The WGSL, with Lite's `effectFragment` entry point.
 *
 * @internal
 */
export function taaResolveFragmentWgsl(): string {
  return `struct TaaUniforms{invViewProj:mat4x4<f32>,prevViewProj:mat4x4<f32>,params:vec4<f32>,size:vec4<f32>};
@group(0)@binding(0)var<uniform>taa:TaaUniforms;
@group(0)@binding(1)var currentColor:texture_2d<f32>;
@group(0)@binding(2)var historyColor:texture_2d<f32>;
@group(0)@binding(3)var sceneDepth:texture_depth_2d;
@group(0)@binding(4)var sceneVelocity:texture_2d<f32>;
@group(0)@binding(5)var previousDepth:texture_2d<f32>;
fn taaCompress(c:vec3<f32>)->vec3<f32>{return c/(1.0+max(c.r,max(c.g,c.b)));}
fn taaExpand(c:vec3<f32>)->vec3<f32>{return c/max(1.0-max(c.r,max(c.g,c.b)),1e-4);}
fn taaToYCoCg(c:vec3<f32>)->vec3<f32>{return vec3<f32>(0.25*c.r+0.5*c.g+0.25*c.b,0.5*c.r-0.5*c.b,-0.25*c.r+0.5*c.g-0.25*c.b);}
fn taaFromYCoCg(c:vec3<f32>)->vec3<f32>{let t=c.x-c.z;return vec3<f32>(t+c.y,c.x+c.z,t-c.y);}
fn taaCatmullRom(t:f32)->vec4<f32>{let t2=t*t;let t3=t2*t;
return vec4<f32>(-0.5*t3+t2-0.5*t,1.5*t3-2.5*t2+1.0,-1.5*t3+2.0*t2+0.5*t,0.5*t3-0.5*t2);}
fn taaHistory(pos:vec2<f32>,size:vec2<i32>)->vec3<f32>{
let p=pos-vec2<f32>(0.5);let base=floor(p);let f=p-base;
var wx=taaCatmullRom(f.x);var wy=taaCatmullRom(f.y);var sum=vec3<f32>(0.0);
for(var j=0;j<4;j++){for(var i=0;i<4;i++){
let q=clamp(vec2<i32>(base)+vec2<i32>(i-1,j-1),vec2<i32>(0),size-vec2<i32>(1));
sum+=textureLoad(historyColor,q,0).rgb*(wx[i]*wy[j]);}}
return max(sum,vec3<f32>(0.0));}
@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{
let size=vec2<i32>(taa.size.xy);
let pixel=vec2<i32>(fragment.position.xy);
let current=textureLoad(currentColor,pixel,0);
let currentY=taaToYCoCg(taaCompress(max(current.rgb,vec3<f32>(0.0))));
var m1=vec3<f32>(0.0);var m2=vec3<f32>(0.0);
var lo=vec3<f32>(1e9);var hi=vec3<f32>(-1e9);
var nearest=0.0;var nearestPixel=pixel;
for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
let q=clamp(pixel+vec2<i32>(x,y),vec2<i32>(0),size-vec2<i32>(1));
let c=taaToYCoCg(taaCompress(max(textureLoad(currentColor,q,0).rgb,vec3<f32>(0.0))));
m1+=c;m2+=c*c;lo=min(lo,c);hi=max(hi,c);
let d=textureLoad(sceneDepth,q,0);
if(d>nearest){nearest=d;nearestPixel=q;}}}
let uv=fragment.position.xy/taa.size.xy;
let depth=textureLoad(sceneDepth,pixel,0);
let ndc=vec4<f32>(uv.x*2.0-1.0,1.0-uv.y*2.0,depth,1.0);
let world=taa.invViewProj*ndc;
let prevClip=taa.prevViewProj*world;
var prevUv:vec2<f32>;
if(nearest>0.0){let v=textureLoad(sceneVelocity,nearestPixel,0).xy;prevUv=uv+vec2<f32>(v.x,-v.y);}
else{let p=prevClip.xy/prevClip.w;prevUv=vec2<f32>(p.x*0.5+0.5,0.5-p.y*0.5);}
var alpha=taa.params.x;
if(taa.params.y>0.5||prevClip.w<=0.0||any(prevUv<vec2<f32>(0.0))||any(prevUv>vec2<f32>(1.0))){alpha=1.0;}
if(depth>0.0&&alpha<1.0){
let stored=textureLoad(previousDepth,clamp(vec2<i32>(prevUv*taa.size.xy),vec2<i32>(0),size-vec2<i32>(1)),0).r;
let expected=prevClip.z/prevClip.w;
if(abs(expected-stored)>taa.params.w*max(expected,1e-6)){alpha=1.0;}}
var history=taaToYCoCg(taaCompress(taaHistory(prevUv*taa.size.xy,size)));
if(taa.params.z>0.5){
let mean=m1/9.0;let sigma=sqrt(max(m2/9.0-mean*mean,vec3<f32>(0.0)));
let boxLo=max(lo,mean-1.25*sigma);let boxHi=min(hi,mean+1.25*sigma);
let centre=0.5*(boxLo+boxHi);let extent=max(0.5*(boxHi-boxLo),vec3<f32>(1e-5));
let offset=history-centre;let unit=abs(offset/extent);let m=max(unit.x,max(unit.y,unit.z));
if(m>1.0){history=centre+offset/m;}}
let blended=mix(history,currentY,alpha);
return vec4<f32>(max(taaExpand(taaFromYCoCg(blended)),vec3<f32>(0.0)),current.a);}`;
}

/**
 * The output pass's fragment shader: an optional sharpen, clamped to the cross neighbourhood so it
 * cannot ring, from the resolved colour into the HDR scene target.
 *
 * @returns The WGSL.
 *
 * @internal
 */
export function taaOutputFragmentWgsl(): string {
  return `struct TaaOutputUniforms{params:vec4<f32>};
@group(0)@binding(0)var<uniform>taaOutput:TaaOutputUniforms;
@group(0)@binding(1)var resolvedColor:texture_2d<f32>;
@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{
let pixel=vec2<i32>(fragment.position.xy);
let c=textureLoad(resolvedColor,pixel,0);
let k=taaOutput.params.x;
if(k<=0.0){return c;}
let last=vec2<i32>(textureDimensions(resolvedColor))-vec2<i32>(1);
let n=textureLoad(resolvedColor,clamp(pixel+vec2<i32>(0,-1),vec2<i32>(0),last),0).rgb;
let s=textureLoad(resolvedColor,clamp(pixel+vec2<i32>(0,1),vec2<i32>(0),last),0).rgb;
let e=textureLoad(resolvedColor,clamp(pixel+vec2<i32>(1,0),vec2<i32>(0),last),0).rgb;
let w=textureLoad(resolvedColor,clamp(pixel+vec2<i32>(-1,0),vec2<i32>(0),last),0).rgb;
let lo=min(c.rgb,min(min(n,s),min(e,w)));let hi=max(c.rgb,max(max(n,s),max(e,w)));
let sharp=c.rgb+(c.rgb-0.25*(n+s+e+w))*k;
return vec4<f32>(clamp(sharp,lo,hi),c.a);}`;
}

/** The depth copy's fragment shader: scene depth into an `r32float` target the next frame reads. */
const DEPTH_COPY_WGSL = `@group(0)@binding(0)var sceneDepth:texture_depth_2d;
@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{
return vec4<f32>(textureLoad(sceneDepth,vec2<i32>(fragment.position.xy),0),0.0,0.0,1.0);}`;

/** The two private fields of Lite 1.34's render task the jitter writes through. */
interface SceneTaskUniforms {
  /** The scene uniform buffer; the view-projection is its first 64 bytes. */
  readonly buffer: GPUBuffer;
  /** The clean CPU copy the task last uploaded; view-projection at 0–15, view at 16–31, eye at 32–34. */
  readonly data: Float32Array;
}

/**
 * Builds the TAA passes and splices them in between the scene pass and the HDR output pass.
 *
 * @remarks
 * Call it after the HDR render path exists. The lease is the caller's; it is released when the
 * frame graph disposes the jitter task.
 *
 * @param engine - The engine.
 * @param scene - The scene with an HDR render path.
 * @param hdr - The HDR output handle.
 * @param inputs - A scene-inputs lease (depth, velocity).
 * @param options - The tuning.
 * @param isFrameGraphBuilt - Whether the tasks must be recorded now.
 * @returns The handle.
 *
 * @internal
 */
export function installTemporalAntiAliasing(
  engine: EngineContext,
  scene: SceneContext,
  hdr: HdrOutputHandle,
  inputs: SceneInputs,
  options: TaaOptions,
  isFrameGraphBuilt: boolean,
): TaaHandle {
  const resolved = surfaceTarget(engine, "ignifx:taa-resolved", "rgba16float");
  const history = surfaceTarget(engine, "ignifx:taa-history", "rgba16float");
  const previousDepth = surfaceTarget(engine, "ignifx:taa-previous-depth", "r32float");
  const targets = [resolved, history, previousDepth];

  const resolveEffect = createEffectWrapper(engine, {
    name: TAA_TASK_NAMES.resolve,
    fragmentWGSL: taaResolveFragmentWgsl(),
    bindings: [
      { name: "taa", binding: 0, kind: "uniform", uniformByteLength: RESOLVE_FLOATS * 4 },
      { name: "currentColor", binding: 1, kind: "texture" },
      { name: "historyColor", binding: 2, kind: "texture" },
      { name: "sceneDepth", binding: 3, kind: "texture", textureSampleType: "depth" },
      { name: "sceneVelocity", binding: 4, kind: "texture" },
      { name: "previousDepth", binding: 5, kind: "texture", textureSampleType: "unfilterable-float" },
    ],
  });
  const outputEffect = createEffectWrapper(engine, {
    name: TAA_TASK_NAMES.output,
    fragmentWGSL: taaOutputFragmentWgsl(),
    bindings: [
      { name: "taaOutput", binding: 0, kind: "uniform", uniformByteLength: 16 },
      { name: "resolvedColor", binding: 1, kind: "texture" },
    ],
  });
  const depthEffect = createEffectWrapper(engine, {
    name: TAA_TASK_NAMES.depth,
    fragmentWGSL: DEPTH_COPY_WGSL,
    bindings: [{ name: "sceneDepth", binding: 0, kind: "texture", textureSampleType: "depth" }],
  });
  const effects: readonly EffectWrapper[] = [resolveEffect, outputEffect, depthEffect];

  let resetPending = true;
  let resetCount = 0;
  const bind = (): void => {
    setEffectTexture(resolveEffect, 1, hdr.sceneTexture);
    setEffectTexture(resolveEffect, 2, history.texture);
    setEffectTexture(resolveEffect, 3, inputs.depth);
    setEffectTexture(resolveEffect, 4, inputs.velocity);
    setEffectTexture(resolveEffect, 5, previousDepth.texture);
    setEffectTexture(outputEffect, 1, resolved.texture);
    setEffectTexture(depthEffect, 0, inputs.depth);
  };
  bind();
  // A resize or a recovered device swaps the textures behind the facades: rebind, and drop history.
  const onResize = (): void => {
    bind();
    resetPending = true;
  };
  const stops = [inputs.onChange(onResize), ...targets.map((target) => onRenderTargetTextureResize(target, onResize))];
  setEffectUniforms(outputEffect, new Float32Array([Math.max(0, options.sharpness), 0, 0, 0]));

  const resolveTask = createEffectRenderTask(
    { name: TAA_TASK_NAMES.resolve, effect: resolveEffect, target: resolved.rt, clear: false },
    engine,
    scene,
  );
  const historyTask = createCopyToTextureTask(
    { name: TAA_TASK_NAMES.history, sourceTexture: resolved.rt, targetTexture: history.rt },
    engine,
    scene,
  );
  const outputTask = createEffectRenderTask(
    { name: TAA_TASK_NAMES.output, effect: outputEffect, target: hdr.sceneTarget, clear: false },
    engine,
    scene,
  );
  const depthTask = createEffectRenderTask(
    { name: TAA_TASK_NAMES.depth, effect: depthEffect, target: previousDepth.rt, clear: false },
    engine,
    scene,
  );

  const uniforms = new Float32Array(RESOLVE_FLOATS);
  const jittered = new Float32Array(16);
  const viewProjection = new Mat4();
  const inverse = new Mat4();
  const previousViewProjection = new Float32Array(16);
  const previousPose = new Float32Array(6);
  const pose = new Float32Array(6);
  const jitter: [number, number] = [0, 0];
  let haltonIndex = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  const blend = Math.min(1, Math.max(0.01, options.blend));

  const jitterTask: Task & { readonly _passes: unknown[] } = {
    name: TAA_TASK_NAMES.jitter,
    engine,
    scene,
    _passes: [],
    record(): void {
      // Nothing to record: the work is uploads, done in `execute`.
    },
    execute(): number {
      const width = hdr.sceneTexture.width;
      const height = hdr.sceneTexture.height;
      const uniformsOf = sceneTaskUniforms(hdr.sceneTask);
      if (width <= 0 || height <= 0 || uniformsOf === null) {
        return 0;
      }
      const clean = uniformsOf.data;
      for (let index = 0; index < 3; index += 1) {
        pose[index] = clean[32 + index] ?? 0;
        // The view matrix's third row is the camera's forward axis (left-handed, +Z forward).
        pose[3 + index] = clean[18 + 4 * index] ?? 0;
      }
      let reset = resetPending || width !== lastWidth || height !== lastHeight;
      if (!reset && isCameraCut(previousPose, pose, options.cutDistance)) {
        reset = true;
      }
      if (reset) {
        resetCount += 1;
        previousViewProjection.set(clean.subarray(0, 16));
      }
      resetPending = false;
      lastWidth = width;
      lastHeight = height;
      previousPose.set(pose);

      haltonIndex = (haltonIndex % HALTON_SAMPLES) + 1;
      jitter[0] = halton(haltonIndex, 2) - 0.5;
      jitter[1] = halton(haltonIndex, 3) - 0.5;
      const jx = (jitter[0] * 2) / width;
      const jy = (jitter[1] * 2) / height;
      for (let column = 0; column < 4; column += 1) {
        const base = column * 4;
        const w = clean[base + 3] ?? 0;
        jittered[base] = (clean[base] ?? 0) + jx * w;
        jittered[base + 1] = (clean[base + 1] ?? 0) + jy * w;
        jittered[base + 2] = clean[base + 2] ?? 0;
        jittered[base + 3] = w;
      }
      const device = deviceOf(engine);
      device?.queue.writeBuffer(uniformsOf.buffer, 0, jittered);

      const elements = viewProjection.elements;
      for (let index = 0; index < 16; index += 1) {
        elements[index] = clean[index] ?? 0;
      }
      if (!Mat4.invertToRef(elements, inverse)) {
        inverse.identity();
      }
      uniforms.set(inverse.elements, 0);
      uniforms.set(previousViewProjection, 16);
      uniforms[32] = blend;
      uniforms[33] = reset ? 1 : 0;
      uniforms[34] = options.clamp ? 1 : 0;
      uniforms[35] = DEPTH_TOLERANCE;
      uniforms[36] = width;
      uniforms[37] = height;
      setEffectUniforms(resolveEffect, uniforms);
      previousViewProjection.set(clean.subarray(0, 16));
      return 0;
    },
    dispose(): void {
      for (const stop of stops) {
        stop();
      }
      stops.length = 0;
      for (const effect of effects) {
        disposeEffectWrapper(effect);
      }
      for (const target of targets) {
        disposeRenderTargetTexture(target);
      }
      inputs.release();
    },
  };

  for (const task of [jitterTask, resolveTask, historyTask, outputTask, depthTask]) {
    hdr.insertLinearTask(task, isFrameGraphBuilt);
  }

  return {
    reset(): void {
      resetPending = true;
    },
    get resetCount(): number {
      return resetCount;
    },
    get jitter(): readonly [number, number] {
      return jitter;
    },
  };
}

/**
 * A surface-sized colour target with a sampled facade.
 *
 * @param engine - The engine, which is also the surface.
 * @param label - The GPU label.
 * @param format - The colour format.
 * @returns The target.
 */
function surfaceTarget(engine: EngineContext, label: string, format: GPUTextureFormat): RenderTargetTextureResult {
  return createSurfaceRenderTargetTexture(engine, { lbl: label, format, samples: 1, size: engine });
}

/**
 * The scene uniform buffer of Lite's render task and its clean CPU copy.
 *
 * @remarks
 * Neither is declared in `index.d.ts`; both are created with the task
 * (`lib/frame-graph/render-task-base.js`, `_sceneUBO` and `_suData`). If a later Lite renames them
 * the jitter stops and TAA degrades to temporal smoothing without sub-pixel samples.
 *
 * @param task - The `"scene"` render task.
 * @returns The two fields, or `null` when Lite no longer has them.
 */
function sceneTaskUniforms(task: Task): SceneTaskUniforms | null {
  const buffer: unknown = Reflect.get(task, "_sceneUBO");
  const data: unknown = Reflect.get(task, "_suData");
  if (!(data instanceof Float32Array) || data.length < 35 || !isGpuBuffer(buffer)) {
    return null;
  }
  return { buffer, data };
}

/**
 * Whether a value is a `GPUBuffer`.
 *
 * @param value - The value read from the task.
 * @returns `true` for a buffer.
 */
function isGpuBuffer(value: unknown): value is GPUBuffer {
  return typeof GPUBuffer !== "undefined" && value instanceof GPUBuffer;
}

/**
 * An engine's current device; replaced after a device-loss recovery, so read on every use.
 *
 * @param engine - The engine.
 * @returns The device, or `null`.
 */
function deviceOf(engine: EngineContext): GPUDevice | null {
  const device: unknown = Reflect.get(engine, "_device");
  return typeof GPUDevice !== "undefined" && device instanceof GPUDevice ? device : null;
}
