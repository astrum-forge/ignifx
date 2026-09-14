import { assertNever, encodeValue } from "@ignifx/core";
import { element, setText } from "../dom/elements.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import { devtoolsError, DevtoolsErrorCode } from "../errors.js";
import type { DevtoolsPanelHost } from "../overlay/panel.js";
import type { Component, FieldDefinition, ReferenceEncoder } from "@ignifx/core";

/**
 * Edit supported schema fields through ordinary property assignments, just as scene loading does.
 * Complex values remain read-only JSON; optional fields add a null toggle. Field metadata controls
 * visibility, editability, tooltips, numeric ranges, and grouping.
 */

/** How references encode when the inspector shows a field as JSON: it is a view, not a file. */
const DISPLAY_REFERENCES: ReferenceEncoder = {
  entityUid: (): string | null => null,
  componentUid: (): string | null => null,
};

/** The component names of the vector kinds, in order. */
const VECTOR_AXES: readonly string[] = ["x", "y", "z", "w"];

/** The channel names of a color, in order. */
const COLOR_CHANNELS: readonly string[] = ["r", "g", "b", "a"];

/** One live control bound to one schema field. */
export interface FieldEditor {
  /** The row element, already appended to the panel. */
  readonly row: HTMLElement;
  /** The inspector group the field belongs to, or `""` for the ungrouped ones. */
  readonly group: string;
  /** Rewrites the control from the component's current value. */
  refresh(): void;
}

/**
 * Reads a schema field off a live component.
 *
 * @param component - The component.
 * @param name - The field name.
 * @returns The current value.
 *
 * @internal
 */
export function readField(component: Component, name: string): unknown {
  return Reflect.get(component, name);
}

/**
 * Writes a schema field onto a live component, the same way the scene loader does.
 *
 * @param host - The panel host, so a failure is reported rather than thrown into the frame.
 * @param component - The component to write.
 * @param label - The component's display name, for the error's context.
 * @param name - The field name.
 * @param value - The new value.
 * @returns `true` when the write happened.
 *
 * @internal
 */
export function writeField(
  host: DevtoolsPanelHost,
  component: Component,
  label: string,
  name: string,
  value: unknown,
): boolean {
  try {
    Reflect.set(component, name, value);
    return true;
  } catch (error: unknown) {
    host.report(
      devtoolsError(DevtoolsErrorCode.fieldWriteFailed, `${label}.${name} rejected the value the inspector wrote.`, {
        context: { component: label, field: name },
        cause: error,
      }),
    );
    return false;
  }
}

/**
 * Renders a field's value as the JSON a scene file would carry.
 *
 * @param field - The field definition.
 * @param value - The current value.
 * @returns The JSON text, or `"<unencodable>"` when the field's codec refuses it.
 *
 * @internal
 */
export function encodeForDisplay(field: FieldDefinition<unknown>, value: unknown): string {
  try {
    return JSON.stringify(encodeValue(field, value, DISPLAY_REFERENCES));
  } catch {
    return "<unencodable>";
  }
}

/** What {@link createFieldEditor} needs. */
export interface FieldEditorOptions {
  /** The panel host. */
  readonly host: DevtoolsPanelHost;
  /** The component being edited. */
  readonly component: Component;
  /** The component's display name. */
  readonly label: string;
  /** The field name. */
  readonly name: string;
  /** The field definition from the component's schema. */
  readonly field: FieldDefinition<unknown>;
}

/**
 * Builds the row and control for one schema field.
 *
 * @param options - The host, the component, and the field.
 * @returns The editor, or `null` when `FieldOptions.hidden` drops the field.
 *
 * @internal
 */
export function createFieldEditor(options: FieldEditorOptions): FieldEditor | null {
  const { host, field, name } = options;
  if (field.options.hidden === true) {
    return null;
  }
  const document = host.document;
  const row = element(document, "div", DEVTOOLS_CLASS_NAMES.row);
  const label = element(document, "span", DEVTOOLS_CLASS_NAMES.label);
  label.textContent = name;
  const tooltip = field.options.tooltip;
  if (tooltip !== undefined) {
    row.title = tooltip;
  }
  const holder = element(document, "span", DEVTOOLS_CLASS_NAMES.value);
  row.append(label, holder);
  const refresh = buildControl(options, holder);
  const editor: FieldEditor = { row, group: field.options.group ?? "", refresh };
  editor.refresh();
  return editor;
}

/**
 * Builds the control for one field and returns the function that re-reads it.
 *
 * @param options - The host, the component, and the field.
 * @param holder - The element the control is appended to.
 * @returns The refresh function.
 */
function buildControl(options: FieldEditorOptions, holder: HTMLElement): () => void {
  const { field } = options;
  const spec = field.spec;
  switch (spec.kind) {
    case "f32":
    case "f64":
    case "i32":
    case "u32": {
      return numberControl(options, holder, spec.kind === "i32" || spec.kind === "u32");
    }
    case "bool": {
      return boolControl(options, holder);
    }
    case "str": {
      return stringControl(options, holder);
    }
    case "enum": {
      return enumControl(options, holder, spec.values);
    }
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat": {
      return tupleControl(options, holder, VECTOR_AXES.slice(0, spec.components));
    }
    case "color": {
      return tupleControl(options, holder, COLOR_CHANNELS);
    }
    case "asset": {
      return assetControl(options, holder);
    }
    case "entityRef":
    case "componentRef": {
      return referenceControl(options, holder);
    }
    case "optional":
    case "array":
    case "record":
    case "map":
    case "layerMask":
    case "curve":
    case "custom": {
      return jsonControl(options, holder);
    }
    default: {
      return assertNever(spec, "schema field kind");
    }
  }
}

/**
 * Whether a field forbids editing.
 *
 * @param options - The field being built.
 * @returns `true` when the schema marks it `readonly`.
 */
function isReadonly(options: FieldEditorOptions): boolean {
  return options.field.options.readonly === true;
}

/**
 * Creates an `<input>` with the shared class, wired to `disabled` for read-only fields.
 *
 * @param options - The field being built.
 * @param type - The input type.
 * @returns The input.
 */
function makeInput(options: FieldEditorOptions, type: string): HTMLInputElement {
  const input = element(options.host.document, "input", DEVTOOLS_CLASS_NAMES.input);
  input.type = type;
  input.disabled = isReadonly(options);
  return input;
}

/**
 * Builds a numeric input honouring `min`, `max` and `step`.
 *
 * @param options - The field being built.
 * @param holder - Where the control goes.
 * @param integral - Whether the value is rounded to an integer on write.
 * @returns The refresh function.
 */
function numberControl(options: FieldEditorOptions, holder: HTMLElement, integral: boolean): () => void {
  const { host, component, label, name, field } = options;
  const input = makeInput(options, "number");
  const { min, max, step } = field.options;
  if (min !== undefined) {
    input.min = String(min);
  }
  if (max !== undefined) {
    input.max = String(max);
  }
  input.step = step === undefined ? (integral ? "1" : "any") : String(step);
  input.addEventListener("change", (): void => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const clamped = clamp(integral ? Math.round(parsed) : parsed, min, max);
    writeField(host, component, label, name, clamped);
  });
  holder.append(input);
  return (): void => {
    const value = readField(component, name);
    const text = typeof value === "number" ? String(value) : "";
    if (input.value !== text) {
      input.value = text;
    }
  };
}

/**
 * Clamps a number into the schema's declared bounds.
 *
 * @param value - The value.
 * @param min - The lower bound, when declared.
 * @param max - The upper bound, when declared.
 * @returns The clamped value.
 */
function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let out = value;
  if (min !== undefined && out < min) {
    out = min;
  }
  if (max !== undefined && out > max) {
    out = max;
  }
  return out;
}

/**
 * Builds a checkbox.
 *
 * @param options - The field being built.
 * @param holder - Where the control goes.
 * @returns The refresh function.
 */
function boolControl(options: FieldEditorOptions, holder: HTMLElement): () => void {
  const { host, component, label, name } = options;
  const input = makeInput(options, "checkbox");
  input.addEventListener("change", (): void => {
    writeField(host, component, label, name, input.checked);
  });
  holder.append(input);
  return (): void => {
    const value = readField(component, name) === true;
    if (input.checked !== value) {
      input.checked = value;
    }
  };
}

/**
 * Builds a text input.
 *
 * @param options - The field being built.
 * @param holder - Where the control goes.
 * @returns The refresh function.
 */
function stringControl(options: FieldEditorOptions, holder: HTMLElement): () => void {
  const { host, component, label, name } = options;
  const input = makeInput(options, "text");
  input.addEventListener("change", (): void => {
    writeField(host, component, label, name, input.value);
  });
  holder.append(input);
  return (): void => {
    const value = readField(component, name);
    const text = typeof value === "string" ? value : "";
    if (input.value !== text) {
      input.value = text;
    }
  };
}

/**
 * Builds a `<select>` over the enum's declared values.
 *
 * @param options - The field being built.
 * @param holder - Where the control goes.
 * @param values - The declared values.
 * @returns The refresh function.
 */
function enumControl(options: FieldEditorOptions, holder: HTMLElement, values: readonly string[]): () => void {
  const { host, component, label, name } = options;
  const select = element(host.document, "select", DEVTOOLS_CLASS_NAMES.input);
  select.disabled = isReadonly(options);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? "";
    const option = element(host.document, "option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  select.addEventListener("change", (): void => {
    writeField(host, component, label, name, select.value);
  });
  holder.append(select);
  return (): void => {
    const value = readField(component, name);
    const text = typeof value === "string" ? value : "";
    if (select.value !== text) {
      select.value = text;
    }
  };
}

/**
 * Builds one numeric input per component of a vector, quaternion, or color.
 *
 * @param options - The field being built.
 * @param holder - Where the controls go.
 * @param axes - The component names, in order.
 * @returns The refresh function.
 */
function tupleControl(options: FieldEditorOptions, holder: HTMLElement, axes: readonly string[]): () => void {
  const { host, component, label, name, field } = options;
  const inputs: HTMLInputElement[] = [];
  for (let index = 0; index < axes.length; index += 1) {
    const axis = axes[index] ?? "";
    const input = makeInput(options, "number");
    input.step = field.options.step === undefined ? "any" : String(field.options.step);
    input.title = axis;
    input.addEventListener("change", (): void => {
      const current = readField(component, name);
      if (current === null || typeof current !== "object") {
        return;
      }
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed)) {
        return;
      }
      const next: Record<string, number> = {};
      for (let at = 0; at < axes.length; at += 1) {
        const key = axes[at] ?? "";
        const existing: unknown = Reflect.get(current, key);
        next[key] = at === index ? parsed : typeof existing === "number" ? existing : 0;
      }
      writeField(host, component, label, name, next);
    });
    inputs.push(input);
    holder.append(input);
  }
  return (): void => {
    const value = readField(component, name);
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const axis = axes[index] ?? "";
      const axisValue: unknown = value === null || typeof value !== "object" ? undefined : Reflect.get(value, axis);
      const text = typeof axisValue === "number" ? String(round(axisValue)) : "";
      if (input !== undefined && input.value !== text) {
        input.value = text;
      }
    }
  };
}

/** How many decimals a vector component is shown with. Enough to see a millimetre at world scale. */
const DISPLAY_DECIMALS = 4;

/**
 * Rounds a number for display without turning `1` into `"1.0000"`.
 *
 * @param value - The value.
 * @returns The rounded value.
 */
function round(value: number): number {
  return Number(value.toFixed(DISPLAY_DECIMALS));
}

/**
 * Builds the address box of an `asset()` field. Typing an address loads it through `app.assets`,
 * which is the same call a scene file's `{ "$asset": … }` ends up making.
 *
 * @param options - The field being built.
 * @param holder - Where the control goes.
 * @returns The refresh function.
 */
function assetControl(options: FieldEditorOptions, holder: HTMLElement): () => void {
  const { host, component, label, name } = options;
  const input = makeInput(options, "text");
  input.placeholder = "address";
  input.addEventListener("change", (): void => {
    const address = input.value.trim();
    if (address === "") {
      writeField(host, component, label, name, null);
      return;
    }
    writeField(host, component, label, name, host.app.assets.load(address));
  });
  holder.append(input);
  return (): void => {
    const value = readField(component, name);
    const address: unknown = value === null || typeof value !== "object" ? "" : Reflect.get(value, "address");
    const text = typeof address === "string" ? address : "";
    if (input.value !== text) {
      input.value = text;
    }
  };
}

/**
 * Builds the display of an `entityRef()` or `componentRef()` field, with a button that points it at
 * the entity the scene tree currently has selected.
 *
 * @param options - The field being built.
 * @param holder - Where the control goes.
 * @returns The refresh function.
 */
function referenceControl(options: FieldEditorOptions, holder: HTMLElement): () => void {
  const { host, component, label, name } = options;
  const text = element(host.document, "span");
  const assign = element(host.document, "button", DEVTOOLS_CLASS_NAMES.button);
  assign.type = "button";
  assign.textContent = "= selection";
  assign.disabled = isReadonly(options);
  assign.addEventListener("click", (): void => {
    writeField(host, component, label, name, host.selected);
  });
  holder.append(text, assign);
  return (): void => {
    const value = readField(component, name);
    const named: unknown = value === null || typeof value !== "object" ? null : Reflect.get(value, "name");
    setText(text, typeof named === "string" ? named : "null");
  };
}

/**
 * Builds the read-only JSON display used by the kinds that have no inline editor.
 *
 * @param options - The field being built.
 * @param holder - Where the control goes.
 * @returns The refresh function.
 */
function jsonControl(options: FieldEditorOptions, holder: HTMLElement): () => void {
  const { host, component, name, field } = options;
  const text = element(host.document, "span");
  holder.append(text);
  return (): void => {
    setText(text, encodeForDisplay(field, readField(component, name)));
  };
}
