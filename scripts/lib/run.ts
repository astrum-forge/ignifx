/**
 * Child-process helper for the docs harness. Nothing here calls `process.exit`; failures are
 * returned as data so the caller can turn them into a named check result (coding standards §5.5).
 */
import { spawnSync } from "node:child_process";

/** The outcome of running a child process to completion. */
export interface CommandResult {
  /** Exit code, or -1 when the process was killed by a signal. */
  readonly code: number;
  /** Standard output and standard error, concatenated in that order. */
  readonly output: string;
  /** Whether the process was killed because it outlived `timeoutMs`. */
  readonly timedOut: boolean;
  /** Wall-clock duration in milliseconds, rounded to the nearest millisecond. */
  readonly durationMs: number;
}

/** Optional limits for {@link runCommand}. */
export interface RunOptions {
  /** Kill the child after this many milliseconds; omitted means no limit. */
  readonly timeoutMs?: number;
}

/**
 * Runs a command to completion and captures its output.
 *
 * @param command - Executable to run.
 * @param args - Arguments for the executable.
 * @param cwd - Working directory for the child process.
 * @param options - Optional limits, currently only a timeout.
 * @returns The exit code, captured output, timeout flag and duration.
 * @throws When the executable could not be spawned at all.
 */
export function runCommand(command: string, args: readonly string[], cwd: string, options?: RunOptions): CommandResult {
  const started = process.hrtime.bigint();
  const timeout = options?.timeoutMs;
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    ...(timeout === undefined ? {} : { timeout, killSignal: "SIGKILL" as const }),
  });
  const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
  // `spawnSync` reports a timeout as `status: null` plus a killing signal, and only sets `error`
  // when the executable could not be started at all — so the two cases have to be told apart here.
  const timedOut = timeout !== undefined && result.status === null && result.signal !== null;
  if (result.error !== undefined && !timedOut) {
    throw new Error(`failed to run \`${command} ${args.join(" ")}\`: ${result.error.message}`);
  }
  return { code: result.status ?? -1, output: `${result.stdout}${result.stderr}`, timedOut, durationMs };
}

/**
 * Returns the last lines of a captured output block, for compact failure messages.
 *
 * @param output - Captured process output.
 * @param count - Maximum number of lines to keep.
 * @returns The trailing lines, joined by newlines.
 */
export function tailLines(output: string, count: number): string {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-count)
    .join("\n");
}
