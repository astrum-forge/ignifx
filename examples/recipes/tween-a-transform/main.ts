/**
 * Tween a transform
 *
 * `app.tweens` is core: it interpolates any number, `Vec2`, `Vec3` or `Quat` property of any object,
 * on the game clock, in `PostUpdate` — so a tween honours `time.timeScale` and stops with
 * `app.pause()` unless it asks for `updateWhenPaused`. That is what makes it the right tool instead
 * of a coroutine that lerps by hand.
 *
 * A tween latches its start value when its delay elapses, not when it is created, so a chain built
 * from `onComplete` starts from wherever the previous one finished. Two tweens on one property fight
 * each other; one property, one tween.
 *
 * A tween keeps a reference to its target, so a script that starts tweens stops them again in
 * `onDestroy` with `stopAllOf` — otherwise they keep writing to a transform whose entity is gone.
 */
// docs:run
import { Quat, Script, createApp, f32 } from "@ignifx/core";
import type { ScriptCallbacks, Tween } from "@ignifx/core";

/** Lifts a portcullis, then swings it, then reports that it is open. */
class Portcullis extends Script.define({ travel: f32(3), seconds: f32(0.8) }) implements ScriptCallbacks {
  static typeId = "recipes/Portcullis";

  #tween: Tween | null = null;

  start(): void {
    this.#tween = this.app.tweens.to(
      this.transform,
      { position: { x: 0, y: this.travel, z: 0 } },
      {
        duration: this.seconds,
        // `ease` takes any of EASING_NAMES, or a function of your own: (t) => t * t.
        ease: "cubicInOut",
        onComplete: (): void => {
          this.#swing();
        },
      },
    );
  }

  /** The second link of the chain: it starts where the first one left the transform. */
  #swing(): void {
    this.#tween = this.app.tweens.to(
      this.transform,
      { rotation: Quat.fromEulerDegrees(0, 90, 0) },
      {
        duration: 0.4,
        ease: "backOut",
        onComplete: (): void => {
          this.app.log.info("open");
        },
      },
    );
  }

  onDestroy(): void {
    this.app.tweens.stopAllOf(this.transform);
    this.#tween = null;
  }

  // How far along the current link is, in `[0, 1]`; a HUD or a test reads it.
  get progress(): number {
    return this.#tween?.progress ?? 0;
  }
}

const app = await createApp({ headless: true });
app.registerComponents([Portcullis]);
const gate = app.world.createEntity("Portcullis");
const portcullis = gate.addComponent(Portcullis, { travel: 3, seconds: 0.8 });
await app.start();

// One `app.step(0.4)` would not advance the tween by 0.4 s: `time.maximumDeltaTime` clamps a raw
// frame delta to 0.1 s, so a long step is a short frame. Pump real frames instead.
for (let step = 0; step < 24; step += 1) {
  app.step(1 / 60);
}
app.log.info("0.4 s in, y and progress:", gate.transform.position.y, portcullis.progress);
for (let step = 0; step < 90; step += 1) {
  app.step(1 / 60);
}
app.log.info("done y, tweens running:", gate.transform.position.y, app.tweens.count);

// Destroying the entity stops its tweens through `onDestroy`; nothing keeps writing afterwards.
gate.destroy();
app.step(1 / 60);
app.dispose();
