import { Camera, Light } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, readout, select, slider, toggle } from "../_kit/panel.ts";
import { loadWithTechnique, readTechnique, ShadowRebuild } from "./rebuild.ts";
import {
  CASTER_SPIN,
  createCasters,
  degreesPerSecond,
  exponential,
  FILL,
  FOCUS,
  labelFor,
  MAP_SIZES,
  metresOrDefault,
  SHADOWS,
  SUN,
  TECHNIQUES,
  Turntable,
} from "./scene.ts";

/**
 * Every shadow control ignifx has, on one directional light over a floor that receives.
 *
 * Shadows are two decisions. The first is a project setting: `rendering.features.shadows` picks
 * `registerSceneWithShadowSupport` over `registerScene` when `app.start()` registers the scene, and
 * nothing can add a shadow pass afterwards — a light that asks later gets `IGX-0704`, and one that
 * sets `shadows.enabled` without the feature gets a logged warning and no shadow. The second is per
 * light: `shadows.enabled`, and the technique and its tuning in the same record. Only a directional
 * or a spot light can cast; a point or hemispheric light is refused with `IGX-0703`.
 *
 * **Only `enabled` is live.** The technique, the map size, the biases, the darkness, the cascade
 * count and the shadow distance are read once, when the generator is built, so changing one means
 * dropping that generator and building another — which is why a shadow-quality setting in a real
 * game belongs on a menu you leave, not on a slider you drag. `rebuild.ts` beside this file is that
 * rebuild, and the panel's "Generators built" readout counts them. The **technique** cannot be
 * changed even that way, because a renderable bakes the shadow bind group's layout; the select
 * reloads the frame with `?technique=`, and `rebuild.ts` records what happens if you do not.
 */

bootExample({
  title: "Shadows",
  settings: {
    rendering: {
      clearColor: { r: 0.043, g: 0.055, b: 0.078, a: 1 },
      msaaSamples: 4,
      features: { shadows: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    app.registerComponents([ShadowRebuild, Turntable]);

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 400, fov: 42 });
    attachOrbit(app, eye, { yaw: 14, pitch: 20, distance: 14, target: FOCUS, minDistance: 5, maxDistance: 60 });

    const casters = await createCasters(app);
    const turntable = casters.addComponent(Turntable, { speed: CASTER_SPIN });

    // The one caster. A directional light shines along its entity's +Z, and Lite fits the shadow
    // frustum from that direction and this position — so `lookAt` aims both at once.
    const sunEntity = app.world.createEntity("Sun", { position: SUN.at });
    sunEntity.transform.lookAt(FOCUS);
    const sun = sunEntity.addComponent(Light, { type: "directional", intensity: SUN.intensity, color: SUN.color });
    sun.shadows.enabled = true;
    // Per page load, not per change: see `rebuild.ts`.
    const technique = readTechnique(SHADOWS.technique);
    sun.shadows.technique = technique;
    sun.shadows.mapSize = SHADOWS.mapSize;
    sun.shadows.bias = SHADOWS.bias;
    sun.shadows.normalBias = SHADOWS.normalBias;
    sun.shadows.darkness = SHADOWS.darkness;
    sun.shadows.cascades = SHADOWS.cascades;
    sun.shadows.maxDistance = SHADOWS.maxDistance;
    const rebuild = sunEntity.addComponent(ShadowRebuild);

    // Hemispheric, so the shadow side of a caster stays readable. It casts nothing, which is the
    // point: ambient light has no direction to cast from.
    app.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: FILL.intensity });

    /** Which numeric fields of the `shadows` record the panel writes. */
    type ShadowNumber = "bias" | "cascades" | "darkness" | "mapSize" | "maxDistance" | "normalBias";

    /**
     * Writes one numeric shadow field, then asks for the single rebuild that makes it land.
     *
     * @param key - The field.
     * @returns The `change` callback a slider or a select takes.
     */
    const writes = (key: ShadowNumber): ((value: number) => void) => {
      return (value: number): void => {
        sun.shadows[key] = value;
        rebuild.request();
      };
    };

    /**
     * Moves the light up and re-aims it, so every shadow in the scene lengthens or shortens.
     *
     * @param value - The light's height, in metres.
     */
    const raise = (value: number): void => {
      sunEntity.transform.localPosition.set(SUN.at.x, value, SUN.at.z);
      sunEntity.transform.lookAt(FOCUS);
    };

    panel({
      title: "Shadows",
      groups: [
        {
          label: "Shadow map",
          controls: [
            toggle("Casts shadows", {
              value: true,
              change: (on: boolean): void => {
                rebuild.setCasting(on);
              },
            }),
            // The one control that reloads the frame rather than changing something live.
            select("Technique", Object.keys(TECHNIQUES), {
              value: labelFor(technique),
              change: (label: string): void => {
                loadWithTechnique(TECHNIQUES[label] ?? SHADOWS.technique);
              },
            }),
            select("Map size", Object.keys(MAP_SIZES), {
              value: String(SHADOWS.mapSize),
              change: (label: string): void => {
                writes("mapSize")(MAP_SIZES[label] ?? SHADOWS.mapSize);
              },
            }),
            slider("Darkness", { min: 0, max: 1, step: 0.02 }, { value: SHADOWS.darkness, change: writes("darkness") }),
          ],
        },
        {
          label: "Bias",
          collapsed: true,
          controls: [
            // Depth bias fights acne — a surface shadowing itself — and too much of it detaches a
            // shadow from the object that threw it. That trade is what this pair of sliders is for.
            slider(
              "Depth bias",
              { min: 0, max: 0.001, step: 0.00002, format: exponential },
              { value: SHADOWS.bias, change: writes("bias") },
            ),
            // PCF only: ESM ignores it, and CSM has no normal offset at all.
            slider(
              "Normal bias",
              { min: 0, max: 0.1, step: 0.002, format: exponential },
              { value: SHADOWS.normalBias, change: writes("normalBias") },
            ),
          ],
        },
        {
          label: "Cascades",
          collapsed: true,
          controls: [
            // CSM only, and Lite clamps the count to four. On PCF and ESM these two do nothing,
            // which is why they are a group of their own rather than two more rows above.
            slider("Count", { min: 1, max: 4, step: 1 }, { value: SHADOWS.cascades, change: writes("cascades") }),
            slider(
              "Shadow distance",
              { min: 0, max: 120, step: 5, format: metresOrDefault },
              { value: SHADOWS.maxDistance, change: writes("maxDistance") },
            ),
          ],
        },
        {
          label: "Scene",
          collapsed: true,
          controls: [
            slider("Turn", { min: 0, max: 90, step: 2, format: degreesPerSecond }, bind(turntable, "speed")),
            slider("Light height", { min: 3, max: 14, step: 0.5 }, { value: SUN.at.y, change: raise }),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Casting", (): string => (sun.isCastingShadows ? "yes" : "no")),
            readout("Generators built", (): string => String(rebuild.rebuilds)),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
