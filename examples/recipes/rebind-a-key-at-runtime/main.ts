/**
 * Rebind a key at run time
 *
 * `performInteractiveRebind` listens for the next control the player touches and writes it onto one
 * binding as an override. It resolves with what happened — the new `path`, or `canceled`, or
 * `timedOut` — and it is the only rebind in flight at a time: a second call while one is listening
 * is `IGX-0807`, so a settings screen calls `cancelInteractiveRebind()` when the row closes.
 *
 * Overrides are addressed by **binding index**, which is why the `.input.json` beside this file
 * declares its bindings in a fixed order: reordering them invalidates saved overrides loudly
 * (`IGX-0808`) instead of quietly rebinding the wrong control. Index 0 of `jump` is the keyboard
 * binding and index 1 is the pad, so a keyboard rebind leaves the pad alone.
 *
 * `saveOverrides()` produces a small `ignifx.inputoverrides` document — not the whole action
 * document — and `app.storage` is where it belongs: it is the same asynchronous store the game's
 * settings and save slots use, scoped by `namespace`.
 *
 * A `.input.json` named in `input({ actions })` is **not** awaited: it is delivered like any other
 * asset, in a later frame. Load it yourself and call `loadActions` before `app.start()` when the
 * first frame has to have the maps, as here.
 */
import { createApp, isIgnifxError } from "@ignifx/core";
import { input } from "@ignifx/input";
import type { InputActionsAsset, InputOverridesJson } from "@ignifx/input";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}
const app = await createApp({ canvas, settings: { assets: { root: "assets" } }, extensions: [input()] });
app.input.loadActions(await app.assets.loadAsync<InputActionsAsset>("input/player.input.json"));

const store = app.storage.namespace("input");

// Saved overrides are player data from an older build: apply them, but never let them stop the game.
const saved = await store.get<InputOverridesJson>("overrides");
if (saved !== null) {
  try {
    app.input.loadOverrides(saved);
  } catch (error: unknown) {
    app.log.warn("dropping unusable rebindings:", isIgnifxError(error) ? error.code : error);
    await store.delete("overrides");
  }
}

/**
 * Listens for the next control and binds it to one binding of one action.
 *
 * @param actionName - The action to rebind, as named in the `.input.json`.
 * @param bindingIndex - Which of that action's bindings to overwrite; 0 is the keyboard one here.
 * @returns The path that was bound, or `null` when the player cancelled or the listen timed out.
 */
async function rebind(actionName: string, bindingIndex: number): Promise<string | null> {
  const action = app.input.actions.get(actionName);
  const result = await app.input.performInteractiveRebind(action, {
    bindingIndex,
    cancelPath: "<Keyboard>/escape",
    // Never let the player bind the keys the menu itself needs.
    excludePaths: ["<Keyboard>/escape", "<Keyboard>/enter", "<Pointer>/position"],
    timeoutSeconds: 5,
  });
  if (result.canceled || result.timedOut) {
    return null;
  }
  await store.set<InputOverridesJson>("overrides", app.input.saveOverrides());
  return result.path;
}

/** "Reset to defaults": drop every override, and the saved document with it. */
async function resetBindings(): Promise<void> {
  app.input.clearOverrides();
  await store.delete("overrides");
}

await app.start();

// What a settings screen's "Jump" row does. `binding.effectivePath` is what its label should show.
document.querySelector("#rebind-jump")?.addEventListener("click", () => {
  void rebind("jump", 0).then((path: string | null) => {
    app.log.info("jump is now:", path ?? app.input.actions.get("jump").bindings[0]?.effectivePath);
  });
});
document.querySelector("#reset-bindings")?.addEventListener("click", () => {
  void resetBindings();
});
