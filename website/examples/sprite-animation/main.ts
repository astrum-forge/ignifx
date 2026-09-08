import { Camera2D, SpriteAnimator, SpriteRenderer, twoD, Vec2 } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { bind, button, readout, select, slider, toggle } from "../_kit/panel.ts";
import type { App, AssetHandle, SpriteAnimationAsset, SpriteAtlasAsset } from "ignifx";

/**
 * One atlas, four clips, and the two components that turn them into a character on screen.
 *
 * The `.atlas.json` names the frames inside one image, in image pixels with a top-left origin; the
 * `.spriteanim.json` names clips over those frames — `idle` as a range, `run` as a range with two
 * `footstep` events on it, and `jump` and `fall` as single-frame poses. A `SpriteRenderer` draws
 * the atlas and a `SpriteAnimator` picks the frame, advancing in `PostUpdate` on **ignifx's own
 * clock**, so `time.timeScale` slows the animation and a headless test can step it.
 *
 * Three things a reader should take away:
 *
 * - **Direction is `flipX`, not a mirrored clip.** One set of frames, flipped when the character
 *   walks the other way, which is half the sheet a game would otherwise draw.
 * - **A frame's `pivot` is where the entity's origin sits inside it**, in `[0, 1]` of the frame with
 *   `[0, 0]` at the top-left. Every frame here pivots at `[0.5, 1]`, so the origin is at the feet
 *   and a character on a slope stands on it rather than in it.
 * - **`pixelsPerUnit` defaults to 100**, which would draw this 16-pixel sheet at 0.16 m. It is 16
 *   here, so one sprite is one metre. Sampling belongs to the atlas (`"sampling": "nearest"`),
 *   because a texture's sampler is fixed at upload — the camera's `pixelPerfect` does not change it.
 *
 * The four small runners on the right each hold one clip and never change, so the clips can be
 * compared side by side; the big one on the left is what the panel drives.
 */

/** The clips `runner.spriteanim.json` declares, in the order the select lists them. */
const CLIPS = ["idle", "run", "jump", "fall"] as const;

/** The design resolution the pixel-perfect camera fits a whole-number zoom to. */
const REFERENCE_RESOLUTION = { x: 160, y: 90 } as const;

/** Where the subject stands, in metres. */
const SUBJECT = { x: 2.2, y: 0.9 } as const;

/** Where the row of one-clip runners starts, and how far apart they stand, in metres. */
const ROW = { x: 5.1, y: 0.9, gap: 1.15 } as const;

/** How many ground tiles are laid per row, and where the strip starts. */
const GROUND = { count: 12, x: -1.5, y: 0.4, rows: 3 } as const;

// The dusk sky behind the runners: presents as bytes `43, 47, 69` (`#2B2F45`), the same dark dusk
// blue as the platformer course. `rendering.clearColor` is decoded from sRGB and not re-encoded
// (`packages/2d/src/settings.ts`), so this is `linearToSrgb(target / 255)` per channel, not the byte.
const CLEAR_COLOR = { r: 0.4475, g: 0.4665, b: 0.5569, a: 1 };

/**
 * Loads the two documents the scene is built from, and the tile sheet the floor is drawn with.
 *
 * @remarks
 * Awaited before `app.start()`, where a completed load settles at once; started after it, a load is
 * delivered in a later frame's `PreUpdate` and the first frames would draw nothing.
 *
 * @param app - The app being set up.
 * @returns The character's atlas and clips, and the terrain atlas.
 */
async function loadSheets(app: App): Promise<{
  readonly atlas: AssetHandle<SpriteAtlasAsset>;
  readonly clips: AssetHandle<SpriteAnimationAsset>;
  readonly terrain: AssetHandle<SpriteAtlasAsset>;
}> {
  const [atlas, clips, terrain] = await Promise.all([
    app.assets.loadAsync<SpriteAtlasAsset>("2d/runner.atlas.json"),
    app.assets.loadAsync<SpriteAnimationAsset>("2d/runner.spriteanim.json"),
    app.assets.loadAsync<SpriteAtlasAsset>("2d/terrain.atlas.json"),
  ]);
  return { atlas, clips, terrain };
}

bootExample({
  title: "Sprite animation",
  // One world metre is one 16-pixel frame. The default is 100, which would draw the runner at a
  // sixth of her intended size.
  extensions: [twoD({ pixelsPerUnit: 16 })],
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      // Multisampling is off because it would soften exactly the edges pixel art exists to keep
      // sharp.
      msaaSamples: 1,
    },
    time: { fixedDeltaTime: 1 / 60 },
    sortingLayers: { sortingLayers: ["Terrain", "Default"] },
  },

  async setup({ app, panel }) {
    const sheets = await loadSheets(app);
    const ground = sheets.terrain.value.requireFrame("terrain_0");

    // A grass-topped row with two rows of plain earth under it, so the strip reaches the bottom of
    // the frame rather than floating.
    const dirt = sheets.terrain.value.requireFrame("terrain_1");
    for (let row = 0; row < GROUND.rows; row += 1) {
      for (let index = 0; index < GROUND.count; index += 1) {
        const tile = app.world.createEntity(`Ground ${String(row)}.${String(index)}`);
        tile.transform.position2D = new Vec2(GROUND.x + index, GROUND.y - row);
        tile.addComponent(SpriteRenderer, { sprite: sheets.terrain, sortingLayer: "Terrain" }).frame =
          row === 0 ? ground : dirt;
      }
    }

    // The subject: one renderer, one animator, and nothing else. Every control on the panel writes
    // to one of their fields.
    const hero = app.world.createEntity("Runner");
    hero.transform.position2D = new Vec2(SUBJECT.x, SUBJECT.y);
    // Two metres tall rather than one, so the frames are readable next to the reference row. A
    // sprite is drawn at its frame size times the transform's scale.
    hero.transform.localScale2D = new Vec2(2, 2);
    const renderer = hero.addComponent(SpriteRenderer, { sprite: sheets.atlas, sortingLayer: "Default" });
    const animator = hero.addComponent(SpriteAnimator, {
      animations: sheets.clips,
      defaultClip: "run",
      playOnAwake: true,
      speed: 1,
    });

    // The reference row: the same atlas and the same clips, one animator each, never touched again.
    for (let index = 0; index < CLIPS.length; index += 1) {
      const clip = CLIPS[index] ?? "idle";
      const entity = app.world.createEntity(`Runner ${clip}`);
      entity.transform.position2D = new Vec2(ROW.x + index * ROW.gap, ROW.y);
      entity.addComponent(SpriteRenderer, { sprite: sheets.atlas, sortingLayer: "Default" });
      entity.addComponent(SpriteAnimator, { animations: sheets.clips, defaultClip: clip, playOnAwake: true });
    }

    const eye = app.world.createEntity("Main Camera");
    eye.transform.position2D = new Vec2(4.4, 1.7);
    eye.addComponent(Camera2D, { pixelPerfect: true, referenceResolution: REFERENCE_RESOLUTION });

    let playing = "run";
    panel({
      title: "Sprite animation",
      groups: [
        {
          label: "Clip",
          controls: [
            select("Playing", [...CLIPS], {
              value: playing,
              change: (value: string): void => {
                playing = value;
                // Guarded by the select itself: playing the clip that is already running would
                // restart it from frame zero.
                animator.play(value);
              },
            }),
            slider(
              "Speed",
              { min: 0, max: 3, step: 0.05, format: (value: number): string => `${value.toFixed(2)}x` },
              bind(animator, "speed"),
            ),
            toggle("Flip", bind(renderer, "flipX")),
            button("Restart", (): void => {
              animator.play(playing);
            }),
          ],
        },
        {
          label: "Animator",
          controls: [
            readout("Frame", (): string => String(animator.frame)),
            readout("Clip time", (): string => `${animator.time.toFixed(2)} s`),
            readout("Playing", (): string => (animator.isPlaying ? "yes" : "no")),
          ],
        },
      ],
    });
  },
});
