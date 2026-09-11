#!/usr/bin/env node
/**
 * Regenerate format tables and the JSON Schema bundle from built package schema exports.
 * Write generated pages under `skills/ignifx/references/formats`, preserving hand-written files.
 * See docs/architecture/16-docs-harness-and-skill.md §3 for the generation contract.
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
