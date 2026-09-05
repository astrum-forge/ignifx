import type { ControlSchemeDefinition } from "../asset/definition.js";
import type { DeviceKind } from "../devices/device.js";

/**
 * Control schemes (`docs/architecture/08-input.md` §4). A scheme names the device families it
 * pairs with; the active scheme switches to whichever scheme lists the device that produced input
 * last, which is what lets UI show the right glyphs.
 *
 * Schemes do **not** filter resolution by default. A binding tagged `Gamepad` still works while
 * `KeyboardMouse` is active, because a player who taps the space bar and then the pad expects both
 * to keep working. `input.strictSchemes` turns the tag into a filter for games that need it.
 */

/**
 * The scheme table, with the lookup the frame's device attribution goes through.
 *
 * @public
 */
export class ControlSchemes {
  #schemes: readonly ControlSchemeDefinition[] = [];

  /**
   * The declared schemes, in document order.
   *
   * @returns The schemes.
   */
  get all(): readonly ControlSchemeDefinition[] {
    return this.#schemes;
  }

  /**
   * Replaces the table.
   *
   * @param schemes - The schemes an `ignifx.inputactions` document declared.
   *
   * @internal
   */
  install(schemes: readonly ControlSchemeDefinition[]): void {
    this.#schemes = schemes;
  }

  /**
   * Finds the scheme a device family belongs to.
   *
   * @param device - The device family that produced input.
   * @returns The scheme name, or `""` when no scheme lists the family.
   */
  forDevice(device: DeviceKind): string {
    for (const scheme of this.#schemes) {
      for (const name of scheme.devices) {
        if (name === device) {
          return scheme.name;
        }
      }
    }
    return "";
  }

  /**
   * Whether a scheme with that name is declared.
   *
   * @param name - The scheme name.
   * @returns `true` when the table declares it.
   */
  has(name: string): boolean {
    for (const scheme of this.#schemes) {
      if (scheme.name === name) {
        return true;
      }
    }
    return false;
  }
}
