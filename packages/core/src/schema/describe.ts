import { assertNever } from "../errors/ignifx-error.js";
import { encodeValue } from "./encode.js";
import type { ReferenceEncoder } from "./encode.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { FieldDefinition, FieldKind, Schema } from "./types.js";

/**
 * One field as the documentation harness sees it (`scripts/README.md`, "Schema discovery
 * convention").
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
 * Builds the JSON Schema fragment for one field.
 *
 * @param field - The field to describe.
 * @returns The fragment describing the field's encoded form.
 *
 * @internal
 */
function fieldJsonSchema(field: FieldDefinition<unknown>): JsonSchemaObject {
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
      return taggedReferenceSchema("$component");
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
function annotatedFieldJsonSchema(field: FieldDefinition<unknown>): JsonSchemaObject {
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
 * Describes a component schema in the shape the documentation harness consumes. A package exports
 * a record of these keyed by `typeId`; `pnpm docs:schemas` reads it from the built entry point and
 * regenerates the format pages and `ignifx.schemas.json` from it
 * (`scripts/README.md`, `docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * @param typeId - The component's namespaced registration id, for example `mygame/Mover`.
 * @param schema - The component's declared fields.
 * @param meta - Overrides for the title, format grouping, and summary.
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
  const references = noReferences();
  const fields: Record<string, SchemaFieldDescription> = {};
  for (const [name, field] of Object.entries(schema)) {
    const { tooltip } = field.options;
    fields[name] = {
      kind: field.kind,
      default: encodeValue(field, field.createDefault(), references),
      ...(tooltip === undefined ? {} : { description: tooltip }),
    };
  }
  const derivedTitle = typeId.slice(typeId.lastIndexOf("/") + 1);
  return {
    title: meta?.title ?? derivedTitle,
    format: meta?.format ?? "components",
    ...(meta?.description === undefined ? {} : { description: meta.description }),
    fields,
  };
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
