/**
 * Spawn a prefab
 *
 * A prefab is a scene file (ADR-0005): the same `ignifx.scene` format, loaded as a `SceneAsset` and
 * stamped out with `world.instantiate`. Instantiation is synchronous, because a `SceneAsset` arrives
 * with every asset it references already loaded; each copy gets fresh uids and a `prefab` link back
 * to the file.
 *
 * Register every component the file names before loading it, or the entity is built without them
 * and the load reports `IGX-0307`.
 *
 * The prefab used here is `crate.prefab.json`, beside this file.
 */
import { Script, createApp, f32 } from "@ignifx/core";
import type { AssetHandle, Entity, SceneAsset, ScriptCallbacks } from "@ignifx/core";

/** Bobs its entity up and down. `speed` is a serialized field the prefab file sets. */
class Bobber extends Script.define({ speed: f32(1.5) }) implements ScriptCallbacks {
  static typeId = "recipes/Bobber";

  #elapsed = 0;

  update(dt: number): void {
    this.#elapsed += dt;
    this.transform.localPosition.y = 0.5 + Math.sin(this.#elapsed * this.speed) * 0.2;
  }
}

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}

const app = await createApp({ canvas, settings: { assets: { root: "assets" } } });
app.registerComponents([Bobber]);

const crate: AssetHandle<SceneAsset> = await app.assets.loadAsync<SceneAsset>("prefabs/crate.prefab.json");

const spawned: Entity[] = [];

/**
 * Stamps one copy of the prefab into the active scene.
 *
 * @param x - Where to put it along the world X axis, in metres.
 * @returns The instance root — one entity, even when the file has several roots.
 */
function spawn(x: number): Entity {
  const root = app.world.instantiate(crate.value, {
    name: `Crate ${String(spawned.length)}`,
    position: { x, y: 0, z: 0 },
  });
  spawned.push(root);
  return root;
}

for (let index = 0; index < 5; index += 1) {
  spawn(index * 1.5 - 3);
}

await app.start();

// Instances outlive the handle: releasing only stops the template from being cached.
window.addEventListener("pagehide", () => {
  for (const root of spawned) {
    root.destroy();
  }
  crate.release();
  app.dispose();
});
