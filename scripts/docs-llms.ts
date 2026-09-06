#!/usr/bin/env node
/**
 * `pnpm docs:llms` — regenerates `website/public/llms.txt`, the index of the Agent Skill for agents
 * browsing ignifx.com (`docs/architecture/16-docs-harness-and-skill.md` §1 and §3).
 *
 * The whole file is derived from `skills/ignifx/**` and the per-package `skills/`, so it states
 * only what the tree says; `lib/llms-index.ts` documents the repository-path → URL mapping, which
 * `website/README.md` repeats for whoever builds the site.
 *
 * Options: `--root <dir>` runs against a tree other than the repository (used by the tests).
 */
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { writeGeneratedFile } from "./lib/fs-tree.ts";
import { renderLlmsIndex } from "./lib/llms-index.ts";
import { log, logError } from "./lib/log.ts";
import { repositoryRoot } from "./lib/workspace.ts";

/**
 * Runs the generator.
 *
 * @returns The process exit code.
 */
function main(): number {
  const parsed = parseArguments(process.argv.slice(2), ["root"]);
  const root = path.resolve(parsed.options.get("root") ?? repositoryRoot(import.meta.url));
  const output = path.join(root, "website", "public", "llms.txt");
  let contents: string;
  try {
    contents = renderLlmsIndex(root);
  } catch (error) {
    logError(`docs:llms — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  writeGeneratedFile(output, contents);
  log(`docs:llms — ${String(contents.split("\n").filter((line) => line.startsWith("- [")).length)} entries`);
  return 0;
}

process.exitCode = main();
