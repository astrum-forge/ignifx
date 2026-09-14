import { afterEach, describe, expect, it } from "vitest";
import { Color } from "../../src/math/color.js";
import { SHADER_ASSET_TYPE, ShaderAsset } from "../../src/render/shader-asset.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import { createShaderHarness } from "../fixtures/shaders/harness.js";
import { TINT_MATERIAL_JSON, TINT_RELOADED_WGSL, TINT_WGSL } from "../fixtures/shaders/sources.js";
import type { AssetHandle } from "../../src/assets/types.js";
import type { MaterialAsset } from "../../src/render/material-asset.js";
import type { ShaderDeclaration } from "../../src/render/shader-declaration.js";
import type { Signal } from "../../src/signal/signal.js";
import type { ShaderHarness } from "../fixtures/shaders/harness.js";

/**
 * The `shader` loader, the `"shader"` branch of the `.material.json` loader, and the hot-reload
 * swap (`docs/architecture/05-assets-and-loading.md` §5, §7).
 */

let harness: ShaderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A harness with the shader loader registered.
 *
 * @returns The harness.
 */
async function app(): Promise<ShaderHarness> {
  harness = await createShaderHarness();
  return harness;
}

/**
 * Waits for a handle's promise to reject, which is what a failed load does.
 *
 * @param promise - The handle's promise.
 */
async function expectRejection(promise: Promise<unknown>): Promise<void> {
  await promise.then(
    () => {
      throw new Error("the load was expected to fail");
    },
    () => undefined,
  );
}

/**
 * Emits a shader handle's `onReplaced`, which is what a hot reload does.
 *
 * @param handle - The shader handle.
 * @param value - The replacement.
 */
function replaceShader(handle: AssetHandle<ShaderAsset> | null, value: ShaderAsset): void {
  // The signal is a `Signal`, not just a `SignalLike`, on the concrete handle the service builds;
  // emitting it directly is how this suite reaches the branch a real reload cannot produce.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see the comment above
  (handle?.onReplaced as unknown as Signal<ShaderAsset> | undefined)?.emit(value);
}

/**
 * A declaration with nothing in it, as the fallback for a material whose shader has gone.
 *
 * @returns The declaration.
 */
function emptyDeclaration(): ShaderDeclaration {
  return parseShaderDeclaration("// @ignifx shader", "x.wgsl");
}

/** The three `.wgsl` forms, so the loader's extension claim can be asserted on all of them. */
const WGSL_ADDRESSES: readonly string[] = [
  "shaders/dissolve.wgsl",
  "shaders/snow.surface.wgsl",
  "shaders/vignette.post.wgsl",
];

describe("the shader loader", () => {
  it("claims every .wgsl form", async () => {
    const h = await app();
    for (const address of WGSL_ADDRESSES) {
      const handle = h.app.assets.load(address);
      expect({ address, type: handle.type }).toEqual({ address, type: SHADER_ASSET_TYPE });
    }
  });

  it("produces a ShaderAsset carrying the source and the declaration", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/tint.wgsl", { "shaders/tint.wgsl": TINT_WGSL });
    expect(shader).toBeInstanceOf(ShaderAsset);
    expect(shader.address).toBe("shaders/tint.wgsl");
    expect(shader.source).toBe(TINT_WGSL);
    expect(shader.kind).toBe("shader");
    expect(shader.declaration.uniforms.map((uniform) => uniform.name)).toEqual(["tint", "pulse"]);
  });

  it("reads the form out of the pragma, not the file name", async () => {
    const h = await app();
    const shader = await h.load<ShaderAsset>("shaders/snow.surface.wgsl", {
      "shaders/snow.surface.wgsl": "// @ignifx surface\n",
    });
    expect(shader.kind).toBe("surface");
  });

  it("fails the load when the pragmas are malformed", async () => {
    const h = await app();
    h.canned("shaders/broken.wgsl", "// @ignifx wobble\n");
    const handle = h.app.assets.load<ShaderAsset>("shaders/broken.wgsl");
    await expectRejection(handle.promise);
    expect(handle.state).toBe("failed");
    expect(String(handle.error?.cause)).toContain("IGX-0719");
  });
});

describe("the material loader's shader branch", () => {
  it("resolves the shader and the declared values", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/tint.material.json", {
      "materials/tint.material.json": TINT_MATERIAL_JSON,
      "shaders/tint.wgsl": TINT_WGSL,
    });
    expect(material.kind).toBe("shader");
    expect(material.shader?.address).toBe("shaders/tint.wgsl");
    expect(material.getUniform("pulse")).toBeCloseTo(0.5);
    const tint = material.getUniform("tint", new Float32Array(3));
    expect(tint instanceof Float32Array ? tint[2] : 0).toBeCloseTo(Color.srgbToLinear(1));
  });

  it("resolves a declared texture as a dependency", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/textured.material.json", {
      "materials/textured.material.json": JSON.stringify({
        format: "ignifx.material",
        formatVersion: 1,
        type: "shader",
        shader: "shaders/textured.wgsl",
        textures: { albedo: { $asset: "textures/noise.png" } },
        defines: { TINTED: true },
      }),
      "shaders/textured.wgsl": "// @ignifx shader\n// @ignifx texture albedo\n// @ignifx define TINTED = false\n",
      "textures/noise.png": "not a real png",
    });
    expect(material.kind).toBe("shader");
    expect(material.textures.map((handle) => handle.address)).toEqual(["textures/noise.png"]);
  });

  it("accepts a bare address string for a texture", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/textured.material.json", {
      "materials/textured.material.json": JSON.stringify({
        format: "ignifx.material",
        formatVersion: 1,
        type: "shader",
        shader: "shaders/textured.wgsl",
        textures: { albedo: "textures/noise.png" },
      }),
      "shaders/textured.wgsl": "// @ignifx shader\n// @ignifx texture albedo\n",
      "textures/noise.png": "not a real png",
    });
    expect(material.kind).toBe("shader");
  });

  it("fails the load when the file names no shader", async () => {
    const h = await app();
    h.canned(
      "materials/nothing.material.json",
      JSON.stringify({ format: "ignifx.material", formatVersion: 1, type: "shader" }),
    );
    const handle = h.app.assets.load<MaterialAsset>("materials/nothing.material.json");
    await expectRejection(handle.promise);
    expect(handle.state).toBe("failed");
    expect(String(handle.error?.cause)).toContain("IGX-0709");
  });

  it("fails the load when a value names an undeclared uniform", async () => {
    const h = await app();
    h.canned("shaders/tint.wgsl", TINT_WGSL);
    h.canned(
      "materials/wrong.material.json",
      JSON.stringify({
        format: "ignifx.material",
        formatVersion: 1,
        type: "shader",
        shader: "shaders/tint.wgsl",
        values: { wobble: 1 },
      }),
    );
    const handle = h.app.assets.load<MaterialAsset>("materials/wrong.material.json");
    await expectRejection(handle.promise);
    expect(handle.state).toBe("failed");
    expect(String(handle.error?.cause)).toContain("IGX-0712");
  });

  it("ignores a value of a shape JSON cannot express", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/tint.material.json", {
      "materials/tint.material.json": JSON.stringify({
        format: "ignifx.material",
        formatVersion: 1,
        type: "shader",
        shader: "shaders/tint.wgsl",
        values: { pulse: "loud" },
        textures: "nonsense",
        defines: 7,
      }),
      "shaders/tint.wgsl": TINT_WGSL,
    });
    expect(material.getUniform("pulse")).toBeCloseTo(0);
  });
});

describe("hot reload", () => {
  it("rebuilds every material built from a replaced shader", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/tint.material.json", {
      "materials/tint.material.json": TINT_MATERIAL_JSON,
      "shaders/tint.wgsl": TINT_WGSL,
    });
    const before = material.lite.material;
    h.canned("shaders/tint.wgsl", TINT_RELOADED_WGSL);
    h.app.assets.reload("shaders/tint.wgsl");
    await h.settle(1);
    expect(material.shader?.source).toBe(TINT_RELOADED_WGSL);
    expect(material.lite.material).not.toBe(before);
  });

  it("keeps the values a script had set", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/tint.material.json", {
      "materials/tint.material.json": TINT_MATERIAL_JSON,
      "shaders/tint.wgsl": TINT_WGSL,
    });
    material.setUniform("pulse", 0.75);
    h.canned("shaders/tint.wgsl", TINT_RELOADED_WGSL);
    h.app.assets.reload("shaders/tint.wgsl");
    await h.settle(1);
    expect(material.getUniform("pulse")).toBeCloseTo(0.75);
  });

  it("drops a binding the new declaration no longer has", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/tint.material.json", {
      "materials/tint.material.json": TINT_MATERIAL_JSON,
      "shaders/tint.wgsl": TINT_WGSL,
    });
    h.canned("shaders/tint.wgsl", "// @ignifx shader\n// @ignifx uniform pulse: f32 = 0\n");
    h.app.assets.reload("shaders/tint.wgsl");
    await h.settle(1);
    expect(() => {
      material.setUniform("tint", [1, 0, 0]);
    }).toThrow(/IGX-0712/);
    expect(material.getUniform("pulse")).toBeCloseTo(0.5);
  });

  it("keeps the previous material and reports IGX-0715 when Babylon Lite refuses the new source", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/tint.material.json", {
      "materials/tint.material.json": TINT_MATERIAL_JSON,
      "shaders/tint.wgsl": TINT_WGSL,
    });
    const before = material.lite.material;
    // The pragma parser is a strict superset of what Babylon Lite accepts, so no *file* reaches the
    // adapter and is then refused. The one way to exercise the branch is to deliver a replacement
    // whose declaration was not built by the parser: an empty attribute list, which Lite refuses
    // eagerly (`lib/material/shader/shader-material.js`, error 293).
    const handle = h.app.assets.get<ShaderAsset>("shaders/tint.wgsl");
    const declaration = { ...(material.shader?.declaration ?? emptyDeclaration()), attributes: [] };
    handle?.onReplaced.connect(() => undefined);
    replaceShader(handle, new ShaderAsset("shaders/tint.wgsl", TINT_WGSL, declaration));
    expect(material.lite.material).toBe(before);
    expect(h.errors.map((report) => String(report.error)).join(" ")).toContain("IGX-0715");
  });

  it("stops rebuilding once the material has been disposed", async () => {
    const h = await app();
    const material = await h.load<MaterialAsset>("materials/tint.material.json", {
      "materials/tint.material.json": TINT_MATERIAL_JSON,
      "shaders/tint.wgsl": TINT_WGSL,
    });
    const before = material.lite.material;
    material.dispose();
    h.canned("shaders/tint.wgsl", TINT_RELOADED_WGSL);
    h.app.assets.reload("shaders/tint.wgsl");
    await h.settle(1);
    expect(material.lite.material).toBe(before);
  });
});
