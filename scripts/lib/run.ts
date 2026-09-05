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
}

/**
 * Runs a command to completion and captures its output.
 *
 * @param command - Executable to run.
 * @param args - Arguments for the executable.
 * @param cwd - Working directory for the child process.
 * @returns The exit code and captured output.
 * @throws When the executable could not be spawned at all.
 */
export function runCommand(command: string, args: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
  if (result.error !== undefined) {
    throw new Error(`failed to run \`${command} ${args.join(" ")}\`: ${result.error.message}`);
  }
  return { code: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
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
