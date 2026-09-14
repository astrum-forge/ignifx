/**
 * Walk on terrain
 *
 * `@ignifx/terrain` does not depend on `@ignifx/physics`: a terrain without physics costs no
 * physics code. The two are joined by **data** instead — `terrain.colliderInit(region?)` returns
 * exactly the fields a `HeightfieldCollider` declares, in the terrain's local frame, and the
 * collider applies the entity's scale itself.
 *
 * The queries are the other half. `heightAt`, `normalAt`, `slopeAt` and `raycast` read the source
 * height field, not a collider, so a camera, a minimap or an AI can ask where the ground is without
 * physics being registered at all — and they are allocation-free, taking an `out` where they answer
 * with a vector.
 *
 * A terrain built from `noise` needs no files, which is what lets this whole recipe run headless.
 * Sculpting at runtime is `setHeights`, and `onHeightsChanged` is where the collider is rebuilt.
 */
// docs:run
import { Camera, Script, Vec3, createApp, f32 } from "@ignifx/core";
import { CharacterController, HeightfieldCollider, physics } from "@ignifx/physics";
import { Terrain, terrain, terrainAssetFromDefinition } from "@ignifx/terrain";
import type { ScriptCallbacks } from "@ignifx/core";

/** Walks north at a constant speed, letting the controller resolve the slope under it. */
class Walker extends Script.define({ speed: f32(3), gravity: f32(-18) }) implements ScriptCallbacks {
  static typeId = "recipes/Walker";

  #body: CharacterController | null = null;
  #fallSpeed = 0;
  readonly #step = new Vec3();

  awake(): void {
    this.#body = this.entity.requireComponent(CharacterController);
  }

  fixedUpdate(dt: number): void {
    const body = this.#body;
    if (body === null) {
      return;
    }
    // Gravity is the caller's business: a character controller goes exactly where it is told.
    this.#fallSpeed = body.isGrounded ? Math.max(this.#fallSpeed, 0) : this.#fallSpeed;
    this.#fallSpeed += this.gravity * dt;
    this.#step.set(0, this.#fallSpeed * dt, this.speed * dt);
    body.move(this.#step);
  }
}

const app = await createApp({ headless: true, extensions: [physics(), terrain()] });
app.registerComponents([Walker]);

const island = await terrainAssetFromDefinition(app, {
  size: { width: 256, depth: 256, height: 30 },
  resolution: 257,
  chunks: { size: 64, lodLevels: 3, lodDistance: 96, skirtDepth: 2 },
  noise: { seed: 11, octaves: 5, frequency: 0.01 },
  layers: [{ name: "grass", color: [0.25, 0.6, 0.25] }],
});

app.world.createEntity("Main Camera", { position: { x: 0, y: 30, z: -80 } }).addComponent(Camera, { far: 1000 });
const ground = app.world.createEntity("Island");
const field = ground.addComponent(Terrain, { definition: island });

await app.start();
// One frame for `TerrainLodSystem` to build the chunks and the height field to be readable.
app.step(1 / 60);

// The collider is a copy of the heights, so it follows a sculpt rather than watching one.
const collider = ground.addComponent(HeightfieldCollider, field.colliderInit());
field.onHeightsChanged.connect(() => {
  Object.assign(collider, field.colliderInit());
  collider.rebuild();
});

// Spawned above the ground the query reports, so the first steps settle it onto the collider.
const start = field.heightAt(0, -40);
const hiker = app.world.createEntity("Hiker", { position: { x: 0, y: start + 4, z: -40 } });
hiker.addComponent(CharacterController, { height: 1.8, radius: 0.35, slopeLimit: 50 });
hiker.addComponent(Walker, { speed: 3 });

for (let frame = 0; frame < 180; frame += 1) {
  app.step(1 / 60);
}
const at = hiker.transform.position;
app.log.info("walked from z -40 to:", at.z.toFixed(2), "resting at y:", at.y.toFixed(2));

// The same answers anywhere, with no physics at all: these read the height field, not the collider.
app.log.info("ground at (10, 10):", field.heightAt(10, 10).toFixed(2), "slope:", field.slopeAt(10, 10).toFixed(1));
app.dispose();
