/**
 * A small in-house JSON Schema validator covering exactly the keywords the generated ignifx
 * schemas use (`docs/architecture/06-serialization-and-scene-format.md` §8).
 *
 * @remarks
 * Coding standards §13 asks for a paragraph of justification before a runtime dependency is added.
 * A general-purpose validator is several hundred kilobytes and compiles schemas with `new Function`,
 * which §5.3 bans outright; the generated schemas use twenty keywords in total, so the subset below
 * is both smaller and auditable. Anything outside the subset is reported as `IGX-0653` rather than
 * silently ignored, so a schema that needs a keyword this file lacks fails loudly.
 */

import { VitePluginError, VitePluginErrorCode } from "./errors.js";
import { isJsonArray, isJsonObject, jsonProperty } from "./json.js";
import type { JsonArray, JsonObject, JsonValue } from "./json.js";

/**
 * A JSON Schema fragment, kept as a plain JSON object exactly as `@ignifx/core` emits it.
 *
 * @public
 */
export type JsonSchemaObject = JsonObject;

/**
 * One failed constraint, addressed by a JSON pointer into the validated document.
 *
 * @public
 */
export interface SchemaViolation {
  /** RFC 6901 pointer to the offending value; `""` for the document root. */
  readonly pointer: string;
  /** What the value is, and what the schema required instead. */
  readonly message: string;
}

/**
 * Options for {@link validateJsonValue}.
 *
 * @public
 */
export interface ValidateJsonOptions {
  /**
   * The document `$ref` targets are resolved against.
   *
   * @defaultValue the `schema` argument itself, which is what a self-contained schema wants.
   */
  readonly root?: JsonSchemaObject;
  /**
   * How deep the validator may recurse before it gives up on a recursive schema.
   *
   * @defaultValue `64`
   */
  readonly maxDepth?: number;
}

/**
 * The keywords this validator implements, plus the annotation keywords it deliberately ignores.
 * Anything else is an `IGX-0653` so that a schema is never silently under-enforced.
 */
const KNOWN_KEYWORDS = [
  "$ref",
  "$defs",
  "$schema",
  "$id",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "type",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "oneOf",
  "anyOf",
] as const;

/** The `type` names the validator understands. */
const TYPE_NAMES = ["string", "number", "integer", "boolean", "object", "array", "null"] as const;

/** One of the JSON Schema type names. */
type TypeName = (typeof TYPE_NAMES)[number];

/** The prefix every supported `$ref` must carry. */
const DEFS_PREFIX = "#/$defs/";

/**
 * Escapes one path segment for an RFC 6901 JSON pointer.
 *
 * @param segment - The property name or array index.
 * @returns The segment with `~` and `/` escaped.
 */
function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * Appends a segment to a JSON pointer.
 *
 * @param pointer - The pointer to the parent value.
 * @param segment - The property name or array index to append.
 * @returns The pointer to the child value.
 *
 * @example
 * ```ts
 * appendPointer("", "entities"); // "/entities"
 * appendPointer("/entities", "0"); // "/entities/0"
 * ```
 *
 * @public
 */
export function appendPointer(pointer: string, segment: string): string {
  return `${pointer}/${escapePointerSegment(segment)}`;
}

/**
 * Names the JSON Schema type of a value, for use in messages and in `type` checks.
 *
 * @param value - The value to classify.
 * @returns The type name; `"integer"` is never returned, since every number is also a `number`.
 */
function typeNameOf(value: JsonValue): TypeName {
  if (value === null) {
    return "null";
  }
  if (isJsonArray(value)) {
    return "array";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  return typeof value === "boolean" ? "boolean" : "object";
}

/**
 * Renders a value compactly for an error message.
 *
 * @param value - The value to render.
 * @returns A short JSON rendering, truncated so a message stays one line.
 */
function describeValue(value: JsonValue): string {
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Rejects a schema that uses a keyword outside the implemented subset.
 *
 * @param schema - The schema fragment to inspect.
 * @throws A {@link VitePluginError} with code `IGX-0653`.
 */
function assertKnownKeywords(schema: JsonSchemaObject): void {
  for (const keyword of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.some((known) => known === keyword)) {
      throw new VitePluginError(
        VitePluginErrorCode.unsupportedSchema,
        `The JSON Schema keyword "${keyword}" is not implemented by the ignifx build-time validator. ` +
          `Supported keywords: ${KNOWN_KEYWORDS.join(", ")}.`,
      );
    }
  }
}

/**
 * Resolves a `#/$defs/<name>` reference against the root document.
 *
 * @param reference - The `$ref` string.
 * @param root - The document references are resolved against.
 * @returns The referenced schema fragment.
 * @throws A {@link VitePluginError} with code `IGX-0653` when the pointer is not a `#/$defs/*`
 * target or names a definition the root does not declare.
 */
function resolveReference(reference: string, root: JsonSchemaObject): JsonSchemaObject {
  if (!reference.startsWith(DEFS_PREFIX)) {
    throw new VitePluginError(
      VitePluginErrorCode.unsupportedSchema,
      `Only "${DEFS_PREFIX}<name>" references are supported; got "${reference}".`,
    );
  }
  const name = reference.slice(DEFS_PREFIX.length).replaceAll("~1", "/").replaceAll("~0", "~");
  const defs = Object.hasOwn(root, "$defs") ? root["$defs"] : undefined;
  const target = defs !== undefined && isJsonObject(defs) && Object.hasOwn(defs, name) ? defs[name] : undefined;
  if (target === undefined || !isJsonObject(target)) {
    throw new VitePluginError(
      VitePluginErrorCode.unsupportedSchema,
      `The reference "${reference}" does not resolve to a schema in "$defs".`,
    );
  }
  return target;
}

/** Everything the recursive validator carries down the tree. */
interface ValidationContext {
  readonly root: JsonSchemaObject;
  readonly maxDepth: number;
  readonly violations: SchemaViolation[];
}

/**
 * Checks the `type` keyword.
 *
 * @param value - The value under validation.
 * @param declared - The value of the `type` keyword.
 * @param pointer - Pointer to the value.
 * @param context - The shared validation context.
 */
function checkType(value: JsonValue, declared: JsonValue, pointer: string, context: ValidationContext): void {
  const expected: readonly JsonValue[] = isJsonArray(declared) ? declared : [declared];
  const actual = typeNameOf(value);
  const matches = expected.some(
    (name) => name === actual || (name === "integer" && actual === "number" && Number.isInteger(value)),
  );
  if (!matches) {
    const names = expected.map((name) => (typeof name === "string" ? name : describeValue(name))).join(" | ");
    context.violations.push({ pointer, message: `expected type ${names} but got ${actual}` });
  }
}

/**
 * Checks `properties`, `required`, and `additionalProperties` for an object value.
 *
 * @param value - The object under validation.
 * @param schema - The schema fragment.
 * @param pointer - Pointer to the object.
 * @param depth - Current recursion depth.
 * @param context - The shared validation context.
 */
function checkObject(
  value: JsonObject,
  schema: JsonSchemaObject,
  pointer: string,
  depth: number,
  context: ValidationContext,
): void {
  const properties = jsonProperty(schema, "properties");
  const declared = properties !== undefined && isJsonObject(properties) ? properties : null;

  const required = jsonProperty(schema, "required");
  if (required !== undefined && isJsonArray(required)) {
    for (const name of required) {
      if (typeof name === "string" && !Object.hasOwn(value, name)) {
        context.violations.push({ pointer, message: `missing required property "${name}"` });
      }
    }
  }

  const additional = jsonProperty(schema, "additionalProperties");
  for (const name of Object.keys(value)) {
    const child = value[name];
    if (child === undefined) {
      continue;
    }
    const childPointer = appendPointer(pointer, name);
    const declaredSchema = declared !== null && Object.hasOwn(declared, name) ? declared[name] : undefined;
    if (declaredSchema !== undefined && isJsonObject(declaredSchema)) {
      validateNode(child, declaredSchema, childPointer, depth + 1, context);
      continue;
    }
    if (additional === false) {
      context.violations.push({ pointer: childPointer, message: `property "${name}" is not allowed here` });
      continue;
    }
    if (additional !== undefined && isJsonObject(additional)) {
      validateNode(child, additional, childPointer, depth + 1, context);
    }
  }
}

/**
 * Checks `items`, `minItems`, and `maxItems` for an array value.
 *
 * @param value - The array under validation.
 * @param schema - The schema fragment.
 * @param pointer - Pointer to the array.
 * @param depth - Current recursion depth.
 * @param context - The shared validation context.
 */
function checkArray(
  value: JsonArray,
  schema: JsonSchemaObject,
  pointer: string,
  depth: number,
  context: ValidationContext,
): void {
  const minItems = jsonProperty(schema, "minItems");
  if (typeof minItems === "number" && value.length < minItems) {
    context.violations.push({
      pointer,
      message: `expected at least ${String(minItems)} items but got ${String(value.length)}`,
    });
  }
  const maxItems = jsonProperty(schema, "maxItems");
  if (typeof maxItems === "number" && value.length > maxItems) {
    context.violations.push({
      pointer,
      message: `expected at most ${String(maxItems)} items but got ${String(value.length)}`,
    });
  }
  const items = jsonProperty(schema, "items");
  if (items === undefined || !isJsonObject(items)) {
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const child = value[index];
    if (child !== undefined) {
      validateNode(child, items, appendPointer(pointer, String(index)), depth + 1, context);
    }
  }
}

/**
 * Checks `minimum` and `maximum` for a numeric value.
 *
 * @param value - The number under validation.
 * @param schema - The schema fragment.
 * @param pointer - Pointer to the number.
 * @param context - The shared validation context.
 */
function checkRange(value: number, schema: JsonSchemaObject, pointer: string, context: ValidationContext): void {
  const minimum = jsonProperty(schema, "minimum");
  if (typeof minimum === "number" && value < minimum) {
    context.violations.push({ pointer, message: `expected a value >= ${String(minimum)} but got ${String(value)}` });
  }
  const maximum = jsonProperty(schema, "maximum");
  if (typeof maximum === "number" && value > maximum) {
    context.violations.push({ pointer, message: `expected a value <= ${String(maximum)} but got ${String(value)}` });
  }
}

/**
 * Compares two JSON values structurally, which is what `const` and `enum` need.
 *
 * @param left - The first value.
 * @param right - The second value.
 * @returns `true` when the two are deeply equal.
 */
function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }
  if (isJsonArray(left) && isJsonArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEquals(item, right[index] ?? null));
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left);
    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && jsonEquals(left[key] ?? null, right[key] ?? null))
    );
  }
  return false;
}

/**
 * Checks the `oneOf` and `anyOf` combinators.
 *
 * @param value - The value under validation.
 * @param schema - The schema fragment.
 * @param pointer - Pointer to the value.
 * @param depth - Current recursion depth.
 * @param context - The shared validation context.
 */
function checkCombinators(
  value: JsonValue,
  schema: JsonSchemaObject,
  pointer: string,
  depth: number,
  context: ValidationContext,
): void {
  for (const name of ["oneOf", "anyOf"] as const) {
    const branches = jsonProperty(schema, name);
    if (branches === undefined || !isJsonArray(branches)) {
      continue;
    }
    let matched = 0;
    for (const branch of branches) {
      if (!isJsonObject(branch)) {
        continue;
      }
      const probe: ValidationContext = { root: context.root, maxDepth: context.maxDepth, violations: [] };
      validateNode(value, branch, pointer, depth + 1, probe);
      if (probe.violations.length === 0) {
        matched += 1;
      }
    }
    if (matched === 0) {
      context.violations.push({
        pointer,
        message: `${describeValue(value)} matches none of the ${String(branches.length)} "${name}" branches`,
      });
    } else if (name === "oneOf" && matched > 1) {
      context.violations.push({
        pointer,
        message: `${describeValue(value)} matches ${String(matched)} "oneOf" branches; exactly one must match`,
      });
    }
  }
}

/**
 * Validates one value against one schema fragment, collecting violations into the context.
 *
 * @param value - The value under validation.
 * @param schema - The schema fragment.
 * @param pointer - Pointer to the value.
 * @param depth - Current recursion depth.
 * @param context - The shared validation context.
 * @throws A {@link VitePluginError} with code `IGX-0653` for an unsupported keyword, an
 * unresolvable `$ref`, or a schema that recurses past `maxDepth`.
 */
function validateNode(
  value: JsonValue,
  schema: JsonSchemaObject,
  pointer: string,
  depth: number,
  context: ValidationContext,
): void {
  if (depth > context.maxDepth) {
    throw new VitePluginError(
      VitePluginErrorCode.unsupportedSchema,
      `The schema recursed past ${String(context.maxDepth)} levels at "${pointer}"; it is probably cyclic.`,
    );
  }
  assertKnownKeywords(schema);

  const reference = jsonProperty(schema, "$ref");
  if (typeof reference === "string") {
    validateNode(value, resolveReference(reference, context.root), pointer, depth + 1, context);
    return;
  }

  const declaredType = jsonProperty(schema, "type");
  if (declaredType !== undefined) {
    checkType(value, declaredType, pointer, context);
  }

  const constant = jsonProperty(schema, "const");
  if (constant !== undefined && !jsonEquals(value, constant)) {
    context.violations.push({
      pointer,
      message: `expected the constant ${describeValue(constant)} but got ${describeValue(value)}`,
    });
  }

  const allowed = jsonProperty(schema, "enum");
  if (allowed !== undefined && isJsonArray(allowed) && !allowed.some((option) => jsonEquals(value, option))) {
    context.violations.push({
      pointer,
      message: `expected one of ${allowed.map((option) => describeValue(option)).join(", ")} but got ${describeValue(value)}`,
    });
  }

  if (isJsonObject(value)) {
    checkObject(value, schema, pointer, depth, context);
  } else if (isJsonArray(value)) {
    checkArray(value, schema, pointer, depth, context);
  } else if (typeof value === "number") {
    checkRange(value, schema, pointer, context);
  }

  checkCombinators(value, schema, pointer, depth, context);
}

/**
 * Validates a JSON document against the supported JSON Schema subset: `type`, `required`,
 * `properties`, `additionalProperties`, `items`, `enum`, `const`, `minimum`, `maximum`, `minItems`,
 * `maxItems`, `oneOf`, `anyOf`, and `$ref` to `#/$defs/*`.
 *
 * @param value - The parsed document to validate.
 * @param schema - The schema to validate against.
 * @param options - Reference root and recursion limit; see {@link ValidateJsonOptions}.
 * @returns Every violation found, in document order; an empty array means the document is valid.
 * @throws A {@link VitePluginError} with code `IGX-0653` when the schema uses a keyword outside the
 * subset, references something other than `#/$defs/*`, or recurses without bound.
 *
 * @example
 * ```ts
 * const problems = validateJsonValue({ format: "ignifx.scene" }, {
 *   type: "object",
 *   required: ["format", "formatVersion"],
 *   properties: { format: { const: "ignifx.scene" }, formatVersion: { type: "integer" } },
 * });
 * // [{ pointer: "", message: 'missing required property "formatVersion"' }]
 * ```
 *
 * @public
 */
export function validateJsonValue(
  value: JsonValue,
  schema: JsonSchemaObject,
  options?: ValidateJsonOptions,
): readonly SchemaViolation[] {
  const context: ValidationContext = {
    root: options?.root ?? schema,
    maxDepth: options?.maxDepth ?? 64,
    violations: [],
  };
  validateNode(value, schema, "", 0, context);
  return context.violations;
}
