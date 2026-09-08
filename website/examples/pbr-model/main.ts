import { Camera, Environment, MODEL_ASSET_TYPE, Model, PostProcessStack } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, readout, select, slider, toggle } from "../_kit/panel.ts";
import { createBackdrop, createStudioFloor, createStudioRig, loadEnvironment } from "../_kit/stage.ts";
import { CURVES, GROUND, SHOT, START_CURVE, START_SUBJECT, SUBJECT_RADIUS, SUBJECTS } from "./shot.ts";
import type { AssetHandle, ModelAsset } from "ignifx";

/**
 * The render path every 3D ignifx game uses: a glTF model with physically based materials,
 * image-based lighting from a prefiltered environment, and bloom over ACES tone mapping.
 *
 * The order of the steps is the lesson. Build the cheap parts; `load` every asset and **await it
 * before `app.start()`**, where a completed load settles at once rather than waiting for a frame's
 * `PreUpdate`; attach the components that need it; then `app.start()`, and only then switch the
 * effects on — a bloom task recorded before the scene is registered samples the swapchain, which
 * WebGPU rejects. `bootExample` owns that last bit of timing, through `afterStart`.
 *
 * The composition — which model, where it stands, the lens, the grading, the floor and backdrop
 * tones — is `shot.ts`, next to this file and shown beside it on the example's page. Splitting it
 * out is what keeps this file about the engine: every number in it was measured against a rendered
 * candidate, and none of it is a lesson about ignifx.
 */

bootExample({
  title: "Physically based rendering",
  settings: {
    rendering: {
      clearColor: GROUND.clear,
      msaaSamples: 4,
      // Both features are read once, when `app.start()` registers the scene; asking afterwards is
      // `IGX-0704`. `postProcessing` is the one people forget — it renders the scene into an
      // offscreen target so an effect has something it is allowed to sample. Without it a
      // `PostProcessStack` logs `IGX-0710` and does nothing at all.
      features: { shadows: true, postProcessing: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel, afterStart }) {
    const start = SUBJECTS[START_SUBJECT] ?? { address: "", scale: 1, height: 0 };
    const focus = { x: 0, y: start.height, z: 0 };

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.02, far: 600, fov: SHOT.fov });
    // One `frame()` call sets the distance at which a sphere of this radius subtends the camera's
    // own field of view, times `padding`.
    const orbit = attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      minDistance: 0.6,
      maxDistance: 8,
      idleDegreesPerSecond: SHOT.idle,
    });
    orbit.frame({ center: focus, radius: SUBJECT_RADIUS }, SHOT.padding);

    const rig = createStudioRig(app, {
      focus,
      keyIntensity: SHOT.key.intensity,
      keyPosition: SHOT.key.at,
      fillIntensity: SHOT.fill.intensity,
      fillPosition: SHOT.fill.at,
      fillColor: SHOT.fill.color,
      rimIntensity: SHOT.rim.intensity,
      rimPosition: SHOT.rim.at,
    });
    rig.key.color = SHOT.key.color;
    rig.rim.color = SHOT.rim.color;
    const floor = createStudioFloor(app, { size: GROUND.floorSize, color: GROUND.floor });
    // The two lamps that shape the subject are kept off the floor: their spill would pool behind it
    // and give the composition a second subject, and the backdrop is what the eye should find
    // there. `Light.exclude` is one assignment, matched on the entity, with no layer to set up.
    rig.rim.exclude = [floor.entity];
    rig.fill.exclude = [floor.entity];
    // The backdrop's pool of light is painted at the centre of its texture, and a sphere's `u` is
    // longitude — so turning the sphere is what puts the pool behind the subject instead of
    // wherever `u = 0` landed. The angle was found by sweeping it and looking, because which
    // meridian Lite's sphere calls `u = 0` is not something to depend on.
    const backdrop = await createBackdrop(app, { diameter: GROUND.backdropDiameter });
    backdrop.entity.transform.localEulerAngles = { x: 0, y: SHOT.backdropYaw, z: 0 };

    // Both loads are awaited before the loop runs, so neither needs a frame pumped to settle. The
    // `.env` also pulls the BRDF table Lite requires, from the `rendering.brdfLut` default address.
    const first: AssetHandle<ModelAsset> = app.assets.load(start.address, { type: MODEL_ASSET_TYPE });
    const environment = loadEnvironment(app, "studio");
    await Promise.all([first.promise, environment.promise]);

    // One `Environment` per world; a second logs `IGX-0705`. Its `imageProcessing` record is the
    // exposure/tone-mapping path the PBR shaders themselves compile, which is why changing the
    // curve recompiles a pipeline and changing the exposure is nearly free. `blur` is what stops a
    // roughness-mapped metal hull reading as chrome: a little softens the probe's softboxes into
    // reflections you can follow, and zero mirrors the room.
    const sky = app.world
      .createEntity("Environment")
      .addComponent(Environment, { environment, clearColor: GROUND.clear });
    sky.imageProcessing.toneMapping = CURVES[START_CURVE] ?? "aces";
    sky.imageProcessing.exposure = SHOT.exposure;
    sky.blur = SHOT.blur;

    const entity = app.world.createEntity("Subject");
    const subject = entity.addComponent(Model, { castShadows: true, receiveShadows: false });
    const handles = new Map<string, AssetHandle<ModelAsset>>([[START_SUBJECT, first]]);
    // Swapping a model is one assignment: `Model` compares the loaded asset with the one it
    // instantiated and rebuilds its subtree on the next sync. A handle asked for the first time is
    // still loading when it is assigned, so the new model appears on the frame its delivery lands
    // in — the asset lifetime, visible.
    const swap = (label: string): void => {
      const placement = SUBJECTS[label];
      if (placement === undefined) {
        return;
      }
      const handle = handles.get(label) ?? app.assets.load<ModelAsset>(placement.address, { type: MODEL_ASSET_TYPE });
      handles.set(label, handle);
      subject.model = handle;
      entity.transform.localPosition.set(0, placement.height, 0);
      entity.transform.localScale.set(placement.scale, placement.scale, placement.scale);
      entity.transform.localEulerAngles = placement.pose;
      // `active = false` hides, `destroy()` removes (`skills/ignifx/SKILL.md` gotcha 6): the floor
      // is switched, not rebuilt, so swapping back costs nothing.
      floor.entity.active = placement.floor;
    };
    swap(START_SUBJECT);

    // The chain is built once and switched with `enabled`: a frame graph cannot have a task
    // removed. `afterStart` is when the effects go on; see the module comment.
    const post = eye.addComponent(PostProcessStack);
    post.bloom.threshold = SHOT.bloomThreshold;
    post.bloom.weight = SHOT.bloomWeight;
    post.bloom.kernel = SHOT.bloomKernel;
    post.smaa.threshold = 0.05;
    afterStart((): void => {
      post.bloom.enabled = true;
      post.smaa.enabled = true;
    });

    panel({
      title: "Physically based rendering",
      groups: [
        {
          label: "Subject",
          controls: [select("Model", Object.keys(SUBJECTS), { value: START_SUBJECT, change: swap })],
        },
        {
          label: "Grading",
          controls: [
            slider("Exposure", { min: 0.2, max: 3, step: 0.05 }, bind(sky.imageProcessing, "exposure")),
            // Not `bind`: the panel shows the industry's spellings and the field takes the engine's.
            select("Tone mapping", Object.keys(CURVES), {
              value: START_CURVE,
              change: (label: string): void => {
                sky.imageProcessing.toneMapping = CURVES[label] ?? "none";
              },
            }),
          ],
        },
        {
          label: "Environment",
          controls: [
            // Rotating the probe moves every reflection at once: the cheapest lighting control a
            // game can offer, and blurring it is the second.
            slider("Rotation", { min: 0, max: 360, step: 1 }, bind(sky, "rotation")),
            slider("Blur", { min: 0, max: 1, step: 0.02 }, bind(sky, "blur")),
          ],
        },
        {
          label: "Bloom",
          controls: [
            // The component's `enabled`, not `bloom.enabled`: the chain stays recorded and is skipped,
            // which is a branch a frame rather than a rebuild per click — and it reads `true` here, during
            // `setup`, while `bloom.enabled` is still false until `afterStart`. The threshold slider is
            // live: the recorded task's uniforms are re-uploaded the frame after it moves.
            toggle("Enabled", bind(post, "enabled")),
            slider("Threshold", { min: 0, max: 1.5, step: 0.02 }, bind(post.bloom, "threshold")),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            readout("Post-process tasks", (): string => String(post.taskCount)),
          ],
        },
      ],
    });
  },
});
