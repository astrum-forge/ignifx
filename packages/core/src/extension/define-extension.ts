import type { Extension } from "../app/types.js";

/**
 * Wraps an extension factory so that it can be called with or without options
 * (`docs/architecture/04-extensions.md` §1). Every published extension is written this way; a game's
 * own extension should be too.
 *
 * @remarks
 * The wrapper does nothing at module import time (`CONSTITUTION.md` §3.5): the factory runs when the
 * game calls `physics()`, and even then only builds the descriptor — the work happens in `register`
 * and `onStart`.
 *
 * @typeParam O - The options object the factory accepts. Defaults to `void` for an extension that
 * takes none.
 * @param factory - Builds the extension descriptor from its options.
 * @returns A factory that may be called with no argument, in which case the options are `undefined`.
 *
 * @example
 * ```ts
 * export const spawner = defineExtension<{ readonly budget?: number }>((options = {}) => ({
 *   name: "game/spawner",
 *   version: "1.0.0",
 *   requires: ["@ignifx/core"],
 *   register(ctx) {
 *     ctx.registerService(SpawnerService, new SpawnerService(options.budget ?? 32));
 *   },
 * }));
 *
 * const app = await createApp({ headless: true, extensions: [spawner({ budget: 64 })] });
 * ```
 *
 * @public
 */
export function defineExtension<O = void>(factory: (options: O) => Extension): (options?: O) => Extension {
  return (options?: O): Extension => {
    // Boundary assertion (coding standards §5.2): the invariant is the contract of this helper —
    // a factory whose options are optional must tolerate `undefined`, which is exactly what the
    // `(options = {})` default parameter in every documented example does.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return factory(options as O);
  };
}
