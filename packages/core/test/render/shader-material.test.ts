import { afterEach, describe, expect, it } from "vitest";
import { Color } from "../../src/math/color.js";
import { buildMaterialAsset, createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { shaderMaterialDefinition } from "../../src/render/shader-material-definition.js";
import { toShaderMaterialOptions } from "../../src/render/shader-material.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import { createStorageBufferAsset } from "../../src/render/storage-buffer-asset.js";
import { createShaderHarness } from "../fixtures/shaders/harness.js";
import { STORAGE_WGSL, TEXTURED_WGSL, TINT_WGSL } from "../fixtures/shaders/sources.js";
import type { MaterialAsset } from "../../src/render/material-asset.js";
import type { ShaderAsset } from "../../src/render/shader-asset.js";
import type { TextureAsset } from "../../src/render/texture-asset.js";
import type { ShaderHarness } from "../fixtures/shaders/harness.js";

/**
 * `"shader"` materials on the null engine: the declaration-to-`ShaderMaterialOptions` mapping, the
 * value and texture setters, the `setDefine` rebuild, and the `IGX-0718` refusals.
 *
 * `createShaderMaterial` validates eagerly and compiles lazily, so all of this runs in Node; only
 * drawing needs a device (`test/lite/render/shader-material.browser.test.ts`).
 */

let harness: ShaderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A harness with the shader layer registered.
 *
 * @returns The harness.
 */
async function app(): Promise<ShaderHarness> {
  harness = await createShaderHarness();
  return harness;
}

/**
 * Builds the options a source maps onto, without an app.
 *
 * @param source - The `.wgsl` text.
 * @returns The mapped options.
 */
function options(source: string): ReturnType<typeof toShaderMaterialOptions> {
  return toShaderMaterialOptions("m", source, parseShaderDeclaration(source, "s.wgsl"), new Map(), {});
}

/**
 * Loads the tint shader and builds a material on it.
 *
 * @param h - The harness.
 * @param values - Uniform overrides.
 * @returns The material.
 */
async function tintMaterial(
  h: ShaderHarness,
  values: Readonly<Record<string, number | readonly number[]>> = {},
): Promise<MaterialAsset> {
  const shader = await h.load<ShaderAsset>("shaders/tint.wgsl", { "shaders/tint.wgsl": TINT_WGSL });
  return createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address, values }), []).value;
}

describe("the declaration to ShaderMaterialOptions mapping", () => {
  it("hands the whole file to both stages, so structs are shared", () => {
    const mapped = options(TINT_WGSL);
    expect(mapped.source).toBe(TINT_WGSL);
  });

  it("lists Lite's system uniforms by name and everything else as a declaration", () => {
    const mapped = options(TINT_WGSL);
    expect(mapped.uniforms[0]).toBe("worldViewProjection");
    expect(mapped.uniforms[1]).toEqual({ name: "time", type: "f32", defaultValue: 0 });
    expect(mapped.uniforms[2]).toMatchObject({ name: "tint", type: "vec3<f32>" });
  });

  it("decodes a colour default to linear", () => {
    const tint = options(TINT_WGSL).uniforms[2];
    const value = typeof tint === "string" ? [] : tint?.defaultValue;
    expect(Array.isArray(value) ? value[0] : value).toBeCloseTo(Color.srgbToLinear(1));
    expect(Array.isArray(value) ? value[1] : value).toBeCloseTo(0);
  });

  it("leaves an opaque surface unblended and depth-writing", () => {
    const mapped = options(TINT_WGSL);
    expect(mapped.needAlphaBlending).toBe(false);
    expect(mapped.blend).toBeNull();
    expect(mapped.depthWrite).toBe(true);
    expect(mapped.depthCompare).toBeNull();
    expect(mapped.backFaceCulling).toBe(true);
  });

  it("maps each blend mode onto what Babylon Lite understands", () => {
    const alpha = options("// @ignifx shader\n// @ignifx blend alpha\n");
    expect({ needAlphaBlending: alpha.needAlphaBlending, blendMode: alpha.blendMode, blend: alpha.blend }).toEqual({
      needAlphaBlending: true,
      blendMode: "alpha",
      blend: null,
    });
    const additive = options("// @ignifx shader\n// @ignifx blend additive\n");
    expect(additive.blendMode).toBe("additive");
    expect(additive.blend).toBeNull();
    const premultiplied = options("// @ignifx shader\n// @ignifx blend premultiplied\n");
    expect(premultiplied.needAlphaBlending).toBe(true);
    expect(premultiplied.blend).toEqual({
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    });
  });

  it("turns depth writes off for a blended surface and back on when the file says so", () => {
    expect(options("// @ignifx shader\n// @ignifx blend alpha\n").depthWrite).toBe(false);
    expect(options("// @ignifx shader\n// @ignifx blend alpha depthWrite on\n").depthWrite).toBe(true);
  });

  it("compiles depthTest off as an always comparison", () => {
    expect(options("// @ignifx shader\n// @ignifx depthTest off\n").depthCompare).toBe("always");
  });

  it("maps cull none onto backFaceCulling false", () => {
    expect(options("// @ignifx shader\n// @ignifx cull none\n").backFaceCulling).toBe(false);
  });

  it("asks for the thin-instance colour stream only for matrices-colors", () => {
    expect(options("// @ignifx shader\n// @ignifx instancing matrices\n").useThinInstanceColors).toBe(false);
    expect(options("// @ignifx shader\n// @ignifx instancing matrices-colors\n").useThinInstanceColors).toBe(true);
  });

  it("passes transmissive through with its blending", () => {
    const mapped = options("// @ignifx shader\n// @ignifx blend alpha transmissive\n");
    expect(mapped.transmissive).toBe(true);
    expect(mapped.needAlphaBlending).toBe(true);
  });

  it("maps an array texture onto a 2d-array view dimension", () => {
    const mapped = options("// @ignifx shader\n// @ignifx texture layers array\n");
    expect(mapped.samplers).toEqual([{ name: "layers", viewDimension: "2d-array" }]);
    expect(options(TEXTURED_WGSL).samplers).toEqual([{ name: "albedo", viewDimension: "2d" }]);
  });

  it("keeps a storage buffer's WGSL type verbatim", () => {
    expect(options(STORAGE_WGSL).storageBuffers).toEqual([{ name: "offsets", type: "array<vec4<f32>>" }]);
  });

  it("resolves the file's defines", () => {
    expect(options(TEXTURED_WGSL).defines).toEqual({});
  });
});

describe("building a shader material", () => {
  it("reports its kind, its shader, and a Lite material", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(material.kind).toBe("shader");
    expect(material.shader?.address).toBe("shaders/tint.wgsl");
    expect(material.lite.material).not.toBeNull();
    expect(material.isDrawable).toBe(true);
  });

  it("applies the definition's values over the file's defaults", async () => {
    const h = await app();
    const material = await tintMaterial(h, { pulse: 0.75 });
    expect(material.getUniform("pulse")).toBeCloseTo(0.75);
  });

  it("refuses a value the shader does not declare", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/tint.wgsl", { "shaders/tint.wgsl": TINT_WGSL });
    expect(() =>
      createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address, values: { wobble: 1 } }), []),
    ).toThrow(/IGX-0712/);
  });

  it("does nothing when the value is the one the file already declares", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/textured.wgsl", { "shaders/textured.wgsl": TEXTURED_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    const before = material.lite.material;
    material.setDefine("TINTED", false);
    expect(material.lite.material).toBe(before);
  });

  it("refuses a define the shader does not declare", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/tint.wgsl", { "shaders/tint.wgsl": TINT_WGSL });
    expect(() =>
      createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address, defines: { WOBBLE: true } }), []),
    ).toThrow(/IGX-0712/);
  });

  it("refuses a shader that is not loaded", async () => {
    const h = await app();
    expect(() => createMaterialAsset(h.app, shaderMaterialDefinition({ shader: "shaders/missing.wgsl" }), [])).toThrow(
      /IGX-0501/,
    );
  });

  it("records the address of a handle it is given", async () => {
    const h = await app();
    const shader = h.app.assets.load<ShaderAsset>("shaders/tint.wgsl");
    expect(shaderMaterialDefinition({ shader }).shader).toBe("shaders/tint.wgsl");
    h.app.assets.release(shader);
  });

  it("defaults its name to the shader's address", () => {
    expect(shaderMaterialDefinition({ shader: "shaders/tint.wgsl" }).name).toBe("shaders/tint.wgsl");
  });

  it("is not drawable while a declared storage buffer is unbound", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/storage.wgsl", { "shaders/storage.wgsl": STORAGE_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    expect(material.isDrawable).toBe(false);
    using buffer = createStorageBufferAsset(h.app, "offsets", new Float32Array(4));
    material.setStorageBuffer("offsets", buffer);
    expect(material.isDrawable).toBe(true);
  });
});

describe("setUniform", () => {
  it("writes a scalar", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    material.setUniform("pulse", 0.25);
    expect(material.getUniform("pulse")).toBeCloseTo(0.25);
  });

  it("takes an sRGB colour for a colour uniform and stores it linear", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    material.setUniform("tint", { r: 0.5, g: 0.5, b: 0.5, a: 1 });
    const read = material.getUniform("tint", new Float32Array(3));
    expect(read instanceof Float32Array ? read[0] : 0).toBeCloseTo(Color.srgbToLinear(0.5));
  });

  it("treats a numeric array for a colour uniform as sRGB too", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    material.setUniform("tint", [0.5, 0.5, 0.5]);
    const read = material.getUniform("tint", new Float32Array(3));
    expect(read instanceof Float32Array ? read[0] : 0).toBeCloseTo(Color.srgbToLinear(0.5));
  });

  it("refuses a uniform the shader does not declare", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setUniform("wobble", 1);
    }).toThrow(/IGX-0712/);
  });

  it("refuses a uniform the engine writes", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setUniform("time", 1);
    }).toThrow(/written by the engine/);
  });

  it("refuses a number for a vector uniform", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setUniform("tint", 1);
    }).toThrow(/IGX-0713/);
  });

  it("refuses an array of the wrong length", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setUniform("tint", [1, 0]);
    }).toThrow(/IGX-0713/);
  });

  it("refuses a colour for a scalar uniform", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setUniform("pulse", { r: 1, g: 1, b: 1, a: 1 });
    }).toThrow(/IGX-0713/);
  });

  it("accepts a Float32Array", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    material.setUniform("tint", Float32Array.from([1, 1, 1]));
    const read = material.getUniform("tint", new Float32Array(3));
    expect(read instanceof Float32Array ? read[2] : 0).toBeCloseTo(1);
  });
});

describe("getUniform", () => {
  it("allocates a fresh array when given no out parameter", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    const read = material.getUniform("tint");
    expect(read).toBeInstanceOf(Float32Array);
  });

  it("fills a scalar into an out parameter when one is given", async () => {
    const h = await app();
    const material = await tintMaterial(h, { pulse: 0.5 });
    const out = new Float32Array(1);
    material.getUniform("pulse", out);
    expect(out[0]).toBeCloseTo(0.5);
  });

  it("refuses an out parameter that is too short", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => material.getUniform("tint", new Float32Array(2))).toThrow(/IGX-0713/);
  });
});

describe("setTexture", () => {
  it("refuses a sampler the shader does not declare", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setTexture("albedo", null);
    }).toThrow(/IGX-0712/);
  });

  it("accepts null for a declared sampler, which restores the declared fallback", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/textured.wgsl", { "shaders/textured.wgsl": TEXTURED_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    expect(() => {
      material.setTexture("albedo", null);
    }).not.toThrow();
  });

  it("binds a loaded texture handle", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/textured.wgsl", { "shaders/textured.wgsl": TEXTURED_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    h.canned("textures/noise.png", "not a real png");
    const texture = h.app.assets.load<TextureAsset>("textures/noise.png");
    await h.settle(1);
    expect(() => {
      material.setTexture("albedo", texture);
    }).not.toThrow();
    h.app.assets.release(texture);
  });
});

describe("setDefine", () => {
  it("rebuilds the Lite material, so a renderer picks the new pipeline up", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/textured.wgsl", { "shaders/textured.wgsl": TEXTURED_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    const before = material.lite.material;
    material.setDefine("TINTED", true);
    expect(material.lite.material).not.toBe(before);
  });

  it("keeps the uniform values across the rebuild", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/textured.wgsl", { "shaders/textured.wgsl": TEXTURED_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    material.setDefine("TINTED", true);
    expect(material.isDrawable).toBe(true);
  });

  it("does nothing when the value has not changed", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/textured.wgsl", { "shaders/textured.wgsl": TEXTURED_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    material.setDefine("TINTED", true);
    const rebuilt = material.lite.material;
    material.setDefine("TINTED", true);
    expect(material.lite.material).toBe(rebuilt);
  });

  it("refuses a define the shader does not declare", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setDefine("WOBBLE", true);
    }).toThrow(/IGX-0712/);
  });
});

describe("setStorageBuffer", () => {
  it("refuses a binding the shader does not declare", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setStorageBuffer("particles", null);
    }).toThrow(/IGX-0712/);
  });
});

describe("more setters", () => {
  it("writes the alpha channel of a vec4 colour uniform", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/rgba.wgsl", {
      "shaders/rgba.wgsl": "// @ignifx shader\n// @ignifx uniform tint: vec4<f32> = color(1, 1, 1, 1)\n",
    });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    material.setUniform("tint", { r: 1, g: 1, b: 1, a: 0.25 });
    const read = material.getUniform("tint", new Float32Array(4));
    expect(read instanceof Float32Array ? read[3] : 0).toBeCloseTo(0.25);
  });

  it("reads a matrix uniform back as sixteen floats", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/mat.wgsl", {
      "shaders/mat.wgsl": "// @ignifx shader\n// @ignifx uniform m: mat4x4<f32>\n",
    });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    const read = material.getUniform("m");
    expect(read instanceof Float32Array ? read.length : 0).toBe(16);
    expect(read instanceof Float32Array ? read[0] : 0).toBeCloseTo(1);
  });

  it("binds the fallback for a texture handle that has not loaded yet", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/textured.wgsl", { "shaders/textured.wgsl": TEXTURED_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    const pending = h.app.assets.load<TextureAsset>("textures/pending.png");
    expect(pending.state).toBe("loading");
    expect(() => {
      material.setTexture("albedo", pending);
    }).not.toThrow();
    h.app.assets.release(pending);
  });

  it("makes a material undrawable again when its storage buffer is unbound", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/storage.wgsl", { "shaders/storage.wgsl": STORAGE_WGSL });
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
    using buffer = createStorageBufferAsset(h.app, "offsets", new Float32Array(4));
    material.setStorageBuffer("offsets", buffer);
    expect(material.isDrawable).toBe(true);
    material.setStorageBuffer("offsets", null);
    expect(material.isDrawable).toBe(false);
  });

  it("takes a name override on the definition", () => {
    expect(shaderMaterialDefinition({ shader: "shaders/tint.wgsl", name: "dissolve" }).name).toBe("dissolve");
  });

  it("records a texture handle's address on the definition", async () => {
    const h = await app();
    h.canned("textures/noise.png", "not a real png");
    const texture = h.app.assets.load<TextureAsset>("textures/noise.png");
    const definition = shaderMaterialDefinition({ shader: "shaders/tint.wgsl", textures: { albedo: texture } });
    expect(definition.textures).toEqual({ albedo: "textures/noise.png" });
    h.app.assets.release(texture);
  });
});

describe("clone", () => {
  it("replays the definition onto a second Lite material", async () => {
    const h = await app();
    const material = await tintMaterial(h, { pulse: 0.4 });
    using copy = material.clone(h.app);
    expect(copy.value.kind).toBe("shader");
    expect(copy.value.getUniform("pulse")).toBeCloseTo(0.4);
    expect(copy.value.lite.material).not.toBe(material.lite.material);
  });
});

describe("the kind guards", () => {
  it("refuse the shader methods on a PBR material", async () => {
    const h = await app();
    using pbr = createMaterialAsset(h.app, pbrMaterialDefinition({ name: "gold" }), []);
    const material = pbr.value;
    expect(() => {
      material.setUniform("tint", 1);
    }).toThrow(/IGX-0718/);
    expect(() => material.getUniform("tint")).toThrow(/IGX-0718/);
    expect(() => {
      material.setTexture("tint", null);
    }).toThrow(/IGX-0718/);
    expect(() => {
      material.setDefine("TINTED", true);
    }).toThrow(/IGX-0718/);
    expect(() => {
      material.setStorageBuffer("particles", null);
    }).toThrow(/IGX-0718/);
    expect(material.shader).toBeNull();
    expect(material.isDrawable).toBe(true);
  });

  it("refuse the PBR setters on a shader material", async () => {
    const h = await app();
    const material = await tintMaterial(h);
    expect(() => {
      material.setBaseColor({ r: 1, g: 1, b: 1, a: 1 });
    }).toThrow(/IGX-0718/);
    expect(() => {
      material.setMetallicRoughness(0, 1);
    }).toThrow(/IGX-0718/);
    expect(() => {
      material.setAlpha(0.5);
    }).toThrow(/IGX-0718/);
  });

  it("leave dispose harmless on a PBR material", async () => {
    const h = await app();
    using pbr = createMaterialAsset(h.app, pbrMaterialDefinition({ name: "gold" }), []);
    expect(() => {
      pbr.value.dispose();
    }).not.toThrow();
  });
});

describe("building a shader material without its shader", () => {
  it("refuses a declaration whose shader is not in the asset cache", async () => {
    const h = await app();
    expect(() => createMaterialAsset(h.app, shaderMaterialDefinition({ shader: "shaders/absent.wgsl" }), [])).toThrow(
      /IGX-0501/,
    );
  });

  it("refuses a build with no context at all", () => {
    expect(() => buildMaterialAsset(shaderMaterialDefinition({ shader: "shaders/absent.wgsl" }), [])).toThrow(
      /IGX-0501/,
    );
  });
});

describe("every declared uniform type", () => {
  /** One shader declaring one uniform of each type Babylon Lite accepts. */
  const EVERY_TYPE_WGSL = `// @ignifx shader
// @ignifx uniform scalar: f32 = 1
// @ignifx uniform count: u32 = 2
// @ignifx uniform offset: i32 = -3
// @ignifx uniform pair: vec2<f32> = (1, 2)
// @ignifx uniform tint: vec3<f32> = color(1, 0.5, 0.25)
// @ignifx uniform rgba: vec4<f32> = color(1, 0.5, 0.25, 0.5)
// @ignifx uniform transform: mat4x4<f32>
`;

  /**
   * Builds a material on the every-type shader.
   *
   * @param h - The harness.
   * @returns The material.
   */
  async function everyType(h: ShaderHarness): Promise<MaterialAsset> {
    const shader = await h.load<ShaderAsset>("shaders/every.wgsl", { "shaders/every.wgsl": EVERY_TYPE_WGSL });
    return createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
  }

  it("reads each declared default back", async () => {
    const material = await everyType(await app());
    expect(material.getUniform("scalar")).toBeCloseTo(1);
    expect(material.getUniform("count")).toBeCloseTo(2);
    expect(material.getUniform("offset")).toBeCloseTo(-3);
    const pair = new Float32Array(2);
    material.getUniform("pair", pair);
    expect([...pair]).toEqual([1, 2]);
    const matrix = material.getUniform("transform");
    expect(matrix instanceof Float32Array ? matrix.length : 0).toBe(16);
  });

  it("decodes a colour default and a colour written as an array", async () => {
    const material = await everyType(await app());
    const tint = new Float32Array(3);
    material.getUniform("tint", tint);
    expect(tint[0]).toBeCloseTo(1);
    expect(tint[1]).toBeCloseTo(Color.srgbToLinear(0.5));
    material.setUniform("tint", [0.25, 0.5, 1]);
    material.getUniform("tint", tint);
    expect(tint[0]).toBeCloseTo(Color.srgbToLinear(0.25));
  });

  it("takes a ColorLike for a vec4 and keeps its alpha linear", async () => {
    const material = await everyType(await app());
    material.setUniform("rgba", { r: 1, g: 0.5, b: 0, a: 0.25 });
    const rgba = new Float32Array(4);
    material.getUniform("rgba", rgba);
    expect(rgba[1]).toBeCloseTo(Color.srgbToLinear(0.5));
    expect(rgba[3]).toBeCloseTo(0.25);
  });

  it("takes a Float32Array of the declared length", async () => {
    const material = await everyType(await app());
    material.setUniform("transform", new Float32Array(16).fill(2));
    const out = new Float32Array(16);
    material.getUniform("transform", out);
    expect(out[15]).toBeCloseTo(2);
  });

  it("refuses a colour written onto a scalar", async () => {
    const material = await everyType(await app());
    expect(() => {
      material.setUniform("scalar", { r: 1, g: 1, b: 1, a: 1 });
    }).toThrow(/IGX-0713/);
  });

  it("refuses a number written onto a vector", async () => {
    const material = await everyType(await app());
    expect(() => {
      material.setUniform("pair", 1);
    }).toThrow(/IGX-0713/);
  });

  it("refuses an array of the wrong length", async () => {
    const material = await everyType(await app());
    expect(() => {
      material.setUniform("pair", [1, 2, 3]);
    }).toThrow(/IGX-0713/);
  });

  it("refuses an out parameter too short for the uniform", async () => {
    const material = await everyType(await app());
    expect(() => {
      material.getUniform("transform", new Float32Array(4));
    }).toThrow(/IGX-0713/);
  });

  it("refuses a uniform the engine writes itself", async () => {
    const h = await app();
    const material = await materialWithSystem(h);
    expect(() => {
      material.setUniform("time", 1);
    }).toThrow(/IGX-0712/);
  });
});

/**
 * Builds a material whose shader declares an ignifx-provided uniform.
 *
 * @param h - The harness.
 * @returns The material.
 */
async function materialWithSystem(h: ShaderHarness): Promise<MaterialAsset> {
  const address = "shaders/clocked.wgsl";
  const source = "// @ignifx shader\n// @ignifx system time\n";
  const shader = await h.load<ShaderAsset>(address, { [address]: source });
  return createMaterialAsset(h.app, shaderMaterialDefinition({ shader: shader.address }), []).value;
}
