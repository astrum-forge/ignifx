import {
  createCopyToTextureTask,
  createEffectRenderTask,
  createEffectWrapper,
  createScreenSpaceGlobalIlluminationPostProcessTask,
  createSurfaceRenderTargetTexture,
  disposeEffectWrapper,
  disposeRenderTargetTexture,
  getEffectiveAspectRatio,
  getPbrUnlit,
  getViewProjectionMatrix,
  isPbrMaterial,
  onRenderTargetTextureResize,
  setEffectTexture,
  setEffectUniforms,
} from "@babylonjs/lite";
import { Mat4 } from "../../math/mat4.js";
import { rebuildMaterialPipelines } from "../material.js";
import type { SceneColorPass } from "./scene-color-passes.js";
import type { SceneInputs } from "./scene-inputs.js";
import type {
  Camera,
  EffectWrapper,
  EngineContext,
  MaterialPlugin,
  RenderTarget,
  RenderTargetTextureResult,
  SceneContext,
  ScreenSpaceGlobalIlluminationPostProcessTask,
  Task,
  Texture2D,
} from "@babylonjs/lite";

/**
 * Screen-space global illumination (`docs/architecture/07-rendering.md` §2.7). Its own chunk,
 * loaded only while a `PostProcessStack` enables `ssgi` (`CONSTITUTION.md` §2.5).
 *
 * ```text
 * colour ─→ trace (Lite) ─→ copy ─→ bounce ─ denoise × n ─→ bounce ─┐
 *    └──────────────── colour += bounce · albedo · intensity ←───────┘
 * ```
 *
 * - **Trace.** Lite's `createScreenSpaceGlobalIlluminationPostProcessTask` (`index.d.ts` 3681)
 *   with `composition: "none"`: it marches `rays` rays per pixel through the shared
 *   scene-input depth, averages the lit colour they reach over 64 frames, and leaves the result in
 *   its `illuminationTexture`. That is the light arriving at each pixel, not yet reflected.
 * - **Why not Lite's composite.** Its additive composite is `colour + bounce · intensity`, with no
 *   term for the surface the light lands on: a black surface is lit like a white one, and the frame
 *   washes out. The composite here multiplies by the surface's diffuse albedo, a scene input
 *   (`./scene-inputs.ts`), so a PBR surface reflects the bounce in its own colour and a metal
 *   reflects none. That input has two limits, both Lite's: a Standard material's `diffuse` colour
 *   is not in it, and an unlit PBR material has an albedo like a lit one.
 * - **Copy.** Lite exposes its result as a `RenderTarget`, which an effect cannot sample, so it is
 *   copied into a target that has a `Texture2D`, as the scene inputs copy their attachments.
 * - **Denoise.** A few rays per pixel leave grain the temporal average does not remove. Each pass is
 *   a 3×3 filter whose taps are `stride` texels apart, the stride doubling per pass (à-trous,
 *   Dammertz et al., "Edge-avoiding À-Trous wavelet transform for fast global illumination
 *   filtering", HPG 2010). A tap counts by how close it lies to the centre pixel's surface plane
 *   and how far its normal agrees, both read from the scene inputs, so the blur runs along a
 *   surface and stops at its edges.
 * - **Composite.** Additive through the blend unit, into the colour the trace read
 *   (`SceneColorPass.inPlace`). At half resolution it takes the four bounce texels around the
 *   pixel, weighted the same way, so a low-resolution texel does not bleed across an edge. The
 *   bounce targets are `floor(size / 2)` and Lite's result `round(size / 2)`, so on an odd canvas
 *   the copy resamples by one texel instead of copying texel for texel.
 *
 * **The environment plugin.** The environment's irradiance (`finalIrradiance`,
 * `lib/material/pbr/fragments/ibl-fragment.js` line 6) stands in for all indirect light, so a
 * project can turn it down while SSGI adds the near part: the plugin subtracts
 * `(1 - environmentDiffuse)` of `finalIrradiance` from the colour, specular left alone. At the
 * default of 1 no plugin is attached.
 *
 * **How the plugin compiles everywhere.** `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION` is injected
 * at both the `AI` and the `NI` slot, which follow each other, and `finalIrradiance` exists only
 * when the material has an environment. The plugin declares a module-scope `finalIrradiance` of
 * zero, which the IBL code's own `let` shadows where it exists, and subtracts only what changed
 * since its last run, so the two injections together subtract once whichever side of the IBL code
 * they land on, and a material without an environment subtracts nothing. Priority -1 puts it ahead
 * of the HDR linear-output save (priority 0), which then keeps the adjusted colour.
 *
 * Plugins need Lite's bridges, which `rendering.hdr` and the `materialPlugins` feature install, so
 * without either the plugin is not attached and the environment is left as it is.
 */

/**
 * The tuning a recorded pass follows live.
 *
 * @internal
 */
export interface SsgiTuning {
  /** How strongly the bounce is added, 0 to 4; 1 is what the surface would reflect. */
  readonly intensity: number;
  /** How far each ray marches, in world units. */
  readonly radius: number;
  /** March steps per ray, 1 to 64. */
  readonly samples: number;
  /** Rays per pixel, 1 to 8. */
  readonly rays: number;
  /** How much of the environment's diffuse light remains, 0 to 1. */
  readonly environmentDiffuse: number;
}

/**
 * An SSGI pass: its tasks once created, its per-frame update, and what it owns.
 *
 * @internal
 */
export interface SsgiPass extends SceneColorPass {
  /**
   * Writes the tuning onto the tasks and, when plugins are available, keeps every lit PBR
   * material's environment plugin in step.
   *
   * @param tuning - The stack's `ssgi` record.
   * @param isSceneRegistered - Whether a patched material's pipelines must be rebuilt.
   */
  update(tuning: SsgiTuning, isSceneRegistered: boolean): void;
  /**
   * Takes the plugin off every material again and frees the effects and targets. The tasks
   * themselves are disposed by the installer, which must run first.
   *
   * @param isSceneRegistered - Whether a patched material's pipelines must be rebuilt.
   */
  dispose(isSceneRegistered: boolean): void;
}

/**
 * The frame-graph task names, in the order they run; `denoise` is followed by the pass index.
 *
 * @internal
 */
export const SSGI_TASK_NAMES = {
  trace: "ignifx:ssgi",
  copy: "ignifx:ssgi-copy",
  uniforms: "ignifx:ssgi-uniforms",
  denoise: "ignifx:ssgi-denoise-",
  composite: "ignifx:ssgi-composite",
} as const;

/**
 * The most denoise passes a pass builds; the last one's taps are 8 texels apart.
 *
 * @internal
 */
export const SSGI_MAX_DENOISE_PASSES = 4;

/**
 * The environment plugin's name.
 *
 * @internal
 */
export const SSGI_ENVIRONMENT_PLUGIN_NAME = "ignifx-ssgi-environment";

/** The format of the bounce targets: the one Lite's `illuminationTexture` has. */
const BOUNCE_FORMAT: GPUTextureFormat = "rgba16float";

/** Uniform floats per effect: an inverse view-projection, the eye, and one `vec4` of parameters. */
const UNIFORM_FLOATS = 24;

/**
 * The distance off the centre pixel's surface plane at which a tap's weight has fallen to `1 / e`,
 * as a fraction of the pixel's distance from the eye: 1.2 cm a metre away.
 */
const PLANE_TOLERANCE = 0.012;

/** The power the agreement of two normals is raised to; higher stops the blur at gentler creases. */
const NORMAL_POWER = 4;

/** The blend that adds a pass's colour to the target and leaves the target's alpha alone. */
const ADDITIVE_BLEND: GPUBlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one" },
  alpha: { operation: "add", srcFactor: "zero", dstFactor: "one" },
};

/**
 * What both shaders declare: the uniform block and the reads of the scene inputs.
 *
 * @remarks
 * `params` is `(stride or intensity, plane tolerance, normal power, display flag)`. `ssgiSceneTexel` maps
 * a bounce texel to the scene texel under its centre, the identity at full resolution.
 *
 * @returns The WGSL.
 */
function sharedWgsl(): string {
  return `struct SsgiFilter{invViewProj:mat4x4<f32>,eye:vec4<f32>,params:vec4<f32>};
@group(0)@binding(0)var<uniform>ssgi:SsgiFilter;
@group(0)@binding(1)var bounce:texture_2d<f32>;
@group(0)@binding(2)var sceneDepth:texture_depth_2d;
@group(0)@binding(3)var sceneNormals:texture_2d<f32>;
fn ssgiSceneTexel(texel:vec2<i32>,bounceSize:vec2<f32>,sceneSize:vec2<f32>)->vec2<i32>{
let uv=(vec2<f32>(texel)+vec2<f32>(0.5))/bounceSize;
return clamp(vec2<i32>(uv*sceneSize),vec2<i32>(0),vec2<i32>(sceneSize)-vec2<i32>(1));}
fn ssgiWorld(texel:vec2<i32>,depth:f32,sceneSize:vec2<f32>)->vec3<f32>{
let uv=(vec2<f32>(texel)+vec2<f32>(0.5))/sceneSize;
let clip=ssgi.invViewProj*vec4<f32>(uv.x*2.0-1.0,1.0-uv.y*2.0,depth,1.0);
return clip.xyz/clip.w;}
fn ssgiNormal(texel:vec2<i32>)->vec3<f32>{
let n=textureLoad(sceneNormals,texel,0).xyz*2.0-vec3<f32>(1.0);
return n*inverseSqrt(max(dot(n,n),1e-8));}
fn ssgiTolerance(position:vec3<f32>)->f32{return max(distance(position,ssgi.eye.xyz),1e-3)*ssgi.params.y;}
fn ssgiSurfaceWeight(position:vec3<f32>,normal:vec3<f32>,tolerance:f32,otherPosition:vec3<f32>,otherNormal:vec3<f32>)->f32{
let plane=abs(dot(normal,otherPosition-position));
return exp(-plane/tolerance)*pow(max(dot(normal,otherNormal),0.0),ssgi.params.z);}
fn ssgiBounce(texel:vec2<i32>)->vec3<f32>{
return min(max(textureLoad(bounce,texel,0).rgb,vec3<f32>(0.0)),vec3<f32>(65000.0));}`;
}

/**
 * The denoise pass's fragment shader: a 3×3 filter with taps `params.x` texels apart, each weighted
 * by the kernel `(1, 0.5)` per axis and by how well it shares the centre pixel's surface.
 *
 * @returns The WGSL, with Lite's `effectFragment` entry point.
 *
 * @internal
 */
export function ssgiDenoiseFragmentWgsl(): string {
  return `${sharedWgsl()}
@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{
let bounceSize=vec2<f32>(textureDimensions(bounce));
let sceneSize=vec2<f32>(textureDimensions(sceneDepth));
let texel=vec2<i32>(fragment.position.xy);
let sceneTexel=ssgiSceneTexel(texel,bounceSize,sceneSize);
let depth=textureLoad(sceneDepth,sceneTexel,0);
if(depth<=0.0){return vec4<f32>(0.0,0.0,0.0,1.0);}
let position=ssgiWorld(sceneTexel,depth,sceneSize);
let normal=ssgiNormal(sceneTexel);
let tolerance=ssgiTolerance(position);
let stride=max(i32(ssgi.params.x),1);
let last=vec2<i32>(bounceSize)-vec2<i32>(1);
var sum=ssgiBounce(texel);var total=1.0;
for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
if(x==0&&y==0){continue;}
let other=texel+vec2<i32>(x,y)*stride;
if(any(other<vec2<i32>(0))||any(other>last)){continue;}
let otherScene=ssgiSceneTexel(other,bounceSize,sceneSize);
let otherDepth=textureLoad(sceneDepth,otherScene,0);
if(otherDepth<=0.0){continue;}
let kernel=select(1.0,0.5,x!=0)*select(1.0,0.5,y!=0);
let weight=kernel*ssgiSurfaceWeight(position,normal,tolerance,ssgiWorld(otherScene,otherDepth,sceneSize),ssgiNormal(otherScene));
sum+=ssgiBounce(other)*weight;total+=weight;}}
return vec4<f32>(sum/total,1.0);}`;
}

/**
 * The composite's fragment shader: the bounce at the pixel, taken from the four bounce texels
 * around it by bilinear weight and shared surface, times the surface's albedo and `params.x`.
 * Meant for {@link ADDITIVE_BLEND}.
 *
 * @remarks
 * With `params.w` set the colour is display-encoded (no `rendering.hdr`), and so is the bounce
 * traced from it. Albedo is linear, and a display value times a linear one, added to a display
 * value, comes out several times too bright, so the bounce is first taken to roughly linear light
 * with a 2.2 power. The sum is still made in display values, which only `rendering.hdr` avoids.
 *
 * @returns The WGSL, with Lite's `effectFragment` entry point.
 *
 * @internal
 */
export function ssgiCompositeFragmentWgsl(): string {
  return `${sharedWgsl()}
@group(0)@binding(4)var sceneAlbedo:texture_2d<f32>;
@fragment fn effectFragment(fragment:EffectVertexOutput)->@location(0)vec4<f32>{
let bounceSize=vec2<f32>(textureDimensions(bounce));
let sceneSize=vec2<f32>(textureDimensions(sceneDepth));
let texel=vec2<i32>(fragment.position.xy);
let depth=textureLoad(sceneDepth,texel,0);
if(depth<=0.0){return vec4<f32>(0.0);}
let albedo=textureLoad(sceneAlbedo,texel,0).rgb;
let position=ssgiWorld(texel,depth,sceneSize);
let normal=ssgiNormal(texel);
let tolerance=ssgiTolerance(position);
let at=(vec2<f32>(texel)+vec2<f32>(0.5))/sceneSize*bounceSize-vec2<f32>(0.5);
let base=floor(at);let f=at-base;
let last=vec2<i32>(bounceSize)-vec2<i32>(1);
var sum=vec3<f32>(0.0);var total=0.0;
for(var j=0;j<2;j++){for(var i=0;i<2;i++){
let other=clamp(vec2<i32>(base)+vec2<i32>(i,j),vec2<i32>(0),last);
let otherScene=ssgiSceneTexel(other,bounceSize,sceneSize);
let otherDepth=textureLoad(sceneDepth,otherScene,0);
if(otherDepth<=0.0){continue;}
let bilinear=select(1.0-f.x,f.x,i==1)*select(1.0-f.y,f.y,j==1);
// The small constant keeps a pixel none of whose four texels share its surface from going black.
let weight=bilinear*(ssgiSurfaceWeight(position,normal,tolerance,ssgiWorld(otherScene,otherDepth,sceneSize),ssgiNormal(otherScene))+1e-4);
sum+=ssgiBounce(other)*weight;total+=weight;}}
if(total<=0.0){return vec4<f32>(0.0);}
var light=sum/total;
if(ssgi.params.w>0.5){light=pow(light,vec3<f32>(2.2));}
return vec4<f32>(albedo*light*ssgi.params.x,0.0);}`;
}

/**
 * Clamps a `denoisePasses` value to what a pass can build.
 *
 * @param passes - The record's value.
 * @returns A whole number from 0 to {@link SSGI_MAX_DENOISE_PASSES}; 0 for a value that is not a number.
 *
 * @internal
 */
export function clampSsgiDenoisePasses(passes: number): number {
  if (Number.isNaN(passes)) {
    return 0;
  }
  return Math.min(SSGI_MAX_DENOISE_PASSES, Math.max(0, Math.round(passes)));
}

/**
 * What one effect's uniform block is written from.
 *
 * @internal
 */
export interface SsgiFilterUniforms {
  /** The inverse of the camera's view-projection, 16 floats. */
  readonly inverseViewProjection: ArrayLike<number>;
  /** The camera's world matrix, whose translation is the eye. */
  readonly cameraWorld: ArrayLike<number>;
  /** `params.x`: the tap stride of a denoise pass, the intensity of the composite. */
  readonly first: number;
  /** `params.w`: whether the colour the pass works on is display-encoded. */
  readonly isDisplayEncoded: boolean;
}

/**
 * Writes one effect's uniform block.
 *
 * @param values - What to write.
 * @param out - {@link UNIFORM_FLOATS} floats, overwritten.
 * @returns `out`.
 *
 * @internal
 */
export function writeSsgiFilterUniforms(values: SsgiFilterUniforms, out: Float32Array): Float32Array {
  for (let index = 0; index < 16; index += 1) {
    out[index] = values.inverseViewProjection[index] ?? 0;
  }
  out[16] = values.cameraWorld[12] ?? 0;
  out[17] = values.cameraWorld[13] ?? 0;
  out[18] = values.cameraWorld[14] ?? 0;
  out[19] = 1;
  out[20] = values.first;
  out[21] = PLANE_TOLERANCE;
  out[22] = NORMAL_POWER;
  out[23] = values.isDisplayEncoded ? 1 : 0;
  return out;
}

/** What `create` built, kept for the per-frame update and the teardown. */
interface Built {
  readonly trace: ScreenSpaceGlobalIlluminationPostProcessTask;
  readonly effects: readonly EffectWrapper[];
  readonly targets: readonly RenderTargetTextureResult[];
  readonly stops: readonly (() => void)[];
}

/**
 * Creates an SSGI pass.
 *
 * @param engine - The engine.
 * @param scene - The scene, whose materials get the plugin.
 * @param inputs - A scene-inputs lease acquired with `albedo: true`; the caller releases it.
 * @param camera - The camera the inputs were drawn from.
 * @param options - The initial tuning and the creation-time choices.
 * @param options.tuning - The initial tuning.
 * @param options.halfResolution - Whether the rays are traced, and the bounce filtered, at half resolution.
 * @param options.denoisePasses - How many denoise passes run, 0 to {@link SSGI_MAX_DENOISE_PASSES}.
 * @param options.isLinear - Whether the scene colour is linear (`rendering.hdr`) and not display-encoded.
 * @param options.usePlugin - Whether Lite's plugin bridges are installed, so the plugin can be used.
 * @returns The pass.
 *
 * @internal
 */
export function createSsgiPass(
  engine: EngineContext,
  scene: SceneContext,
  inputs: SceneInputs,
  camera: Camera,
  options: {
    readonly tuning: SsgiTuning;
    readonly halfResolution: boolean;
    readonly denoisePasses: number;
    readonly isLinear: boolean;
    readonly usePlugin: boolean;
  },
): SsgiPass {
  let built: Built | null = null;
  let tuning = options.tuning;
  let plugin: MaterialPlugin | null = null;
  let pluginValue = Number.NaN;
  return {
    inPlace: true,
    create(colour: RenderTarget): readonly Task[] {
      const trace = createScreenSpaceGlobalIlluminationPostProcessTask(
        {
          name: SSGI_TASK_NAMES.trace,
          sourceTexture: colour,
          depthTexture: inputs.depthTarget,
          camera,
          resolutionScale: options.halfResolution ? 0.5 : 1,
          rayLength: tuning.radius,
          stepCount: tuning.samples,
          rayCount: tuning.rays,
          composition: "none",
        },
        engine,
        scene,
      );
      const passCount = clampSsgiDenoisePasses(options.denoisePasses);
      const createTarget = (label: string): RenderTargetTextureResult =>
        createSurfaceRenderTargetTexture(engine, {
          lbl: label,
          format: BOUNCE_FORMAT,
          samples: 1,
          size: options.halfResolution ? { surface: engine, scale: 0.5 } : engine,
        });
      const targets = [createTarget("ignifx:ssgi-bounce")];
      if (passCount > 0) {
        targets.push(createTarget("ignifx:ssgi-bounce-2"));
      }
      const targetAt = (index: number): RenderTargetTextureResult => {
        const target = targets[index % targets.length];
        if (target === undefined) {
          throw new RangeError(`SSGI has no bounce target ${String(index)}.`);
        }
        return target;
      };
      const tasks: Task[] = [
        trace,
        createCopyToTextureTask(
          { name: SSGI_TASK_NAMES.copy, sourceTexture: trace.illuminationTexture, targetTexture: targetAt(0).rt },
          engine,
          scene,
        ),
      ];

      // One effect per pass: each has its own uniform block. Pass `n` reads target `n` and writes
      // target `n + 1`, the two alternating.
      const denoiseWgsl = ssgiDenoiseFragmentWgsl();
      const effects: EffectWrapper[] = [];
      const sources: (() => Texture2D)[] = [];
      const denoiseTasks: Task[] = [];
      for (let pass = 0; pass < passCount; pass += 1) {
        const name = `${SSGI_TASK_NAMES.denoise}${String(pass)}`;
        const effect = createEffectWrapper(engine, {
          name,
          fragmentWGSL: denoiseWgsl,
          bindings: [
            { name: "ssgi", binding: 0, kind: "uniform", uniformByteLength: UNIFORM_FLOATS * 4 },
            { name: "bounce", binding: 1, kind: "texture" },
            { name: "sceneDepth", binding: 2, kind: "texture", textureSampleType: "depth" },
            { name: "sceneNormals", binding: 3, kind: "texture" },
          ],
        });
        effects.push(effect);
        sources.push(() => targetAt(pass).texture);
        denoiseTasks.push(createEffectTask(engine, scene, name, effect, targetAt(pass + 1).rt));
      }
      const composite = createEffectWrapper(engine, {
        name: SSGI_TASK_NAMES.composite,
        fragmentWGSL: ssgiCompositeFragmentWgsl(),
        bindings: [
          { name: "ssgi", binding: 0, kind: "uniform", uniformByteLength: UNIFORM_FLOATS * 4 },
          { name: "bounce", binding: 1, kind: "texture" },
          { name: "sceneDepth", binding: 2, kind: "texture", textureSampleType: "depth" },
          { name: "sceneNormals", binding: 3, kind: "texture" },
          { name: "sceneAlbedo", binding: 4, kind: "texture" },
        ],
        blend: ADDITIVE_BLEND,
      });
      effects.push(composite);
      sources.push(() => targetAt(passCount).texture);

      const bind = (): void => {
        const albedo = inputs.albedo;
        for (let index = 0; index < effects.length; index += 1) {
          const effect = effects[index];
          const source = sources[index];
          if (effect === undefined || source === undefined) {
            continue;
          }
          setEffectTexture(effect, 1, source());
          setEffectTexture(effect, 2, inputs.depth);
          setEffectTexture(effect, 3, inputs.normals);
        }
        if (albedo !== null) {
          setEffectTexture(composite, 4, albedo);
        }
      };
      bind();
      // A resize swaps the textures behind the facades; a wrapper's cached bind group keeps the old
      // view until a texture write marks it dirty.
      const stops = [inputs.onChange(bind), ...targets.map((target) => onRenderTargetTextureResize(target, bind))];

      const viewProjection = new Mat4();
      const inverse = new Mat4();
      const uniforms = new Float32Array(UNIFORM_FLOATS);
      const uniformsTask: Task & { readonly _passes: unknown[] } = {
        name: SSGI_TASK_NAMES.uniforms,
        engine,
        scene,
        _passes: [],
        record(): void {
          // Nothing to record: the work is uploads, done in `execute`.
        },
        execute(): number {
          const width = inputs.depth.width;
          const height = inputs.depth.height;
          if (width <= 0 || height <= 0) {
            return 0;
          }
          // The matrix Lite's trace uses this frame (`lib/post-process/screen-space-global-illumination.js`).
          const current = getViewProjectionMatrix(camera, getEffectiveAspectRatio(camera, width, height));
          const elements = viewProjection.elements;
          for (let index = 0; index < 16; index += 1) {
            elements[index] = current[index] ?? 0;
          }
          if (!Mat4.invertToRef(elements, inverse)) {
            inverse.identity();
          }
          for (let index = 0; index < effects.length; index += 1) {
            const effect = effects[index];
            if (effect === undefined) {
              continue;
            }
            const first = effect === composite ? Math.min(4, Math.max(0, tuning.intensity)) : 2 ** index;
            setEffectUniforms(
              effect,
              writeSsgiFilterUniforms(
                {
                  inverseViewProjection: inverse.elements,
                  cameraWorld: camera.worldMatrix,
                  first,
                  isDisplayEncoded: !options.isLinear,
                },
                uniforms,
              ),
            );
          }
          return 0;
        },
        dispose(): void {
          // The effects and targets are freed by the pass's own `dispose`.
        },
      };
      tasks.push(
        uniformsTask,
        ...denoiseTasks,
        createEffectTask(engine, scene, SSGI_TASK_NAMES.composite, composite, colour),
      );
      built = { trace, effects, targets, stops };
      return tasks;
    },
    update(next: SsgiTuning, isSceneRegistered: boolean): void {
      tuning = next;
      if (built === null) {
        return;
      }
      built.trace.rayLength = next.radius;
      built.trace.stepCount = next.samples;
      built.trace.rayCount = next.rays;
      if (!options.usePlugin) {
        return;
      }
      const value = Math.min(1, Math.max(0, next.environmentDiffuse));
      if (value >= 1) {
        // Nothing to subtract: leave the materials as they are.
        if (plugin !== null) {
          attachPlugin(scene, null, isSceneRegistered);
          plugin = null;
          pluginValue = Number.NaN;
        }
        return;
      }
      if (plugin === null || value !== pluginValue) {
        pluginValue = value;
        plugin = createSsgiEnvironmentPlugin(value);
      }
      attachPlugin(scene, plugin, isSceneRegistered);
    },
    dispose(isSceneRegistered: boolean): void {
      if (plugin !== null) {
        attachPlugin(scene, null, isSceneRegistered);
        plugin = null;
      }
      if (built === null) {
        return;
      }
      for (const stop of built.stops) {
        stop();
      }
      for (const effect of built.effects) {
        disposeEffectWrapper(effect);
      }
      for (const target of built.targets) {
        disposeRenderTargetTexture(target);
      }
      built = null;
    },
  };
}

/**
 * Creates a task that draws an effect over a target without clearing it, and that leaves the target
 * alone when disposed.
 *
 * @remarks
 * Lite's effect task frees its target on `dispose` (`lib/effect/effect-renderer.js`,
 * `disposeRenderTarget(task._rt)`). The composite's target is the scene colour, which the rest of
 * the frame graph keeps drawing into, and the bounce targets are freed by the pass.
 *
 * @param engine - The engine.
 * @param scene - The scene.
 * @param name - The task's name.
 * @param effect - The effect.
 * @param target - The target it draws into.
 * @returns The task.
 */
function createEffectTask(
  engine: EngineContext,
  scene: SceneContext,
  name: string,
  effect: EffectWrapper,
  target: RenderTarget,
): Task {
  const task: Task = createEffectRenderTask({ name, effect, target, clear: false }, engine, scene);
  task.dispose = (): void => {
    // The pipeline and bind group are the wrapper's; the target is not this task's to free.
  };
  return task;
}

/**
 * Builds the plugin that leaves `environmentDiffuse` of the environment's diffuse light.
 *
 * @param environmentDiffuse - What remains, 0 to 1. Baked into the WGSL, so a change compiles anew.
 * @returns The plugin.
 *
 * @internal
 */
export function createSsgiEnvironmentPlugin(environmentDiffuse: number): MaterialPlugin {
  const removed = (1 - environmentDiffuse).toFixed(4);
  const fragment = {
    CUSTOM_FRAGMENT_DEFINITIONS: "var<private> finalIrradiance: vec3<f32>;var<private> ignifxSsgiRemoved: vec3<f32>;",
    CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `color-=(finalIrradiance-ignifxSsgiRemoved)*${removed};ignifxSsgiRemoved=finalIrradiance;`,
  };
  return {
    name: SSGI_ENVIRONMENT_PLUGIN_NAME,
    priority: -1,
    getCustomCode: (stage) => (stage === "fragment" ? fragment : null),
  };
}

/**
 * Puts a plugin on every lit PBR material in the scene, replacing an older one of the same name,
 * or takes it off every material when `plugin` is `null`.
 *
 * @param scene - The scene.
 * @param plugin - The current plugin, or `null` to remove.
 * @param isSceneRegistered - Whether a changed material's pipelines must be rebuilt.
 */
function attachPlugin(scene: SceneContext, plugin: MaterialPlugin | null, isSceneRegistered: boolean): void {
  const meshes = scene.meshes;
  for (let index = 0; index < meshes.length; index += 1) {
    const material = meshes[index]?.material;
    // Declared non-null, but Lite's mesh factories create meshes with `material: null`.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (material === undefined || material === null || !isPbrMaterial(material)) {
      continue;
    }
    const current = material.plugins ?? [];
    const wanted = plugin !== null && getPbrUnlit(material) === undefined;
    if (wanted && current.includes(plugin)) {
      continue;
    }
    const kept = current.filter((other) => other.name !== SSGI_ENVIRONMENT_PLUGIN_NAME);
    if (!wanted && kept.length === current.length) {
      continue;
    }
    material.plugins = wanted ? [...kept, plugin] : kept;
    if (isSceneRegistered) {
      rebuildMaterialPipelines(scene, material);
    }
  }
}
