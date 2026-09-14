import { SCENE_FILE_FORMAT, SCENE_FORMAT_VERSION } from "./scene-file.js";
import type { SceneFile } from "./scene-file.js";

/**
 * One structural problem in a scene file.
 *
 * @public
 */
export interface SceneFileIssue {
  /** Where the problem is, in JSON-pointer-like notation, for example `entities/3/transform`. */
  readonly path: string;
  /** An actionable description. */
  readonly message: string;
}

/**
 * Validates a parsed JSON value against the scene file format
 * (`docs/architecture/06-serialization-and-scene-format.md` §2).
 *
 * @remarks
 * The checks mirror {@link sceneFileJsonSchema} clause for clause — required keys, value types,
 * tuple lengths, uid uniqueness, and the `parent` and override shapes — and are hand-written
 * because the engine ships no JSON Schema runtime and takes no dependency to gain one
 * (`CONSTITUTION.md` §2.3). The generated document remains the artefact the Vite plugin and editors
 * validate against; this is the same rule set, executable at load time.
 *
 * Component `props` are *not* checked here: `decodeProps` already reports every field problem with
 * a schema issue code, per field, which is more precise than a document-level match.
 *
 * @param value - The parsed JSON.
 * @returns Every problem found, in discovery order; empty when the value is a valid scene file.
 *
 * @example
 * ```ts
 * const issues = validateSceneFile(JSON.parse(text));
 * if (issues.length > 0) {
 *   throw new IgnifxError(CoreErrorCode.sceneFileInvalid, issues[0].message);
 * }
 * ```
 *
 * @public
 */
export function validateSceneFile(value: unknown): readonly SceneFileIssue[] {
  const issues: SceneFileIssue[] = [];
  const file = asRecord(value);
  if (file === null) {
    issues.push({ path: "", message: "a scene file is a JSON object." });
    return issues;
  }
  if (file["format"] !== SCENE_FILE_FORMAT) {
    issues.push({ path: "format", message: `expected "${SCENE_FILE_FORMAT}".` });
  }
  if (file["formatVersion"] !== SCENE_FORMAT_VERSION) {
    issues.push({ path: "formatVersion", message: `expected ${String(SCENE_FORMAT_VERSION)}.` });
  }
  if (typeof file["name"] !== "string") {
    issues.push({ path: "name", message: "expected a string." });
  }
  const settings = file["settings"];
  if (settings !== undefined && asRecord(settings) === null) {
    issues.push({ path: "settings", message: "expected an object." });
  }
  const entities = file["entities"];
  if (!Array.isArray(entities)) {
    issues.push({ path: "entities", message: "expected an array." });
    return issues;
  }
  const uids = new Set<string>();
  for (let index = 0; index < entities.length; index += 1) {
    validateEntity(entities[index], `entities/${String(index)}`, uids, issues);
  }
  return issues;
}

/**
 * Narrows a value to a scene file after {@link validateSceneFile} has passed.
 *
 * @param value - The validated JSON.
 * @returns The same value, typed as a scene file.
 *
 * @internal
 */
export function asSceneFile(value: unknown): SceneFile {
  // The invariant is that `validateSceneFile` returned
  // no issues for this exact value, which is every constraint the interface expresses.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as SceneFile;
}

/**
 * Validates one entity entry.
 *
 * @param value - The entry.
 * @param path - Its path, for issue messages.
 * @param uids - Uids already seen in the file, for the uniqueness check.
 * @param issues - Where problems are appended.
 */
function validateEntity(value: unknown, path: string, uids: Set<string>, issues: SceneFileIssue[]): void {
  const entity = asRecord(value);
  if (entity === null) {
    issues.push({ path, message: "expected an object." });
    return;
  }
  requireUid(entity["uid"], `${path}/uid`, uids, issues);
  if (typeof entity["name"] !== "string") {
    issues.push({ path: `${path}/name`, message: "expected a string." });
  }
  const parent = entity["parent"];
  if (parent !== null && typeof parent !== "string") {
    issues.push({ path: `${path}/parent`, message: "expected a uid string or null." });
  }
  requireBoolean(entity["active"], `${path}/active`, issues);
  requireBoolean(entity["static"], `${path}/static`, issues);
  if (entity["layer"] !== undefined && typeof entity["layer"] !== "string") {
    issues.push({ path: `${path}/layer`, message: "expected a layer name string." });
  }
  validateTags(entity["tags"], `${path}/tags`, issues);
  validateTransform(entity["transform"], `${path}/transform`, issues);
  validateInstance(entity["instance"], `${path}/instance`, issues);
  const components = entity["components"];
  if (components === undefined) {
    return;
  }
  if (!Array.isArray(components)) {
    issues.push({ path: `${path}/components`, message: "expected an array." });
    return;
  }
  for (let index = 0; index < components.length; index += 1) {
    validateComponent(components[index], `${path}/components/${String(index)}`, uids, issues);
  }
}

/**
 * Validates one component entry.
 *
 * @param value - The entry.
 * @param path - Its path.
 * @param uids - Uids already seen.
 * @param issues - Where problems are appended.
 */
function validateComponent(value: unknown, path: string, uids: Set<string>, issues: SceneFileIssue[]): void {
  const component = asRecord(value);
  if (component === null) {
    issues.push({ path, message: "expected an object." });
    return;
  }
  requireUid(component["uid"], `${path}/uid`, uids, issues);
  const type = component["type"];
  if (typeof type !== "string" || type === "") {
    issues.push({ path: `${path}/type`, message: "expected a registered component type id." });
  }
  requireBoolean(component["enabled"], `${path}/enabled`, issues);
  const version = component["schemaVersion"];
  if (version !== undefined && (typeof version !== "number" || !Number.isInteger(version) || version < 1)) {
    issues.push({ path: `${path}/schemaVersion`, message: "expected a positive integer." });
  }
  const props = component["props"];
  if (props !== undefined && asRecord(props) === null) {
    issues.push({ path: `${path}/props`, message: "expected an object." });
  }
}

/**
 * Validates an `instance` entry.
 *
 * @param value - The entry, or `undefined`.
 * @param path - Its path.
 * @param issues - Where problems are appended.
 */
function validateInstance(value: unknown, path: string, issues: SceneFileIssue[]): void {
  if (value === undefined) {
    return;
  }
  const instance = asRecord(value);
  if (instance === null) {
    issues.push({ path, message: "expected an object." });
    return;
  }
  const scene = asRecord(instance["scene"]);
  if (scene === null || typeof scene["$asset"] !== "string") {
    issues.push({ path: `${path}/scene`, message: 'expected { "$asset": "<address>" }.' });
  }
  if (instance["hash"] !== undefined && typeof instance["hash"] !== "string") {
    issues.push({ path: `${path}/hash`, message: "expected a string." });
  }
  const overrides = instance["overrides"];
  if (overrides === undefined) {
    return;
  }
  if (!Array.isArray(overrides)) {
    issues.push({ path: `${path}/overrides`, message: "expected an array." });
    return;
  }
  for (let index = 0; index < overrides.length; index += 1) {
    const at = `${path}/overrides/${String(index)}`;
    const override = asRecord(overrides[index]);
    if (override === null || typeof override["path"] !== "string" || override["path"] === "") {
      issues.push({ path: at, message: "expected an object with a non-empty path." });
      continue;
    }
    const op = override["op"];
    if (op !== undefined && op !== "replace" && op !== "remove" && op !== "add") {
      issues.push({ path: `${at}/op`, message: 'expected "replace", "remove", or "add".' });
    }
  }
}

/**
 * Validates a `transform` entry.
 *
 * @param value - The entry.
 * @param path - Its path.
 * @param issues - Where problems are appended.
 */
function validateTransform(value: unknown, path: string, issues: SceneFileIssue[]): void {
  const transform = asRecord(value);
  if (transform === null) {
    issues.push({ path, message: "expected an object with position, rotation, and scale." });
    return;
  }
  requireNumbers(transform["position"], `${path}/position`, 3, issues);
  requireNumbers(transform["rotation"], `${path}/rotation`, 4, issues);
  requireNumbers(transform["scale"], `${path}/scale`, 3, issues);
}

/**
 * Validates a `tags` array.
 *
 * @param value - The array, or `undefined`.
 * @param path - Its path.
 * @param issues - Where problems are appended.
 */
function validateTags(value: unknown, path: string, issues: SceneFileIssue[]): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    issues.push({ path, message: "expected an array of strings." });
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "string") {
      issues.push({ path: `${path}/${String(index)}`, message: "expected a string." });
    }
  }
}

/**
 * Checks a uid: a non-empty string, unique within the file.
 *
 * @param value - The candidate.
 * @param path - Its path.
 * @param uids - Uids already seen.
 * @param issues - Where problems are appended.
 */
function requireUid(value: unknown, path: string, uids: Set<string>, issues: SceneFileIssue[]): void {
  if (typeof value !== "string" || value === "") {
    issues.push({ path, message: "expected a non-empty uid string." });
    return;
  }
  if (uids.has(value)) {
    issues.push({ path, message: `the uid ${value} is used twice; uids are unique within a file.` });
    return;
  }
  uids.add(value);
}

/**
 * Checks an optional boolean.
 *
 * @param value - The candidate.
 * @param path - Its path.
 * @param issues - Where problems are appended.
 */
function requireBoolean(value: unknown, path: string, issues: SceneFileIssue[]): void {
  if (value !== undefined && typeof value !== "boolean") {
    issues.push({ path, message: "expected a boolean." });
  }
}

/**
 * Checks a fixed-length array of finite numbers.
 *
 * @param value - The candidate.
 * @param path - Its path.
 * @param length - How many entries are required.
 * @param issues - Where problems are appended.
 */
function requireNumbers(value: unknown, path: string, length: number, issues: SceneFileIssue[]): void {
  if (!Array.isArray(value) || value.length !== length) {
    issues.push({ path, message: `expected an array of ${String(length)} numbers.` });
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      issues.push({ path: `${path}/${String(index)}`, message: "expected a finite number." });
    }
  }
}

/**
 * Narrows a value to a string-keyed object.
 *
 * @param value - The candidate.
 * @returns The record, or `null` when the value is not a plain object.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  // The guard above is exactly "a plain object", which
  // is a string-keyed bag of unknowns.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Record<string, unknown>;
}
