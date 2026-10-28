/**
 * Turns one gizmo drag into the scene view's drag notifications. It needs no GPU: the view calls
 * it with each part of the gesture, and the headless tests call it directly.
 */

import { SceneNotification, TRANSFORM_DRAGGING_INTERVAL_MS } from "../protocol/index.js";
import { DragSnapper, readLocalTransform } from "./view-math.js";
import type {
  GizmoDragMode,
  GizmoSnap,
  SceneFileTransform,
  TransformDraggedParams,
  TransformDraggingParams,
} from "../protocol/index.js";
import type { Entity } from "@ignifx/core";

/** One gizmo drag in progress. */
interface DragState {
  /** The dragged entity. */
  readonly entity: Entity;
  /** The drag's mode. */
  readonly mode: GizmoDragMode;
  /** The local transform at drag start. */
  readonly before: SceneFileTransform;
  /** The snapping, or `null`. */
  readonly snapper: DragSnapper | null;
  /** When the last `transformDragging` went out, in milliseconds. */
  lastSentMs: number;
}

/**
 * Sends `transformDragging` and `transformDragged` for gizmo drags, one drag at a time.
 *
 * @remarks
 * Every drag opens with a `transformDragging` and closes with a `transformDragged`, even one that
 * ends where it started, so the editor can hold its undo from pointer-down to pointer-up.
 */
export class GizmoDragRelay {
  readonly #notify: (method: string, params: TransformDraggingParams | TransformDraggedParams) => void;

  readonly #now: () => number;

  #drag: DragState | null = null;

  /**
   * Makes a relay.
   *
   * @param notify - Sends one notification to the editor.
   * @param now - The clock, in milliseconds; `performance.now` by default.
   */
  constructor(
    notify: (method: string, params: TransformDraggingParams | TransformDraggedParams) => void,
    now: () => number = () => performance.now(),
  ) {
    this.#notify = notify;
    this.#now = now;
  }

  /**
   * Starts a drag and sends its first `transformDragging`, the transform at drag start. A drag in
   * progress is dropped without a `transformDragged`.
   *
   * @param entity - The dragged entity.
   * @param mode - The drag's mode.
   * @param snap - The snapping steps, or `null`.
   */
  start(entity: Entity, mode: GizmoDragMode, snap: GizmoSnap | null): void {
    const before = readLocalTransform(entity);
    this.#drag = {
      entity,
      mode,
      before,
      snapper: snap === null ? null : new DragSnapper(mode, snap, entity),
      lastSentMs: this.#now(),
    };
    this.#notify(SceneNotification.transformDragging, { entity: entity.uid, mode, after: before });
  }

  /** Snaps the move the gizmo just made and sends `transformDragging`, at most every 50 ms. */
  move(): void {
    const state = this.#drag;
    if (state === null) {
      return;
    }
    state.snapper?.apply(state.entity);
    const now = this.#now();
    if (now - state.lastSentMs >= TRANSFORM_DRAGGING_INTERVAL_MS) {
      state.lastSentMs = now;
      this.#notify(SceneNotification.transformDragging, {
        entity: state.entity.uid,
        mode: state.mode,
        after: readLocalTransform(state.entity),
      });
    }
  }

  /** Ends the drag and sends `transformDragged`, whether or not the transform changed. */
  end(): void {
    const state = this.#drag;
    if (state === null) {
      return;
    }
    this.#drag = null;
    this.#notify(SceneNotification.transformDragged, {
      entity: state.entity.uid,
      mode: state.mode,
      before: state.before,
      after: readLocalTransform(state.entity),
    });
  }

  /** Forgets a drag that has no entity, so its moves and end send nothing. */
  clear(): void {
    this.#drag = null;
  }
}
