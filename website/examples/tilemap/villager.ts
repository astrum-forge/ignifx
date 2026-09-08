import { CharacterController2D, defineInputActions, f32, Script, SpriteAnimator, Vec2 } from "ignifx";
import type { InputAction, MutableVec2, ScriptCallbacks } from "ignifx";

/**
 * The villager: the walk, the facing and the clip, in one file, so `main.ts` is only the map she
 * walks on.
 */

/** The four facings the sheet has, in the order a stick angle is bucketed into. */
const FACINGS = ["right", "up", "left", "down"] as const;

/** The actions the villager reads. Its own map, so the kit's camera actions are untouched. */
export const WALK_ACTIONS = defineInputActions({
  maps: [
    {
      name: "Village",
      actions: [
        {
          name: "walk",
          type: "vector2",
          bindings: [
            {
              composite: "2DVector",
              up: "<Keyboard>/w",
              down: "<Keyboard>/s",
              left: "<Keyboard>/a",
              right: "<Keyboard>/d",
            },
            {
              composite: "2DVector",
              up: "<Keyboard>/arrowUp",
              down: "<Keyboard>/arrowDown",
              left: "<Keyboard>/arrowLeft",
              right: "<Keyboard>/arrowRight",
            },
            { path: "<Gamepad>/leftStick", processors: ["deadzone(0.2)"] },
            { path: "<Gamepad>/dpad" },
            { path: "<Virtual>/joystick", processors: ["deadzone(0.15)"] },
          ],
        },
      ],
    },
  ],
});

/**
 * Walks its entity on the tilemap's collision, and keeps the animator on the clip that matches
 * where it is heading.
 *
 * Input is sampled in `update` and spent in `fixedUpdate`, because those are two different clocks:
 * a frame carries zero, one or two fixed steps, so reading a stick inside the step would sample the
 * same frame twice or miss it entirely.
 */
export class Villager extends Script.define({ speed: f32(4.5) }) implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "tilemap/Villager";

  #controller: CharacterController2D | null = null;
  #animator: SpriteAnimator | null = null;
  #walk: InputAction | null = null;

  /** This frame's direction, already normalised so a diagonal is not 1.41 times faster. */
  readonly #wish: MutableVec2 = new Vec2();

  /** The displacement handed to the controller. Reused, so the fixed step allocates nothing. */
  readonly #step: MutableVec2 = new Vec2();

  /** Which way she faces, and the clip that is playing, so `play` is called only on a change. */
  #facing = "down";
  #clip = "";

  awake(): void {
    this.#controller = this.entity.requireComponent(CharacterController2D);
    this.#animator = this.entity.getComponent(SpriteAnimator);
    this.#walk = this.app.input.actions.find("walk");
  }

  update(): void {
    const vector = this.#walk?.vector ?? null;
    const length = vector === null ? 0 : Math.hypot(vector.x, vector.y);
    if (vector === null || length < 0.01) {
      this.#wish.set(0, 0);
    } else {
      const scale = length > 1 ? 1 / length : 1;
      this.#wish.set(vector.x * scale, vector.y * scale);
      // A stick points anywhere; the sheet has four directions, so the angle is bucketed into the
      // nearest cardinal — which is what almost every top-down game with this kind of sheet does.
      const quadrant = Math.round(Math.atan2(this.#wish.y, this.#wish.x) / (Math.PI / 2));
      this.#facing = FACINGS[((quadrant % 4) + 4) % 4] ?? "down";
    }
    const clip = `${length < 0.01 ? "idle" : "walk"}_${this.#facing}`;
    if (clip !== this.#clip) {
      this.#clip = clip;
      this.#animator?.play(clip);
    }
  }

  fixedUpdate(dt: number): void {
    this.#step.set(this.#wish.x * this.speed * dt, this.#wish.y * this.speed * dt);
    this.#controller?.move(this.#step);
  }
}
