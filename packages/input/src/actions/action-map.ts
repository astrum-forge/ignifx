import { inputError, InputErrorCode } from "../errors.js";
import { InputAction } from "./action.js";
import type { ActionMapDefinition } from "../asset/definition.js";
import type { BindingResolver } from "../bindings/binding.js";

/**
 * An action map (`docs/architecture/08-input.md` §2): the context switch. Games enable and disable
 * maps — `Player`, `UI`, `Vehicle` — rather than rebinding actions, and every action inside a
 * disabled map reads as released.
 */

/**
 * A named group of actions.
 *
 * @example
 * ```ts
 * app.input.actions.map("UI").enabled = true;
 * app.input.actions.map("Player").enabled = false;
 * ```
 *
 * @public
 */
export class ActionMap {
  /** The map name. */
  readonly name: string;

  /** Whether the map's actions resolve. Actions in a disabled map read as released. */
  enabled: boolean;

  readonly #actions = new Map<string, InputAction>();

  /**
   * Builds a map and its actions.
   *
   * @param definition - The map as it appears in an `ignifx.inputactions` document.
   * @param resolver - How binding paths become controls.
   * @param onHandlerError - Where an action signal handler's exception is reported.
   * @throws IgnifxError with code `IGX-0810` when two actions share a name, or with a binding code
   * when one of the bindings cannot be resolved.
   */
  constructor(definition: ActionMapDefinition, resolver: BindingResolver, onHandlerError: (error: unknown) => void) {
    this.name = definition.name;
    this.enabled = definition.enabled ?? true;
    for (const action of definition.actions) {
      if (this.#actions.has(action.name)) {
        throw inputError(InputErrorCode.duplicateName, `${action.name} is declared twice in ${definition.name}.`, {
          context: { name: action.name, scope: definition.name },
          hint: "Action names are unique inside one map.",
        });
      }
      this.#actions.set(action.name, new InputAction(action, this, resolver, onHandlerError));
    }
  }

  /**
   * The map's actions, keyed by name.
   *
   * @returns The action table.
   */
  get actions(): ReadonlyMap<string, InputAction> {
    return this.#actions;
  }

  /**
   * Looks one action up.
   *
   * @param name - The action name.
   * @returns The action.
   * @throws IgnifxError with code `IGX-0801` when the map declares no such action.
   */
  get(name: string): InputAction {
    const action = this.#actions.get(name);
    if (action === undefined) {
      throw inputError(InputErrorCode.unknownAction, `${name} is not an action of the ${this.name} map.`, {
        context: { action: name, map: this.name },
        hint: "Check the action names in the .input.json document this map came from.",
      });
    }
    return action;
  }
}
