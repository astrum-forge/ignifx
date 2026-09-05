/**
 * `@ignifx/electron/main` public barrel: the Electron main-process surface — the game window
 * factory that turns WebGPU on, the `ignifx://` protocol that serves packaged assets, and the
 * window-event forwarders (`docs/architecture/14-platform-electron.md` §3).
 *
 * The entry is deliberately empty; Phase 9 of `docs/plan/engineering-plan.md` populates it. It
 * touches no Electron or Node API yet, which is why the package still type-checks against the
 * browser `types` list (coding standards §3).
 *
 * @packageDocumentation
 */

// The empty specifier is what makes a barrel with no exports a module under `isolatedModules`;
// it disappears with the first re-export.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
