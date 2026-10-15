// The build replaces this with the version in `package.json` (`define` in `tsdown.config.ts`).
declare const IGNIFX_BUILD_VERSION: string | undefined;

/**
 * The `@ignifx/audio` version this build was cut from, reported as `Extension.version`
 * (`docs/architecture/04-extensions.md` §1).
 *
 * @remarks
 * The build stamps it from `package.json`; code run from source, such as this repository's tests,
 * sees `"0.0.0"`.
 *
 * @public
 */
export const VERSION: string = typeof IGNIFX_BUILD_VERSION === "string" ? IGNIFX_BUILD_VERSION : "0.0.0";
