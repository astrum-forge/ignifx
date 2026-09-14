import {
  Camera,
  createMaterialAsset,
  Environment,
  MeshAsset,
  MeshRenderer,
  SHADER_ASSET_TYPE,
  shaderMaterialDefinition,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { readout, select, slider } from "../_kit/panel.ts";
import { createBackdrop, createStudioFloor, createStudioRig } from "../_kit/stage.ts";
import { BACKDROP_DIAMETER, CLEAR_COLOR, FLOOR_SIZE, SHADERS, SHOT, START_SHADER, SUBJECT } from "./shot.ts";
import type { ShaderRow } from "./shot.ts";
import type { PanelGroup } from "../_kit/panel.ts";
import type { AssetHandle, MaterialAsset, ShaderAsset } from "ignifx";

/**
 * Four hand-written WGSL materials on one sphere.
 *
 * ## The file is the declaration
 *
 * There is no material JSON describing these shaders and no `uniforms: [...]` array in this file.
 * Each `.wgsl` declares itself with `// @ignifx` comment pragmas — the vertex attributes it reads,
 * the engine values it wants (`world`, `viewProjection`, `cameraPosition` from Babylon Lite;
 * `time`, `mainLightDirection`, `mainLightColor`, `ambientColor` from ignifx), its own uniforms with
 * a type, a default, a range, a step and a tooltip, and the blend and cull state it draws with. The
 * file stays valid WGSL for every other tool, and **`@ignifx/vite-plugin` parses and checks it at
 * build time**: a name the file reads but never declares, a binding written by hand, a
 * `textureSample` in a vertex path, a missing entry point — each is a build failure with the line it
 * is on, rather than a black sphere and a browser diagnostic about generated code nobody wrote.
 *
 * So loading one is `assets.load(address, { type: SHADER_ASSET_TYPE })`, building a material from
 * it is `shaderMaterialDefinition({ shader })`, and setting a value is `setUniform(name, value)` —
 * checked against the declaration, so a typo throws at the call site instead of drawing nothing.
 *
 * ## What you give up
 *
 * Everything the engine's PBR material does for free. Babylon Lite hands a custom material its
 * transforms, the camera position, the screen size and nothing else — no lights, **no shadows**, no
 * image-based lighting, no fog. `toon` and `dissolve` light themselves from ignifx's own
 * `mainLightDirection`, which is one directional light and no shadow map. When a look only needs to
 * change the engine's shading rather than replace it, the answer is a surface shader
 * (`/examples/surface-shaders/`), which keeps all of it.
 *
 * `shot.ts` beside this file holds the stage and the panel's uniform table.
 */

/**
 * Builds the value formatter a row asks for.
 *
 * @param places - How many decimals to show.
 * @returns The formatter.
 */
function decimals(places: number): (value: number) => string {
  return (value: number): string => value.toFixed(places);
}

bootExample({
  title: "Custom shader",
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      msaaSamples: 4,
      features: { shadows: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.05, far: 200, fov: SHOT.fov });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 1.4,
      maxDistance: 9,
    });

    createStudioRig(app, { focus: SHOT.target, keyIntensity: 2.4, rimIntensity: 0.9 });
    createStudioFloor(app, { size: FLOOR_SIZE, color: CLEAR_COLOR });
    await createBackdrop(app, { diameter: BACKDROP_DIAMETER });

    const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: CLEAR_COLOR });
    sky.imageProcessing.toneMapping = "aces";
    sky.imageProcessing.exposure = SHOT.exposure;

    // Every shader is loaded and every material built **before** `app.start()`: a load that
    // completes before the loop runs settles at once, and a material is *values applied to a
    // shader*, so the shader has to be loaded before the material can be built from it (IGX-0501
    // otherwise). Four materials rather than one, so the select is an assignment and not a rebuild.
    const shaders = SHADERS.map((row: ShaderRow) =>
      app.assets.load<ShaderAsset>(row.address, { type: SHADER_ASSET_TYPE }),
    );
    await Promise.all(shaders.map((handle) => handle.promise));

    const materials = new Map<string, AssetHandle<MaterialAsset>>();
    for (let index = 0; index < SHADERS.length; index += 1) {
      const row = SHADERS[index];
      const shader = shaders[index];
      if (row === undefined || shader === undefined) {
        continue;
      }
      // The file's declared defaults apply on their own; `values` here only names the ones this
      // example wants to open on something other than the file's default.
      const values: Record<string, number> = {};
      for (const uniform of row.uniforms) {
        values[uniform.name] = uniform.value;
      }
      materials.set(row.label, createMaterialAsset(app, shaderMaterialDefinition({ shader, values }), []));
    }

    const subject = app.world.createEntity("Subject");
    subject.transform.localPosition.set(0, SUBJECT.height, 0);
    const renderer = subject.addComponent(MeshRenderer, {
      mesh: MeshAsset.sphere(app, { diameter: SUBJECT.diameter, segments: SUBJECT.segments }),
      materials: [materials.get(START_SHADER) ?? null],
      // A custom shader material casts no shadow worth having: Lite gives it no shadow bindings, so
      // the caster pass would draw the mesh's silhouette with this shader's own colour.
      castShadows: false,
      receiveShadows: false,
    });

    // One group per shader, so every slider is bound to the material it belongs to whether or not
    // that material is the one on the mesh. `setUniform` re-uploads the material's own uniform
    // block and recompiles nothing, which is what makes a slider cheap enough to drag.
    const groups: PanelGroup[] = SHADERS.map((row: ShaderRow) => ({
      label: row.label,
      collapsed: row.label !== START_SHADER,
      controls: row.uniforms.map((uniform) => {
        const material = materials.get(row.label);
        return slider(
          uniform.label,
          { min: uniform.min, max: uniform.max, step: uniform.step, format: decimals(uniform.places) },
          {
            value: uniform.value,
            change: (value: number): void => {
              material?.value.setUniform(uniform.name, value);
            },
          },
        );
      }),
    }));

    panel({
      title: "Custom shader",
      groups: [
        {
          label: "Shader",
          controls: [
            select(
              "Material",
              SHADERS.map((row: ShaderRow) => row.label),
              {
                value: START_SHADER,
                change: (label: string): void => {
                  // Swapping a material is one assignment. The two transparent shaders declare
                  // `depthWrite off` in their own files, so nothing here has to know which is which.
                  renderer.materials = [materials.get(label) ?? null];
                },
              },
            ),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
        ...groups,
      ],
    });
  },
});
