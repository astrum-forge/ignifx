import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { compilePostEffect, compiledPostEffect, writePostEffectValues } from "../../src/render/post-effect-compiler.js";
import {
  POST_EFFECT_BUILTIN_UNIFORMS,
  customEffect,
  declaredTextureBinding,
  postEffectValuesCodec,
} from "../../src/render/post-effect.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { ShaderAsset } from "../../src/render/shader-asset.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import { defaultTextureImportOptions, TextureAsset } from "../../src/render/texture-asset.js";
import {
  INVERT_POST_WGSL,
  NO_ENTRY_POST_WGSL,
  SCANLINE_POST_WGSL,
  SNOW_SURFACE_WGSL,
  TINT_POST_WGSL,
  createSurfaceHarness,
} from "../fixtures/shaders/surfaces.js";
import type { CompiledPostEffect } from "../../src/render/post-effect.js";
import type { SurfaceHarness } from "../fixtures/shaders/surfaces.js";

/**
 * Custom post effects on the null engine: the generated fragment module, the uniform layout, the
 * refusals, the `values` codec, and the shape of `PostProcessStack.custom`. Recording a task needs a
 * device and lives in `test/lite/render/post-effect.browser.test.ts`.
 */

let harness: SurfaceHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A shader asset built straight from a string, with no app.
 *
 * @param source - The `.post.wgsl` text.
 * @param address - Its address.
 * @returns The asset.
 */
function asset(source: string, address = "shaders/tint.post.wgsl"): ShaderAsset {
  return new ShaderAsset(address, source, parseShaderDeclaration(source, address));
}

/**
 * Compiles a source.
 *
 * @param source - The `.post.wgsl` text.
 * @returns The compiled effect.
 */
function compile(source: string): CompiledPostEffect {
  return compilePostEffect(asset(source));
}

/**
 * The `IGX-####` code a call fails with.
 *
 * @param run - The call.
 * @returns The code, or `"none"` when it did not throw.
 */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (failure: unknown) {
    return isIgnifxError(failure) ? failure.code : "not-an-ignifx-error";
  }
  return "none";
}

describe("the generated fragment module", () => {
  it("declares the entry point Lite's pipeline looks for", () => {
    expect(compile(TINT_POST_WGSL).fragmentWGSL).toContain("@fragment fn effectFragment(fragment:EffectVertexOutput)");
  });

  it("forwards to the author's mainFragment through the generated PostInput", () => {
    const wgsl = compile(TINT_POST_WGSL).fragmentWGSL;
    expect(wgsl).toContain("struct PostInput{uv:vec2<f32>,position:vec2<f32>,}");
    expect(wgsl).toContain("return mainFragment(ignifxPostInput);");
  });

  it("binds the chain's colour at 1 and its sampler at 2", () => {
    const wgsl = compile(TINT_POST_WGSL).fragmentWGSL;
    expect(wgsl).toContain("@group(0)@binding(1)var inputTexture:texture_2d<f32>;");
    expect(wgsl).toContain("@group(0)@binding(2)var inputTextureSampler:sampler;");
  });

  it("keeps the author's file verbatim, so its own helpers still compile", () => {
    expect(compile(TINT_POST_WGSL).fragmentWGSL).toContain(TINT_POST_WGSL);
  });

  it("declares each texture and its sampler after the chain input", () => {
    const source = `${INVERT_POST_WGSL}\n// @ignifx texture lut\n// @ignifx texture grain array\n`;
    const wgsl = compile(source).fragmentWGSL;
    expect(wgsl).toContain("@group(0)@binding(3)var lut:texture_2d<f32>;");
    expect(wgsl).toContain("@group(0)@binding(4)var lutSampler:sampler;");
    expect(wgsl).toContain("@group(0)@binding(5)var grain:texture_2d_array<f32>;");
  });

  it("numbers a declared texture's binding the way the adapter does", () => {
    expect([declaredTextureBinding(0), declaredTextureBinding(1)]).toStrictEqual([3, 5]);
  });
});

describe("the uniform layout", () => {
  it("always carries the four built-ins first, whatever the file declared", () => {
    const compiled = compile(INVERT_POST_WGSL);
    expect(compiled.uniforms.map((field) => field.name)).toStrictEqual(
      POST_EFFECT_BUILTIN_UNIFORMS.map((builtin) => builtin.name),
    );
  });

  it("lays the built-ins out at the offsets WGSL gives that struct", () => {
    const compiled = compile(INVERT_POST_WGSL);
    expect([
      compiled.byName.get("screenSize")?.byteOffset,
      compiled.byName.get("time")?.byteOffset,
      compiled.byName.get("unscaledTime")?.byteOffset,
      compiled.byName.get("deltaTime")?.byteOffset,
    ]).toStrictEqual([0, 8, 12, 16]);
  });

  it("aligns a vec3 to sixteen bytes, which is the trap the skill teaches", () => {
    const compiled = compile(TINT_POST_WGSL);
    expect(compiled.byName.get("tint")?.byteOffset).toBe(32);
    expect(compiled.byName.get("amount")?.byteOffset).toBe(44);
  });

  it("rounds the struct up to its own alignment", () => {
    expect(compile(TINT_POST_WGSL).uniformByteLength).toBe(48);
  });

  it("keeps the built-ins alone at thirty-two bytes when nothing is declared", () => {
    expect(compile(INVERT_POST_WGSL).uniformByteLength).toBe(32);
  });

  it("does not declare a built-in twice when the file names it under system", () => {
    const source = `// @ignifx post\n// @ignifx system screenSize, time\n${INVERT_POST_WGSL.slice("// @ignifx post\n".length)}`;
    expect(compile(source).uniforms).toHaveLength(4);
  });

  it("compiles a file that reads screenSize and time without declaring them", () => {
    expect(compile(SCANLINE_POST_WGSL).fragmentWGSL).toContain("shaderUniforms.screenSize");
  });
});

describe("refusing a file that is not a post effect", () => {
  it("refuses a surface file with IGX-0709", () => {
    expect(codeOf(() => compile(SNOW_SURFACE_WGSL))).toBe("IGX-0709");
  });

  it("refuses a post file with no mainFragment with IGX-0723", () => {
    expect(codeOf(() => compile(NO_ENTRY_POST_WGSL))).toBe("IGX-0723");
  });
});

describe("compiling once per asset", () => {
  it("returns the same compiled effect for the same asset", () => {
    const shader = asset(TINT_POST_WGSL);
    expect(compiledPostEffect(shader)).toBe(compiledPostEffect(shader));
  });

  it("recompiles for a replacement asset, which is what a hot reload produces", () => {
    expect(compiledPostEffect(asset(TINT_POST_WGSL))).not.toBe(compiledPostEffect(asset(TINT_POST_WGSL)));
  });
});

describe("writing the values", () => {
  it("starts every declared uniform at its file default", () => {
    const compiled = compile(TINT_POST_WGSL);
    const bytes = new Float32Array(compiled.uniformByteLength / 4);
    writePostEffectValues(compiled, asset(TINT_POST_WGSL), {}, bytes);
    expect(bytes[44 / 4]).toBeCloseTo(1, 6);
  });

  it("applies an override over the default", () => {
    const compiled = compile(TINT_POST_WGSL);
    const bytes = new Float32Array(compiled.uniformByteLength / 4);
    writePostEffectValues(compiled, asset(TINT_POST_WGSL), { amount: 0.25 }, bytes);
    expect(bytes[44 / 4]).toBeCloseTo(0.25, 6);
  });

  it("writes a vector override component by component", () => {
    const compiled = compile(TINT_POST_WGSL);
    const bytes = new Float32Array(compiled.uniformByteLength / 4);
    writePostEffectValues(compiled, asset(TINT_POST_WGSL), { tint: [0.1, 0.2, 0.3] }, bytes);
    expect([bytes[8], bytes[9], bytes[10]]).toStrictEqual([Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)]);
  });

  it("refuses an undeclared name with IGX-0712", () => {
    const compiled = compile(TINT_POST_WGSL);
    const bytes = new Float32Array(compiled.uniformByteLength / 4);
    expect(codeOf(() => writePostEffectValues(compiled, asset(TINT_POST_WGSL), { gamma: 2.2 }, bytes))).toBe(
      "IGX-0712",
    );
  });

  it("refuses an override of a built-in the engine writes with IGX-0712", () => {
    const compiled = compile(TINT_POST_WGSL);
    const bytes = new Float32Array(compiled.uniformByteLength / 4);
    expect(codeOf(() => writePostEffectValues(compiled, asset(TINT_POST_WGSL), { time: 3 }, bytes))).toBe("IGX-0712");
  });

  it("refuses a wrongly shaped value with IGX-0713", () => {
    const compiled = compile(TINT_POST_WGSL);
    const bytes = new Float32Array(compiled.uniformByteLength / 4);
    expect(codeOf(() => writePostEffectValues(compiled, asset(TINT_POST_WGSL), { amount: [1, 2] }, bytes))).toBe(
      "IGX-0713",
    );
  });
});

describe("the values codec", () => {
  it("round-trips a scalar and a vector", () => {
    const codec = postEffectValuesCodec();
    const value = { amount: 0.5, tint: [1, 0.5, 0.25] };
    expect(codec.deserialize(codec.serialize(value))).toStrictEqual(value);
  });

  it("writes keys in lexicographic order, so two saves are byte-identical", () => {
    const codec = postEffectValuesCodec();
    expect(JSON.stringify(codec.serialize({ zoom: 1, amount: 2 }))).toBe('{"amount":2,"zoom":1}');
  });

  it("starts empty", () => {
    expect(postEffectValuesCodec().createDefault()).toStrictEqual({});
  });

  it("reads a file that wrote something other than an object as empty", () => {
    expect(postEffectValuesCodec().deserialize(7)).toStrictEqual({});
  });

  it("drops an entry that is neither a number nor an array of numbers", () => {
    expect(postEffectValuesCodec().deserialize({ amount: "loud", tint: [1, 2] })).toStrictEqual({ tint: [1, 2] });
  });
});

describe("PostProcessStack.custom", () => {
  it("starts empty", async () => {
    harness = await createSurfaceHarness();
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    expect(stack.custom).toStrictEqual([]);
  });

  it("fills a custom effect's defaults", async () => {
    harness = await createSurfaceHarness();
    const shader = await harness.loadShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    expect(customEffect({ shader })).toStrictEqual({
      shader,
      enabled: true,
      order: 10,
      values: {},
      textures: {},
    });
  });

  it("plans a custom effect into the chain in its order's place", async () => {
    harness = await createSurfaceHarness();
    const shader = await harness.loadShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.imageProcessing.enabled = true;
    stack.custom.push(customEffect({ shader, order: 1 }));
    expect(stack.plannedChain()).toStrictEqual(["bloom", "custom", "imageProcessing"]);
  });

  it("plans nothing for an effect whose shader is null", async () => {
    harness = await createSurfaceHarness();
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.custom.push(customEffect({ shader: null }));
    expect(stack.plannedChain()).toStrictEqual([]);
  });

  it("plans nothing for a disabled effect", async () => {
    harness = await createSurfaceHarness();
    const shader = await harness.loadShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.custom.push(customEffect({ shader, enabled: false }));
    expect(stack.plannedChain()).toStrictEqual([]);
  });

  it("records nothing under a headless app, which has no frame graph", async () => {
    harness = await createSurfaceHarness();
    const shader = await harness.loadShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.custom.push(customEffect({ shader }));
    harness.frame();
    expect(stack.taskCount).toBe(0);
  });

  it("orders a custom effect among the built-ins by its order field", async () => {
    harness = await createSurfaceHarness();
    const shader = await harness.loadShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.bloom.enabled = true;
    stack.imageProcessing.enabled = true;
    stack.custom.push(customEffect({ shader, order: -5 }));
    expect(stack.plannedChain()[0]).toBe("custom");
  });

  it("ignores a custom effect with no shader at all", async () => {
    harness = await createSurfaceHarness();
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.custom.push(customEffect({ shader: null }));
    harness.frame();
    expect(stack.plannedChain()).toStrictEqual([]);
    expect(stack.taskCount).toBe(0);
  });

  it("keeps a bound texture address in the chain identity, so a swap rebuilds", async () => {
    harness = await createSurfaceHarness();
    const shader = await harness.loadShader("shaders/scanline.post.wgsl", SCANLINE_POST_WGSL);
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    const effect = customEffect({ shader, textures: { lut: null } });
    stack.custom.push(effect);
    harness.frame();
    harness.frame();
    expect(stack.taskCount).toBe(0);
    expect(stack.plannedChain()).toStrictEqual(["custom"]);
  });

  it("resolves a declared sampler, falling back to null under a headless app", async () => {
    harness = await createSurfaceHarness();
    const source = `// @ignifx post
// @ignifx texture lut

fn mainFragment(in: PostInput) -> vec4<f32> {
  return textureSample(lut, lutSampler, in.uv);
}
`;
    const shader = await harness.loadShader("shaders/lut.post.wgsl", source);
    const texture = harness.app.assets.register(new TextureAsset("memory:lut", null, defaultTextureImportOptions()), {
      type: "texture",
    });
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.custom.push(customEffect({ shader, textures: { lut: texture } }));
    harness.frame();
    expect(stack.plannedChain()).toStrictEqual(["custom"]);
    expect(stack.taskCount).toBe(0);
    texture.release();
  });

  it("reports a shader it cannot compile once, through the log", async () => {
    harness = await createSurfaceHarness();
    const shader = await harness.loadShader("shaders/broken.post.wgsl", NO_ENTRY_POST_WGSL);
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.custom.push(customEffect({ shader }));
    harness.frame();
    harness.frame();
    const reports = harness.log
      .toArray()
      .filter((record) => record.message.includes("IGX-0715") && record.message.includes("broken.post.wgsl"));
    expect(reports).toHaveLength(1);
  });
});

describe("the generated uniform struct across every declared type", () => {
  /** A post effect declaring one uniform of every type and an array sampler. */
  const EVERY_TYPE_POST_WGSL = `// @ignifx post
// @ignifx uniform amount: f32 = 0.5
// @ignifx uniform steps: u32 = 3
// @ignifx uniform bias: i32 = -1
// @ignifx uniform pair: vec2<f32> = (1, 2)
// @ignifx uniform tint: vec3<f32> = color(1, 1, 1)
// @ignifx uniform rgba: vec4<f32> = color(1, 1, 1, 1)
// @ignifx uniform transform: mat4x4<f32>
// @ignifx texture layers array

fn mainFragment(in: PostInput) -> vec4<f32> {
  return textureSample(inputTexture, inputTextureSampler, in.uv);
}
`;

  it("lays every type out at the alignment WGSL gives it", () => {
    const compiled = compile(EVERY_TYPE_POST_WGSL);
    expect(compiled.byName.get("amount")?.byteOffset).toBe(20);
    expect(compiled.byName.get("pair")?.byteOffset).toBe(32);
    expect(compiled.byName.get("tint")?.byteOffset).toBe(48);
    expect(compiled.byName.get("rgba")?.byteOffset).toBe(64);
    expect(compiled.byName.get("transform")?.byteOffset).toBe(80);
    expect(compiled.uniformByteLength).toBe(144);
  });

  it("declares an array sampler as a texture_2d_array", () => {
    expect(compile(EVERY_TYPE_POST_WGSL).fragmentWGSL).toContain("texture_2d_array<f32>");
    expect(declaredTextureBinding(0)).toBe(3);
    expect(declaredTextureBinding(1)).toBe(5);
  });

  it("writes every declared default and then the overrides", () => {
    const shader = asset(EVERY_TYPE_POST_WGSL, "shaders/every.post.wgsl");
    const compiled = compilePostEffect(shader);
    const out = new Float32Array(compiled.uniformByteLength / 4);
    writePostEffectValues(compiled, shader, { amount: 0.25, pair: [3, 4] }, out);
    expect(out[5]).toBeCloseTo(0.25);
    expect(out[8]).toBeCloseTo(3);
  });

  it("ignores an override with no value and refuses an undeclared one", () => {
    const shader = asset(EVERY_TYPE_POST_WGSL, "shaders/every.post.wgsl");
    const compiled = compilePostEffect(shader);
    const out = new Float32Array(compiled.uniformByteLength / 4);
    // A prototype key and a key whose value is `undefined`: neither is an override the writer owns.
    const inherited: Record<string, number | readonly number[]> = Object.create({ tint: 1 }) as Record<
      string,
      number | readonly number[]
    >;
    inherited["amount"] = 1;
    Object.defineProperty(inherited, "sparse", { enumerable: true, get: (): undefined => undefined });
    writePostEffectValues(compiled, shader, inherited, out);
    expect(codeOf(() => writePostEffectValues(compiled, shader, { nope: 1 }, out))).toBe("IGX-0712");
    expect(codeOf(() => writePostEffectValues(compiled, shader, { time: 1 }, out))).toBe("IGX-0712");
  });

  it("refuses a value whose shape does not match its declared type", () => {
    const shader = asset(EVERY_TYPE_POST_WGSL, "shaders/every.post.wgsl");
    const compiled = compilePostEffect(shader);
    const out = new Float32Array(compiled.uniformByteLength / 4);
    expect(codeOf(() => writePostEffectValues(compiled, shader, { pair: 1 }, out))).toBe("IGX-0713");
    expect(codeOf(() => writePostEffectValues(compiled, shader, { amount: [1, 2] }, out))).toBe("IGX-0713");
  });
});
