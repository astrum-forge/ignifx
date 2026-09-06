import { defineInputActions } from "@ignifx/input";
import type { InputActionsDefinition } from "@ignifx/input";

/**
 * The action map the controller suites bind to: the four actions
 * `docs/architecture/12-3d-toolkit.md` §1 names by default, on the keyboard and mouse so
 * `app.input.simulate` can drive them.
 */

/**
 * Builds the default action set.
 *
 * @returns The definition, ready for `app.input.loadActions`.
 */
export function characterActions(): InputActionsDefinition {
  return defineInputActions({
    controlSchemes: [{ name: "KeyboardMouse", devices: ["Keyboard", "Mouse"] }],
    maps: [
      {
        name: "Player",
        actions: [
          {
            name: "Move",
            type: "vector2",
            bindings: [
              {
                composite: "2DVector",
                up: "<Keyboard>/w",
                down: "<Keyboard>/s",
                left: "<Keyboard>/a",
                right: "<Keyboard>/d",
              },
            ],
          },
          { name: "Jump", type: "button", bindings: [{ path: "<Keyboard>/space" }] },
          { name: "Sprint", type: "button", bindings: [{ path: "<Keyboard>/shiftLeft" }] },
          { name: "Crouch", type: "button", bindings: [{ path: "<Keyboard>/c" }] },
          { name: "Look", type: "vector2", bindings: [{ path: "<Mouse>/delta" }] },
        ],
      },
    ],
  });
}
