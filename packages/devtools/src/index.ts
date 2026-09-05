/**
 * `@ignifx/devtools` public barrel: the stats overlay, scene tree and component inspector, physics
 * debug view, and script hot reload (`docs/architecture/00-overview.md` §2).
 *
 * The package is deliberately empty; Phase 10 of `docs/plan/engineering-plan.md` populates it
 * with explicit named re-exports (coding standards §4).
 *
 * @packageDocumentation
 */

// The empty specifier is what makes a barrel with no exports a module under `isolatedModules`;
// it disappears with the first re-export.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
