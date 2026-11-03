/**
 * The scene view's grid (engine ask E31): a script on the `Scene Grid` entity of the host's
 * persistent `editor` scene, which moves the grid with the editor camera every frame.
 */

import { Script } from "@ignifx/core";
import type { GridPlacement } from "./grid.js";
import type { EditorGridView } from "../lite/grid.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * Places the view's grid every frame, where {@link EditorGrid.placement} says.
 *
 * @remarks
 * The host sets both fields: `view` once a canvas has the grid's meshes (never headless), and
 * `placement` to read the editor cameras and the `setGrid` settings.
 */
export class EditorGrid extends Script implements ScriptCallbacks {
  /** The type id; the host leaves it out of the schemas it reports. */
  static typeId = "ignifx-editor/EditorGrid";

  /** The scene view runs in edit mode, where only these scripts get callbacks. */
  static runInEditMode = true;

  /** The grid's meshes, or `null` while there is nothing to draw on. */
  view: EditorGridView | null = null;

  /**
   * Reads this frame's grid.
   *
   * @returns The placement, or `null` to hide the grid.
   */
  placement: () => GridPlacement | null = () => null;

  /** Moves the grid after the cameras have moved. */
  lateUpdate(): void {
    this.view?.place(this.placement());
  }
}
