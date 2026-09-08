import {
  BoxCollider2D,
  Camera2D,
  Camera2DFollow,
  CharacterController2D,
  physics2d,
  spawnTilemapObjects,
  SpriteAnimator,
  SpriteRenderer,
  Tilemap,
  TilemapCollider2D,
  TilemapRenderer,
  twoD,
  Vec2,
  VirtualButton,
  VirtualJoystick,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { bind, readout, slider, toggle } from "../_kit/panel.ts";
import { RUN_ACTIONS, Runner } from "./runner.ts";
import type {
  App,
  AssetHandle,
  Entity,
  SpriteAnimationAsset,
  SpriteAtlasAsset,
  TileObjectContext,
  TilemapAsset,
} from "ignifx";

/**
 * `CharacterController2D` on a course built for it: two 45-degree ramps, a pit, two tiers of
 * one-way planks, and a one-metre ledge with no ramp at all.
 *
 * The controller is a **kinematic** capsule or box that collides and slides through Rapier. It
 * applies no gravity of its own, which is the whole point: the script below owns the vertical
 * velocity, and that is what makes coyote time, a jump buffer and a variable jump height possible.
 * Four of its fields are on the panel because each one is a decision a platformer has to make.
 *
 * - **`slopeLimit`** is the steepest slope the character walks up. The ramps here are 45 degrees,
 *   so anything under 45 stops you at the foot of one.
 * - **`stepOffset`** is autostep: how tall a ledge the controller climbs without a jump. It needs
 *   `shape: "box"` — with the default capsule of radius 0.2 it clears about 0.15 m however large
 *   the number is. It is also a *small* number by nature: measured here on 2026-09-08, Rapier
 *   refuses a one-metre step at any `stepOffset`, which is why the three steps it is shown against
 *   are a quarter of a metre each and built from colliders rather than from cells. The one-metre
 *   ledge near the end of the course has to be jumped whatever the slider says.
 * - **`snapToGround`** keeps the feet on the floor going *down* a ramp instead of launching off
 *   the crest.
 * - **`onOneWayPlatforms`** is not the switch it sounds like: leaving it on is what makes a plank
 *   passable from below, and turning it off makes it solid from both sides.
 *
 * `course.tmj.json` beside this file is the Tiled export the level came from, and
 * `../tilemap/tools/build-2d-assets.ts` is what ran it through `importTiledMap` at build time. The
 * two ramp tiles carry triangular colliders; the plank tile carries a box a third of a cell tall
 * with `oneWay` set.
 */

/** The course is fifty-six by sixteen cells of one metre, and the camera may not leave it. */
const LEVEL_SIZE = { x: 56, y: 16 } as const;

/** The design resolution the pixel-perfect camera fits a whole-number zoom to. */
const REFERENCE_RESOLUTION = { x: 320, y: 180 } as const;

/**
 * The three steps `stepOffset` is shown against: `[x, height]` in metres, each a metre wide and
 * standing on the flat run east of the pit.
 *
 * @remarks
 * They are colliders rather than cells because a cell here is a whole metre and autostep is a
 * sub-metre feature. The sprite is the tileset's grass-topped ground frame, scaled: a sprite is
 * drawn at its frame size times the transform's scale, so one tile becomes a low kerb.
 */
const STAIRS: readonly (readonly [number, number])[] = [
  [25.5, 0.25],
  [26.5, 0.5],
  [27.5, 0.75],
];

/** The world height of the flat ground either side of the steps, in metres. */
const GROUND_TOP = 5;

// The dusk sky behind the course: presents as bytes `43, 47, 69` (`#2B2F45`), a dark dusk blue
// chosen for the pixel art. `rendering.clearColor` is decoded from sRGB and not re-encoded
// (`packages/2d/src/settings.ts`), so this is `linearToSrgb(target / 255)` per channel, not the byte.
const CLEAR_COLOR = { r: 0.4475, g: 0.4665, b: 0.5569, a: 1 };

/**
 * Loads the four documents the course is built from.
 *
 * @param app - The app being set up.
 * @returns The map, the tile atlas, and the runner's atlas and clips.
 */
async function loadCourse(app: App): Promise<{
  readonly map: AssetHandle<TilemapAsset>;
  readonly tiles: AssetHandle<SpriteAtlasAsset>;
  readonly atlas: AssetHandle<SpriteAtlasAsset>;
  readonly clips: AssetHandle<SpriteAnimationAsset>;
}> {
  const [map, tiles, atlas, clips] = await Promise.all([
    app.assets.loadAsync<TilemapAsset>("2d/course.tilemap.json"),
    app.assets.loadAsync<SpriteAtlasAsset>("2d/terrain.atlas.json"),
    app.assets.loadAsync<SpriteAtlasAsset>("2d/runner.atlas.json"),
    app.assets.loadAsync<SpriteAnimationAsset>("2d/runner.spriteanim.json"),
  ]);
  return { map, tiles, atlas, clips };
}

bootExample({
  title: "Platformer controller",
  extensions: [twoD({ pixelsPerUnit: 16 }), physics2d()],
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      // Multisampling is off because it would soften exactly the edges pixel art exists to keep
      // sharp.
      msaaSamples: 1,
    },
    time: { fixedDeltaTime: 1 / 60 },
    sortingLayers: { sortingLayers: ["Terrain", "Default"] },
    layers: { layers: ["Default", "Player", "Terrain"] },
    // Only rigid bodies fall under this. `CharacterController2D` is kinematic, so `Runner` owns the
    // vertical velocity — which is what makes coyote time and a variable jump height possible.
    physics2d: { gravity: { x: 0, y: -24 }, defaultMaterial: { friction: 0.4, restitution: 0 } },
  },

  async setup({ app, panel }) {
    app.registerComponents([Runner]);
    app.input.loadActions(RUN_ACTIONS);
    const assets = await loadCourse(app);

    app.twoD.registerTileObjectFactory("spawn", (context: TileObjectContext): Entity => {
      const entity = app.world.createEntity(context.name);
      entity.layer = app.world.layers.requireIndex("Player");
      const spawn = new Vec2(context.position.x + context.size.x / 2, context.position.y);
      entity.transform.position2D = spawn;
      entity.addComponent(SpriteRenderer, { sprite: assets.atlas, sortingLayer: "Default" });
      entity.addComponent(SpriteAnimator, { animations: assets.clips, defaultClip: "idle", playOnAwake: true });
      // A box, not the default capsule: autostep only works with one, and `stepOffset` is the
      // field this example exists to show.
      entity.addComponent(CharacterController2D, {
        shape: "box",
        radius: 0.28,
        height: 0.9,
        offset: { x: 0, y: 0.45 },
        slopeLimit: 50,
        stepOffset: 0.3,
        snapToGround: 0.25,
        onOneWayPlatforms: true,
      });
      entity.addComponent(Runner).spawn = spawn;
      return entity;
    });

    const level = app.world.createEntity("Course");
    level.layer = app.world.layers.requireIndex("Terrain");
    const map = level.addComponent(Tilemap, { map: assets.map, chunkSize: 16 });
    level.addComponent(TilemapRenderer, { atlas: assets.tiles, cullChunks: true });
    // Solid tiles become merged outlines; a `oneWay` tile contributes only its top edge, which is
    // what `onOneWayPlatforms` collides against.
    level.addComponent(TilemapCollider2D).collisionData = map.collisionData;

    // The step staircase. A collider with no `Rigidbody2D` gets an implicit static body, placed
    // once at the next fixed step, which is exactly what a piece of level furniture wants.
    const ground = assets.tiles.value.requireFrame("terrain_0");
    for (const [x, height] of STAIRS) {
      const step = app.world.createEntity(`Step ${height.toFixed(1)}m`);
      step.layer = app.world.layers.requireIndex("Terrain");
      step.transform.position2D = new Vec2(x, GROUND_TOP + height / 2);
      step.transform.localScale2D = new Vec2(1, height);
      step.addComponent(SpriteRenderer, { sprite: assets.tiles, sortingLayer: "Terrain" }).frame = ground;
      step.addComponent(BoxCollider2D, { size: { x: 1, y: height } });
    }

    const runner = spawnTilemapObjects(app, app.twoD, map)[0];
    if (runner === undefined) {
      throw new Error('course.tilemap.json has no object of type "spawn".');
    }
    const controller = runner.requireComponent(CharacterController2D);
    const script = runner.requireComponent(Runner);
    script.level = map;

    const eye = app.world.createEntity("Main Camera");
    eye.transform.position2D = new Vec2(runner.transform.position2D.x, runner.transform.position2D.y + 0.8);
    eye.addComponent(Camera2D, {
      pixelPerfect: true,
      referenceResolution: REFERENCE_RESOLUTION,
      follow: runner,
      followDamping: 0.1,
      followOffset: { x: 0, y: 0.8 },
      deadZone: { x: 1.2, y: 1.5 },
      boundsMin: { x: 0, y: 0 },
      boundsMax: LEVEL_SIZE,
    });
    eye.addComponent(Camera2DFollow);

    if (navigator.maxTouchPoints > 0) {
      const bottom = "calc(1.5rem + var(--ignifx-safe-bottom, 0px))";
      const widgets = [
        new VirtualJoystick(app, { control: "joystick", ariaLabel: "Move", style: { left: "1.5rem", bottom } }),
        new VirtualButton(app, { control: "jump", label: "A", ariaLabel: "Jump", style: { right: "1.5rem", bottom } }),
      ];
      window.addEventListener("pagehide", (): void => {
        for (const widget of widgets) {
          widget.dispose();
        }
      });
    }

    // The controller's tuning is read when its body is built, not on every step, so a live edit has
    // to ask for a rebuild — which happens at the start of the next fixed step.
    const retune = (write: (value: number) => void): ((value: number) => void) => {
      return (value: number): void => {
        write(value);
        controller.rebuild();
      };
    };

    panel({
      title: "Platformer controller",
      groups: [
        {
          label: "Controller",
          controls: [
            slider(
              "Slope limit",
              { min: 10, max: 80, step: 1, format: (value: number): string => `${String(value)}°` },
              {
                value: controller.slopeLimit,
                change: retune((value: number): void => {
                  controller.slopeLimit = value;
                }),
              },
            ),
            slider(
              "Step offset",
              { min: 0, max: 1.1, step: 0.05, format: (value: number): string => `${value.toFixed(2)} m` },
              {
                value: controller.stepOffset,
                change: retune((value: number): void => {
                  controller.stepOffset = value;
                }),
              },
            ),
            slider(
              "Snap to ground",
              { min: 0, max: 0.6, step: 0.05, format: (value: number): string => `${value.toFixed(2)} m` },
              {
                value: controller.snapToGround,
                change: retune((value: number): void => {
                  controller.snapToGround = value;
                }),
              },
            ),
            toggle("One-way planks", bind(controller, "onOneWayPlatforms")),
          ],
        },
        {
          label: "Feel",
          controls: [
            slider(
              "Jump speed",
              { min: 8, max: 22, step: 0.5, format: (value: number): string => `${value.toFixed(1)} m/s` },
              bind(script, "jumpSpeed"),
            ),
            slider(
              "Coyote time",
              {
                min: 0,
                max: 0.3,
                step: 0.01,
                format: (value: number): string => `${String(Math.round(value * 1000))} ms`,
              },
              bind(script, "coyoteTime"),
            ),
            slider(
              "Jump cut",
              { min: 0.1, max: 1, step: 0.05, format: (value: number): string => value.toFixed(2) },
              bind(script, "jumpCut"),
            ),
          ],
        },
        {
          label: "State",
          collapsed: true,
          controls: [
            readout("Grounded", (): string => (script.isGrounded ? "yes" : "no")),
            readout("Position", (): string => {
              const at = runner.transform.position2D;
              return `${at.x.toFixed(1)}, ${at.y.toFixed(1)} m`;
            }),
            readout("Speed", (): string => `${script.speedNow.toFixed(1)} m/s`),
            readout("Falls", (): string => String(script.falls)),
          ],
        },
      ],
    });
  },
});
