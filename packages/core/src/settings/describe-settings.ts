import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { annotatedFieldJsonSchema, describeSchema, toJsonSchema } from "../schema/describe.js";
import { encodeValue } from "../schema/encode.js";
import { SettingsStore } from "./settings-store.js";
import type { SettingsSection } from "./settings-store.js";
import type { App } from "../app/types.js";
import type { JsonSchemaObject, SchemaDescription, SchemaFieldDescription } from "../schema/describe.js";
import type { ReferenceEncoder } from "../schema/encode.js";
import type { JsonValue } from "../schema/json.js";
import type { FieldKind, Schema } from "../schema/types.js";

/**
 * The `format` every settings section description carries, so a consumer that merges settings and
 * component descriptions can tell them apart.
 *
 * @public
 */
export const SETTINGS_DESCRIPTION_FORMAT = "settings";

/**
 * Whether a single field of each kind may stand for its whole section: a one-field section may be
 * written as the field's value (`layers: ["Default"]`) only when that value cannot be mistaken for
 * the section's object form, so a kind whose JSON form may be an object never qualifies.
 */
const ALLOWS_SHORTHAND: Readonly<Record<FieldKind, boolean>> = {
  f32: true,
  f64: true,
  i32: true,
  u32: true,
  bool: true,
  str: true,
  vec2: true,
  vec3: true,
  vec4: true,
  quat: true,
  color: true,
  enum: true,
  array: true,
  layerMask: true,
  entityRef: false,
  componentRef: false,
  asset: false,
  record: false,
  map: false,
  optional: false,
  curve: false,
  custom: false,
};

/**
 * Settings defaults hold no entity or component references, so every reference encodes to `null`.
 *
 * @returns An encoder that resolves every reference to `null`.
 */
function noReferences(): ReferenceEncoder {
  return { entityUid: () => null, componentUid: () => null };
}

/**
 * Reaches the settings table behind `app.settings`.
 *
 * @param app - The app.
 * @returns The table.
 * @throws IgnifxError with code `IGX-0702` when the app was not created by this copy of core.
 */
function settingsStoreOf(app: App): SettingsStore {
  const { settings } = app;
  if (settings instanceof SettingsStore) {
    return settings;
  }
  throw new IgnifxError(CoreErrorCode.invalidRuntime, "app.settings was not created by this copy of @ignifx/core.", {
    context: { member: "app.settings" },
    hint: "Describe the settings of an app createApp returned.",
  });
}

/**
 * Describes one section, with the defaults its owner registered rather than the schema's own field
 * defaults, because the registered bag is what the project gets for a value it omits.
 *
 * @param name - The section name.
 * @param section - The registered section.
 * @returns The description.
 */
function describeSection(name: string, section: SettingsSection): SchemaDescription {
  const described = describeSchema(name, section.schema, {
    title: name,
    format: SETTINGS_DESCRIPTION_FORMAT,
    package: section.owner,
  });
  const fields: Record<string, SchemaFieldDescription> = {};
  for (const [fieldName, description] of Object.entries(described.fields)) {
    const field = section.schema[fieldName];
    const registered = section.defaults[fieldName];
    fields[fieldName] =
      field === undefined || registered === undefined
        ? description
        : { ...description, default: encodeValue(field, registered, noReferences()) };
  }
  return { ...described, fields };
}

/**
 * Describes every project settings section an app has registered (core's own `layers`,
 * `sortingLayers`, `time`, `assets` and `rendering`, and every section an extension declared with
 * `ctx.registerSettings`) in the same shape {@link describeRegisteredSchemas} describes components.
 * This is what an external settings panel, such as the ignifx editor's, is generated from.
 *
 * @remarks
 * Each entry is keyed and titled by its section name, has `format: "settings"`
 * ({@link SETTINGS_DESCRIPTION_FORMAT}), and names the extension that registered it as `package`
 * (`@ignifx/core`, `@ignifx/physics`). A field's `default` is the value the owner registered for it,
 * which is what the project gets when it omits the field.
 *
 * The registration seam is `ctx.registerSettings(section, schema, defaults)`: an extension that
 * declares a section there is described here with no further work. A section is written in project
 * settings (`ignifx.settings.json` or `ignifx.config.ts`) as an object of these fields; a section
 * with exactly one field of a non-object kind may also be written as that field's value.
 *
 * @param app - The app whose sections to describe; its extensions have all registered by the time
 * `createApp` resolves.
 * @returns The descriptions, keyed by section name, in registration order.
 * @throws IgnifxError with code `IGX-0702` when `app` was not created by this copy of
 * `@ignifx/core`.
 *
 * @example
 * ```ts
 * const sections = describeSettings(app);
 * sections["time"]?.package; // "@ignifx/core"
 * sections["time"]?.fields["fixedDeltaTime"]?.default; // 0.016667, canonical JSON
 * ```
 *
 * @public
 */
export function describeSettings(app: App): Readonly<Record<string, SchemaDescription>> {
  const described: Record<string, SchemaDescription> = {};
  for (const [name, section] of settingsStoreOf(app).registrations()) {
    described[name] = describeSection(name, section);
  }
  return described;
}

/**
 * The JSON Schema of one section as project settings may write it: the object form, or, for a
 * single field of a non-object kind, also that field's value on its own.
 *
 * @param schema - The section's schema.
 * @returns The fragment.
 */
function sectionJsonSchema(schema: Schema): JsonSchemaObject {
  const objectForm = toJsonSchema(schema);
  const names = Object.keys(schema);
  const only = names[0];
  const field = only === undefined ? undefined : schema[only];
  if (names.length !== 1 || only === undefined || field === undefined || !ALLOWS_SHORTHAND[field.kind]) {
    return objectForm;
  }
  return { oneOf: [objectForm, annotatedFieldJsonSchema(field)] };
}

/**
 * Generates the JSON Schema (draft 2020-12) of a project's settings object, the content of
 * `ignifx.settings.json`, from every section the app registered. Pass it to the Vite plugin as
 * `ignifx({ schemas: { settings } })` to validate the project settings at build time, or associate
 * it with `ignifx.settings.json` in a text editor.
 *
 * @remarks
 * Every section is optional, a section omitted takes its defaults, and an unknown section is a
 * violation, which matches what `createApp` enforces at runtime (`IGX-0407`, `IGX-0408`).
 *
 * @param app - The app whose sections to describe.
 * @returns The object schema, one property per section.
 * @throws IgnifxError with code `IGX-0702` when `app` was not created by this copy of
 * `@ignifx/core`.
 *
 * @example
 * ```ts
 * const schema = settingsJsonSchema(app);
 * Object.keys(schema["properties"] ?? {}); // ["layers", "sortingLayers", "time", "assets", "rendering"]
 * ```
 *
 * @public
 */
export function settingsJsonSchema(app: App): JsonSchemaObject {
  const properties: Record<string, JsonValue> = {};
  for (const [name, section] of settingsStoreOf(app).registrations()) {
    properties[name] = sectionJsonSchema(section.schema);
  }
  return { type: "object", properties, additionalProperties: false };
}
