/**
 * Add a custom post process
 *
 * A `// @ignifx post` file is one full-screen fragment function. It samples the frame the scene drew
 * from `inputTexture`, and `PostProcessStack.custom` records it into the same chain the built-in
 * bloom and SMAA passes live in, ordered by `order` against them.
 *
 * ```wgsl
 * // shaders/vignette.post.wgsl
 * // @ignifx post
 * // @ignifx uniform strength: f32 = 0.6 range(0, 1)
 * // @ignifx uniform edgeColor: vec3<f32> = color(0.02, 0.02, 0.05)
 *
 * fn mainFragment(in: PostInput) -> vec4<f32> {
 *   let source = textureSample(inputTexture, inputTextureSampler, in.uv);
 *   let fromCentre = distance(in.uv, vec2<f32>(0.5, 0.5)) * 1.4142136;
 *   let flicker = 1.0 + 0.02 * sin(shaderUniforms.time * 4.0);
 *   let mask = 1.0 - smoothstep(0.45, 1.0, fromCentre * flicker) * shaderUniforms.strength;
 *   return vec4<f32>(mix(shaderUniforms.edgeColor, source.rgb, mask), source.a);
 * }
 * ```
 *
 * A post effect declares no attributes and no system uniforms: `screenSize`, `time`, `unscaledTime`
 * and `deltaTime` are already in its `shaderUniforms`, and `inputTexture`/`inputTextureSampler` are
 * bound by the engine. Everything else it uses it declares, exactly as a full shader material does.
 *
 * The `postProcessing` rendering feature is what makes the scene render into an offscreen target a
 * pass can sample; without it the stack logs `IGX-0710` and does nothing. Writing a `values` entry
 * re-uploads on the next frame, while changing which effects exist, or their `order`, rebuilds the
 * chain — so an on/off switch is `effect.enabled`, not a new array every frame. `imageProcessing`
 * always runs last, whatever order you give it.
 */
import { Camera, Light, MeshAsset, MeshRenderer, PostProcessStack, createApp, customEffect } from "@ignifx/core";
import type { ShaderAsset } from "@ignifx/core";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}

const app = await createApp({
  canvas,
  settings: {
    assets: { root: "assets" },
    rendering: { features: { postProcessing: true, shadows: true } },
  },
});

const vignetteShader = await app.assets.loadAsync<ShaderAsset>("shaders/vignette.post.wgsl");
const grainShader = await app.assets.loadAsync<ShaderAsset>("shaders/grain.post.wgsl");

// One settings object per effect. Keep the reference: it is what a slider writes to.
const vignette = customEffect({ shader: vignetteShader, values: { strength: 0.65 }, order: 10 });
const grain = customEffect({ shader: grainShader, values: { amount: 0.08 }, order: 20 });

const eye = app.world.createEntity("Main Camera");
eye.transform.localPosition.set(0, 1.5, -4);
eye.transform.lookAt({ x: 0, y: 0.5, z: 0 });
eye.addComponent(Camera, { fov: 55 });
// The stack lives on the camera's entity, one per world, like the built-in effects.
const stack = eye.addComponent(PostProcessStack, { custom: [vignette, grain] });
stack.bloom.enabled = true;

const sun = app.world.createEntity("Sun");
sun.transform.localPosition.set(2, 5, -3);
sun.transform.lookAt({ x: 0, y: 0, z: 0 });
sun.addComponent(Light, { type: "directional", intensity: 3 });
app.world.createEntity("Ground").addComponent(MeshRenderer, {
  mesh: MeshAsset.ground(app, { width: 20, height: 20 }),
});

await app.start();
app.log.info("recorded passes:", stack.taskCount);

// Live: a value write is re-uploaded next frame, and `enabled` skips the pass without freeing it.
vignette.values["strength"] = 0.4;
grain.enabled = false;
