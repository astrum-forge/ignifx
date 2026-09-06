/**
 * Move a 3D character controller
 *
 * A `CharacterController` is a kinematic capsule that collides and slides. It applies **no gravity**
 * of its own, so the script owns the vertical speed — and therefore owns jump feel: this one keeps a
 * coyote window, the grace period after walking off a ledge in which a jump still fires.
 *
 * Movement is simulation, so it runs in `fixedUpdate`: the input captured at frame start reads the
 * same in every fixed step, and 30 fps and 240 fps produce the same trajectory. `move` accumulates,
 * so calling it twice in one step is one displacement.
 *
 * Havok's controller has no static friction and reports `isGrounded === false` on any incline;
 * `ThirdPersonController` in `@ignifx/3d` classifies the ground against `slopeLimit` instead, and is
 * what a real game reaches for.
 */
// docs:run
import { Script, Vec3, createApp, f32 } from "@ignifx/core";
import { defineInputActions, input } from "@ignifx/input";
import { BoxCollider, CharacterController, physics } from "@ignifx/physics";
import type { ScriptCallbacks } from "@ignifx/core";

/** Walks and jumps a `CharacterController` from the `move` and `jump` actions. */
class CharacterMotor
  extends Script.define({ speed: f32(4), jumpSpeed: f32(6), coyoteSeconds: f32(0.12), gravity: f32(-18) })
  implements ScriptCallbacks
{
  static typeId = "recipes/CharacterMotor";

  #controller: CharacterController | null = null;
  #verticalSpeed = 0;
  #airborneSeconds = Number.POSITIVE_INFINITY;
  readonly #displacement = new Vec3();

  awake(): void {
    this.#controller = this.entity.requireComponent(CharacterController);
  }

  fixedUpdate(dt: number): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    this.#airborneSeconds = controller.isGrounded ? 0 : this.#airborneSeconds + dt;
    this.#verticalSpeed = controller.isGrounded ? Math.max(this.#verticalSpeed, 0) : this.#verticalSpeed;
    if (this.app.input.actions.get("jump").wasPressedThisFrame && this.#airborneSeconds <= this.coyoteSeconds) {
      this.#verticalSpeed = this.jumpSpeed;
      // Spend the window, so one press is one jump.
      this.#airborneSeconds = Number.POSITIVE_INFINITY;
    }
    this.#verticalSpeed += this.gravity * dt;
    const move = this.app.input.actions.get("move").vector;
    this.#displacement.set(move.x * this.speed * dt, this.#verticalSpeed * dt, move.y * this.speed * dt);
    controller.move(this.#displacement);
  }
}

const wasd = {
  composite: "2DVector",
  up: "<Keyboard>/w",
  down: "<Keyboard>/s",
  left: "<Keyboard>/a",
  right: "<Keyboard>/d",
};
const app = await createApp({ headless: true, extensions: [physics(), input()] });
app.registerComponents([CharacterMotor]);
app.input.loadActions(
  defineInputActions({
    maps: [
      {
        name: "Player",
        actions: [
          { name: "move", type: "vector2", bindings: [wasd] },
          { name: "jump", bindings: [{ path: "<Keyboard>/space" }] },
        ],
      },
    ],
  }),
);

// A collider with no `Rigidbody` is placed once as a static body; moving it later logs IGX-0901.
app.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } }).addComponent(BoxCollider, {
  size: { x: 40, y: 1, z: 40 },
});
const hero = app.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
hero.addComponent(CharacterController, { height: 1.8, radius: 0.35, slopeLimit: 45 });
hero.addComponent(CharacterMotor);

await app.start();
app.input.simulate({ "<Keyboard>/w": 1, "<Keyboard>/space": 1 });
for (let step = 0; step < 60; step += 1) {
  app.step(1 / 60);
}
app.log.info("hero y, z:", hero.transform.position.y, hero.transform.position.z);
app.dispose();
