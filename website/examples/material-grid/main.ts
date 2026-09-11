import { Camera, createMaterialAsset, Environment, MeshAsset, MeshRenderer, pbrMaterialDefinition } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, color, readout, slider } from "../_kit/panel.ts";
import { createLightRig, loadEnvironment } from "../_kit/stage.ts";
import type { PanelSliderControl } from "../_kit/panel.ts";
import type { AssetHandle, ColorLike, MaterialAsset } from "ignifx";

/** Which end of which axis a slider writes. */
type RangeEnd = "metalHigh" | "metalLow" | "roughHigh" | "roughLow";

/**
 * Compare metalness across columns and roughness across rows using shared geometry.
 * Metal base colour tints reflections; dielectric base colour controls diffuse colour.
 * The environment supplies reflections, while the panel updates material uniforms live.
 */

/** How many columns of metalness, and rows of roughness. Thirty-six materials, one mesh. */
const GRID = 6;

/** Each sphere's diameter, in metres. */
const SPHERE_DIAMETER = 0.5;

/** Segments per sphere. Enough that a mirror surface shows no facet at the size the grid is seen. */
const SPHERE_SEGMENTS = 24;

/** Centre-to-centre spacing, in metres: a tenth of a diameter of air between neighbours. */
const SPACING = 0.55;

/** The base colour every material starts with: a neutral light grey, so metal and plastic differ only by their two numbers. */
const START_COLOR = "#c8cad2";

/**
 * The ground the grid is seen against: the site's own `--surface`, `#14181F`, **as it renders**.
 *
 * @remarks
 * Not black, and the reason is the right-hand column. A smooth metal shows nothing but its
 * surroundings, and the probe here is a dim softbox room, so the metals are the darkest things in
 * the frame — against black they lost their silhouettes and the column read as a few white
 * highlights floating in the void. Against `--surface` the darkest sphere is still darker than the
 * ground behind it, so its outline survives, which is what a grid whose whole job is comparison
 * needs.
 *
 * The numbers look three times too bright for `#14181F`, and that is deliberate: the clear colour
 * is **decoded from sRGB and presented without being re-encoded**, so what reaches the frame is
 * `srgbToLinear(value)`. Measured against this scene at 1280x720 rather than derived — `0.078,
 * 0.094, 0.122` rendered as bytes `2, 2, 4` (2026-09-08), which is `srgbToLinear` to within a
 * rounding step — so the values below are the inverse: `linearToSrgb(0x14 / 255)` and its two
 * siblings, which render as exactly `20, 24, 31`. It is the same trap
 * `_tools/make-backdrop-texture.ts` documents from the other direction, and it is why the hero
 * paints its backdrop into a texture instead.
 */
const CLEAR_COLOR = { r: 0.3103, g: 0.3391, b: 0.3835, a: 1 };

/**
 * The probe's exposure.
 *
 * @remarks
 * Chosen from three rendered candidates rather than guessed. At 0.9 the metal column was almost
 * unlit — honest, since a metal shows only what is around it and this probe is a dim grey room,
 * but it hid the roughness ramp the column exists to show. At 1.8 the dielectric rows above
 * roughness 0.6 washed into one flat white and *their* ramp went instead. At 1.25 both ramps read:
 * in the committed poster the grid's own 500 by 480 pixels mean 110 of 255, the brightest plastic
 * sits at 185 and the darkest metal at 30, against a ground of 20.
 */
const EXPOSURE = 1.25;

/**
 * Reads an `#rrggbb` string as an ignifx colour.
 *
 * @remarks
 * Every colour in the engine's public API is sRGB in `0…1`
 * (`references/formats/material.md`), and an `<input type="color">` reports sRGB in `0…255`.
 *
 * @param hex - The colour, as `#rrggbb`.
 * @returns The colour, opaque.
 */
function fromHex(hex: string): ColorLike {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
    a: 1,
  };
}

/**
 * Interpolates one axis of the grid.
 *
 * @param low - The value in the first row or column.
 * @param high - The value in the last one.
 * @param index - Which row or column, from `0` to `GRID - 1`.
 * @returns The value for that row or column.
 */
function ramp(low: number, high: number, index: number): number {
  return low + ((high - low) * index) / (GRID - 1);
}

bootExample({
  title: "Roughness and metalness",
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      msaaSamples: 4,
      // No `shadows`: the grid has no floor to cast onto, and a shadow would only obscure the one
      // thing being compared. The features record is read once, at `createApp`.
      features: {},
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.05, far: 100, fov: 40 });
    // Yaw and pitch at zero: the grid is a flat wall in the XY plane and the opening shot is
    // straight at it, which is the only view in which every square is comparable. Orbiting away is
    // how the specular is read — a reflection that does not move with the eye is not a reflection.
    const orbit = attachOrbit(app, eye, { yaw: 0, pitch: 0, minDistance: 1.5, maxDistance: 14 });
    orbit.frame({ center: { x: 0, y: 0, z: 0 }, radius: (SPACING * GRID) / 2 }, 1.1);

    // Three lamps at low intensity, and no shadows. The probe does most of the lighting; the lamps
    // are what put a recognisable highlight on the rough dielectrics, which the probe alone leaves
    // flat.
    createLightRig(app, {
      shadows: false,
      keyIntensity: 1.4,
      fillIntensity: 0.25,
      rimIntensity: 0.6,
      focus: { x: 0, y: 0, z: 0 },
    });

    const environment = loadEnvironment(app, "studio");
    await environment.promise;
    const sky = app.world
      .createEntity("Environment")
      // `skybox` is decided when the `.env` loads, not here: `studio.environment.json` declares
      // `skyboxEnabled: false`, so the component is told the same thing rather than left at its
      // default and reported as `IGX-0711`. The background is the clear colour.
      .addComponent(Environment, { environment, clearColor: CLEAR_COLOR, skybox: { enabled: false, size: 20 } });
    sky.imageProcessing.toneMapping = "aces";
    sky.imageProcessing.exposure = EXPOSURE;

    // One mesh for all thirty-six spheres: a `MeshAsset` is an asset, so assigning the same handle
    // to every renderer shares the geometry rather than copying it.
    const sphere = MeshAsset.sphere(app, { diameter: SPHERE_DIAMETER, segments: SPHERE_SEGMENTS });

    /** Every material, in row-major order: `materials[row * GRID + column]`. */
    const materials: AssetHandle<MaterialAsset>[] = [];
    const offset = (SPACING * (GRID - 1)) / 2;
    for (let row = 0; row < GRID; row += 1) {
      for (let column = 0; column < GRID; column += 1) {
        const material = createMaterialAsset(
          app,
          pbrMaterialDefinition({
            name: `grid/${String(row)}-${String(column)}`,
            baseColor: fromHex(START_COLOR),
            metallic: ramp(0, 1, column),
            roughness: ramp(0, 1, row),
          }),
          [],
        );
        materials.push(material);
        const entity = app.world.createEntity(`Sphere ${String(row)}-${String(column)}`);
        entity.transform.localPosition.set(column * SPACING - offset, row * SPACING - offset, 0);
        entity.addComponent(MeshRenderer, { mesh: sphere, materials: [material], castShadows: false });
      }
    }

    /** The live ranges the four sliders write, and the colour the swatch writes. */
    const ranges = { metalLow: 0, metalHigh: 1, roughLow: 0, roughHigh: 1, base: fromHex(START_COLOR) };

    /**
     * Rewrites every material from {@link ranges}.
     *
     * @remarks
     * Thirty-six `setMetallicRoughness` calls on a slider drag, which sounds like a lot and is not:
     * both are uniforms on an already-compiled pipeline, so the cost is thirty-six writes and no
     * shader work at all. A change that *did* need a recompile — an alpha mode, a texture slot —
     * would be a different material rather than a different number.
     */
    const apply = (): void => {
      for (let row = 0; row < GRID; row += 1) {
        for (let column = 0; column < GRID; column += 1) {
          const material = materials[row * GRID + column]?.value;
          if (material === undefined) {
            continue;
          }
          material.setMetallicRoughness(
            ramp(ranges.metalLow, ranges.metalHigh, column),
            ramp(ranges.roughLow, ranges.roughHigh, row),
          );
          material.setBaseColor(ranges.base);
        }
      }
    };

    /**
     * One end of one axis, as a slider.
     *
     * @param label - Which row or column it moves.
     * @param key - The field of {@link ranges} it writes.
     * @returns The control.
     */
    const end = (label: string, key: RangeEnd): PanelSliderControl =>
      slider(
        label,
        { min: 0, max: 1, step: 0.01 },
        {
          value: ranges[key],
          change: (value: number): void => {
            ranges[key] = value;
            apply();
          },
        },
      );

    panel({
      title: "Roughness and metalness",
      groups: [
        {
          label: "Metalness, left to right",
          controls: [end("Left column", "metalLow"), end("Right column", "metalHigh")],
        },
        {
          label: "Roughness, bottom to top",
          controls: [end("Bottom row", "roughLow"), end("Top row", "roughHigh")],
        },
        {
          label: "Surface",
          controls: [
            color("Base colour", {
              value: START_COLOR,
              change: (hex: string): void => {
                ranges.base = fromHex(hex);
                apply();
              },
            }),
            // Rotating the probe moves every reflection at once, and blurring it is what separates
            // a mirror from a satin. Neither touches a material: both are the environment.
            slider("Probe rotation", { min: 0, max: 360, step: 1 }, bind(sky, "rotation")),
            slider("Probe blur", { min: 0, max: 1, step: 0.02 }, bind(sky, "blur")),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            readout("Materials", (): string => String(materials.length)),
          ],
        },
      ],
    });
  },
});
