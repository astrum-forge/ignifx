import { Camera, formatBindingPath, isIgnifxError, validateInputActions } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { button, readout } from "../_kit/panel.ts";
import { createGridGround, createLightRig } from "../_kit/stage.ts";
import actionsSource from "./player.input.json?raw";
import { attachRack } from "./rack.ts";
import type { BindingRack } from "./rack.ts";
import type { PanelControl } from "../_kit/panel.ts";
import type { App, InputOverridesJson } from "ignifx";

/**
 * Rebind the keyboard slot at index 0, leaving the gamepad binding unchanged.
 * Only one interactive rebind can listen at a time (`IGX-0807`). Save overrides through app storage
 * and catch incompatible saved documents (`IGX-0808`) so an old binding layout cannot stop the game.
 */

/** The actions this example rebinds, left to right on the rack. */
const ACTIONS = ["left", "right", "hop", "brake"] as const;

/** Which binding of each action a rebind overwrites: index 0 is the keyboard one. */
const KEYBOARD_BINDING = 0;

/** How long a rebind listens before giving up, in unscaled seconds. */
const LISTEN_SECONDS = 5;

/** Where the saved overrides live: `app.storage`, under this namespace and key. */
const STORE = { namespace: "rebinding", key: "overrides" } as const;

/** Where the camera sits and what it looks at, in metres. */
const SHOT = { eye: { x: 0, y: 2.6, z: -4.3 }, focus: { x: 0, y: 0.52, z: 0.25 }, fov: 42 } as const;

/** The floor, in metres: big enough that its far edge is out of frame behind the rack. */
const FLOOR_SIZE = 60;

/**
 * Reads one action's keyboard binding the way a settings row shows it.
 *
 * @param app - The running app.
 * @param name - The action name.
 * @returns `Keyboard: W`, or `—` when the binding is unbound.
 */
function bindingLabel(app: App, name: string): string {
  const path = app.input.actions.find(name)?.bindings[KEYBOARD_BINDING]?.effectivePath ?? "";
  return formatBindingPath(path, "—");
}

bootExample({
  title: "Rebinding",
  settings: {
    rendering: {
      clearColor: { r: 0.035, g: 0.043, b: 0.059, a: 1 },
      msaaSamples: 4,
      // Read once, when `app.start()` registers the scene; asking afterwards is `IGX-0704`.
      features: { shadows: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    // `JSON.parse` answers `any`, so the document is `unknown` at the boundary and
    // `validateInputActions` — the same check the asset loader runs — is what narrows it.
    const parsed: unknown = JSON.parse(actionsSource);
    app.input.loadActions(validateInputActions(parsed, "player.input.json"));

    const store = app.storage.namespace(STORE.namespace);
    const saved = await store.get<InputOverridesJson>(STORE.key);
    if (saved !== null) {
      try {
        app.input.loadOverrides(saved);
      } catch (error: unknown) {
        // Player data from an older build: drop it, say so, and carry on with the defaults.
        app.log.warn("dropping unusable rebindings:", isIgnifxError(error) ? error.code : error);
        await store.delete(STORE.key);
      }
    }

    const eye = app.world.createEntity("Main Camera");
    eye.transform.localPosition.set(SHOT.eye.x, SHOT.eye.y, SHOT.eye.z);
    eye.transform.lookAt(SHOT.focus);
    eye.addComponent(Camera, { near: 0.05, far: 120, fov: SHOT.fov });

    // Awaited before `app.start()`: a load that completes before the loop runs settles at once,
    // and a material binds its textures once — an unawaited grid is an untextured floor.
    await createGridGround(app, { size: FLOOR_SIZE, color: { r: 0.17, g: 0.19, b: 0.24, a: 1 } });
    createLightRig(app, { focus: { x: 0, y: 0.4, z: 0 }, keyIntensity: 2.4, rimIntensity: 0.9, shadowDarkness: 0.4 });

    const rack: BindingRack = attachRack(app, ACTIONS);
    let listening = "";
    let lastResult = "—";

    /**
     * Listens for the next control and binds it to one action's keyboard binding.
     *
     * @param name - The action to rebind.
     */
    const rebind = async (name: string): Promise<void> => {
      // One rebind at a time: a second call while one is listening is `IGX-0807`, so a settings
      // screen guards rather than catches.
      if (listening !== "") {
        return;
      }
      listening = name;
      lastResult = "press a control…";
      rack.setListening(name);
      try {
        const result = await app.input.performInteractiveRebind(app.input.actions.get(name), {
          bindingIndex: KEYBOARD_BINDING,
          cancelPath: "<Keyboard>/escape",
          // Never let the player bind the keys the panel itself needs.
          excludePaths: ["<Keyboard>/escape", "<Keyboard>/enter", "<Keyboard>/tab"],
          timeoutSeconds: LISTEN_SECONDS,
        });
        if (result.canceled) {
          lastResult = `${name}: cancelled`;
        } else if (result.timedOut) {
          lastResult = `${name}: timed out`;
        } else {
          lastResult = `${name}: ${formatBindingPath(result.path ?? "", "—")}`;
          await store.set<InputOverridesJson>(STORE.key, app.input.saveOverrides());
        }
      } finally {
        listening = "";
        rack.setListening("");
        rack.refreshBindings();
      }
    };

    /** "Reset to defaults": drop every override, and the saved document with it. */
    const reset = async (): Promise<void> => {
      app.input.clearOverrides();
      await store.delete(STORE.key);
      rack.refreshBindings();
      lastResult = "reset to defaults";
    };

    const rows: PanelControl[] = ACTIONS.flatMap((name: string): readonly PanelControl[] => [
      readout(name, (): string => bindingLabel(app, name)),
      button(`Rebind ${name}`, (): void => {
        void rebind(name);
      }),
    ]);

    panel({
      title: "Rebinding",
      groups: [
        { label: "Bindings", controls: rows },
        {
          label: "Overrides",
          controls: [
            readout("Last rebind", (): string => lastResult),
            readout("Listening", (): string => (listening === "" ? "no" : listening)),
            button("Reset to defaults", (): void => {
              void reset();
            }),
            // `saveOverrides()` is cheap and always current — it walks the maps and collects the
            // bindings that carry an override — so the readout asks it rather than caching a count
            // that a rebind or a reset could leave stale.
            readout("Overrides held", (): string => {
              const count = app.input.saveOverrides().overrides.length;
              return count === 0 ? "none — using the defaults" : `${String(count)}, saved to app.storage`;
            }),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [readout("Draw calls", (): string => String(app.renderer.drawCalls))],
        },
      ],
    });
  },
});
