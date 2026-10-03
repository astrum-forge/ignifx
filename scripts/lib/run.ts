/**
 * Child-process helper for the docs harness. Nothing here calls `process.exit`; failures are
 * returned as data so the caller can turn them into a named check result (coding standards §5.5).
 */
import { spawn, spawnSync } from "node:child_process";

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
 * Runs a command to completion without blocking the event loop, so several can run at once.
 *
 * @param command - Executable to run.
 * @param args - Arguments for the executable.
 * @param cwd - Working directory for the child process.
 * @param options - Optional limits, currently only a timeout.
 * @returns The exit code, captured output, timeout flag and duration.
 * @throws When the executable could not be spawned at all.
 */
export function runCommandAsync(
  command: string,
  args: readonly string[],
  cwd: string,
  options?: RunOptions,
): Promise<CommandResult> {
  const started = process.hrtime.bigint();
  const timeout = options?.timeoutMs;
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer =
      timeout === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`failed to run \`${command} ${args.join(" ")}\`: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      resolve({ code: code ?? -1, output: `${stdout}${stderr}`, timedOut, durationMs });
    });
  });
}

/**
 * Maps over items with at most `limit` promises in flight, keeping the input order.
 *
 * @param items - The inputs.
 * @param limit - The most calls of `task` allowed to be pending at once.
 * @param task - Starts the work for one input.
 * @returns The results, in input order.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  // One iterator shared by every worker: each `next()` hands out a different item.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) {
      // oxlint-disable-next-line no-await-in-loop -- each worker runs its share one at a time on purpose.
      results[index] = await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
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
