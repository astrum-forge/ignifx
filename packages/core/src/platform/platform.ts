/**
 * The minimal platform probe reached as `app.platform`
 * (`docs/architecture/14-platform-electron.md` §1). Phase 1 answers only the question the kernel
 * itself asks — is there a document to hang `visibilitychange` on? — and the rest of §1's surface
 * (`os`, `isMobile`, `hasPointerLock`, `hasGamepads`, `webgpu`, `locale`, `reducedMotion`) arrives
 * with `@ignifx/electron` in Phase 9 of `docs/plan/engineering-plan.md`.
 */

/**
 * Where an app is running.
 *
 * @remarks
 * `"electron"` is deliberately absent until the Electron extension can detect it reliably: an
 * Electron renderer is a browser as far as the kernel is concerned, and guessing from the user
 * agent would be worse than saying `"browser"`.
 *
 * @public
 */
export type PlatformKind = "browser" | "node";

/**
 * What the kernel knows about the host.
 *
 * @example
 * ```ts
 * if (app.platform.kind === "browser") {
 *   document.title = "playing";
 * }
 * ```
 *
 * @public
 */
export interface PlatformInfo {
  /** Whether the app runs in a document or in a bare JavaScript runtime. */
  readonly kind: PlatformKind;
}

/**
 * Probes the host.
 *
 * @returns `{ kind: "browser" }` when a `document` is reachable, `{ kind: "node" }` otherwise.
 *
 * @internal
 */
export function detectPlatform(): PlatformInfo {
  const isBrowser = globalThis.document !== undefined && globalThis.window !== undefined;
  return Object.freeze({ kind: isBrowser ? "browser" : "node" });
}
