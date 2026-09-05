/**
 * `@ignifx/electron` public barrel: the main-process window factory with WebGPU flags, the typed
 * preload bridge, and the file-system storage backend (`docs/architecture/00-overview.md` §2).
 *
 * The package is deliberately empty; Phase 9 of `docs/plan/engineering-plan.md` populates it
 * with explicit named re-exports (coding standards §4).
 *
 * @packageDocumentation
 */

// The empty specifier is what makes a barrel with no exports a module under `isolatedModules`;
// it disappears with the first re-export.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
