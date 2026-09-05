#!/usr/bin/env node
/**
 * `pnpm docs:schemas` — regenerates the file-format tables and the JSON Schema bundle that the
 * agent skill points at (`docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * ## Discovery convention
 *
 * A package contributes schemas to the documentation by exporting a `schemas` binding from its
 * built entry point, `packages/<dir>/dist/index.js`. The binding is a record keyed by component
 * `typeId`:
 *
 * ```js
 * export const schemas = {
 *   "ignifx/MeshRenderer": {
 *     title: "MeshRenderer",              // optional; defaults to the part after the slash
 *     format: "components",               // optional; the formats page this entry lands on
 *     description: "Draws a mesh asset.", // optional
 *     fields: {
 *       mesh: { kind: "asset", default: null, description: "The mesh to draw." },
 *     },
 *   },
 * };
 * ```
 *
 * Discovery is by convention, not configuration: every `packages/<dir>/dist/index.js` that exists is
 * imported, and a package without a `schemas` export simply contributes nothing. Nothing before
 * Phase 1 exports one, so the script writes no files and exits 0 today.
 *
 * ## Output
 *
 * - `skills/ignifx/references/formats/<format>.md` — one table per component, grouped by `format`.
 * - `skills/ignifx/references/formats/ignifx.schemas.json` — every schema in one bundle.
 *
 * The script only ever writes those files; it never cleans the directory, so the hand-written
 * `formats/README.md` and the prose pages beside it survive regeneration.
 *
 * Options: `--root <dir>` runs against a tree other than the repository (used by the tests).
 */
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { exists, listDirectories, writeGeneratedFile } from "./lib/fs-tree.ts";
import { log, logError } from "./lib/log.ts";
import { renderFormatPage, renderSchemaBundle } from "./lib/schema-render.ts";
import { collectSchemas } from "./lib/schema-source.ts";
import { releaseVersion, repositoryRoot } from "./lib/workspace.ts";

/**
 * Runs the generator.
 *
 * @returns The process exit code.
 */
async function main(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2), ["root"]);
  const root = path.resolve(parsed.options.get("root") ?? repositoryRoot(import.meta.url));
  const packagesDirectory = path.join(root, "packages");
  const candidates = listDirectories(packagesDirectory)
    .map((directory) => ({ directory, entry: path.join(packagesDirectory, directory, "dist", "index.js") }))
    .filter((candidate) => exists(candidate.entry));

  const collected = await collectSchemas(candidates);
  if (collected.errors.length > 0) {
    for (const message of collected.errors) {
      logError(`docs:schemas — ${message}`);
    }
    return 1;
  }

  const packageCount = new Set(collected.schemas.map((schema) => schema.packageDirectory)).size;
  if (collected.schemas.length === 0) {
    log(`docs:schemas — 0 schemas from 0 packages`);
    return 0;
  }

  const outputDirectory = path.join(root, "skills", "ignifx", "references", "formats");
  const formats = [...new Set(collected.schemas.map((schema) => schema.format))].toSorted();
  for (const format of formats) {
    const page = collected.schemas.filter((schema) => schema.format === format);
    writeGeneratedFile(path.join(outputDirectory, `${format}.md`), renderFormatPage(format, page));
  }
  writeGeneratedFile(
    path.join(outputDirectory, "ignifx.schemas.json"),
    renderSchemaBundle(releaseVersion(root), collected.schemas),
  );
  const count = collected.schemas.length;
  log(
    `docs:schemas — ${String(count)} ${count === 1 ? "schema" : "schemas"} from ${String(packageCount)}` +
      ` ${packageCount === 1 ? "package" : "packages"} into ${String(formats.length + 1)} files`,
  );
  return 0;
}

process.exitCode = await main();
