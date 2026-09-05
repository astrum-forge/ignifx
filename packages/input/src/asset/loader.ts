import { INPUT_ACTIONS_ASSET_TYPE, INPUT_ACTIONS_FILE_EXTENSIONS } from "./definition.js";
import { InputActionsAsset } from "./input-actions-asset.js";
import { validateInputActions } from "./validate.js";
import type { AssetLoader, LoaderContext } from "@ignifx/core";

/**
 * The `inputactions` asset loader (`docs/architecture/05-assets-and-loading.md` §5, the
 * `inputactions` row). It fetches the document through the service's queue — so the load is
 * counted, cancellable, and retried like any other — validates its shape, and produces an
 * {@link InputActionsAsset}.
 *
 * The loader is pure with respect to the world: it never installs the maps. `app.input.loadActions`
 * does that, which is what lets one document be loaded once and installed into several
 * `PlayerInput` components.
 */

/**
 * Builds the loader for `.input.json` addresses.
 *
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createInputActionsLoader());
 * ```
 *
 * @public
 */
export function createInputActionsLoader(): AssetLoader<InputActionsAsset> {
  return {
    type: INPUT_ACTIONS_ASSET_TYPE,
    extensions: INPUT_ACTIONS_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<InputActionsAsset> {
      const raw: unknown = await ctx.fetchJson();
      return new InputActionsAsset(ctx.address, validateInputActions(raw, ctx.address));
    },
  };
}
