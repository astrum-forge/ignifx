import { inputError, InputErrorCode } from "../errors.js";
import type { ActionMap } from "../actions/action-map.js";

/**
 * Binding override persistence (`docs/architecture/08-input.md` §6). `saveOverrides()` produces a
 * small JSON document a template stores through `app.storage`; `loadOverrides(json)` puts it back.
 *
 * The document names bindings by `(map, action, bindingIndex)` rather than by their declared path,
 * so re-ordering an action's bindings in the `.input.json` invalidates saved overrides loudly
 * rather than silently rebinding the wrong control.
 */

/**
 * The `format` discriminator of an override document.
 *
 * @public
 */
export const INPUT_OVERRIDES_FORMAT = "ignifx.inputoverrides";

/**
 * The override format version this build reads and writes.
 *
 * @public
 */
export const INPUT_OVERRIDES_FORMAT_VERSION = 1;

/**
 * One overridden binding.
 *
 * @public
 */
export interface InputOverrideEntry {
  /** The map the action belongs to. */
  readonly map: string;
  /** The action name. */
  readonly action: string;
  /** Which of the action's bindings is overridden. */
  readonly bindingIndex: number;
  /** The path the binding now reads. */
  readonly path: string;
}

/**
 * A saved set of binding overrides.
 *
 * @example
 * ```ts
 * const saved = app.input.saveOverrides();
 * localStorage.setItem("bindings", JSON.stringify(saved));
 * ```
 *
 * @public
 */
export interface InputOverridesJson {
  /** Always `ignifx.inputoverrides`. Typed as a string because the value is read back from JSON. */
  readonly format: string;
  /** The format version; `1` before ignifx 1.0. */
  readonly formatVersion: number;
  /** The overridden bindings. */
  readonly overrides: readonly InputOverrideEntry[];
}

/**
 * Collects every override currently applied.
 *
 * @param maps - The installed action maps.
 * @returns The document to persist.
 *
 * @public
 */
export function collectOverrides(maps: ReadonlyMap<string, ActionMap>): InputOverridesJson {
  const overrides: InputOverrideEntry[] = [];
  for (const map of maps.values()) {
    for (const action of map.actions.values()) {
      for (let index = 0; index < action.bindings.length; index += 1) {
        const path = action.bindings[index]?.overridePath ?? null;
        if (path !== null) {
          overrides.push({ map: map.name, action: action.name, bindingIndex: index, path });
        }
      }
    }
  }
  return { format: INPUT_OVERRIDES_FORMAT, formatVersion: INPUT_OVERRIDES_FORMAT_VERSION, overrides };
}

/**
 * Applies a saved override document, clearing whatever was applied before.
 *
 * @param maps - The installed action maps.
 * @param json - The document from {@link collectOverrides}.
 * @throws IgnifxError with code `IGX-0808` when the document is not an `ignifx.inputoverrides`
 * document this build can read, or names a map, action, or binding that does not exist.
 *
 * @public
 */
export function applyOverrides(maps: ReadonlyMap<string, ActionMap>, json: InputOverridesJson): void {
  if (json.format !== INPUT_OVERRIDES_FORMAT || json.formatVersion !== INPUT_OVERRIDES_FORMAT_VERSION) {
    throw inputError(InputErrorCode.invalidOverrides, "The document is not ignifx.inputoverrides version 1.", {
      context: { file: json.format, formatVersion: json.formatVersion },
      hint: "Save it with app.input.saveOverrides(); older documents are discarded before 1.0.",
    });
  }
  clearOverrides(maps);
  for (const entry of json.overrides) {
    const map = maps.get(entry.map);
    const action = map?.actions.get(entry.action);
    const binding = action?.bindings[entry.bindingIndex];
    if (binding === undefined) {
      throw inputError(InputErrorCode.invalidOverrides, "A saved override names a binding that no longer exists.", {
        context: {
          file: INPUT_OVERRIDES_FORMAT,
          map: entry.map,
          action: entry.action,
          bindingIndex: entry.bindingIndex,
        },
        hint: "Discard saved overrides when the .input.json document changes its binding order.",
      });
    }
    binding.overridePath = entry.path;
  }
}

/**
 * Removes every override, returning each binding to its declared path.
 *
 * @param maps - The installed action maps.
 *
 * @public
 */
export function clearOverrides(maps: ReadonlyMap<string, ActionMap>): void {
  for (const map of maps.values()) {
    for (const action of map.actions.values()) {
      for (const binding of action.bindings) {
        binding.overridePath = null;
      }
    }
  }
}
