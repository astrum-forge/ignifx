/**
 * The stage the four subjects stand on, and where each of them stands.
 *
 * @remarks
 * Split out of `main.ts` for the reason `pbr-model/shot.ts` is: a lamp intensity and a lane position
 * are numbers found by looking at rendered candidates, and none of them is a lesson about vertex
 * animation. What is left in `main.ts` is the four shader loads, the materials built from them, the
 * phase that keeps a stopped clock honest, and the panel.
 */

import { createMaterialAsset, Environment, MeshAsset, MeshRenderer, pbrMaterialDefinition } from "ignifx";
import { createBackdrop, createStudioFloor, createStudioRig } from "../_kit/stage.ts";
import { createFlagMesh, createGrassMesh } from "./meshes.ts";
import type { App, AssetHandle, ColorLike, MaterialAsset } from "ignifx";

/** Where the four subjects stand, in metres along X. */
export const LANE = { flag: -1.32, jelly: -0.3, grass: 0.5, sphere: 1.35 } as const;

/**
 * The phase written into every animated shader under `?static=1`, in seconds.
 *
 * @remarks
 * Any non-zero value would do; this one was chosen because it catches the flag mid-swing rather
 * than at either end of its travel, which is the pose that reads as cloth in a still image.
 */
export const STATIC_PHASE = 1.7;

/** The near-black the frame is cleared to. */
export const CLEAR_COLOR: ColorLike = { r: 0.012, g: 0.015, b: 0.022, a: 1 };

/** The wind the example opens on. */
export const WIND = { strength: 0.24, frequency: 2.4 } as const;

/** The opening shot. */
export const SHOT = {
  fov: 36,
  yaw: 12,
  pitch: 14,
  distance: 3.9,
  target: { x: 0, y: 0.42, z: 0 },
} as const;

/** The materials {@link placeSubjects} hangs on the four meshes. */
export interface SubjectMaterials {
  /** The flag's `"shader"` material. */
  readonly flag: AssetHandle<MaterialAsset> | null;
  /** The jelly cube's `"shader"` material. */
  readonly jelly: AssetHandle<MaterialAsset> | null;
  /** The grass tuft's `"shader"` material. */
  readonly grass: AssetHandle<MaterialAsset> | null;
  /** The sphere's PBR material, with `bulge.surface.wgsl` layered onto it. */
  readonly sphere: AssetHandle<MaterialAsset>;
}

/**
 * Builds the lighting, the floor and the backdrop, and the metal pole the flag hangs from.
 *
 * @param app - The app the entities and the assets belong to.
 * @returns Nothing; the entities are the world's.
 */
export async function createStage(app: App): Promise<void> {
  createStudioRig(app, { focus: { x: 0.6, y: 0.4, z: 0 }, keyIntensity: 2.9, rimIntensity: 0.8 });
  createStudioFloor(app, { size: 20, color: CLEAR_COLOR });
  await createBackdrop(app, { diameter: 18 });
  const sky = app.world.createEntity("Environment").addComponent(Environment, { clearColor: CLEAR_COLOR });
  sky.imageProcessing.toneMapping = "aces";

  const pole = app.world.createEntity("Pole");
  pole.transform.localPosition.set(LANE.flag, 0.56, 0);
  pole.addComponent(MeshRenderer, {
    mesh: MeshAsset.cylinder(app, { diameter: 0.028, height: 1.12 }),
    materials: [
      createMaterialAsset(
        app,
        pbrMaterialDefinition({
          name: "vertex-animation/pole",
          baseColor: { r: 0.5, g: 0.52, b: 0.56, a: 1 },
          metallic: 0.8,
          roughness: 0.32,
        }),
        [],
      ),
    ],
    castShadows: true,
  });
}

/**
 * Places the flag, the jelly cube, the grass tuft and the bulged sphere.
 *
 * @remarks
 * The three animated subjects declare `castShadows: false` on purpose and not by omission: Babylon
 * Lite gives a `"shader"` material no shadow bindings, so the caster pass would draw the mesh at its
 * **undeformed** rest pose — a flat rectangle where the flag's shadow should be. The sphere, whose
 * displacement happens inside the engine's own PBR vertex stage, casts and receives normally.
 *
 * @param app - The app the entities and the assets belong to.
 * @param materials - The four materials, already built.
 * @param random - The kit's seeded generator, so the same seed grows the same tuft.
 */
export function placeSubjects(app: App, materials: SubjectMaterials, random: () => number): void {
  const flag = app.world.createEntity("Flag");
  flag.transform.localPosition.set(LANE.flag, 0.42, 0);
  flag.addComponent(MeshRenderer, {
    mesh: createFlagMesh(app, 0.95, 0.6, 28, 8),
    materials: [materials.flag],
    castShadows: false,
    receiveShadows: false,
  });

  const jelly = app.world.createEntity("Jelly");
  jelly.transform.localPosition.set(LANE.jelly, 0.3, 0);
  jelly.addComponent(MeshRenderer, {
    mesh: MeshAsset.box(app, { size: 0.5 }),
    materials: [materials.jelly],
    castShadows: false,
    receiveShadows: false,
  });

  const grass = app.world.createEntity("Grass");
  grass.transform.localPosition.set(LANE.grass, 0, 0);
  grass.addComponent(MeshRenderer, {
    mesh: createGrassMesh(app, 44, 0.3, random),
    materials: [materials.grass],
    castShadows: false,
    receiveShadows: false,
  });

  const sphere = app.world.createEntity("Bulged sphere");
  sphere.transform.localPosition.set(LANE.sphere, 0.42, 0);
  sphere.addComponent(MeshRenderer, {
    mesh: MeshAsset.sphere(app, { diameter: 0.72, segments: 48 }),
    materials: [materials.sphere],
    castShadows: true,
    receiveShadows: true,
  });
}
