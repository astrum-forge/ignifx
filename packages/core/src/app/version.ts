// The build replaces this with the version in `package.json` (`define` in `tsdown.config.ts`).
declare const IGNIFX_BUILD_VERSION: string | undefined;

/**
 * The `@ignifx/core` version this build reports as `app.version` and as the core extension's
 * `version` (`docs/architecture/04-extensions.md` §1).
 *
 * @remarks
 * The build stamps it from `package.json`, where Changesets writes each release's number; code run
 * from source, such as this repository's tests, sees `"0.0.0"`. Reading `package.json` at run time
 * is not an option: that would be an import-time side effect and a bundler hazard
 * (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export const VERSION: string = typeof IGNIFX_BUILD_VERSION === "string" ? IGNIFX_BUILD_VERSION : "0.0.0";
