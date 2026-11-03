import type { ToneMapping } from "@babylonjs/lite";

/**
 * AgX as a Babylon Lite custom `ToneMapping` (`index.d.ts`, `interface ToneMapping`), for the
 * `"agx"` tone-mapping name (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G13).
 *
 * The formulation is Benjamin Wendt's "Minimal AgX implementation" (iolite engine, 2023,
 * https://iolite-engine.com/blog_posts/minimal_agx_implementation), a fit of Troy Sobotka's AgX
 * (https://github.com/sobotka/AgX) as Blender 4.0 ships it under "AgX Base": the inset matrix, a
 * log2 encode between -12.47393 and +4.026069 EV, a sixth-order polynomial for the default contrast
 * sigmoid, then the outset matrix. Only the base look is used; Wendt's "golden" and "punchy" looks
 * are not exposed. The sigmoid's output is display-encoded, so the call raises it to the power 2.2:
 * Lite's PBR template, and the HDR output pass after it, encode with `pow(1/2.2)` next.
 *
 * Its own chunk: `./environment.ts` imports it only when a scene asks for `"agx"`, and
 * `./hdr-output.ts`, itself a chunk, imports it for the HDR path. `image-processing-color.ts`
 * carries the same numbers on the CPU for the clear colour.
 */

/**
 * The curve's `id`, Lite's cache key and change check. Prefixed so a future Lite AgX is not taken
 * for this one. `./environment.ts` repeats the literal rather than importing it, which would put
 * this chunk on the entry path; a unit test keeps the two equal.
 *
 * @internal
 */
export const AGX_TONE_MAPPING_ID = "ignifx-agx";

/**
 * The module-scope WGSL: the matrices and the two functions. Names carry an `ignifx` prefix so
 * they cannot collide with Lite's own helpers in the PBR template.
 *
 * @internal
 */
export const AGX_HELPERS_WGSL: string =
  "const ignifxAgxInset=mat3x3<f32>(" +
  "vec3<f32>(0.842479062253094,0.0423282422610123,0.0423756549057051)," +
  "vec3<f32>(0.0784335999999992,0.878468636469772,0.0784336)," +
  "vec3<f32>(0.0792237451477643,0.0791661274605434,0.879142973793104));" +
  "const ignifxAgxOutset=mat3x3<f32>(" +
  "vec3<f32>(1.19687900512017,-0.0528968517574562,-0.0529716355144438)," +
  "vec3<f32>(-0.0980208811401368,1.15190312990417,-0.0980434501171241)," +
  "vec3<f32>(-0.0990297440797205,-0.0989611768448433,1.15107367264116));" +
  "const ignifxAgxMinEv:f32=-12.47393;" +
  "const ignifxAgxMaxEv:f32=4.026069;" +
  "fn ignifxAgxContrast(x:vec3<f32>)->vec3<f32>{let x2=x*x;let x4=x2*x2;" +
  "return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;}" +
  "fn ignifxAgx(c:vec3<f32>)->vec3<f32>{" +
  "var v=max(ignifxAgxInset*c,vec3<f32>(1e-10));" +
  "v=clamp(log2(v),vec3<f32>(ignifxAgxMinEv),vec3<f32>(ignifxAgxMaxEv));" +
  "v=(v-ignifxAgxMinEv)/(ignifxAgxMaxEv-ignifxAgxMinEv);" +
  "v=ignifxAgxOutset*ignifxAgxContrast(v);" +
  "return pow(max(v,vec3<f32>(0.0)),vec3<f32>(2.2));}";

/**
 * The per-fragment WGSL: the exposure first, as Lite's contract for `callWGSL` requires, then the
 * curve on the working `color`.
 *
 * @internal
 */
export const AGX_CALL_WGSL: string = "color*=scene.vImageInfos.x;color=ignifxAgx(color);";

/**
 * The AgX curve object Lite bakes into PBR shaders.
 *
 * @internal
 */
export const AgxToneMapping: ToneMapping = {
  id: AGX_TONE_MAPPING_ID,
  helpersWGSL: AGX_HELPERS_WGSL,
  callWGSL: AGX_CALL_WGSL,
};
