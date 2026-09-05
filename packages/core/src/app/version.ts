/**
 * The `@ignifx/core` version this build reports as `app.version` and as the core extension's
 * `version` (`docs/architecture/04-extensions.md` §1).
 *
 * @remarks
 * The literal is `"0.0.0"` in the repository and is stamped by the release pipeline: Changesets
 * writes the real number into `package.json`, and the build replaces this constant with it
 * (coding standards §12, `release.yml`). Reading the version from `package.json` at run time is not
 * an option — that would be an import-time side effect and a bundler hazard
 * (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export const VERSION = "0.0.0";
