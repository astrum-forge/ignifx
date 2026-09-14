/**
 * The one script in this example: it keeps a weather volume over the camera.
 *
 * @remarks
 * This is the whole trick behind weather that never runs out. The volume is small — thirty metres
 * across — and it moves with the viewer, so the storm is always around them; and because both
 * documents simulate in **world space**, a drop that has already been emitted stays where it was
 * born instead of being dragged along. Moving the emitter therefore changes where the *next* drops
 * appear and nothing else.
 */

import { f32, Script } from "ignifx";
import type { Entity, ScriptCallbacks } from "ignifx";

/** Keeps its entity directly above another one, at a fixed height. */
export class FollowsTheViewer extends Script.define({ height: f32(12) }) implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "weather/FollowsTheViewer";

  /** Whose position to stand over. Assigned in code: an entity is not a schema field. */
  target: Entity | null = null;

  /** Moves the volume after the camera has moved, so the two never disagree within a frame. */
  lateUpdate(): void {
    const target = this.target;
    if (target === null) {
      return;
    }
    const at = target.transform.position;
    this.transform.localPosition.set(at.x, this.height, at.z);
  }
}
