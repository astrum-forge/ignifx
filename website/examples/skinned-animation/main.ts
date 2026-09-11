import {
  ANIMATOR_ASSET_TYPE,
  Animator,
  AnimatorAsset,
  Camera,
  defineAnimator,
  Environment,
  MODEL_ASSET_TYPE,
  Model,
  physics,
  threeD,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, readout, select, slider } from "../_kit/panel.ts";
import { createGridGround, createLightRig, loadEnvironment } from "../_kit/stage.ts";
import { OpeningPose, seek, stateLengthSeconds } from "./playhead.ts";
import type { AssetHandle, ModelAsset } from "ignifx";

/**
 * Drive named model clips with an Animator state machine. The `gait` parameter blends Walk and Run;
 * `crossFade` blends between states. Poses follow the machine cursor in `PostUpdate`.
 * Register physics and input with `threeD`, as required by its extension dependencies.
 */

/**
 * Where Havok's WebAssembly is served from.
 *
 * @remarks
 * `threeD()` requires `physics()`, and `physics({ havokWasm: "auto" })` — the default — asks the
 * asset manifest for `HavokPhysics.wasm`. The manifest has no entry for it: an extension's public
 * asset is copied **unhashed, by base name** into the public asset path, next to the manifest
 * rather than in it, so `resolveUrl` falls back to the relative `assets/HavokPhysics.wasm` and the
 * browser resolves that against `/examples/<slug>/run/` — a 404, and then `IGX-0903`. Vite's own
 * `BASE_URL` is the base the plugin wrote its URLs from, so this one line is right in `dev` and in
 * `build`.
 */
const HAVOK_WASM = `${import.meta.env.BASE_URL}assets/HavokPhysics.wasm`;

/** The animator document's address. It is built here rather than loaded, so it names no file. */
const ANIMATOR_ADDRESS = "memory:skinned-animation/fox.animator.json";

/** The Fox, from `assets/models/fox.glb`. */
const MODEL_ADDRESS = "models/fox.glb";

/**
 * The uniform scale the Fox is drawn at.
 *
 * @remarks
 * The file is authored 79.03 units tall and 154.72 long in its bind pose (measured from the
 * committed `.glb` with `@gltf-transform/core`'s `getBounds`, 2026-09-08), which makes it a
 * 0.79 m animal at this scale — a large fox, and the size the grid reads best against.
 */
const MODEL_SCALE = 0.01;

/** The clock the fixed step runs at, so a blend is the same length on any machine. */
const FIXED_STEP = 1 / 60;

/** How the panel writes a fraction. */
const PERCENT = 100;

/** The clear colour: the site's dark `--bg`, a shade deeper. */
const CLEAR_COLOR = { r: 0.043, g: 0.059, b: 0.094, a: 1 };

/**
 * The opening shot: the state, the gait and the playhead every capture is taken from.
 *
 * @remarks
 * `playhead` is not zero because frame zero of a locomotion clip is the pose the rigger happened to
 * key first, which for this rig is a mid-stride with both near legs occluding the far ones. A
 * quarter of the way through `Run` puts the fore legs forward and the hind legs back, which is what
 * a still of a running animal should look like. `?static=1` freezes the clock before `app.start()`,
 * so this is exactly the frozen pose (`playhead.ts`, `OpeningPose`).
 */
const SHOT = { state: "Locomotion", gait: 1, playhead: 0.25, yaw: 52, pitch: 24 } as const;

/**
 * The states the panel's select offers, and the clip or tree each one plays.
 *
 * @remarks
 * `Locomotion` is the blend tree; `Survey` is the fox looking around, which is a single clip and
 * three and a half times longer than either gait, so switching between the two is also a
 * demonstration that a crossfade does not care how long its two sides are.
 */
const STATES: readonly string[] = ["Locomotion", "Survey"];

bootExample({
  title: "Skinned animation",
  extensions: [physics(), threeD()],
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      msaaSamples: 4,
      // Read once, when `app.start()` registers the scene; asking afterwards is `IGX-0704`.
      // `skeletons` is Lite's opt-in for skinning a **Standard**-material mesh
      // (`index.d.ts`: "Enable four/eight-influence skeletal skinning for Standard meshes"), and it
      // is declared because a scene that mixes a glTF's PBR materials with a material built from
      // `standardMaterialDefinition` needs it and there is no way to ask for it later.
      features: { shadows: true, skeletons: true },
    },
    time: { fixedDeltaTime: FIXED_STEP },
    physics: { havokWasm: HAVOK_WASM },
  },

  async setup({ app, panel }) {
    app.registerComponents([OpeningPose]);

    const focus = { x: 0, y: 0.32, z: 0 };
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.05, far: 200, fov: 36 });
    const orbit = attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      // With a 36-degree vertical field of view the top of the frame is 18 degrees above centre,
      // so a pitch under that leaves the ground plane's horizon — and a band of empty clear colour
      // above it — in shot.
      pitch: SHOT.pitch,
      minDistance: 0.8,
      maxDistance: 10,
    });
    orbit.frame({ center: focus, radius: 0.95 }, 1.2);

    createLightRig(app, { focus, keyIntensity: 2.4, rimIntensity: 1.1, shadowDarkness: 0.3 });
    // Wide enough that its far edge is past the vanishing line at this camera pitch. One grid cell
    // is one metre at any size, so the frame says how big the fox is without a ruler in it.
    await createGridGround(app, { size: 60 });

    // Awaited before the loop runs, so both settle at once rather than waiting for a `PreUpdate`.
    const model: AssetHandle<ModelAsset> = app.assets.load(MODEL_ADDRESS, { type: MODEL_ASSET_TYPE });
    const environment = loadEnvironment(app, "studio");
    await Promise.all([model.promise, environment.promise]);

    const sky = app.world
      .createEntity("Environment")
      // `skybox` is decided when the `.env` loads, not here: `studio.environment.json` declares
      // `skyboxEnabled: false`, so the component is told the same thing rather than left at its
      // default and reported as `IGX-0711`. The background is the clear colour.
      .addComponent(Environment, { environment, clearColor: CLEAR_COLOR, skybox: { enabled: false, size: 20 } });
    sky.imageProcessing.toneMapping = "aces";
    sky.imageProcessing.exposure = 1.1;

    // The document. `defineAnimator` validates it and fills in every default, so what is written
    // here is only what this example decides: one float, one layer, two states, one blend tree.
    // `clip` and the blend children name **animation groups of the `.glb`**, by name.
    const animatorDocument = defineAnimator(
      {
        // `value` is the parameter's opening value, and declaring it here rather than calling
        // `setFloat` in `setup` is not a style choice: the state machine is built on the
        // animator's first `PostUpdate`, so a `setFloat` before the first frame reaches nothing.
        parameters: [{ name: "gait", kind: "float", value: SHOT.gait }],
        layers: [{ name: "Base", defaultState: "Locomotion" }],
        states: [
          { name: "Locomotion", blendTree: "locomotion" },
          { name: "Survey", clip: "Survey" },
        ],
        blendTrees1D: [
          {
            name: "locomotion",
            param: "gait",
            children: [
              { clip: "Walk", threshold: 0 },
              { clip: "Run", threshold: 1 },
            ],
          },
        ],
      },
      ANIMATOR_ADDRESS,
    );
    // `register` publishes an in-code value as a loaded handle with one holder, so the animator's
    // `asset()` field takes it exactly as it would take a `.animator.json` off the manifest. A
    // document loaded from a file is the usual way; this one is in the source so it can be read.
    const animatorAsset = app.assets.register(new AnimatorAsset(ANIMATOR_ADDRESS, animatorDocument), {
      type: ANIMATOR_ASSET_TYPE,
      address: ANIMATOR_ADDRESS,
    });

    const entity = app.world.createEntity("Fox");
    entity.transform.localScale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
    // The rig's bind-pose box runs from -88.10 to 66.63 along Z, so its centre is 10.74 units off
    // the file's origin; this is that measurement, scaled, which puts the animal in the frame's
    // middle rather than a tenth of a metre to one side of it.
    entity.transform.localPosition.set(0, 0, 0.1074);
    const fox = entity.addComponent(Model, { model, castShadows: true, receiveShadows: true });
    const animator = entity.addComponent(Animator, { animator: animatorAsset, speed: 1 });
    entity.addComponent(OpeningPose, { playhead: SHOT.playhead });

    /**
     * Which clips are contributing to this frame's pose, and how much of each.
     *
     * @returns One `name weight` pair per weighted clip, or a dash before the machine exists.
     */
    const mix = (): string => {
      const clips = animator.stateMachine?.clips ?? [];
      if (clips.length === 0) {
        return "—";
      }
      return clips.map((clip) => `${clip.clip} ${clip.weight.toFixed(2)}`).join(" · ");
    };

    panel({
      title: "Skinned animation",
      groups: [
        {
          label: "Clips",
          controls: [
            // `crossFade` is `play` with a transition length: the machine keeps both states'
            // cursors running and ramps one weight into the other over these seconds.
            select("State", STATES, {
              value: SHOT.state,
              change: (state: string): void => {
                animator.crossFade(state, 0.25);
              },
            }),
            // The blend tree's parameter. At 0 the pose is Walk, at 1 it is Run, and in between it
            // is both at once — one clip's weight against the other's, on one shared cursor.
            slider(
              "Gait",
              { min: 0, max: 1, step: 0.01, format: (value: number): string => (value < 0.5 ? "walk" : "run") },
              {
                value: SHOT.gait,
                change: (value: number): void => {
                  animator.setFloat("gait", value);
                },
              },
            ),
            readout("Mix", mix),
          ],
        },
        {
          label: "Playback",
          controls: [
            // A multiplier on every state's own rate. Zero holds the pose, which is what makes the
            // playhead below worth dragging.
            slider("Speed", { min: 0, max: 2, step: 0.05 }, bind(animator, "speed")),
            slider(
              "Playhead",
              { min: 0, max: 1, step: 0.01, format: (value: number): string => `${(value * PERCENT).toFixed(0)}%` },
              {
                value: SHOT.playhead,
                change: (value: number): void => {
                  seek(animator, fox, value);
                },
              },
            ),
            readout("State", (): string => animator.currentState()),
            readout("Length", (): string => `${stateLengthSeconds(animator, fox).toFixed(2)} s`),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            readout("Clips in file", (): string => String(fox.animations.length)),
          ],
        },
      ],
    });
  },
});
