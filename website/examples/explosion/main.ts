import { Camera, createRay, Environment, ParticleSystem, particleAssetFromDefinition, particles } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { button, readout, slider } from "../_kit/panel.ts";
import { createGridGround, createLightRig, loadEnvironment } from "../_kit/stage.ts";
import {
  aliveTotal,
  blastParts,
  CAPTURE_SECONDS,
  CHARGE_HEIGHT,
  CLEAR_COLOR,
  FLOOR_SIZE,
  groundPoint,
  MAX_SEED,
  OPENING_BLAST,
  SHOCKWAVE_TEXTURE,
  SHOT,
  START_SEED,
  WAVE_HEIGHT,
} from "./blast.ts";
import { BLAST_ACTIONS, ClickToDetonate } from "./click-to-detonate.ts";
import type { Detonator } from "./click-to-detonate.ts";
import type { AssetHandle, ParticleAsset, TextureAsset } from "ignifx";

/**
 * Click the ground to set off a blast: a fireball, a spray of stretched sparks, a shockwave on the
 * floor and two dozen lit boxes of debris.
 *
 * A blast is four `.particles.json` documents played together — `blast.ts` beside this file holds
 * them. `ParticleSystem` is `allowMultiple`, so all four sit on one entity and go off together, and
 * nothing here runs per frame: a particle's position, size, colour and spin at any moment is a
 * formula the GPU evaluates from the spawn record the CPU wrote when it was born.
 *
 * A seed and a document are all a burst is, so two detonations on one seed are the same blast,
 * particle for particle, whatever the frame rate — which is why the field below is worth having; a
 * seed of `0` would mean "pick one at random on `play()`". The spent entity destroys itself when
 * the debris, the longest-lived of the four, stops.
 */

bootExample({
  title: "Explosion",
  extensions: [particles({ maxParticles: 20_000 })],
  settings: {
    // No shadow maps: a particle renderer never casts one (Lite gives a shader material no shadow
    // bindings), and there is nothing else in the scene to cast.
    rendering: { clearColor: CLEAR_COLOR, msaaSamples: 4, features: { shadows: false } },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel, flags, afterStart }) {
    app.registerComponents([ClickToDetonate]);
    // `loadActions` merges by map name, so the orbit camera's own map is untouched.
    app.input.loadActions(BLAST_ACTIONS);

    const eye = app.world.createEntity("Main Camera");
    const camera = eye.addComponent(Camera, { near: 0.1, far: 300, fov: SHOT.fov });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 3,
      maxDistance: 40,
    });

    createLightRig(app, {
      focus: SHOT.target,
      keyPosition: { x: -4, y: 6, z: -8 },
      keyIntensity: 2.6,
      fillIntensity: 0.6,
      shadows: false,
    });
    await createGridGround(app, { size: FLOOR_SIZE, color: { r: 0.13, g: 0.15, b: 0.19, a: 1 } });

    // The probe is what makes `renderer.lit` worth having: a lit particle's ambient term is the
    // environment's spherical harmonics, and without one every chunk of debris facing away from the
    // key light is black.
    const environment = loadEnvironment(app, "studio");
    await environment.promise;
    const sky = app.world.createEntity("Environment").addComponent(Environment, {
      environment,
      clearColor: CLEAR_COLOR,
      skybox: { enabled: false, size: 20 },
    });
    sky.imageProcessing.toneMapping = "aces";

    // Awaited before `app.start()`, so the first blast already has its ring: a material binds a
    // texture once, and a handle that is still loading binds as the white fallback.
    await app.assets.loadAsync<TextureAsset>(SHOCKWAVE_TEXTURE);

    // One asset per document, shared by every blast: the twentieth compiles nothing.
    const documents: readonly AssetHandle<ParticleAsset>[] = blastParts().map((part): AssetHandle<ParticleAsset> =>
      particleAssetFromDefinition(app, part.definition, part.name),
    );

    // `latest` is the most recent blast's number: only that one lights again when it is spent, so
    // the repeat follows your clicks.
    let seed = START_SEED;
    let blasts = 0;
    let latest = 0;

    /**
     * Sets off one blast on the floor.
     *
     * @param x - Where, in metres.
     * @param z - Where, in metres.
     */
    function detonate(x: number, z: number): void {
      blasts += 1;
      latest = blasts;
      const mine = blasts;
      // Two entities: the wave lies on the floor, and everything else sits on the charge above it.
      const blast = app.world.createEntity("Blast", { position: { x, y: WAVE_HEIGHT, z } });
      const charge = app.world.createEntity("Charge", {
        parent: blast,
        position: { x: 0, y: CHARGE_HEIGHT, z: 0 },
      });
      let debris: ParticleSystem | null = null;
      for (let index = 0; index < documents.length; index += 1) {
        const definition = documents[index];
        if (definition === undefined) {
          continue;
        }
        const host = index === 0 ? blast : charge;
        const system = host.addComponent(ParticleSystem, { definition, seed: seed + index });
        debris = system;
        if (flags.isStatic) {
          // The capture flag stops the clock before the first frame, so a blast would be frozen at
          // the instant it was lit. `simulate` is the same arithmetic the frames would have run.
          system.play();
          system.simulate(CAPTURE_SECONDS);
        }
      }
      // The debris is the last of the four and the longest-lived, so when it stops the blast is
      // over: the entity destroys itself, and the newest blast lights again where it stood.
      debris?.onStopped.connect(
        (): void => {
          blast.destroy();
          if (mine === latest) {
            detonate(x, z);
          }
        },
        { owner: blast },
      );
    }

    // One ray and one point, reused: a click allocates nothing.
    const ray = createRay();
    const hit = { x: 0, z: 0 };
    const detonator: Detonator = {
      detonateAt(x: number, y: number): void {
        if (groundPoint(camera, ray, x, y, hit)) {
          detonate(hit.x, hit.z);
        }
      },
    };
    app.world.createEntity("Pointer").addComponent(ClickToDetonate).detonator = detonator;

    // One blast before the frame is called settled, so the example opens on an explosion rather
    // than on an instruction.
    afterStart((): void => {
      detonate(OPENING_BLAST.x, OPENING_BLAST.z);
    });

    panel({
      title: "Explosion",
      groups: [
        {
          label: "Blast",
          controls: [
            button("Detonate", (): void => {
              detonate(OPENING_BLAST.x, OPENING_BLAST.z);
            }),
            slider(
              "Seed",
              { min: 1, max: MAX_SEED, step: 1, format: (value: number): string => value.toFixed(0) },
              {
                value: START_SEED,
                change: (value: number): void => {
                  seed = Math.round(value);
                },
              },
            ),
            readout("Blasts", (): string => String(blasts)),
          ],
        },
        {
          label: "Cost",
          controls: [
            readout("Alive", (): string => String(aliveTotal(app))),
            readout("Systems", (): string => String(app.particles.systems.length)),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
