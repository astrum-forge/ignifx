import { SchemaIssueCode, throwSchemaError } from "./issues.js";
import type { FieldsOf, PartialFieldsOf, Schema } from "./types.js";

/**
 * Property names a schema may not use, because `Component`/`Script` already define them
 * (`docs/architecture/03-scripting-and-components.md` §1 and §2). A schema field becomes a property
 * on the generated base class, so reusing one of these would shadow engine state and break the
 * lifecycle silently.
 *
 * @internal
 */
// A module-scope `new Set(...)` allocates at import time, which `ignifx/no-module-side-effects` and
// `CONSTITUTION.md` §3.5 forbid; schemas are declared once per class, so a linear scan is not hot.
// oxlint-disable-next-line unicorn/prefer-set-has
const RESERVED_FIELD_NAMES: readonly string[] = [
  "uid",
  "entity",
  "transform",
  "world",
  "app",
  "enabled",
  "isDestroyed",
  "isEnabledInHierarchy",
  "destroy",
  "getComponent",
  "requireComponent",
  "awake",
  "onEnable",
  "start",
  "fixedUpdate",
  "update",
  "lateUpdate",
  "onDisable",
  "onDestroy",
  "startCoroutine",
  "stopCoroutine",
  "stopAllCoroutines",
];

/**
 * A field name must read like a plain JavaScript identifier so that `this.<name>` works without
 * bracket syntax, and must not start with `_`, which the standards reserve for adapter-internal
 * mirrors (coding standards §5.1).
 *
 * @internal
 */
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;

/**
 * Rewrites a JavaScript value into a mutable string-keyed view. Schema-shaped objects are always
 * plain records built by this module, so the assertion holds by construction; it exists because a
 * mapped type such as `FieldsOf<S>` cannot be indexed generically (coding standards §5.2 permits
 * assertions at boundaries like this one, with the invariant stated).
 *
 * @param value - The object to view.
 * @returns The same object, typed as a mutable record.
 *
 * @internal
 */
function mutableView(value: unknown): Record<string, unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- invariant stated above.
  return value as Record<string, unknown>;
}

/**
 * Rewrites a plain record into the field object a schema describes. Safe because `createDefaults`
 * fills exactly the schema's keys with values built by that key's own field definition.
 *
 * @param value - The record to view.
 * @returns The same object, typed as the schema's field object.
 *
 * @internal
 */
function fieldsView<S extends Schema>(value: Record<string, unknown>): FieldsOf<S> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- invariant stated above.
  return value as FieldsOf<S>;
}

/**
 * Declares a component's serialized fields. The helper is an identity function at runtime — it
 * returns the object it was given — but it checks every field name and, because it is generic,
 * preserves the exact literal type of the schema so `FieldsOf` can project it.
 *
 * `Script.define` and `Component.define` call this before they build a base class.
 *
 * @param fields - The field definitions, keyed by the property name they become.
 * @returns The same object, with its precise type preserved.
 * @throws A `TypeError` when a field name is not identifier-like, starts with `_`, or collides with
 * a `Component`/`Script` member such as `enabled` or `update`.
 *
 * @example
 * ```ts
 * const moverSchema = defineSchema({
 *   speed: f32(5, { min: 0, max: 50 }),
 *   waypoints: array(vec3()),
 * });
 * ```
 *
 * @public
 */
export function defineSchema<S extends Schema>(fields: S): S {
  for (const name of Object.keys(fields)) {
    if (!FIELD_NAME_PATTERN.test(name)) {
      throwSchemaError(
        SchemaIssueCode.unknownField,
        `schema field "${name}" is not a valid field name: use a letter followed by letters or digits, and do not start with "_".`,
      );
    }
    if (RESERVED_FIELD_NAMES.includes(name)) {
      throwSchemaError(
        SchemaIssueCode.unknownField,
        `schema field "${name}" collides with a Component or Script member; rename the field.`,
      );
    }
  }
  return fields;
}

/**
 * Builds the initial field object for a schema. Every value is freshly allocated by its field's
 * own `createDefault`, so two components declared from the same schema never share a mutable
 * default such as a `vec3` or an `array`.
 *
 * @param schema - The schema to instantiate.
 * @returns A new object holding one default per declared field.
 *
 * @example
 * ```ts
 * const a = createDefaults(moverSchema);
 * const b = createDefaults(moverSchema);
 * a.offset === b.offset; // false — each call allocates
 * ```
 *
 * @public
 */
export function createDefaults<S extends Schema>(schema: S): FieldsOf<S> {
  const defaults: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema)) {
    defaults[name] = field.createDefault();
  }
  return fieldsView<S>(defaults);
}

/**
 * Overwrites defaults with caller-supplied values. Only names the schema declares are copied, and
 * a value of `undefined` leaves the default in place — matching the loader's rule that omitted
 * props take schema defaults (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @param target - The field object to write into, normally the result of `createDefaults`.
 * @param schema - The schema that says which names are legal.
 * @param init - The values to apply.
 * @returns The same `target` object, for chaining.
 *
 * @example
 * ```ts
 * const fields = applyInit(createDefaults(moverSchema), moverSchema, { speed: 12 });
 * ```
 *
 * @public
 */
export function applyInit<S extends Schema>(target: FieldsOf<S>, schema: S, init: PartialFieldsOf<S>): FieldsOf<S> {
  const writable = mutableView(target);
  const supplied = mutableView(init);
  for (const name of Object.keys(schema)) {
    const value = supplied[name];
    if (value !== undefined) {
      writable[name] = value;
    }
  }
  return target;
}
