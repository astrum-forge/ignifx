/**
 * The `ignifx.inputactions` document shape (`docs/architecture/08-input.md` §3,
 * `06-serialization-and-scene-format.md` §6). One set of types serves both halves of the format:
 * the `.input.json` file the loader reads and the object {@link defineInputActions} builds in code.
 */

/**
 * The `format` discriminator of an input actions document.
 *
 * @public
 */
export const INPUT_ACTIONS_FORMAT = "ignifx.inputactions";

/**
 * The format version this build reads and writes.
 *
 * @public
 */
export const INPUT_ACTIONS_FORMAT_VERSION = 1;

/**
 * The address suffixes that select the `inputactions` loader.
 *
 * @public
 */
export const INPUT_ACTIONS_FILE_EXTENSIONS: readonly string[] = Object.freeze([".input.json"]);

/**
 * The asset type name input action documents are registered under.
 *
 * @public
 */
export const INPUT_ACTIONS_ASSET_TYPE = "inputactions";

/**
 * What an action produces (`docs/architecture/08-input.md` §2).
 *
 * @public
 */
export type InputActionType = "button" | "axis" | "vector2";

/**
 * One control scheme: a name and the device families it pairs with
 * (`docs/architecture/08-input.md` §4).
 *
 * @public
 */
export interface ControlSchemeDefinition {
  /** The scheme name, for example `KeyboardMouse`. */
  readonly name: string;
  /** The device family tokens the scheme uses, for example `["Keyboard", "Mouse"]`. */
  readonly devices: readonly string[];
}

/**
 * One binding of one action, as it appears in a document. A binding is either a single `path` or a
 * `composite` whose named parts each carry a path.
 *
 * @example
 * ```json
 * { "composite": "2DVector", "up": "<Keyboard>/w", "down": "<Keyboard>/s",
 *   "left": "<Keyboard>/a", "right": "<Keyboard>/d" }
 * ```
 *
 * @public
 */
export interface BindingDefinition {
  /** The control path, for a simple binding. */
  readonly path?: string;
  /** The composite name, for a composite binding. */
  readonly composite?: string;
  /** The `2DVector` up part. */
  readonly up?: string;
  /** The `2DVector` down part. */
  readonly down?: string;
  /** The `2DVector` left part. */
  readonly left?: string;
  /** The `2DVector` right part. */
  readonly right?: string;
  /** The `1DAxis` negative part. */
  readonly negative?: string;
  /** The `1DAxis` positive part. */
  readonly positive?: string;
  /** The `ButtonWithModifier` modifier part. */
  readonly modifier?: string;
  /** The `ButtonWithModifier` button part. */
  readonly button?: string;
  /** The processors applied to the binding's value, in order. */
  readonly processors?: readonly string[];
  /** The control scheme this binding belongs to; empty means every scheme. */
  readonly scheme?: string;
}

/**
 * One action of one map.
 *
 * @public
 */
export interface ActionDefinition {
  /** The action name game code asks for, for example `move`. */
  readonly name: string;
  /** What the action produces. Defaults to `button`. */
  readonly type?: InputActionType;
  /** The bindings that feed it. */
  readonly bindings: readonly BindingDefinition[];
}

/**
 * One action map: a named context such as `Player`, `UI`, or `Vehicle`.
 *
 * @public
 */
export interface ActionMapDefinition {
  /** The map name. */
  readonly name: string;
  /** Whether the map starts enabled. Defaults to `true`. */
  readonly enabled?: boolean;
  /** The actions the map declares. */
  readonly actions: readonly ActionDefinition[];
}

/**
 * A whole `ignifx.inputactions` document.
 *
 * @public
 */
export interface InputActionsDefinition {
  /** Always `ignifx.inputactions`. */
  readonly format: typeof INPUT_ACTIONS_FORMAT;
  /** The format version; `1` before ignifx 1.0. */
  readonly formatVersion: number;
  /** The control schemes the document declares. */
  readonly controlSchemes: readonly ControlSchemeDefinition[];
  /** The action maps the document declares. */
  readonly maps: readonly ActionMapDefinition[];
}

/**
 * What {@link defineInputActions} accepts: a document with the two header fields optional, because
 * code that builds the object does not have to repeat what the format already fixes.
 *
 * @public
 */
export interface InputActionsInput {
  /** Always `ignifx.inputactions` when present. */
  readonly format?: typeof INPUT_ACTIONS_FORMAT;
  /** The format version when present; defaults to `1`. */
  readonly formatVersion?: number;
  /** The control schemes; defaults to none. */
  readonly controlSchemes?: readonly ControlSchemeDefinition[];
  /** The action maps. */
  readonly maps: readonly ActionMapDefinition[];
}

/**
 * Builds an `ignifx.inputactions` document in code, filling in the format header
 * (`docs/architecture/08-input.md` §3: "the same asset can be defined in code with
 * `defineInputActions({...})`").
 *
 * @param input - The maps, and optionally the control schemes and the header.
 * @returns The document, identical to what the loader produces for the equivalent `.input.json`.
 *
 * @example
 * ```ts
 * const actions = defineInputActions({
 *   maps: [
 *     {
 *       name: "Player",
 *       actions: [{ name: "jump", type: "button", bindings: [{ path: "<Keyboard>/space" }] }],
 *     },
 *   ],
 * });
 * ```
 *
 * @public
 */
export function defineInputActions(input: InputActionsInput): InputActionsDefinition {
  return {
    format: INPUT_ACTIONS_FORMAT,
    formatVersion: input.formatVersion ?? INPUT_ACTIONS_FORMAT_VERSION,
    controlSchemes: input.controlSchemes ?? [],
    maps: input.maps,
  };
}
