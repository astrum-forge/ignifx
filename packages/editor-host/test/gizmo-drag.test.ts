import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  isTransformDraggedParams,
  isTransformDraggingParams,
  SceneNotification,
  TRANSFORM_DRAGGING_INTERVAL_MS,
} from "../src/protocol/index.js";
import { GizmoDragRelay } from "../src/scene/gizmo-drag.js";
import type { App } from "@ignifx/core";

/**
 * A gizmo drag's notifications (editor E9b): every drag opens with a `transformDragging` and closes
 * with a `transformDragged`, even one that ends where it started, so the editor can hold its undo
 * from pointer-down to pointer-up.
 */

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.dispose();
  }
});

/**
 * Builds a relay that records what it sends, on a clock the test moves.
 *
 * @returns The relay, the notifications so far, and the clock.
 */
async function relay(): Promise<{
  app: App;
  drag: GizmoDragRelay;
  sent: { method: string; params: unknown }[];
  clock: { ms: number };
}> {
  const app = await createApp({ headless: true });
  apps.push(app);
  const sent: { method: string; params: unknown }[] = [];
  const clock = { ms: 1000 };
  const drag = new GizmoDragRelay(
    (method, params) => {
      sent.push({ method, params });
    },
    () => clock.ms,
  );
  return { app, drag, sent, clock };
}

describe("GizmoDragRelay", () => {
  it("sends a drag start and a drag end for a drag that never moves", async () => {
    const { app, drag, sent } = await relay();
    const entity = app.world.createEntity("Crate");
    entity.transform.localPosition.set(1, 2, 3);
    const still = { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

    drag.start(entity, "translate", null);
    expect(sent).toEqual([
      { method: SceneNotification.transformDragging, params: { entity: entity.uid, mode: "translate", after: still } },
    ]);
    expect(isTransformDraggingParams(sent[0]?.params)).toBe(true);

    drag.end();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({
      method: SceneNotification.transformDragged,
      params: { entity: entity.uid, mode: "translate", before: still, after: still },
    });
    expect(isTransformDraggedParams(sent[1]?.params)).toBe(true);
  });

  it("sends a drag end for a drag that moves and comes back where it started", async () => {
    const { app, drag, sent, clock } = await relay();
    const entity = app.world.createEntity("Crate");

    drag.start(entity, "translate", null);
    entity.transform.localPosition.set(4, 0, 0);
    clock.ms += TRANSFORM_DRAGGING_INTERVAL_MS;
    drag.move();
    entity.transform.localPosition.set(0, 0, 0);
    drag.end();

    expect(sent.map(({ method }) => method)).toEqual([
      SceneNotification.transformDragging,
      SceneNotification.transformDragging,
      SceneNotification.transformDragged,
    ]);
    expect(sent[1]?.params).toMatchObject({ after: { position: [4, 0, 0] } });
    expect(sent[2]?.params).toMatchObject({ before: { position: [0, 0, 0] }, after: { position: [0, 0, 0] } });
  });

  it("sends transformDragging at most every TRANSFORM_DRAGGING_INTERVAL_MS, and the end once", async () => {
    const { app, drag, sent, clock } = await relay();
    const entity = app.world.createEntity("Crate");

    drag.start(entity, "scale", null);
    clock.ms += TRANSFORM_DRAGGING_INTERVAL_MS - 1;
    drag.move();
    expect(sent).toHaveLength(1);
    clock.ms += 1;
    drag.move();
    expect(sent).toHaveLength(2);
    drag.end();
    drag.end();
    drag.move();
    expect(sent.map(({ method }) => method)).toEqual([
      SceneNotification.transformDragging,
      SceneNotification.transformDragging,
      SceneNotification.transformDragged,
    ]);
  });

  it("snaps each move from where the drag started", async () => {
    const { app, drag, sent, clock } = await relay();
    const entity = app.world.createEntity("Crate");

    drag.start(entity, "translate", { translate: 0.5, rotate: 0, scale: 0 });
    entity.transform.localPosition.set(0.4, 0, 0);
    clock.ms += TRANSFORM_DRAGGING_INTERVAL_MS;
    drag.move();
    drag.end();
    expect(sent[2]?.params).toMatchObject({ after: { position: [0.5, 0, 0] } });
  });

  it("sends nothing for a cleared drag", async () => {
    const { app, drag, sent } = await relay();
    drag.start(app.world.createEntity("Crate"), "rotate", null);
    drag.clear();
    drag.move();
    drag.end();
    expect(sent).toHaveLength(1);
  });
});
