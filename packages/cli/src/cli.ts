import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { copyTemplate } from "./copy-template.js";
import { CliError, CliErrorCode } from "./errors.js";
import type { CopyTemplateResult } from "./copy-template.js";
import type { Stats } from "node:fs";

/**
 * The template used when `--template` is not given.
 *
 * @public
 */
export const DEFAULT_TEMPLATE = "2d-topdown";

/**
 * The one-line usage string printed with every argument error.
 *
 * @public
 */
export const USAGE = "Usage: create-ignifx <target-dir> [--template <name>] [--overwrite] [--desktop]";

/**
 * A parsed `create-ignifx` invocation.
 *
 * @public
 */
export interface CreateCommand {
  /** Directory the project is scaffolded into, exactly as the user typed it. */
  readonly targetDir: string;
  /** Template name to copy; {@link DEFAULT_TEMPLATE} when `--template` was not given. */
  readonly template: string;
  /** Whether `--overwrite` was given, allowing a non-empty target directory. */
  readonly overwrite: boolean;
  /**
   * Whether `--desktop` was given, which copies the template's Electron variant
   * (`docs/architecture/14-platform-electron.md` §3).
   */
  readonly desktop: boolean;
}

/**
 * The side-effecting surface {@link runCreate} is allowed to touch.
 *
 * @remarks
 * Everything the command needs from the outside world is injected, so `runCreate` never reads
 * `process` and unit tests never spawn one (`CONSTITUTION.md` §3.6). Only `src/bin.ts` builds an
 * implementation backed by the real process.
 *
 * @public
 */
export interface CreateIo {
  /**
   * Writes one line of progress output.
   *
   * @param line - The line to write, without a trailing newline.
   */
  readonly stdout: (line: string) => void;
  /**
   * Writes one line of diagnostic output. Used by the process boundary to report a failure.
   *
   * @param line - The line to write, without a trailing newline.
   */
  readonly stderr: (line: string) => void;
  /** Directory that holds one subdirectory per template. */
  readonly templatesRoot: string;
}

/**
 * Turns a caught `parseArgs` failure into a message.
 *
 * @param error - The value thrown by `node:util`'s `parseArgs`.
 * @returns The failure message, or a generic one when the value is not an `Error`.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Could not parse the command line.";
}

/**
 * Parses a `create-ignifx` command line.
 *
 * @remarks
 * `--desktop` copies the template's Electron variant — its `desktop/` directory,
 * `electron.vite.config.ts`, `electron-builder.yml`, and the `*:desktop` scripts and dependencies
 * that go with them. Without it the scaffold is browser-only, which is what keeps a browser game
 * from downloading an Electron binary it never runs.
 *
 * @param argv - Arguments after the executable and script name, as `process.argv.slice(2)` gives them.
 * @returns The parsed command with defaults applied.
 * @throws A {@link CliError} with code `IGX-1403` when the command line is unparseable, the target
 * directory is missing, or extra positionals are given.
 *
 * @example
 * ```ts
 * const command = parseArgs(["my-game", "--template", "3d-first-person", "--desktop"]);
 * // { targetDir: "my-game", template: "3d-first-person", overwrite: false, desktop: true }
 * ```
 *
 * @public
 */
export function parseArgs(argv: readonly string[]): CreateCommand {
  let values: { readonly template?: string; readonly overwrite?: boolean; readonly desktop?: boolean };
  let positionals: readonly string[];
  try {
    const parsed = parseNodeArgs({
      args: [...argv],
      options: {
        template: { type: "string" },
        overwrite: { type: "boolean" },
        desktop: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    throw new CliError(CliErrorCode.invalidArguments, `${messageOf(error)}\n${USAGE}`, { cause: error });
  }

  const [targetDir, ...extra] = positionals;
  if (targetDir === undefined || targetDir === "") {
    throw new CliError(CliErrorCode.invalidArguments, `Missing <target-dir>.\n${USAGE}`);
  }
  if (extra.length > 0) {
    throw new CliError(
      CliErrorCode.invalidArguments,
      `Expected one target directory but got ${String(positionals.length)}.\n${USAGE}`,
    );
  }

  return {
    targetDir,
    template: values.template ?? DEFAULT_TEMPLATE,
    overwrite: values.overwrite ?? false,
    desktop: values.desktop ?? false,
  };
}

/**
 * Where `create-ignifx` looks for its templates, in order.
 *
 * @remarks
 * Both entries are relative to the directory holding the running `bin.js`.
 *
 * - `../templates` is the **published** layout: `prepack` copies `templates/*` into the package, so
 *   the tarball ships `<package>/dist/bin.js` beside `<package>/templates/<name>`.
 * - `../../../templates` is the **development** layout: `packages/cli/dist/bin.js` sits three
 *   directories below the repository root, where the real `templates/` workspace members live. It
 *   is what makes `node packages/cli/dist/bin.js my-game` work from a checkout, without a pack.
 *
 * @public
 */
export const TEMPLATE_ROOT_CANDIDATES: readonly string[] = ["../templates", "../../../templates"];

/**
 * Finds the directory that holds the templates.
 *
 * @param binDirectory - The directory of the running executable, normally `import.meta.dirname`.
 * @returns The first of {@link TEMPLATE_ROOT_CANDIDATES} that exists as a directory; the first
 * candidate when none does, so the failure names the published location rather than the checkout.
 *
 * @example
 * ```ts
 * const templatesRoot = await resolveTemplatesRoot(import.meta.dirname);
 * ```
 *
 * @public
 */
export async function resolveTemplatesRoot(binDirectory: string): Promise<string> {
  const candidates = TEMPLATE_ROOT_CANDIDATES.map((relative) => resolve(binDirectory, relative));
  // The candidates are inspected together and chosen in order: the preference is the *order*, not
  // the sequence of file-system calls, and one `stat` should not wait on another.
  const found = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return (await stat(candidate)).isDirectory();
      } catch {
        return false;
      }
    }),
  );
  const index = found.indexOf(true);
  return candidates[index === -1 ? 0 : index] ?? binDirectory;
}

/**
 * Maps a template name to its directory under `templatesRoot`.
 *
 * @param name - Template name, a single path segment such as `"2d-topdown"`.
 * @param templatesRoot - Directory that holds one subdirectory per template.
 * @returns The absolute or relative path of the template directory, which is known to exist.
 * @throws A {@link CliError} with code `IGX-1402` when `name` is not a single path segment or no
 * such directory exists.
 *
 * @public
 */
export async function resolveTemplateDir(name: string, templatesRoot: string): Promise<string> {
  // A template name indexes a directory listing, so anything that could escape it is rejected
  // before it reaches the file system.
  if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new CliError(CliErrorCode.templateNotFound, `"${name}" is not a valid template name.`);
  }

  const templateDir = join(templatesRoot, name);
  let stats: Stats;
  try {
    stats = await stat(templateDir);
  } catch (error) {
    throw new CliError(CliErrorCode.templateNotFound, `Unknown template "${name}" (looked in "${templatesRoot}").`, {
      cause: error,
    });
  }
  if (!stats.isDirectory()) {
    throw new CliError(CliErrorCode.templateNotFound, `Template "${name}" is not a directory.`);
  }
  return templateDir;
}

/**
 * Parses a command line, resolves the template, and copies it into the target directory.
 *
 * @param argv - Arguments after the executable and script name.
 * @param io - The injected output sinks and templates root.
 * @returns The files written, relative to the target directory.
 * @throws A {@link CliError} for every expected failure; see {@link parseArgs},
 * {@link resolveTemplateDir}, and {@link copyTemplate}.
 *
 * @example
 * ```ts
 * await runCreate(["my-game"], {
 *   stdout: (line) => lines.push(line),
 *   stderr: (line) => lines.push(line),
 *   templatesRoot: "/path/to/templates",
 * });
 * ```
 *
 * @public
 */
export async function runCreate(argv: readonly string[], io: CreateIo): Promise<CopyTemplateResult> {
  const command = parseArgs(argv);
  const templateDir = await resolveTemplateDir(command.template, io.templatesRoot);

  const variant = command.desktop ? " (desktop variant)" : "";
  io.stdout(`Creating an ignifx project in "${command.targetDir}" from template "${command.template}"${variant}.`);
  const result = await copyTemplate({
    templateDir,
    targetDir: command.targetDir,
    overwrite: command.overwrite,
    desktop: command.desktop,
  });
  io.stdout(`Wrote ${String(result.files.length)} files.`);
  io.stdout(`Next: cd ${command.targetDir} && pnpm install && pnpm dev`);
  if (command.desktop) {
    io.stdout("Desktop: pnpm dev:desktop · pnpm build:desktop · pnpm dist:desktop");
  }
  return result;
}
