import {
  Camera,
  createMaterialAsset,
  Environment,
  MODEL_ASSET_TYPE,
  Model,
  pbrMaterialDefinition,
  SHADER_ASSET_TYPE,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { button, readout, slider, toggle } from "../_kit/panel.ts";
import { createBackdrop, createStudioFloor, createStudioRig, loadEnvironment } from "../_kit/stage.ts";
import { HitFlash } from "./flash.ts";
import {
  BACKDROP_DIAMETER,
  CLEAR_COLOR,
  CORSET,
  FLASH_SECONDS,
  FLOOR_SIZE,
  HULL,
  SHIP,
  SHIP_MATERIAL,
  SHOT,
  SURFACES,
} from "./shot.ts";
import type { SurfaceRow } from "./shot.ts";
import type { PanelControl, PanelGroup } from "../_kit/panel.ts";
import type { ModelAsset, ShaderAsset, SurfaceShaderBinding, SurfaceShaderReference } from "ignifx";

/**
 * Four custom looks on one hull, with the engine's own lighting untouched.
 *
 * ## What a surface shader is
 *
 * A `"shader"` material is *everything*: you own the vertex stage, the fragment stage and the
 * lighting, and Babylon Lite hands a custom material no light or shadow bindings at all
 * (`/examples/custom-shader/`). A **surface shader** is the other half — Unity's `surf()`, Godot's
 * `fragment()`. Three named hooks are compiled into the engine's own PBR shader, so a custom look
 * keeps direct lighting, shadows, image-based lighting, fog and tone mapping without the author
 * writing a line of any of it:
 *
 * | Hook        | Where it runs                        | What it can do                              |
 * | ----------- | ------------------------------------ | ------------------------------------------- |
 * | `displace`  | the vertex stage, inlined            | move the vertex — and nothing else, see below |
 * | `surface`   | before lighting                      | edit `baseColor`, `alpha`, `emissive`, `normal` |
 * | `composite` | after lighting                       | add to the lit colour                       |
 *
 * The two `surface` hooks here edit what the lighting is computed *from*, so snow is shaded by the
 * key light and shadowed by the shadow map like any other paint. The two `composite` hooks add to
 * the result, which is why the rim light survives shadow — a rim in shadow is exactly what a rim
 * light is for. The Corset on the right wears none of them: same probe, same lamp, same map.
 *
 * ## The three things to know
 *
 * 1. **`rendering.features.materialPlugins` has to be declared**, because Lite installs its plugin
 *    bridges once, before the scene is registered. Without it, attaching is `IGX-0716`.
 * 2. **The host has to be a PBR material.** Lite 1.27.0 bakes a *Standard* host's plugin signature
 *    from the meshes already in the scene, which is never in time, so a Standard host is refused.
 * 3. **`displace` cannot read a uniform, a texture or the clock** — Lite declares plugin uniforms
 *    fragment-visible only. `/examples/vertex-animation/` shows what that leaves and what a full
 *    shader material does instead.
 *
 * `shot.ts` holds the composition and the panel's table; `flash.ts` is the one moving part.
 */

bootExample({
  title: "Surface shaders",
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      msaaSamples: 4,
      // `materialPlugins` is the opt-in a surface shader needs; `shadows` is what proves the hooks
      // did not cost the host its shadow map.
      features: { shadows: true, materialPlugins: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.03, far: 200, fov: SHOT.fov });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 1,
      maxDistance: 7,
    });

    createStudioRig(app, { focus: SHOT.target, shadowTechnique: "pcf", keyIntensity: 2.8, rimIntensity: 0.7 });
    createStudioFloor(app, { size: FLOOR_SIZE, color: CLEAR_COLOR });
    await createBackdrop(app, { diameter: BACKDROP_DIAMETER });

    // Every load is awaited before `app.start()`: a completed load settles at once, and a material
    // cannot be built from a shader that has not decoded (IGX-0501).
    const shaders = SURFACES.map((row: SurfaceRow) =>
      app.assets.load<ShaderAsset>(row.address, { type: SHADER_ASSET_TYPE }),
    );
    const ship = app.assets.load<ModelAsset>(SHIP.address, { type: MODEL_ASSET_TYPE });
    const corset = app.assets.load<ModelAsset>(CORSET.address, { type: MODEL_ASSET_TYPE });
    const environment = loadEnvironment(app, "studio");
    await Promise.all([...shaders.map((handle) => handle.promise), ship.promise, corset.promise, environment.promise]);

    const sky = app.world
      .createEntity("Environment")
      .addComponent(Environment, { environment, clearColor: CLEAR_COLOR });
    sky.imageProcessing.toneMapping = "aces";
    sky.imageProcessing.exposure = SHOT.exposure;
    sky.blur = SHOT.blur;

    // The `surfaces` list is part of the material declaration, exactly as it is in a
    // `.material.json`: an address, the values to open on, and where in the order it sits. Lower
    // `priority` runs first, so the two `surface` hooks are 100 and 200 and the two `composite`
    // hooks 300 and 400.
    const surfaces: SurfaceShaderReference[] = SURFACES.map((row: SurfaceRow, index: number) => ({
      shader: row.address,
      name: row.name,
      values:
        row.extra === undefined
          ? { [row.amount]: row.value }
          : { [row.amount]: row.value, [row.extra.name]: row.extra.value },
      textures: {},
      enabled: row.enabled,
      priority: (index + 1) * 100,
    }));
    const hull = createMaterialAsset(
      app,
      pbrMaterialDefinition({ name: "surface-shaders/hull", ...HULL, surfaces }),
      [],
    );
    // One binding per shader, in the order they were declared. `set` re-uploads the host's uniform
    // block; `enabled` changes Lite's pipeline cache key and rebuilds — a settings operation.
    const bindings: readonly SurfaceShaderBinding[] = hull.value.surfaces;

    const decorated = app.world.createEntity("Ship");
    decorated.transform.localPosition.set(SHIP.position.x, SHIP.position.y, SHIP.position.z);
    decorated.transform.localEulerAngles = SHIP.pose;
    // `materialOverrides` replaces one glTF material by the name it carries in the file, which is
    // how a decorated material reaches a loaded model: `Model` exposes no `MaterialAsset` of its own.
    decorated.addComponent(Model, { model: ship, materialOverrides: { [SHIP_MATERIAL]: hull }, castShadows: true });

    const control = app.world.createEntity("Corset");
    control.transform.localPosition.set(CORSET.position.x, CORSET.position.y, CORSET.position.z);
    control.transform.localScale.set(CORSET.scale, CORSET.scale, CORSET.scale);
    control.addComponent(Model, { model: corset, castShadows: true, receiveShadows: true });

    app.registerComponents([HitFlash]);
    const flash = decorated.addComponent(HitFlash, { seconds: FLASH_SECONDS });
    flash.binding = bindings[SURFACES.length - 1] ?? null;

    const groups: PanelGroup[] = SURFACES.map((row: SurfaceRow, index: number) => {
      const binding = bindings[index];
      const controls: PanelControl[] = [
        toggle(`${row.label} (${row.hook})`, {
          value: row.enabled,
          change: (on: boolean): void => {
            if (binding !== undefined) {
              binding.enabled = on;
            }
          },
        }),
      ];
      if (row.label !== "Hit flash") {
        controls.push(
          slider(
            "Amount",
            { min: 0, max: row.max, step: 0.01, format: (value: number): string => value.toFixed(2) },
            {
              value: row.value,
              change: (value: number): void => binding?.set(row.amount, value),
            },
          ),
        );
      }
      const extra = row.extra;
      if (extra !== undefined) {
        controls.push(
          slider(
            extra.label,
            { min: extra.min, max: extra.max, step: extra.step, format: (value: number): string => value.toFixed(2) },
            {
              value: extra.value,
              change: (value: number): void => binding?.set(extra.name, value),
            },
          ),
        );
      }
      return { label: row.label, collapsed: index > 1, controls };
    });

    panel({
      title: "Surface shaders",
      groups: [
        {
          label: "Hull",
          controls: [
            button("Hit the ship", (): void => {
              flash.hit();
            }),
            readout("Shaders attached", (): string => String(hull.value.surfaces.length)),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
        ...groups,
      ],
    });
  },
});
