import { init } from "@dimforge/rapier2d-compat";

/**
 * The one place `@dimforge/rapier2d-compat`'s WebAssembly is instantiated
 * (`docs/standards/coding-standards.md` §4, `CONSTITUTION.md` §3.4). Rapier is not Babylon Lite,
 * but it is a native/WASM backend under the same adapter rule, and the rule's allowed directory is
 * `src/lite/**` — hence `src/lite/rapier/`.
 *
 * ## Why `-compat`
 *
 * The `-compat` build inlines the WebAssembly module as base64 inside `rapier.mjs`, so it needs no
 * asset serving and works unchanged in Node and in the browser (spike S6.2, ADR-0006 Validation).
 * `init()` is what decodes and instantiates it; every other Rapier call before that throws.
 *
 * The import is static: `world.ts` and `service.ts` also import Rapier's classes statically, so a
 * dynamic import here alone would not move the 2 MB module out of an app's entry chunk (measured in
 * Phase 6). Splitting it needs the adapter to read every class off the loaded module instead, which
 * is the Phase 12 bundle work.
 *
 * @internal
 */

/**
 * Instantiates Rapier's WebAssembly module.
 *
 * @remarks
 * Rapier's own `init()` is idempotent and caches the instantiated module in the package's module
 * scope, so the second and later apps in one process pay nothing.
 *
 * @returns A promise that settles once Rapier is usable.
 *
 * @internal
 */
export async function loadRapier(): Promise<void> {
  await init();
}
