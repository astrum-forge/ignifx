import { describe, expect, it } from "vitest";
import { Phase } from "../../src/app/types.js";
import { Component } from "../../src/component/component.js";
import { ScriptCallbackKind } from "../../src/lifecycle/callbacks.js";
import { SceneInstance } from "../../src/scene/scene-instance.js";
import { getFrameState, getWorldInternals } from "../../src/world/world.js";
import { createTestWorld } from "../support/create-test-world.js";
import { RecordingScript } from "../support/recording-script.js";

/** The seam the scheduler drives: `world.lifecycle` and the accessors around it. */

/** A component that is not a script, so the queue has nothing to call. */
class Marker extends Component {
  static typeId = "test/InternalsMarker";
}

describe("accessors", () => {
  it("hands the scheduler the same lifecycle object world.lifecycle exposes", () => {
    const harness = createTestWorld();
    expect(getWorldInternals(harness.world)).toBe(harness.world.lifecycle);
    expect(getFrameState(harness.world)).toBe(harness.frameState.state);
    harness.dispose();
  });

  it("exposes the scene signals Phase 2 will fire", () => {
    const harness = createTestWorld();
    expect(harness.world.onSceneLoaded.connectionCount).toBe(0);
    expect(harness.world.onSceneUnloaded.connectionCount).toBe(0);
    harness.world.onSceneLoaded.connect(() => undefined);
    expect(harness.world.onSceneLoaded.connectionCount).toBe(1);
    harness.dispose();
  });
});

describe("the phase recorded in error reports", () => {
  it("is null between phases and the scheduler's phase during one", () => {
    const harness = createTestWorld();
    class Thrower extends RecordingScript {
      static override typeId = "test/PhaseThrower";
      override awake(): void {
        throw new Error("boom");
      }
    }
    const entity = harness.world.createEntity("entity");
    entity.addComponent(Thrower, { label: "a" });
    harness.flushA();
    expect(harness.errors[0]?.phase).toBeNull();

    const second = harness.world.createEntity("second");
    second.addComponent(Thrower, { label: "b" });
    harness.lifecycle.setPhase(Phase.Update);
    harness.flushA();
    expect(harness.errors[1]?.phase).toBe(Phase.Update);
    harness.lifecycle.setPhase(null);
    harness.dispose();
  });
});

describe("component destruction through the queue", () => {
  it("queues a component only once, however often destroy is called", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const marker = entity.addComponent(Marker);
    marker.destroy();
    marker.destroy();
    marker.destroy();
    harness.flushDestroy();
    expect(entity.components).toEqual([entity.transform]);
    marker.destroy();
    expect(marker.isDestroyed).toBe(true);
    harness.dispose();
  });

  it("destroys one component immediately outside a callback", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.log.length = 0;
    harness.lifecycle.destroyImmediate(script);
    expect(harness.log).toEqual(["onDisable:a", "onDestroy:a", "onDetach:a"]);
    expect(entity.isDestroyed).toBe(false);
    harness.dispose();
  });

  it("refuses destroyImmediate for a component inside a callback", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const marker = entity.addComponent(Marker);
    harness.frameState.beginCallback();
    expect(() => {
      harness.lifecycle.destroyImmediate(marker);
    }).toThrow(/IGX-0102/u);
    harness.frameState.endCallback();
    harness.dispose();
  });

  it("ignores a refresh for a component that has already been released", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const marker = entity.addComponent(Marker);
    marker.destroy();
    harness.flushDestroy();
    expect(() => {
      harness.lifecycle.refreshEnabled(marker);
    }).not.toThrow();
    harness.dispose();
  });
});

describe("scene ownership", () => {
  it("moves an entity's subtree to the new parent's scene", () => {
    const harness = createTestWorld();
    const other = new SceneInstance("scene-2", "other", false);
    const stray = harness.world.createEntity("stray", { scene: other });
    const child = harness.world.createEntity("child", { parent: stray });
    expect(stray.scene).toBe(other);
    expect(child.scene).toBe(other);
    expect(other.roots).toEqual([stray]);

    const host = harness.world.createEntity("host");
    stray.setParent(host);
    expect(stray.scene).toBe(harness.world.activeScene);
    expect(child.scene).toBe(harness.world.activeScene);
    expect(other.roots).toEqual([]);
    harness.dispose();
  });

  it("keeps a root list free of duplicates", () => {
    const harness = createTestWorld();
    const scene = harness.world.activeScene;
    const entity = harness.world.createEntity("entity");
    scene.addRoot(entity);
    expect(scene.roots).toEqual([entity]);
    scene.removeRoot(entity);
    scene.removeRoot(entity);
    expect(scene.roots).toEqual([]);
    harness.dispose();
  });
});

describe("reparenting guards", () => {
  it("refuses a destroyed parent with IGX-0101", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child");
    parent.destroy();
    expect(() => child.setParent(parent)).toThrow(/IGX-0101/u);
    harness.dispose();
  });
});

describe("dispatch after re-enable", () => {
  it("re-files a script in its dispatch lists", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    script.enabled = false;
    expect(harness.lifecycle.scriptsWith(ScriptCallbackKind.update)).toEqual([]);
    script.enabled = true;
    harness.flushA();
    expect(harness.lifecycle.scriptsWith(ScriptCallbackKind.update)).toEqual([script]);
    harness.dispose();
  });

  it("dispatches update through the guarded call site", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.addComponent(RecordingScript, { label: "a" });
    harness.frame();
    harness.log.length = 0;
    harness.lifecycle.forEachScript(ScriptCallbackKind.update, (script) => {
      harness.lifecycle.invokeCallback(script, ScriptCallbackKind.update, 0.5);
    });
    expect(harness.log).toEqual(["update(0.5):a"]);
    harness.dispose();
  });

  it("does nothing when a callback ordinal has no implementation", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const marker = entity.addComponent(Marker);
    expect(() => {
      harness.lifecycle.invokeCallback(marker, ScriptCallbackKind.update, 0.5);
    }).not.toThrow();
    harness.dispose();
  });
});
