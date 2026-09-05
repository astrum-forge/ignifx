import { IgnifxError } from "../errors/ignifx-error.js";

/**
 * Diagnostic codes this module reports. They live in the `06xx` serialization range registered in
 * `docs/architecture/15-devtools-and-diagnostics.md` §1. Codes `IGX-0601` to `IGX-0604` are already
 * spoken for by the scene loader (`docs/architecture/06-serialization-and-scene-format.md`), so the
 * schema-level checks continue from `IGX-0605`.
 *
 * @public
 */
export const SchemaIssueCode = {
  /** A number was `NaN`, `Infinity`, or `-Infinity` and therefore cannot be written to JSON. */
  nonFiniteNumber: "IGX-0601",
  /** An entity or component reference could not be resolved to a uid. */
  unresolvedReference: "IGX-0602",
  /** A value had the wrong JavaScript or JSON type for the field kind. */
  typeMismatch: "IGX-0605",
  /** A value had the right type but fell outside the field's declared value domain. */
  outOfRange: "IGX-0606",
  /** A property was supplied that the schema does not declare. */
  unknownField: "IGX-0607",
} as const;

/**
 * The union of diagnostic codes this module reports.
 *
 * @public
 */
export type SchemaIssueCode = (typeof SchemaIssueCode)[keyof typeof SchemaIssueCode];

/**
 * One problem found while validating, encoding, or decoding a schema value. Issues are plain data:
 * this module never throws for bad *values*, it reports them, and the caller decides whether that
 * is a development-time throw or a logged diagnostic (`CONSTITUTION.md` §3.9).
 *
 * @public
 */
export interface SchemaIssue {
  /** Where the problem is, in dotted/bracketed property notation, for example `waypoints[2].x`. */
  readonly path: string;
  /** An actionable description of what went wrong. */
  readonly message: string;
  /** The stable `IGX-####` code for the problem. */
  readonly code: SchemaIssueCode;
}

/**
 * Builds an issue record.
 *
 * @param code - The diagnostic code.
 * @param path - The property path the problem was found at.
 * @param message - An actionable description.
 * @returns The issue.
 *
 * @internal
 */
export function issue(code: SchemaIssueCode, path: string, message: string): SchemaIssue {
  return { path, message, code };
}

/**
 * Throws for a mistake in a *schema declaration* — as opposed to a bad value, which is reported as
 * a {@link SchemaIssue}. Declarations are authored by hand, so a mistake there is API misuse and
 * must be loud (`CONSTITUTION.md` §3.9).
 *
 * @param code - The diagnostic code carried by the thrown error.
 * @param message - An actionable description of the mistake.
 * @throws IgnifxError carrying `code`. The `06xx` serialization range is registered in
 * `docs/architecture/15-devtools-and-diagnostics.md` section 1.
 *
 * @internal
 */
export function throwSchemaError(code: SchemaIssueCode, message: string): never {
  throw new IgnifxError(code, message, {
    hint: "Schema declarations are authored by hand; fix the declaration rather than the value.",
  });
}
