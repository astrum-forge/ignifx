/**
 * Guards and path helpers shared by validation, encoding, and decoding. Nothing here is exported
 * from the package barrel.
 */

/**
 * The component names of a vector value, in encoded order.
 *
 * @internal
 */
export const VECTOR_COMPONENTS = ["x", "y", "z", "w"] as const;

/**
 * The channel names of a color value, in encoded order.
 *
 * @internal
 */
export const COLOR_CHANNELS = ["r", "g", "b", "a"] as const;

/**
 * Extends a property path with a named child.
 *
 * @param path - The parent path, possibly empty.
 * @param name - The child property name.
 * @returns The child path.
 *
 * @internal
 */
export function childPath(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

/**
 * Extends a property path with an array index or map key.
 *
 * @param path - The parent path.
 * @param key - The index or key.
 * @returns The child path.
 *
 * @internal
 */
export function indexPath(path: string, key: number | string): string {
  return typeof key === "number" ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * Narrows a value to a read-only array without widening its elements to `any`, which is what the
 * built-in `Array.isArray` predicate does for an `unknown` input.
 *
 * @param value - The value to test.
 * @returns Whether the value is an array.
 *
 * @internal
 */
export function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Narrows a value to a plain object, excluding arrays and `null`.
 *
 * @param value - The value to test.
 * @returns Whether the value is a plain object.
 *
 * @internal
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isArray(value);
}

/**
 * Reinterprets a decoded JavaScript value as the field's declared type. Decoders are the JSON
 * boundary coding standards §5.2 allows assertions at: the value was just built from the field's
 * own definition, so it matches by construction, but that fact is not expressible in the type
 * system without threading the value type through every recursive step.
 *
 * @param value - The decoded value.
 * @returns The same value, typed as the field's value type.
 *
 * @internal
 */
// The type parameter exists so that the caller names the target type; there is no argument to infer
// it from, which is exactly what makes this an assertion helper rather than a conversion.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function asFieldValue<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- invariant stated above.
  return value as T;
}
