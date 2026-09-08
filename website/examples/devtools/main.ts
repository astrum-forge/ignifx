import { Camera } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, button, readout, slider, toggle } from "../_kit/panel.ts";
import { createGridGround, createLightRig } from "../_kit/stage.ts";
import { Director } from "./director.ts";
import { createRing, Drone, START_SPEED } from "./ring.ts";
import type { DevtoolsPanelName } from "ignifx";

/**
 * The devtools overlay, open before you arrive.
 *
 * `@ignifx/devtools` is one extension and one key. Register it, press backtick, and nine tabs
 * appear over the canvas: frame numbers, the entity tree, a live component inspector, asset
 * handles, input, audio, physics, the log and a per-phase timing graph. It costs nothing while it
 * is closed — no system runs, no signal is subscribed to and no DOM exists until `open()` — which
 * is why a game registers it behind a development flag and then forgets about it. Every other
 * example on this site carries it too; press backtick on any of them.
 *
 * This is the one page that opens it for you, through the `devtools` settings section below.
 * `openOnStart` does it, `position: "left"` keeps it clear of the parameter panel, and `panels`
 * both re-orders and filters the tab strip — so the overlay opens on the **Inspector**, pointed at
 * the `Director` entity.
 *
 * The Inspector is where a game's own state shows up. Every `Script.define` field is a row it reads
 * and writes: type a number into `wave` and the next frame's `update` uses it, because the rows
 * write through to the live component. `director.ts` also publishes the same four numbers into
 * `app.diagnostics`, which is the API the Stats panel's own rows come from and the one a headless
 * test reads without opening anything.
 *
 * Worth knowing before copying that last part: the Stats panel draws a **fixed** list of engine
 * counters. A custom group is read back with `app.diagnostics.group("game")` — as the panel on the
 * right does — and is not a row on the overlay.
 */

/** The nine panels, in the tab order this example wants: the Inspector first, then the rest. */
const PANELS: readonly DevtoolsPanelName[] = [
  "inspector",
  "stats",
  "scene",
  "timeline",
  "assets",
  "console",
  "input",
  "audio",
  "physics",
];

/** How many of {@link PANELS} get a "Show" button in the parameter panel. */
const SHORTCUTS = 4;

bootExample({
  title: "Devtools overlay",
  settings: {
    rendering: {
      clearColor: { r: 0.043, g: 0.059, b: 0.094, a: 1 },
      msaaSamples: 4,
      features: { shadows: true },
    },
    devtools: { openOnStart: true, position: "left", panels: [...PANELS], opacity: 0.94 },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    app.registerComponents([Director, Drone]);

    const focus = { x: 0, y: 0.5, z: 0 };
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 200, fov: 44 });
    attachOrbit(app, eye, { yaw: 26, pitch: 27, distance: 4.4, target: focus, minDistance: 2, maxDistance: 14 });
    const rig = createLightRig(app, { focus, shadows: true, shadowDarkness: 0.3 });
    await createGridGround(app, { size: 24 });
    createRing(app);

    // The entity the overlay opens pointed at. `select` works before `app.start()` — the service
    // exists from `createApp` — so the Inspector has something to show on its first refresh.
    const stage = app.world.createEntity("Director");
    const director = stage.addComponent(Director);
    app.devtools.select(stage);

    panel({
      title: "Devtools overlay",
      groups: [
        {
          label: "Overlay",
          controls: [
            toggle("Open", {
              value: true,
              change: (on: boolean): void => {
                // `open()` builds the DOM and registers the sampler; `close()` disposes the DOM.
                // The sampler stays registered afterwards and returns on its first line, because
                // core's scheduler has `registerSystem` and no `unregisterSystem`.
                if (on) {
                  app.devtools.open();
                } else {
                  app.devtools.close();
                }
              },
            }),
            ...PANELS.slice(0, SHORTCUTS).map((name: DevtoolsPanelName) =>
              button(`Show ${name}`, (): void => {
                app.devtools.panel(name).show();
              }),
            ),
          ],
        },
        {
          label: "Gameplay",
          controls: [
            slider("Wave length", { min: 1, max: 12, step: 0.5 }, bind(director, "waveSeconds")),
            slider(
              "Drone speed",
              { min: 0, max: 120, step: 4 },
              {
                value: START_SPEED,
                change: (speed: number): void => {
                  for (const drone of app.world.components(Drone)) {
                    drone.speed = speed;
                  }
                },
              },
            ),
            toggle("Key light casts", bind(rig.key.shadows, "enabled")),
            button("Next wave", (): void => {
              director.advanceWave();
            }),
          ],
        },
        {
          label: "app.diagnostics",
          collapsed: true,
          controls: [
            readout("game/wave", (): string => director.read("wave")),
            readout("game/spawned", (): string => director.read("spawned")),
            readout("game/alive", (): string => director.read("alive")),
            readout("game/score", (): string => director.read("score")),
            readout("Scripts updated", (): string => String(app.diagnostics.frame.scriptsUpdated)),
          ],
        },
      ],
    });
  },
});
