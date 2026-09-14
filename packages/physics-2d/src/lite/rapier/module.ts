import { init } from "@dimforge/rapier2d-compat";

/**
 * Initialise Rapier's embedded WebAssembly before making backend calls.
 * The compat build includes the binary, so both Node and browser apps need no separate asset.
 * Rapier classes are imported statically by the adapters; delaying `init` does not split that bundle.
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
