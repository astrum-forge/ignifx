/**
 * Build a pause menu
 *
 * Game UI in ignifx is HTML, and `@ignifx/ui`'s `Menu` is the list widget a front end is made of: a
 * title, rows that declare what they edit, and one selection model that keyboard, gamepad and
 * pointer all drive. `MenuStack` stacks screens and makes <kbd>Esc</kbd> unwind exactly one.
 *
 * Pausing is two independent switches. `app.pause()` stops the fixed loop and the three update
 * callbacks, so the one script that must keep running declares `static updateWhenPaused = true` and
 * feeds the stack `app.time.unscaledDeltaTime` — a held direction has to keep time while the game
 * is stopped. Swapping the action maps is the other switch: disable `"Player"`, enable `"UI"`. Read
 * an action only while its map is enabled — `actions.get` searches **enabled** maps and throws
 * `IGX-0801` otherwise.
 *
 * Because the stack has a navigation source it turns the menu's own DOM key handling off; without
 * that, an arrow bound to `navigate` would move the selection twice. `onChanged` firing with `null`
 * is the single place the game comes back — the Resume row and Escape both end there.
 *
 * `menu.input.json` beside this file is what `input/menu.input.json` resolves to; its `"UI"` map
 * ships disabled.
 */
import { Script, createApp } from "@ignifx/core";
import { input } from "@ignifx/input";
import { Menu, MenuStack, ui } from "@ignifx/ui";
import type { ScriptCallbacks } from "@ignifx/core";
import type { InputActionsAsset } from "@ignifx/input";

/** Owns the pause screen. */
class PauseMenu extends Script implements ScriptCallbacks {
  static typeId = "recipes/PauseMenu";
  static updateWhenPaused = true;
  #stack: MenuStack | null = null;
  #menu: Menu | null = null;
  #sensitivity = 0.8;

  awake(): void {
    const map = this.app.input.actions.maps.get("UI") ?? null;
    const stack = new MenuStack({
      navigation: {
        move: map?.actions.get("navigate") ?? null,
        submit: map?.actions.get("submit") ?? null,
        back: map?.actions.get("back") ?? null,
      },
    });
    stack.onChanged.connect(this.#changed, { owner: this });
    this.#stack = stack;
    this.#menu = new Menu(this.app.ui, {
      id: "pause",
      title: "Paused",
      rows: [
        { kind: "action", id: "resume", label: "Resume", activate: stack.closeAll.bind(stack) },
        {
          kind: "slider",
          id: "sensitivity",
          label: "Look sensitivity",
          min: 0.1,
          max: 1,
          step: 0.05,
          get: (): number => this.#sensitivity,
          set: (value: number): void => void (this.#sensitivity = value),
        },
      ],
    });
  }

  update(): void {
    if (this.#stack?.isOpen === true) {
      this.#stack.update(this.app.time.unscaledDeltaTime);
    } else if (this.app.input.actions.get("pause").wasPressedThisFrame && this.#menu !== null) {
      this.#stack?.push(this.#menu);
    }
  }

  onDestroy(): void {
    this.#stack?.dispose();
    this.#menu?.dispose();
  }

  // Opening and closing are one switch, read off the stack: the Resume row and Escape need no code.
  readonly #changed = (top: Menu | null): void => {
    const open = top !== null;
    this.app.input.actions.map("Player").enabled = !open;
    this.app.input.actions.map("UI").enabled = open;
    if (open) {
      this.app.pause();
    } else {
      this.app.resume();
    }
  };
}

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}
const app = await createApp({ canvas, extensions: [input(), ui({ scaling: "fit" })] });
app.registerComponents([PauseMenu]);
app.input.loadActions(await app.assets.loadAsync<InputActionsAsset>("input/menu.input.json"));
app.world.createEntity("Pause Menu").addComponent(PauseMenu);
await app.start();
