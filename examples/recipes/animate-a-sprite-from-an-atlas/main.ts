/**
 * Animate a sprite from an atlas
 *
 * Two documents and two components. The `.atlas.json` names the frames inside one image, in image
 * pixels with a top-left origin; the `.spriteanim.json` names clips over those frames. A
 * `SpriteRenderer` draws the atlas and a `SpriteAnimator` picks the frame, advancing in `PostUpdate`
 * on ignifx's own clock — so `time.timeScale` slows the animation and a headless test steps it.
 *
 * Direction is `flipX`, not a mirrored clip: one set of frames, flipped when the character walks
 * left. A frame's `pivot` is where the entity's origin sits inside it, in `[0, 1]` of the frame with
 * `[0, 0]` at the top-left, so `[0.5, 1]` puts the origin at the sprite's feet.
 *
 * `pixelsPerUnit` defaults to 100, which makes a 16-px sprite 0.16 m wide; set it to the art's pixel
 * size. Sampling belongs to the atlas (`"sampling": "nearest"`), because a texture's sampler is
 * fixed at upload — `pixelPerfect` on the camera does not change it.
 *
 * The two documents beside this file are what `2d/hero.atlas.json` and `2d/hero.spriteanim.json`
 * resolve to through the asset manifest.
 */
import { Camera2D, SpriteAnimator, SpriteRenderer, twoD } from "@ignifx/2d";
import { Script, createApp, f32 } from "@ignifx/core";
import type { SpriteAnimationAsset, SpriteAtlasAsset } from "@ignifx/2d";
import type { ScriptCallbacks } from "@ignifx/core";

/** Chooses the clip and the facing from the entity's own movement. */
class HeroAnimation extends Script.define({ speed: f32(3) }) implements ScriptCallbacks {
  static typeId = "recipes/HeroAnimation";

  #animator: SpriteAnimator | null = null;
  #renderer: SpriteRenderer | null = null;
  #clip = "";

  awake(): void {
    this.#animator = this.entity.requireComponent(SpriteAnimator);
    this.#renderer = this.entity.requireComponent(SpriteRenderer);
    this.#animator.onEvent.connect(
      (name: string): void => {
        this.app.log.info("animation event:", name);
      },
      { owner: this },
    );
  }

  // `direction` is -1, 0 or 1 — whatever the game's input or AI decided for this frame.
  drive(direction: number, dt: number): void {
    this.transform.translate({ x: direction * this.speed * dt, y: 0, z: 0 });
    if (direction !== 0 && this.#renderer !== null) {
      this.#renderer.flipX = direction < 0;
    }
    const wanted = direction === 0 ? "idle" : "run";
    if (wanted !== this.#clip) {
      this.#clip = wanted;
      // Guarded, because playing the clip that is already running would restart it.
      this.#animator?.play(wanted);
    }
  }
}

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}

const app = await createApp({
  canvas,
  settings: { assets: { root: "assets" }, sortingLayers: { sortingLayers: ["Background", "Default"] } },
  extensions: [twoD({ pixelsPerUnit: 16 })],
});
app.registerComponents([HeroAnimation]);

// Awaited before `app.start()`, where a completed load settles at once instead of waiting a frame.
const atlas = await app.assets.loadAsync<SpriteAtlasAsset>("2d/hero.atlas.json");
const clips = await app.assets.loadAsync<SpriteAnimationAsset>("2d/hero.spriteanim.json");

app.world.createEntity("Camera").addComponent(Camera2D, { orthographicSize: 5 });

const hero = app.world.createEntity("Hero");
const renderer = hero.addComponent(SpriteRenderer, { sortingLayer: "Default", orderInLayer: 10 });
renderer.sprite = atlas;
const animator = hero.addComponent(SpriteAnimator, { defaultClip: "idle", playOnAwake: true, speed: 1 });
animator.animations = clips;
const animation = hero.addComponent(HeroAnimation, { speed: 3 });

await app.start();
// Runs left: the same frames, mirrored.
animation.drive(-1, app.time.deltaTime);

window.addEventListener("pagehide", () => {
  atlas.release();
  clips.release();
  app.dispose();
});
