import { PlayerInput } from "@ignifx/input";
import { threeDError, ThreeDErrorCode } from "../errors.js";
import type { Component, Entity } from "@ignifx/core";
import type { InputAction, InputActionsView } from "@ignifx/input";

/**
 * How the 3D toolkit's controllers find their input actions (`docs/architecture/08-input.md`,
 * `12-3d-toolkit.md` §1).
 *
 * Two rules, and they are the whole file:
 *
 * - A controller under a `PlayerInput` reads **that player's** action set, so split-screen works
 *   without a single line of per-controller code. Otherwise it reads `app.input.actions`, the
 *   single-player path.
 * - An action the loaded maps do not declare is reported once, as `IGX-1212`, and then treated as
 *   permanently absent. A controller that spammed the log every frame would be worse than useless,
 *   and one that threw would take a whole scene down over a typo in a field.
 */

/**
 * Caches the resolution of one action name for one component.
 *
 * @internal
 */
export class ActionSlot {
  #name: string;

  #action: InputAction | null = null;

  #reported = false;

  /**
   * Builds a slot.
   *
   * @param name - The action name to look up.
   */
  constructor(name: string) {
    this.#name = name;
  }

  /**
   * The action name this slot resolves.
   *
   * @returns The action name this slot resolves.
   */
  get name(): string {
    return this.#name;
  }

  /**
   * Resolves the action, reporting a missing one once.
   *
   * @param owner - The component asking, for the error report.
   * @returns The action, or `null` when the maps do not declare it.
   */
  resolve(owner: Component): InputAction | null {
    if (this.#action !== null || this.#reported || this.#name === "") {
      return this.#action;
    }
    const view = viewFor(owner.entity);
    const found = view?.find(this.#name) ?? null;
    if (found === null) {
      // Only report once the input system has something loaded at all: a controller that awakes
      // before its `.inputactions` asset does is normal, not an error.
      if (view !== null && view.maps.size > 0) {
        this.#reported = true;
        owner.app.onError.emit({
          error: threeDError(
            ThreeDErrorCode.unknownInputAction,
            `${owner.constructor.name} reads the input action ${this.#name}, which no loaded action map declares.`,
            { context: { component: owner.constructor.name, action: this.#name } },
          ),
          source: "lifecycle",
          phase: null,
          entity: owner.entity,
          component: owner,
        });
      }
      return null;
    }
    this.#action = found;
    return found;
  }

  /** Forgets the resolution, so a reloaded action set is picked up. */
  invalidate(): void {
    this.#action = null;
    this.#reported = false;
  }

  /**
   * Points the slot at a different action name.
   *
   * @param name - The new name.
   */
  retarget(name: string): void {
    this.#name = name;
    this.invalidate();
  }
}

/**
 * The action set an entity reads: its own player's, or the app's.
 *
 * @param entity - The entity the controller sits on.
 * @returns The view, or `null` when `@ignifx/input` has nothing loaded.
 */
function viewFor(entity: Entity): InputActionsView | null {
  for (let cursor: Entity | null = entity; cursor !== null; cursor = cursor.parent) {
    const player = cursor.getComponent(PlayerInput);
    const view = player?.input ?? null;
    if (view !== null) {
      return view;
    }
  }
  return entity.world.app.input.actions;
}

/**
 * Reads a button action's pressed state without caring whether it exists.
 *
 * @param action - The action, or `null`.
 * @returns Whether it is held.
 *
 * @internal
 */
export function isHeld(action: InputAction | null): boolean {
  return action?.isPressed ?? false;
}

/**
 * Reads whether a button action went down this frame.
 *
 * @param action - The action, or `null`.
 * @returns Whether it was pressed this frame.
 *
 * @internal
 */
export function wasPressed(action: InputAction | null): boolean {
  return action?.wasPressedThisFrame ?? false;
}
