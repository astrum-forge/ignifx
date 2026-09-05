import { asset, Component, createDefaults, defineSchema, i32, str } from "@ignifx/core";
import { InputActionsAsset } from "../asset/input-actions-asset.js";
import { InputService } from "../service/input-service.js";
import type { InputActionsView } from "../actions/actions-view.js";
import type { InputActionSet } from "../service/input-service.js";
import type { AssetHandle, ComponentHooks, Schema } from "@ignifx/core";

/**
 * `PlayerInput` (`docs/architecture/08-input.md` §7): per-player device assignment for local
 * multiplayer. The component owns a **private copy** of an action document's maps with every
 * `<Gamepad>/…` path pinned to one slot, so two players holding the same action names never share
 * state. Single-player games use `app.input` directly and never attach this.
 *
 * The class is written out rather than built with `Component.define` for the reason the core
 * components are: `isolatedDeclarations` cannot emit a declaration for a class whose `extends`
 * clause is a call (`TS9021`), so the schema is a static and the fields are `declare`d.
 */

/**
 * The component's field declarations.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 */
function playerInputSchema(): Schema {
  return defineSchema({
    actions: asset(InputActionsAsset),
    deviceSlot: i32(0, { min: 0 }),
    scheme: str(""),
  });
}

/**
 * Binds an entity to an action document and one device slot.
 *
 * @remarks
 * The schema field `actions` holds the *asset*; the resolved lookup is `playerInput.input`, which
 * is the same {@link InputActionsView} `app.input.actions` exposes. `08-input.md` §7 spells the
 * lookup `player.input.actions`; the two cannot both be called `actions` on one class, and the
 * serialized field is the one whose name the file format fixes.
 *
 * @example
 * ```ts
 * const player = entity.addComponent(PlayerInput, { actions: handle, deviceSlot: 1 });
 * player.input?.get("move").vector.x;
 * ```
 *
 * @public
 */
export class PlayerInput extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/PlayerInput";

  /** One player owns one entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = playerInputSchema();

  /** The `ignifx.inputactions` document this player's private maps are built from. */
  declare actions: AssetHandle<InputActionsAsset> | null;

  /** Which gamepad slot the player's `<Gamepad>/…` bindings are pinned to. */
  declare deviceSlot: number;

  /** The control scheme to keep; `""` keeps every binding whatever its tag. */
  declare scheme: string;

  #set: InputActionSet | null = null;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(PlayerInput.schema));
  }

  /**
   * The player's private action lookup.
   *
   * @returns The view over the private maps, or `null` until the document is available.
   */
  get input(): InputActionsView | null {
    return this.#set?.actions ?? null;
  }

  /**
   * Rebuilds the private maps from the current `actions`, `deviceSlot`, and `scheme` fields. Call
   * it after changing any of them; `onAttach` calls it once for you.
   *
   * @returns `true` when a set was built, `false` when the document or the service is absent.
   */
  rebuild(): boolean {
    this.#set?.dispose();
    this.#set = null;
    const handle = this.actions;
    if (handle === null || handle.state !== "loaded") {
      return false;
    }
    const service = this.app.services.tryGet(InputService);
    if (service === null) {
      return false;
    }
    this.#set = service.createActionSet(handle.value, { deviceSlot: this.deviceSlot, scheme: this.scheme });
    return true;
  }

  /** Builds the private maps as soon as the component's fields are assigned. */
  onAttach(): void {
    this.rebuild();
  }

  /** Stops the private maps resolving. */
  onDetach(): void {
    this.#set?.dispose();
    this.#set = null;
  }
}
