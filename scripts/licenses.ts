#!/usr/bin/env node
/**
 * `pnpm licenses:notices` — regenerates `THIRD_PARTY_NOTICES.md`, the record of every third-party
 * package a production install pulls in (`CONSTITUTION.md` §11.2).
 *
 * `pnpm licenses:check` runs the same generator with `--check`, which writes nothing and exits
 * non-zero when the committed file is not what the generator would produce. CI runs the check and
 * then a `git diff --exit-code`, so a dependency added without a notice is a red build rather than
 * a discovery at release time.
 *
 * What is collected, and why it is two sources rather than one, is documented in `lib/licenses.ts`.
 *
 * Options:
 * - `--root <dir>` — run against a tree other than the repository (used by the tests).
 * - `--check` — compare instead of writing.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { exists, listDirectories, readText, writeGeneratedFile } from "./lib/fs-tree.ts";
import {
  indexLicenseOutput,
  noticeEntryFor,
  NOTICES_FILE,
  readWorkspaceManifest,
  renderNotices,
} from "./lib/licenses.ts";
import { log, logError } from "./lib/log.ts";
import { readJsonObject, repositoryRoot } from "./lib/workspace.ts";
import type { NoticeEntry, PnpmLicenseRecord } from "./lib/licenses.ts";

/** The workspace directories whose manifests declare what a consumer installs. */
const MANIFEST_ROOTS: readonly string[] = ["packages", "templates"];

/**
 * Runs `pnpm licenses list` and parses its JSON.
 *
 * @param root - The repository root to run in.
 * @param productionOnly - Whether to pass `--prod`.
 * @returns The parsed output, or `null` when pnpm failed.
 */
function readPnpmLicenses(root: string, productionOnly: boolean): unknown {
  const result = spawnSync("pnpm", ["licenses", "list", ...(productionOnly ? ["--prod"] : []), "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout === "") {
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Reads every workspace manifest under `packages/` and `templates/`.
 *
 * @param root - The repository root.
 * @returns The third-party names each ignifx package makes a consumer install, keyed by name.
 */
function declaredRuntimeDependencies(root: string): ReadonlyMap<string, string[]> {
  const required = new Map<string, string[]>();
  for (const group of MANIFEST_ROOTS) {
    const directory = path.join(root, group);
    for (const child of listDirectories(directory)) {
      const manifestFile = path.join(directory, child, "package.json");
      if (!exists(manifestFile)) {
        continue;
      }
      const manifest = readWorkspaceManifest(readJsonObject(manifestFile));
      for (const name of manifest.runtimeDependencies.keys()) {
        const existing = required.get(name) ?? [];
        existing.push(manifest.name);
        required.set(name, existing);
      }
    }
  }
  return required;
}

/**
 * Collects the notice entries for a repository.
 *
 * @param root - The repository root.
 * @returns The entries, unsorted; {@link renderNotices} sorts them.
 */
function collectNotices(root: string): readonly NoticeEntry[] {
  const all = indexLicenseOutput(readPnpmLicenses(root, false));
  const production = indexLicenseOutput(readPnpmLicenses(root, true));
  const declared = declaredRuntimeDependencies(root);

  const names = new Set<string>([...production.keys(), ...declared.keys()]);
  const entries: NoticeEntry[] = [];
  for (const name of names) {
    // A workspace package is this repository, not a third party.
    if (name === "ignifx" || name.startsWith("@ignifx/")) {
      continue;
    }
    const record: PnpmLicenseRecord | null = production.get(name) ?? all.get(name) ?? null;
    entries.push(noticeEntryFor(name, record, declared.get(name) ?? []));
  }
  return entries;
}

/**
 * Runs the generator.
 *
 * @returns The process exit code.
 */
function main(): number {
  const parsed = parseArguments(process.argv.slice(2), ["root"]);
  const root = path.resolve(parsed.options.get("root") ?? repositoryRoot(import.meta.url));
  const output = path.join(root, NOTICES_FILE);

  let contents: string;
  try {
    contents = renderNotices(collectNotices(root));
  } catch (error) {
    logError(`licenses — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const count = contents.split("\n").filter((line) => line.startsWith("## ")).length;
  if (parsed.flags.has("check")) {
    const current = exists(output) ? readText(output) : "";
    if (current === contents) {
      log(`licenses:check — ${NOTICES_FILE} is up to date (${String(count)} packages)`);
      return 0;
    }
    logError(`licenses:check — ${NOTICES_FILE} is stale. Run: pnpm licenses:notices`);
    return 1;
  }

  writeGeneratedFile(output, contents);
  log(`licenses:notices — ${NOTICES_FILE}, ${String(count)} packages`);
  return 0;
}

process.exitCode = main();
