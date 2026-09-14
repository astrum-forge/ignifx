#!/usr/bin/env node
// The process boundary for the `ignifx` executable, and — with `src/bin.ts` — one of the two files
// in this package allowed to touch `process`. Everything below it takes its I/O by injection. The
// file is named `bin.ts` because that is what exempts an entry point from the module-side-effects
// rule (`tools/eslint-plugin-ignifx/src/rules/no-module-side-effects.ts`).
import { CliError, CliErrorCode } from "../errors.js";
import { runImportHeightmap } from "../import-heightmap.js";
import type { ImportIo } from "../import-heightmap.js";

/** What `ignifx` prints when it is given a command it does not have. */
const USAGE = ["Usage: ignifx import heightmap <in.png> <out.r16>", "", "Scaffolding lives in `npx @ignifx/cli`."].join(
  "\n",
);

const io: ImportIo = {
  // Coding standards §5.5 bans `console` outside the logging sink; this is the documented boundary
  // where the CLI's output reaches the terminal, written through the process streams.
  stdout: (line: string): void => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line: string): void => {
    process.stderr.write(`${line}\n`);
  },
};

const argv = process.argv.slice(2);

try {
  if (argv[0] === "import" && argv[1] === "heightmap") {
    await runImportHeightmap(argv.slice(2), io);
  } else {
    throw new CliError(CliErrorCode.invalidArguments, `Unknown command.\n${USAGE}`);
  }
} catch (error) {
  if (!(error instanceof CliError)) {
    throw error;
  }
  io.stderr(`${error.code} ${error.message}`);
  process.exitCode = 1;
}
