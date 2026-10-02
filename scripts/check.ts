#!/usr/bin/env node
/**
 * `pnpm check` — the pre-pull-request gate (coding standards §12) as one command.
 *
 * The steps form a small graph rather than a chain: `build` and `format` start at once, everything
 * that reads `dist/` waits for `build`, and the docs harness also waits for `format` because its
 * regeneration rewrites the generated Markdown that `format:check` reads. Independent steps run side
 * by side, so the gate costs roughly its slowest step instead of the sum of all of them.
 *
 * Each step's output goes to `node_modules/.cache/ignifx-check/<step>.log`. The terminal gets one
 * line per step, and for a failed step the tail of its log and the log's path — what a person or an
 * agent needs to act on, without the thousands of lines a passing build replays.
 *
 * Options:
 *
 * - `--only <a,b>` — run just these steps (their prerequisites are not added; build first).
 * - `--skip <a,b>` — leave these steps out.
 * - `--full` — also run the steps CI runs in their own jobs: `pack-check`, `perf`, `browser`.
 * - `--tail <n>` — how many log lines a failed step prints (default 40).
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { FAIL_MARK, PASS_MARK, SKIP_MARK, log, logDetail } from "./lib/log.ts";
import { tailLines } from "./lib/run.ts";
import { repositoryRoot } from "./lib/workspace.ts";

/** One node of the gate. */
interface Step {
  /** The name printed, and accepted by `--only` / `--skip`. */
  readonly name: string;
  /** The `pnpm run` script the step runs. */
  readonly script: string;
  /** Steps that have to pass first. */
  readonly after: readonly string[];
  /** Whether the step runs only under `--full`. */
  readonly fullOnly?: boolean;
}

/** The gate. Order is only the print order; `after` decides when a step starts. */
const STEPS: readonly Step[] = [
  // The packages and the lint plugin — what every other step reads. The apps (templates, examples,
  // the site) are built by the CI `build` job and by the steps that serve them; leaving them out
  // here takes a `core` change from ~13 s of build to ~4 s.
  { name: "build", script: "build:packages", after: [] },
  { name: "format", script: "format:check", after: [] },
  { name: "lint", script: "lint", after: ["build"] },
  { name: "typecheck", script: "typecheck", after: ["build"] },
  { name: "test", script: "test:coverage", after: ["build"] },
  { name: "api-report", script: "api-report", after: ["build"] },
  { name: "docs-harness", script: "docs:harness", after: ["build", "format"] },
  { name: "pack-check", script: "pack-check", after: ["build"], fullOnly: true },
  { name: "perf", script: "test:perf", after: ["build", "test"], fullOnly: true },
  { name: "browser", script: "test:browser", after: ["build", "test"], fullOnly: true },
];

/** How one step ended. */
interface Outcome {
  /** `pass`, `fail`, or `skip` when a prerequisite failed. */
  readonly status: "pass" | "fail" | "skip";
  /** Wall-clock seconds. */
  readonly seconds: number;
}

/**
 * Splits a comma-separated option into names.
 *
 * @param value - The option value, if given.
 * @returns The names, or `null` when the option was absent.
 */
function names(value: string | undefined): ReadonlySet<string> | null {
  return value === undefined ? null : new Set(value.split(",").map((entry) => entry.trim()));
}

/**
 * Runs one `pnpm run <script>` with its output going to a log file.
 *
 * @param root - The repository root.
 * @param script - The script to run.
 * @param logFile - Where its output goes.
 * @returns The exit code.
 */
function runScript(root: string, script: string, logFile: string): Promise<number> {
  return new Promise((resolve) => {
    const sink = createWriteStream(logFile);
    const child = spawn("pnpm", ["run", script], { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false });
    child.stdout.pipe(sink, { end: false });
    child.stderr.pipe(sink, { end: false });
    child.on("error", (error) => {
      sink.end(`\nfailed to start: ${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => {
      sink.end(() => {
        resolve(code ?? 1);
      });
    });
  });
}

/**
 * Runs the gate.
 *
 * @returns The process exit code: 1 when any step failed, otherwise 0.
 */
async function main(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2), ["only", "skip", "tail"]);
  const root = repositoryRoot(import.meta.url);
  const only = names(parsed.options.get("only"));
  const skip = names(parsed.options.get("skip")) ?? new Set<string>();
  const full = parsed.flags.has("full");
  const tail = Number(parsed.options.get("tail") ?? "40");
  const logDirectory = path.join(root, "node_modules", ".cache", "ignifx-check");
  mkdirSync(logDirectory, { recursive: true });

  const selected = STEPS.filter((step) =>
    only === null ? !skip.has(step.name) && (full || step.fullOnly !== true) : only.has(step.name),
  );
  const chosen = new Set(selected.map((step) => step.name));
  const started = process.hrtime.bigint();
  const running = new Map<string, Promise<Outcome>>();

  const start = (step: Step): Promise<Outcome> => {
    const existing = running.get(step.name);
    if (existing !== undefined) {
      return existing;
    }
    const promise = (async (): Promise<Outcome> => {
      const prerequisites = step.after.filter((name) => chosen.has(name));
      const before = await Promise.all(
        prerequisites.map((name) => {
          const prerequisite = selected.find((candidate) => candidate.name === name);
          return prerequisite === undefined
            ? Promise.resolve<Outcome>({ status: "pass", seconds: 0 })
            : start(prerequisite);
        }),
      );
      if (before.some((outcome) => outcome.status !== "pass")) {
        log(`${SKIP_MARK} ${step.name}: SKIPPED (a prerequisite failed)`);
        return { status: "skip", seconds: 0 };
      }
      const stepStarted = process.hrtime.bigint();
      const logFile = path.join(logDirectory, `${step.name}.log`);
      const code = await runScript(root, step.script, logFile);
      const seconds = Number(process.hrtime.bigint() - stepStarted) / 1e9;
      if (code === 0) {
        log(`${PASS_MARK} ${step.name} ${seconds.toFixed(1)}s`);
        return { status: "pass", seconds };
      }
      log(`${FAIL_MARK} ${step.name} ${seconds.toFixed(1)}s — pnpm run ${step.script} exited ${String(code)}`);
      for (const line of tailLines(readFileSync(logFile, "utf8"), tail).split("\n")) {
        logDetail(line);
      }
      logDetail(`full log: ${path.relative(root, logFile)}`);
      return { status: "fail", seconds };
    })();
    running.set(step.name, promise);
    return promise;
  };

  const outcomes = await Promise.all(selected.map((step) => start(step)));
  const count = (status: Outcome["status"]): number => outcomes.filter((outcome) => outcome.status === status).length;
  const failed = count("fail");
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  log(
    `check — ${String(count("pass"))} passed, ${String(failed)} failed, ${String(count("skip"))} skipped` +
      ` in ${seconds.toFixed(1)}s`,
  );
  return failed > 0 ? 1 : 0;
}

process.exitCode = await main();
