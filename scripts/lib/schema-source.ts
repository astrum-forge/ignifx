/**
 * Loads and validates the `schemas` registry a package exports from its built entry point. The
 * shape is documented in `scripts/docs-schemas.ts` and in `scripts/README.md`.
 */
import { pathToFileURL } from "node:url";
import { isRecord } from "./workspace.ts";

/** One serialized field of a component schema. */
export interface SchemaFieldDoc {
  /** Field name as it appears in scene JSON. */
  readonly name: string;
  /** Schema kind, for example `f32`, `vec3`, `asset`. */
  readonly kind: string;
  /** Default value rendered as JSON, or `null` when the schema declares none. */
  readonly defaultValue: string | null;
  /** One-line description, or an empty string. */
  readonly description: string;
}

/** One component schema, normalized for rendering. */
export interface SchemaDoc {
  /** Directory under `packages/` the schema came from. */
  readonly packageDirectory: string;
  /** Namespaced component type id, for example `ignifx/MeshRenderer`. */
  readonly typeId: string;
  /** Display title. */
  readonly title: string;
  /** The `references/formats/<format>.md` page this schema is documented on. */
  readonly format: string;
  /** One-paragraph description, or an empty string. */
  readonly description: string;
  /** The serialized fields, in declaration order. */
  readonly fields: readonly SchemaFieldDoc[];
}

/** The result of scanning every candidate package. */
export interface CollectResult {
  /** Schemas found, sorted by type id. */
  readonly schemas: readonly SchemaDoc[];
  /** Validation and import failures; a non-empty list means the generator must not write anything. */
  readonly errors: readonly string[];
}

/** A package whose built entry point exists and may export schemas. */
export interface SchemaCandidate {
  /** Directory name under `packages/`. */
  readonly directory: string;
  /** Absolute path to `dist/index.js`. */
  readonly entry: string;
}

/**
 * Narrows an unknown value to a plain object, or reports that it is not one.
 *
 * @param value - The value to test.
 * @returns The value as a record, or `null` when it is not a plain object.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/**
 * Reads an optional string property.
 *
 * @param record - The object to read from.
 * @param key - Property name.
 * @param fallback - Value to use when the property is missing or not a string.
 * @returns The string value or the fallback.
 */
function optionalString(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Normalizes the `fields` map of one schema.
 *
 * @param typeId - The component type id, used in error messages.
 * @param value - The raw `fields` value.
 * @param errors - Collector the function appends validation problems to.
 * @returns The normalized fields, in declaration order.
 */
function normalizeFields(typeId: string, value: unknown, errors: string[]): readonly SchemaFieldDoc[] {
  const fields = asRecord(value);
  if (fields === null) {
    errors.push(`schema \`${typeId}\` has no \`fields\` object`);
    return [];
  }
  const normalized: SchemaFieldDoc[] = [];
  for (const [name, raw] of Object.entries(fields)) {
    const field = asRecord(raw);
    if (field === null) {
      errors.push(`schema \`${typeId}\` field \`${name}\` is not an object`);
      continue;
    }
    const kind = optionalString(field, "kind", "");
    if (kind === "") {
      errors.push(`schema \`${typeId}\` field \`${name}\` has no \`kind\``);
      continue;
    }
    const hasDefault = Object.hasOwn(field, "default");
    normalized.push({
      name,
      kind,
      defaultValue: hasDefault ? JSON.stringify(field["default"] ?? null) : null,
      description: optionalString(field, "description", ""),
    });
  }
  return normalized;
}

/**
 * Normalizes one package's `schemas` export.
 *
 * @param directory - Directory name under `packages/`.
 * @param registry - The raw `schemas` export.
 * @param errors - Collector the function appends validation problems to.
 * @returns The normalized schemas of that package.
 */
function normalizeRegistry(directory: string, registry: unknown, errors: string[]): readonly SchemaDoc[] {
  const record = asRecord(registry);
  if (record === null) {
    errors.push(`packages/${directory}: \`schemas\` must be an object keyed by component type id`);
    return [];
  }
  const schemas: SchemaDoc[] = [];
  for (const [typeId, raw] of Object.entries(record)) {
    const entry = asRecord(raw);
    if (entry === null) {
      errors.push(`packages/${directory}: schema \`${typeId}\` is not an object`);
      continue;
    }
    if (!typeId.includes("/")) {
      errors.push(`packages/${directory}: type id \`${typeId}\` is not namespaced (\`<package>/<Name>\`)`);
      continue;
    }
    schemas.push({
      packageDirectory: directory,
      typeId,
      title: optionalString(entry, "title", typeId.slice(typeId.indexOf("/") + 1)),
      format: optionalString(entry, "format", "components"),
      description: optionalString(entry, "description", ""),
      fields: normalizeFields(typeId, entry["fields"], errors),
    });
  }
  return schemas;
}

/**
 * Imports one candidate package's built entry point.
 *
 * @param candidate - The package to import.
 * @returns The module namespace, or the reason the import failed.
 */
async function loadModule(
  candidate: SchemaCandidate,
): Promise<{ readonly directory: string; readonly namespace: unknown; readonly error: string | null }> {
  try {
    const namespace: unknown = await import(pathToFileURL(candidate.entry).href);
    return { directory: candidate.directory, namespace, error: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      directory: candidate.directory,
      namespace: null,
      error: `packages/${candidate.directory}: could not import dist/index.js — ${reason}`,
    };
  }
}

/**
 * Imports every candidate package and collects the schemas they export.
 *
 * @param candidates - Packages whose `dist/index.js` exists.
 * @returns The normalized schemas plus any import or validation failures.
 */
export async function collectSchemas(candidates: readonly SchemaCandidate[]): Promise<CollectResult> {
  const loaded = await Promise.all(candidates.map((candidate) => loadModule(candidate)));
  const schemas: SchemaDoc[] = [];
  const errors: string[] = [];
  for (const entry of loaded) {
    if (entry.error !== null) {
      errors.push(entry.error);
      continue;
    }
    const namespace = asRecord(entry.namespace);
    if (namespace === null || !Object.hasOwn(namespace, "schemas")) {
      continue;
    }
    schemas.push(...normalizeRegistry(entry.directory, namespace["schemas"], errors));
  }
  return { schemas: schemas.toSorted((left, right) => left.typeId.localeCompare(right.typeId)), errors };
}
