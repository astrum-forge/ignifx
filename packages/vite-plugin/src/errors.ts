/**
 * Error codes owned by `@ignifx/vite-plugin` and the error type it throws.
 *
 * @remarks
 * The plugin runs at build time, before an `App` exists, and `docs/architecture/00-overview.md` §2
 * gives this package no dependency on `@ignifx/core`, so it cannot throw core's `IgnifxError`.
 * The codes still come from the registered ranges of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1 — `05xx` assets, `06xx` serialization — and
 * are allocated from the top of each range (`IGX-0550+`, `IGX-0650+`) so that the runtime codes
 * `@ignifx/core` allocates from the bottom can never collide with them.
 */

/**
 * The diagnostic codes this package can report, in the `05xx` (assets) and `06xx` (serialization)
 * ranges reserved by `docs/architecture/15-devtools-and-diagnostics.md` §1.
 *
 * @public
 */
export const VitePluginErrorCode = {
  /** The configured asset root does not exist or is not a directory. */
  assetRootMissing: "IGX-0550",
  /** A `.meta.json` sidecar could not be parsed, or its `groups` field is not an array of strings. */
  invalidSidecar: "IGX-0551",
  /** Two assets hash to the same output file name, so one would overwrite the other. */
  duplicateOutputFile: "IGX-0552",
  /** An `ignifx.assets.public` entry of an extension package could not be read. */
  extensionAssetMissing: "IGX-0553",
  /** `ignifx.config.ts` could not be loaded, or its default export is not an object. */
  invalidProjectConfig: "IGX-0554",
  /** A plugin option is outside its documented domain. */
  invalidOption: "IGX-0555",
  /** A JSON asset under the asset root is not parseable JSON. */
  malformedJson: "IGX-0650",
  /** A format-headed JSON file is missing its `format`/`formatVersion` header or the header is malformed. */
  missingFormatHeader: "IGX-0651",
  /** A format-headed JSON file failed validation against the JSON Schema supplied for its format. */
  schemaViolation: "IGX-0652",
  /** A supplied JSON Schema uses a keyword or `$ref` target this validator does not implement. */
  unsupportedSchema: "IGX-0653",
} as const;

/**
 * The union of the diagnostic codes this package can report.
 *
 * @public
 */
export type VitePluginErrorCode = (typeof VitePluginErrorCode)[keyof typeof VitePluginErrorCode];

/**
 * The error every `@ignifx/vite-plugin` API throws for a failure it can describe
 * (`CONSTITUTION.md` §3.9). It always carries a stable `IGX-####` code so that a build log stays
 * machine-readable even when the message is truncated.
 *
 * @example
 * ```ts
 * try {
 *   await scanAssets({ assetRoot: "assets", hashLength: 8 });
 * } catch (error) {
 *   if (error instanceof VitePluginError && error.code === VitePluginErrorCode.assetRootMissing) {
 *     // create the directory, or point `assetRoot` somewhere else
 *   }
 * }
 * ```
 *
 * @public
 */
export class VitePluginError extends Error {
  /** The stable diagnostic code for this failure. */
  readonly code: VitePluginErrorCode;

  /**
   * Creates a plugin error.
   *
   * @param code - The stable `IGX-####` code for the failure.
   * @param message - An actionable description of what went wrong and how to fix it.
   * @param options - Standard `Error` options; use `cause` to keep the original failure.
   */
  constructor(code: VitePluginErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VitePluginError";
    this.code = code;
  }
}
