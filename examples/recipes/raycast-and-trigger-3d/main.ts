/**
 * Raycast and catch a trigger in 3D
 *
 * Two ways to ask the physics world a question. `app.physics.raycast` is a poll: an origin, a
 * direction and a distance in, and the first entity, point, normal and distance out. A trigger
 * volume is a push: a collider with `isTrigger: true` reports every body that enters or leaves it to
 * the scripts on its own entity, through `onTriggerEnter` and `onTriggerExit`.
 *
 * Both need one completed fixed step first — Havok builds its broadphase there — so a query before
 * `app.step` throws `IGX-0902`. Prefer triggers for gameplay: `@babylonjs/lite@1.27.0` reports
 * collisions with no body identity, so `collision.other` is `null`, while a trigger event always
 * carries both entities.
 *
 * Event objects are pooled and reused for every event of a step, so copy anything you keep.
 */
// docs:run
import { LayerMask, Script, createApp, u32 } from "@ignifx/core";
import { BoxCollider, Rigidbody, SphereCollider, physics } from "@ignifx/physics";
import type { ScriptCallbacks } from "@ignifx/core";
import type { TriggerEvent } from "@ignifx/physics";

/** Counts the bodies that walk into the volume this script shares an entity with. */
class Zone extends Script.define({ visitors: u32(0) }) implements ScriptCallbacks {
  static typeId = "recipes/Zone";

  onTriggerEnter(trigger: TriggerEvent): void {
    this.visitors += 1;
    this.app.log.info("entered:", trigger.other?.name ?? "something", "visitors:", this.visitors);
  }

  onTriggerExit(trigger: TriggerEvent): void {
    this.app.log.info("left:", trigger.other?.name ?? "something");
  }
}

const app = await createApp({ headless: true, extensions: [physics()] });
app.registerComponents([Zone]);
await app.start();

app.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } }).addComponent(BoxCollider, {
  size: { x: 20, y: 1, z: 20 },
});

const zone = app.world.createEntity("Zone", { position: { x: 0, y: 1, z: 0 } });
zone.addComponent(BoxCollider, { size: { x: 4, y: 2, z: 4 }, isTrigger: true });
zone.addComponent(Zone);

const ball = app.world.createEntity("Ball", { position: { x: 0, y: 6, z: 0 } });
ball.addComponent(SphereCollider, { radius: 0.4 });
ball.addComponent(Rigidbody, { mass: 1 });

// Bodies are built at the start of the next fixed step, and the broadphase with them.
app.step(1 / 60);

// The ray falls straight through the trigger volume it passes: `hitTriggers` defaults to false.
const hit = app.physics.raycast({ x: 1.5, y: 8, z: 0 }, { x: 0, y: -1, z: 0 }, 20, {
  layerMask: LayerMask.everything(),
  hitTriggers: false,
});
if (hit !== null) {
  app.log.info("ray hit:", hit.entity.name, "at y:", hit.point.y, "distance:", hit.distance);
}

// The ball drops into the volume and rests there, so `onTriggerEnter` fires once and no exit does.
for (let step = 0; step < 120; step += 1) {
  app.step(1 / 60);
}
app.log.info("visitors:", zone.getComponent(Zone)?.visitors ?? 0);
app.dispose();
