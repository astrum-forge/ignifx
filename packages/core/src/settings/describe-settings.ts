import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { describeSchema } from "../schema/describe.js";
import { settingsFieldJsonSchema, settingsObjectJsonSchema, settingsValueToJson } from "./settings-json.js";
import { SettingsStore } from "./settings-store.js";
import type { SettingsSection } from "./settings-store.js";
import type { App } from "../app/types.js";
import type { JsonSchemaObject, SchemaDescription, SchemaFieldDescription } from "../schema/describe.js";
import type { JsonValue } from "../schema/json.js";
import type { FieldDefinition, FieldKind } from "../schema/types.js";

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
 * the section's object form, so a kind whose runtime form may be an object (a vector or colour is
 * `{ x, y, z }` or `{ r, g, b, a }` in settings) never qualifies.
 */
const ALLOWS_SHORTHAND: Readonly<Record<FieldKind, boolean>> = {
  f32: true,
  f64: true,
  i32: true,
  u32: true,
  bool: true,
  str: true,
  vec2: false,
  vec3: false,
  vec4: false,
  quat: false,
  color: false,
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
  for (const [fieldName, field] of Object.entries(section.schema)) {
    const description = described.fields[fieldName];
    if (description !== undefined) {
      fields[fieldName] = settingsFieldDescription(field, description, section.defaults[fieldName]);
    }
  }
  return { ...described, fields };
}

/**
 * Rewrites a field description's defaults, at every depth, into the runtime form settings are
 * written in: `{ x, y, z }` rather than the scene file's `[x, y, z]`.
 *
 * @param field - The field.
 * @param description - Its description, with defaults in the scene-file form.
 * @param value - The runtime default, or `undefined` to leave `default` off.
 * @returns The description in the settings form.
 */
function settingsFieldDescription(
  field: FieldDefinition<unknown>,
  description: SchemaFieldDescription,
  value: unknown,
): SchemaFieldDescription {
  const { default: _encoded, item, fields, value: entry, inner, ...rest } = description;
  const { spec } = field;
  const converted = value === undefined ? undefined : settingsValueToJson(field, value);
  const nested: Partial<Record<"item" | "value" | "inner", SchemaFieldDescription>> & {
    fields?: Record<string, SchemaFieldDescription>;
  } = {};
  if (spec.kind === "array" && item !== undefined) {
    nested.item = settingsFieldDescription(spec.item, item, spec.item.createDefault());
  } else if (spec.kind === "map" && entry !== undefined) {
    nested.value = settingsFieldDescription(spec.value, entry, spec.value.createDefault());
  } else if (spec.kind === "optional" && inner !== undefined) {
    nested.inner = settingsFieldDescription(spec.inner, inner, spec.inner.createDefault());
  } else if (spec.kind === "record" && fields !== undefined) {
    nested.fields = {};
    for (const [name, sub] of Object.entries(spec.fields)) {
      const subDescription = fields[name];
      if (subDescription !== undefined) {
        nested.fields[name] = settingsFieldDescription(sub, subDescription, sub.createDefault());
      }
    }
  }
  return { ...rest, ...(converted === undefined ? {} : { default: converted }), ...nested };
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
 * which is what the project gets when it omits the field; a field the owner's defaults leave out has
 * no `default`, because the resolved section has no value for it either.
 *
 * Defaults are in the **settings form**, the form `createApp` reads, which differs from the scene
 * file's for vectors and colours: a `vec3` default is `{ "x": 0, "y": -9.81, "z": 0 }` and a `color`
 * default is `{ "r": 0, "g": 0, "b": 0, "a": 1 }`, not an array. A tool writes values back in this
 * form.
 *
 * The registration seam is `ctx.registerSettings(section, schema, defaults)`: an extension that
 * declares a section there is described here with no further work. A section is written in project
 * settings (`ignifx.settings.json` or `ignifx.config.ts`) as an object of these fields; a section
 * with exactly one field of a non-object kind (a number, string, enum or array, not a vector or
 * colour) may also be written as that field's value.
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
 * sections["time"]?.fields["fixedDeltaTime"]?.default; // 0.016666666666666666
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
 * @param section - The registered section.
 * @returns The fragment.
 */
function sectionJsonSchema(section: SettingsSection): JsonSchemaObject {
  const { schema, defaults } = section;
  const objectForm = settingsObjectJsonSchema(schema, defaults);
  const entries = Object.entries(schema);
  const [only] = entries;
  if (entries.length !== 1 || only === undefined || !ALLOWS_SHORTHAND[only[1].kind]) {
    return objectForm;
  }
  return { oneOf: [objectForm, settingsFieldJsonSchema(only[1], defaults[only[0]])] };
}

/**
 * Generates the JSON Schema (draft 2020-12) of a project's settings object, the content of
 * `ignifx.settings.json`, from every section the app registered. Pass it to the Vite plugin as
 * `ignifx({ schemas: { settings } })` to validate the project settings at build time, or associate
 * it with `ignifx.settings.json` in a text editor.
 *
 * @remarks
 * The schema describes the settings form `createApp` reads (vectors as `{ x, y, z }`, colours as
 * `{ r, g, b, a }` with every channel required), so a document it accepts also passes `createApp`'s
 * own validation (`IGX-0408`). Every section is optional and a section omitted takes its defaults.
 * An unknown key inside a section is a violation. The top level stays open: a section this app did
 * not register, perhaps one of an extension it lacks, is left to `createApp`, which reports it
 * (`IGX-0407`), and to the Vite plugin, which warns about it.
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
    properties[name] = sectionJsonSchema(section);
  }
  // The top level stays open: a section this app did not register may belong to an extension the
  // app lacks, and `createApp` itself only reports one (`IGX-0407`), so a tool warns about it
  // rather than failing on it.
  return { type: "object", properties };
}
