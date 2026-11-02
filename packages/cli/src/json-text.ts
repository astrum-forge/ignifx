/**
 * The JSON text the import commands write: two-space indentation, with a list of plain values kept
 * on one line so a tile array stays readable, and numbers rounded the way the engine stores them.
 */

/** Indentation of the files the import commands write. */
const INDENT = "  ";

/** The precision scene and tilemap files store numbers at, matching `canonicalizeNumber` in `@ignifx/core`. */
const CANONICAL_SCALE = 1e6;

/**
 * Whether a value is a JSON object rather than an array, a primitive or `null`.
 *
 * @param value - The value.
 * @returns `true` for an object.
 *
 * @internal
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rounds a number the way scene files store it.
 *
 * @param value - The number.
 * @returns It rounded to six decimals, with `-0` as `0`.
 *
 * @internal
 */
export function canonical(value: number): number {
  const rounded = Math.round(value * CANONICAL_SCALE) / CANONICAL_SCALE;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Formats a value as two-space-indented JSON with lists of plain values on one line. Keys whose
 * value is `undefined` are left out, as `JSON.stringify` does.
 *
 * @param value - The value.
 * @param indent - The current indentation; `""` at the top.
 * @returns The text, without a final newline.
 *
 * @internal
 */
export function compactJson(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.every((item: unknown) => item === null || typeof item !== "object")) {
      return `[${value.map((item: unknown) => JSON.stringify(item)).join(", ")}]`;
    }
    const inner = indent + INDENT;
    return `[\n${value.map((item: unknown) => inner + compactJson(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined);
    if (keys.length === 0) {
      return "{}";
    }
    const inner = indent + INDENT;
    return `{\n${keys.map((key) => `${inner}${JSON.stringify(key)}: ${compactJson(value[key], inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}
