import { afterEach, describe, expect, it } from "vitest";
import { defineExtension, Phase, PhysicsCallbackName, Script, ScriptCallbackKind, Transform } from "../../src/index.js";
import { createHeadlessScene, disposeSceneOnly } from "../../src/lite/scene.js";
import { str } from "../../src/schema/field-kinds.js";
import { createTestApp } from "../support/app-harness.js";
import { sinkOf } from "../support/create-test-world.js";
import type {
  ErrorReport,
  Extension,
  ExtensionContext,
  IgnifxError,
  LiteScene,
  ScriptCallbacks,
} from "../../src/index.js";
import type { TestAppHarness } from "../support/app-harness.js";

/**
 * The three kernel hooks `@ignifx/physics` is written against
 * (`docs/architecture/04-extensions.md` §1, §3, `09-physics.md` §1, §2.1, §4):
 * `dispatchScriptCallback`, `entityImplements`, and `setSimulationScene`.
 */

/** One fixed step at the default rate. */
const FIXED_STEP = 1 / 60;

/** Records `onCollisionEnter` with the argument it was handed. */
class Enter extends Script.define({ label: str("") }) implements ScriptCallbacks {
  static typeId = "test/PhysicsEnter";

  onCollisionEnter(collision: unknown): void {
    sinkOf(this.world).push(`enter:${this.label}:${String(collision)}`);
  }
}

/** The same callback, declared to run *earlier* — component order must still win. */
class EarlyEnter extends Enter {
  static override typeId = "test/PhysicsEarlyEnter";
  static executionOrder = -100;
}

/** A script that implements a different physics callback, so the bit mask has to discriminate. */
class TriggerExit extends Script.define({ label: str("") }) implements ScriptCallbacks {
  static typeId = "test/PhysicsTriggerExit";

  onTriggerExit(trigger: unknown): void {
    sinkOf(this.world).push(`exit:${this.label}:${String(trigger)}`);
  }
}

/** A handler that fails, to prove delivery continues past it. */
class Thrower extends Script.define({ label: str("") }) implements ScriptCallbacks {
  static typeId = "test/PhysicsThrower";

  onCollisionEnter(): void {
    throw new Error("the handler failed");
  }
}

/** What the probe extension hands back to the test. */
interface Probe {
  /** The context the extension was registered with. */
  ctx: ExtensionContext | null;
  /** Work queued to run inside the next fixed step. */
  task: (() => void) | null;
}

/**
 * An extension that captures its context and runs queued work from inside the fixed loop, which is
 * the only place a physics extension may dispatch from.
 *
 * @param probe - The box the extension writes into.
 * @returns The extension.
 */
function probeExtension(probe: Probe): Extension {
  return {
    name: "game/physics-probe",
    version: "1.0.0",
    register(ctx: ExtensionContext): void {
      probe.ctx = ctx;
      ctx.registerSystem(
        {
          name: "physics-probe",
          update(): void {
            const task = probe.task;
            probe.task = null;
            task?.();
          },
        },
        { phase: Phase.FixedUpdate, order: 1001 },
      );
    },
  };
}

/** Everything one test case needs. */
interface Fixture {
  /** The headless app on a manual clock. */
  readonly harness: TestAppHarness;
  /** The probe extension's context. */
  readonly ctx: ExtensionContext;
  /** Runs work inside the next fixed step. */
  readonly inFixedStep: (task: () => void) => void;
}

let disposeFixture: (() => void) | null = null;

afterEach(() => {
  disposeFixture?.();
  disposeFixture = null;
});

/**
 * Builds a headless app with the probe extension registered.
 *
 * @param mode - The build mode; defaults to development.
 * @returns The fixture.
 */
async function build(mode: "development" | "production" = "development"): Promise<Fixture> {
  const probe: Probe = { ctx: null, task: null };
  const harness = await createTestApp({ extensions: [probeExtension(probe)], mode });
  disposeFixture = (): void => {
    harness.dispose();
  };
  const ctx = probe.ctx;
  if (ctx === null) {
    throw new Error("the probe extension was never registered");
  }
  return {
    harness,
    ctx,
    inFixedStep: (task: () => void): void => {
      probe.task = task;
      harness.step(FIXED_STEP);
      expect(probe.task).toBeNull();
    },
  };
}

/**
 * Runs one frame so that everything added so far has run `awake`/`onEnable`, then clears the log.
 *
 * @param harness - The app harness.
 */
function settle(harness: TestAppHarness): void {
  harness.step(FIXED_STEP);
  harness.log.length = 0;
}

/**
 * The `IgnifxError` code of whatever a function throws.
 *
 * @param action - The call expected to fail.
 * @returns The code.
 */
function codeThrownBy(action: () => void): string {
  try {
    action();
  } catch (error) {
    return (error as IgnifxError).code;
  }
  throw new Error("the call was expected to throw");
}

describe("ExtensionContext.dispatchScriptCallback", () => {
  it("reaches every implementing script on the entity, in component order", async () => {
    const { harness, ctx, inFixedStep } = await build();
    const entity = harness.world.createEntity("Body");
    entity.addComponent(Enter, { label: "a" });
    entity.addComponent(TriggerExit, { label: "t" });
    entity.addComponent(EarlyEnter, { label: "b" });
    const disabled = entity.addComponent(Enter, { label: "off" });
    disabled.enabled = false;
    settle(harness);

    inFixedStep(() => {
      ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onCollisionEnter, "hit");
    });

    // "a" before "b" although "b" declares the earlier `executionOrder`; the trigger-only script,
    // the disabled script, and the entity's plain `Transform` receive nothing.
    expect(harness.log).toEqual(["enter:a:hit", "enter:b:hit"]);
  });

  it("delivers each callback name to its own scripts", async () => {
    const { harness, ctx, inFixedStep } = await build();
    const entity = harness.world.createEntity("Body");
    entity.addComponent(Enter, { label: "a" });
    entity.addComponent(TriggerExit, { label: "t" });
    settle(harness);

    inFixedStep(() => {
      ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onTriggerExit, "left");
    });

    expect(harness.log).toEqual(["exit:t:left"]);
  });

  it("delivers nothing to an inactive entity", async () => {
    const { harness, ctx, inFixedStep } = await build();
    const entity = harness.world.createEntity("Body");
    entity.addComponent(Enter, { label: "a" });
    settle(harness);
    entity.active = false;
    harness.log.length = 0;

    inFixedStep(() => {
      ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onCollisionEnter, "hit");
    });

    expect(harness.log).toEqual([]);
  });

  it("delivers nothing to an entity destroyed earlier in the same frame", async () => {
    const { harness, ctx, inFixedStep } = await build();
    const entity = harness.world.createEntity("Body");
    entity.addComponent(Enter, { label: "a" });
    settle(harness);

    inFixedStep(() => {
      entity.destroy();
      ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onCollisionEnter, "hit");
    });

    expect(harness.log).toEqual([]);
  });

  it("reports a throwing handler and still calls the next script", async () => {
    const { harness, ctx, inFixedStep } = await build();
    const errors: ErrorReport[] = [];
    harness.app.onError.connect((report: ErrorReport): void => {
      errors.push(report);
    });
    const entity = harness.world.createEntity("Body");
    const thrower = entity.addComponent(Thrower, { label: "x" });
    entity.addComponent(Enter, { label: "a" });
    settle(harness);

    inFixedStep(() => {
      ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onCollisionEnter, "hit");
    });

    expect(harness.log).toEqual(["enter:a:hit"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.source).toBe("lifecycle");
    expect(errors[0]?.phase).toBe(Phase.FixedUpdate);
    expect(errors[0]?.entity).toBe(entity);
    expect(errors[0]?.component).toBe(thrower);
  });

  it("does not call a script attached by a handler during the same dispatch", async () => {
    const { harness, ctx, inFixedStep } = await build();
    const entity = harness.world.createEntity("Body");
    entity.addComponent(Enter, { label: "a" });
    settle(harness);

    inFixedStep(() => {
      entity.addComponent(Enter, { label: "late" });
      ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onCollisionEnter, "hit");
    });

    expect(harness.log).toEqual(["enter:a:hit"]);
  });

  it("throws IGX-0409 in development when called outside a fixed step", async () => {
    const { harness, ctx } = await build();
    const entity = harness.world.createEntity("Body");
    entity.addComponent(Enter, { label: "a" });
    settle(harness);

    const code = codeThrownBy(() => {
      ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onCollisionEnter, "hit");
    });

    expect(code).toBe("IGX-0409");
    expect(harness.log).toEqual([]);
  });

  it("delivers outside a fixed step in production rather than losing the event", async () => {
    const { harness, ctx } = await build("production");
    const entity = harness.world.createEntity("Body");
    entity.addComponent(Enter, { label: "a" });
    settle(harness);

    ctx.dispatchScriptCallback(entity, PhysicsCallbackName.onCollisionEnter, "hit");

    expect(harness.log).toEqual(["enter:a:hit"]);
  });
});

describe("ExtensionContext.entityImplements", () => {
  it("is true for an implementing script and false for another callback", async () => {
    const { harness, ctx } = await build();
    const entity = harness.world.createEntity("Body");
    entity.addComponent(Enter, { label: "a" });
    settle(harness);

    expect(ctx.entityImplements(entity, PhysicsCallbackName.onCollisionEnter)).toBe(true);
    expect(ctx.entityImplements(entity, PhysicsCallbackName.onTriggerExit)).toBe(false);
  });

  it("is false for an entity carrying no scripts at all", async () => {
    const { harness, ctx } = await build();
    const entity = harness.world.createEntity("Bare");

    expect(ctx.entityImplements(entity, PhysicsCallbackName.onCollisionEnter)).toBe(false);
  });

  it("ignores the script's enabled state", async () => {
    const { harness, ctx } = await build();
    const entity = harness.world.createEntity("Body");
    const script = entity.addComponent(Enter, { label: "a" });
    settle(harness);

    script.enabled = false;
    expect(ctx.entityImplements(entity, PhysicsCallbackName.onCollisionEnter)).toBe(true);
    entity.active = false;
    expect(ctx.entityImplements(entity, PhysicsCallbackName.onCollisionEnter)).toBe(true);
  });

  it("stops counting a script the moment it is removed", async () => {
    const { harness, ctx } = await build();
    const entity = harness.world.createEntity("Body");
    const script = entity.addComponent(Enter, { label: "a" });
    settle(harness);

    entity.removeComponent(script);
    expect(ctx.entityImplements(entity, PhysicsCallbackName.onCollisionEnter)).toBe(false);
  });
});

describe("ComponentRegistry.implementsCallback", () => {
  it("reads the class's callback bit mask", async () => {
    const { harness } = await build();
    const registry = harness.world.registry;

    expect(registry.implementsCallback(Enter, ScriptCallbackKind.onCollisionEnter)).toBe(true);
    expect(registry.implementsCallback(Enter, ScriptCallbackKind.onTriggerExit)).toBe(false);
    expect(registry.implementsCallback(EarlyEnter, ScriptCallbackKind.onCollisionEnter)).toBe(true);
  });

  it("answers false for a plain component class", async () => {
    const { harness } = await build();

    expect(harness.world.registry.implementsCallback(Transform, ScriptCallbackKind.onCollisionEnter)).toBe(false);
  });
});

describe("ExtensionContext.setSimulationScene", () => {
  it("tolerates a clear from an extension's dispose, after the world is gone", async () => {
    const simulation = createHeadlessScene();
    let cleared = false;
    let context: ExtensionContext | null = null;
    const ext = defineExtension(() => ({
      name: "test/simulation",
      version: "1.0.0",
      engine: ">=0.0.0",
      requires: ["@ignifx/core"],
      register(ctx: ExtensionContext): void {
        context = ctx;
      },
      onStart(): void {
        context?.setSimulationScene(simulation.scene);
      },
      dispose(): void {
        // The TSDoc on the hook says `null` clears it "from the extension's dispose".
        context?.setSimulationScene(null);
        cleared = true;
      },
    }));
    const harness = await createTestApp({ extensions: [ext()] });
    try {
      await harness.app.start();
      expect(harness.world.lite.simulationScene).toBe(simulation.scene);
      expect(() => {
        harness.app.dispose();
      }).not.toThrow();
      expect(cleared).toBe(true);
      // A teardown failure would be reported through the log at error level.
      expect(harness.log.filter((line) => /error/i.test(line))).toEqual([]);
    } finally {
      disposeSceneOnly(simulation.scene);
    }
  });

  it("publishes, keeps, and clears the simulation scene", async () => {
    const { harness, ctx } = await build();
    const first = createHeadlessScene();
    const second = createHeadlessScene();
    try {
      const handles = harness.world.lite;
      expect(handles.scene).toBe(harness.app.lite.scene);
      expect(handles.simulationScene).toBeNull();

      ctx.setSimulationScene(first.scene);
      expect(harness.world.lite.simulationScene).toBe(first.scene);
      // Setting the same scene again is not a second scene.
      ctx.setSimulationScene(first.scene);
      expect(harness.world.lite.simulationScene).toBe(first.scene);

      ctx.setSimulationScene(null);
      expect(harness.world.lite.simulationScene).toBeNull();
      ctx.setSimulationScene(second.scene);
      expect(harness.world.lite.simulationScene).toBe(second.scene);
    } finally {
      disposeSceneOnly(first.scene);
      disposeSceneOnly(second.scene);
    }
  });

  it("throws IGX-0410 when a second, different scene is handed to the world", async () => {
    const { ctx } = await build();
    const first = createHeadlessScene();
    const second = createHeadlessScene();
    try {
      ctx.setSimulationScene(first.scene);
      const code = codeThrownBy(() => {
        ctx.setSimulationScene(second.scene);
      });
      expect(code).toBe("IGX-0410");
    } finally {
      disposeSceneOnly(first.scene);
      disposeSceneOnly(second.scene);
    }
  });

  it("hands out the same lite object on every read and updates it in place", async () => {
    const { harness, ctx } = await build();
    const scene = createHeadlessScene();
    try {
      const handles = harness.world.lite;
      expect(harness.world.lite).toBe(handles);
      ctx.setSimulationScene(scene.scene);
      expect(harness.world.lite).toBe(handles);
      const published: LiteScene | null = handles.simulationScene;
      expect(published).toBe(scene.scene);
    } finally {
      disposeSceneOnly(scene.scene);
    }
  });

  it("drops the simulation scene when the world is disposed", async () => {
    const { harness, ctx } = await build();
    const scene = createHeadlessScene();
    try {
      ctx.setSimulationScene(scene.scene);
      const handles = harness.world.lite;
      harness.world.dispose();
      expect(handles.simulationScene).toBeNull();
    } finally {
      disposeSceneOnly(scene.scene);
    }
  });
});
