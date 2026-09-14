import { Camera, Environment, PARTICLE_PRESETS, ParticleSystem, particleAssetFromDefinition, particles } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { readout, select, slider } from "../_kit/panel.ts";
import { createGridGround, createLightRig, loadEnvironment } from "../_kit/stage.ts";
import {
  bytes,
  CLEAR_COLOR,
  FLOOR_SIZE,
  NO_TWEAKS,
  PRESET_SHOT,
  SHOT,
  START_PRESET,
  tweakControls,
  tweakedDefinition,
  tweakKey,
} from "./effects.ts";
import type { Tweaks } from "./effects.ts";
import type { AssetHandle, ParticleAsset, ParticlePreset } from "ignifx";

/**
 * The nine shipped presets on one emitter, and the line between what an effect can change while it
 * runs and what it cannot.
 *
 * `particleDefinition("fire")` returns a complete `.particles.json` — the rate, the shape, the start
 * values, the forces, the curves and the gradients — and `ParticleSystem` plays one, so the select
 * below is nine documents handed to one component.
 *
 * The panel is in two halves because the split is the design. **Live** is what the app owns:
 * `qualityScale` multiplies every emission rate and `gravity` is a uniform, both read fresh each
 * frame. **Not live** is the document: a particle is computed from its spawn record by a formula,
 * and drag and noise are constants inside the *generated WGSL program*, so changing one means a new
 * document and a new program. The lower sliders do that, in coarse steps, and a combination already
 * built is remembered.
 *
 * `effects.ts` beside this file holds the framing, the three document edits and their sliders.
 */
bootExample({
  title: "Particles",
  extensions: [particles({ maxParticles: 50_000 })],
  settings: {
    // No shadow maps: a particle renderer never casts (Lite gives a shader material no shadow
    // bindings), and nothing else in this scene has a silhouette worth one.
    rendering: { clearColor: CLEAR_COLOR, msaaSamples: 4, features: { shadows: false } },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel, flags }) {
    const opening = PRESET_SHOT[START_PRESET];
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 200, fov: SHOT.fov });
    // The orbit camera damps towards its fields, so moving the target and the distance when the
    // preset changes is a pan rather than a cut.
    const orbit = attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: opening.distance,
      target: { x: 0, y: opening.target, z: 0 },
      minDistance: 2,
      maxDistance: 30,
    });

    createLightRig(app, {
      focus: { x: 0, y: opening.target, z: 0 },
      keyIntensity: 2.2,
      fillIntensity: 0.5,
      shadows: false,
    });
    await createGridGround(app, { size: FLOOR_SIZE, color: { r: 0.14, g: 0.16, b: 0.2, a: 1 } });

    // The probe is here for the floor and for `renderer.lit`: a lit particle takes its ambient from
    // the environment's spherical harmonics, and without one its unlit side is black.
    const environment = loadEnvironment(app, "studio");
    await environment.promise;
    const sky = app.world.createEntity("Environment").addComponent(Environment, {
      environment,
      clearColor: CLEAR_COLOR,
      skybox: { enabled: false, size: 20 },
    });
    sky.imageProcessing.toneMapping = "aces";

    // One handle per document built so far. A document is immutable, so the same preset and the
    // same three numbers are always the same asset — and the generated program behind it is
    // addressed by its own source, so a repeat costs no compile either.
    const built = new Map<string, AssetHandle<ParticleAsset>>();

    /**
     * The handle for one preset and one set of edits, building it the first time it is asked for.
     *
     * @param name - Which preset.
     * @param tweaks - The three numbers the lower sliders hold.
     * @returns The document handle to hand the component.
     */
    function documentFor(name: ParticlePreset, tweaks: Tweaks): AssetHandle<ParticleAsset> {
      const key = tweakKey(name, tweaks);
      const existing = built.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const handle = particleAssetFromDefinition(app, tweakedDefinition(name, tweaks), `fx/${key}`);
      built.set(key, handle);
      return handle;
    }

    let preset: ParticlePreset = START_PRESET;
    let tweaks: Tweaks = NO_TWEAKS;

    const emitter = app.world.createEntity("Emitter");
    emitter.transform.localPosition.set(0, opening.height, 0);
    // A fixed seed, so two loads of the same URL emit the same particles in the same order. `0`
    // would mean "pick one at random on `play()`", which is what a game wants and a golden does not.
    const system = emitter.addComponent(ParticleSystem, {
      definition: documentFor(preset, tweaks),
      seed: Math.max(1, Math.trunc(flags.seed)),
    });
    // A one-shot document stops when its last particle dies. Playing it again is how the two
    // non-looping presets stay watchable; `play()` keeps the seed, so every replay is the same.
    system.onStopped.connect(
      (): void => {
        system.play();
      },
      { owner: emitter },
    );

    /** Puts the current preset and edits on the component, and frames it. */
    function apply(): void {
      const shot = PRESET_SHOT[preset];
      emitter.transform.localPosition.set(0, shot.height, 0);
      orbit.target = { x: 0, y: shot.target, z: 0 };
      orbit.distance = shot.distance;
      system.definition = documentFor(preset, tweaks);
    }

    // The service's own diagnostics group, which the devtools overlay reads too. It is `null` in a
    // production build, where the counters are not collected at all.
    const counters = app.particles.counters;
    const uploadIndex = counters?.index("uploadBytes") ?? 0;

    panel({
      title: "Particles",
      groups: [
        {
          label: "Effect",
          controls: [
            select("Preset", PARTICLE_PRESETS, {
              value: preset,
              change: (value: string): void => {
                const chosen = PARTICLE_PRESETS.find((name: ParticlePreset): boolean => name === value);
                if (chosen === undefined) {
                  return;
                }
                preset = chosen;
                apply();
              },
            }),
            readout("Alive", (): string => `${String(system.aliveCount)} of ${String(system.capacity)}`),
            readout("Uploaded", (): string => (counters === null ? "—" : bytes(counters.get(uploadIndex)))),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
        {
          label: "Live",
          controls: [
            slider(
              "Quality",
              { min: 0, max: 1, step: 0.05, format: (value: number): string => `${(value * 100).toFixed(0)} %` },
              {
                value: app.particles.qualityScale,
                change: (value: number): void => {
                  app.particles.qualityScale = value;
                },
              },
            ),
            slider(
              "Gravity",
              { min: -20, max: 4, step: 0.5, format: (value: number): string => `${value.toFixed(1)} m/s²` },
              {
                value: app.particles.gravity.y,
                change: (value: number): void => {
                  app.particles.gravity = { x: 0, y: value, z: 0 };
                },
              },
            ),
            readout("Gravity ×", (): string => system.asset?.definition.forces.gravityMultiplier.toFixed(2) ?? "—"),
          ],
        },
        {
          label: "Document (rebuilds the effect)",
          controls: tweakControls(
            (next: Tweaks): void => {
              tweaks = next;
              apply();
            },
            (): number => built.size,
          ),
        },
      ],
    });
  },
});
