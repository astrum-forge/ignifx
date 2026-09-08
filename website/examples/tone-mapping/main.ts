import { Camera, Environment, ENVIRONMENT_ASSET_TYPE, MODEL_ASSET_TYPE, Model } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, readout, select, slider, toggle } from "../_kit/panel.ts";
import { createLightRig, createStudioFloor } from "../_kit/stage.ts";
import {
  COMPARE_CURVE,
  createEmissiveRamp,
  CURVES,
  FOCUS,
  GRADING,
  KEY_INTENSITY,
  START_CURVE,
  SUBJECT,
  twoPlaces,
} from "./scene.ts";
import type { AssetHandle, EnvironmentAsset, ModelAsset } from "ignifx";

/**
 * Tone mapping and exposure: the last thing that happens to a frame, and the one a game puts in its
 * settings screen.
 *
 * A renderer works in linear light with no ceiling — a metal highlight or an emissive surface is
 * routinely several times brighter than white — and a display has a ceiling of one. A tone-mapping
 * curve is the function that maps the first onto the second, and `Environment.imageProcessing` is
 * where ignifx keeps it: `exposure` multiplies the scene before the curve, `contrast` steepens it,
 * and `toneMapping` picks the curve. **It is compiled into the PBR shaders**, not applied as a
 * pass, which is why changing the curve recompiles the scene's pipelines and changing the exposure
 * is nearly free. (`PostProcessStack.imageProcessing` is the other path, as a real pass over the
 * finished frame; the two do the same arithmetic in different places.)
 *
 * The instrument is the ramp of six emissive spheres: their emissive climbs to exactly one, so
 * raising the exposure walks them past the display's ceiling from the right, and what each curve
 * does with the ones that went past is the whole difference between the curves. The corset is there
 * because a curve has to be judged on a real surface too — cloth, leather and a metal clasp.
 *
 * ## Why this is a flip and not a split screen
 *
 * A world renders through **one** camera: the enabled `Camera` with the highest `priority` becomes
 * `scene.camera` and the others draw nothing, so two viewports side by side is not something ignifx
 * can do today. And the curve is scene state in any case — it is compiled into the materials, not
 * chosen per camera — so even two views would show the same one. The panel therefore holds two
 * curves and a toggle that flips between them, which is the honest version of the same comparison.
 */

bootExample({
  title: "Tone mapping and exposure",
  settings: {
    rendering: {
      clearColor: { r: 0.02, g: 0.024, b: 0.032, a: 1 },
      msaaSamples: 4,
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.02, far: 200, fov: 34 });
    attachOrbit(app, eye, { yaw: 8, pitch: 10, distance: 2.9, target: FOCUS, minDistance: 1.2, maxDistance: 12 });

    // Both loads are awaited before the loop runs, so neither needs a frame pumped to settle. The
    // `.env` also pulls the BRDF table Lite requires, from the `rendering.brdfLut` default address.
    const model: AssetHandle<ModelAsset> = app.assets.load(SUBJECT.address, { type: MODEL_ASSET_TYPE });
    const environment: AssetHandle<EnvironmentAsset> = app.assets.load("environments/studio.environment.json", {
      type: ENVIRONMENT_ASSET_TYPE,
    });
    await Promise.all([model.promise, environment.promise]);

    const sky = app.world.createEntity("Environment").addComponent(Environment, { environment });
    sky.blur = 0.1;
    sky.imageProcessing.exposure = GRADING.exposure;
    sky.imageProcessing.contrast = GRADING.contrast;
    sky.imageProcessing.toneMapping = CURVES[START_CURVE] ?? "aces";

    createStudioFloor(app, { size: 160, environmentIntensity: 0.3 });
    // No shadow, and no `features.shadows` above with it: `shadows` is the example that is about
    // shadow maps, and a cast shadow here would only be one more thing the curve is not doing.
    createLightRig(app, {
      focus: FOCUS,
      shadows: false,
      keyIntensity: KEY_INTENSITY,
      keyPosition: { x: -1.1, y: 4.2, z: -1.6 },
      rimIntensity: 2.4,
    });

    const subject = app.world.createEntity("Corset");
    subject.transform.localPosition.set(0, SUBJECT.height, 0);
    subject.transform.localScale.set(SUBJECT.scale, SUBJECT.scale, SUBJECT.scale);
    subject.addComponent(Model, { model, castShadows: true, receiveShadows: false });

    createEmissiveRamp(app);

    // The A/B: two labels, and a flag saying which one the scene is compiled with right now.
    let curveA = START_CURVE;
    let curveB = COMPARE_CURVE;
    let isShowingB = false;
    /** Applies whichever of the two curves is selected. One assignment; a pipeline rebuild follows. */
    const apply = (): void => {
      sky.imageProcessing.toneMapping = CURVES[isShowingB ? curveB : curveA] ?? "none";
    };

    panel({
      title: "Tone mapping and exposure",
      groups: [
        {
          label: "Curve",
          controls: [
            select("Tone mapping", Object.keys(CURVES), {
              value: START_CURVE,
              change: (label: string): void => {
                curveA = label;
                isShowingB = false;
                apply();
              },
            }),
            select("Compare with", Object.keys(CURVES), {
              value: COMPARE_CURVE,
              change: (label: string): void => {
                curveB = label;
                isShowingB = true;
                apply();
              },
            }),
            toggle("Show the comparison", {
              value: false,
              change: (on: boolean): void => {
                isShowingB = on;
                apply();
              },
            }),
          ],
        },
        {
          label: "Grading",
          controls: [
            // Exposure multiplies the scene *before* the curve, so it is what decides how much of
            // the frame the curve has to deal with. Push it up and the ramp clips from the right.
            slider(
              "Exposure",
              { min: 0.2, max: 4, step: 0.05, format: twoPlaces },
              bind(sky.imageProcessing, "exposure"),
            ),
            slider(
              "Contrast",
              { min: 0.5, max: 2, step: 0.05, format: twoPlaces },
              bind(sky.imageProcessing, "contrast"),
            ),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Showing", (): string => (isShowingB ? curveB : curveA)),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
