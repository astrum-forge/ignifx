#!/usr/bin/env node
// The process boundary for `create-ignifx`, and the only file in this package allowed to touch
// `process` (argv, exit code, stdout, stderr). Everything below it takes its I/O by injection, so
// this file stays thin enough to be verified by running the built binary rather than by unit
// tests; it is still type-checked and linted like the rest of `src`.
import { resolve } from "node:path";
import { runCreate } from "./cli.js";
import { CliError } from "./errors.js";
import type { CreateIo } from "./cli.js";

// Published layout: `<package>/dist/bin.js` next to `<package>/templates/<name>`. The real
// templates land in Phases 6-7 of the engineering plan; until then this resolves to a directory
// that does not exist and the command fails with IGX-1402.
const templatesRoot = resolve(import.meta.dirname, "../templates");

const io: CreateIo = {
  // Coding standards §5.5 bans `console` outside the logging sink; this is the documented boundary
  // where the CLI's output actually reaches the terminal, written through the process streams.
  stdout: (line: string): void => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line: string): void => {
    process.stderr.write(`${line}\n`);
  },
  templatesRoot,
};

try {
  await runCreate(process.argv.slice(2), io);
} catch (error) {
  if (!(error instanceof CliError)) {
    throw error;
  }
  io.stderr(`${error.code} ${error.message}`);
  process.exitCode = 1;
}
