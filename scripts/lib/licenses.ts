/**
 * Third-party licence collection for `pnpm licenses:notices`
 * (`CONSTITUTION.md` §11.2: vendored or derived third-party code keeps its notice in
 * `THIRD_PARTY_NOTICES.md`).
 *
 * The rendering half is pure — {@link renderNotices} takes records and returns Markdown — so the
 * output shape is asserted on a fixture in `scripts/test/licenses.test.ts` rather than on whatever
 * happens to be installed. The collecting half ({@link collectNotices}) is what shells out to
 * `pnpm licenses list` and reads the installed packages' own files.
 *
 * ## What counts as a third-party production dependency
 *
 * The union of two sets, because neither alone is right:
 *
 * 1. Everything `pnpm licenses list --prod --json` reports for the workspace. That is the resolved
 *    production closure, so it catches a transitive dependency nobody declared directly.
 * 2. Every non-workspace specifier in the `dependencies`, `peerDependencies` and
 *    `optionalDependencies` of a **published** workspace package, plus the `dependencies` of each
 *    template. `pnpm licenses --prod` does not report a peer dependency the workspace only carries
 *    as a dev dependency — `electron` and `vite` are both in that position — and a consumer of a
 *    published package installs those for real.
 *
 * Workspace packages themselves (`ignifx`, `@ignifx/*`) are not third party: they are this
 * repository, under the licence in `LICENSE`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** One third-party package, as the notices file records it. */
export interface NoticeEntry {
  /** The package name, for example `@babylonjs/lite`. */
  readonly name: string;
  /** The installed versions, sorted, one line each. */
  readonly versions: readonly string[];
  /** The SPDX expression from the package's `license` field, or `"UNKNOWN"`. */
  readonly license: string;
  /** The copyright line lifted from the package's own licence file, or `null` when it has none. */
  readonly copyright: string | null;
  /** The repository URL, normalised to `https://…`, or `null`. */
  readonly repository: string | null;
  /** Which ignifx packages depend on it, sorted; empty when only a transitive dependency. */
  readonly requiredBy: readonly string[];
  /**
   * The contents of the package's own `NOTICE` file, or `null` when it ships none.
   *
   * @remarks
   * Reproduced verbatim, because Apache-2.0 §4(d) requires a redistribution to carry a readable
   * copy of the attribution notices a NOTICE file contains. `@babylonjs/lite` is the reason this
   * field exists: its NOTICE lists the licences of everything compiled into its WebAssembly.
   */
  readonly notice: string | null;
}

/** The `pnpm licenses list --json` shape this module reads. */
export interface PnpmLicenseRecord {
  /** The package name. */
  readonly name: string;
  /** The installed versions. */
  readonly versions?: readonly string[];
  /** Absolute paths of the installed copies, one per version. */
  readonly paths?: readonly string[];
  /** The SPDX expression pnpm resolved. */
  readonly license?: string;
}

/** The heading every generated notices file opens with. */
export const NOTICES_TITLE = "# Third-party notices";

/** The file `pnpm licenses:notices` writes. */
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.md";

/** The NOTICE file names a package may ship, in the order they are looked for. */
const NOTICE_FILE_NAMES: readonly string[] = ["NOTICE", "NOTICE.txt", "NOTICE.md", "notice", "notice.txt"];

/** The licence file names a package may ship, in the order they are looked for. */
const LICENSE_FILE_NAMES: readonly string[] = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "license",
  "license.md",
  "LICENSE-MIT",
  "LICENSE-APACHE",
  "COPYING",
];

/**
 * Narrows an unknown value to a plain object whose string keys can be read.
 *
 * @param value - The value to test.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reports whether a dependency specifier points at another package in this workspace.
 *
 * @param specifier - The version range from a `package.json`.
 * @returns `true` for `workspace:` ranges.
 */
export function isWorkspaceSpecifier(specifier: string): boolean {
  return specifier.startsWith("workspace:");
}

/** What a real copyright notice looks like, as opposed to prose containing the word. */
const COPYRIGHT_LINE = /^copyright\s+(?:\(c\)|©|\d{4})/iu;

/**
 * Reads the copyright line out of a licence text.
 *
 * @remarks
 * The first line that starts with `Copyright` after optional list punctuation, trimmed of trailing
 * whitespace and of the "All rights reserved." that often follows on the same line. A licence with
 * no such line yields `null` rather than a guess — Apache-2.0's own template has none, for
 * instance, and inventing one would be worse than saying there is none.
 *
 * @param text - The licence file's contents.
 * @returns The copyright line, or `null`.
 *
 * @example
 * ```ts
 * copyrightLineOf("MIT License\n\nCopyright (c) 2020 Someone\n"); // "Copyright (c) 2020 Someone"
 * ```
 */
export function copyrightLineOf(text: string): string | null {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\s>*-]+/u, "").trim();
    // `Copyright` followed by a marker or a year. Without that tail the Apache-2.0 boilerplate
    // matches — its definition of "Work" wraps onto a line beginning "copyright notice that is
    // included in or attached to the work", which is prose, not a notice.
    if (COPYRIGHT_LINE.test(line)) {
      return line
        .replaceAll(/\s+/gu, " ")
        .replace(/\s*all rights reserved\.?$/iu, "")
        .trim();
    }
  }
  return null;
}

/**
 * Normalises a `package.json` `repository` field to a browsable URL.
 *
 * @param value - The field, which may be a string or an object with a `url`.
 * @returns An `https://` URL, or `null` when there is nothing usable.
 *
 * @example
 * ```ts
 * repositoryUrlOf({ url: "git+https://github.com/a/b.git" }); // "https://github.com/a/b"
 * repositoryUrlOf("github:a/b");                              // "https://github.com/a/b"
 * ```
 */
export function repositoryUrlOf(value: unknown): string | null {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null && "url" in value && typeof value.url === "string"
        ? value.url
        : null;
  if (raw === null || raw === "") {
    return null;
  }
  if (raw.startsWith("github:")) {
    return `https://github.com/${raw.slice("github:".length)}`;
  }
  if (/^[\w.-]+\/[\w.-]+$/u.test(raw)) {
    return `https://github.com/${raw}`;
  }
  const stripped = raw
    .replace(/^git\+/u, "")
    .replace(/^git:\/\//u, "https://")
    .replace(/^ssh:\/\/git@/u, "https://")
    .replace(/^git@([^:]+):/u, "https://$1/")
    .replace(/\.git$/u, "");
  return stripped.startsWith("http") ? stripped : null;
}

/**
 * Reads the licence text a package ships, if it ships one.
 *
 * @param directory - The installed package directory.
 * @returns The file's contents, or `null`.
 */
function readLicenseText(directory: string): string | null {
  for (const name of LICENSE_FILE_NAMES) {
    const file = path.join(directory, name);
    try {
      if (statSync(file).isFile()) {
        return readFileSync(file, "utf8");
      }
    } catch {
      continue;
    }
  }
  // A few packages ship `LICENSE-<something>` names this list does not enumerate; one directory
  // read catches them without hard-coding more names.
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true }).toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (entry.isFile() && /^licen[cs]e/iu.test(entry.name)) {
        return readFileSync(path.join(directory, entry.name), "utf8");
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Reads the NOTICE text a package ships, if it ships one.
 *
 * @param directory - The installed package directory.
 * @returns The file's contents with trailing whitespace removed, or `null`.
 */
function readNoticeText(directory: string): string | null {
  for (const name of NOTICE_FILE_NAMES) {
    const file = path.join(directory, name);
    try {
      if (statSync(file).isFile()) {
        return readFileSync(file, "utf8")
          .replaceAll(/[ \t]+$/gmu, "")
          .trimEnd();
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Reads one installed package's own manifest.
 *
 * @param directory - The installed package directory.
 * @returns The parsed manifest, or an empty record when it cannot be read.
 */
function readInstalledManifest(directory: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Builds one notice entry from what is installed on disk.
 *
 * @param name - The package name.
 * @param record - What `pnpm licenses list` said about it, when it said anything.
 * @param requiredBy - The ignifx packages that declare it.
 * @returns The entry.
 */
export function noticeEntryFor(
  name: string,
  record: PnpmLicenseRecord | null,
  requiredBy: readonly string[],
): NoticeEntry {
  const directories = record?.paths ?? [];
  const first = directories[0];
  const manifest = first === undefined ? {} : readInstalledManifest(first);
  const declared = typeof manifest["license"] === "string" ? manifest["license"] : null;
  const text = first === undefined ? null : readLicenseText(first);
  const versions = [...(record?.versions ?? [])].toSorted((left, right) => left.localeCompare(right));
  return {
    name,
    versions,
    license: record?.license ?? declared ?? "UNKNOWN",
    copyright: text === null ? null : copyrightLineOf(text),
    repository: repositoryUrlOf(manifest["repository"]),
    requiredBy: [...requiredBy].toSorted((left, right) => left.localeCompare(right)),
    notice: first === undefined ? null : readNoticeText(first),
  };
}

/**
 * The length of the longest run of backticks in a text.
 *
 * @param text - The text to scan.
 * @returns The run length; `0` when there is none.
 */
function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const character of text) {
    current = character === "`" ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

/**
 * Renders the notices file.
 *
 * @remarks
 * Pure and deterministic: entries are sorted by name, versions inside an entry are sorted, and
 * nothing machine-specific (an install path, a timestamp, a package count that depends on the host)
 * reaches the output. That is what lets `pnpm licenses:check` be a `git diff`.
 *
 * @param entries - The packages to record.
 * @returns The Markdown, ending in a newline.
 *
 * @example
 * ```ts
 * renderNotices([
 *   { name: "left-pad", versions: ["1.3.0"], license: "WTFPL", copyright: null, repository: null,
 *     requiredBy: [], notice: null },
 * ]);
 * ```
 */
export function renderNotices(entries: readonly NoticeEntry[]): string {
  const sorted = [...entries].toSorted((left, right) => left.name.localeCompare(right.name));
  const lines: string[] = [
    NOTICES_TITLE,
    "",
    "<!-- Generated by `pnpm licenses:notices`. Do not edit by hand. -->",
    "",
    "ignifx itself is licensed under the Apache License 2.0 (see `LICENSE`). This file records the",
    "third-party packages a production install of the published packages and the game templates pulls",
    "in, with the licence each one is distributed under (`CONSTITUTION.md` §11.2).",
    "",
    "Sample art, audio and models shipped with a template are **not** listed here: each template",
    "records its own in `templates/<name>/ATTRIBUTION.md` (§11.3). The web fonts the project site uses",
    "are development-time packages and carry their licences in `website/public/licenses/`.",
    "",
    `${String(sorted.length)} ${sorted.length === 1 ? "package" : "packages"}.`,
    "",
  ];
  for (const entry of sorted) {
    const versions = [...entry.versions].toSorted((left, right) => left.localeCompare(right));
    lines.push(
      `## ${entry.name}`,
      "",
      `- Version: ${versions.length === 0 ? "unresolved" : versions.join(", ")}`,
      `- License: ${entry.license}`,
    );
    if (entry.copyright !== null) {
      lines.push(`- ${entry.copyright}`);
    }
    if (entry.repository !== null) {
      lines.push(`- Repository: <${entry.repository}>`);
    }
    if (entry.requiredBy.length > 0) {
      lines.push(`- Required by: ${entry.requiredBy.join(", ")}`);
    }
    lines.push("");
    if (entry.notice !== null) {
      // A fence long enough that nothing inside the NOTICE can close it early.
      const fence = "`".repeat(Math.max(3, longestBacktickRun(entry.notice) + 1));
      lines.push(
        "Its `NOTICE` file, reproduced as Apache-2.0 §4(d) requires:",
        "",
        `${fence}text`,
        entry.notice,
        fence,
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Flattens `pnpm licenses list --json` into one record per package name.
 *
 * @param json - The parsed output: a map of SPDX expression to package records.
 * @returns The records, keyed by package name.
 */
export function indexLicenseOutput(json: unknown): ReadonlyMap<string, PnpmLicenseRecord> {
  const found = new Map<string, PnpmLicenseRecord>();
  if (!isRecord(json)) {
    return found;
  }
  for (const value of Object.values(json)) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const record of value) {
      if (!isRecord(record)) {
        continue;
      }
      const name = record["name"];
      if (typeof name !== "string") {
        continue;
      }
      const previous = found.get(name);
      const versions = Array.isArray(record["versions"])
        ? record["versions"].filter((entry): entry is string => typeof entry === "string")
        : [];
      const paths = Array.isArray(record["paths"])
        ? record["paths"].filter((entry): entry is string => typeof entry === "string")
        : [];
      found.set(name, {
        name,
        versions: [...(previous?.versions ?? []), ...versions],
        paths: [...(previous?.paths ?? []), ...paths],
        license: typeof record["license"] === "string" ? record["license"] : (previous?.license ?? "UNKNOWN"),
      });
    }
  }
  return found;
}

/** One workspace manifest, reduced to what the collector needs. */
export interface WorkspaceManifest {
  /** The `name` field. */
  readonly name: string;
  /** Whether the package is `private`, and therefore never published. */
  readonly private: boolean;
  /** Third-party specifiers this package makes a consumer install, keyed by package name. */
  readonly runtimeDependencies: ReadonlyMap<string, string>;
}

/** The `package.json` fields that make a consumer install something. */
const RUNTIME_FIELDS: readonly string[] = ["dependencies", "peerDependencies", "optionalDependencies"];

/**
 * Reduces a parsed `package.json` to a {@link WorkspaceManifest}.
 *
 * @param manifest - The parsed manifest.
 * @returns The reduction; `devDependencies` are deliberately dropped.
 */
export function readWorkspaceManifest(manifest: Record<string, unknown>): WorkspaceManifest {
  const runtimeDependencies = new Map<string, string>();
  for (const field of RUNTIME_FIELDS) {
    const block = manifest[field];
    if (!isRecord(block)) {
      continue;
    }
    for (const [name, specifier] of Object.entries(block)) {
      if (typeof specifier === "string" && !isWorkspaceSpecifier(specifier)) {
        runtimeDependencies.set(name, specifier);
      }
    }
  }
  return {
    name: typeof manifest["name"] === "string" ? manifest["name"] : "",
    private: manifest["private"] === true,
    runtimeDependencies,
  };
}
