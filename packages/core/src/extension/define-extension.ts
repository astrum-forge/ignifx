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
 * @param factory - Builds the extension descriptor from its options, which are `undefined` when the
 * game called the factory without an argument — default them (`(options = {})`) or read them as optional.
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
export function defineExtension<O = void>(factory: (options: O | undefined) => Extension): (options?: O) => Extension {
  return (options?: O): Extension => factory(options);
}
