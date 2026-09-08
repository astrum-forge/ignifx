import { ANIMATOR_ASSET_TYPE, Animator, Camera, MODEL_ASSET_TYPE, Model, physics, threeD } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, button, readout, slider } from "../_kit/panel.ts";
import { createGridGround, createLightRig } from "../_kit/stage.ts";
// The document sits in this example's own directory rather than under `assets/`, so it is not in
// the plugin's manifest. `?url` makes Vite emit and hash it like any other asset and hand back its
// path; resolving that against this module's own URL is what turns it into the absolute address
// `app.assets.load` needs, in dev and in the built site alike.
import machineUrl from "./fox.animator.json?url";
import type { AnimatorAsset, ModelAsset } from "ignifx";

/**
 * An `Animator`: one `.animator.json` document, one rigged model, and the four things a state
 * machine is for. `fox.animator.json` next to this file is the whole behaviour and is worth
 * reading first. It declares a **1D blend tree** on a `speed` parameter — `Survey` at 0, `Walk` at
 * 2, `Run` at 6, so a value of 4 plays half of each and the gait follows the number rather than
 * snapping at a threshold; a **trigger** that cuts to a one-shot `survey` state from wherever the
 * machine is; two **animation events** on that state, which arrive on `Animator.onEvent` as the
 * clip crosses them; and an **exit time**, which returns the fox to its locomotion nine tenths of
 * the way through. The code writes one parameter and sets one trigger; the rest is data.
 *
 * `Survey` is named twice on purpose: the Fox ships three clips and that one is both the idle and
 * the look-around, so it is the blend tree's low end *and* a state of its own with `loop: false`
 * and events on it. The fox runs on the spot for the same kind of reason — the parameter is the
 * subject, and `third-person` is where a controller writes it from a character's real speed.
 */

/** The metres one of the Fox's authoring units becomes: it is modelled in centimetres. */
const FOX_SCALE = 0.009;

/** How tall the scaled fox is, in metres: its 79.03-unit bind pose times {@link FOX_SCALE}. */
const FOX_HEIGHT = 0.71;

/**
 * The `speed` value the page opens on: between `Walk` and `Run`, so the blend is doing something.
 *
 * @remarks
 * The number the **document** declares, and the panel opens the slider there to match. A start
 * value belongs in the document, because an `Animator` builds its state machine on its first
 * advance and a `setFloat` before the first frame has nothing to write to.
 */
const START_SPEED = 4;

/** The address of the Khronos Fox. */
const FOX_ADDRESS = "models/fox.glb";

/**
 * Where Havok's WebAssembly is served from.
 *
 * @remarks
 * `threeD()` requires `physics()`, and the manifest carries no entry for an extension's public
 * asset — it is copied unhashed and served by name, so `"auto"` resolves to a page-relative path a
 * run page three segments deep cannot reach. `third-person/main.ts` says it at more length.
 */
const HAVOK_WASM_URL = `${import.meta.env.BASE_URL}assets/HavokPhysics.wasm`;

/** How many recent event names the readout shows. */
const EVENT_HISTORY = 3;
/**
 * How far into the locomotion cycle the fox starts, in seconds.
 *
 * @remarks
 * A clip's first frame is rarely its best; this one opens with the fox almost square. `Animator`
 * writes the pose from its layer's own cursor every frame, so advancing the machine once starts
 * the fox mid-stride on the first frame, live and in a `?static=1` capture alike.
 */
const START_PHASE = 0.38;

bootExample({
  title: "Animator",
  // `threeD()` requires `physics()` and `input()` before it; the kit registers `input()` first.
  extensions: [physics(), threeD()],
  settings: {
    rendering: {
      clearColor: { r: 0.36, g: 0.395, b: 0.44, a: 1 },
      msaaSamples: 4,
      features: { shadows: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
    physics: { havokWasm: HAVOK_WASM_URL },
  },

  async setup({ app, panel, afterStart }) {
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.05, far: 100, fov: 40 });
    attachOrbit(app, eye, {
      yaw: 132,
      pitch: 16,
      distance: 2.1,
      target: { x: 0, y: FOX_HEIGHT * 0.6, z: 0 },
      minDistance: 1,
      maxDistance: 10,
    });

    // Both handles are awaited before `app.start()`, where a completed load settles at once.
    const model = app.assets.load<ModelAsset>(FOX_ADDRESS, { type: MODEL_ASSET_TYPE });
    const machineAddress = new URL(machineUrl, import.meta.url).href;
    const machine = app.assets.load<AnimatorAsset>(machineAddress, { type: ANIMATOR_ASSET_TYPE });
    await createGridGround(app, { size: 24 });
    await Promise.all([model.promise, machine.promise]);

    createLightRig(app, { focus: { x: 0, y: FOX_HEIGHT / 2, z: 0 }, keyPosition: { x: -2.4, y: 3.4, z: -2 } });

    const fox = app.world.createEntity("Fox");
    fox.transform.localScale.set(FOX_SCALE, FOX_SCALE, FOX_SCALE);
    fox.addComponent(Model, { model: model.retain(), castShadows: true, receiveShadows: true });
    // One `Animator` per **model asset**: Lite binds an animation group to a single manager, so a
    // second animator over one `.glb` is refused the clips. A second fox needs a second address.
    const animator = fox.addComponent(Animator, { animator: machine.retain() });

    // `onEvent` fires once per crossing, in the frame the clip passes the event's time; `owner`
    // scopes the connection so it disconnects when the animator does.
    const seen: string[] = [];
    let total = 0;
    animator.onEvent.connect(
      (name: string): void => {
        total += 1;
        seen.unshift(name);
        seen.length = Math.min(seen.length, EVENT_HISTORY);
        app.log.info("animation event:", name);
      },
      { owner: animator },
    );

    // The machine exists from the animator's first advance, which `app.start()` has just run.
    afterStart((): void => {
      animator.stateMachine?.advance(START_PHASE);
    });

    // One number drives the whole tree: the document decides which clips it mixes, and in what
    // proportion, from this one parameter.
    const setSpeed = (value: number): void => {
      animator.setFloat("speed", value);
    };

    panel({
      title: "Animator",
      groups: [
        {
          label: "Blend tree",
          controls: [
            slider("speed", { min: 0, max: 8, step: 0.1 }, { value: START_SPEED, change: setSpeed }),
            readout("Gait", (): string => gaitFor(animator.getFloat("speed"))),
            slider("Rate", { min: 0.1, max: 2, step: 0.05, format: times }, bind(animator, "speed")),
          ],
        },
        {
          label: "Trigger",
          controls: [
            // A trigger is consumed by the first transition that reads it, so one press is one
            // look-around however long the frame took.
            button("survey", (): void => {
              animator.setTrigger("survey");
            }),
            readout("State", (): string => animator.currentState()),
            readout("Clip time", (): string => `${(animator.normalizedTime() * 100).toFixed(0)}%`),
          ],
        },
        {
          label: "Animation events",
          controls: [
            readout("Fired", (): string => String(total)),
            readout("Recent", (): string => (seen.length === 0 ? "none yet" : seen.join(", "))),
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

/**
 * Names the clips a `speed` value is mixing, so the readout says what the number means.
 *
 * @param speed - The `speed` parameter.
 * @returns The pair being blended, or the single clip at a threshold.
 */
function gaitFor(speed: number): string {
  if (speed < 2) {
    return speed <= 0 ? "Survey" : "Survey + Walk";
  }
  return speed === 2 ? "Walk" : speed < 6 ? "Walk + Run" : "Run";
}

/**
 * Writes a playback multiplier.
 *
 * @param value - The multiplier.
 * @returns The text for the slider's value cell.
 */
function times(value: number): string {
  return `${value.toFixed(2)}x`;
}
