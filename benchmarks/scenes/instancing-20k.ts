import {
  Camera,
  createApp,
  createManualClock,
  createMaterialAsset,
  InstancedMeshRenderer,
  Light,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
} from "@ignifx/core";
import type { BenchScene } from "./types.ts";

/**
 * Twenty thousand instances of one box through a single `InstancedMeshRenderer`, plus a static slab
 * under a static camera — the plan's §6.3 `instancing-20k` row.
 *
 * The invariant it pins: a frame in which nothing moved costs nothing per instance. The slab is
 * written once, before `app.start()`, and never touched again, so what a frame costs is the
 * component's own reconciliation — which must not scale with the 20,000 instances behind it. One
 * plain `MeshRenderer` (the ground) is kept so the number stays comparable with `hello-cube`'s.
 *
 * Headless, so this is the CPU half; the one-draw-call claim is asserted in
 * `packages/core/test/lite/render/instancing.browser.test.ts`. Registering `InstancedMeshRenderer`
 * explicitly is a no-op — `ComponentRegistry.register` only rejects a *different* class under the
 * same type id — so the line is correct whether or not the core extension already did it.
 */

/** How many instances the scene draws. The name of the scene is the contract. */
export const INSTANCE_COUNT = 20_000;

/** How many floats one instance matrix occupies. */
const MATRIX_FLOATS = 16;

/** Metres between neighbouring instances. */
const SPACING = 0.8;

/**
 * Builds the static matrix slab: a square grid on the XZ plane, centred on the origin.
 *
 * @param count - How many instances to place.
 * @returns The slab, 16 column-major floats per instance.
 */
function buildSlab(count: number): Float32Array {
  const slab = new Float32Array(count * MATRIX_FLOATS);
  const side = Math.ceil(Math.sqrt(count));
  const half = (side - 1) * SPACING * 0.5;
  for (let index = 0; index < count; index += 1) {
    const base = index * MATRIX_FLOATS;
    slab[base] = 1;
    slab[base + 5] = 1;
    slab[base + 10] = 1;
    slab[base + 15] = 1;
    slab[base + 12] = (index % side) * SPACING - half;
    slab[base + 14] = Math.floor(index / side) * SPACING - half;
  }
  return slab;
}

/**
 * A headless scene holding 20,000 instances behind one renderer.
 *
 * @returns The running scene.
 */
export async function createInstancing20kScene(): Promise<BenchScene> {
  const app = await createApp({ headless: true, clock: createManualClock(), logLevel: "silent" });
  app.registerComponents([InstancedMeshRenderer]);

  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 40, -80);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 500, fov: 60 });

  const sun = app.world.createEntity("Sun");
  sun.transform.localPosition.set(-30, 60, -30);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  sun.addComponent(Light, { type: "directional", intensity: 3 });

  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "asteroid", baseColor: { r: 0.6, g: 0.6, b: 0.65, a: 1 }, roughness: 0.8 }),
    [],
  );

  const slab = MeshAsset.ground(app, { width: 200, height: 200, subdivisions: 1 });
  const ground = app.world.createEntity("Ground");
  ground.addComponent(MeshRenderer, { mesh: slab, materials: [material] });

  const box = MeshAsset.box(app, { size: 0.5 });
  const cloud = app.world.createEntity("Asteroids");
  const renderer = cloud.addComponent(InstancedMeshRenderer, {
    mesh: box,
    materials: [material],
    capacity: INSTANCE_COUNT,
    gpuCulling: true,
    castShadows: false,
  });
  renderer.setMatrices(buildSlab(INSTANCE_COUNT), INSTANCE_COUNT);

  await app.start();
  return {
    name: "instancing-20k",
    app,
    dispose: () => {
      app.dispose();
    },
  };
}
