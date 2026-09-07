#!/usr/bin/env node
/**
 * `pnpm skills:version` — writes `@ignifx/core`'s version into every skill's frontmatter.
 *
 * The skills declare the engine version they document, and `check-skill-lint.ts` holds
 * `metadata.ignifx-version` to `@ignifx/core`'s version: while core is `0.0.0` the placeholder
 * `"0.0.0-unreleased"` is accepted too, and from the first real release nothing but the exact
 * version is. Nothing regenerates these files, so without this step `changeset version` bumps the
 * packages and leaves eleven skills behind — which is exactly what the `docs-harness` job reported
 * on the first "Version Packages" pull request (2026-09-07): ten skill-lint problems, all of them
 * `"0.0.0-unreleased", expected one of "0.1.0"`.
 *
 * It therefore runs as part of the version step (`pnpm version-packages`), not by hand.
 *
 * Options:
 * - `--check` — write nothing and exit non-zero if any skill is out of date.
 * - `--root <dir>` — run against a tree other than the repository.
 */
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { readText, writeGeneratedFile } from "./lib/fs-tree.ts";
import { FAIL_MARK, log, logDetail, logError, PASS_MARK } from "./lib/log.ts";
import { findSkillRoots } from "./lib/skill-files.ts";
import { rewriteSkillVersion } from "./lib/skill-version.ts";
import { releaseVersion, repositoryRoot } from "./lib/workspace.ts";

/**
 * Runs the sync.
 *
 * @returns The process exit code.
 */
function main(): number {
  const parsed = parseArguments(process.argv.slice(2), ["root"]);
  const root = path.resolve(parsed.options.get("root") ?? repositoryRoot(import.meta.url));
  const checkOnly = parsed.flags.has("check");
  const version = releaseVersion(root);
  const roots = findSkillRoots(root, path.join(root, "skills"));

  if (roots.length === 0) {
    logError("skills:version — no skill found; is --root pointing at the repository?");
    return 1;
  }

  const stale: string[] = [];
  let written = 0;
  for (const skill of roots) {
    const result = rewriteSkillVersion(readText(skill.skillFile), version);
    if (result.previous === null) {
      // A missing key is skill-lint's problem to report, not something to invent a line for.
      logDetail(`${skill.label}: no \`metadata.ignifx-version\` to update`);
      continue;
    }
    if (!result.changed) {
      continue;
    }
    if (checkOnly) {
      stale.push(`${skill.label}: is "${result.previous}", should be "${version}"`);
      continue;
    }
    writeGeneratedFile(skill.skillFile, result.text);
    logDetail(`${skill.label}: ${result.previous} → ${version}`);
    written += 1;
  }

  if (checkOnly) {
    if (stale.length > 0) {
      for (const problem of stale) {
        logError(`${FAIL_MARK} ${problem}`);
      }
      logError(`skills:version --check — ${String(stale.length)} skills are stale. Run: pnpm skills:version`);
      return 1;
    }
    log(
      `${PASS_MARK} skills:version --check — all ${String(roots.length)} skills declare a version accepted for ${version}`,
    );
    return 0;
  }

  log(`skills:version — ${String(written)} of ${String(roots.length)} skills updated to ${version}`);
  return 0;
}

process.exitCode = main();
