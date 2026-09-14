import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { Color } from "../../src/math/color.js";
import {
  createMaterialAsset,
  pbrMaterialDefinition,
  standardMaterialDefinition,
} from "../../src/render/material-asset.js";
import { shaderMaterialDefinition } from "../../src/render/shader-material-definition.js";
import {
  attachSurfaceShaders,
  detachSurfaceShaders,
  surfaceShaderBinding,
  surfaceShaderName,
  surfaceShaders,
} from "../../src/render/surface-shader.js";
import { defaultTextureImportOptions, TextureAsset } from "../../src/render/texture-asset.js";
import { TINT_WGSL } from "../fixtures/shaders/sources.js";
import {
  FLAT_RED_SURFACE_WGSL,
  INVERT_COMPOSITE_WGSL,
  NO_HOOK_SURFACE_WGSL,
  LIFT_DISPLACE_WGSL,
  SNOW_SURFACE_WGSL,
  TEN_SAMPLER_SURFACE_WGSL,
  TINT_POST_WGSL,
  createSurfaceHarness,
} from "../fixtures/shaders/surfaces.js";
import { warningsOf } from "./support/render-harness.js";
import type { MaterialAsset } from "../../src/render/material-asset.js";
import type { ShaderAsset } from "../../src/render/shader-asset.js";
import type { SurfaceShaderInit } from "../../src/render/surface-shader.js";
import type { SurfaceHarness } from "../fixtures/shaders/surfaces.js";

/**
 * Attaching surface shaders to a material on the null engine: the naming, the value and texture
 * setters, the refusals, and the budget. Nothing here builds a Babylon Lite plugin — that needs a
 * device and lives in `test/lite/render/surface-shader.browser.test.ts` — which is exactly the
 * headless contract a terrain or foliage package is unit-tested against.
 */

let harness: SurfaceHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A harness with the `.wgsl` loader registered and `materialPlugins` declared.
 *
 * @returns The harness.
 */
async function app(): Promise<SurfaceHarness> {
  harness = await createSurfaceHarness();
  return harness;
}

/**
 * A PBR material to hang surface shaders on.
 *
 * @param h - The harness.
 * @param name - The material's name.
 * @returns The material.
 */
function pbr(h: SurfaceHarness, name = "rock"): MaterialAsset {
  return createMaterialAsset(h.app, pbrMaterialDefinition({ name, roughness: 0.9 }), []).value;
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

/**
 * Loads a surface shader and attaches it to a fresh PBR material.
 *
 * @param h - The harness.
 * @param source - The `.surface.wgsl` text.
 * @param overrides - What the material declares beyond the shader.
 * @param address - The shader's address.
 * @returns The material and its bindings.
 */
async function attach(
  h: SurfaceHarness,
  source: string,
  overrides: Omit<SurfaceShaderInit, "shader"> = {},
  address = "shaders/snow.surface.wgsl",
): Promise<{ material: MaterialAsset; bindings: readonly ReturnType<typeof surfaceShaderBinding>[] }> {
  const shader = await h.loadShader(address, source);
  const material = pbr(h);
  const bindings = attachSurfaceShaders(material, h.app, [{ shader, ...overrides }]);
  return { material, bindings };
}

describe("naming a surface shader", () => {
  it("takes the address's basename without the .surface.wgsl", () => {
    expect(surfaceShaderName("shaders/terrain/snow.surface.wgsl")).toBe("snow");
  });

  it("takes the basename of a plain .wgsl too", () => {
    expect(surfaceShaderName("wind.wgsl")).toBe("wind");
  });

  it("names the binding after the address by default", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(bindings[0]?.name).toBe("snow");
  });

  it("lets the material rename it", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL, { name: "frost" });
    expect(bindings[0]?.name).toBe("frost");
  });

  it("reaches an attached shader again by name", async () => {
    const h = await app();
    const { material } = await attach(h, SNOW_SURFACE_WGSL);
    expect(surfaceShaderBinding(material, "snow").shader.address).toBe("shaders/snow.surface.wgsl");
  });

  it("refuses a name the material does not carry with IGX-0712", async () => {
    const h = await app();
    const { material } = await attach(h, SNOW_SURFACE_WGSL);
    expect(codeOf(() => surfaceShaderBinding(material, "wetness"))).toBe("IGX-0712");
  });

  it("refuses two shaders that would answer to one name with IGX-0712", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const material = pbr(h);
    expect(codeOf(() => attachSurfaceShaders(material, h.app, [{ shader }, { shader }]))).toBe("IGX-0712");
  });
});

describe("values", () => {
  it("starts every uniform at its declared default", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(bindings[0]?.get("amount")).toBeCloseTo(0.6, 6);
  });

  it("decodes a declared colour default from sRGB to linear", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    const color = bindings[0]?.get("snowColor");
    expect(color).toBeInstanceOf(Float32Array);
    expect((color as Float32Array)[0]).toBeCloseTo(Color.srgbToLinear(0.95), 6);
  });

  it("applies the material's own overrides at attach", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL, { values: { amount: 0.25 } });
    expect(bindings[0]?.get("amount")).toBeCloseTo(0.25, 6);
  });

  it("writes a scalar", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    bindings[0]?.set("amount", 0.8);
    expect(bindings[0]?.get("amount")).toBeCloseTo(0.8, 6);
  });

  it("takes an sRGB colour and stores it linear", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    bindings[0]?.set("snowColor", { r: 0.5, g: 0.5, b: 0.5, a: 1 });
    const out = new Float32Array(3);
    bindings[0]?.get("snowColor", out);
    expect(out[0]).toBeCloseTo(Color.srgbToLinear(0.5), 6);
  });

  it("takes a numeric array of the declared length", async () => {
    const h = await app();
    const { bindings } = await attach(h, FLAT_RED_SURFACE_WGSL, {}, "shaders/flat.surface.wgsl");
    bindings[0]?.set("flatColor", [0.1, 0.2, 0.3]);
    const out = new Float32Array(3);
    bindings[0]?.get("flatColor", out);
    expect(out[1]).toBeCloseTo(Color.srgbToLinear(0.2), 6);
  });

  it("refuses an undeclared uniform with IGX-0712", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(codeOf(() => bindings[0]?.set("depth", 1))).toBe("IGX-0712");
  });

  it("refuses a scalar written to a vector with IGX-0713", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(codeOf(() => bindings[0]?.set("snowColor", 1))).toBe("IGX-0713");
  });

  it("refuses an array of the wrong length with IGX-0713", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(codeOf(() => bindings[0]?.set("snowColor", [1, 0]))).toBe("IGX-0713");
  });

  it("refuses a colour written to a scalar with IGX-0713", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(codeOf(() => bindings[0]?.set("amount", { r: 1, g: 1, b: 1, a: 1 }))).toBe("IGX-0713");
  });

  it("refuses an out buffer shorter than the value with IGX-0713", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(codeOf(() => bindings[0]?.get("snowColor", new Float32Array(2)))).toBe("IGX-0713");
  });
});

describe("textures", () => {
  it("starts a declared sampler unbound, which means its fallback", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(bindings[0]?.getTexture("snowNoise")).toBeNull();
  });

  it("refuses an undeclared sampler with IGX-0712", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(codeOf(() => bindings[0]?.setTexture("albedo", null))).toBe("IGX-0712");
  });

  it("refuses a material whose surface shaders declare more than nine samplers with IGX-0726", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/many.surface.wgsl", TEN_SAMPLER_SURFACE_WGSL);
    const material = pbr(h);
    expect(codeOf(() => attachSurfaceShaders(material, h.app, [{ shader }]))).toBe("IGX-0726");
  });
});

describe("enabling and detaching", () => {
  it("starts enabled", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(bindings[0]?.enabled).toBe(true);
  });

  it("honours a material that declares it off", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL, { enabled: false });
    expect(bindings[0]?.enabled).toBe(false);
  });

  it("toggles", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    const binding = bindings[0];
    if (binding !== undefined) {
      binding.enabled = false;
    }
    expect(bindings[0]?.enabled).toBe(false);
  });

  it("lists what is attached, in order", async () => {
    const h = await app();
    const snow = await h.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const rim = await h.loadShader("shaders/rim.surface.wgsl", INVERT_COMPOSITE_WGSL);
    const material = pbr(h);
    attachSurfaceShaders(material, h.app, [{ shader: rim, priority: 10 }, { shader: snow }]);
    expect(surfaceShaders(material).map((binding) => binding.name)).toStrictEqual(["rim", "snow"]);
  });

  it("keeps the declared priority, which is what Lite sorts the plugins by", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL, { priority: 100 });
    expect(bindings[0]?.priority).toBe(100);
  });

  it("re-attaching replaces rather than adds", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const material = pbr(h);
    attachSurfaceShaders(material, h.app, [{ shader }]);
    attachSurfaceShaders(material, h.app, [{ shader }]);
    expect(surfaceShaders(material)).toHaveLength(1);
  });

  it("detaching leaves the material with none", async () => {
    const h = await app();
    const { material } = await attach(h, SNOW_SURFACE_WGSL);
    detachSurfaceShaders(material);
    expect(surfaceShaders(material)).toStrictEqual([]);
  });

  it("detaching a material that never had one is a no-op", async () => {
    const h = await app();
    const material = pbr(h);
    detachSurfaceShaders(material);
    expect(surfaceShaders(material)).toStrictEqual([]);
  });

  it("an empty list detaches", async () => {
    const h = await app();
    const { material } = await attach(h, SNOW_SURFACE_WGSL);
    expect(attachSurfaceShaders(material, h.app, [])).toStrictEqual([]);
    expect(surfaceShaders(material)).toStrictEqual([]);
  });
});

describe("what a host has to be", () => {
  it("refuses a standard material with IGX-0723, which Babylon Lite cannot bake in time", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/flat.surface.wgsl", FLAT_RED_SURFACE_WGSL);
    const material = createMaterialAsset(h.app, standardMaterialDefinition({ name: "wall" }), []).value;
    expect(codeOf(() => attachSurfaceShaders(material, h.app, [{ shader }]))).toBe("IGX-0723");
  });

  it("refuses a shader material with IGX-0708", async () => {
    const h = await app();
    const surface = await h.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const program = await h.loadShader("shaders/tint.wgsl", TINT_WGSL);
    const material = createMaterialAsset(h.app, shaderMaterialDefinition({ shader: program.address }), []).value;
    expect(codeOf(() => attachSurfaceShaders(material, h.app, [{ shader: surface }]))).toBe("IGX-0708");
  });

  it("refuses a .wgsl that is not a surface file with IGX-0709", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/tint.post.wgsl", TINT_POST_WGSL);
    const material = pbr(h);
    expect(codeOf(() => attachSurfaceShaders(material, h.app, [{ shader }]))).toBe("IGX-0709");
  });

  it("refuses a surface file with no hook with IGX-0723", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/empty.surface.wgsl", NO_HOOK_SURFACE_WGSL);
    const material = pbr(h);
    expect(codeOf(() => attachSurfaceShaders(material, h.app, [{ shader }]))).toBe("IGX-0723");
  });

  it("compiles and validates with no app at all, for a pure unit test", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const material = pbr(h);
    const bindings = attachSurfaceShaders(material, null, [{ shader }]);
    expect(bindings[0]?.lite).toBeNull();
  });
});

describe("the materialPlugins opt-in", () => {
  it("builds no Lite plugin under a headless app, which has no pipeline to patch", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    expect(bindings[0]?.lite).toBeNull();
  });

  it("warns IGX-0716 when a headless app did not declare it", async () => {
    harness = await createSurfaceHarness({ rendering: { features: { materialPlugins: false } } });
    const shader = await harness.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const material = pbr(harness);
    attachSurfaceShaders(material, harness.app, [{ shader }]);
    expect(warningsOf(harness).join("\n")).toContain("IGX-0716");
  });

  it("still attaches without it under a headless app", async () => {
    harness = await createSurfaceHarness({ rendering: { features: { materialPlugins: false } } });
    const shader = await harness.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const material = pbr(harness);
    expect(attachSurfaceShaders(material, harness.app, [{ shader }])).toHaveLength(1);
  });
});

describe("a binding's value and texture accessors", () => {
  /** One surface shader declaring one uniform of every type plus a texture. */
  const EVERY_TYPE_SURFACE_WGSL = `// @ignifx surface
// @ignifx uniform amount: f32 = 0.5
// @ignifx uniform pair: vec2<f32> = (1, 2)
// @ignifx uniform tint: vec3<f32> = color(1, 0.5, 0.25)
// @ignifx uniform rgba: vec4<f32> = color(1, 1, 1, 1)
// @ignifx texture mask

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  (*s).baseColor = surfaceUniforms.tint * surfaceUniforms.amount;
}
`;

  it("reads a scalar back as a number and a vector as a copy", async () => {
    const h = await app();
    const { bindings } = await attach(h, EVERY_TYPE_SURFACE_WGSL, {}, "shaders/every.surface.wgsl");
    const binding = bindings[0];
    expect(binding?.get("amount")).toBeCloseTo(0.5);
    const pair = binding?.get("pair");
    expect(pair instanceof Float32Array ? [...pair] : []).toEqual([1, 2]);
  });

  it("fills an out parameter rather than allocating", async () => {
    const h = await app();
    const { bindings } = await attach(h, EVERY_TYPE_SURFACE_WGSL, {}, "shaders/every.surface.wgsl");
    const out = new Float32Array(3);
    bindings[0]?.get("tint", out);
    expect(out[0]).toBeCloseTo(1);
  });

  it("takes a ColorLike on a vec4 and keeps the alpha", async () => {
    const h = await app();
    const { bindings } = await attach(h, EVERY_TYPE_SURFACE_WGSL, {}, "shaders/every.surface.wgsl");
    bindings[0]?.set("rgba", { r: 1, g: 0.5, b: 0, a: 0.25 });
    const out = new Float32Array(4);
    bindings[0]?.get("rgba", out);
    expect(out[3]).toBeCloseTo(0.25);
  });

  it("refuses an unknown uniform on get and on set", async () => {
    const h = await app();
    const { bindings } = await attach(h, EVERY_TYPE_SURFACE_WGSL, {}, "shaders/every.surface.wgsl");
    expect(() => bindings[0]?.get("nope")).toThrow(/IGX-0712/);
    expect(() => {
      bindings[0]?.set("nope", 1);
    }).toThrow(/IGX-0712/);
  });

  it("refuses an out parameter too short", async () => {
    const h = await app();
    const { bindings } = await attach(h, EVERY_TYPE_SURFACE_WGSL, {}, "shaders/every.surface.wgsl");
    expect(() => bindings[0]?.get("tint", new Float32Array(2))).toThrow(/IGX-0713/);
  });

  it("reads back the texture it was given, and refuses an unknown sampler", async () => {
    const h = await app();
    const { bindings } = await attach(h, EVERY_TYPE_SURFACE_WGSL, {}, "shaders/every.surface.wgsl");
    const binding = bindings[0];
    expect(binding?.getTexture("mask")).toBeNull();
    binding?.setTexture("mask", null);
    expect(binding?.getTexture("mask")).toBeNull();
    expect(() => binding?.getTexture("nope")).toThrow(/IGX-0712/);
    expect(() => {
      binding?.setTexture("nope", null);
    }).toThrow(/IGX-0712/);
  });

  it("ignores an enabled write that changes nothing", async () => {
    const h = await app();
    const { bindings } = await attach(h, EVERY_TYPE_SURFACE_WGSL, {}, "shaders/every.surface.wgsl");
    const binding = bindings[0];
    expect(binding?.enabled).toBe(true);
    if (binding !== undefined) {
      binding.enabled = true;
      binding.enabled = false;
    }
    expect(binding?.enabled).toBe(false);
  });

  it("applies the init's values and textures at attach time", async () => {
    const h = await app();
    const { bindings } = await attach(
      h,
      EVERY_TYPE_SURFACE_WGSL,
      { values: { amount: 0.9 } },
      "shaders/every.surface.wgsl",
    );
    expect(bindings[0]?.get("amount")).toBeCloseTo(0.9);
  });

  it("resolves a definition's surfaces list from the asset cache when a material is built", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const material = createMaterialAsset(
      h.app,
      pbrMaterialDefinition({
        name: "rock",
        surfaces: [
          { shader: shader.address, name: "snow", values: { amount: 0.7 }, textures: {}, enabled: true, priority: 500 },
        ],
      }),
      [],
    ).value;
    expect(material.surfaces).toHaveLength(1);
    expect(material.surface("snow").get("amount")).toBeCloseTo(0.7);
  });

  it("resolves an unnamed surfaces entry and the textures it names from the cache", async () => {
    const h = await app();
    const shader = await h.loadShader("shaders/snow.surface.wgsl", SNOW_SURFACE_WGSL);
    const texture = h.app.assets.register(new TextureAsset("memory:noise", null, defaultTextureImportOptions()), {
      type: "texture",
      address: "textures/noise.png",
    });
    const material = createMaterialAsset(
      h.app,
      pbrMaterialDefinition({
        name: "rock",
        surfaces: [
          {
            shader: shader.address,
            name: "",
            values: {},
            textures: { snowNoise: "textures/noise.png", absent: "textures/gone.png" },
            enabled: true,
            priority: 500,
          },
        ],
      }),
      [],
    ).value;
    expect(material.surface("snow").getTexture("snowNoise")).not.toBeNull();
    texture.release();
  });

  it("refuses a definition whose surface shader is not in the asset cache", async () => {
    const h = await app();
    expect(() =>
      createMaterialAsset(
        h.app,
        pbrMaterialDefinition({
          name: "rock",
          surfaces: [
            { shader: "shaders/absent.surface.wgsl", name: "", values: {}, textures: {}, enabled: true, priority: 500 },
          ],
        }),
        [],
      ),
    ).toThrow(/IGX-0501/);
  });

  it("refuses a surface shader whose handle has not loaded", async () => {
    const h = await app();
    const material = pbr(h);
    const pending = h.app.assets.load<ShaderAsset>("shaders/never.surface.wgsl");
    expect(() => attachSurfaceShaders(material, h.app, [{ shader: pending }])).toThrow(/IGX-0501/);
  });
});

describe("names and diagnostics at the edges", () => {
  it("takes a basename with no extension as the name", () => {
    expect(surfaceShaderName("shaders/wind")).toBe("wind");
  });

  it("says so when a shader declares no binding of the kind that was asked for", async () => {
    const h = await app();
    const { bindings } = await attach(h, LIFT_DISPLACE_WGSL, {}, "shaders/lift.surface.wgsl");
    expect(() => bindings[0]?.getTexture("nope")).toThrow(/no bindings of that kind/);
  });

  it("binds a loaded texture through to the plugin state", async () => {
    const h = await app();
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL);
    const texture = h.app.assets.register(new TextureAsset("memory:test", null, defaultTextureImportOptions()), {
      type: "texture",
    });
    bindings[0]?.setTexture("snowNoise", texture);
    expect(bindings[0]?.getTexture("snowNoise")).toBe(texture);
    texture.release();
  });

  it("applies an init's textures at attach time", async () => {
    const h = await app();
    const texture = h.app.assets.register(new TextureAsset("memory:init", null, defaultTextureImportOptions()), {
      type: "texture",
    });
    const { bindings } = await attach(h, SNOW_SURFACE_WGSL, { textures: { snowNoise: texture } });
    expect(bindings[0]?.getTexture("snowNoise")).toBe(texture);
    texture.release();
  });
});
