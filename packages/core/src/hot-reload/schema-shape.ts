/**
 * The "did the field layout change?" test behind the `"patch"` policy's automatic fallback
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 *
 * A patched instance keeps every property its old constructor assigned, so a class that renamed,
 * added, or retyped a field would read `undefined` from the new code. Comparing the two schemas'
 * shape — names, declaration order, and kinds, recursively — is what lets the engine notice and
 * fall back to `"recreate"` instead of handing the game a half-initialised object.
 *
 * Presentation options (`tooltip`, `min`, `group`, …) are deliberately not part of the shape:
 * tightening a slider's range must not throw away the running game's state.
 */

import { assertNever } from "../errors/ignifx-error.js";
import type { FieldDefinition, Schema } from "../schema/types.js";

/**
 * A canonical string standing for a schema's field layout. Two schemas produce the same key exactly
 * when they declare the same field names, in the same order, with the same kinds all the way down.
 *
 * @param schema - The schema, or `null` for a class that was not built with `define`.
 * @returns The key. A class with no schema has the key `""`.
 *
 * @example
 * ```ts
 * schemaShapeKey({ speed: f32(5) }) === schemaShapeKey({ speed: f32(9, { min: 0 }) }); // true
 * ```
 *
 * @internal
 */
export function schemaShapeKey(schema: Schema | null): string {
  if (schema === null) {
    return "";
  }
  const parts: string[] = [];
  for (const [name, field] of Object.entries(schema)) {
    parts.push(`${name}:${fieldShapeKey(field)}`);
  }
  return parts.join(",");
}

/**
 * The shape key of one field, recursing into the kinds that wrap another field.
 *
 * @param field - The field definition.
 * @returns Its key.
 */
function fieldShapeKey(field: FieldDefinition<unknown>): string {
  const spec = field.spec;
  switch (spec.kind) {
    case "array": {
      return `array<${fieldShapeKey(spec.item)}>`;
    }
    case "map": {
      return `map<${fieldShapeKey(spec.value)}>`;
    }
    case "optional": {
      return `optional<${fieldShapeKey(spec.inner)}>`;
    }
    case "record": {
      return `record{${schemaShapeKey(spec.fields)}}`;
    }
    case "asset":
    case "bool":
    case "color":
    case "componentRef":
    case "curve":
    case "custom":
    case "entityRef":
    case "enum":
    case "f32":
    case "f64":
    case "i32":
    case "layerMask":
    case "quat":
    case "str":
    case "u32":
    case "vec2":
    case "vec3":
    case "vec4": {
      // Every leaf kind is its own shape: what matters is the property's type, not the values or
      // the presentation options attached to it.
      return spec.kind;
    }
    default: {
      return assertNever(spec, "field kind");
    }
  }
}
