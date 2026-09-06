import { enableErrorDecoding } from "@babylonjs/lite";

/**
 * Babylon Lite's error-message decoder, alone in a module so that it can be **dynamically** imported
 * (`docs/architecture/07-rendering.md` §5).
 *
 * `ThrowLiteError(code, …args)` builds an `Error` whose message is `#<code>` unless a decoder has
 * been installed (`lib/lite-error.js`); `enableErrorDecoding` installs Lite's own, which is a
 * lookup table of every message Lite can produce (`lib/error-messages.js`, 43,835 bytes
 * unminified in 1.27.0).
 *
 * ## Why this file exists at all
 *
 * `enableErrorDecoding` and that table live in the same reachability set: import the function
 * statically and the table joins the entry chunk of every build, whatever `mode` says — and `mode`
 * defaults to `"development"`, so no bundler can prove the call away. Measured on
 * `examples/hello-cube`, the table was in the production entry chunk. Lite exports only its barrel
 * (`package.json#exports` has one entry), so a deep dynamic import is not available; a dynamic
 * import of the barrel would materialise its whole namespace. One ignifx module that imports the one
 * symbol, dynamically imported in turn, is what puts the table in a chunk nothing fetches until a
 * development app asks for it.
 *
 * Everything here is `@internal`, and none of it needs a device.
 */

/**
 * Installs Lite's decoder, so a Lite failure reports prose instead of `#107`.
 *
 * @remarks
 * Process-global and idempotent. Reached only through
 * `enableLiteErrorDecoding` in `./render-diagnostics.ts`, which is what performs the dynamic import.
 *
 * @internal
 */
export function installLiteErrorDecoder(): void {
  enableErrorDecoding();
}
