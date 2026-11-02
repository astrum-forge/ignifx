/**
 * The scene view's grid (engine ask E31), drawn with Babylon Lite's `createGridMaterial`. Every Lite
 * claim here was read from the pinned `@babylonjs/lite` 1.34 `index.d.ts` and
 * `lib/material/grid/grid-material.js`.
 *
 * The host loads this module with `import()` once a scene view has a canvas, so the grid's shader
 * code stays out of the host's first chunk (`CONSTITUTION.md` §2.5).
 */

import {
  addToScene,
  createGridMaterial,
  createGround,
  createPlane,
  createTexture2DFromPixels,
  disposeMeshGpu,
  releaseTexture,
  removeFromScene,
  setShaderUniform,
} from "@babylonjs/lite";
import type { GridPlacement } from "../scene/grid.js";
import type { Mesh, SceneContext, ShaderMaterial } from "@babylonjs/lite";
import type { AppLiteHandles, RenderOverlay } from "@ignifx/core";

/** The name of the 3D grid's mesh in the render scene. */
export const GRID_MESH_NAME = "ignifx-editor-grid";

/** The name of the 2D grid's mesh in the render overlay. */
export const SCREEN_GRID_MESH_NAME = "ignifx-editor-grid-2d";

/** How visible the minor lines are next to the major ones, `0..1`. */
const MINOR_VISIBILITY = 0.4;

/** The 3D grid's line opacity; below 1, Lite's grid material leaves the space between lines clear. */
const GROUND_OPACITY = 0.8;

/** The 2D grid's line opacity: it draws over the sprites, so it stays faint. */
const SCREEN_OPACITY = 0.35;

/** The fade texture's side, in texels. */
const FADE_SIZE = 64;

/** The fade starts this far from the centre, as a fraction of the side. */
const FADE_START = 0.12;

/** The fade ends this far from the centre: the grid is gone before the square's edge. */
const FADE_END = 0.48;

/** The grid of one scene view. */
export interface EditorGridView {
  /**
   * Draws the grid where a placement says, or hides it.
   *
   * @param placement - This frame's grid, or `null` to hide it.
   */
  place(placement: GridPlacement | null): void;
  /** Removes the grid's meshes and releases their GPU resources. Calling it again does nothing. */
  dispose(): void;
}

/** One drawn plane: its mesh, material and the scene that holds it. */
interface GridPlane {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly scene: SceneContext;
  readonly opacity: number;
}

/**
 * Builds the grid of one scene view: a ground plane in the render scene, depth-tested against the
 * document's meshes, and a screen plane in the render overlay, over the 2D view's sprites.
 *
 * @remarks
 * Lite's grid material works in object space, so each plane is a unit square scaled to the
 * placement's extent, with `gridRatio = step / extent` and `gridOffset = centre / extent`: the lines
 * stay on world multiples of the step wherever the square moves. Neither mesh is pickable, casts
 * shadows or belongs to an entity, so no pick, selection or `readBack` reaches it.
 *
 * @param handles - The app's Lite engine and render scene (`app.lite`).
 * @param overlay - The view's open render overlay; the grid does not own it.
 * @returns The grid, hidden until the first {@link EditorGridView.place}.
 */
export function createEditorGrid(handles: AppLiteHandles, overlay: RenderOverlay): EditorGridView {
  const { engine } = handles;
  const fade = createTexture2DFromPixels(engine, radialFade(), FADE_SIZE, FADE_SIZE, {
    minFilter: "linear",
    magFilter: "linear",
  });
  const ground = makePlane(
    createGround(engine, { width: 1, height: 1, subdivisions: 1 }),
    GRID_MESH_NAME,
    createGridMaterial({
      name: GRID_MESH_NAME,
      lineColor: [0.6, 0.6, 0.6],
      minorUnitVisibility: MINOR_VISIBILITY,
      opacity: GROUND_OPACITY,
      opacityTexture: fade,
      backFaceCulling: false,
    }),
    handles.scene,
    GROUND_OPACITY,
  );
  const screen = makePlane(
    createPlane(engine, { size: 1 }),
    SCREEN_GRID_MESH_NAME,
    createGridMaterial({
      name: SCREEN_GRID_MESH_NAME,
      lineColor: [0.75, 0.75, 0.75],
      minorUnitVisibility: MINOR_VISIBILITY,
      opacity: SCREEN_OPACITY,
      backFaceCulling: false,
    }),
    overlay.lite.scene,
    SCREEN_OPACITY,
  );
  let isDisposed = false;

  return {
    place(placement: GridPlacement | null): void {
      if (isDisposed) {
        return;
      }
      ground.mesh.visible = placement?.plane === "ground";
      screen.mesh.visible = placement?.plane === "screen";
      if (placement === null) {
        return;
      }
      const { centerX, centerY, extent } = placement;
      const target = placement.plane === "ground" ? ground : screen;
      if (placement.plane === "ground") {
        target.mesh.position.set(centerX, 0, centerY);
        target.mesh.scaling.set(extent, 1, extent);
        setShaderUniform(target.material, "gridOffset", [centerX / extent, 0, centerY / extent]);
      } else {
        target.mesh.position.set(centerX, centerY, 0);
        target.mesh.scaling.set(extent, extent, 1);
        setShaderUniform(target.material, "gridOffset", [centerX / extent, centerY / extent, 0]);
      }
      setShaderUniform(target.material, "gridControl", [
        placement.step / extent,
        placement.majorEvery,
        MINOR_VISIBILITY,
        target.opacity,
      ]);
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      for (const plane of [ground, screen]) {
        removeFromScene(plane.scene, plane.mesh);
        disposeMeshGpu(plane.mesh);
      }
      releaseTexture(fade);
    },
  };
}

/**
 * Names a grid mesh, gives it its material, keeps it out of picks and shadows, and adds it hidden.
 *
 * @param mesh - The unit square.
 * @param name - The mesh's name.
 * @param material - Its grid material.
 * @param scene - The scene that draws it.
 * @param opacity - The material's line opacity, written back with every placement.
 * @returns The plane.
 */
function makePlane(
  mesh: Mesh,
  name: string,
  material: ShaderMaterial,
  scene: SceneContext,
  opacity: number,
): GridPlane {
  mesh.name = name;
  mesh.material = material;
  mesh.pickable = false;
  mesh.receiveShadows = false;
  mesh.visible = false;
  addToScene(scene, mesh);
  return { mesh, material, scene, opacity };
}

/**
 * A square of white texels whose alpha is 1 near the centre and falls smoothly to 0 before the
 * edge, for the grid material's `opacityTexture`.
 *
 * @returns `FADE_SIZE²` RGBA texels.
 */
function radialFade(): Uint8Array {
  const data = new Uint8Array(FADE_SIZE * FADE_SIZE * 4);
  for (let row = 0; row < FADE_SIZE; row += 1) {
    for (let col = 0; col < FADE_SIZE; col += 1) {
      const u = (col + 0.5) / FADE_SIZE - 0.5;
      const v = (row + 0.5) / FADE_SIZE - 0.5;
      const t = Math.min(1, Math.max(0, (Math.hypot(u, v) - FADE_START) / (FADE_END - FADE_START)));
      const alpha = 1 - t * t * (3 - 2 * t);
      const index = (row * FADE_SIZE + col) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  return data;
}
