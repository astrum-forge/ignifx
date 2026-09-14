import { Camera, Environment, particleAssetFromDefinition, particles } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { readout, slider, toggle } from "../_kit/panel.ts";
import { createGridGround, createLightRig, loadEnvironment } from "../_kit/stage.ts";
import {
  CLEAR_COLOR,
  createPosts,
  createVolume,
  falls,
  FLOOR_SIZE,
  rainDefinition,
  setDocument,
  SHOT,
  snowDefinition,
  start,
  VOLUME,
} from "./storm.ts";
import { FollowsTheViewer } from "./volume.ts";

/**
 * Rain and snow as two volumes that follow the camera, with a wind that tilts them.
 *
 * A world of weather is a volume of weather over the viewer. Both documents declare
 * `simulationSpace: "world"`, which means a drop's position is computed from where its emitter
 * stood when it was born rather than from where the emitter is now — so the volume is dragged along
 * behind the camera and every drop already in the air keeps falling where it was. `volume.ts`
 * beside this file is the eleven-line script that does the dragging.
 *
 * Wind is the same fact from the other side. The forces in a document are fixed once it is built,
 * so there is no `wind` field to turn; what is live is the emitter's transform, and a world-space
 * document bakes it into every new record. Tilt the volume and the drops it emits from now on fall
 * at that angle, while the ones already falling keep their own.
 *
 * `renderer.lit` is a document field rather than a switch for the same reason: it changes the
 * generated program, because an unlit program never declares the light uniforms at all. The toggle
 * therefore hands the component a different document, which is one assignment.
 */

/** How far a gust may tilt a volume, in degrees. */
const MAX_WIND = 40;

bootExample({
  title: "Weather",
  extensions: [particles({ maxParticles: 20_000 })],
  settings: {
    rendering: { clearColor: CLEAR_COLOR, msaaSamples: 4, features: { shadows: true } },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel, flags, afterStart }) {
    app.registerComponents([FollowsTheViewer]);

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 300, fov: SHOT.fov });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 3,
      maxDistance: 45,
    });

    createLightRig(app, {
      focus: SHOT.target,
      keyPosition: { x: -9, y: 12, z: -7 },
      keyIntensity: 2.4,
      fillIntensity: 0.7,
      fillColor: { r: 0.6, g: 0.7, b: 0.95, a: 1 },
      rimIntensity: 0.5,
      shadows: true,
    });
    await createGridGround(app, { size: FLOOR_SIZE, color: { r: 0.16, g: 0.17, b: 0.2, a: 1 } });
    createPosts(app);

    // The probe lights the posts and, when "Lit particles" is on, gives every drop its ambient
    // term: a lit particle takes that from the environment's spherical harmonics, and a scene with
    // no probe shades the far side of every flake black.
    const environment = loadEnvironment(app, "studio");
    await environment.promise;
    const sky = app.world.createEntity("Environment").addComponent(Environment, {
      environment,
      clearColor: CLEAR_COLOR,
      skybox: { enabled: false, size: 20 },
    });
    sky.imageProcessing.toneMapping = "aces";
    // Distance fades into the fog colour, which is what makes a yard read as weather rather than as
    // a lit floor in a void. The drops are drawn by a generated shader material, and Babylon Lite
    // gives one no fog, so the far rain stays sharp while the ground behind it goes.
    sky.fog.mode = "exp2";
    sky.fog.density = 0.017;
    sky.fog.color = { r: 0.055, g: 0.065, b: 0.08, a: 1 };

    // Four documents, both looks of both effects, built once. Swapping one onto a component is an
    // assignment; a `prewarm`ed looping document fills its volume again on the first frame.
    const documents = {
      rain: {
        plain: particleAssetFromDefinition(app, rainDefinition(false), "fx/rain"),
        lit: particleAssetFromDefinition(app, rainDefinition(true), "fx/rain-lit"),
      },
      snow: {
        plain: particleAssetFromDefinition(app, snowDefinition(false), "fx/snow"),
        lit: particleAssetFromDefinition(app, snowDefinition(true), "fx/snow-lit"),
      },
    };

    // A fixed seed, so two loads of the same URL emit the same drops in the same order.
    const over = { target: eye, seed: Math.max(1, Math.trunc(flags.seed)) };
    const rain = createVolume(app, { ...over, name: "Rain", definition: documents.rain.plain, ...VOLUME.rain });
    const snow = createVolume(app, { ...over, name: "Snow", definition: documents.snow.plain, ...VOLUME.snow });

    afterStart((): void => {
      start(rain.system);
      start(snow.system);
    });

    let lit = false;
    let wind = 0;

    /** Applies the wind angle and the lit choice to both volumes. */
    function apply(): void {
      rain.entity.transform.localEulerAngles = { x: 0, y: 0, z: wind };
      snow.entity.transform.localEulerAngles = { x: 0, y: 0, z: wind };
      setDocument(rain.system, lit ? documents.rain.lit : documents.rain.plain);
      setDocument(snow.system, lit ? documents.snow.lit : documents.snow.plain);
    }

    panel({
      title: "Weather",
      groups: [
        {
          label: "Sky",
          controls: [
            toggle("Rain", { value: rain.system.enabled, change: falls(rain.system) }),
            toggle("Snow", { value: snow.system.enabled, change: falls(snow.system) }),
            slider(
              "Wind",
              { min: -MAX_WIND, max: MAX_WIND, step: 1, format: (value: number): string => `${value.toFixed(0)}°` },
              {
                value: wind,
                change: (value: number): void => {
                  wind = value;
                  apply();
                },
              },
            ),
            toggle("Lit particles", {
              value: lit,
              change: (value: boolean): void => {
                lit = value;
                apply();
              },
            }),
          ],
        },
        {
          label: "Cost",
          controls: [
            readout("Rain alive", (): string => String(rain.system.aliveCount)),
            readout("Snow alive", (): string => String(snow.system.aliveCount)),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
