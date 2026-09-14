import {
  Camera,
  createMaterialAsset,
  Environment,
  InstancedMeshRenderer,
  MeshAsset,
  pbrMaterialDefinition,
} from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { readout, slider, toggle } from "../_kit/panel.ts";
import { createLightRig } from "../_kit/stage.ts";
import { BELT, CAPACITY, CLEAR_COLOR, layOutBelt, LOD, MESH, SHOT } from "./belt.ts";
import type { AssetHandle, MaterialAsset, MeshAsset as MeshAssetType } from "ignifx";

/**
 * Twenty thousand asteroids, one draw call.
 *
 * ## The slab is yours
 *
 * `setMatrices` hands Babylon Lite a **reference** to this file's `Float32Array` — Lite never
 * copies it. That is the whole point: a foliage scatterer or a particle system writes into its own
 * memory and tells the renderer the range moved, and nothing allocates in between. The price is
 * that the array has to stay alive and stay at least `count * 16` floats long. Sixteen floats per
 * instance, column-major, the layout `Transform.worldMatrix` already uses.
 *
 * Drawing fewer of them is `setCount`, which changes the number without re-uploading anything;
 * moving them is a write into the slab followed by `markDirty()`.
 *
 * ## Three settings Lite fixes when the scene is registered
 *
 * `capacity` sizes the instance buffer once, and `gpuCulling` and the LOD partner's identity only
 * reach the GPU through the renderable `app.start()` compiles. Change one afterwards and the
 * component **refuses it**: it logs `IGX-0717` once and writes the applied value back onto the
 * field, so what the component reports is always what is being drawn. The GPU-culling and LOD
 * toggles below therefore build a **new** `InstancedMeshRenderer` rather than editing the live one,
 * which is exactly what a graphics-settings screen has to do. `distance` and `band` are not in that
 * set — Lite re-applies those live, so the LOD slider is an ordinary assignment.
 *
 * `belt.ts` beside this file lays the ring out and writes the matrices.
 */

/**
 * Writes a metre count.
 *
 * @param value - The value, in metres.
 * @returns The text for the value cell.
 */
function metres(value: number): string {
  return `${value.toFixed(0)} m`;
}

/**
 * Writes an instance count with thousands separators.
 *
 * @param value - The count.
 * @returns The text for the value cell.
 */
function thousands(value: number): string {
  return Math.round(value).toLocaleString("en-GB");
}

bootExample({
  title: "Instancing",
  settings: {
    rendering: { clearColor: CLEAR_COLOR, msaaSamples: 4, features: { shadows: false } },
    time: { fixedDeltaTime: 1 / 60 },
  },

  setup({ app, panel, random, flags }) {
    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.5, far: 600, fov: SHOT.fov });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 6,
      maxDistance: 320,
    });

    // One sun and a cool bounce: the rocks are lit, not shadowed. Shadows are off in `settings`
    // because a 20,000-instance caster pass is a different lesson, and a directional shadow map
    // fitted around a 110-metre belt would be a blur at any resolution worth paying for.
    createLightRig(app, {
      focus: SHOT.target,
      keyPosition: { x: -60, y: 34, z: -40 },
      keyIntensity: 5.2,
      fillIntensity: 0.7,
      fillColor: { r: 0.42, g: 0.55, b: 0.9, a: 1 },
      rimIntensity: 1.6,
      rimPosition: { x: 52, y: 12, z: 46 },
      shadows: false,
    });
    const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: CLEAR_COLOR });
    sky.imageProcessing.toneMapping = "aces";

    const rock: AssetHandle<MaterialAsset> = createMaterialAsset(
      app,
      pbrMaterialDefinition({
        name: "instancing/rock",
        baseColor: { r: 0.55, g: 0.51, b: 0.46, a: 1 },
        metallic: 0,
        roughness: 0.95,
      }),
      [],
    );
    const near: AssetHandle<MeshAssetType> = MeshAsset.sphere(app, {
      diameter: MESH.diameter,
      segments: MESH.segments,
    });
    const far: AssetHandle<MeshAssetType> = MeshAsset.sphere(app, {
      diameter: MESH.diameter,
      segments: MESH.lodSegments,
    });

    // Allocated once, filled once, and handed to Lite by reference for the life of the page.
    const slab = new Float32Array(CAPACITY * 16);
    layOutBelt(slab, CAPACITY, random);

    const belt = app.world.createEntity("Asteroid belt");
    // The frame-time probe needs 420 rendered frames, which SwiftShader cannot rasterise at 20,000
    // instances in its time limit. The engine's per-frame cost is the same for any count once the
    // slab is static, so a benchmark draws a tenth of the belt.
    let drawn = flags.isBench ? CAPACITY / 10 : CAPACITY;
    let gpuCulling = true;
    let useLod = true;
    let renderer = build();

    /**
     * Creates the renderer the two baked settings currently describe, replacing any earlier one.
     *
     * @returns The live component.
     */
    function build(): InstancedMeshRenderer {
      belt.getComponent(InstancedMeshRenderer)?.destroy();
      const created = belt.addComponent(InstancedMeshRenderer, {
        mesh: near.retain(),
        materials: [rock.retain()],
        capacity: CAPACITY,
        gpuCulling,
        castShadows: false,
        receiveShadows: false,
        lod: useLod ? { mesh: far.retain(), distance: LOD.distance, band: LOD.band } : null,
      });
      created.setMatrices(slab, drawn);
      return created;
    }

    panel({
      title: "Instancing",
      groups: [
        {
          label: "Belt",
          controls: [
            slider(
              "Drawn",
              { min: 0, max: CAPACITY, step: 100, format: thousands },
              {
                value: drawn,
                change: (value: number): void => {
                  // No re-upload: the slab is unchanged and only the active range moves.
                  drawn = Math.round(value);
                  renderer.setCount(drawn);
                },
              },
            ),
            readout("Instances", (): string => thousands(renderer.count)),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
        {
          label: "Culling and detail",
          controls: [
            toggle("GPU culling", {
              value: gpuCulling,
              change: (on: boolean): void => {
                gpuCulling = on;
                renderer = build();
              },
            }),
            toggle("LOD partner", {
              value: useLod,
              change: (on: boolean): void => {
                useLod = on;
                renderer = build();
              },
            }),
            slider(
              "LOD distance",
              { min: 8, max: 160, step: 2, format: metres },
              {
                value: LOD.distance,
                change: (value: number): void => {
                  // Live: Lite's own declaration says the pairing's distance and band "may be re-set
                  // by calling again with the same pair", so this is reconciled like any other field.
                  const lod = renderer.lod;
                  if (lod !== null) {
                    lod.distance = value;
                  }
                },
              },
            ),
            readout("Belt radius", (): string => metres(BELT.radius)),
          ],
        },
      ],
    });
  },
});
