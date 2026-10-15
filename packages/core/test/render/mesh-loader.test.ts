import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MESH_PRIMITIVE_OPTIONS, meshFileJsonSchema, readMeshFile } from "../../src/render/mesh-file.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { describeSchemas } from "../../src/render/schemas.js";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { buildFile, entityRecord } from "../serialization/fixtures.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { AssetHandle } from "../../src/assets/types.js";
import type { MeshPrimitive } from "../../src/render/mesh-asset.js";

/**
 * The `.mesh.json` loader (ADR-0029): a file names a primitive and its options, and a scene file
 * can then name the mesh by address with no code publishing it first.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A headless app with the render layer registered.
 *
 * @returns The harness.
 */
async function app(): Promise<RenderHarness> {
  harness = await createRenderHarness();
  return harness;
}

/**
 * Serves a mesh file at an address, retries included.
 *
 * @param h - The harness.
 * @param address - The address.
 * @param body - The file, as an object or as raw text.
 */
function serve(h: RenderHarness, address: string, body: unknown): void {
  h.net.canned.set(h.app.assets.resolveUrl(address), typeof body === "string" ? body : JSON.stringify(body));
}

/**
 * A mesh file body.
 *
 * @param fields - The fields after the header.
 * @returns The file.
 */
function meshFile(fields: Record<string, unknown>): Record<string, unknown> {
  return { format: "ignifx.mesh", formatVersion: 1, ...fields };
}

/**
 * Runs frames until a handle settles. Each frame advances a whole second, so a failed load's retry
 * backoff elapses.
 *
 * @param h - The harness.
 * @param handle - The handle to wait for.
 */
async function settled(h: RenderHarness, handle: AssetHandle): Promise<void> {
  for (let attempt = 0; attempt < 8 && handle.state === "loading"; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each frame depends on the one before
    await h.settle(1);
  }
}

/**
 * The code of the error a failed load was caused by.
 *
 * @param handle - The failed handle.
 * @returns The cause's code.
 */
function causeCode(handle: AssetHandle): string | null {
  const cause = handle.error?.cause;
  return isIgnifxError(cause) ? cause.code : null;
}

/** One file per primitive, with every option the primitive takes set. */
const EVERY_PRIMITIVE: readonly (readonly [MeshPrimitive, Record<string, unknown>])[] = [
  ["box", { size: 1, width: 2, height: 3, depth: 4 }],
  ["sphere", { diameter: 2, segments: 16 }],
  ["plane", { size: 1, width: 2, height: 3 }],
  ["ground", { width: 24, height: 24, subdivisions: 1, uvScale: [10, 10] }],
  ["cylinder", { height: 2, diameter: 1, diameterTop: 0, diameterBottom: 1, tessellation: 12 }],
  ["capsule", { height: 2, radius: 0.5, tessellation: 12 }],
  ["torus", { diameter: 2, thickness: 0.25, tessellation: 24 }],
];

describe("the mesh loader", () => {
  it("claims .mesh.json addresses as the mesh type", async () => {
    const h = await app();
    serve(h, "meshes/a.mesh.json", meshFile({ primitive: "box" }));
    expect(h.app.assets.load("meshes/a.mesh.json").type).toBe("mesh");
  });

  it.each(EVERY_PRIMITIVE)("loads a %s headlessly", async (primitive, options) => {
    const h = await app();
    const address = `meshes/${primitive}.mesh.json`;
    serve(h, address, meshFile({ primitive, options }));
    const handle = h.app.assets.load<MeshAsset>(address);
    await settled(h, handle);
    expect(handle.state).toBe("loaded");
    expect(handle.value).toBeInstanceOf(MeshAsset);
    expect(handle.value.name).toBe(address);
    // A headless app uploads no geometry, the same as MeshAsset.box(app).
    expect(handle.value.lite.mesh).toBeNull();
    handle.release();
  });

  it("covers every primitive the factories build", () => {
    expect(EVERY_PRIMITIVE.map(([primitive]) => primitive)).toEqual(Object.keys(MESH_PRIMITIVE_OPTIONS));
  });

  it("takes the factory defaults when options are left out, and the file's name when it gives one", async () => {
    const h = await app();
    serve(h, "meshes/ball.mesh.json", meshFile({ primitive: "sphere", name: "Ball" }));
    const handle = await h.app.assets.loadAsync<MeshAsset>("meshes/ball.mesh.json");
    expect(handle.value.name).toBe("Ball");
    handle.release();
  });

  it("disposes the mesh once the last holder lets go", async () => {
    const h = await app();
    h.app.assets.gcDelay = 0;
    serve(h, "meshes/crate.mesh.json", meshFile({ primitive: "box", options: { size: 1 } }));
    const handle = await h.app.assets.loadAsync<MeshAsset>("meshes/crate.mesh.json");
    const mesh = handle.value;
    handle.release();
    h.app.assets.gc();
    expect(mesh.isDisposed).toBe(true);
  });

  it.each([
    ["a negative length", { primitive: "box", options: { size: -1 } }],
    ["a length that is not a number", { primitive: "box", options: { width: "2" } }],
    ["a fractional count", { primitive: "sphere", options: { segments: 2.5 } }],
    ["a zero count", { primitive: "cylinder", options: { tessellation: 0 } }],
    ["a uvScale that is not a pair", { primitive: "ground", options: { uvScale: [1, 2, 3] } }],
    ["an option the primitive does not take", { primitive: "sphere", options: { size: 1 } }],
    ["an unknown primitive", { primitive: "teapot" }],
    ["no primitive", { options: { size: 1 } }],
    ["options that are not an object", { primitive: "box", options: [1] }],
    ["an unknown top-level field", { primitive: "box", colour: "red" }],
    ["a name that is not a string", { primitive: "box", name: 3 }],
  ])("refuses %s with IGX-0507", async (_label, fields) => {
    const h = await app();
    serve(h, "meshes/bad.mesh.json", meshFile(fields));
    const handle = h.app.assets.load<MeshAsset>("meshes/bad.mesh.json");
    await settled(h, handle);
    expect(handle.state).toBe("failed");
    expect(causeCode(handle)).toBe(CoreErrorCode.invalidMeshFile);
  });

  it("refuses a file with no ignifx.mesh header as IGX-0709", async () => {
    const h = await app();
    serve(h, "meshes/bad.mesh.json", { primitive: "box" });
    const handle = h.app.assets.load<MeshAsset>("meshes/bad.mesh.json");
    await settled(h, handle);
    expect(causeCode(handle)).toBe(CoreErrorCode.invalidAssetFile);
  });

  it("refuses a file with no format version as IGX-0603", () => {
    expect(() => readMeshFile({ format: "ignifx.mesh", primitive: "box" }, "meshes/a.mesh.json")).toThrow(/IGX-0603/u);
  });

  it("refuses an unreadable format version as IGX-0603", async () => {
    const h = await app();
    serve(h, "meshes/future.mesh.json", { format: "ignifx.mesh", formatVersion: 2, primitive: "box" });
    const handle = h.app.assets.load<MeshAsset>("meshes/future.mesh.json");
    await settled(h, handle);
    expect(causeCode(handle)).toBe(CoreErrorCode.unsupportedFormatVersion);
  });

  it("says which option is wrong", () => {
    expect(() =>
      readMeshFile(meshFile({ primitive: "sphere", options: { diamter: 2 } }), "meshes/ball.mesh.json"),
    ).toThrow(/meshes\/ball\.mesh\.json.*"diamter".*diameter, segments/u);
  });
});

describe("a scene file that names a mesh file", () => {
  /** A level with one cube whose mesh is a file, not a primitive published in code. */
  const LEVEL = buildFile({
    name: "level",
    entities: [
      entityRecord({
        uid: "CUBE",
        name: "Cube",
        components: [
          {
            uid: "CUBE-MR",
            type: "ignifx/MeshRenderer",
            props: { mesh: { $asset: "meshes/cube.mesh.json" } },
          },
        ],
      }),
    ],
  });

  it("loads, resolves the mesh, and survives a render sync with no code publishing it", async () => {
    const h = await app();
    serve(h, "meshes/cube.mesh.json", meshFile({ primitive: "box", options: { size: 1 } }));
    serve(h, "levels/one.scene.json", stringifySceneFile(LEVEL));
    const instance = await h.app.world.loadScene("levels/one.scene.json");
    const cube = instance.roots[0];
    const renderer = cube?.getComponent(MeshRenderer);
    expect(renderer?.mesh?.address).toBe("meshes/cube.mesh.json");
    expect(renderer?.mesh?.state).toBe("loaded");
    expect(renderer?.mesh?.value).toBeInstanceOf(MeshAsset);
    h.frame();
    expect(h.errors).toEqual([]);
    // Headless: nothing to clone, and the component keeps its state.
    expect(renderer?.lite.mesh).toBeNull();
    await h.app.world.unloadScene(instance);
  });

  it("saves the mesh back as its address rather than as null", async () => {
    const h = await app();
    serve(h, "meshes/cube.mesh.json", meshFile({ primitive: "box" }));
    serve(h, "levels/one.scene.json", stringifySceneFile(LEVEL));
    const instance = await h.app.world.loadScene("levels/one.scene.json");
    const issues: string[] = [];
    const saved = serializeScene(instance, { onIssue: (issue) => issues.push(issue.code) });
    expect(saved.entities[0]?.components?.[0]?.props?.["mesh"]).toMatchObject({ $asset: "meshes/cube.mesh.json" });
    expect(issues).toEqual([]);
    await h.app.world.unloadScene(instance);
  });
});

describe("the mesh file schemas", () => {
  it("lists the format for the documentation harness", () => {
    expect(describeSchemas()["ignifx/mesh-file"]?.format).toBe("ignifx.mesh");
  });

  it("gives every primitive a branch whose options match the table", () => {
    const schema = meshFileJsonSchema();
    const branches = schema["oneOf"];
    expect(Array.isArray(branches) ? branches.length : 0).toBe(Object.keys(MESH_PRIMITIVE_OPTIONS).length);
    expect(JSON.stringify(schema)).toContain('"uvScale":{"$ref":"#/$defs/pair"}');
  });
});
