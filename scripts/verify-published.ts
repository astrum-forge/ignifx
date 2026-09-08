#!/usr/bin/env node
/**
 * `pnpm release:verify` — proves that a release reached npm.
 *
 * `release.yml` runs this straight after `changeset publish`, and a human can run it by hand after
 * any release. It reads every publishable package under `packages/`, takes the version out of its
 * `package.json` (every package ships on one fixed version line, `CONSTITUTION.md` §4.1), and asks
 * the registry for that exact version. A package the registry does not have is a failure.
 *
 * This exists because a publisher's exit code is not evidence. `changeset publish` publishes one
 * package at a time, so a failure part-way through leaves half a release on the registry, and a
 * Trusted Publisher configured against the wrong workflow file answers E404 for a scoped package
 * (npm/cli#8976) — exactly the shape `@ignifx/*` has.
 *
 * Options:
 * - `--version <v>` — check this version instead of the one in each `package.json`.
 * - `--registry <url>` — a registry other than `https://registry.npmjs.org`.
 * - `--attempts <n>` — how many rounds to try before giving up (default 40, four minutes at the
 *   default delay). The registry is read through a CDN, so a version published seconds ago can
 *   still answer 404 — and not only for seconds: on 2026-09-08 `@ignifx/core@0.2.0` was the last of
 *   thirteen to appear and still read as missing after ten rounds, a minute after the publish,
 *   which failed the release job for a release that had in fact succeeded.
 * - `--delay-ms <n>` — how long to wait between rounds (default 6000).
 * - `--root <dir>` — run against a tree other than the repository.
 */
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArguments } from "./lib/args.ts";
import { FAIL_MARK, log, logDetail, logError, PASS_MARK } from "./lib/log.ts";
import { checkPackage, DEFAULT_REGISTRY, isUnresolved } from "./lib/registry.ts";
import { listWorkspacePackages, readJsonObject, repositoryRoot } from "./lib/workspace.ts";
import type { RegistryCheck } from "./lib/registry.ts";

/**
 * How many rounds are tried before the release is called a failure: four minutes at the default
 * delay, which is longer than the registry's CDN has been seen to lag (see the module comment).
 */
const DEFAULT_ATTEMPTS = 40;

/** How long to wait between rounds, in milliseconds. */
const DEFAULT_DELAY_MS = 6000;

/** One package this release should have put on the registry. */
interface Expected {
  /** The package name, for example `@ignifx/core`. */
  readonly name: string;
  /** The version its `package.json` carries. */
  readonly version: string;
}

/**
 * Reads a positive integer option, falling back when it is absent or not a number.
 *
 * @param raw - The option value as typed on the command line, or undefined.
 * @param fallback - The value to use instead.
 * @returns The parsed number, or the fallback.
 */
function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  // `Number`, not `parseInt`: `parseInt("10abc")` is 10, and a typo in a CI argument should fall
  // back to the default rather than silently mean something.
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Lists the packages a release is expected to publish: everything under `packages/` that is not
 * marked `private`.
 *
 * @param root - Absolute path to the repository root.
 * @param override - A version to expect for every package, or null to read each manifest.
 * @returns The expected name/version pairs, in workspace order.
 */
function expectedPackages(root: string, override: string | null): readonly Expected[] {
  const expected: Expected[] = [];
  for (const workspacePackage of listWorkspacePackages(root)) {
    const manifest = readJsonObject(path.join(workspacePackage.absolutePath, "package.json"));
    if (manifest["private"] === true) {
      continue;
    }
    expected.push({ name: workspacePackage.name, version: override ?? workspacePackage.version });
  }
  return expected;
}

/**
 * Asks the registry about every package that has not been found yet, once.
 *
 * @param registry - Registry base URL.
 * @param pending - The packages still unaccounted for.
 * @returns One result per package, in the same order.
 */
function round(registry: string, pending: readonly Expected[]): Promise<readonly RegistryCheck[]> {
  return Promise.all(pending.map((entry) => checkPackage(globalThis.fetch, registry, entry.name, entry.version)));
}

/**
 * Asks the registry about every expected package, retrying whatever it has not answered for yet.
 * The retry is the CDN: a version published seconds ago can still 404 on a cached route.
 *
 * @param registry - Registry base URL.
 * @param expected - Every package this release should have published.
 * @param attempts - How many rounds to run before giving up.
 * @param delayMs - How long to wait between rounds.
 * @returns The last answer for each package, by name.
 */
async function resolveAll(
  registry: string,
  expected: readonly Expected[],
  attempts: number,
  delayMs: number,
): Promise<ReadonlyMap<string, RegistryCheck>> {
  const settled = new Map<string, RegistryCheck>();
  let pending: readonly Expected[] = expected;
  for (let attempt = 1; attempt <= attempts && pending.length > 0; attempt += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the rounds are sequential on purpose: each asks only about what the last one did not find, and the wait below is the whole point of retrying.
    const results = await round(registry, pending);
    for (const result of results) {
      settled.set(result.name, result);
    }
    pending = pending.filter((entry) => {
      const check = settled.get(entry.name);
      return check === undefined || isUnresolved(check);
    });
    if (pending.length > 0 && attempt < attempts) {
      logDetail(
        `${String(pending.length)} not on the registry yet (attempt ${String(attempt)}/${String(attempts)}); ` +
          `waiting ${String(delayMs)} ms`,
      );
      // oxlint-disable-next-line eslint/no-await-in-loop -- see the note above.
      await delay(delayMs);
    }
  }
  return settled;
}

/**
 * Prints one line per package and counts the ones that did not arrive.
 *
 * @param expected - Every package this release should have published.
 * @param settled - What the registry said about each of them.
 * @returns How many packages are missing or could not be checked.
 */
function report(expected: readonly Expected[], settled: ReadonlyMap<string, RegistryCheck>): number {
  let failed = 0;
  for (const entry of expected) {
    const check = settled.get(entry.name);
    if (check === undefined || check.outcome !== "published") {
      failed += 1;
      logError(`${FAIL_MARK} ${entry.name}@${entry.version} — ${check?.detail ?? "not checked"}`);
      continue;
    }
    log(`${PASS_MARK} ${check.name}@${check.version} — ${check.detail}`);
  }
  return failed;
}

/**
 * Runs the verification.
 *
 * @returns The process exit code.
 */
async function main(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2), ["version", "registry", "attempts", "delay-ms", "root"]);
  const root = path.resolve(parsed.options.get("root") ?? repositoryRoot(import.meta.url));
  const registry = parsed.options.get("registry") ?? DEFAULT_REGISTRY;
  const attempts = positiveInteger(parsed.options.get("attempts"), DEFAULT_ATTEMPTS);
  const delayMs = positiveInteger(parsed.options.get("delay-ms"), DEFAULT_DELAY_MS);
  const expected = expectedPackages(root, parsed.options.get("version") ?? null);

  if (expected.length === 0) {
    logError("release:verify — no publishable package found under packages/");
    return 1;
  }
  log(`release:verify — ${String(expected.length)} packages against ${registry}`);

  const failed = report(expected, await resolveAll(registry, expected, attempts, delayMs));
  if (failed > 0) {
    logError(
      `release:verify — ${String(failed)} of ${String(expected.length)} packages did not reach ${registry}. ` +
        `Re-run the publish, or check the Trusted Publisher configuration for the packages listed above.`,
    );
    return 1;
  }
  log(`release:verify — all ${String(expected.length)} packages are on ${registry}`);
  return 0;
}

process.exitCode = await main();
