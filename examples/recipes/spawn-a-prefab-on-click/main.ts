/**
 * Spawn a prefab on click
 *
 * A click is a ray. `camera.screenToRay` turns the pointer's pixel into a world-space ray,
 * `app.physics.raycast` reports what it hits, and `world.instantiate` stamps the prefab out at the
 * hit point. Instantiation is synchronous — a `SceneAsset` arrives with every asset it references
 * already loaded — so the prop exists before `update` returns and falls from the next fixed step.
 *
 * Both halves of the click agree on one space: `<Pointer>/position` reports backing-store pixels,
 * which is exactly what `screenToRay` reads, so nothing is converted between them. A physics query
 * needs one completed fixed step before it answers, or it throws `IGX-0902`.
 *
 * There is no mesh **file** format, so `crate.prefab.json` beside this file carries the material,
 * the collider and the body, and `CrateMesh` builds the box in `awake`: a primitive lives at a
 * `memory:` address that no file can name.
 */
import { Camera, MeshAsset, MeshRenderer, Script, createApp, entityRef, f32 } from "@ignifx/core";
import { defineInputActions, input } from "@ignifx/input";
import { BoxCollider, physics } from "@ignifx/physics";
import type { AssetHandle, Entity, SceneAsset, ScriptCallbacks } from "@ignifx/core";

/** Gives the prefab's `MeshRenderer` a box; the render sync picks it up in `PreRender`. */
class CrateMesh extends Script.define({ size: f32(0.6) }) implements ScriptCallbacks {
  static typeId = "recipes/CrateMesh";

  #mesh: AssetHandle<MeshAsset> | null = null;
  awake(): void {
    this.#mesh = MeshAsset.box(this.app, { size: this.size });
    this.entity.requireComponent(MeshRenderer).mesh = this.#mesh;
  }
  onDestroy(): void {
    this.#mesh?.release(); // One release for the one factory call.
    this.#mesh = null;
  }
}

/** Spawns {@link Spawner.prefab} wherever the player clicks. */
class Spawner extends Script.define({ camera: entityRef<Entity>(), lift: f32(0.4) }) implements ScriptCallbacks {
  static typeId = "recipes/Spawner";

  /** An asset handle is not a schema field here: `asset()` needs an asset *class* as its token. */
  prefab: AssetHandle<SceneAsset> | null = null;
  update(): void {
    const camera = this.camera?.getComponent(Camera) ?? null;
    const prefab = this.prefab;
    if (camera === null || prefab === null || !this.app.input.actions.get("spawn").wasPressedThisFrame) {
      return;
    }
    const pointer = this.app.input.actions.get("point").vector;
    const ray = camera.screenToRay(pointer.x, pointer.y);
    const hit = ray === null ? null : this.app.physics.raycast(ray.origin, ray.direction, 60);
    if (hit === null) {
      return;
    }
    // Along the surface normal, so a prop dropped on a wall does not start inside it.
    this.world.instantiate(prefab.value, {
      position: {
        x: hit.point.x + hit.normal.x * this.lift,
        y: hit.point.y + hit.normal.y * this.lift,
        z: hit.point.z + hit.normal.z * this.lift,
      },
    });
  }
}

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}

const app = await createApp({ canvas, extensions: [physics(), input()], settings: { assets: { root: "assets" } } });
app.registerComponents([CrateMesh, Spawner]);
const spawn = { name: "spawn", bindings: [{ path: "<Pointer>/press" }] };
const point = { name: "point", type: "vector2", bindings: [{ path: "<Pointer>/position" }] } as const;
app.input.loadActions(defineInputActions({ maps: [{ name: "Player", actions: [spawn, point] }] }));

// A floor to catch the ray: a collider with no `Rigidbody` is placed once as a static body.
app.world
  .createEntity("Floor")
  .addComponent(BoxCollider, { size: { x: 40, y: 1, z: 40 }, center: { x: 0, y: -0.5, z: 0 } });
const eye = app.world.createEntity("Main Camera");
eye.transform.localPosition.set(0, 6, -6);
eye.transform.lookAt({ x: 0, y: 0, z: 0 });
eye.addComponent(Camera, { fov: 55, far: 200 });

// Loaded before `start()`, where a completed load settles at once instead of waiting for a frame.
const crate = await app.assets.loadAsync<SceneAsset>("prefabs/crate.prefab.json");
app.world.createEntity("Spawner").addComponent(Spawner, { camera: eye }).prefab = crate;

await app.start();
