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

/** How many entities the scene builds. The name of the scene is the contract. */
export const ENTITY_COUNT = 1000;

/**
 * A thousand entities, each with a `MeshRenderer` and a `Rotator`, sharing one mesh and one
 * material. This is the scene the allocation budget is judged on (coding standards §7): every
 * frame it touches a thousand transforms, a thousand script callbacks, and a thousand component
 * syncs, so anything that allocates per entity per frame shows up as heap growth here and nowhere
 * else.
 *
 * @returns The running scene.
 */
export async function createThousandEntitiesScene(): Promise<BenchScene> {
  const app = await createApp({ headless: true, clock: createManualClock(), logLevel: "silent" });
  app.registerComponents([Rotator]);

  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 30, -60);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 500, fov: 60 });

  const sun = app.world.createEntity("Sun");
  sun.transform.localPosition.set(-30, 60, -30);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  sun.addComponent(Light, { type: "directional", intensity: 3 });

  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "bench", baseColor: { r: 0.8, g: 0.5, b: 0.2, a: 1 }, roughness: 0.6 }),
    [],
  );
  const mesh = MeshAsset.box(app, { size: 0.8 });

  const side = 32;
  const spacing = 1.6;
  for (let index = 0; index < ENTITY_COUNT; index += 1) {
    const entity = app.world.createEntity(`Cube ${String(index)}`);
    const column = index % side;
    const row = Math.floor(index / side);
    entity.transform.localPosition.set((column - side / 2) * spacing, 0, (row - side / 2) * spacing);
    entity.addComponent(MeshRenderer, { mesh, materials: [material] });
    entity.addComponent(Rotator, { speed: 30 + (index % 60) });
  }

  await app.start();
  return {
    name: "thousand-entities",
    app,
    dispose: () => {
      app.dispose();
    },
  };
}
