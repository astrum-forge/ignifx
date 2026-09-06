/**
 * Move a 2D platformer character
 *
 * `CharacterController2D` is a kinematic capsule or box that collides and slides through Rapier. It
 * applies **no gravity**, so the script owns the vertical velocity — and with it coyote time,
 * variable jump height, and terminal velocity.
 *
 * Two fields make stairs and slopes feel right. `stepOffset` climbs a ledge without a jump, but
 * autostep needs `shape: "box"`: with the default capsule of radius 0.2 it clears about 0.15 m and
 * no more. `snapToGround` keeps the character glued going *down* a slope instead of launching off
 * the crest.
 *
 * Units are metres and seconds with +Y up, exactly as in 3D; `pixelsPerUnit` is a rendering setting
 * and changes nothing here. Only the first sixteen layers of `ignifx.config.ts` filter collisions —
 * Rapier packs membership into 16 bits, and a collider above that logs `IGX-1152`.
 */
// docs:run
import { twoD } from "@ignifx/2d";
import { Script, Vec2, createApp, f32 } from "@ignifx/core";
import { defineInputActions, input } from "@ignifx/input";
import { BoxCollider2D, CharacterController2D, physics2d } from "@ignifx/physics-2d";
import type { ScriptCallbacks } from "@ignifx/core";

/** Runs, jumps, and cuts the jump short when the button is released. */
class Platformer
  extends Script.define({ speed: f32(6), jumpSpeed: f32(9), gravity: f32(-24), cutoff: f32(0.45) })
  implements ScriptCallbacks
{
  static typeId = "recipes/Platformer";

  #controller: CharacterController2D | null = null;
  readonly #velocity = new Vec2();
  readonly #step = new Vec2();

  awake(): void {
    this.#controller = this.entity.requireComponent(CharacterController2D);
  }

  fixedUpdate(dt: number): void {
    const controller = this.#controller;
    if (controller === null) {
      return;
    }
    const jump = this.app.input.actions.get("jump");
    this.#velocity.x = this.app.input.actions.get("move").axis * this.speed;
    if (controller.isGrounded) {
      this.#velocity.y = jump.isPressed ? this.jumpSpeed : 0;
    } else {
      if (jump.wasReleasedThisFrame && this.#velocity.y > 0) {
        // Releasing early cuts the rise short: the classic variable-height jump.
        this.#velocity.y *= this.cutoff;
      }
      this.#velocity.y += this.gravity * dt;
    }
    this.#step.set(this.#velocity.x * dt, this.#velocity.y * dt);
    controller.move(this.#step);
  }
}

const app = await createApp({ headless: true, extensions: [twoD({ pixelsPerUnit: 16 }), physics2d(), input()] });
app.registerComponents([Platformer]);
const strafe = { composite: "1DAxis", negative: "<Keyboard>/a", positive: "<Keyboard>/d" };
const player = {
  name: "Player",
  actions: [
    { name: "move", type: "axis", bindings: [strafe] },
    { name: "jump", bindings: [{ path: "<Keyboard>/space" }] },
  ],
} as const;
app.input.loadActions(defineInputActions({ maps: [player] }));

const ground = app.world.createEntity("Ground", { position: { x: 0, y: -0.5, z: 0 } });
ground.addComponent(BoxCollider2D, { size: { x: 40, y: 1 } });

const hero = app.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
// Autostep needs a box: the default capsule clears about 0.15 m however big `stepOffset` is.
hero.addComponent(CharacterController2D, {
  shape: "box",
  radius: 0.3,
  height: 1.2,
  stepOffset: 0.3,
  snapToGround: 0.2,
});
hero.addComponent(Platformer);

await app.start();
app.input.simulate({ "<Keyboard>/d": 1, "<Keyboard>/space": 1 });
for (let step = 0; step < 60; step += 1) {
  app.step(1 / 60);
}
app.log.info("hero x, y:", hero.transform.position2D.x, hero.transform.position2D.y);
app.dispose();
