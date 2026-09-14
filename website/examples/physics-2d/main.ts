import { Camera2D, physics2d, twoD, Vec2 } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { button, readout, slider } from "../_kit/panel.ts";
import { AIM_ACTIONS, createArena, Thrower } from "./arena.ts";
import { Launch } from "./launch.ts";
import { ARENA_WIDTH, COLUMNS, MIDDLE_COLUMN } from "./scene.ts";
import type { SpriteAtlasAsset } from "ignifx";

/**
 * Simulate boxes and circles with the engine's fixed loop and interpolate their display poses.
 * Mass is in kilograms; zero derives it from collider area at 1 kg/m².
 * Colliders without a Rigidbody2D become static bodies at the next fixed step.
 */

// The dusk sky behind the arena: presents as bytes `31, 35, 51` (`#1F2333`), darker than the
// platformer course so the crates and coins read against it. `rendering.clearColor` is decoded from
// sRGB and not re-encoded (`packages/2d/src/settings.ts`), so this is `linearToSrgb(target / 255)`.
const CLEAR_COLOR = { r: 0.3835, g: 0.4062, b: 0.4845, a: 1 };

bootExample({
  title: "2D physics",
  // One world metre is one 18-pixel tile, which is the size Kenney's pixel-platformer art is cut at.
  extensions: [twoD({ pixelsPerUnit: 18 }), physics2d()],
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      // Multisampling is off because it would soften exactly the edges pixel art exists to keep
      // sharp.
      msaaSamples: 1,
    },
    time: { fixedDeltaTime: 1 / 60 },
    sortingLayers: { sortingLayers: ["Terrain", "Default"] },
    // Real gravity here, unlike the platformer: every body in this scene is dynamic, and gravity is
    // what the solver applies to it.
    physics2d: { gravity: { x: 0, y: -18 }, defaultMaterial: { friction: 0.55, restitution: 0 } },
  },

  setup({ app, panel, random }) {
    app.registerComponents([Launch, Thrower]);
    app.input.loadActions(AIM_ACTIONS);

    const handle = app.assets.load<SpriteAtlasAsset>("2d/props.atlas.json");
    return handle.promise.then((): void => {
      const arena = createArena(app, handle, random);
      const thrower = app.world.createEntity("Thrower").addComponent(Thrower);
      thrower.arena = arena;

      const eye = app.world.createEntity("Main Camera");
      eye.transform.position2D = new Vec2(ARENA_WIDTH / 2, 2.5);
      eye.addComponent(Camera2D, {
        // The zoom is `viewportHeight / referenceResolution.y`, snapped to a whole number, so one
        // texel always covers an exact square of screen pixels.
        pixelPerfect: true,
        referenceResolution: { x: 160, y: 90 },
      });

      panel({
        title: "2D physics",
        groups: [
          {
            label: "Arena",
            controls: [
              button("Throw a coin", (): void => {
                arena.throwAt(new Vec2(MIDDLE_COLUMN, 2.5));
              }),
              button("Drop a crate", (): void => {
                arena.crate(COLUMNS[Math.floor(random() * COLUMNS.length)] ?? MIDDLE_COLUMN, 7);
              }),
              button("Reset the stack", arena.reset),
              readout("Bodies", (): string => String(arena.bodies.length)),
            ],
          },
          {
            label: "World",
            collapsed: true,
            controls: [
              slider(
                "Gravity",
                { min: -40, max: 0, step: 1, format: (value: number): string => `${value.toFixed(0)} m/s²` },
                {
                  value: app.physics2d.gravity.y,
                  change: (value: number): void => {
                    app.physics2d.gravity = { x: 0, y: value };
                  },
                },
              ),
              readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            ],
          },
        ],
      });
    });
  },
});
