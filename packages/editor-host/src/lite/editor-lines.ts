/**
 * The editor's own lines over the scene view (`setEditorLines`): collider outlines, 2D collider
 * handles. Each set is one Lite line system in core's render overlay, so it draws over the frame in
 * both view modes. Every Lite claim here was read from the pinned `@babylonjs/lite` 1.34
 * `index.d.ts` (`createLineSystem`, `LineSystemOptions`).
 *
 * The host loads this module with `import()` once a scene view has a canvas, so it stays out of the
 * host's first chunk (`CONSTITUTION.md` §2.5).
 */

import { addToScene, createLineSystem, disposeMeshGpu, removeFromScene } from "@babylonjs/lite";
import { EDITOR_ONLY_METADATA_KEY } from "@ignifx/core";
import type { Mesh, SceneContext, Vec3 } from "@babylonjs/lite";
import type { AppLiteHandles, RenderOverlay } from "@ignifx/core";

/** A colour, each channel `0..1`. */
export interface LineColor {
  /** Red. */
  readonly r: number;
  /** Green. */
  readonly g: number;
  /** Blue. */
  readonly b: number;
  /** Opacity. */
  readonly a: number;
}

/** The editor's line sets of one scene view. */
export interface EditorLinesView {
  /**
   * Draws a set, replacing the one of the same id.
   *
   * @param id - The set's id.
   * @param lines - Six numbers a segment: the `x, y, z` of both ends, in world metres.
   * @param color - The set's colour.
   */
  set(id: string, lines: readonly number[], color: LineColor): void;
  /**
   * Removes a set, or every set.
   *
   * @param id - The set's id, or `null` for all.
   */
  clear(id: string | null): void;
  /** Removes every set's mesh and releases its GPU resources. */
  dispose(): void;
}

/**
 * Builds the line sets of one scene view, in the render overlay.
 *
 * @remarks
 * No mesh is pickable or belongs to an entity, so no pick, selection or `readBack` reaches it, and
 * each carries core's `EDITOR_ONLY_METADATA_KEY`, so no render texture (the game view) draws it.
 *
 * @param handles - The app's Lite engine (`app.lite`).
 * @param overlay - The view's open render overlay; the lines do not own it.
 * @returns The line sets, empty.
 */
export function createEditorLines(handles: AppLiteHandles, overlay: RenderOverlay): EditorLinesView {
  const { engine } = handles;
  const scene: SceneContext = overlay.lite.scene;
  const meshes = new Map<string, Mesh>();

  const remove = (id: string): void => {
    const mesh = meshes.get(id);
    if (mesh !== undefined) {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
      meshes.delete(id);
    }
  };

  const clear = (id: string | null): void => {
    for (const key of id === null ? [...meshes.keys()] : [id]) {
      remove(key);
    }
  };

  return {
    set(id: string, lines: readonly number[], color: LineColor): void {
      remove(id);
      const segments: (readonly Vec3[])[] = [];
      for (let at = 0; at + 5 < lines.length; at += 6) {
        segments.push([
          { x: lines[at] ?? 0, y: lines[at + 1] ?? 0, z: lines[at + 2] ?? 0 },
          { x: lines[at + 3] ?? 0, y: lines[at + 4] ?? 0, z: lines[at + 5] ?? 0 },
        ]);
      }
      if (segments.length === 0) {
        return;
      }
      const mesh = createLineSystem(engine, {
        name: `ignifx-editor-lines:${id}`,
        lines: segments,
        color,
        useVertexAlpha: color.a < 1,
      });
      mesh.pickable = false;
      mesh.receiveShadows = false;
      // Drawn in the scene view only, never in a render texture such as the Game panel's view.
      mesh.metadata = { ...mesh.metadata, [EDITOR_ONLY_METADATA_KEY]: true };
      addToScene(scene, mesh);
      meshes.set(id, mesh);
    },
    clear,
    dispose(): void {
      clear(null);
    },
  };
}
