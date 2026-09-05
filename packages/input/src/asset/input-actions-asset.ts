import { INPUT_ACTIONS_ASSET_TYPE } from "./definition.js";
import type { InputActionsDefinition } from "./definition.js";

/**
 * The loaded form of an `.input.json` document
 * (`docs/architecture/05-assets-and-loading.md` §5, the `inputactions` row). The asset is the
 * validated document and nothing else: installing it into an app is `app.input.loadActions`, which
 * is what keeps loaders pure with respect to the world.
 */

/**
 * A loaded input actions document.
 *
 * @example
 * ```ts
 * const actions = await app.assets.loadAsync<InputActionsAsset>("input/default.input.json");
 * app.input.loadActions(actions.value);
 * ```
 *
 * @public
 */
export class InputActionsAsset {
  /** The type name the asset service registers input action documents under. */
  static assetType: string = INPUT_ACTIONS_ASSET_TYPE;

  /** The address the document was loaded from; `""` for one built in code. */
  readonly address: string;

  /** The validated document. */
  readonly definition: InputActionsDefinition;

  /**
   * Wraps a validated document. The `inputactions` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param definition - The validated document.
   */
  constructor(address: string, definition: InputActionsDefinition) {
    this.address = address;
    this.definition = definition;
  }

  /**
   * The names of the maps the document declares, in document order.
   *
   * @returns The map names.
   */
  get mapNames(): readonly string[] {
    const names: string[] = [];
    for (const map of this.definition.maps) {
      names.push(map.name);
    }
    return names;
  }
}
