/**
 * Third-party files committed to the repository and shipped inside a published package, recorded in
 * a `vendored.json` next to them (`CONSTITUTION.md` §11.2: vendored or derived third-party code
 * keeps its notice in `THIRD_PARTY_NOTICES.md`).
 *
 * Today that is `packages/core/decoders/`: the Babylon.js KTX2 decoder and transcoders and the
 * meshoptimizer decoder, which Babylon Lite would otherwise fetch from `cdn.babylonjs.com`.
 * `scripts/vendor-decoders.ts` writes the files and the record; `pnpm licenses:notices` reads the
 * record, because a vendored file is in no `package.json` and `pnpm licenses list` cannot see it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exists, listDirectories } from "./fs-tree.ts";
import { isRecord } from "./workspace.ts";

/** The file name of the record that sits next to vendored files. */
export const VENDORED_MANIFEST = "vendored.json";

/** One vendored file. */
export interface VendoredFile {
  /** The name it is committed and served under, relative to the record's directory. */
  readonly file: string;
  /** Its path inside the upstream npm package. */
  readonly from: string;
  /** The lowercase hex SHA-256 of its bytes, so a hand edit or a formatter run is caught. */
  readonly sha256: string;
  /** What the vendoring script changed in it, when it is not a byte-for-byte copy. */
  readonly note?: string;
}

/** One upstream npm package that files were taken from. */
export interface VendoredComponent {
  /** The npm package name. */
  readonly name: string;
  /** The exact version the files came from. */
  readonly version: string;
  /** The npm `integrity` of the tarball. */
  readonly integrity: string;
  /** The SPDX expression of the package's `license` field. */
  readonly license: string;
  /** The upstream repository, `https://…`. */
  readonly repository: string;
  /** The copyright line the notices file prints. */
  readonly copyright: string;
  /** The package's licence text, copied next to the files. */
  readonly licenseFile: string;
  /** The package's `NOTICE` file, copied next to the files, or `null` when it ships none. */
  readonly noticeFile: string | null;
  /** The files taken from it. */
  readonly files: readonly VendoredFile[];
}

/** The contents of a `vendored.json`. */
export interface VendoredManifest {
  /** The upstream packages, in the order the vendoring script lists them. */
  readonly components: readonly VendoredComponent[];
}

/**
 * Reads a required string field.
 *
 * @param object - The object to read from.
 * @param key - The field.
 * @param where - What the object is, for the message.
 * @returns The value.
 * @throws Error when the field is missing or not a string.
 */
function stringField(object: Record<string, unknown>, key: string, where: string): string {
  const value = object[key];
  if (typeof value !== "string") {
    throw new TypeError(`${where}: "${key}" must be a string`);
  }
  return value;
}

/**
 * Parses one file record.
 *
 * @param value - The parsed JSON.
 * @param where - What it is, for messages.
 * @returns The record.
 */
function parseFile(value: unknown, where: string): VendoredFile {
  if (!isRecord(value)) {
    throw new TypeError(`${where}: a file must be an object`);
  }
  const note = value["note"];
  if (note !== undefined && typeof note !== "string") {
    throw new TypeError(`${where}: "note" must be a string`);
  }
  return {
    file: stringField(value, "file", where),
    from: stringField(value, "from", where),
    sha256: stringField(value, "sha256", where),
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * Parses one component record.
 *
 * @param value - The parsed JSON.
 * @param where - What it is, for messages.
 * @returns The record.
 */
function parseComponent(value: unknown, where: string): VendoredComponent {
  if (!isRecord(value)) {
    throw new TypeError(`${where}: a component must be an object`);
  }
  const files = value["files"];
  if (!Array.isArray(files)) {
    throw new TypeError(`${where}: "files" must be an array`);
  }
  const notice = value["noticeFile"];
  if (notice !== null && typeof notice !== "string") {
    throw new TypeError(`${where}: "noticeFile" must be a string or null`);
  }
  const name = stringField(value, "name", where);
  return {
    name,
    version: stringField(value, "version", where),
    integrity: stringField(value, "integrity", where),
    license: stringField(value, "license", where),
    repository: stringField(value, "repository", where),
    copyright: stringField(value, "copyright", where),
    licenseFile: stringField(value, "licenseFile", where),
    noticeFile: notice,
    files: files.map((file: unknown, index) => parseFile(file, `${where} ${name} files[${String(index)}]`)),
  };
}

/**
 * Parses a `vendored.json`.
 *
 * @param json - The parsed JSON.
 * @param where - The file it came from, for messages.
 * @returns The manifest.
 * @throws Error when the shape is wrong.
 */
export function parseVendoredManifest(json: unknown, where: string): VendoredManifest {
  if (!isRecord(json) || !Array.isArray(json["components"])) {
    throw new TypeError(`${where}: expected { "components": [...] }`);
  }
  return {
    components: json["components"].map((component: unknown, index) =>
      parseComponent(component, `${where} components[${String(index)}]`),
    ),
  };
}

/**
 * Reads and parses a `vendored.json` from disk.
 *
 * @param file - The absolute path of the record.
 * @returns The manifest.
 */
export function readVendoredManifest(file: string): VendoredManifest {
  return parseVendoredManifest(JSON.parse(readFileSync(file, "utf8")), file);
}

/**
 * Finds every `vendored.json` one directory below a workspace package: `packages/<name>/<dir>/`.
 *
 * @param root - The repository root.
 * @returns The records, as `{ packageDirectory, file }`, sorted by path.
 */
export function findVendoredManifests(
  root: string,
): readonly { readonly packageDirectory: string; readonly file: string }[] {
  const found: { packageDirectory: string; file: string }[] = [];
  const packagesDirectory = path.join(root, "packages");
  for (const name of listDirectories(packagesDirectory)) {
    const packageDirectory = path.join(packagesDirectory, name);
    for (const child of listDirectories(packageDirectory)) {
      const file = path.join(packageDirectory, child, VENDORED_MANIFEST);
      if (exists(file)) {
        found.push({ packageDirectory, file });
      }
    }
  }
  return found;
}

/**
 * The lowercase hex SHA-256 of some bytes.
 *
 * @param bytes - The bytes.
 * @returns The digest.
 */
export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Checks every file a record lists against its recorded digest.
 *
 * @param file - The absolute path of the `vendored.json`.
 * @returns One line per problem; empty when every file is present and unchanged.
 */
export function verifyVendoredFiles(file: string): readonly string[] {
  const directory = path.dirname(file);
  const problems: string[] = [];
  for (const component of readVendoredManifest(file).components) {
    const listed = [
      ...component.files.map((entry) => entry.file),
      component.licenseFile,
      ...(component.noticeFile === null ? [] : [component.noticeFile]),
    ];
    for (const name of listed) {
      if (!exists(path.join(directory, name))) {
        problems.push(`${component.name}: ${name} is missing`);
      }
    }
    for (const entry of component.files) {
      const target = path.join(directory, entry.file);
      if (exists(target) && sha256Of(readFileSync(target)) !== entry.sha256) {
        problems.push(`${component.name}: ${entry.file} does not match its recorded SHA-256`);
      }
    }
  }
  return problems;
}
