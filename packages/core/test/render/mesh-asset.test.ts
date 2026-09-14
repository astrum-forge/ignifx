import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { MeshGeometryData } from "../../src/render/mesh-asset.js";

/**
 * `MeshAsset.fromData`'s extra attributes and the four `update*` methods, without a device
 * (the plan's §2.2, `07-rendering.md` §6).
 *
 * A headless app uploads nothing, so what is asserted is the range arithmetic, the counts, and the
 * copy into the array Lite would have retained — the half a terrain sculpt depends on and the half
 * that is provable in Node. The GPU half (bounds, cloned-template refusal) is in the browser
 * suites.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a headless app.
 *
 * @returns The harness.
 */
async function build(): Promise<RenderHarness> {
  const running = await createRenderHarness();
  harness = running;
  return running;
}

/**
 * A two-triangle quad with every optional attribute filled in.
 *
 * @returns The geometry, whose arrays the caller keeps and edits.
 */
function quad(): MeshGeometryData {
  return {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    normals: Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs2: Float32Array.from([0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5]),
    tangents: Float32Array.from([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
    colors: Float32Array.from([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1]),
  };
}

/**
 * The `IGX-####` code an error carries.
 *
 * @param run - The call under test.
 * @returns The code, or `null` when nothing was thrown or it was not an `IgnifxError`.
 */
function codeOf(run: () => void): string | null {
  try {
    run();
  } catch (error) {
    return isIgnifxError(error) ? error.code : null;
  }
  return null;
}

describe("fromData", () => {
  it("accepts uvs2, tangents, and colors", async () => {
    const running = await build();
    using mesh = MeshAsset.fromData(running.app, "quad", quad());
    expect(mesh.value).toBeInstanceOf(MeshAsset);
    expect(mesh.state).toBe("loaded");
  });

  it("reports the vertex and index counts", async () => {
    const running = await build();
    using mesh = MeshAsset.fromData(running.app, "quad", quad());
    expect(mesh.value.vertexCount).toBe(4);
    expect(mesh.value.indexCount).toBe(6);
  });

  it("reports no counts for a primitive, whose arrays Lite never hands back", async () => {
    const running = await build();
    using box = MeshAsset.box(running.app, { size: 1 });
    expect(box.value.vertexCount).toBe(0);
    expect(box.value.indexCount).toBe(0);
  });
});

describe("updatePositions", () => {
  it("copies a whole-mesh write into the array Lite retained", async () => {
    const running = await build();
    const geometry = quad();
    using mesh = MeshAsset.fromData(running.app, "quad", geometry);
    const moved = Float32Array.from([0, 5, 0, 1, 5, 0, 1, 6, 0, 0, 6, 0]);
    mesh.value.updatePositions(moved);
    expect(Array.from(geometry.positions)).toEqual(Array.from(moved));
  });

  it("copies a partial write to the right offset", async () => {
    const running = await build();
    const geometry = quad();
    using mesh = MeshAsset.fromData(running.app, "quad", geometry);
    mesh.value.updatePositions(Float32Array.from([9, 9, 9]), 2, 1);
    expect(Array.from(geometry.positions.subarray(6, 9))).toEqual([9, 9, 9]);
    expect(Array.from(geometry.positions.subarray(0, 3))).toEqual([0, 0, 0]);
  });

  it("is a no-op copy when the caller mutated the retained array in place", async () => {
    const running = await build();
    const geometry = quad();
    using mesh = MeshAsset.fromData(running.app, "quad", geometry);
    geometry.positions[1] = 3;
    mesh.value.updatePositions(geometry.positions);
    expect(geometry.positions[1]).toBe(3);
  });

  it("refuses a range that runs past the last vertex with IGX-0725", async () => {
    const running = await build();
    using mesh = MeshAsset.fromData(running.app, "quad", quad());
    expect(codeOf(() => mesh.value.updatePositions(Float32Array.from([0, 0, 0]), 4, 1))).toBe("IGX-0725");
  });

  it("refuses a count the source array cannot supply with IGX-0725", async () => {
    const running = await build();
    using mesh = MeshAsset.fromData(running.app, "quad", quad());
    expect(codeOf(() => mesh.value.updatePositions(Float32Array.from([0, 0, 0]), 0, 2))).toBe("IGX-0725");
  });

  it("refuses a fractional offset with IGX-0725", async () => {
    const running = await build();
    using mesh = MeshAsset.fromData(running.app, "quad", quad());
    expect(codeOf(() => mesh.value.updatePositions(Float32Array.from([0, 0, 0]), 0.5, 1))).toBe("IGX-0725");
  });

  it("copies within one array when the caller hands back the retained one at an offset", async () => {
    const running = await build();
    const geometry = quad();
    using mesh = MeshAsset.fromData(running.app, "quad", geometry);
    // Vertex 0 is (0, 0, 0); writing it over vertex 2 must not disturb vertex 0 itself.
    mesh.value.updatePositions(geometry.positions, 2, 1);
    expect(Array.from(geometry.positions.subarray(6, 9))).toEqual([0, 0, 0]);
    expect(Array.from(geometry.positions.subarray(0, 3))).toEqual([0, 0, 0]);
  });

  it("accepts a zero-vertex range as a no-op", async () => {
    const running = await build();
    const geometry = quad();
    using mesh = MeshAsset.fromData(running.app, "quad", geometry);
    mesh.value.updatePositions(Float32Array.from([7, 7, 7]), 0, 0);
    expect(Array.from(geometry.positions.subarray(0, 3))).toEqual([0, 0, 0]);
  });

  it("refuses a primitive with IGX-0702, because ignifx never saw its arrays", async () => {
    const running = await build();
    using box = MeshAsset.box(running.app, { size: 1 });
    expect(codeOf(() => box.value.updatePositions(Float32Array.from([0, 0, 0])))).toBe("IGX-0702");
  });

  it("refuses a disposed asset with IGX-0702", async () => {
    const running = await build();
    const mesh = MeshAsset.fromData(running.app, "quad", quad());
    mesh.value.dispose();
    expect(codeOf(() => mesh.value.updatePositions(Float32Array.from([0, 0, 0]), 0, 1))).toBe("IGX-0702");
    mesh.release();
  });
});

describe("updateNormals, updateUvs, and updateColors", () => {
  it("each copy into their own retained array", async () => {
    const running = await build();
    const geometry = quad();
    using mesh = MeshAsset.fromData(running.app, "quad", geometry);
    mesh.value.updateNormals(Float32Array.from([0, 1, 0]), 0, 1);
    mesh.value.updateUvs(Float32Array.from([0.25, 0.75]), 1, 1);
    mesh.value.updateColors(Float32Array.from([0.1, 0.2, 0.3, 0.4]), 3, 1);
    expect(Array.from(geometry.normals.subarray(0, 3))).toEqual([0, 1, 0]);
    expect(Array.from(geometry.uvs?.subarray(2, 4) ?? [])).toEqual([0.25, 0.75]);
    expect(Array.from(geometry.colors?.subarray(12, 16) ?? []).map((v) => Math.round(v * 10) / 10)).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
  });

  it("validate their own component count, so a short colour write is refused", async () => {
    const running = await build();
    using mesh = MeshAsset.fromData(running.app, "quad", quad());
    expect(codeOf(() => mesh.value.updateColors(Float32Array.from([1, 1, 1]), 0, 1))).toBe("IGX-0725");
  });

  it("each refuse a primitive with IGX-0702", async () => {
    const running = await build();
    using box = MeshAsset.box(running.app, { size: 1 });
    expect(codeOf(() => box.value.updateNormals(Float32Array.from([0, 1, 0])))).toBe("IGX-0702");
    expect(codeOf(() => box.value.updateUvs(Float32Array.from([0, 0])))).toBe("IGX-0702");
    expect(codeOf(() => box.value.updateColors(Float32Array.from([1, 1, 1, 1])))).toBe("IGX-0702");
  });

  it("tolerate a mesh that declared no UVs or colours at all", async () => {
    const running = await build();
    const geometry: MeshGeometryData = {
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1]),
      indices: Uint32Array.from([0, 1, 2]),
    };
    using mesh = MeshAsset.fromData(running.app, "triangle", geometry);
    expect(() => {
      mesh.value.updateUvs(Float32Array.from([0, 0]), 0, 1);
      mesh.value.updateColors(Float32Array.from([1, 1, 1, 1]), 0, 1);
    }).not.toThrow();
  });
});
