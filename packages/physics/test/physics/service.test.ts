import { describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { PhysicsErrorCode, physicsError } from "../../src/errors.js";
import { PhysicsService } from "../../src/service.js";
import { createPhysicsApp } from "../support/harness.js";

/**
 * The parts of `app.physics` that are not queries: the Lite escape hatch, the debug-viewer refusal
 * in headless mode, and the service key itself (`docs/architecture/09-physics.md` §9).
 */

describe("app.physics", () => {
  it("is registered under its own class and reachable as a property", async () => {
    const harness = await createPhysicsApp();
    try {
      expect(harness.app.physics).toBeInstanceOf(PhysicsService);
      expect(harness.app.services.get(PhysicsService)).toBe(harness.app.physics);
      expect(harness.app.services.has(PhysicsService)).toBe(true);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("exposes the Havok world and the simulation scene", async () => {
    const harness = await createPhysicsApp();
    try {
      const handles = harness.app.physics.lite;
      expect(handles.world).toBeDefined();
      // The extension publishes the scene it simulates on through `ctx.setSimulationScene`, so the
      // world's own escape hatch answers with the same object (`02-scene-graph.md` §2).
      expect(handles.simulationScene).toBe(harness.world.lite.simulationScene);
      expect(handles.simulationScene).not.toBe(harness.app.lite.scene);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("refuses the debug viewer in a headless app and says why", async () => {
    const harness = await createPhysicsApp();
    try {
      harness.app.physics.debugViewer.enabled = true;
      expect(harness.app.physics.debugViewer.enabled).toBe(false);
      const warning = harness.sink.toArray().find((record) => record.message.includes("debug viewer"));
      expect(warning).toBeDefined();
      // Switching it off again is a no-op rather than a failure.
      harness.app.physics.debugViewer.enabled = false;
      expect(harness.app.physics.isDebugViewerEnabled()).toBe(false);
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("keeps the overlap result array between calls", async () => {
    const harness = await createPhysicsApp();
    try {
      harness.world.createEntity("Floor").addComponent(BoxCollider, { size: { x: 10, y: 1, z: 10 } });
      harness.stepMany(2);
      const first = harness.app.physics.overlap({ kind: "box", size: { x: 2, y: 2, z: 2 } }, { x: 0, y: 0, z: 0 });
      const second = harness.app.physics.overlap({ kind: "box", size: { x: 2, y: 2, z: 2 } }, { x: 0, y: 0, z: 0 });
      // Documented on `overlap`: the array is reused, so a caller that keeps it must copy.
      expect(second).toBe(first);
      expect([...second].map((entity) => entity.name)).toEqual(["Floor"]);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("physicsError", () => {
  it("builds a bare error and one with every option", () => {
    const bare = physicsError(PhysicsErrorCode.queryBeforeStep, "no step yet");
    expect(bare.code).toBe(PhysicsErrorCode.queryBeforeStep);
    expect(bare.message).toContain("no step yet");

    const cause = new Error("underneath");
    const full = physicsError(PhysicsErrorCode.havokUnavailable, "no bytes", {
      context: { url: "assets/HavokPhysics.wasm" },
      hint: "serve the file",
      cause,
    });
    expect(full.code).toBe(PhysicsErrorCode.havokUnavailable);
    expect(full.cause).toBe(cause);
    expect(full.hint).toBe("serve the file");
    expect(full.context).toEqual({ url: "assets/HavokPhysics.wasm" });
  });
});
