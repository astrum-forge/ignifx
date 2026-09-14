import {
  Camera,
  createMaterialAsset,
  pbrMaterialDefinition,
  SHADER_ASSET_TYPE,
  shaderMaterialDefinition,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { readout, slider, toggle } from "../_kit/panel.ts";
import { CLEAR_COLOR, createStage, placeSubjects, SHOT, STATIC_PHASE, WIND } from "./stage.ts";
import type { AssetHandle, MaterialAsset, ShaderAsset } from "ignifx";

/**
 * The two routes to vertex motion, side by side, and what each one keeps.
 *
 * ## A `"shader"` material owns its vertex stage
 *
 * The flag, the jelly cube and the grass are full custom materials. Their `mainVertex` reads
 * `shaderUniforms.time` — ignifx's clock, because Babylon Lite ships none — and moves the vertex
 * wherever it likes. Nothing is animated on the CPU: there is no script, no skeleton and no
 * per-frame work in this file at all. What they give up is the engine's shading: they light
 * themselves from `mainLightDirection`, `mainLightColor` and `ambientColor`, and they cast no
 * shadow, because Lite hands a custom material no shadow bindings.
 *
 * ## A surface shader's `displace` hook cannot read the clock
 *
 * The sphere on the right is an ordinary PBR material with `bulge.surface.wgsl` layered onto it. It
 * is lit, shadow-casting, probe-lit and tone-mapped like any other PBR surface, and its shape is
 * changed before any of that happens. But **`displace` may not read a uniform, a texture or
 * `time`**: Babylon Lite declares a plugin's uniforms and samplers with fragment-stage visibility
 * only and gives a plugin no vertex helper-function channel, so `@ignifx/core` inlines the body into
 * Lite's own vertex entry point and refuses one that reaches for either (`IGX-0723`). The bulge is
 * therefore a fixed function of the vertex's own position, and wind needs the other route.
 *
 * ## Why the frame is still moving when the clock is stopped
 *
 * `?static=1` stops the clock before `app.start()`, so `shaderUniforms.time` reads `0` and every
 * wave would be caught at its rest pose — a flat flag. Each animated shader therefore declares a
 * `phase` uniform that is simply added to `time`, and `setup` writes a fixed non-zero phase into it
 * when the flag is set. The poster and the golden are a real pose, and the same one every time.
 *
 * `stage.ts` beside this file holds the lighting and the placements; `meshes.ts` builds the flag's
 * grid and the grass tuft with `MeshAsset.fromData`, and documents the UV contract the two shaders
 * depend on.
 */

/** The four `.wgsl` files, in the order the materials below are built. */
const ADDRESSES = [
  "shaders/vertex-animation/flag.wgsl",
  "shaders/vertex-animation/jelly.wgsl",
  "shaders/vertex-animation/grass.wgsl",
  "shaders/vertex-animation/bulge.surface.wgsl",
];

/**
 * Writes a slider's value with two decimals.
 *
 * @param value - The value.
 * @returns The text for the value cell.
 */
function twoPlaces(value: number): string {
  return value.toFixed(2);
}

bootExample({
  title: "Vertex animation",
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      msaaSamples: 4,
      // `materialPlugins` is what the sphere's `displace` hook needs; `shadows` proves it still
      // casts one. Both are read once, when `app.start()` registers the scene.
      features: { shadows: true, materialPlugins: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel, random, flags }) {
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.03, far: 120, fov: SHOT.fov });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 1.4,
      maxDistance: 12,
    });
    await createStage(app);

    // Every shader is loaded and awaited before `app.start()`: a completed load settles at once, and
    // a material cannot be built from a shader that has not decoded (IGX-0501).
    const shaders = ADDRESSES.map((address) => app.assets.load<ShaderAsset>(address, { type: SHADER_ASSET_TYPE }));
    await Promise.all(shaders.map((handle) => handle.promise));

    const phase = flags.isStatic ? STATIC_PHASE : 0;
    /**
     * Builds one `"shader"` material from a loaded file, with the phase already applied.
     *
     * @param index - Which of {@link ADDRESSES} it is.
     * @param values - The uniforms this material opens on, beside the file's own defaults.
     * @returns The handle, or `null` when the shader did not load.
     */
    const animate = (index: number, values: Record<string, number>): AssetHandle<MaterialAsset> | null => {
      const shader = shaders[index];
      return shader === undefined
        ? null
        : createMaterialAsset(app, shaderMaterialDefinition({ shader, values: { ...values, phase } }), []);
    };
    const flag = animate(0, { wind: WIND.strength, frequency: 5 });
    const jelly = animate(1, { wobble: 0.18, frequency: WIND.frequency });
    const grass = animate(2, { wind: WIND.strength, frequency: WIND.frequency });

    // The PBR route: an ordinary material declaration with one `.surface.wgsl` in its `surfaces`
    // list, written exactly as a `.material.json` writes it. Everything the engine does to a PBR
    // surface still happens; the hook only moves the vertex first.
    const sphere = createMaterialAsset(
      app,
      pbrMaterialDefinition({
        name: "vertex-animation/bulged",
        baseColor: { r: 0.78, g: 0.46, b: 0.3, a: 1 },
        metallic: 0.1,
        roughness: 0.42,
        surfaces: [
          {
            shader: "shaders/vertex-animation/bulge.surface.wgsl",
            name: "bulge",
            values: {},
            textures: {},
            enabled: true,
            priority: 500,
          },
        ],
      }),
      [],
    );
    placeSubjects(app, { flag, jelly, grass, sphere }, random);
    const [bulge] = sphere.value.surfaces;

    panel({
      title: "Vertex animation",
      groups: [
        {
          label: "Wind",
          controls: [
            slider(
              "Strength",
              { min: 0, max: 0.6, step: 0.01, format: twoPlaces },
              {
                value: WIND.strength,
                change: (value: number): void => {
                  // `setUniform` re-uploads the material's own uniform block and recompiles nothing,
                  // which is what makes a slider cheap enough to drag.
                  flag?.value.setUniform("wind", value);
                  grass?.value.setUniform("wind", value);
                  jelly?.value.setUniform("wobble", value * 0.75);
                },
              },
            ),
            slider(
              "Frequency",
              { min: 0.2, max: 6, step: 0.1, format: twoPlaces },
              {
                value: WIND.frequency,
                change: (value: number): void => {
                  grass?.value.setUniform("frequency", value);
                  jelly?.value.setUniform("frequency", value);
                  flag?.value.setUniform("frequency", value * 2);
                },
              },
            ),
            readout("Shader clock", (): string => (flags.isStatic ? `stopped, phase ${twoPlaces(phase)}` : "running")),
          ],
        },
        {
          label: "Surface displace",
          controls: [
            toggle("Bulge the sphere", {
              value: true,
              change: (on: boolean): void => {
                // Toggling a surface shader changes Lite's pipeline cache key and rebuilds the
                // material's renderables — a settings operation, not a per-frame one.
                if (bulge !== undefined) {
                  bulge.enabled = on;
                }
              },
            }),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
