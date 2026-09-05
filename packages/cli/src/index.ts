/**
 * `@ignifx/cli` public barrel. Explicit named re-exports only — no `export *`
 * (coding standards §4).
 *
 * @remarks
 * The `create-ignifx` executable is `src/bin.ts`; it is not part of this barrel because it is a
 * process entry point, not a library API.
 *
 * @packageDocumentation
 */

export {
  DEFAULT_TEMPLATE,
  parseArgs,
  resolveTemplateDir,
  runCreate,
  USAGE,
  type CreateCommand,
  type CreateIo,
} from "./cli.js";
export {
  copyTemplate,
  DEFAULT_IGNORED_ENTRIES,
  DEFAULT_TEMPLATE_RENAMES,
  type CopyTemplateOptions,
  type CopyTemplateResult,
} from "./copy-template.js";
export { CliError, CliErrorCode } from "./errors.js";
