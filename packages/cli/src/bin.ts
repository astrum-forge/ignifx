#!/usr/bin/env node
// The process boundary for `create-ignifx`, and the only file in this package allowed to touch
// `process` (argv, exit code, stdout, stderr). Everything below it takes its I/O by injection, so
// this file stays thin enough to be verified by running the built binary rather than by unit
// tests; it is still type-checked and linted like the rest of `src`.
import { resolveTemplatesRoot, runCreate } from "./cli.js";
import { CliError } from "./errors.js";
import type { CreateIo } from "./cli.js";

// `<package>/templates/<name>` in a published tarball, the repository's own `templates/` in a
// checkout. `resolveTemplatesRoot` picks whichever exists; see its documentation.
const templatesRoot = await resolveTemplatesRoot(import.meta.dirname);

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
