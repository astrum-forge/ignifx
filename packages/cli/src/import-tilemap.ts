import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs as parseNodeArgs } from "node:util";
import { CliError, CliErrorCode } from "./errors.js";
import type { ImportIo } from "./import-heightmap.js";

/**
 * `ignifx import tilemap <map.tilemap.json> <scene.scene.json>`: moves a tilemap's objects layer into
 * a scene file, once (ADR-0030). Objects are authoring data; the runtime never spawns them, so the
 * scene, not the map, is where the player, the props and the pickups live afterwards.
 *
 * The command reads and writes JSON only. `@ignifx/cli` has no runtime coupling to the engine
 * (`.dependency-cruiser.cjs`), so the two file shapes it touches are restated here.
 */

/**
 * The one-line usage string printed with every argument error.
 *
 * @public
 */
export const IMPORT_TILEMAP_USAGE =
  "Usage: ignifx import tilemap <map.tilemap.json> <scene.scene.json> [--parent <entity name>]";

/** The header a tilemap document carries. */
const TILEMAP_FORMAT = "ignifx.tilemap";

/** The header a scene or prefab file carries. */
const SCENE_FORMAT = "ignifx.scene";

/** Crockford's base32 alphabet, which ULIDs use. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How many characters of a ULID encode its millisecond timestamp. */
const ULID_TIME_LENGTH = 10;

/** How many characters of a ULID are random. */
const ULID_RANDOM_LENGTH = 16;

/** The base of the ULID encoding. */
const ULID_BASE = 32;

/** The precision scene files store numbers at, matching `canonicalizeNumber` in `@ignifx/core`. */
const CANONICAL_SCALE = 1e6;

/** Indentation of the files this command writes. */
const INDENT = "  ";

/**
 * A parsed `ignifx import tilemap` invocation.
 *
 * @public
 */
export interface ImportTilemapCommand {
  /** The `.tilemap.json` whose objects move, exactly as the user typed it. */
  readonly map: string;
  /** The scene or prefab file that receives them. */
  readonly scene: string;
  /** The name of the scene entity to parent the new entities to, or `null` for root entities. */
  readonly parent: string | null;
}

/**
 * One entity {@link runImportTilemap} added.
 *
 * @public
 */
export interface ImportedTileObject {
  /** The entity's uid in the scene file. */
  readonly uid: string;
  /** The entity's name: the object's name, or its type when the name is empty. */
  readonly name: string;
  /** The object's type, which became the entity's tag; `""` when the object had none. */
  readonly type: string;
  /** The entity's position: the centre of the object, in metres relative to the map's origin. */
  readonly position: readonly [number, number];
  /** The object's size, in metres. */
  readonly size: readonly [number, number];
  /** The object's custom properties, which no scene field holds. */
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

/**
 * What {@link runImportTilemap} did.
 *
 * @public
 */
export interface ImportTilemapResult {
  /** The tilemap that lost its objects. */
  readonly map: string;
  /** The scene that gained them. */
  readonly scene: string;
  /** The entities added, in the map's object order. An empty list means nothing was written. */
  readonly entities: readonly ImportedTileObject[];
}

/** A tilemap object as the command reads it. */
interface TileObject {
  readonly name: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

/** A JSON object, as `JSON.parse` returns one. */
type JsonRecord = Record<string, unknown>;

/**
 * Parses the arguments of `ignifx import tilemap`.
 *
 * @param argv - The arguments after `import tilemap`.
 * @returns The parsed command.
 * @throws A {@link CliError} with code `IGX-1403` when the command line is unparseable or does not
 * name exactly one map and one scene.
 *
 * @example
 * ```ts
 * const command = parseImportTilemapArgs(["level.tilemap.json", "scenes/main.scene.json", "--parent", "Level"]);
 * ```
 *
 * @public
 */
export function parseImportTilemapArgs(argv: readonly string[]): ImportTilemapCommand {
  let parsed: { readonly positionals: readonly string[]; readonly parent: string | undefined };
  try {
    const result = parseNodeArgs({
      args: [...argv],
      options: { parent: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    parsed = { positionals: result.positionals, parent: result.values.parent };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse the command line.";
    throw new CliError(CliErrorCode.invalidArguments, `${message}\n${IMPORT_TILEMAP_USAGE}`, { cause: error });
  }
  const [map, scene, ...extra] = parsed.positionals;
  if (map === undefined || map === "" || scene === undefined || scene === "") {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `Missing <map.tilemap.json> or <scene.scene.json>.\n${IMPORT_TILEMAP_USAGE}`,
    );
  }
  if (extra.length > 0) {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `Expected two paths but got ${String(parsed.positionals.length)}.\n${IMPORT_TILEMAP_USAGE}`,
    );
  }
  if (parsed.parent === "") {
    throw new CliError(CliErrorCode.invalidArguments, `--parent needs an entity name.\n${IMPORT_TILEMAP_USAGE}`);
  }
  return { map, scene, parent: parsed.parent ?? null };
}

/**
 * Moves a tilemap's objects into a scene file as entities, and removes them from the map.
 *
 * @remarks
 * Each object becomes one entity, in the map's order, appended after the `--parent` entity's
 * subtree or at the end of the file. The entity is named after the object, tagged with its type,
 * and placed at the object's centre: the map's objects are in metres relative to the map's origin,
 * so parent the entities to the tilemap's entity to keep them in place wherever the map sits. It has
 * no components; the command prints each object's size and properties, because no scene field holds
 * them. Both files are rewritten with two-space indentation, and the map loses its `objects` field,
 * so a second run finds nothing to move. Numbers are rounded the way scene files store them.
 *
 * @param argv - The arguments after `import tilemap`.
 * @param io - The injected output sinks.
 * @returns What was moved.
 * @throws A {@link CliError} with code `IGX-1403` for bad arguments or a `--parent` that names no
 * single entity, `IGX-1405` when a file cannot be read or written, or `IGX-1407` when a file is not
 * the document the command expects.
 *
 * @example
 * ```ts
 * await runImportTilemap(["level.tilemap.json", "scenes/main.scene.json", "--parent", "Level"], io);
 * ```
 *
 * @public
 */
export async function runImportTilemap(argv: readonly string[], io: ImportIo): Promise<ImportTilemapResult> {
  const command = parseImportTilemapArgs(argv);
  const mapText = await readText(command.map);
  const sceneText = await readText(command.scene);
  const map = parseDocument(mapText, command.map, TILEMAP_FORMAT);
  const scene = parseDocument(sceneText, command.scene, SCENE_FORMAT);
  const objects = readObjects(map, command.map);
  if (objects.length === 0) {
    io.stdout(`${command.map} has no objects; nothing to import.`);
    return { map: command.map, scene: command.scene, entities: [] };
  }
  const entities = readEntities(scene, command.scene);
  const parent = command.parent === null ? null : findParent(entities, command.parent, command.scene);
  const taken = new Set(entities.map((entity) => (typeof entity["uid"] === "string" ? entity["uid"] : "")));
  const imported: ImportedTileObject[] = [];
  const records: JsonRecord[] = [];
  for (const object of objects) {
    const uid = freshUid(taken);
    const entry = importedObject(uid, object);
    imported.push(entry);
    records.push(entityRecord(entry, parent));
  }
  const at = parent === null ? entities.length : subtreeEnd(entities, parent);
  entities.splice(at, 0, ...records);
  delete map["objects"];
  await writeText(command.scene, stringify(scene, sceneText));
  await writeText(command.map, stringify(map, mapText));
  report(io, command, parent === null ? null : command.parent, imported);
  return { map: command.map, scene: command.scene, entities: imported };
}

/**
 * Reads a file as UTF-8 text.
 *
 * @param path - The file.
 * @returns Its text.
 * @throws A {@link CliError} with code `IGX-1405` when it cannot be read.
 */
async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not read "${path}".`, { cause: error });
  }
}

/**
 * Writes a file as UTF-8 text.
 *
 * @param path - The file.
 * @param text - Its new text.
 * @throws A {@link CliError} with code `IGX-1405` when it cannot be written.
 */
async function writeText(path: string, text: string): Promise<void> {
  try {
    await writeFile(path, text, "utf8");
  } catch (error) {
    throw new CliError(CliErrorCode.fileNotAccessible, `Could not write "${path}".`, { cause: error });
  }
}

/**
 * Whether a value is a JSON object rather than an array, a primitive or `null`.
 *
 * @param value - The value.
 * @returns `true` for an object.
 */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a document and checks its `format` header.
 *
 * @param text - The file's text.
 * @param path - The file, for messages.
 * @param format - The header it must carry.
 * @returns The parsed object.
 * @throws A {@link CliError} with code `IGX-1407` when it is not JSON or carries another header.
 */
function parseDocument(text: string, path: string, format: string): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CliError(CliErrorCode.invalidDocument, `"${path}" is not JSON.`, { cause: error });
  }
  if (!isRecord(value) || value["format"] !== format) {
    throw new CliError(CliErrorCode.invalidDocument, `"${path}" is not an ${format} document.`);
  }
  return value;
}

/**
 * Reads a tilemap's objects.
 *
 * @param map - The tilemap document.
 * @param path - The file, for messages.
 * @returns The objects, in document order.
 * @throws A {@link CliError} with code `IGX-1407` when `objects` is not a list of objects.
 */
function readObjects(map: JsonRecord, path: string): TileObject[] {
  const raw = map["objects"];
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CliError(CliErrorCode.invalidDocument, `"${path}" has an "objects" field that is not a list.`);
  }
  return raw.map((entry: unknown, index: number): TileObject => readObject(entry, `${path} objects[${String(index)}]`));
}

/**
 * Reads one tilemap object, applying the format's defaults.
 *
 * @param entry - The JSON entry.
 * @param where - The entry's location, for messages.
 * @returns The object.
 * @throws A {@link CliError} with code `IGX-1407` when a field has the wrong type.
 */
function readObject(entry: unknown, where: string): TileObject {
  if (!isRecord(entry)) {
    throw new CliError(CliErrorCode.invalidDocument, `${where} is not an object.`);
  }
  const text = (key: string): string => {
    const value = entry[key] ?? "";
    if (typeof value !== "string") {
      throw new CliError(CliErrorCode.invalidDocument, `${where}.${key} is not a string.`);
    }
    return value;
  };
  const number = (key: string): number => {
    const value = entry[key] ?? 0;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CliError(CliErrorCode.invalidDocument, `${where}.${key} is not a finite number.`);
    }
    return value;
  };
  const rawProperties = entry["properties"] ?? {};
  if (!isRecord(rawProperties)) {
    throw new CliError(CliErrorCode.invalidDocument, `${where}.properties is not an object.`);
  }
  const properties: [string, string | number | boolean][] = [];
  for (const [key, value] of Object.entries(rawProperties)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new CliError(
        CliErrorCode.invalidDocument,
        `${where}.properties.${key} is not a string, number or boolean.`,
      );
    }
    properties.push([key, value]);
  }
  return {
    name: text("name"),
    type: text("type"),
    x: number("x"),
    y: number("y"),
    width: number("width"),
    height: number("height"),
    // `fromEntries` defines own properties, so a property named `__proto__` stays a property.
    properties: Object.fromEntries(properties),
  };
}

/**
 * Reads a scene file's entity list.
 *
 * @param scene - The scene document.
 * @param path - The file, for messages.
 * @returns The list itself, which the command splices into.
 * @throws A {@link CliError} with code `IGX-1407` when `entities` is not a list of objects.
 */
function readEntities(scene: JsonRecord, path: string): JsonRecord[] {
  const raw: unknown = scene["entities"];
  // The array is the document's own, so the splice the caller makes lands in the file.
  if (Array.isArray(raw) && raw.every(isRecord)) {
    return raw;
  }
  throw new CliError(CliErrorCode.invalidDocument, `"${path}" has no "entities" list.`);
}

/**
 * Finds the one entity the `--parent` option names.
 *
 * @param entities - The scene's entities.
 * @param name - The entity name.
 * @param path - The scene file, for messages.
 * @returns The entity's uid.
 * @throws A {@link CliError} with code `IGX-1403` when no entity, or more than one, has the name.
 */
function findParent(entities: readonly JsonRecord[], name: string, path: string): string {
  const matches = entities.filter((entity) => entity["name"] === name);
  const uid = matches[0]?.["uid"];
  if (matches.length !== 1 || typeof uid !== "string") {
    throw new CliError(
      CliErrorCode.invalidArguments,
      matches.length === 0
        ? `"${path}" has no entity named "${name}".`
        : `"${path}" has ${String(matches.length)} entities named "${name}"; rename one, or leave out --parent.`,
    );
  }
  return uid;
}

/**
 * The index just past an entity's last descendant, where a new last child goes in tree order.
 *
 * @param entities - The scene's entities, parents before children.
 * @param uid - The parent's uid.
 * @returns The insertion index.
 */
function subtreeEnd(entities: readonly JsonRecord[], uid: string): number {
  const start = entities.findIndex((entity) => entity["uid"] === uid);
  const subtree = new Set<unknown>([uid]);
  let end = start + 1;
  while (end < entities.length && subtree.has(entities[end]?.["parent"])) {
    subtree.add(entities[end]?.["uid"]);
    end += 1;
  }
  return end;
}

/**
 * Generates a ULID no entity or component of the file already uses.
 *
 * @param taken - The uids in use; the new one is added.
 * @returns The uid.
 */
function freshUid(taken: Set<string>): string {
  let uid = generateUid();
  while (taken.has(uid)) {
    uid = generateUid();
  }
  taken.add(uid);
  return uid;
}

/**
 * Generates a ULID: a 48-bit millisecond timestamp and 80 random bits, in Crockford base32.
 *
 * @returns The uid.
 */
function generateUid(): string {
  let time = Date.now();
  let head = "";
  for (let index = 0; index < ULID_TIME_LENGTH; index += 1) {
    head = CROCKFORD.charAt(time % ULID_BASE) + head;
    time = Math.floor(time / ULID_BASE);
  }
  const random = randomBytes(ULID_RANDOM_LENGTH);
  let tail = "";
  for (const byte of random) {
    tail += CROCKFORD.charAt(byte % ULID_BASE);
  }
  return head + tail;
}

/**
 * Rounds a number the way scene files store it.
 *
 * @param value - The number.
 * @returns It rounded to six decimals, with `-0` as `0`.
 */
function canonical(value: number): number {
  const rounded = Math.round(value * CANONICAL_SCALE) / CANONICAL_SCALE;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Describes the entity one object becomes.
 *
 * @param uid - The entity's uid.
 * @param object - The object.
 * @returns The description.
 */
function importedObject(uid: string, object: TileObject): ImportedTileObject {
  return {
    uid,
    name: object.name === "" ? object.type : object.name,
    type: object.type,
    position: [canonical(object.x + object.width / 2), canonical(object.y + object.height / 2)],
    size: [canonical(object.width), canonical(object.height)],
    properties: object.properties,
  };
}

/**
 * Builds a scene-file entity record, with its keys in the order the engine's serializer writes.
 *
 * @param entry - The entity.
 * @param parent - The parent's uid, or `null`.
 * @returns The record.
 */
function entityRecord(entry: ImportedTileObject, parent: string | null): JsonRecord {
  return {
    uid: entry.uid,
    name: entry.name,
    parent,
    ...(entry.type === "" ? {} : { tags: [entry.type] }),
    transform: { position: [entry.position[0], entry.position[1], 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  };
}

/**
 * Formats a document as two-space-indented JSON, keeping a list of plain values on one line so a
 * tile array stays readable. A scene file holds no such list longer than a vector, which the
 * engine's own form writes one value per line, so scene files are written exactly that way.
 *
 * @param value - The document.
 * @param original - The file's text before the edit, whose final newline is kept or left out.
 * @returns The text.
 */
function stringify(value: JsonRecord, original: string): string {
  const isScene = value["format"] === SCENE_FORMAT;
  const text = isScene ? JSON.stringify(value, null, INDENT.length) : compact(value, "");
  return original.endsWith("\n") ? `${text}\n` : text;
}

/**
 * Formats a value with lists of plain values on one line.
 *
 * @param value - The value.
 * @param indent - The current indentation.
 * @returns The text.
 */
function compact(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.every((item: unknown) => item === null || typeof item !== "object")) {
      return `[${value.map((item: unknown) => JSON.stringify(item)).join(", ")}]`;
    }
    const inner = indent + INDENT;
    return `[\n${value.map((item: unknown) => inner + compact(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined);
    if (keys.length === 0) {
      return "{}";
    }
    const inner = indent + INDENT;
    return `{\n${keys.map((key) => `${inner}${JSON.stringify(key)}: ${compact(value[key], inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * Prints what moved, and what the user still has to do.
 *
 * @param io - The output sinks.
 * @param command - The command.
 * @param parent - The parent entity's name, or `null`.
 * @param imported - The entities added.
 */
function report(
  io: ImportIo,
  command: ImportTilemapCommand,
  parent: string | null,
  imported: readonly ImportedTileObject[],
): void {
  const where = parent === null ? "" : ` under "${parent}"`;
  io.stdout(`Moved ${String(imported.length)} object(s) from ${command.map} into ${command.scene}${where}:`);
  for (const entry of imported) {
    const tag = entry.type === "" ? "" : ` [${entry.type}]`;
    const properties = Object.entries(entry.properties).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
    const extras = [`${String(entry.size[0])} x ${String(entry.size[1])} m`, ...properties].join(", ");
    io.stdout(`  ${entry.name}${tag} at ${String(entry.position[0])}, ${String(entry.position[1])} (${extras})`);
  }
  io.stdout(
    "The entities have no components yet: add what each type needs, using the sizes and properties above, " +
      "or replace them with prefab instances.",
  );
}
