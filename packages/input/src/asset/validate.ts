import { inputError, InputErrorCode } from "../errors.js";
import { INPUT_ACTIONS_FORMAT, INPUT_ACTIONS_FORMAT_VERSION } from "./definition.js";
import type {
  ActionDefinition,
  ActionMapDefinition,
  BindingDefinition,
  ControlSchemeDefinition,
  InputActionsDefinition,
  InputActionType,
} from "./definition.js";

/**
 * Structural validation of an `ignifx.inputactions` document
 * (`docs/architecture/06-serialization-and-scene-format.md` §6: every format shares the
 * `format`/`formatVersion` header and JSON Schema validation).
 *
 * The loader validates the *shape* here and hands the result to `app.input.loadActions`, which is
 * what validates the *content*: a binding path that names no control is `IGX-0803`, not `IGX-0805`,
 * because the document is well-formed and the path is wrong.
 */

/** The action types a document may declare. */
const ACTION_TYPES: readonly InputActionType[] = Object.freeze(["button", "axis", "vector2"]);

/** The string-valued keys of a binding, so validation reads them in one loop. */
const BINDING_STRING_KEYS = [
  "path",
  "composite",
  "up",
  "down",
  "left",
  "right",
  "negative",
  "positive",
  "modifier",
  "button",
  "scheme",
] as const;

/** The mutable form validation builds before handing back a {@link BindingDefinition}. */
type MutableBinding = { -readonly [K in keyof BindingDefinition]: BindingDefinition[K] };

/**
 * Narrows an unknown value to a plain object.
 *
 * @param value - The value to test.
 * @returns The value as a record, or `null`.
 */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // Boundary assertion (coding standards §5.2): the invariant is the `typeof`/`Array.isArray` pair
  // above, which is exactly what makes a value an index-readable plain object.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Readonly<Record<string, unknown>>;
}

/**
 * Reads a required string property.
 *
 * @param record - The object to read from.
 * @param key - The property name.
 * @param where - What is being validated, for the error message.
 * @param file - The address, for the error context.
 * @returns The string.
 * @throws IgnifxError with code `IGX-0805` when the property is missing or not a string.
 */
function requiredString(record: Readonly<Record<string, unknown>>, key: string, where: string, file: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") {
    throw invalid(file, `${where} is missing its ${key}.`);
  }
  return value;
}

/**
 * Reads an optional string property.
 *
 * @param record - The object to read from.
 * @param key - The property name.
 * @returns The string, or `undefined` when the property is absent.
 */
function optionalString(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Builds the `IGX-0805` failure.
 *
 * @param file - The address being validated.
 * @param detail - What is wrong with it.
 * @returns The error to throw.
 */
function invalid(file: string, detail: string): Error {
  return inputError(InputErrorCode.invalidActionsFile, detail, {
    context: { file },
    hint: `An input actions document declares format "${INPUT_ACTIONS_FORMAT}", formatVersion ${String(INPUT_ACTIONS_FORMAT_VERSION)}, and a maps array.`,
  });
}

/**
 * Validates one binding.
 *
 * @param value - The raw binding.
 * @param where - What is being validated, for the error message.
 * @param file - The address, for the error context.
 * @returns The binding definition.
 * @throws IgnifxError with code `IGX-0805` when the binding is not an object, or declares neither a
 * path nor a composite.
 */
function validateBinding(value: unknown, where: string, file: string): BindingDefinition {
  const record = asRecord(value);
  if (record === null) {
    throw invalid(file, `${where} has a binding that is not an object.`);
  }
  const binding: MutableBinding = {};
  for (const key of BINDING_STRING_KEYS) {
    const text = optionalString(record, key);
    if (text !== undefined) {
      binding[key] = text;
    }
  }
  if (binding.path === undefined && binding.composite === undefined) {
    throw invalid(file, `${where} has a binding with neither a path nor a composite.`);
  }
  const processorsRaw = record["processors"];
  if (Array.isArray(processorsRaw)) {
    const processors: string[] = [];
    for (const entry of processorsRaw) {
      if (typeof entry !== "string") {
        throw invalid(file, `${where} has a processor that is not a string.`);
      }
      processors.push(entry);
    }
    binding.processors = processors;
  }
  return binding;
}

/**
 * Validates one action.
 *
 * @param value - The raw action.
 * @param mapName - The map it belongs to, for the error message.
 * @param file - The address, for the error context.
 * @returns The action definition.
 * @throws IgnifxError with code `IGX-0805` when the action is malformed.
 */
function validateAction(value: unknown, mapName: string, file: string): ActionDefinition {
  const record = asRecord(value);
  if (record === null) {
    throw invalid(file, `The ${mapName} map has an action that is not an object.`);
  }
  const name = requiredString(record, "name", `An action of the ${mapName} map`, file);
  const rawType = optionalString(record, "type");
  const type = ACTION_TYPES.find((candidate): boolean => candidate === rawType);
  if (rawType !== undefined && type === undefined) {
    throw invalid(file, `The ${name} action declares the unknown type ${rawType}.`);
  }
  const bindingsRaw = record["bindings"];
  if (!Array.isArray(bindingsRaw)) {
    throw invalid(file, `The ${name} action has no bindings array.`);
  }
  const bindings: BindingDefinition[] = [];
  for (const binding of bindingsRaw) {
    bindings.push(validateBinding(binding, `The ${name} action`, file));
  }
  return { name, ...(type === undefined ? {} : { type }), bindings };
}

/**
 * Validates one action map.
 *
 * @param value - The raw map.
 * @param file - The address, for the error context.
 * @returns The map definition.
 * @throws IgnifxError with code `IGX-0805` when the map is malformed.
 */
function validateMap(value: unknown, file: string): ActionMapDefinition {
  const record = asRecord(value);
  if (record === null) {
    throw invalid(file, "The document has a map that is not an object.");
  }
  const name = requiredString(record, "name", "A map", file);
  const actionsRaw = record["actions"];
  if (!Array.isArray(actionsRaw)) {
    throw invalid(file, `The ${name} map has no actions array.`);
  }
  const actions: ActionDefinition[] = [];
  for (const action of actionsRaw) {
    actions.push(validateAction(action, name, file));
  }
  const enabled = record["enabled"];
  return { name, ...(typeof enabled === "boolean" ? { enabled } : {}), actions };
}

/**
 * Validates one control scheme.
 *
 * @param value - The raw scheme.
 * @param file - The address, for the error context.
 * @returns The scheme definition.
 * @throws IgnifxError with code `IGX-0805` when the scheme is malformed.
 */
function validateScheme(value: unknown, file: string): ControlSchemeDefinition {
  const record = asRecord(value);
  if (record === null) {
    throw invalid(file, "The document has a control scheme that is not an object.");
  }
  const name = requiredString(record, "name", "A control scheme", file);
  const devicesRaw = record["devices"];
  if (!Array.isArray(devicesRaw)) {
    throw invalid(file, `The ${name} control scheme has no devices array.`);
  }
  const devices: string[] = [];
  for (const device of devicesRaw) {
    if (typeof device !== "string") {
      throw invalid(file, `The ${name} control scheme lists a device that is not a string.`);
    }
    devices.push(device);
  }
  return { name, devices };
}

/**
 * Validates a whole `ignifx.inputactions` document.
 *
 * @param value - The parsed JSON.
 * @param file - The address the document came from, for error context.
 * @returns The validated document.
 * @throws IgnifxError with code `IGX-0805` when the header is wrong or the shape is malformed.
 *
 * @example
 * ```ts
 * const document = validateInputActions(await ctx.fetchJson(), ctx.address);
 * ```
 *
 * @public
 */
export function validateInputActions(value: unknown, file: string): InputActionsDefinition {
  const record = asRecord(value);
  if (record === null) {
    throw invalid(file, "The document is not a JSON object.");
  }
  if (record["format"] !== INPUT_ACTIONS_FORMAT) {
    throw invalid(file, `${file} is not an ${INPUT_ACTIONS_FORMAT} document.`);
  }
  if (record["formatVersion"] !== INPUT_ACTIONS_FORMAT_VERSION) {
    throw invalid(file, `${file} declares a format version this build cannot read.`);
  }
  const mapsRaw = record["maps"];
  if (!Array.isArray(mapsRaw)) {
    throw invalid(file, `${file} has no maps array.`);
  }
  const maps: ActionMapDefinition[] = [];
  for (const map of mapsRaw) {
    maps.push(validateMap(map, file));
  }
  const schemesRaw = record["controlSchemes"];
  const controlSchemes: ControlSchemeDefinition[] = [];
  if (Array.isArray(schemesRaw)) {
    for (const scheme of schemesRaw) {
      controlSchemes.push(validateScheme(scheme, file));
    }
  }
  return { format: INPUT_ACTIONS_FORMAT, formatVersion: INPUT_ACTIONS_FORMAT_VERSION, controlSchemes, maps };
}
