import { assertNever } from "../errors/ignifx-error.js";
import { COLOR_CHANNELS, VECTOR_COMPONENTS, childPath, indexPath, isArray, isPlainObject } from "./internal.js";
import { SchemaIssueCode, issue } from "./issues.js";
import type { SchemaIssue } from "./issues.js";
import type { FieldDefinition, FieldOptions, Schema } from "./types.js";

/**
 * The inclusive bounds of a signed 32-bit integer.
 *
 * @internal
 */
const I32_RANGE = [-2147483648, 2147483647] as const;
/**
 * The inclusive bounds of an unsigned 32-bit integer.
 *
 * @internal
 */
const U32_RANGE = [0, 4294967295] as const;

/**
 * Checks a numeric value against its kind's integer rules and the field's `min`/`max` options.
 *
 * @param kind - The numeric field kind.
 * @param options - The field's options.
 * @param value - The value to check.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 *
 * @internal
 */
function validateNumber(
  kind: "f32" | "f64" | "i32" | "u32",
  options: FieldOptions,
  value: unknown,
  path: string,
  issues: SchemaIssue[],
): void {
  if (typeof value !== "number") {
    issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected a ${kind} number, received ${typeof value}.`));
    return;
  }
  if (!Number.isFinite(value)) {
    issues.push(issue(SchemaIssueCode.nonFiniteNumber, path, `${String(value)} cannot be written to JSON.`));
    return;
  }
  if (kind === "i32" || kind === "u32") {
    if (Number.isInteger(value)) {
      const [low, high] = kind === "u32" ? U32_RANGE : I32_RANGE;
      if (value < low || value > high) {
        issues.push(issue(SchemaIssueCode.outOfRange, path, `${value} is outside the ${kind} range.`));
      }
    } else {
      issues.push(issue(SchemaIssueCode.outOfRange, path, `${kind} requires a whole number, received ${value}.`));
    }
  }
  const { min, max } = options;
  if (min !== undefined && value < min) {
    issues.push(issue(SchemaIssueCode.outOfRange, path, `${value} is below the declared minimum ${min}.`));
  }
  if (max !== undefined && value > max) {
    issues.push(issue(SchemaIssueCode.outOfRange, path, `${value} is above the declared maximum ${max}.`));
  }
}

/**
 * Checks that every named channel of an object value is a finite number, optionally within bounds.
 *
 * @param names - The channel names to require.
 * @param bounds - Inclusive `[low, high]` bounds each channel must fall in, or `null` for none.
 * @param label - How the value is named in messages.
 * @param value - The value to check.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 *
 * @internal
 */
function validateChannels(
  names: readonly string[],
  bounds: readonly [number, number] | null,
  label: string,
  value: unknown,
  path: string,
  issues: SchemaIssue[],
): void {
  if (!isPlainObject(value)) {
    issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected a ${label} object, received ${typeof value}.`));
    return;
  }
  for (const name of names) {
    const channel = value[name];
    const channelAt = childPath(path, name);
    if (typeof channel !== "number") {
      issues.push(issue(SchemaIssueCode.typeMismatch, channelAt, `expected a number, received ${typeof channel}.`));
      continue;
    }
    if (!Number.isFinite(channel)) {
      issues.push(issue(SchemaIssueCode.nonFiniteNumber, channelAt, `${String(channel)} cannot be written to JSON.`));
      continue;
    }
    if (bounds !== null && (channel < bounds[0] || channel > bounds[1])) {
      issues.push(
        issue(SchemaIssueCode.outOfRange, channelAt, `${channel} is outside the ${bounds[0]}–${bounds[1]} range.`),
      );
    }
  }
}

/**
 * Checks one value against one field definition, appending to a collector.
 *
 * @param field - The field to check against.
 * @param value - The value to check.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 *
 * @internal
 */
function validateInto(field: FieldDefinition<unknown>, value: unknown, path: string, issues: SchemaIssue[]): void {
  const { spec } = field;
  switch (spec.kind) {
    case "f32":
    case "f64":
    case "i32":
    case "u32": {
      validateNumber(spec.kind, field.options, value, path, issues);
      return;
    }
    case "bool": {
      if (typeof value !== "boolean") {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected a boolean, received ${typeof value}.`));
      }
      return;
    }
    case "str": {
      if (typeof value !== "string") {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected a string, received ${typeof value}.`));
      }
      return;
    }
    case "vec2":
    case "vec3":
    case "vec4":
    case "quat": {
      validateChannels(VECTOR_COMPONENTS.slice(0, spec.components), null, spec.kind, value, path, issues);
      return;
    }
    case "color": {
      validateChannels(COLOR_CHANNELS, [0, 1], "color", value, path, issues);
      return;
    }
    case "enum": {
      if (typeof value !== "string") {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected a string, received ${typeof value}.`));
      } else if (!spec.values.includes(value)) {
        issues.push(issue(SchemaIssueCode.outOfRange, path, `"${value}" is not one of [${spec.values.join(", ")}].`));
      }
      return;
    }
    case "entityRef":
    case "componentRef": {
      if (value !== null && typeof value !== "object") {
        issues.push(
          issue(
            SchemaIssueCode.typeMismatch,
            path,
            `expected a ${spec.kind} target or null, received ${typeof value}.`,
          ),
        );
      }
      return;
    }
    case "asset": {
      if (value === null) {
        return;
      }
      // Structural on purpose: the runtime value is an `AssetHandle`, which the schema layer must
      // not import (coding standards §4), and a tool that reads a file without an app holds the
      // plain `{ address, type? }` form instead. Both carry a string `address`, which is the only
      // thing this layer can check.
      if (!isPlainObject(value)) {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected a loaded asset handle or null.`));
        return;
      }
      if (typeof value["address"] !== "string") {
        issues.push(issue(SchemaIssueCode.typeMismatch, childPath(path, "address"), `expected a string address.`));
      }
      return;
    }
    case "array": {
      if (!isArray(value)) {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected an array, received ${typeof value}.`));
        return;
      }
      for (let index = 0; index < value.length; index += 1) {
        validateInto(spec.item, value[index], indexPath(path, index), issues);
      }
      return;
    }
    case "record": {
      if (!isPlainObject(value)) {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected an object, received ${typeof value}.`));
        return;
      }
      collectPropsIssues(spec.fields, value, path, issues);
      return;
    }
    case "map": {
      if (!isPlainObject(value)) {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected an object, received ${typeof value}.`));
        return;
      }
      for (const [key, entry] of Object.entries(value)) {
        validateInto(spec.value, entry, indexPath(path, key), issues);
      }
      return;
    }
    case "optional": {
      if (value !== null) {
        validateInto(spec.inner, value, path, issues);
      }
      return;
    }
    case "layerMask": {
      if (!isArray(value)) {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected an array of layer names.`));
        return;
      }
      for (let index = 0; index < value.length; index += 1) {
        if (typeof value[index] !== "string") {
          issues.push(issue(SchemaIssueCode.typeMismatch, indexPath(path, index), `expected a layer name string.`));
        }
      }
      return;
    }
    case "curve": {
      if (!isPlainObject(value)) {
        issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected a curve object.`));
        return;
      }
      const keys = value["keys"];
      if (!isArray(keys)) {
        issues.push(issue(SchemaIssueCode.typeMismatch, childPath(path, "keys"), `expected an array of curve keys.`));
        return;
      }
      for (let index = 0; index < keys.length; index += 1) {
        validateCurveKey(keys[index], indexPath(childPath(path, "keys"), index), issues);
      }
      return;
    }
    case "custom": {
      // A custom field's shape is the codec's business; the schema layer cannot second-guess it.
      return;
    }
    default: {
      assertNever(spec, "schema field kind");
    }
  }
}

/**
 * Checks one animation curve key.
 *
 * @param key - The candidate key.
 * @param path - The property path for reported issues.
 * @param issues - The collector to append to.
 *
 * @internal
 */
function validateCurveKey(key: unknown, path: string, issues: SchemaIssue[]): void {
  if (!isArray(key) || key.length !== 4) {
    issues.push(issue(SchemaIssueCode.typeMismatch, path, `expected [time, value, inTangent, outTangent].`));
    return;
  }
  for (let index = 0; index < 4; index += 1) {
    const component = key[index];
    if (typeof component !== "number") {
      issues.push(issue(SchemaIssueCode.typeMismatch, indexPath(path, index), `expected a number.`));
    } else if (!Number.isFinite(component)) {
      issues.push(
        issue(
          SchemaIssueCode.nonFiniteNumber,
          indexPath(path, index),
          `${String(component)} cannot be written to JSON.`,
        ),
      );
    }
  }
}

/**
 * Checks a bag of property values against a schema, appending to a collector.
 *
 * @param schema - The schema that says which names are legal and how they are typed.
 * @param props - The values to check.
 * @param path - The property path prefix for reported issues.
 * @param issues - The collector to append to.
 *
 * @internal
 */
function collectPropsIssues(
  schema: Schema,
  props: Readonly<Record<string, unknown>>,
  path: string,
  issues: SchemaIssue[],
): void {
  for (const name of Object.keys(props)) {
    if (!Object.hasOwn(schema, name)) {
      issues.push(
        issue(SchemaIssueCode.unknownField, childPath(path, name), `the schema declares no field "${name}".`),
      );
    }
  }
  for (const [name, field] of Object.entries(schema)) {
    const value = props[name];
    if (value !== undefined) {
      validateInto(field, value, childPath(path, name), issues);
    }
  }
}

/**
 * Checks one value against one field definition. Nothing is thrown: the result is data, and the
 * caller decides whether a problem is a development-time error or a logged diagnostic
 * (`CONSTITUTION.md` §3.9).
 *
 * Checks performed are the value's type, finiteness for numbers, whole-number and 32-bit range for
 * `i32`/`u32`, `min`/`max` from the field options, enum membership, sRGB 0–1 range for colors, and
 * recursion into `array`, `record`, `map`, and `optional`.
 *
 * @param field - The field to check against.
 * @param value - The value to check.
 * @param path - A property path prefix used when reporting issues; defaults to the empty path.
 * @returns Every problem found, in discovery order; empty when the value is valid.
 *
 * @example
 * ```ts
 * validateValue(f32(0, { min: 0 }), -1);
 * // [{ path: "", code: "IGX-0606", message: "-1 is below the declared minimum 0." }]
 * ```
 *
 * @public
 */
export function validateValue(
  field: FieldDefinition<unknown>,
  value: unknown,
  path: string = "",
): readonly SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  validateInto(field, value, path, issues);
  return issues;
}

/**
 * Checks a bag of property values against a schema. Names the schema does not declare are reported
 * as `IGX-0607`; names the caller omits are legal, because omitted props take schema defaults
 * (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @param schema - The schema to check against.
 * @param props - The values to check, keyed by field name.
 * @param path - A property path prefix used when reporting issues; defaults to the empty path.
 * @returns Every problem found, in discovery order; empty when the props are valid.
 *
 * @public
 */
export function validateProps(
  schema: Schema,
  props: Readonly<Record<string, unknown>>,
  path: string = "",
): readonly SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  collectPropsIssues(schema, props, path, issues);
  return issues;
}
