import { describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { isVertexPluginPoint } from "../../src/lite/gpu/material-plugin.js";
import {
  LITE_MATERIAL_PLUGIN_POINTS,
  MATERIAL_PLUGIN_DEFAULT_PRIORITY,
  MATERIAL_PLUGIN_SAMPLER_BUDGET,
  defineMaterialPlugin,
  isLiteMaterialPluginPoint,
  uniformComponentCount,
} from "../../src/render/material-plugin.js";
import type { MaterialPluginDefinitionInit } from "../../src/render/material-plugin.js";
import type { ShaderTextureDeclaration, ShaderUniformDeclaration } from "../../src/render/shader-declaration.js";

/**
 * `defineMaterialPlugin`, the `@beta` raw injection-point API. It validates and nothing else, so
 * every check is a plain function call with no app and no device.
 */

/**
 * A declared uniform.
 *
 * @param name - Its WGSL name.
 * @param type - Its WGSL type; `f32` by default.
 * @returns The declaration.
 */
function uniform(name: string, type: ShaderUniformDeclaration["type"] = "f32"): ShaderUniformDeclaration {
  return { name, type, defaultValue: 0, color: false, range: null, step: null, tooltip: null };
}

/**
 * A declared texture.
 *
 * @param name - Its WGSL name.
 * @returns The declaration.
 */
function texture(name: string): ShaderTextureDeclaration {
  return { name, srgb: false, normal: false, fallback: null, array: false };
}

/** A definition that passes every check. */
const VALID: MaterialPluginDefinitionInit = {
  name: "tint",
  code: { CUSTOM_FRAGMENT_UPDATE_ALPHA: "baseColor = baseColor * 0.5;" },
};

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

describe("the injection points", () => {
  it("names Lite's ten", () => {
    expect(LITE_MATERIAL_PLUGIN_POINTS).toHaveLength(10);
  });

  it("recognises one of them", () => {
    expect(isLiteMaterialPluginPoint("CUSTOM_VERTEX_UPDATE_WORLDPOS")).toBe(true);
  });

  it("rejects a name Lite does not have", () => {
    expect(isLiteMaterialPluginPoint("CUSTOM_FRAGMENT_UPDATE_ROUGHNESS")).toBe(false);
  });

  it("splits the three vertex points from the seven fragment ones", () => {
    const vertex = LITE_MATERIAL_PLUGIN_POINTS.filter((point) => isVertexPluginPoint(point));
    expect(vertex).toStrictEqual([
      "CUSTOM_VERTEX_MAIN_BEGIN",
      "CUSTOM_VERTEX_UPDATE_WORLDPOS",
      "CUSTOM_VERTEX_MAIN_END",
    ]);
  });
});

describe("defining a plugin", () => {
  it("fills in the priority Lite itself defaults to", () => {
    expect(defineMaterialPlugin(VALID).priority).toBe(MATERIAL_PLUGIN_DEFAULT_PRIORITY);
  });

  it("fills in empty uniform and texture lists", () => {
    const plugin = defineMaterialPlugin(VALID);
    expect([plugin.uniforms, plugin.textures]).toStrictEqual([[], []]);
  });

  it("keeps a declared priority", () => {
    expect(defineMaterialPlugin({ ...VALID, priority: 10 }).priority).toBe(10);
  });

  it("keeps the code map as written", () => {
    expect(defineMaterialPlugin(VALID).code.CUSTOM_FRAGMENT_UPDATE_ALPHA).toBe("baseColor = baseColor * 0.5;");
  });

  it("refuses a plugin that injects nothing with IGX-0723", () => {
    expect(codeOf(() => defineMaterialPlugin({ name: "empty", code: {} }))).toBe("IGX-0723");
  });

  it("refuses a plugin whose only code is blank with IGX-0723", () => {
    expect(codeOf(() => defineMaterialPlugin({ name: "blank", code: { CUSTOM_FRAGMENT_DEFINITIONS: "  " } }))).toBe(
      "IGX-0723",
    );
  });

  it("refuses a name that is not a WGSL-shaped identifier with IGX-0712", () => {
    expect(codeOf(() => defineMaterialPlugin({ ...VALID, name: "2 tints" }))).toBe("IGX-0712");
  });

  it("accepts a name with inner dots, colons, and dashes", () => {
    expect(defineMaterialPlugin({ ...VALID, name: "terrain:splat-2.0" }).name).toBe("terrain:splat-2.0");
  });

  it("refuses an unknown injection point with IGX-0712", () => {
    expect(codeOf(() => defineMaterialPlugin({ name: "x", code: { CUSTOM_FRAGMENT_ROUGHNESS: "" } as never }))).toBe(
      "IGX-0712",
    );
  });
});

describe("validating the bindings", () => {
  it("refuses a uniform name that is not an identifier with IGX-0712", () => {
    expect(codeOf(() => defineMaterialPlugin({ ...VALID, uniforms: [uniform("snow amount")] }))).toBe("IGX-0712");
  });

  it("refuses a name the PBR shader already owns with IGX-0712", () => {
    expect(codeOf(() => defineMaterialPlugin({ ...VALID, uniforms: [uniform("roughnessFactor")] }))).toBe("IGX-0712");
  });

  it("refuses a texture name the PBR shader already owns with IGX-0712", () => {
    expect(codeOf(() => defineMaterialPlugin({ ...VALID, textures: [texture("baseColorTexture")] }))).toBe("IGX-0712");
  });

  it("refuses the same name twice with IGX-0712", () => {
    expect(codeOf(() => defineMaterialPlugin({ ...VALID, uniforms: [uniform("a"), uniform("a")] }))).toBe("IGX-0712");
  });

  it("refuses a uniform whose name collides with another's sampler with IGX-0712", () => {
    expect(
      codeOf(() =>
        defineMaterialPlugin({ ...VALID, uniforms: [uniform("noiseSampler")], textures: [texture("noise")] }),
      ),
    ).toBe("IGX-0712");
  });

  it("accepts a uniform of every type Lite's bridge carries", () => {
    const plugin = defineMaterialPlugin({
      ...VALID,
      uniforms: [uniform("s"), uniform("v", "vec3<f32>"), uniform("m", "mat4x4<f32>"), uniform("i", "i32")],
    });
    expect(plugin.uniforms).toHaveLength(4);
  });

  it("refuses more samplers than the per-material budget with IGX-0726", () => {
    const textures = Array.from({ length: MATERIAL_PLUGIN_SAMPLER_BUDGET + 1 }, (_unused, index) =>
      texture(`map${String(index)}`),
    );
    expect(codeOf(() => defineMaterialPlugin({ ...VALID, textures }))).toBe("IGX-0726");
  });

  it("accepts exactly the budget", () => {
    const textures = Array.from({ length: MATERIAL_PLUGIN_SAMPLER_BUDGET }, (_unused, index) =>
      texture(`map${String(index)}`),
    );
    expect(defineMaterialPlugin({ ...VALID, textures }).textures).toHaveLength(MATERIAL_PLUGIN_SAMPLER_BUDGET);
  });
});

describe("the component count of a uniform type", () => {
  it("counts one float for a scalar", () => {
    expect([uniformComponentCount("f32"), uniformComponentCount("u32"), uniformComponentCount("i32")]).toStrictEqual([
      1, 1, 1,
    ]);
  });

  it("counts the vector widths", () => {
    expect([
      uniformComponentCount("vec2<f32>"),
      uniformComponentCount("vec3<f32>"),
      uniformComponentCount("vec4<f32>"),
    ]).toStrictEqual([2, 3, 4]);
  });

  it("counts sixteen floats for a matrix", () => {
    expect(uniformComponentCount("mat4x4<f32>")).toBe(16);
  });
});
