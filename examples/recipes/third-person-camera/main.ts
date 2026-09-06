/**
 * Follow a character with a third-person camera
 *
 * `ThirdPersonCamera` is an orbit rig: it puts the entity carrying the `Camera` behind
 * `target`, at `distance`, offset by `shoulderOffset`, and damps toward that pose. It runs in
 * `lateUpdate` — after `PostUpdate`, so it frames the character where this frame's animation
 * actually left it.
 *
 * Wall collision is the part worth configuring. With `collisionEnabled`, the rig sphere-casts from
 * the pivot toward the ideal eye position over `collisionLayers` and pulls in to `currentDistance`
 * when something is in the way, then eases back out at `collisionRecoverySpeed`. Keep the layers to
 * static level geometry: a cast that hits the character's own body would jam the camera at its nose.
 *
 * The rig reads the `Look` action and the controller reads `Move`, `Jump` and `Sprint`; both name
 * them in fields (`lookAction`, `moveAction`, …), so renaming one is a field plus `rebind()`. An
 * action no loaded map declares is reported once as `IGX-1212` and then treated as absent.
 *
 * `@ignifx/3d` needs `physics()` and `input()` registered **before** `threeD()`.
 */
// docs:run
import { ThirdPersonCamera, ThirdPersonController, threeD } from "@ignifx/3d";
import { Camera, createApp } from "@ignifx/core";
import { defineInputActions, input } from "@ignifx/input";
import { BoxCollider, CharacterController, Rigidbody, physics } from "@ignifx/physics";

const app = await createApp({ headless: true, extensions: [physics(), input(), threeD()] });
const look = { name: "Look", type: "vector2", bindings: [{ path: "<Mouse>/delta" }] } as const;
const move = {
  name: "Move",
  type: "vector2",
  bindings: [
    { composite: "2DVector", up: "<Keyboard>/w", down: "<Keyboard>/s", left: "<Keyboard>/a", right: "<Keyboard>/d" },
  ],
} as const;
const jump = { name: "Jump", bindings: [{ path: "<Keyboard>/space" }] };
const sprint = { name: "Sprint", bindings: [{ path: "<Keyboard>/shiftLeft" }] };
app.input.loadActions(defineInputActions({ maps: [{ name: "Player", actions: [move, look, jump, sprint] }] }));

const floor = app.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } });
floor.addComponent(BoxCollider, { size: { x: 60, y: 1, z: 60 } });
floor.addComponent(Rigidbody, { bodyType: "static" });

const hero = app.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
hero.addComponent(CharacterController, { height: 1.8, radius: 0.35, slopeLimit: 45 });
hero.addComponent(ThirdPersonController, { walkSpeed: 4, sprintSpeed: 7, jumpHeight: 1.2 });

const eye = app.world.createEntity("Main Camera");
eye.addComponent(Camera, { fov: 60, near: 0.1, far: 200 });
const rig = eye.addComponent(ThirdPersonCamera, {
  target: hero,
  distance: 5,
  shoulderOffset: { x: 0.5, y: 1.5, z: 0 },
  minPitch: -30,
  maxPitch: 60,
  damping: 12,
  collisionEnabled: true,
  collisionRadius: 0.25,
  // Level geometry only: a cast that hit the character would jam the camera at its nose.
  collisionLayers: ["Default"],
});

await app.start();
// `snap()` puts the rig at its ideal pose with no damping: use it after a teleport or a cut.
rig.snap();
app.input.simulate({ "<Keyboard>/w": 1 });
for (let step = 0; step < 60; step += 1) {
  app.step(1 / 60);
}
app.log.info("hero z:", hero.transform.position.z);
app.log.info("camera position, yaw, distance:", eye.transform.position.z, rig.yaw, rig.currentDistance);
app.dispose();
