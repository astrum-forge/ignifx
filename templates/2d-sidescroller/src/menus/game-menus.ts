import { Dialog, Toast } from "@ignifx/ui";
import { MenuScreen } from "./menu-screen.js";
import { deleteSave, readSave } from "./save-store.js";
import {
  applySettings,
  defaultSettings,
  MIN_RENDER_SCALE,
  resetInputOverrides,
  saveInputOverrides,
  saveSettings,
} from "./settings-store.js";
import type { MenuRow } from "./menu-screen.js";
import type { SaveFile } from "./save-store.js";
import type { GameSettings, GraphicsHooks } from "./settings-store.js";
import type { AudioClip } from "@ignifx/audio";
import type { App } from "@ignifx/core";
import type { InputAction } from "@ignifx/input";

/**
 * The whole front end of a template: a title screen, a pause menu, a settings screen with an
 * interactive rebinding page, a confirmation dialog and a toast stack — all four templates build
 * the same thing from this file and differ only in the options they hand it.
 *
 * ## One navigation path for keyboard, gamepad and pointer
 *
 * Navigation is read from a `UI` action map that every template's `game.input.json` declares:
 * `menuMove` (a `vector2`), `menuSubmit` and `menuBack`. Keyboard and pad therefore go through the
 * _same_ code, and a pad that is not plugged in costs nothing. The pointer is handled by the DOM —
 * `pointerenter` moves the selection, `click` activates it — because a mouse already has a cursor
 * and does not need a selection model.
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
 * `MenuScreen`, `Dialog` and `Toast` are all documented no-ops with no DOM overlay, so everything
 * here runs under a headless app: the state machine is real, only the pixels are missing.
 */

/** How long the first repeat of a held direction waits, in unscaled seconds. */
const REPEAT_DELAY_SECONDS = 0.35;

/** How long each following repeat waits, in unscaled seconds. */
const REPEAT_INTERVAL_SECONDS = 0.12;

/** How far a stick or a composite must move before it counts as a direction. */
const NAVIGATION_THRESHOLD = 0.5;

/** What the music is multiplied by while a menu is open. */
const DUCK_FACTOR = 0.35;

/** How long the duck and its recovery take, in seconds. */
const DUCK_SECONDS = 0.25;

/** How long a rebind listens before giving up, in unscaled seconds. */
const REBIND_TIMEOUT_SECONDS = 6;

/** The action map every template declares for menu navigation. */
const UI_MAP_NAME = "UI";

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
  /** Whether the title screen is the one on top. */
  readonly isTitle: boolean;
  /** Whether a rebind is listening, so nothing else should read the input. */
  readonly isRebinding: boolean;
  /** Shows the title screen and hides everything else. */
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

/** The mutable state the closures below share. */
interface MenuState {
  /** The screen stack, innermost last. Empty when the game is running. */
  stack: MenuScreen[];
  /** Which direction is being held, or `0`. */
  heldX: -1 | 0 | 1;
  /** Which direction is being held, or `0`. */
  heldY: -1 | 0 | 1;
  /** How long until the held direction repeats, in unscaled seconds. */
  repeatIn: number;
  /** Whether a rebind is listening. */
  rebinding: boolean;
  /** Whether the music is currently ducked. */
  ducked: boolean;
  /** The save the title screen offers, re-read whenever the title is shown. */
  save: SaveFile | null;
}

/**
 * Turns an axis into a direction, so a stick and a keyboard composite are read the same way.
 *
 * @param value - The axis value, `-1` to `1`.
 * @returns `-1`, `0` or `1`.
 */
function direction(value: number): -1 | 0 | 1 {
  if (value >= NAVIGATION_THRESHOLD) {
    return 1;
  }
  return value <= -NAVIGATION_THRESHOLD ? -1 : 0;
}

/**
 * Renders a binding path the way a player reads it: `<Keyboard>/arrowUp` becomes `Arrow up`.
 *
 * @param path - The binding path, or an empty string for a composite.
 * @param unbound - What to show when there is no simple path.
 * @returns The label.
 */
export function describeBindingPath(path: string, unbound: string): string {
  if (path === "") {
    return unbound;
  }
  const slash = path.indexOf("/");
  const device = slash > 0 ? path.slice(1, slash - 1) : "";
  const control = slash > 0 ? path.slice(slash + 1) : path;
  const spaced = control.replaceAll("/", " ").replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>");
  const pretty = spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  return device === "" ? pretty : `${device}: ${pretty}`;
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
// oxlint-disable-next-line max-lines-per-function -- the screens share one closure over `state`,
// `settings` and the callbacks; splitting them would mean threading eight parameters through five
// builders, and every row is three lines of declaration.
export function createGameMenus(app: App, options: GameMenusOptions): GameMenus {
  const { settings, graphics } = options;
  const state: MenuState = { stack: [], heldX: 0, heldY: 0, repeatIn: 0, rebinding: false, ducked: false, save: null };
  const t = (key: string, params?: Record<string, string | number>): string => app.i18n.t(key, params ?? {});

  // Resolved once, out of the `UI` map by name. Not `actions.find("menuMove")`: a path-shaped
  // lookup with a string literal is what `ignifx/no-entity-find-in-src` forbids outside tests, and
  // resolving three actions on every frame of every menu would be wasted work besides.
  const uiMap = app.input.actions.maps.get(UI_MAP_NAME) ?? null;
  const menuMove = uiMap?.actions.get("menuMove") ?? null;
  const menuSubmit = uiMap?.actions.get("menuSubmit") ?? null;
  const menuBack = uiMap?.actions.get("menuBack") ?? null;

  const toasts = new Toast(app.ui, { layer: "overlay", duration: 2.5 });
  // The `overlay` layer, not `menu`: every `MenuScreen` panel lives in `menu`, they are appended
  // after this dialog, and a later sibling with the same z-index paints on top — so a confirm
  // prompt mounted there is drawn under the screen that opened it and swallows every click.
  const confirm = new Dialog(app.ui, {
    layer: "overlay",
    title: t("confirm.title"),
    buttons: [
      { id: "no", label: t("confirm.no") },
      { id: "yes", label: t("confirm.yes") },
    ],
  });
  let onConfirmed: (() => void) | null = null;
  confirm.onChosen.connect((id: string) => {
    confirm.hide();
    const handler = onConfirmed;
    onConfirmed = null;
    if (id === "yes" && handler !== null) {
      handler();
    }
  });

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

  /** Fades the music down while a menu is up and back when the last one closes. */
  const updateDucking = (): void => {
    const wanted = state.stack.length > 0;
    if (wanted === state.ducked) {
      return;
    }
    state.ducked = wanted;
    const target = wanted ? settings.musicVolume * DUCK_FACTOR : settings.musicVolume;
    app.audio.tryBus("Music")?.setVolume(target, DUCK_SECONDS);
  };

  const title = new MenuScreen(app, { id: "title", title: () => t("menu.title"), subtitle: () => t("menu.tagline") });
  const pause = new MenuScreen(app, { id: "pause", title: () => t("menu.paused") });
  const settingsScreen = new MenuScreen(app, { id: "settings", title: () => t("settings.title") });
  const bindings = new MenuScreen(app, {
    id: "bindings",
    title: () => t("settings.bindings"),
    subtitle: () => t("bindings.hint"),
  });
  const credits = new MenuScreen(app, { id: "credits", title: () => t("menu.credits") });

  /**
   * Pushes a screen on top of the stack.
   *
   * @param screen - The screen to show.
   */
  const push = (screen: MenuScreen): void => {
    state.stack.at(-1)?.hide();
    state.stack.push(screen);
    screen.show();
    updateDucking();
  };

  /** Pops the top screen, revealing whatever was under it. */
  const pop = (): void => {
    state.stack.pop()?.hide();
    state.stack.at(-1)?.show();
    updateDucking();
  };

  /** Closes every screen. */
  const closeAll = (): void => {
    for (let index = state.stack.length - 1; index >= 0; index -= 1) {
      state.stack[index]?.hide();
    }
    state.stack.length = 0;
    updateDucking();
  };

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
    confirm.show();
  };

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
          if (result.path === null) {
            toasts.show(t(result.timedOut ? "toast.rebindTimedOut" : "toast.rebindCanceled"));
          } else {
            await saveInputOverrides(app);
          }
          bindings.setRows(bindingRows());
        },
        (error: unknown) => {
          state.rebinding = false;
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
            id: `bind-${scheme.name}-${entry.action}-${String(index)}`,
            kind: "binding",
            label: () => t(entry.labelKey),
            value: () =>
              state.rebinding ? t("bindings.press") : describeBindingPath(binding.effectivePath, t("bindings.unbound")),
            enabled: () => !state.rebinding,
            activate: () => {
              rebind(action, bindingIndex);
            },
          });
        }
      }
      if (schemeRows.length > 0) {
        rows.push({ id: `scheme-${scheme.name}`, kind: "heading", label: () => scheme.name }, ...schemeRows);
      }
    }
    rows.push(
      {
        id: "reset-bindings",
        kind: "action",
        label: () => t("settings.resetBindings"),
        enabled: () => !state.rebinding,
        activate: () => {
          void resetInputOverrides(app).then(() => {
            bindings.setRows(bindingRows());
            toasts.show(t("toast.bindingsReset"));
          });
        },
      },
      { id: "bindings-back", kind: "action", label: () => t("menu.back"), activate: pop },
    );
    return rows;
  };

  /**
   * A slider row over one of the three bus gains.
   *
   * @param id - The row id.
   * @param labelKey - The i18n key of its label.
   * @param get - Reads the gain.
   * @param set - Writes the gain.
   * @returns The row.
   */
  const volumeRow = (id: string, labelKey: string, get: () => number, set: (value: number) => void): MenuRow => ({
    id,
    kind: "slider",
    label: () => t(labelKey),
    range: {
      min: 0,
      max: 1,
      step: 0.05,
      get,
      set: (value: number) => {
        set(value);
        commit();
      },
      format: (value: number) => `${String(Math.round(value * 100))}%`,
    },
  });

  /**
   * A yes/no row.
   *
   * @param id - The row id.
   * @param labelKey - The i18n key of its label.
   * @param get - Reads the flag.
   * @param set - Writes the flag.
   * @returns The row.
   */
  const toggleRow = (id: string, labelKey: string, get: () => boolean, set: (value: boolean) => void): MenuRow => ({
    id,
    kind: "toggle",
    label: () => t(labelKey),
    value: () => t(get() ? "common.on" : "common.off"),
    activate: () => {
      set(!get());
      commit();
    },
    adjust: () => {
      set(!get());
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
      { id: "audio", kind: "heading", label: () => t("settings.audio") },
      volumeRow(
        "master",
        "settings.master",
        () => settings.masterVolume,
        (value: number) => {
          settings.masterVolume = value;
        },
      ),
      volumeRow(
        "music",
        "settings.music",
        () => settings.musicVolume,
        (value: number) => {
          settings.musicVolume = value;
        },
      ),
      volumeRow(
        "sfx",
        "settings.sfx",
        () => settings.sfxVolume,
        (value: number) => {
          settings.sfxVolume = value;
        },
      ),
      { id: "graphics", kind: "heading", label: () => t("settings.graphics") },
      {
        id: "render-scale",
        kind: "slider",
        label: () => t("settings.renderScale"),
        range: {
          min: MIN_RENDER_SCALE,
          max: 1,
          step: 0.05,
          get: () => settings.renderScale,
          set: (value: number) => {
            settings.renderScale = value;
            commit();
          },
          format: (value: number) => `${String(Math.round(value * 100))}%`,
        },
      },
    ];
    if (graphics.supportsShadows) {
      rows.push(
        toggleRow(
          "shadows",
          "settings.shadows",
          () => settings.shadows,
          (value: boolean) => {
            settings.shadows = value;
          },
        ),
      );
    }
    if (graphics.supportsPostProcessing) {
      rows.push(
        toggleRow(
          "post-processing",
          "settings.post",
          () => settings.postProcessing,
          (value: boolean) => {
            settings.postProcessing = value;
          },
        ),
      );
    }
    rows.push(
      { id: "input", kind: "heading", label: () => t("settings.input") },
      {
        id: "bindings",
        kind: "action",
        label: () => t("settings.bindings"),
        activate: () => {
          bindings.setRows(bindingRows());
          push(bindings);
        },
      },
      { id: "game", kind: "heading", label: () => t("settings.game") },
    );
    const locales = app.i18n.availableLocales;
    if (locales.length > 1) {
      rows.push({
        id: "language",
        kind: "choice",
        label: () => t("settings.language"),
        value: () => t(`locale.${app.i18n.locale}`),
        activate: () => {
          cycleLocale(1);
        },
        adjust: (delta: -1 | 1) => {
          cycleLocale(delta);
        },
      });
    }
    rows.push(
      {
        id: "delete-save",
        kind: "action",
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
        id: "reset-settings",
        kind: "action",
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
      { id: "settings-back", kind: "action", label: () => t("menu.back"), activate: pop },
    );
    return rows;
  };

  /**
   * Moves the locale on by one, wrapping, and re-renders every screen.
   *
   * @param delta - `1` for the next locale, `-1` for the previous one.
   */
  const cycleLocale = (delta: -1 | 1): void => {
    const locales = app.i18n.availableLocales;
    const here = locales.indexOf(app.i18n.locale);
    const next = locales[(here + delta + locales.length) % locales.length];
    if (next === undefined || next === app.i18n.locale) {
      return;
    }
    app.i18n.locale = next;
    settings.locale = next;
    commit();
  };

  /**
   * The title screen's rows. `Continue` is only offered when a readable save exists.
   *
   * @returns The rows.
   */
  const titleRows = (): readonly MenuRow[] => [
    {
      id: "continue",
      kind: "action",
      label: () => t("menu.continue"),
      value: () => (state.save === null ? t("title.noSave") : t("title.savedAt", { when: shortDate(state.save) })),
      enabled: () => state.save !== null,
      activate: () => {
        const save = state.save;
        if (save === null) {
          return;
        }
        closeAll();
        options.onContinue(save);
      },
    },
    {
      id: "new-game",
      kind: "action",
      label: () => t("menu.newGame"),
      activate: () => {
        closeAll();
        options.onStartNew();
      },
    },
    {
      id: "title-settings",
      kind: "action",
      label: () => t("menu.settings"),
      activate: () => {
        settingsScreen.setRows(settingsRows());
        push(settingsScreen);
      },
    },
    {
      id: "title-credits",
      kind: "action",
      label: () => t("menu.credits"),
      activate: () => {
        push(credits);
      },
    },
  ];

  /**
   * The pause menu's rows.
   *
   * @returns The rows.
   */
  const pauseRows = (): readonly MenuRow[] => [
    { id: "resume", kind: "action", label: () => t("menu.resume"), activate: closeAll },
    {
      id: "save",
      kind: "action",
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
      id: "pause-settings",
      kind: "action",
      label: () => t("menu.settings"),
      activate: () => {
        settingsScreen.setRows(settingsRows());
        push(settingsScreen);
      },
    },
    {
      id: "quit",
      kind: "action",
      label: () => t("menu.quit"),
      activate: () => {
        ask("confirm.quit", () => {
          closeAll();
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
    closeAll();
    push(title);
    void refreshSave();
  };

  credits.setRows([
    ...options.creditKeys.map((key: string): MenuRow => ({ id: key, kind: "heading", label: () => t(key) })),
    { id: "credits-back", kind: "action", label: () => t("menu.back"), activate: pop },
  ]);
  title.setRows(titleRows());
  pause.setRows(pauseRows());
  settingsScreen.setRows(settingsRows());

  title.setCancelHandler(null);
  pause.setCancelHandler(closeAll);
  settingsScreen.setCancelHandler(pop);
  bindings.setCancelHandler(pop);
  credits.setCancelHandler(pop);

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
      return state.stack.length > 0;
    },
    get isTitle(): boolean {
      return state.stack[0]?.id === "title";
    },
    get isRebinding(): boolean {
      return state.rebinding;
    },
    show(screen: "title" | "pause"): void {
      if (screen === "title") {
        showTitle();
        return;
      }
      closeAll();
      push(pause);
    },
    close: closeAll,
    update(unscaledDelta: number): void {
      toasts.advance(unscaledDelta);
      const top = state.stack.at(-1);
      if (top === undefined || state.rebinding || confirm.isVisible) {
        state.heldX = 0;
        state.heldY = 0;
        return;
      }
      const x = direction(menuMove?.vector.x ?? 0);
      const y = direction(menuMove?.vector.y ?? 0);
      if (x !== state.heldX || y !== state.heldY) {
        state.heldX = x;
        state.heldY = y;
        state.repeatIn = REPEAT_DELAY_SECONDS;
        if (y !== 0) {
          top.moveSelection(y > 0 ? -1 : 1);
          play(options.sounds.hover);
        }
        if (x !== 0) {
          top.adjustSelection(x);
        }
      } else if (x !== 0 || y !== 0) {
        state.repeatIn -= unscaledDelta;
        if (state.repeatIn <= 0) {
          state.repeatIn = REPEAT_INTERVAL_SECONDS;
          if (y !== 0) {
            top.moveSelection(y > 0 ? -1 : 1);
            play(options.sounds.hover);
          }
          if (x !== 0) {
            top.adjustSelection(x);
          }
        }
      }
      if (menuSubmit?.wasPressedThisFrame === true) {
        play(options.sounds.click);
        top.activateSelection();
        return;
      }
      if (menuBack?.wasPressedThisFrame === true) {
        play(options.sounds.click);
        top.cancel();
      }
    },
    refresh(): void {
      for (const screen of state.stack) {
        screen.refresh();
      }
    },
    toast(text: string): void {
      toasts.show(text);
    },
    dispose(): void {
      localeChanged();
      title.dispose();
      pause.dispose();
      settingsScreen.dispose();
      bindings.dispose();
      credits.dispose();
      confirm.dispose();
      toasts.dispose();
    },
  };
}
