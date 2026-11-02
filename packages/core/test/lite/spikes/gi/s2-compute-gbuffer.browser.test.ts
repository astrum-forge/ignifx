// Spike S2 (throwaway): a compute pass reading the scene depth and a G-buffer attachment.
// Lite's compute bindings take a Texture2D (createComputeTextureResource, index.d.ts 2810), while the
// geometry task exposes RenderTargets; this checks which bridges work.
import {
  addTask,
  addComputeDispatch,
  computeStorageBufferBinding,
  computeTextureBinding,
  createComputeBindingSet,
  createComputeDispatch,
  createComputeShader,
  createComputeTask,
  createComputeTextureResource,
  createCopyToTextureTask,
  createGeometryRendererTask,
  createStorageBuffer,
  createSurfaceRenderTargetTexture,
  GeometryTextureType,
  readStorageBuffer,
  registerScene,
  withSampledDepthTexture,
} from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { createSpikeScene, frames } from "./harness.js";

const PROBE_WGSL = /* wgsl */ `
@group(0) @binding(0) var depthTex: texture_depth_2d;
@group(0) @binding(1) var normalTex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> outBuf: array<f32>;
@compute @workgroup_size(1) fn main() {
  let centre = vec2<i32>(32, 32);
  outBuf[0] = textureLoad(depthTex, centre, 0);
  let n = textureLoad(normalTex, centre, 0);
  outBuf[1] = n.x;
  outBuf[2] = n.y;
  outBuf[3] = n.z;
  outBuf[4] = textureLoad(depthTex, vec2<i32>(0, 0), 0);
  let top = textureLoad(normalTex, vec2<i32>(32, 20), 0);
  outBuf[5] = top.y;
}
`;

describe("spike S2: compute reads scene depth and a G-buffer attachment", () => {
  it("binds a sampled depth facade and a copied world-normal attachment into a compute pass", async () => {
    const spike = await createSpikeScene(64, 1);
    try {
      const { engine, scene } = spike;
      // Depth we own: an eager surface-sized target with a sampled depth facade (Texture2D).
      const depth = createSurfaceRenderTargetTexture(
        engine,
        { lbl: "spike:depth", dFormat: "depth32float", samples: 1, size: engine },
        withSampledDepthTexture,
      );
      const geometry = createGeometryRendererTask(
        {
          name: "spike:gbuffer",
          size: engine,
          depthTexture: depth.rt,
          textureDescriptions: [{ type: GeometryTextureType.WORLD_NORMAL }],
        },
        engine,
        scene,
      );
      addTask(scene, geometry);
      // The world-normal attachment is task-owned and exposed only as a RenderTarget, so copy it into a
      // target that also has a Texture2D facade.
      const normals = createSurfaceRenderTargetTexture(engine, {
        lbl: "spike:normals",
        format: "rgba16float",
        samples: 1,
        size: engine,
      });
      const worldNormal = geometry.geometryWorldNormalTexture;
      if (worldNormal === null) throw new Error("no world-normal attachment");
      addTask(
        scene,
        createCopyToTextureTask({ name: "spike:copy-normals", sourceTexture: worldNormal, targetTexture: normals.rt }, engine, scene),
      );

      if (depth.depthTexture === null) throw new Error("no sampled depth facade");
      const depthResource = await createComputeTextureResource(engine, depth.depthTexture, { sampleType: "depth" });
      const normalResource = await createComputeTextureResource(engine, normals.texture);
      const out = createStorageBuffer(engine, 32, { label: "spike:out", writable: true });
      const shader = createComputeShader(engine, {
        name: "spike:probe",
        computeSource: PROBE_WGSL,
        bindings: [
          computeTextureBinding("depthTex", { group: 0, binding: 0, sampleType: "depth" }),
          computeTextureBinding("normalTex", { group: 0, binding: 1 }),
          computeStorageBufferBinding("outBuf", { group: 0, binding: 2, access: "read-write" }),
        ],
      });
      const task = createComputeTask(engine, "spike:compute");
      addComputeDispatch(
        task,
        createComputeDispatch(
          shader,
          createComputeBindingSet(shader, { depthTex: depthResource, normalTex: normalResource, outBuf: out }),
          { size: { x: 1 } },
        ),
      );
      addTask(scene, task);
      await registerScene(scene);
      await frames(engine, 8);
      const values = [...new Float32Array(await readStorageBuffer(out))];
      console.log(`[S2] depth(centre)=${String(values[0])} normal(centre)=${JSON.stringify(values.slice(1, 4))} depth(corner)=${String(values[4])} normal(top).y=${String(values[5])}`);
      // Reverse-Z: the sphere is nearer than the far plane (0) at the centre.
      expect(values[0]).toBeGreaterThan(0);
      expect(values[4]).toBe(0);
      // WORLD_NORMAL is stored encoded as n * 0.5 + 0.5.
      const decode = (v: number | undefined): number => (v ?? 0) * 2 - 1;
      const length = Math.hypot(decode(values[1]), decode(values[2]), decode(values[3]));
      expect(length).toBeGreaterThan(0.9);
    } finally {
      spike.dispose();
    }
  }, 60_000);
});
