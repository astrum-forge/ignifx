import { DeviceKind } from "../devices/device.js";
import type {
  ActionDefinition,
  ActionMapDefinition,
  BindingDefinition,
  InputActionsDefinition,
} from "../asset/definition.js";

/**
 * Rewriting a document for one player (`docs/architecture/08-input.md` §7). A `PlayerInput`
 * component owns a **private copy** of the maps, bound to one gamepad slot, so two players can hold
 * the same action names without sharing state.
 *
 * The rewrite is a pure function on the document: `<Gamepad>/…` becomes `<Gamepad>{slot}/…`, and a
 * path that already names a slot is left alone so a document can pin a binding deliberately.
 */

/** The token a gamepad path starts with, before the optional `{index}`. */
const GAMEPAD_TOKEN = `<${DeviceKind.gamepad}>`;

/**
 * Rewrites one path for a device slot.
 *
 * @param path - The declared path.
 * @param slot - The gamepad slot to pin gamepad paths to.
 * @returns The rewritten path, or the original when it names no gamepad or already names a slot.
 */
function pinPath(path: string, slot: number): string {
  if (path === "" || !path.startsWith(GAMEPAD_TOKEN) || path[GAMEPAD_TOKEN.length] === "{") {
    return path;
  }
  return `${GAMEPAD_TOKEN}{${String(slot)}}${path.slice(GAMEPAD_TOKEN.length)}`;
}

/**
 * Rewrites every path of one binding.
 *
 * @param binding - The binding definition.
 * @param slot - The gamepad slot.
 * @returns The rewritten binding.
 */
function pinBinding(binding: BindingDefinition, slot: number): BindingDefinition {
  const pinned: { -readonly [K in keyof BindingDefinition]: BindingDefinition[K] } = { ...binding };
  for (const key of ["path", "up", "down", "left", "right", "negative", "positive", "modifier", "button"] as const) {
    const value = pinned[key];
    if (value !== undefined) {
      pinned[key] = pinPath(value, slot);
    }
  }
  return pinned;
}

/**
 * Rewrites a whole document for one player: gamepad paths pinned to a slot, and — when a scheme is
 * named — bindings tagged with a different scheme dropped.
 *
 * @param definition - The document to rewrite.
 * @param slot - The gamepad slot gamepad paths are pinned to.
 * @param scheme - The control scheme to keep, or `""` to keep every binding.
 * @returns A new document; the input is not modified.
 *
 * @example
 * ```ts
 * const player2 = pinToDeviceSlot(definition, 1, "Gamepad");
 * ```
 *
 * @public
 */
export function pinToDeviceSlot(
  definition: InputActionsDefinition,
  slot: number,
  scheme: string,
): InputActionsDefinition {
  const maps: ActionMapDefinition[] = [];
  for (const map of definition.maps) {
    const actions: ActionDefinition[] = [];
    for (const action of map.actions) {
      const bindings: BindingDefinition[] = [];
      for (const binding of action.bindings) {
        if (scheme !== "" && (binding.scheme ?? "") !== "" && binding.scheme !== scheme) {
          continue;
        }
        bindings.push(pinBinding(binding, slot));
      }
      actions.push({ ...action, bindings });
    }
    maps.push({ ...map, actions });
  }
  return { ...definition, maps };
}
