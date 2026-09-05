import {
  Camera,
  createApp,
  createManualClock,
  createMaterialAsset,
  Light,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
} from "@ignifx/core";
import { Rotator } from "./rotator.ts";
import type { BenchScene } from "./types.ts";

/**
 * The `examples/hello-cube` scene, headless: a camera, a directional light, a ground plane, and one
 * spinning PBR cube. It is the floor of the frame-time table — whatever this costs, every scene
 * costs at least that.
 *
 * `headless: true` puts Lite on its null engine, so the numbers are CPU only: component sync,
 * transforms, scripts, and the scheduler. GPU time is the browser job's to measure.
 *
 * @returns The running scene.
 */
export async function createHelloCubeScene(): Promise<BenchScene> {
  const app = await createApp({ headless: true, clock: createManualClock(), logLevel: "silent" });
  app.registerComponents([Rotator]);

  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 2.6, -4.5);
  eye.transform.lookAt({ x: 0, y: 0.65, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 55 });

  const sun = app.world.createEntity("Sun");
  sun.transform.localPosition.set(-3.2, 6, -3.5);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  sun.addComponent(Light, { type: "directional", intensity: 3.2 });

  const slate = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "slate", baseColor: { r: 0.22, g: 0.24, b: 0.29, a: 1 }, roughness: 0.95 }),
    [],
  );
  app.world.createEntity("Ground").addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(app, { width: 24, height: 24, subdivisions: 1 }),
    materials: [slate],
    castShadows: false,
    receiveShadows: true,
  });

  const ember = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "ember", baseColor: { r: 0.93, g: 0.42, b: 0.16, a: 1 }, roughness: 0.35 }),
    [],
  );
  const cube = app.world.createEntity("Cube");
  cube.transform.localPosition.set(0, 0.65, 0);
  cube.addComponent(MeshRenderer, { mesh: MeshAsset.box(app, { size: 1.3 }), materials: [ember] });
  cube.addComponent(Rotator, { speed: 45 });

  await app.start();
  return {
    name: "hello-cube",
    app,
    dispose: () => {
      app.dispose();
    },
  };
}
