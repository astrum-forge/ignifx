import { assertNever } from "../errors/ignifx-error.js";
import { encodeValue } from "./encode.js";
import type { ReferenceEncoder } from "./encode.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { FieldDefinition, FieldKind, FieldOptions, Schema } from "./types.js";

/**
 * One field as the documentation harness and an external inspector see it (`scripts/README.md`,
 * "Schema discovery convention"; `docs/architecture/03-scripting-and-components.md` §3).
 *
 * Every member past `kind` is present only when the declaration states it: a field with no
 * `step` has no `step` here. The inspector members mirror {@link FieldOptions}; the others carry
 * what the field's kind declares: an enum's values, an asset's type, a nested field's own description.
 *
 * @public
 */
export interface SchemaFieldDescription {
  /** The field kind, for example `f32` or `asset`. */
  readonly kind: FieldKind;
  /** The field's default value, already encoded as JSON. */
  readonly default?: JsonValue;
  /** The field's tooltip, when it declares one. */
  readonly description?: string;
  /** `FieldOptions.min`: the lowest accepted value of a numeric field. */
  readonly min?: number;
  /** `FieldOptions.max`: the highest accepted value of a numeric field. */
  readonly max?: number;
  /**
   * `FieldOptions.step`: the increment of the inspector's drag and spinner controls; in degrees for
   * a `quat` field, which an inspector edits as Euler angles.
   */
  readonly step?: number;
  /** `FieldOptions.hidden`: the inspector leaves the field out; it is still saved. */
  readonly hidden?: boolean;
  /** `FieldOptions.readonly`: the inspector shows the field but does not let it be edited. */
  readonly readonly?: boolean;
  /** `FieldOptions.group`: the inspector group the field folds into. */
  readonly group?: string;
  /** `FieldOptions.transient`: the field is never saved and takes its default on load. */
  readonly transient?: boolean;
  /** An `enum` field's accepted values, in declaration order. */
  readonly values?: readonly string[];
  /**
   * An `asset` field's asset type name (`asset(TextureAsset)` → `"texture"`), the `type` an asset
   * reference to it carries. Absent when the asset token names no type.
   */
  readonly assetType?: string;
  /**
   * A `componentRef` field's accepted component, as its `typeId`, or `null` when the class it was
   * declared with carries no `typeId`. Present on every `componentRef` field.
   */
  readonly componentType?: string | null;
  /** An `array` field's element, described the same way. */
  readonly item?: SchemaFieldDescription;
  /** A `record` field's sub-fields, in declaration order, described the same way. */
  readonly fields?: Readonly<Record<string, SchemaFieldDescription>>;
  /** A `map` field's entry value, described the same way. */
  readonly value?: SchemaFieldDescription;
  /** An `optional` field's non-`null` value, described the same way. */
  readonly inner?: SchemaFieldDescription;
}

/**
 * One component schema as the documentation harness sees it. `pnpm docs:schemas` reads a record of
 * these, keyed by component `typeId`, from each built package's `schemas` export and turns it into
 * `references/formats/<format>.md` and `ignifx.schemas.json`.
 *
 * @public
 */
export interface SchemaDescription {
  /** The human-readable name, by default the last segment of the type id. */
  readonly title: string;
  /** The format page the entry is grouped onto; `components` unless overridden. */
  readonly format: string;
  /** A one-line summary of what the component does. */
  readonly description?: string;
  /** Every declared field, in declaration order. */
  readonly fields: Readonly<Record<string, SchemaFieldDescription>>;
  /**
   * Whether an entity may hold more than one of the component (`static allowMultiple`, `true` when
   * the class declares nothing). Set by {@link describeRegisteredSchemas}, or by the caller through
   * {@link SchemaDescriptionMeta}; absent on file formats.
   */
  readonly allowMultiple?: boolean;
  /**
   * Who registered the component: the extension's `name` (the npm package name, for example
   * `@ignifx/3d`), or, for a class the game registered itself, its type id's namespace (`mygame`).
   * Set by {@link describeRegisteredSchemas}, or by the caller through {@link SchemaDescriptionMeta}.
   */
  readonly package?: string;
  /**
   * `true` for the one component every entity carries itself, `ignifx/Transform`: it is never in a
   * scene file's `components` list, an editor cannot add or remove it, and its fields are the
   * entity record's `transform` block, edited whole (the editor protocol's `setTransform`), not
   * prop by prop. Absent on every other component and on file formats.
   */
  readonly builtIn?: boolean;
}

/**
 * Optional overrides for {@link describeSchema}.
 *
 * @public
 */
export interface SchemaDescriptionMeta {
  /** Overrides the title derived from the type id. */
  readonly title?: string;
  /** Overrides the default `components` grouping. */
  readonly format?: string;
  /** A one-line summary of what the component does. */
  readonly description?: string;
  /** Whether an entity may hold more than one of the component, copied onto the description. */
  readonly allowMultiple?: boolean;
  /** The package or extension that registered the component, copied onto the description. */
  readonly package?: string;
  /** Whether the component is the entity's own built-in block, copied onto the description. */
  readonly builtIn?: boolean;
}

/**
 * A JSON Schema fragment. Kept as a plain JSON object because the generated document is assembled
 * — and validated — by the documentation harness, not by this module
 * (`docs/architecture/06-serialization-and-scene-format.md` §8).
 *
 * @public
 */
export type JsonSchemaObject = JsonObject;

/**
 * Resolves references to nothing. Describing a schema means describing its *defaults*, and a
 * reference field's default is always `null`, so no world is needed.
 *
 * @returns An encoder that resolves every reference to `null`.
 *
 * @internal
 */
function noReferences(): ReferenceEncoder {
  return { entityUid: () => null, componentUid: () => null };
}

/**
 * Builds the JSON Schema fragment for one field, at any depth: its encoded form plus an
 * `x-ignifx-*` keyword for each inspector option it declares. JSON Schema validators ignore
 * keywords they do not know, and the `x-` prefix keeps these clear of any future standard one.
 *
 * @param field - The field to describe.
 * @returns The fragment.
 *
 * @internal
 */
function fieldJsonSchema(field: FieldDefinition<unknown>): JsonSchemaObject {
  const fragment: Record<string, JsonValue> = { ...kindJsonSchema(field) };
  const { step, hidden, readonly, group, transient } = field.options;
  if (step !== undefined) {
    fragment["x-ignifx-step"] = step;
  }
  if (hidden !== undefined) {
    fragment["x-ignifx-hidden"] = hidden;
  }
  if (readonly !== undefined) {
    fragment["x-ignifx-readonly"] = readonly;
    // `readOnly` is the standard annotation generic JSON Schema tools already understand.
    if (readonly) {
      fragment["readOnly"] = true;
    }
  }
  if (group !== undefined) {
    fragment["x-ignifx-group"] = group;
  }
  if (transient !== undefined) {
    fragment["x-ignifx-transient"] = transient;
  }
  return fragment;
}

/**
 * Builds the JSON Schema fragment for one field's encoded form.
 *
 * @param field - The field to describe.
 * @returns The fragment describing the field's encoded form.
 *
 * @internal
 */
function kindJsonSchema(field: FieldDefinition<unknown>): JsonSchemaObject {
  const { spec } = field;
  switch (spec.kind) {
    case "f32":
    case "f64": {
      return { type: "number" };
    }
    case "i32": {
      return { type: "integer", minimum: -2147483648, maximum: 2147483647 };
    }
    case "u32": {
      return { type: "integer", minimum: 0, maximum: 4294967295 };
    }
    case "bool": {
      return { type: "boolean" };
    }
    case "str": {
      return { type: "string" };
    }
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat": {
      return { type: "array", items: { type: "number" }, minItems: spec.components, maxItems: spec.components };
    }
    case "color": {
      return {
        type: "array",
        items: { type: "number", minimum: 0, maximum: 1 },
        minItems: 4,
        maxItems: 4,
      };
    }
    case "enum": {
      return { type: "string", enum: [...spec.values] };
    }
    case "entityRef": {
      return taggedReferenceSchema("$entity");
    }
    case "componentRef": {
      const typeId = spec.componentType.typeId;
      return {
        ...taggedReferenceSchema("$component"),
        ...(typeId === undefined ? {} : { "x-ignifx-component-type": typeId }),
      };
    }
    case "asset": {
      return {
        oneOf: [
          {
            type: "object",
            properties: { $asset: { type: "string" }, type: { type: "string" } },
            required: ["$asset"],
            additionalProperties: false,
          },
          { type: "null" },
        ],
        ...(spec.typeName === null ? {} : { "x-ignifx-asset-type": spec.typeName }),
      };
    }
    case "array": {
      return { type: "array", items: fieldJsonSchema(spec.item) };
    }
    case "record": {
      return schemaJsonSchema(spec.fields);
    }
    case "map": {
      return { type: "object", additionalProperties: fieldJsonSchema(spec.value) };
    }
    case "optional": {
      return { oneOf: [fieldJsonSchema(spec.inner), { type: "null" }] };
    }
    case "layerMask": {
      return { type: "array", items: { type: "string" } };
    }
    case "curve": {
      return {
        type: "object",
        properties: {
          keys: {
            type: "array",
            items: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
          },
        },
        required: ["keys"],
        additionalProperties: false,
      };
    }
    case "custom": {
      return spec.codec.jsonSchema ?? {};
    }
    default: {
      return assertNever(spec, "schema field kind");
    }
  }
}

/**
 * Builds the fragment for a tagged reference: an object carrying one uid property, or `null`.
 *
 * @param tag - The tag property, `$entity` or `$component`.
 * @returns The fragment.
 *
 * @internal
 */
function taggedReferenceSchema(tag: "$entity" | "$component"): JsonSchemaObject {
  return {
    oneOf: [
      {
        type: "object",
        properties: { [tag]: { type: "string" } },
        required: [tag],
        additionalProperties: false,
      },
      { type: "null" },
    ],
  };
}

/**
 * Decorates a field's fragment with the metadata the inspector and the docs already carry.
 *
 * @param field - The field to describe.
 * @returns The fragment plus `default`, `description`, and numeric bounds where they apply.
 *
 * @internal
 */
export function annotatedFieldJsonSchema(field: FieldDefinition<unknown>): JsonSchemaObject {
  const base: Record<string, JsonValue> = { ...fieldJsonSchema(field) };
  const { tooltip, min, max } = field.options;
  if (tooltip !== undefined) {
    base["description"] = tooltip;
  }
  if (min !== undefined) {
    base["minimum"] = min;
  }
  if (max !== undefined) {
    base["maximum"] = max;
  }
  base["default"] = encodeValue(field, field.createDefault(), noReferences());
  return base;
}

/**
 * Builds the object fragment for a whole schema.
 *
 * @param schema - The schema to describe.
 * @returns The fragment.
 *
 * @internal
 */
function schemaJsonSchema(schema: Schema): JsonSchemaObject {
  const properties: Record<string, JsonValue> = {};
  for (const [name, field] of Object.entries(schema)) {
    properties[name] = annotatedFieldJsonSchema(field);
  }
  // Every prop is optional: a file omits a prop that equals its default
  // (docs/architecture/06-serialization-and-scene-format.md §2), so there is no `required` list.
  return { type: "object", properties, additionalProperties: false };
}

/**
 * Describes a component schema in the shape the documentation harness and an external inspector
 * consume. A package exports a record of these keyed by `typeId`; `pnpm docs:schemas` reads it from
 * the built entry point and regenerates the format pages and `ignifx.schemas.json` from it
 * (`scripts/README.md`, `docs/architecture/16-docs-harness-and-skill.md` §3). Each field carries
 * its inspector options and what its kind declares ({@link SchemaFieldDescription}); to describe
 * an app's registered components with `allowMultiple` and `package` filled in, use
 * {@link describeRegisteredSchemas}.
 *
 * @param typeId - The component's namespaced registration id, for example `mygame/Mover`.
 * @param schema - The component's declared fields.
 * @param meta - Overrides for the title, format grouping, and summary, and the component's
 * `allowMultiple`, `package` and `builtIn` when the caller knows them.
 * @returns The description entry.
 *
 * @example
 * ```ts
 * export const schemas = {
 *   "mygame/Mover": describeSchema("mygame/Mover", moverSchema, { description: "Moves an entity." }),
 * };
 * ```
 *
 * @public
 */
export function describeSchema(typeId: string, schema: Schema, meta?: SchemaDescriptionMeta): SchemaDescription {
  const derivedTitle = typeId.slice(typeId.lastIndexOf("/") + 1);
  return {
    title: meta?.title ?? derivedTitle,
    format: meta?.format ?? "components",
    ...(meta?.description === undefined ? {} : { description: meta.description }),
    fields: describeFields(schema, noReferences()),
    ...(meta?.allowMultiple === undefined ? {} : { allowMultiple: meta.allowMultiple }),
    ...(meta?.package === undefined ? {} : { package: meta.package }),
    ...(meta?.builtIn === undefined ? {} : { builtIn: meta.builtIn }),
  };
}

/**
 * Describes every field of a schema, in declaration order.
 *
 * @param schema - The fields.
 * @param references - The encoder for the defaults.
 * @returns The descriptions, keyed by field name.
 *
 * @internal
 */
function describeFields(schema: Schema, references: ReferenceEncoder): Record<string, SchemaFieldDescription> {
  const fields: Record<string, SchemaFieldDescription> = {};
  for (const [name, field] of Object.entries(schema)) {
    fields[name] = describeField(field, references);
  }
  return fields;
}

/**
 * Describes one field: its kind, default and tooltip, its inspector options, and what its kind
 * declares, recursing into nested fields.
 *
 * @param field - The field.
 * @param references - The encoder for the default.
 * @returns The description.
 *
 * @internal
 */
function describeField(field: FieldDefinition<unknown>, references: ReferenceEncoder): SchemaFieldDescription {
  const { tooltip } = field.options;
  return {
    kind: field.kind,
    default: encodeValue(field, field.createDefault(), references),
    ...(tooltip === undefined ? {} : { description: tooltip }),
    ...describeOptions(field.options),
    ...describeKind(field, references),
  };
}

/**
 * Copies the inspector options a field declares.
 *
 * @param options - The field's options.
 * @returns Only the declared options.
 *
 * @internal
 */
function describeOptions(options: FieldOptions): Partial<SchemaFieldDescription> {
  const { min, max, step, hidden, readonly, group, transient } = options;
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(step === undefined ? {} : { step }),
    ...(hidden === undefined ? {} : { hidden }),
    ...(readonly === undefined ? {} : { readonly }),
    ...(group === undefined ? {} : { group }),
    ...(transient === undefined ? {} : { transient }),
  };
}

/**
 * Describes what a field's kind declares beyond the kind itself.
 *
 * @param field - The field.
 * @param references - The encoder for nested defaults.
 * @returns The kind's members; empty for a kind that declares nothing more.
 *
 * @internal
 */
function describeKind(field: FieldDefinition<unknown>, references: ReferenceEncoder): Partial<SchemaFieldDescription> {
  const { spec } = field;
  switch (spec.kind) {
    case "enum": {
      return { values: [...spec.values] };
    }
    case "asset": {
      return spec.typeName === null ? {} : { assetType: spec.typeName };
    }
    case "componentRef": {
      return { componentType: spec.componentType.typeId ?? null };
    }
    case "array": {
      return { item: describeField(spec.item, references) };
    }
    case "record": {
      return { fields: describeFields(spec.fields, references) };
    }
    case "map": {
      return { value: describeField(spec.value, references) };
    }
    case "optional": {
      return { inner: describeField(spec.inner, references) };
    }
    case "f32":
    case "f64":
    case "i32":
    case "u32":
    case "bool":
    case "str":
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat":
    case "color":
    case "entityRef":
    case "layerMask":
    case "curve":
    case "custom": {
      return {};
    }
    default: {
      return assertNever(spec, "schema field kind");
    }
  }
}

/**
 * Generates the JSON Schema (draft 2020-12) for a component's `props` object. The harness and the
 * Vite plugin assemble these into `ignifx.schemas.json`, which drives build-time validation and
 * editor autocompletion (`docs/architecture/06-serialization-and-scene-format.md` §8).
 *
 * @param schema - The schema to convert.
 * @returns The object fragment describing every declared prop.
 *
 * @public
 */
export function toJsonSchema(schema: Schema): JsonSchemaObject {
  return schemaJsonSchema(schema);
}
