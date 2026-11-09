import {
  addComputeDispatch,
  addTask,
  buildFrameGraphTask,
  computeStorageBufferBinding,
  computeTextureBinding,
  createComputeBindingSet,
  createComputeDispatch,
  createComputeShader,
  createComputeTask,
  createComputeTextureResource,
  createStorageBuffer,
  getFrameGraph,
  readStorageBuffer,
} from "@babylonjs/lite";
import { afterEach, describe, expect, it } from "vitest";
import { frameGraphTasks, SCENE_INPUT_FORMATS, SCENE_INPUT_TASK_NAMES } from "../../../src/lite/gpu/scene-inputs.js";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../../src/render/material-asset.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import { createBrowserApp, gpuDeviceErrors, settle, SETTLE_FRAMES } from "../../render/support/browser-harness.js";
import type { SceneInputs } from "../../../src/lite/gpu/scene-inputs.js";
import type { BrowserApp } from "../../render/support/browser-harness.js";
import type { Texture2D } from "@babylonjs/lite";

/**
 * Shared scene inputs on a real device (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G4;
 * `docs/architecture/07-rendering.md` §2.12): one geometry pass, added by the first effect that asks
 * and removed by the last release.
 */

/** The canvas edge. Small keeps SwiftShader fast. */
const SIZE = 48;

const INPUT_NAMES: readonly string[] = Object.values(SCENE_INPUT_TASK_NAMES);

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * The hello-cube scene: a white 2 m box at the origin, a camera 4 m back looking down `+Z`.
 *
 * @returns The running app.
 */
async function buildCubeScene(): Promise<{ readonly running: BrowserApp }> {
  const running = await createBrowserApp({ size: SIZE });
  harness = running;
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -4);
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1 });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world
    .createEntity("Cube")
    .addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [material] });
  await settle(running);
  return { running };
}

/**
 * The names of the tasks in the scene's frame graph.
 *
 * @param running - The running app.
 * @returns The names, in execution order.
 */
function taskNames(running: BrowserApp): string[] {
  const tasks = frameGraphTasks(running.renderer.scene);
  if (tasks === null) {
    throw new Error("Lite no longer exposes the frame graph's task list");
  }
  return tasks.map((task) => task.name);
}

/**
 * Leases the inputs, failing the test when the renderer returns none.
 *
 * @param running - The running app.
 * @returns The lease.
 */
async function acquire(running: BrowserApp): Promise<SceneInputs> {
  const inputs = await running.renderer.acquireSceneInputs();
  if (inputs === null) {
    throw new Error("the renderer returned no scene inputs");
  }
  return inputs;
}

/**
 * Reads one texel of a depth and a colour texture with a one-off compute pass, the way spike S2 did:
 * the depth target carries no `COPY_SRC`.
 *
 * @param running - The running app.
 * @param depth - A `depth32float` texture.
 * @param colour - An `rgba16float` (or other float) texture.
 * @param x - The texel column.
 * @param y - The texel row.
 * @returns `[depth, r, g, b]`.
 */
async function readTexel(
  running: BrowserApp,
  depth: Texture2D,
  colour: Texture2D,
  x: number,
  y: number,
): Promise<number[]> {
  const engine = running.renderer.engine;
  const shader = createComputeShader(engine, {
    name: "test:scene-inputs-probe",
    computeSource: `
@group(0) @binding(0) var depthTex: texture_depth_2d;
@group(0) @binding(1) var colourTex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> outBuf: array<f32>;
@compute @workgroup_size(1) fn main() {
  let at = vec2<i32>(${String(x)}, ${String(y)});
  outBuf[0] = textureLoad(depthTex, at, 0);
  let c = textureLoad(colourTex, at, 0);
  outBuf[1] = c.x;
  outBuf[2] = c.y;
  outBuf[3] = c.z;
}`,
    bindings: [
      computeTextureBinding("depthTex", { group: 0, binding: 0, sampleType: "depth" }),
      computeTextureBinding("colourTex", { group: 0, binding: 1, sampleType: "unfilterable-float" }),
      computeStorageBufferBinding("outBuf", { group: 0, binding: 2, access: "read-write" }),
    ],
  });
  const out = createStorageBuffer(engine, 16, { label: "test:scene-inputs-out", writable: true });
  const task = createComputeTask(engine, "test:scene-inputs-probe");
  addComputeDispatch(
    task,
    createComputeDispatch(
      shader,
      createComputeBindingSet(shader, {
        depthTex: await createComputeTextureResource(engine, depth, { sampleType: "depth" }),
        colourTex: await createComputeTextureResource(engine, colour, { sampleType: "unfilterable-float" }),
        outBuf: out,
      }),
      { size: { x: 1 } },
    ),
  );
  // Appended: it runs after the scene inputs, which sit at the start of the graph.
  addTask(running.renderer.scene, task);
  buildFrameGraphTask(getFrameGraph(running.renderer.scene), task);
  await running.advance(3);
  task.executionEnabled = false;
  return [...new Float32Array(await readStorageBuffer(out))];
}

describe("scene inputs", () => {
  it("adds no task and loads nothing until an effect asks", async () => {
    const { running } = await buildCubeScene();
    expect(taskNames(running).filter((name) => INPUT_NAMES.includes(name))).toEqual([]);
    expect(running.renderer.sceneInputsUserCount).toBe(0);
  }, 60_000);

  it("builds depth, normals, velocity and a depth pyramid at the surface size", async () => {
    const device = gpuDeviceErrors();
    try {
      const { running } = await buildCubeScene();
      const inputs = await acquire(running);
      await settle(running);
      expect(taskNames(running).filter((name) => INPUT_NAMES.includes(name))).toEqual(INPUT_NAMES);
      const width = running.canvas.width;
      const height = running.canvas.height;
      expect(inputs.depth.texture.format).toBe(SCENE_INPUT_FORMATS.depth);
      expect(inputs.normals.texture.format).toBe(SCENE_INPUT_FORMATS.normals);
      expect(inputs.velocity.texture.format).toBe(SCENE_INPUT_FORMATS.velocity);
      expect(inputs.depthPyramid.texture.format).toBe(SCENE_INPUT_FORMATS.depthPyramid);
      for (const texture of [inputs.depth, inputs.normals, inputs.velocity, inputs.depthPyramid]) {
        expect([texture.texture.width, texture.texture.height]).toEqual([width, height]);
      }
      expect(inputs.depthPyramidMipCount).toBe(Math.floor(Math.log2(Math.max(width, height))) + 1);
      expect(inputs.depthPyramid.texture.mipLevelCount).toBe(inputs.depthPyramidMipCount);
      expect(running.errors).toEqual([]);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 60_000);

  it("reads a plausible depth and a facing normal at the centre of hello-cube", async () => {
    const { running } = await buildCubeScene();
    const inputs = await acquire(running);
    await settle(running);
    const centre = SIZE >> 1;
    const [depth = 0, nx = 0, ny = 0, nz = 0] = await readTexel(running, inputs.depth, inputs.normals, centre, centre);
    // Reverse-Z with an infinite-ish far plane: the front face at 3 m, near 0.1 m, is a small positive value.
    expect(depth).toBeGreaterThan(0.01);
    expect(depth).toBeLessThan(0.1);
    // The front face looks back at the camera along -Z; normals are stored as n * 0.5 + 0.5.
    expect(nx * 2 - 1).toBeCloseTo(0, 1);
    expect(ny * 2 - 1).toBeCloseTo(0, 1);
    expect(nz * 2 - 1).toBeLessThan(-0.9);
    const [cornerDepth] = await readTexel(running, inputs.depth, inputs.normals, 0, 0);
    expect(cornerDepth).toBe(0);
  }, 60_000);

  it("writes velocity while the camera moves, and none for the background", async () => {
    // Lite 1.34's PBR geometry view reprojects through the previous view-projection only
    // (`pbr-geometry-output-shader.js` line 41), so a moving PBR object over a still camera writes
    // 0; camera motion is what this checks.
    const { running } = await buildCubeScene();
    const inputs = await acquire(running);
    await settle(running);
    const eye = running.world.findByName("Main Camera");
    if (eye === null) {
      throw new Error("no camera");
    }
    // A sawtooth at 0.6 m/s keeps the box over the centre pixel while the camera slides.
    const moving = setInterval(() => {
      eye.transform.localPosition.set(((performance.now() / 1000) % 1) * 0.6 - 0.3, 0, -4);
    }, 4);
    try {
      await running.advance(4);
      const centre = SIZE >> 1;
      const [, vx = 0, vy = 0] = await readTexel(running, inputs.depth, inputs.velocity, centre, centre);
      expect(Math.abs(vx)).toBeGreaterThan(1e-4);
      expect(Math.abs(vy)).toBeLessThan(Math.abs(vx));
      const [, bx = 1, by = 1] = await readTexel(running, inputs.depth, inputs.velocity, 0, 0);
      expect([bx, by]).toEqual([0, 0]);
    } finally {
      clearInterval(moving);
    }
  }, 60_000);

  it("shares one pass between two users and removes it after the last release", async () => {
    const { running } = await buildCubeScene();
    const before = taskNames(running);
    const first = await acquire(running);
    const second = await acquire(running);
    expect(running.renderer.sceneInputsUserCount).toBe(2);
    expect(second.depth).toBe(first.depth);
    expect(taskNames(running).filter((name) => name === SCENE_INPUT_TASK_NAMES.geometry)).toHaveLength(1);
    await settle(running);

    first.release();
    first.release();
    expect(running.renderer.sceneInputsUserCount).toBe(1);
    expect(taskNames(running)).toContain(SCENE_INPUT_TASK_NAMES.geometry);

    second.release();
    expect(running.renderer.sceneInputsUserCount).toBe(0);
    expect(second.isReleased).toBe(true);
    expect(taskNames(running)).toEqual(before);
    await settle(running);
    expect(running.errors).toEqual([]);

    // A new user after the last release gets a fresh pass.
    const third = await acquire(running);
    await settle(running);
    expect(taskNames(running).filter((name) => INPUT_NAMES.includes(name))).toEqual(INPUT_NAMES);
    third.release();
  }, 60_000);

  it("rebuilds at the new size when the canvas grows", async () => {
    const device = gpuDeviceErrors();
    try {
      const { running } = await buildCubeScene();
      const inputs = await acquire(running);
      let changes = 0;
      inputs.onChange(() => {
        changes += 1;
      });
      await settle(running);
      const pyramidBefore = inputs.depthPyramid;

      // Lite's loop snaps a laid-out canvas to its CSS box, which rebuilds the frame graph.
      const grown = SIZE * 2;
      running.canvas.style.width = `${String(grown)}px`;
      running.canvas.style.height = `${String(grown)}px`;
      await settle(running, SETTLE_FRAMES * 2);

      const width = running.canvas.width;
      expect(width).toBeGreaterThan(SIZE);
      expect(changes).toBeGreaterThan(0);
      expect(inputs.depthPyramid).not.toBe(pyramidBefore);
      for (const texture of [inputs.depth, inputs.normals, inputs.velocity, inputs.depthPyramid]) {
        expect(texture.texture.width).toBe(width);
      }
      const [depth = 0] = await readTexel(
        running,
        inputs.depth,
        inputs.normals,
        width >> 1,
        running.canvas.height >> 1,
      );
      expect(depth).toBeGreaterThan(0.01);
      expect(running.errors).toEqual([]);
      expect(device.errors).toEqual([]);
      inputs.release();
    } finally {
      device.stop();
    }
  }, 60_000);

  it("releases every lease when the app is disposed", async () => {
    const { running } = await buildCubeScene();
    const inputs = await acquire(running);
    running.dispose();
    harness = null;
    expect(inputs.isReleased).toBe(true);
    expect(await running.renderer.acquireSceneInputs()).toBeNull();
  }, 60_000);
});
