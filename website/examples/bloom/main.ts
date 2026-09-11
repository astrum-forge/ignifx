import { Camera, Environment, PostProcessStack } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, readout, slider, toggle } from "../_kit/panel.ts";
import { createLightRig } from "../_kit/stage.ts";
import { CLEAR_COLOR, createEmissiveRow, createFloor, createSphereRow, SHOT, START_BLOOM } from "./rows.ts";

/**
 * Declare `postProcessing` before startup, then enable bloom after scene registration.
 * Toggle the stack to skip its existing chain. Changing an effect's enabled state or bloom scale
 * rebuilds the chain; threshold, weight, and kernel update live.
 * Threshold uses linear light, kernel uses pixels, and scale is a fraction of full resolution.
 */

/**
 * Writes a slider's value with two decimals, so a 0.02 step does not read as `0.6200000000000001`.
 *
 * @param value - The value.
 * @returns The text for the value cell.
 */
function twoPlaces(value: number): string {
  return value.toFixed(2);
}

/**
 * Writes a slider's value as a pixel count.
 *
 * @param value - The value, in pixels.
 * @returns The text for the value cell.
 */
function pixels(value: number): string {
  return `${String(value)} px`;
}

bootExample({
  title: "Bloom",
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      msaaSamples: 4,
      features: { shadows: true, postProcessing: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel, afterStart }) {
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.05, far: 200, fov: SHOT.fov });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 1.6,
      maxDistance: 12,
    });

    // A quiet rig: the lamps give the geometry an edge, and the emissive surfaces light the frame.
    const rig = createLightRig(app, {
      focus: SHOT.target,
      keyIntensity: 1.1,
      fillIntensity: 0.16,
      rimIntensity: 0.5,
      shadows: true,
      shadowDarkness: 0.4,
    });

    createFloor(app);
    createSphereRow(app);
    await createEmissiveRow(app);

    // One `Environment` per world, and it needs no `.env`: with `environment` left null the
    // component is only the exposure, contrast and tone-mapping path the PBR shaders themselves
    // compile — which is what decides how far past white a pixel is before bloom sees it.
    const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: CLEAR_COLOR });
    sky.imageProcessing.exposure = SHOT.exposure;
    sky.imageProcessing.toneMapping = "aces";

    const post = eye.addComponent(PostProcessStack);
    post.bloom.threshold = START_BLOOM.threshold;
    post.bloom.weight = START_BLOOM.weight;
    post.bloom.kernel = START_BLOOM.kernel;
    post.bloom.scale = START_BLOOM.scale;
    afterStart((): void => {
      post.bloom.enabled = true;
    });

    panel({
      title: "Bloom",
      groups: [
        {
          label: "Bloom",
          controls: [
            // The component's `enabled`, not `bloom.enabled`: the chain stays recorded and is
            // skipped, which is a branch a frame rather than a rebuild per click. It also reads
            // `true` here, during `setup`, while `bloom.enabled` is still false until `afterStart`.
            toggle("Enabled", bind(post, "enabled")),
            slider("Threshold", { min: 0, max: 1, step: 0.02, format: twoPlaces }, bind(post.bloom, "threshold")),
            slider("Weight", { min: 0, max: 1.5, step: 0.05, format: twoPlaces }, bind(post.bloom, "weight")),
            slider("Kernel", { min: 8, max: 128, step: 4, format: pixels }, bind(post.bloom, "kernel")),
            slider("Scale", { min: 0.1, max: 1, step: 0.05, format: twoPlaces }, bind(post.bloom, "scale")),
          ],
        },
        {
          label: "Frame",
          controls: [
            // Exposure multiplies the whole frame before tone mapping, so it moves what crosses
            // the threshold as surely as the threshold does.
            slider(
              "Exposure",
              { min: 0.2, max: 2, step: 0.05, format: twoPlaces },
              bind(sky.imageProcessing, "exposure"),
            ),
            // All three lamps, so what is left when they are off is the light the emitters make.
            toggle("Lamps", {
              value: true,
              change: (on: boolean): void => {
                rig.key.enabled = on;
                rig.fill.enabled = on;
                rig.rim.enabled = on;
              },
            }),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            readout("Post-process tasks", (): string => String(post.taskCount)),
          ],
        },
      ],
    });
  },
});
