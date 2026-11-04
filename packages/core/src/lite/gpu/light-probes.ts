import { createRenderTexture2D, getPbrUnlit, isPbrMaterial, isPbrSkybox } from "@babylonjs/lite";
import { rebuildMaterialPipelines } from "../material.js";
import { deviceOf } from "./render-texture.js";
import type { EngineContext, MaterialPlugin, SceneContext, Texture2D } from "@babylonjs/lite";

/**
 * Light probes on the GPU (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B2). Its own chunk,
 * loaded only once a world has a `LightProbeVolume` (`CONSTITUTION.md` §2.5). Every Lite claim was
 * read from `@babylonjs/lite@1.34.0`.
 *
 * - **Texture.** The grid's coefficients, packed by `packLightProbeTexels`, in an `rgba16float`
 *   texture read with `textureLoad` (plugins bind `texture_2d<f32>` only, `index.d.ts` 10607, so no
 *   3D texture).
 * - **Plugin.** Lite declares `environmentIrradiance` with `let` inside the IBL code
 *   (`lib/material/pbr/fragments/ibl-fragment.js`), so a plugin cannot replace it. Instead the plugin
 *   adds `(probes − environment) · surfaceAlbedo · occlusion` to `color`, recomputing the
 *   environment's harmonics from the scene uniforms the IBL code reads. Its point,
 *   `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION`, is injected twice (`AI` before the IBL code, `NI`
 *   after it; `lib/material/plugin/plugin-bridge-shared.js` line 13), so a private counter applies it
 *   on the second pass only. Its priority runs it before the HDR linear-output plugin saves `color`.
 * - **Grid constants** are written into the WGSL, so a different grid is a different plugin and a
 *   material rebuild: grids change rarely.
 */

/**
 * The name the plugin carries; part of Lite's pipeline cache key.
 *
 * @internal
 */
export const LIGHT_PROBE_PLUGIN_NAME = "ignifx-light-probes";

/**
 * The grid shape the shader needs.
 *
 * @internal
 */
export interface LightProbeGridShape {
  /** Probe `(0, 0, 0)`'s world position. */
  readonly origin: readonly [number, number, number];
  /** The cell size per axis. */
  readonly cellSize: readonly [number, number, number];
  /** Probe counts per axis. */
  readonly counts: readonly [number, number, number];
  /** The multiplier on the probes' light. */
  readonly intensity: number;
}

/**
 * A WGSL float literal.
 *
 * @param value - A finite number.
 * @returns The literal.
 */
function f(value: number): string {
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

/**
 * The plugin's WGSL.
 *
 * @param shape - The grid.
 * @returns The definitions and the composition code.
 *
 * @internal
 */
export function lightProbePluginWgsl(shape: LightProbeGridShape): { definitions: string; composition: string } {
  const [nx, ny, nz] = shape.counts;
  const origin = `vec3<f32>(${shape.origin.map(f).join(",")})`;
  const inverse = `vec3<f32>(${shape.cellSize.map((size) => f(1 / size)).join(",")})`;
  const maxCell = `vec3<f32>(${f(nx - 1)},${f(ny - 1)},${f(nz - 1)})`;
  const definitions =
    "var<private> igxLpPass:i32;" +
    "fn igxLpTexel(c:vec3<i32>,k:i32)->vec3<f32>{" +
    `return textureLoad(ignifxLp,vec2<i32>(c.x+${String(nx)}*k,c.y+${String(ny)}*c.z),0).rgb;}` +
    "fn igxLpAt(c:vec3<i32>,n:vec3<f32>)->vec3<f32>{" +
    "return igxLpTexel(c,0)+igxLpTexel(c,1)*n.y+igxLpTexel(c,2)*n.z+igxLpTexel(c,3)*n.x;}" +
    "fn igxLpSample(p:vec3<f32>,n:vec3<f32>)->vec3<f32>{" +
    `let m=${maxCell};let g=clamp((p-${origin})*${inverse},vec3<f32>(0.0),m);` +
    "let lo=min(floor(g),max(m-1.0,vec3<f32>(0.0)));let t=g-lo;let hi=min(lo+1.0,m);" +
    "var r=vec3<f32>(0.0);" +
    "for(var i=0;i<8;i++){let s=vec3<i32>(i&1,(i>>1u)&1,(i>>2u)&1)==vec3<i32>(1);" +
    "let w=select(1.0-t,t,s);r+=igxLpAt(vec3<i32>(select(lo,hi,s)),n)*(w.x*w.y*w.z);}" +
    "return r;}";
  const composition =
    "igxLpPass=igxLpPass+1;" +
    "if(igxLpPass==2){" +
    "let igxC=cos(scene.envRotationY);let igxS=sin(scene.envRotationY);" +
    "let igxN=vec3<f32>(N.x*igxC+N.z*igxS,N.y,-N.x*igxS+N.z*igxC);" +
    "let igxEnv=(scene.vSphericalL00.rgb+scene.vSphericalL1_1.rgb*igxN.y+scene.vSphericalL10.rgb*igxN.z" +
    "+scene.vSphericalL11.rgb*igxN.x+scene.vSphericalL2_2.rgb*(igxN.y*igxN.x)+scene.vSphericalL2_1.rgb*(igxN.y*igxN.z)" +
    "+scene.vSphericalL20.rgb*(3.0*igxN.z*igxN.z-1.0)+scene.vSphericalL21.rgb*(igxN.z*igxN.x)" +
    "+scene.vSphericalL22.rgb*(igxN.x*igxN.x-igxN.y*igxN.y))*material.environmentIntensity;" +
    `color+=(igxLpSample(input.worldPos,N)*${f(shape.intensity)}-igxEnv)*surfaceAlbedo*occlusion;}`;
  return { definitions, composition };
}

/**
 * Uploads packed probe texels into a texture.
 *
 * @param engine - The engine.
 * @param width - The texel width.
 * @param height - The texel height.
 * @param texels - Four half floats per texel.
 * @returns The texture, or `null` when the engine has no device.
 *
 * @internal
 */
export function createLightProbeTexture(
  engine: EngineContext,
  width: number,
  height: number,
  texels: Uint16Array,
): Texture2D | null {
  const device = deviceOf(engine);
  if (device === null) {
    return null;
  }
  const texture = createRenderTexture2D(engine, width, height, {
    format: "rgba16float",
    minFilter: "nearest",
    magFilter: "nearest",
  });
  device.queue.writeTexture({ texture: texture.texture }, texels, { bytesPerRow: width * 8 }, { width, height });
  return texture;
}

/**
 * Builds the plugin for one grid and its texture.
 *
 * @param shape - The grid.
 * @param texture - The packed texture.
 * @returns The plugin, shared by every lit PBR material.
 *
 * @internal
 */
export function createLightProbePlugin(shape: LightProbeGridShape, texture: Texture2D): MaterialPlugin {
  const wgsl = lightProbePluginWgsl(shape);
  const fragment = {
    CUSTOM_FRAGMENT_DEFINITIONS: wgsl.definitions,
    CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: wgsl.composition,
  };
  return {
    name: LIGHT_PROBE_PLUGIN_NAME,
    // Before the HDR linear-output plugin (priority 0) saves `color` at the same point.
    priority: -100,
    getSamplers: () => [{ texture: "ignifxLp", sampler: "ignifxLpSampler" }],
    bindTextures: (out) => {
      out.push({ texture });
    },
    getCustomCode: (stage) => (stage === "fragment" ? fragment : null),
  };
}

/**
 * Gives every lit PBR material `next` in place of `previous`, rebuilding the ones that changed.
 *
 * @param scene - The registered scene.
 * @param previous - The plugin to take off, or `null`.
 * @param next - The plugin to put on, or `null` to only take `previous` off.
 *
 * @internal
 */
export function swapLightProbePlugin(
  scene: SceneContext,
  previous: MaterialPlugin | null,
  next: MaterialPlugin | null,
): void {
  const meshes = scene.meshes;
  for (let index = 0; index < meshes.length; index += 1) {
    const material = meshes[index]?.material;
    // Declared non-null, but Lite's mesh factories create meshes with `material: null`.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (material === undefined || material === null || !isPbrMaterial(material)) {
      continue;
    }
    const current = material.plugins ?? [];
    const lit = getPbrUnlit(material) === undefined && !isPbrSkybox(material);
    const hasPrevious = previous !== null && current.includes(previous);
    const wantsNext = next !== null && lit;
    if (!hasPrevious && (!wantsNext || current.includes(next))) {
      continue;
    }
    const kept = hasPrevious ? current.filter((plugin) => plugin !== previous) : current;
    material.plugins = wantsNext && !kept.includes(next) ? [...kept, next] : kept;
    rebuildMaterialPipelines(scene, material);
  }
}
