import { inputError, InputErrorCode } from "../errors.js";
import type { ActionMap } from "./action-map.js";
import type { InputAction } from "./action.js";

/**
 * The action lookup (`docs/architecture/08-input.md` §2): what `app.input.actions` and
 * `playerInput.input` both expose. `get` searches the **enabled** maps, which is what makes
 * enabling a map the way a game switches context.
 */

/**
 * The maps installed on one input source, and the two lookups over them.
 *
 * @example
 * ```ts
 * app.input.actions.get("jump").wasPressedThisFrame;
 * app.input.actions.map("Player").enabled = false;
 * ```
 *
 * @public
 */
export class InputActionsView {
  readonly #maps: Map<string, ActionMap>;

  /**
   * Wraps a map table.
   *
   * @param maps - The installed maps, keyed by name; the view reads it live.
   */
  constructor(maps: Map<string, ActionMap>) {
    this.#maps = maps;
  }

  /**
   * Every installed map, keyed by name.
   *
   * @returns The map table.
   */
  get maps(): ReadonlyMap<string, ActionMap> {
    return this.#maps;
  }

  /**
   * Finds an action by name in the enabled maps.
   *
   * @param name - The action name.
   * @returns The action.
   * @throws IgnifxError with code `IGX-0801` when no enabled map declares it.
   */
  get(name: string): InputAction {
    for (const map of this.#maps.values()) {
      if (!map.enabled) {
        continue;
      }
      const action = map.actions.get(name);
      if (action !== undefined) {
        return action;
      }
    }
    throw inputError(InputErrorCode.unknownAction, `${name} is not an action of any enabled map.`, {
      context: { action: name, maps: [...this.#maps.keys()].join(", ") },
      hint: "Enable the map that declares it, or reach it through app.input.actions.map(name).get(name).",
    });
  }

  /**
   * Finds an action by name in any map, enabled or not.
   *
   * @param name - The action name.
   * @returns The action, or `null` when no map declares it — an absent action is not a failure
   * (coding standards §5.5).
   */
  find(name: string): InputAction | null {
    for (const map of this.#maps.values()) {
      const action = map.actions.get(name);
      if (action !== undefined) {
        return action;
      }
    }
    return null;
  }

  /**
   * Looks a map up by name.
   *
   * @param name - The map name.
   * @returns The map.
   * @throws IgnifxError with code `IGX-0804` when no map is installed under that name.
   */
  map(name: string): ActionMap {
    const map = this.#maps.get(name);
    if (map === undefined) {
      throw inputError(InputErrorCode.unknownActionMap, `${name} is not a registered action map.`, {
        context: { map: name, maps: [...this.#maps.keys()].join(", ") },
        hint: "Load an .input.json document, or call app.input.loadActions(defineInputActions({ … })).",
      });
    }
    return map;
  }
}
