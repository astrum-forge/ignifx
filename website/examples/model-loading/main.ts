import { Camera, Environment, MODEL_ASSET_TYPE, Model } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, button, readout, select, toggle } from "../_kit/panel.ts";
import { createGridGround, createLightRig, loadEnvironment } from "../_kit/stage.ts";
import { fit, START_SUBJECT, SUBJECT_RADIUS, SUBJECTS, TARGET_HEIGHT } from "./subjects.ts";
import type { AssetHandle, ModelAsset } from "ignifx";

/**
 * Assign loading asset handles to models and display their progress until delivery.
 * Pair every load with a release; zero-reference assets are collected after `gcDelay` or `gc()`.
 * Await the opening asset before startup for a settled first frame. Later loads arrive in `PreUpdate`.
 */

/** How the panel writes a fraction: `progress` is `0…1`, bytes-weighted where sizes are known. */
const PERCENT = 100;

/** Bytes in a kibibyte, for the Held readout. */
const BYTES_PER_KIB = 1024;

/**
 * The clear colour, which is the site's dark `--bg` a shade deeper.
 *
 * @remarks
 * `studio.environment.json` loads its `.env` with the skybox off — the probe's cube map is a
 * mid-grey softbox room, which is right as light and wrong as a background — so what shows behind
 * the subject is this colour and nothing else.
 */
const CLEAR_COLOR = { r: 0.043, g: 0.059, b: 0.094, a: 1 };

/** The exposure the studio probe is graded at, chosen so the grid reads without flattening a metal. */
const EXPOSURE = 1.15;

bootExample({
  title: "Model loading",
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      msaaSamples: 4,
      // Read once, when `app.start()` registers the scene; asking afterwards is `IGX-0704`.
      features: { shadows: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    const focus = { x: 0, y: TARGET_HEIGHT / 2, z: 0 };

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.05, far: 200, fov: 38 });
    const orbit = attachOrbit(app, eye, {
      yaw: 34,
      // 24 degrees, not the 16 this started at: with a 38-degree vertical field of view the top of
      // the frame is 19 degrees above centre, so any pitch under that leaves the ground plane's
      // horizon — and a band of empty clear colour above it — in shot.
      pitch: 24,
      minDistance: 0.9,
      maxDistance: 12,
      idleDegreesPerSecond: 6,
    });
    orbit.frame({ center: focus, radius: SUBJECT_RADIUS }, 1.15);

    createLightRig(app, { focus, keyIntensity: 2.2, rimIntensity: 0.9, shadowDarkness: 0.28 });
    // Wide enough that its far edge is past the vanishing line at this camera pitch, so the frame
    // reads as a floor rather than as a tile in the void. One grid cell is one metre at any size.
    const ground = await createGridGround(app, { size: 60 });

    // Both loads are awaited before the loop runs, so neither needs a frame pumped to settle. The
    // `.env` also pulls the BRDF table Lite requires, from the `rendering.brdfLut` default address.
    const first: AssetHandle<ModelAsset> = app.assets.load(SUBJECTS[START_SUBJECT]?.address ?? "", {
      type: MODEL_ASSET_TYPE,
    });
    const environment = loadEnvironment(app, "studio");
    await Promise.all([first.promise, environment.promise]);

    const sky = app.world
      .createEntity("Environment")
      // `skybox` is decided when the `.env` loads, not here: `studio.environment.json` declares
      // `skyboxEnabled: false`, so the component is told the same thing rather than left at its
      // default and reported as `IGX-0711`. The background is the clear colour.
      .addComponent(Environment, { environment, clearColor: CLEAR_COLOR, skybox: { enabled: false, size: 20 } });
    sky.imageProcessing.toneMapping = "aces";
    sky.imageProcessing.exposure = EXPOSURE;

    const entity = app.world.createEntity("Subject");
    const subject = entity.addComponent(Model, { castShadows: true, receiveShadows: true });

    /** Every handle this example is holding, by the label that loaded it. One release each. */
    const held = new Map<string, AssetHandle<ModelAsset>>([[START_SUBJECT, first]]);
    let current = START_SUBJECT;

    /**
     * Shows one subject, loading it the first time it is asked for.
     *
     * @param label - A key of `SUBJECTS`.
     */
    const show = (label: string): void => {
      const next = SUBJECTS[label];
      if (next === undefined) {
        return;
      }
      // Swapping a model is one assignment: `Model` compares the loaded asset with the one it
      // instantiated and rebuilds its subtree on the next sync. A handle asked for the first time
      // is still loading when it is assigned, so the model appears on the frame its delivery lands
      // in — the asset lifetime, visible.
      const handle = held.get(label) ?? app.assets.load<ModelAsset>(next.address, { type: MODEL_ASSET_TYPE });
      held.set(label, handle);
      current = label;
      subject.model = handle;
      const placement = fit(next, TARGET_HEIGHT);
      entity.transform.localPosition.set(placement.offset.x, placement.offset.y, placement.offset.z);
      entity.transform.localScale.set(placement.scale, placement.scale, placement.scale);
    };
    show(START_SUBJECT);

    /** Drops every handle but the one on screen, and collects now rather than in `gcDelay` seconds. */
    const releaseOthers = (): void => {
      for (const [label, handle] of held) {
        if (label === current) {
          continue;
        }
        handle.release();
        held.delete(label);
      }
      // Without this the values live for `assets.gcDelay` seconds (five by default) in case
      // something asks for them again, which is the right default and the wrong demonstration.
      app.assets.gc();
      app.log.info("model-loading: holding", held.size, "model handles");
    };

    /**
     * How many bytes the manifest says the held models weigh.
     *
     * @returns The sum over every held address, from `AssetManifestEntry.bytes`.
     */
    const heldBytes = (): number => {
      let total = 0;
      for (const handle of held.values()) {
        const entry = app.assets.manifest.entries.find((candidate) => candidate.address === handle.address);
        total += entry?.bytes ?? 0;
      }
      return total;
    };

    /**
     * How many of the held handles have not arrived yet.
     *
     * @returns The count; zero except in the frames right after a swap to a model this page has
     * not asked for before.
     */
    const loadingCount = (): number => {
      let count = 0;
      for (const handle of held.values()) {
        if (handle.state === "loading") {
          count += 1;
        }
      }
      return count;
    };

    panel({
      title: "Model loading",
      groups: [
        {
          label: "Subject",
          controls: [
            select("Model", Object.keys(SUBJECTS), { value: START_SUBJECT, change: show }),
            button("Release the others", releaseOthers),
            // `active = false` hides an entity, `destroy()` removes it (`skills/ignifx/SKILL.md`
            // gotcha 6). The grid is switched off to look at a silhouette, not rebuilt.
            toggle("Grid", bind(ground.entity, "active")),
          ],
        },
        {
          label: "Handle",
          controls: [
            readout("Address", (): string => held.get(current)?.address ?? "—"),
            readout("State", (): string => held.get(current)?.state ?? "released"),
            readout("Progress", (): string => `${((held.get(current)?.progress ?? 0) * PERCENT).toFixed(0)}%`),
            readout("Holders", (): string => String(held.get(current)?.refCount ?? 0)),
            readout(
              "Held",
              (): string =>
                `${String(held.size)} model${held.size === 1 ? "" : "s"} · ${(heldBytes() / BYTES_PER_KIB).toFixed(0)} KiB`,
            ),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            readout("Still loading", (): string => String(loadingCount())),
          ],
        },
      ],
    });
  },
});
