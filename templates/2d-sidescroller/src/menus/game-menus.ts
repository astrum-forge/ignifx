import { Dialog, Menu, MenuStack, Toast } from "@ignifx/ui";
import { deleteSave, readSave } from "./save-store.js";
import {
  applySettings,
  defaultSettings,
  MIN_RENDER_SCALE,
  resetInputOverrides,
  saveInputOverrides,
  saveSettings,
} from "./settings-store.js";
import type { SaveFile } from "./save-store.js";
import type { GameSettings, GraphicsHooks } from "./settings-store.js";
import type { AudioClip } from "@ignifx/audio";
import type { App } from "@ignifx/core";
import type { InputAction } from "@ignifx/input";
import type { MenuRow } from "@ignifx/ui";

/**
 * The whole front end of a template — a title screen, a pause menu, a settings screen with an
 * interactive rebinding page, a confirmation dialog and a toast stack — built out of `@ignifx/ui`'s
 * `Menu` and `MenuStack`. All four templates build the same thing from this file and differ only in
 * the options they hand it.
 *
 * ## What the package owns and what this file owns
 *
 * `Menu` owns the rows, the selection, the ARIA and the three input paths; `MenuStack` owns screen
 * navigation, the held-direction repeat on the unscaled clock, and the rule that Escape unwinds one
 * screen. What is left here is the part that is actually about *this game*: which rows exist, what
 * they read and write, and what happens when one is chosen.
 *
 * ## One navigation path for keyboard, gamepad and pointer
 *
 * Navigation is read from a `UI` action map that every template's `game.input.json` declares:
 * `menuMove` (a `vector2`), `menuSubmit` and `menuBack`, handed to the stack as a
 * `MenuNavigation`. Keyboard and pad therefore go through the _same_ code, and a pad that is not
 * plugged in costs nothing. Because the stack has a navigation source it turns each menu's own DOM
 * key handling off, so an arrow press moves the selection once rather than twice.
 *
 * The `pause` action is deliberately **not** read here. `MenuController` reads it, and only while
 * no menu is open; otherwise a single press of Escape would both close the screen (`menuBack`) and
 * toggle the pause menu (`pause`) in the same frame, because `@ignifx/input` holds an edge flag for
 * the whole frame and both actions are bound to the same key.
 *
 * ## Ducking, not pausing, the music
 *
 * `app.pause()` pauses every bus whose `pausable` is true. The templates' `game.audio.json` marks
 * `Music` and `UI` as not pausable for that reason: the pad keeps playing under the menu at a
 * lower gain (`bus.setVolume(target, ramp)`, which is Lite's own gain ramp rather than a tween of
 * ours), and the menu's clicks stay audible while the game is stopped.
 *
 * ## Headless
 *
 * `Menu`, `MenuStack`, `Dialog` and `Toast` are all documented no-ops with no DOM overlay, so
 * everything here runs under a headless app: the state machine is real, only the pixels are missing.
 */

/** What the music is multiplied by while a menu is open. */
const DUCK_FACTOR = 0.35;

/** How long the duck and its recovery take, in seconds. */
const DUCK_SECONDS = 0.25;

/** How long a rebind listens before giving up, in unscaled seconds. */
const REBIND_TIMEOUT_SECONDS = 6;

/** The action map every template declares for menu navigation. */
const UI_MAP_NAME = "UI";

/** The settings a slider row can edit. */
type NumericSetting = "masterVolume" | "musicVolume" | "renderScale" | "sfxVolume";

/** The settings a toggle row can edit. */
type FlagSetting = "postProcessing" | "shadows";

/** The clips the menus play, or `null` where a template did not load one. */
export interface MenuSounds {
  /** Played when a row is activated. */
  readonly click: AudioClip | null;
  /** Played when the selection moves. */
  readonly hover: AudioClip | null;
}

/** What one rebindable action is called and where its per-scheme bindings live. */
export interface RebindableAction {
  /** The action's name inside {@link GameMenusOptions.gameplayMap}. */
  readonly action: string;
  /** The `menu.*` i18n key for its label. */
  readonly labelKey: string;
}

/** How {@link createGameMenus} builds the front end. */
export interface GameMenusOptions {
  /** The settings the screens edit. Mutated in place, then persisted. */
  readonly settings: GameSettings;
  /** How the graphics rows reach this template's scene. */
  readonly graphics: GraphicsHooks;
  /** The action map the rebindable actions live in, normally `"Player"`. */
  readonly gameplayMap: string;
  /** The actions the rebinding page lists, in the order it lists them. */
  readonly rebindable: readonly RebindableAction[];
  /** The `credits.*` i18n keys, in the order they are shown. */
  readonly creditKeys: readonly string[];
  /** The UI clips. */
  readonly sounds: MenuSounds;
  /** Starts a fresh run. The template resets its world and resumes the clock. */
  readonly onStartNew: () => void;
  /** Continues a stored run. The template restores its world and resumes the clock. */
  readonly onContinue: (save: SaveFile) => void;
  /** Writes a save now, and answers whether one was written. */
  readonly onSaveNow: () => Promise<boolean>;
  /** Ends the run and returns to the title. The template resets its world and stays paused. */
  readonly onQuitToTitle: () => void;
}

/** The front end, as the rest of the game sees it. */
export interface GameMenus {
  /** Whether any screen is on top. */
  readonly isOpen: boolean;
  /** Whether the title screen is the one at the bottom of the stack. */
  readonly isTitle: boolean;
  /** Whether a rebind is listening, so nothing else should read the input. */
  readonly isRebinding: boolean;
  /** Shows the title screen or the pause menu, and hides everything else. */
  show: (screen: "title" | "pause") => void;
  /** Closes every screen. */
  close: () => void;
  /** Advances navigation repeat and the toast timers. Called from `MenuController.update`. */
  update: (unscaledDelta: number) => void;
  /** Re-reads every label; connected to `app.i18n.onLocaleChanged`. */
  refresh: () => void;
  /** Shows a transient message. */
  toast: (text: string) => void;
  /** Removes every element this built. */
  dispose: () => void;
}

/**
 * Renders a 0-to-1 gain or scale as a percentage.
 *
 * @param value - The value.
 * @returns The text drawn beside the slider.
 */
function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

/**
 * Renders a save's timestamp short enough for a menu row.
 *
 * @param save - The save whose `savedAt` is shown.
 * @returns The rendered date, or the raw instant when the host cannot format it.
 */
function shortDate(save: SaveFile): string {
  const when = new Date(save.savedAt);
  return Number.isNaN(when.getTime()) ? save.savedAt : when.toLocaleString();
}

/**
 * Builds the title screen, the pause menu, the settings screen and the rebinding page.
 *
 * @param app - The running app.
 * @param options - The settings to edit, the hooks into the template's scene, and the callbacks.
 * @returns The front end.
 */
// oxlint-disable-next-line max-lines-per-function -- the screens share one closure over the
// settings, the stack and the callbacks; splitting them would mean threading eight parameters
// through five builders, and every row is now a single declaration.
export function createGameMenus(app: App, options: GameMenusOptions): GameMenus {
  const { settings, graphics } = options;
  const state = { rebinding: false, ducked: false, save: null as SaveFile | null };
  const t = (key: string, params?: Record<string, string | number>): string => app.i18n.t(key, params ?? {});

  // Resolved once, out of the `UI` map by name. Not `actions.find("menuMove")`: a path-shaped
  // lookup with a string literal is what `ignifx/no-entity-find-in-src` forbids outside tests, and
  // resolving three actions on every frame of every menu would be wasted work besides.
  const uiMap = app.input.actions.maps.get(UI_MAP_NAME) ?? null;
  const stack = new MenuStack({
    navigation: {
      move: uiMap?.actions.get("menuMove") ?? null,
      submit: uiMap?.actions.get("menuSubmit") ?? null,
      back: uiMap?.actions.get("menuBack") ?? null,
    },
  });

  const toasts = new Toast(app.ui, { layer: "overlay", duration: 2.5 });
  // The same `menu` layer as the screens: `Dialog` carries `UI_DIALOG_Z_INDEX`, so a modal is drawn
  // above every other root of its layer whatever order they were built in.
  const confirm = new Dialog(app.ui, { title: t("confirm.title") });
  let onConfirmed: (() => void) | null = null;

  /**
   * Plays one of the two UI clips, on the `UI` bus so it survives `app.pause()`.
   *
   * @param clip - The clip, or `null` when the template did not load one.
   */
  const play = (clip: AudioClip | null): void => {
    if (clip !== null) {
      app.audio.playOneShot(clip, { bus: "UI", volume: 0.7 });
    }
  };

  /** Persists the settings and applies them, after any row changed one. */
  const commit = (): void => {
    applySettings(app, settings, graphics);
    void saveSettings(app, settings);
  };

  /**
   * Builds one screen with the words and the sounds every screen in this game shares.
   *
   * @param id - The screen id, which becomes its `data-menu` attribute.
   * @param title - Its heading.
   * @param subtitle - The line under the heading, when it has one.
   * @returns The screen.
   */
  const screen = (id: string, title: () => string, subtitle?: () => string): Menu => {
    const menu = new Menu(app.ui, {
      id,
      title,
      ...(subtitle === undefined ? {} : { subtitle }),
      text: {
        on: () => t("common.on"),
        off: () => t("common.off"),
        unbound: () => t("bindings.unbound"),
        listening: () => t("bindings.press"),
      },
    });
    // Backing out is a click too; the stack's own signals cover moving and activating.
    menu.onBack.connect(() => {
      play(options.sounds.click);
    });
    return menu;
  };

  const title = screen(
    "title",
    () => t("menu.title"),
    () => t("menu.tagline"),
  );
  const pause = screen("pause", () => t("menu.paused"));
  const settingsScreen = screen("settings", () => t("settings.title"));
  const bindings = screen(
    "bindings",
    () => t("settings.bindings"),
    () => t("bindings.hint"),
  );
  const credits = screen("credits", () => t("menu.credits"));
  // The title screen is the game's floor: Escape must not unwind past it into a running game.
  title.cancelable = false;

  stack.onSelectionChanged.connect(() => {
    play(options.sounds.hover);
  });
  stack.onActivated.connect(() => {
    play(options.sounds.click);
  });
  stack.onChanged.connect(() => {
    const wanted = stack.isOpen;
    if (wanted !== state.ducked) {
      state.ducked = wanted;
      app.audio
        .tryBus("Music")
        ?.setVolume(wanted ? settings.musicVolume * DUCK_FACTOR : settings.musicVolume, DUCK_SECONDS);
    }
  });

  /**
   * Asks for confirmation before running something destructive.
   *
   * @param messageKey - The `confirm.*` key of the question.
   * @param handler - What to run when the player says yes.
   */
  const ask = (messageKey: string, handler: () => void): void => {
    onConfirmed = handler;
    confirm.setTitle(t("confirm.title"));
    confirm.setMessage(t(messageKey));
    confirm.setButtons([
      { id: "no", label: t("confirm.no") },
      { id: "yes", label: t("confirm.yes") },
    ]);
    confirm.show();
    // The dialog is modal: the same press must not reach the screen underneath it.
    stack.suspended = true;
  };

  confirm.onChosen.connect((id: string) => {
    confirm.hide();
    stack.suspended = false;
    const handler = onConfirmed;
    onConfirmed = null;
    if (id === "yes" && handler !== null) {
      handler();
    }
  });

  /**
   * The action the rebinding page is editing, looked up in the gameplay map so it is found even
   * while that map is disabled.
   *
   * @param name - The action name.
   * @returns The action, or `null` when the map does not declare it.
   */
  const gameplayAction = (name: string): InputAction | null => {
    const map = app.input.actions.maps.get(options.gameplayMap);
    return map?.actions.get(name) ?? null;
  };

  /**
   * Rebinds one binding of one action, then persists the override set.
   *
   * @param action - The action being rebound.
   * @param bindingIndex - Which of its bindings to overwrite.
   */
  const rebind = (action: InputAction, bindingIndex: number): void => {
    if (state.rebinding) {
      return;
    }
    state.rebinding = true;
    stack.suspended = true;
    bindings.refresh();
    void app.input
      .performInteractiveRebind(action, {
        bindingIndex,
        cancelPath: "<Keyboard>/escape",
        timeoutSeconds: REBIND_TIMEOUT_SECONDS,
        excludePaths: ["<Keyboard>/escape", "<Keyboard>/enter"],
      })
      .then(
        async (result) => {
          state.rebinding = false;
          stack.suspended = false;
          if (result.path === null) {
            toasts.show(t(result.timedOut ? "toast.rebindTimedOut" : "toast.rebindCanceled"));
          } else {
            await saveInputOverrides(app);
          }
          bindings.setRows(bindingRows());
        },
        (error: unknown) => {
          state.rebinding = false;
          stack.suspended = false;
          app.log.warn("IGX-TPL-0021 the rebind failed: {error}", String(error));
          bindings.setRows(bindingRows());
        },
      );
  };

  /**
   * The rebinding page's rows: one heading per control scheme, then one row per action that the
   * scheme actually binds.
   *
   * @returns The rows.
   */
  const bindingRows = (): readonly MenuRow[] => {
    const rows: MenuRow[] = [];
    for (const scheme of app.input.controlSchemes) {
      const schemeRows: MenuRow[] = [];
      for (const entry of options.rebindable) {
        const action = gameplayAction(entry.action);
        if (action === null) {
          continue;
        }
        for (let index = 0; index < action.bindings.length; index += 1) {
          const binding = action.bindings[index];
          // A composite binding has no single path to overwrite; `@ignifx/input` says so, and the
          // rebinding page therefore offers only the simple bindings.
          if (binding === undefined || binding.scheme !== scheme.name || binding.composite !== null) {
            continue;
          }
          const bindingIndex = index;
          schemeRows.push({
            kind: "binding",
            id: `bind-${scheme.name}-${entry.action}-${String(index)}`,
            label: () => t(entry.labelKey),
            path: () => binding.effectivePath,
            listening: () => state.rebinding,
            enabled: () => !state.rebinding,
            rebind: () => {
              rebind(action, bindingIndex);
            },
          });
        }
      }
      if (schemeRows.length > 0) {
        rows.push({ kind: "heading", id: `scheme-${scheme.name}`, label: () => scheme.name }, ...schemeRows);
      }
    }
    rows.push(
      { kind: "separator", id: "bindings-rule" },
      {
        kind: "action",
        id: "reset-bindings",
        label: () => t("settings.resetBindings"),
        enabled: () => !state.rebinding,
        activate: () => {
          void resetInputOverrides(app).then(() => {
            bindings.setRows(bindingRows());
            toasts.show(t("toast.bindingsReset"));
          });
        },
      },
      { kind: "action", id: "bindings-back", label: () => t("menu.back"), activate: () => void stack.pop() },
    );
    return rows;
  };

  /**
   * A slider row over one of the numeric settings, as a percentage.
   *
   * @param id - The row id.
   * @param labelKey - The i18n key of its label.
   * @param key - Which setting the row edits.
   * @param min - The lowest value it may take.
   * @returns The row.
   */
  const sliderRow = (id: string, labelKey: string, key: NumericSetting, min = 0): MenuRow => ({
    kind: "slider",
    id,
    label: () => t(labelKey),
    min,
    max: 1,
    step: 0.05,
    get: () => settings[key],
    set: (value: number) => {
      settings[key] = value;
      commit();
    },
    format: percent,
  });

  /**
   * A yes/no row over one of the graphics flags. `Menu`'s `text.on` / `text.off` render it.
   *
   * @param id - The row id.
   * @param labelKey - The i18n key of its label.
   * @param key - Which setting the row edits.
   * @returns The row.
   */
  const toggleRow = (id: string, labelKey: string, key: FlagSetting): MenuRow => ({
    kind: "toggle",
    id,
    label: () => t(labelKey),
    get: () => settings[key],
    set: (value: boolean) => {
      settings[key] = value;
      commit();
    },
  });

  /**
   * The settings screen's rows. Rebuilt whenever a save appears or disappears, because the
   * "Delete save" row's enabled state is read from it.
   *
   * @returns The rows.
   */
  const settingsRows = (): readonly MenuRow[] => {
    const rows: MenuRow[] = [
      { kind: "heading", id: "audio", label: () => t("settings.audio") },
      sliderRow("master", "settings.master", "masterVolume"),
      sliderRow("music", "settings.music", "musicVolume"),
      sliderRow("sfx", "settings.sfx", "sfxVolume"),
      { kind: "heading", id: "graphics", label: () => t("settings.graphics") },
      sliderRow("render-scale", "settings.renderScale", "renderScale", MIN_RENDER_SCALE),
    ];
    if (graphics.supportsShadows) {
      rows.push(toggleRow("shadows", "settings.shadows", "shadows"));
    }
    if (graphics.supportsPostProcessing) {
      rows.push(toggleRow("post-processing", "settings.post", "postProcessing"));
    }
    rows.push(
      { kind: "heading", id: "input", label: () => t("settings.input") },
      {
        kind: "action",
        id: "bindings",
        label: () => t("settings.bindings"),
        activate: () => {
          bindings.setRows(bindingRows());
          stack.push(bindings);
        },
      },
      { kind: "heading", id: "game", label: () => t("settings.game") },
    );
    if (app.i18n.availableLocales.length > 1) {
      rows.push({
        kind: "choice",
        id: "language",
        label: () => t("settings.language"),
        values: () => app.i18n.availableLocales,
        get: () => app.i18n.locale,
        set: (locale: string) => {
          app.i18n.locale = locale;
          settings.locale = locale;
          commit();
        },
        format: (locale: string) => t(`locale.${locale}`),
      });
    }
    rows.push(
      {
        kind: "action",
        id: "delete-save",
        label: () => t("settings.deleteSave"),
        enabled: () => state.save !== null,
        activate: () => {
          ask("confirm.deleteSave", () => {
            void deleteSave(app).then(() => {
              state.save = null;
              settingsScreen.setRows(settingsRows());
              title.setRows(titleRows());
              toasts.show(t("toast.saveDeleted"));
            });
          });
        },
      },
      {
        kind: "action",
        id: "reset-settings",
        label: () => t("settings.reset"),
        activate: () => {
          ask("confirm.reset", () => {
            const fresh = defaultSettings(app.i18n.locale);
            settings.masterVolume = fresh.masterVolume;
            settings.musicVolume = fresh.musicVolume;
            settings.sfxVolume = fresh.sfxVolume;
            settings.renderScale = fresh.renderScale;
            settings.shadows = fresh.shadows;
            settings.postProcessing = fresh.postProcessing;
            commit();
            void resetInputOverrides(app);
            settingsScreen.refresh();
            toasts.show(t("toast.settingsReset"));
          });
        },
      },
      { kind: "action", id: "settings-back", label: () => t("menu.back"), activate: () => void stack.pop() },
    );
    return rows;
  };

  /**
   * The title screen's rows. `Continue` is only offered when a readable save exists.
   *
   * @returns The rows.
   */
  const titleRows = (): readonly MenuRow[] => [
    {
      kind: "action",
      id: "continue",
      label: () => t("menu.continue"),
      value: () => (state.save === null ? t("title.noSave") : t("title.savedAt", { when: shortDate(state.save) })),
      enabled: () => state.save !== null,
      activate: () => {
        const save = state.save;
        if (save === null) {
          return;
        }
        stack.closeAll();
        options.onContinue(save);
      },
    },
    {
      kind: "action",
      id: "new-game",
      label: () => t("menu.newGame"),
      activate: () => {
        stack.closeAll();
        options.onStartNew();
      },
    },
    {
      kind: "action",
      id: "title-settings",
      label: () => t("menu.settings"),
      activate: () => {
        settingsScreen.setRows(settingsRows());
        stack.push(settingsScreen);
      },
    },
    {
      kind: "action",
      id: "title-credits",
      label: () => t("menu.credits"),
      activate: () => {
        stack.push(credits);
      },
    },
  ];

  /**
   * The pause menu's rows.
   *
   * @returns The rows.
   */
  const pauseRows = (): readonly MenuRow[] => [
    {
      kind: "action",
      id: "resume",
      label: () => t("menu.resume"),
      activate: () => {
        stack.closeAll();
      },
    },
    {
      kind: "action",
      id: "save",
      label: () => t("menu.save"),
      activate: () => {
        void options.onSaveNow().then((written: boolean) => {
          if (written) {
            void refreshSave();
            toasts.show(t("toast.saved"));
          }
        });
      },
    },
    {
      kind: "action",
      id: "pause-settings",
      label: () => t("menu.settings"),
      activate: () => {
        settingsScreen.setRows(settingsRows());
        stack.push(settingsScreen);
      },
    },
    {
      kind: "action",
      id: "quit",
      label: () => t("menu.quit"),
      activate: () => {
        ask("confirm.quit", () => {
          stack.closeAll();
          options.onQuitToTitle();
          showTitle();
        });
      },
    },
  ];

  /**
   * Re-reads the save and rebuilds the two screens that mention it.
   *
   * @returns A promise that settles once the rows have been rebuilt.
   */
  const refreshSave = async (): Promise<void> => {
    state.save = await readSave(app);
    title.setRows(titleRows());
    settingsScreen.setRows(settingsRows());
  };

  /**
   * Shows the title screen.
   *
   * @remarks
   * Synchronous on purpose. `MenuController` reconciles `app.pause()` against `isOpen` every frame,
   * so a title screen that appeared one storage round-trip later would let the game run — and the
   * character fall — for those frames. The screen goes up now and the save is re-read behind it;
   * `Continue` switches from disabled to enabled when the read settles.
   */
  const showTitle = (): void => {
    stack.closeAll();
    stack.push(title);
    void refreshSave();
  };

  credits.setRows([
    ...options.creditKeys.map((key: string): MenuRow => ({ kind: "heading", id: key, label: () => t(key) })),
    { kind: "action", id: "credits-back", label: () => t("menu.back"), activate: () => void stack.pop() },
  ]);
  title.setRows(titleRows());
  pause.setRows(pauseRows());
  settingsScreen.setRows(settingsRows());

  const localeChanged = app.i18n.onLocaleChanged.connect(() => {
    title.setRows(titleRows());
    pause.setRows(pauseRows());
    settingsScreen.setRows(settingsRows());
    if (bindings.isVisible) {
      bindings.setRows(bindingRows());
    }
    credits.refresh();
    confirm.setTitle(t("confirm.title"));
  });

  return {
    get isOpen(): boolean {
      return stack.isOpen;
    },
    get isTitle(): boolean {
      return stack.bottom?.id === "title";
    },
    get isRebinding(): boolean {
      return state.rebinding;
    },
    show(which: "title" | "pause"): void {
      if (which === "title") {
        showTitle();
        return;
      }
      stack.closeAll();
      stack.push(pause);
    },
    close(): void {
      stack.closeAll();
    },
    update(unscaledDelta: number): void {
      toasts.advance(unscaledDelta);
      stack.update(unscaledDelta);
    },
    refresh(): void {
      stack.refresh();
    },
    toast(text: string): void {
      toasts.show(text);
    },
    dispose(): void {
      localeChanged();
      stack.dispose();
      for (const menu of [title, pause, settingsScreen, bindings, credits]) {
        menu.dispose();
      }
      confirm.dispose();
      toasts.dispose();
    },
  };
}
