/**
 * The scene `picking` picks in: the seven shapes, their two materials, and the material swap that
 * shows which one was hit.
 *
 * @remarks
 * A separate file for the reason `pbr-model/shot.ts` is: none of it is a lesson about picking.
 * `main.ts` is then the two pick calls, the click that triggers them and the readouts that compare
 * them, which is all a reader came for.
 *
 * Every mesh is built in code, so the example fetches nothing and the whole scene is reproducible
 * from the numbers below. Two rows rather than one, and seven shapes rather than three, because
 * the comparison only means something when a click can miss: the gaps are where both paths answer
 * `null`, and the torus has a hole a bounding box would fill and neither of these paths does.
 */

import { createMaterialAsset, MeshAsset, MeshRenderer, pbrMaterialDefinition } from "ignifx";
import type { App, AssetHandle, ColorLike, Entity } from "ignifx";

/** Where one shape stands, and which mesh it is. */
interface Shape {
  /** The entity's name, which is what the readouts show when it is hit. */
  readonly name: string;
  /** Metres along X from the scene's centre. */
  readonly x: number;
  /** How high the origin sits so the shape rests on the ground, in metres. */
  readonly y: number;
  /** Metres along Z; negative is towards the camera at a yaw of zero. */
  readonly z: number;
  /**
   * Builds the mesh.
   *
   * @param app - The app the mesh belongs to.
   * @returns The handle, with one holder — the renderer that is about to take it.
   */
  readonly mesh: (app: App) => AssetHandle<MeshAsset>;
}

/** The colour a shape is drawn in until it is picked. */
const IDLE_COLOR: ColorLike = { r: 0.42, g: 0.45, b: 0.52, a: 1 };

/** The colour the picked shape is drawn in: the site's ember, so a hit is unmistakable. */
const PICKED_COLOR: ColorLike = { r: 0.93, g: 0.42, b: 0.16, a: 1 };

/** The near-black the frame is cleared to, matching the site's dark background. */
export const CLEAR_COLOR: ColorLike = { r: 0.043, g: 0.059, b: 0.094, a: 1 };

/** The opening shot: high enough to see both rows and the gaps between them. */
export const SHOT = { fov: 42, yaw: 14, pitch: 30, distance: 5.4, target: { x: 0, y: 0.28, z: 0 } } as const;

/** The scene, in the order it is built. */
const SHAPES: readonly Shape[] = [
  { name: "Box", x: -1.85, y: 0.33, z: -1.15, mesh: (app: App) => MeshAsset.box(app, { size: 0.66 }) },
  { name: "Sphere", x: -0.62, y: 0.35, z: -1.15, mesh: (app: App) => MeshAsset.sphere(app, { diameter: 0.7 }) },
  {
    name: "Cylinder",
    x: 0.62,
    y: 0.4,
    z: -1.15,
    mesh: (app: App) => MeshAsset.cylinder(app, { height: 0.8, diameter: 0.6, tessellation: 24 }),
  },
  {
    name: "Capsule",
    x: 1.85,
    y: 0.45,
    z: -1.15,
    mesh: (app: App) => MeshAsset.capsule(app, { height: 0.9, radius: 0.22, tessellation: 16 }),
  },
  {
    name: "Torus",
    x: -1.25,
    y: 0.12,
    z: 0.95,
    mesh: (app: App) => MeshAsset.torus(app, { diameter: 0.85, thickness: 0.24, tessellation: 24 }),
  },
  {
    name: "Cone",
    // A cone is a cylinder with one end closed to a point; ignifx has no separate factory.
    x: 0.1,
    y: 0.4,
    z: 0.95,
    mesh: (app: App) => MeshAsset.cylinder(app, { height: 0.8, diameterTop: 0, diameterBottom: 0.7 }),
  },
  {
    name: "Slab",
    x: 1.5,
    y: 0.14,
    z: 0.95,
    mesh: (app: App) => MeshAsset.box(app, { width: 0.95, height: 0.28, depth: 0.62 }),
  },
];

/** The built shapes, and the two things `main.ts` needs from them. */
export interface PickableScene {
  /** How many shapes there are, for the panel's readout. */
  readonly count: number;
  /** The shape the example opens picked, so a capture shows an answer rather than an instruction. */
  readonly opening: Entity;
  /**
   * Draws one shape as the picked one and the rest as they were.
   *
   * @param entity - What a pick found, or `null` to clear the highlight.
   */
  readonly highlight: (entity: Entity | null) => void;
}

/**
 * Builds the shapes and the highlight.
 *
 * @remarks
 * The highlight is a material swap and nothing else. `MeshRenderer.materials` is a plain array of
 * handles, assigning it is the whole change, and it is on screen the next frame — no second pass,
 * no outline shader, no per-entity state to keep in step.
 *
 * @param app - The app the entities and the assets belong to.
 * @returns The scene's count and its highlight function.
 *
 * @example
 * ```ts
 * const scene = createPickableScene(app);
 * scene.highlight(hit?.entity ?? null);
 * ```
 */
export function createPickableScene(app: App): PickableScene {
  const idle = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "picking/idle", baseColor: IDLE_COLOR, metallic: 0.1, roughness: 0.55 }),
    [],
  );
  const hot = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "picking/picked", baseColor: PICKED_COLOR, metallic: 0.1, roughness: 0.35 }),
    [],
  );

  const renderers = new Map<Entity, MeshRenderer>();
  for (const shape of SHAPES) {
    const entity = app.world.createEntity(shape.name);
    entity.transform.localPosition.set(shape.x, shape.y, shape.z);
    renderers.set(
      entity,
      entity.addComponent(MeshRenderer, { mesh: shape.mesh(app), materials: [idle], castShadows: true }),
    );
  }

  let selected: Entity | null = null;
  // The cylinder: middle of the front row, and the tallest thing near the frame's centre.
  const opening = [...renderers.keys()].find((entity: Entity): boolean => entity.name === "Cylinder");
  return {
    count: renderers.size,
    opening: opening ?? app.world.createEntity("Nothing"),
    highlight(entity: Entity | null): void {
      const previous = selected === null ? undefined : renderers.get(selected);
      if (previous !== undefined) {
        previous.materials = [idle];
      }
      selected = entity;
      const next = entity === null ? undefined : renderers.get(entity);
      if (next !== undefined) {
        next.materials = [hot];
      }
    },
  };
}
