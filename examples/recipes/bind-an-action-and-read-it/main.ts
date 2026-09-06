/**
 * Bind an action and read it
 *
 * Game code asks for `"move"` and `"jump"`, never for a key code. `defineInputActions` builds the
 * document a `.input.json` file holds — two control schemes, a `2DVector` composite for WASD, and a
 * stick with a deadzone — and `app.input.loadActions` installs it. `app.input.currentScheme` follows
 * whichever device produced input last, which is what a HUD reads to choose its glyphs.
 *
 * The frame's input is captured once, in `PreUpdate`, so every read inside one frame agrees:
 * `wasPressedThisFrame` is true in *every* fixed step of the frame it resolved in. `action.vector`
 * is a live view that is never reallocated, so store its components, never the object itself.
 *
 * The file form of this document is `references/formats/inputactions.md`; `input({ actions })` loads
 * one at start-up instead.
 */
// docs:run
import { Script, createApp, f32 } from "@ignifx/core";
import { defineInputActions, input } from "@ignifx/input";
import type { ScriptCallbacks } from "@ignifx/core";

const actions = defineInputActions({
  controlSchemes: [
    { name: "KeyboardMouse", devices: ["Keyboard", "Mouse"] },
    { name: "Gamepad", devices: ["Gamepad"] },
  ],
  maps: [
    {
      name: "Player",
      actions: [
        {
          name: "move",
          type: "vector2",
          bindings: [
            {
              composite: "2DVector",
              up: "<Keyboard>/w",
              down: "<Keyboard>/s",
              left: "<Keyboard>/a",
              right: "<Keyboard>/d",
              scheme: "KeyboardMouse",
            },
            { path: "<Gamepad>/leftStick", processors: ["deadzone(0.15)"], scheme: "Gamepad" },
          ],
        },
        { name: "jump", bindings: [{ path: "<Keyboard>/space" }, { path: "<Gamepad>/buttonSouth" }] },
      ],
    },
  ],
});

/** Walks its entity across the ground plane and reports one jump per press. */
class Walker extends Script.define({ speed: f32(4) }) implements ScriptCallbacks {
  static typeId = "recipes/Walker";

  update(dt: number): void {
    const move = this.app.input.actions.get("move").vector;
    this.transform.translate({ x: move.x * this.speed * dt, y: 0, z: move.y * this.speed * dt });
    if (this.app.input.actions.get("jump").wasPressedThisFrame) {
      this.app.log.info("jump, scheme:", this.app.input.currentScheme);
    }
  }
}

const app = await createApp({ headless: true, extensions: [input()] });
app.registerComponents([Walker]);
app.input.loadActions(actions);

const player = app.world.createEntity("Player");
player.addComponent(Walker, { speed: 6 });
await app.start();

// `simulate` feeds the same pipeline a real device does, so a test needs no hardware.
app.input.simulate({ "<Keyboard>/w": 1, "<Keyboard>/space": 1 });
app.step(1 / 60);
app.log.info("moved to z:", player.transform.localPosition.z);

// A disabled action reads as released, so the script keeps running and simply stops moving.
// Disabling the whole *map* is how a pause menu takes the controls — but then `actions.get` no
// longer finds its actions (`IGX-0801`); reach them through `actions.map("Player").get(name)`.
app.input.actions.get("move").enabled = false;
app.input.actions.get("jump").enabled = false;
app.step(1 / 60);
app.log.info("still at z:", player.transform.localPosition.z);
app.dispose();
