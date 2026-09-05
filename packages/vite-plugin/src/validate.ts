/**
 * Build-time validation of the format-headed JSON files under the asset root
 * (`docs/architecture/05-assets-and-loading.md` §7, `06-serialization-and-scene-format.md` §6/§8).
 *
 * Two layers run: the header check, which needs no schema and is therefore always available, and
 * the JSON Schema check, which runs only for the formats the game supplies a schema for. A failure
 * in either fails the build, so a scene file that cannot load at runtime cannot ship.
 */

import { readFile } from "node:fs/promises";
import { splitAssetFileName } from "./asset-types.js";
import { VitePluginErrorCode } from "./errors.js";
import { validateJsonValue } from "./json-schema.js";
import { isJsonObject, parseJsonValue } from "./json.js";
import type { JsonSchemaObject } from "./json-schema.js";
import type { JsonValue } from "./json.js";
import type { ScannedAsset } from "./manifest.js";

/**
 * The JSON Schemas the plugin validates against.
 *
 * @remarks
 * The plugin cannot generate these itself: they are derived from the component schemas a game
 * registers, which only `@ignifx/core` knows. A game passes them in from its `vite.config.ts`
 * (`ignifx({ schemas: { scene: sceneFileJsonSchema } })`); when nothing is supplied, only the
 * `format`/`formatVersion` header is checked.
 *
 * @public
 */
export interface JsonSchemaProvider {
  /** The schema for `ignifx.scene` files — `*.scene.json` and `*.prefab.json` alike (ADR-0005). */
  readonly scene?: JsonSchemaObject;
  /** Schemas keyed by the file's `format` header, for every other format. */
  readonly formats?: Readonly<Record<string, JsonSchemaObject>>;
}

/**
 * One validation failure, addressed by asset and JSON pointer.
 *
 * @public
 */
export interface ValidationProblem {
  /** The address of the offending asset. */
  readonly address: string;
  /** The absolute path of the offending file, for editors that jump to it. */
  readonly filePath: string;
  /** RFC 6901 pointer to the offending value; `""` for the document as a whole. */
  readonly pointer: string;
  /** What is wrong, in one sentence. */
  readonly message: string;
  /** The diagnostic code: `IGX-0650`, `IGX-0651`, or `IGX-0652`. */
  readonly code: VitePluginErrorCode;
}

/**
 * The `format` header of a file that declares one.
 *
 * @public
 */
export interface FormatHeader {
  /** The `format` field, for example `"ignifx.scene"`. */
  readonly format: string;
  /** The `formatVersion` field, a positive integer. */
  readonly formatVersion: number;
}

/**
 * Renders a problem as a single log line: `<address> <pointer>: <message> (<code>)`.
 *
 * @param problem - The problem to render.
 * @returns The line, without a trailing newline.
 *
 * @example
 * ```ts
 * formatValidationProblem({
 *   address: "levels/level1.scene.json",
 *   filePath: "/p/assets/levels/level1.scene.json",
 *   pointer: "/entities/0",
 *   message: 'missing required property "uid"',
 *   code: "IGX-0652",
 * });
 * // 'levels/level1.scene.json /entities/0: missing required property "uid" (IGX-0652)'
 * ```
 *
 * @public
 */
export function formatValidationProblem(problem: ValidationProblem): string {
  const where = problem.pointer === "" ? "" : ` ${problem.pointer}`;
  return `${problem.address}${where}: ${problem.message} (${problem.code})`;
}

/**
 * Reports whether a JSON file must carry a `format`/`formatVersion` header.
 *
 * @remarks
 * Every ignifx file format is a two-segment JSON extension — `.scene.json`, `.prefab.json`,
 * `.material.json`, `.atlas.json`, `.input.json`, and the rest of the table in
 * `docs/architecture/06-serialization-and-scene-format.md` §6 — so a two-segment name is the signal
 * that a header is expected. A plain `.json` file is game data and is validated only when it
 * happens to declare a header of its own.
 *
 * @param address - The asset address.
 * @returns `true` when a missing header is an error.
 *
 * @public
 */
export function requiresFormatHeader(address: string): boolean {
  const lastSlash = address.lastIndexOf("/");
  const { extension } = splitAssetFileName(address.slice(lastSlash + 1));
  return extension.endsWith(".json") && extension !== ".json";
}

/**
 * Reads and checks the `format`/`formatVersion` header of a parsed document.
 *
 * @param document - The parsed document.
 * @returns The header; `null` when the document declares neither field; or a message describing
 * what is wrong, returned rather than thrown so that one pass reports every problem in the tree.
 */
function readFormatHeader(document: JsonValue): FormatHeader | null | string {
  if (!isJsonObject(document)) {
    return 'the document must be a JSON object with a "format" and "formatVersion" header';
  }
  const hasFormat = Object.hasOwn(document, "format");
  const hasVersion = Object.hasOwn(document, "formatVersion");
  if (!hasFormat && !hasVersion) {
    return null;
  }
  const format = hasFormat ? document["format"] : undefined;
  if (typeof format !== "string" || format === "") {
    return `"format" must be a non-empty string; got ${JSON.stringify(format ?? null)}`;
  }
  const formatVersion = hasVersion ? document["formatVersion"] : undefined;
  if (typeof formatVersion !== "number" || !Number.isInteger(formatVersion) || formatVersion < 1) {
    return `"formatVersion" must be a positive integer; got ${JSON.stringify(formatVersion ?? null)}`;
  }
  return { format, formatVersion };
}

/**
 * Picks the schema to validate a document against.
 *
 * @param format - The document's `format` header.
 * @param schemas - The schemas the game supplied, or `null`.
 * @returns The schema, or `null` when no schema covers this format.
 */
function schemaFor(format: string, schemas: JsonSchemaProvider | null): JsonSchemaObject | null {
  if (schemas === null) {
    return null;
  }
  const { formats } = schemas;
  if (formats !== undefined && Object.hasOwn(formats, format)) {
    return formats[format] ?? null;
  }
  return format === "ignifx.scene" ? (schemas.scene ?? null) : null;
}

/**
 * Validates one JSON document that lives under the asset root.
 *
 * @param address - The asset address, used in messages.
 * @param filePath - The absolute path of the file.
 * @param text - The file's contents.
 * @param schemas - The schemas the game supplied, or `null` to check only the header.
 * @returns Every problem found, in document order.
 *
 * @example
 * ```ts
 * const problems = validateJsonAsset("a.scene.json", "/p/assets/a.scene.json", "{}", null);
 * // [{ code: "IGX-0651", message: 'is missing its "format"/"formatVersion" header', … }]
 * ```
 *
 * @public
 */
export function validateJsonAsset(
  address: string,
  filePath: string,
  text: string,
  schemas: JsonSchemaProvider | null,
): readonly ValidationProblem[] {
  let document: JsonValue;
  try {
    document = parseJsonValue(text);
  } catch (error) {
    return [
      {
        address,
        filePath,
        pointer: "",
        message: `is not valid JSON (${error instanceof Error ? error.message : "unknown parse failure"})`,
        code: VitePluginErrorCode.malformedJson,
      },
    ];
  }

  const header = readFormatHeader(document);
  if (typeof header === "string") {
    return [{ address, filePath, pointer: "", message: header, code: VitePluginErrorCode.missingFormatHeader }];
  }
  if (header === null) {
    if (!requiresFormatHeader(address)) {
      return [];
    }
    return [
      {
        address,
        filePath,
        pointer: "",
        message: 'is missing its "format"/"formatVersion" header',
        code: VitePluginErrorCode.missingFormatHeader,
      },
    ];
  }

  const schema = schemaFor(header.format, schemas);
  if (schema === null) {
    return [];
  }
  return validateJsonValue(document, schema).map((violation) => ({
    address,
    filePath,
    pointer: violation.pointer,
    message: violation.message,
    code: VitePluginErrorCode.schemaViolation,
  }));
}

/**
 * Validates every JSON asset in a scan.
 *
 * @param assets - The scanned assets to check; anything that is not JSON is skipped.
 * @param schemas - The schemas the game supplied, or `null` to check only headers.
 * @returns Every problem found, ordered by address.
 * @throws A {@link VitePluginError} with code `IGX-0653` when a supplied schema uses a keyword
 * outside the implemented subset.
 *
 * @public
 */
export async function validateJsonAssets(
  assets: readonly ScannedAsset[],
  schemas: JsonSchemaProvider | null,
): Promise<readonly ValidationProblem[]> {
  const jsonAssets = assets.filter((asset) => asset.address.toLowerCase().endsWith(".json"));
  const texts = await Promise.all(jsonAssets.map((asset) => readFile(asset.filePath, "utf8")));
  return jsonAssets.flatMap((asset, index) =>
    validateJsonAsset(asset.address, asset.filePath, texts[index] ?? "", schemas),
  );
}
