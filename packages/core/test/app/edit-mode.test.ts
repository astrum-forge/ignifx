import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Camera,
  CoreErrorCode,
  createApp,
  createManualClock,
  createMemorySink,
  isIgnifxError,
  Phase,
  PhysicsCallbackName,
  Script,
  waitSeconds,
} from "../../src/index.js";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { createAssetHarness } from "../assets/support/harness.js";
import { reload } from "../hot-reload/fixtures.js";
import { AwakeRecorder, buildFile, entityRecord } from "../serialization/fixtures.js";
import { createTestApp } from "../support/app-harness.js";
import { sinkOf } from "../support/create-test-world.js";
import type {
  App,
  Coroutine,
  Extension,
  ExtensionContext,
  ScriptCallbacks,
  System,
  SystemContext,
  SystemEditMode,
} from "../../src/index.js";
import type { AssetHarness } from "../assets/support/harness.js";
import type { TestAppHarness } from "../support/app-harness.js";

/**
 * Edit mode in the kernel (ADR-0028): which script callbacks an edit-mode app dispatches, from every
 * path that can dispatch one, and what the scheduler does with the fixed loop and with systems.
 */

/** One frame at 60 Hz. */
const FRAME = 1 / 60;

let harnesses: (TestAppHarness | AssetHarness)[] = [];
let apps: App[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  for (const app of apps) {
    app.dispose();
  }
  harnesses = [];
  apps = [];
  vi.unstubAllGlobals();
});

/**
 * Builds a headless test app and remembers it for disposal.
 *
 * @param editMode - Whether the app is in edit mode.
 * @param extensions - Extensions to register.
 * @returns The harness.
 */
async function testApp(editMode: boolean, extensions?: readonly Extension[]): Promise<TestAppHarness> {
  const harness = await createTestApp({ editMode, ...(extensions === undefined ? {} : { extensions }) });
  harnesses.push(harness);
  return harness;
}

/**
 * Runs several frames.
 *
 * @param harness - The app harness.
 * @param count - How many frames.
 */
function stepMany(harness: TestAppHarness, count: number): void {
  for (let index = 0; index < count; index += 1) {
    harness.step(FRAME);
  }
}

/** A script that records every callback a game script can receive. */
class Everything extends Script implements ScriptCallbacks {
  static typeId = "test/EditEverything";

  /**
   * Appends one entry to the world's shared log.
   *
   * @param name - The callback name.
   */
  record(name: string): void {
    sinkOf(this.world).push(name);
  }

  awake(): void {
    this.record("awake");
  }

  onEnable(): void {
    this.record("onEnable");
  }

  start(): void {
    this.record("start");
  }

  fixedUpdate(): void {
    this.record("fixedUpdate");
  }

  update(): void {
    this.record("update");
  }

  lateUpdate(): void {
    this.record("lateUpdate");
  }

  onDisable(): void {
    this.record("onDisable");
  }

  onDestroy(): void {
    this.record("onDestroy");
  }

  onCollisionEnter(): void {
    this.record("onCollisionEnter");
  }

  onTriggerEnter(): void {
    this.record("onTriggerEnter");
  }

  onApplicationPause(isPaused: boolean): void {
    this.record(`onApplicationPause:${String(isPaused)}`);
  }

  onApplicationFocus(isFocused: boolean): void {
    this.record(`onApplicationFocus:${String(isFocused)}`);
  }
}

/** The same script, opted in to edit mode. */
class EditorTool extends Everything {
  static override typeId = "test/EditEditorTool";
  static runInEditMode = true;
}

/** An opted-in script that keeps updating while the app is paused. */
class PausedEditorTool extends EditorTool {
  static override typeId = "test/EditPausedEditorTool";
  static updateWhenPaused = true;
}

/** A script with component hooks only. */
class Hooked extends Script {
  static typeId = "test/EditHooked";

  onAttach(): void {
    sinkOf(this.world).push("onAttach");
  }

  onDetach(): void {
    sinkOf(this.world).push("onDetach");
  }
}

// A coroutine that logs each segment. Plain comments rather than a doc block, for the reason given
// in `test/coroutine/coroutine.test.ts`.
function* ticker(log: string[]): Coroutine {
  log.push("co:0");
  yield;
  log.push("co:1");
  yield waitSeconds(0.05);
  log.push("co:2");
}

describe("an edit-mode app", () => {
  it("reports isEditMode, which is false unless createApp asked for it", async () => {
    const game = await testApp(false);
    const editor = await testApp(true);
    expect(game.app.isEditMode).toBe(false);
    expect(editor.app.isEditMode).toBe(true);
  });

  it("gives a script that does not run in edit mode no callback at all", async () => {
    const harness = await testApp(true);
    const entity = harness.world.createEntity("Thing");
    const script = entity.addComponent(Everything);
    stepMany(harness, 10);
    script.enabled = false;
    harness.step(FRAME);
    script.enabled = true;
    harness.step(FRAME);
    entity.destroy();
    harness.step(FRAME);

    expect(harness.log).toEqual([]);
    expect(harness.app.diagnostics.frame.scriptsUpdated).toBe(0);
  });

  it("gives a runInEditMode script its lifecycle and frame callbacks, but never fixedUpdate", async () => {
    const harness = await testApp(true);
    const entity = harness.world.createEntity("Tool");
    entity.addComponent(EditorTool);
    stepMany(harness, 2);
    entity.destroy();
    harness.step(FRAME);

    expect(harness.log).toEqual([
      "awake",
      "onEnable",
      "start",
      "update",
      "lateUpdate",
      "update",
      "lateUpdate",
      "onDisable",
      "onDestroy",
    ]);
  });

  it("dispatches nothing from destroyImmediate to a script that never got awake", async () => {
    const harness = await testApp(true);
    const plain = harness.world.createEntity("Plain");
    plain.addComponent(Everything);
    const tool = harness.world.createEntity("Tool");
    tool.addComponent(EditorTool);
    harness.step(FRAME);
    harness.log.length = 0;

    plain.destroyImmediate();
    expect(harness.log).toEqual([]);

    tool.destroyImmediate();
    expect(harness.log).toEqual(["onDisable", "onDestroy"]);
  });

  it("still runs onAttach and onDetach, which are component hooks, not lifecycle callbacks", async () => {
    const harness = await testApp(true);
    const entity = harness.world.createEntity("Hooked");
    entity.addComponent(Hooked);
    harness.step(FRAME);
    entity.destroyImmediate();
    expect(harness.log).toEqual(["onAttach", "onDetach"]);
  });

  it("delivers an extension's physics callback only to scripts that run in edit mode", async () => {
    let context: ExtensionContext | null = null;
    let deliver = false;
    let target: ReturnType<TestAppHarness["world"]["createEntity"]> | null = null;
    const probe: Extension = {
      name: "game/edit-mode-probe",
      version: "1.0.0",
      register(ctx: ExtensionContext): void {
        context = ctx;
        ctx.registerSystem(
          {
            name: "edit-mode-probe",
            update(): void {
              if (deliver && target !== null) {
                deliver = false;
                context?.dispatchScriptCallback(target, PhysicsCallbackName.onCollisionEnter, null);
              }
            },
          },
          { phase: Phase.Update, order: 1001 },
        );
      },
    };
    // Production: a development build refuses a physics callback outside a fixed step (`IGX-0409`),
    // and edit mode has no fixed step, so only a production build can reach the gate this way.
    const harness = await createTestApp({ editMode: true, mode: "production", extensions: [probe] });
    harnesses.push(harness);
    target = harness.world.createEntity("Body");
    target.addComponent(Everything);
    target.addComponent(EditorTool);
    harness.step(FRAME);
    harness.log.length = 0;

    deliver = true;
    harness.step(FRAME);

    expect(harness.log.filter((entry) => entry === "onCollisionEnter")).toEqual(["onCollisionEnter"]);
  });

  it("delivers onApplicationPause and onApplicationFocus only to scripts that run in edit mode", async () => {
    const listeners = new Map<string, () => void>();
    const add = (name: string, handler: () => void): void => {
      listeners.set(name, handler);
    };
    const host = { hidden: true };
    vi.stubGlobal("document", {
      addEventListener: add,
      removeEventListener: (): void => undefined,
      get hidden(): boolean {
        return host.hidden;
      },
    });
    vi.stubGlobal("window", { addEventListener: add, removeEventListener: (): void => undefined });
    const app = await createApp({
      headless: true,
      editMode: true,
      clock: createManualClock(),
      logSink: createMemorySink(),
    });
    apps.push(app);
    app.world.createEntity("Plain").addComponent(Everything);
    app.world.createEntity("Tool").addComponent(EditorTool);
    app.step(FRAME);
    const log = sinkOf(app.world);
    log.length = 0;

    await app.start();
    listeners.get("visibilitychange")?.();
    listeners.get("blur")?.();

    expect(log).toEqual(["onApplicationPause:true", "onApplicationFocus:false"]);
  });
});

describe("scene loading in edit mode", () => {
  it("builds the scene and dispatches no awake or onEnable, then unloads it silently", async () => {
    const harness = await createAssetHarness({ editMode: true });
    harnesses.push(harness);
    harness.app.registerComponents([AwakeRecorder]);
    const file = buildFile({
      name: "Level",
      entities: [
        entityRecord({
          uid: "E-ROOT",
          name: "Root",
          components: [{ uid: "E-S", type: "test/AwakeRecorder", props: { note: "root" } }],
        }),
      ],
    });
    harness.net.canned.set(harness.app.assets.resolveUrl("levels/a.scene.json"), stringifySceneFile(file));

    const promise = harness.app.world.loadScene("levels/a.scene.json");
    for (let index = 0; index < 50; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a load settles only as frames run.
      await harness.settle();
    }
    const instance = await promise;

    expect(instance.roots.map((entity) => entity.name)).toEqual(["Root"]);
    expect(harness.app.world.getEntity("E-ROOT")?.getComponent(AwakeRecorder)).not.toBeNull();
    expect(sinkOf(harness.app.world)).toEqual([]);

    await harness.app.world.unloadScene(instance);
    expect(sinkOf(harness.app.world)).toEqual([]);
  });
});

describe("coroutines in edit mode", () => {
  it("refuses to start one for a script that does not run in edit mode, with IGX-0111", async () => {
    const harness = await testApp(true);
    const script = harness.world.createEntity("Plain").addComponent(Everything);
    harness.step(FRAME);
    const log: string[] = [];

    let caught: unknown = null;
    try {
      script.startCoroutine(ticker(log));
    } catch (error) {
      caught = error;
    }

    expect(isIgnifxError(caught) && caught.code).toBe(CoreErrorCode.coroutineInEditMode);
    expect(isIgnifxError(caught) && caught.hint).toContain("static runInEditMode = true");
    expect(() => harness.app.coroutines.start(script, ticker(log))).toThrow(CoreErrorCode.coroutineInEditMode);
    stepMany(harness, 10);
    expect(log).toEqual([]);
  });

  it("runs one for a script that runs in edit mode", async () => {
    const harness = await testApp(true);
    const script = harness.world.createEntity("Tool").addComponent(EditorTool);
    harness.step(FRAME);
    const log: string[] = [];

    script.startCoroutine(ticker(log));
    stepMany(harness, 10);

    expect(log).toEqual(["co:0", "co:1", "co:2"]);
  });

  it("still lets a game app start one from anywhere", async () => {
    const harness = await testApp(false);
    const script = harness.world.createEntity("Plain").addComponent(Everything);
    const log: string[] = [];
    script.startCoroutine(ticker(log));
    expect(log).toEqual(["co:0"]);
  });
});

/** A system that records the `dt` and `isClockHeld` of every frame it runs. */
class ClockProbe implements System {
  readonly name: string;

  /** One entry per run: `dt`, then whether the clock was held. */
  readonly runs: (readonly [number, boolean])[] = [];

  /**
   * Creates a probe.
   *
   * @param name - Its name.
   */
  constructor(name: string) {
    this.name = name;
  }

  update(ctx: SystemContext): void {
    this.runs.push([ctx.dt, ctx.isClockHeld]);
  }
}

/** The probes one app registers. */
interface Probes {
  readonly run: ClockProbe;
  readonly hold: ClockProbe;
  readonly skip: ClockProbe;
  readonly fixed: ClockProbe;
}

/**
 * Registers one probe in `Update`.
 *
 * @param ctx - The extension context.
 * @param probe - The probe.
 * @param editMode - What it does in edit mode.
 */
function registerProbe(ctx: ExtensionContext, probe: ClockProbe, editMode: SystemEditMode): void {
  ctx.registerSystem(probe, { phase: Phase.Update, order: 1001, editMode });
}

/**
 * An extension that registers one probe per edit-mode behaviour, plus one in the fixed loop.
 *
 * @param probes - The probes.
 * @returns The extension.
 */
function probeExtension(probes: Probes): Extension {
  return {
    name: "game/clock-probes",
    version: "1.0.0",
    register(ctx: ExtensionContext): void {
      registerProbe(ctx, probes.run, "run");
      registerProbe(ctx, probes.hold, "hold");
      registerProbe(ctx, probes.skip, "skip");
      ctx.registerSystem(probes.fixed, { phase: Phase.FixedUpdate, order: 1001, editMode: "run" });
    },
  };
}

/**
 * Builds the four probes.
 *
 * @returns The probes.
 */
function createProbes(): Probes {
  return {
    run: new ClockProbe("run"),
    hold: new ClockProbe("hold"),
    skip: new ClockProbe("skip"),
    fixed: new ClockProbe("fixed"),
  };
}

describe("systems and the clock in edit mode", () => {
  it("runs a run system with the real delta, a hold system with a held clock, and no skip system", async () => {
    const probes = createProbes();
    const harness = await testApp(true, [probeExtension(probes)]);
    stepMany(harness, 3);

    expect(probes.run.runs).toEqual([
      [FRAME, false],
      [FRAME, false],
      [FRAME, false],
    ]);
    expect(probes.hold.runs).toEqual([
      [0, true],
      [0, true],
      [0, true],
    ]);
    expect(probes.skip.runs).toEqual([]);
  });

  it("runs no fixed step, but the frame clock still advances", async () => {
    const probes = createProbes();
    const harness = await testApp(true, [probeExtension(probes)]);
    stepMany(harness, 6);

    expect(probes.fixed.runs).toEqual([]);
    expect(harness.app.diagnostics.frame.fixedSteps).toBe(0);
    expect(harness.app.time.fixedTime).toBe(0);
    expect(harness.app.time.fixedStepAlpha).toBe(0);
    expect(harness.app.time.deltaTime).toBeCloseTo(FRAME, 9);
    expect(harness.app.time.time).toBeCloseTo(6 * FRAME, 9);
    expect(harness.app.time.frameCount).toBe(6);
  });

  it("ignores the edit-mode declarations in a game app", async () => {
    const probes = createProbes();
    const harness = await testApp(false, [probeExtension(probes)]);
    stepMany(harness, 2);

    for (const probe of [probes.run, probes.hold, probes.skip]) {
      expect(probe.runs).toEqual([
        [FRAME, false],
        [FRAME, false],
      ]);
    }
    expect(probes.fixed.runs.length).toBe(2);
  });

  it("keeps time.paused meaning what it means in a game: only updateWhenPaused scripts update", async () => {
    const harness = await testApp(true);
    harness.world.createEntity("Tool").addComponent(EditorTool);
    harness.world.createEntity("Paused").addComponent(PausedEditorTool);
    harness.step(FRAME);
    harness.log.length = 0;

    harness.app.pause();
    harness.step(FRAME);
    expect(harness.log).toEqual(["update", "lateUpdate"]);
    expect(harness.app.time.paused).toBe(true);

    harness.log.length = 0;
    harness.app.resume();
    harness.step(FRAME);
    expect(harness.log).toEqual(["update", "update", "lateUpdate", "lateUpdate"]);
  });
});

describe("the systems core keeps running in edit mode", () => {
  it("delivers an asset load (asset delivery)", async () => {
    const harness = await createAssetHarness({ editMode: true });
    harnesses.push(harness);
    const handle = harness.app.assets.load("data/anonymous", { type: "text" });
    harness.net.expect("assets/data/anonymous").respond("hello");
    await harness.settle();
    expect(handle.value).toBe("hello");
  });

  it("advances a tween the host started (tweens)", async () => {
    const harness = await testApp(true);
    const target = { value: 0 };
    harness.app.tweens.to(target, { value: 10 }, { duration: 1 });
    for (let frame = 0; frame < 5; frame += 1) {
      harness.step(0.1);
    }
    expect(target.value).toBeCloseTo(5, 6);
  });

  it("picks the highest-priority camera as the main camera (render sync)", async () => {
    const harness = await testApp(true);
    harness.world.createEntity("Game").addComponent(Camera, { priority: 0 });
    const editor = harness.world.createEntity("Editor").addComponent(Camera, { priority: 1_000_000 });
    harness.step(FRAME);
    expect(harness.world.mainCamera).toBe(editor);
  });
});

describe("isStatic in edit mode", () => {
  it("stays writable after the first frame, where a game app refuses the change", async () => {
    const editor = await testApp(true);
    const loaded = editor.world.createEntity("Rock");
    editor.step(FRAME);
    loaded.isStatic = true;
    expect(loaded.isStatic).toBe(true);
    loaded.isStatic = false;
    expect(loaded.isStatic).toBe(false);

    const game = await testApp(false);
    const frozen = game.world.createEntity("Rock");
    game.step(FRAME);
    expect(() => {
      frozen.isStatic = true;
    }).toThrow(CoreErrorCode.mutationAfterDestroy);
  });
});

/** Version 1 of a script that does not run in edit mode. */
class SwitchV1 extends Everything {
  static override typeId = "test/EditSwitch";
}

/** Version 2 of the same script, opted in. */
class SwitchV2 extends Everything {
  static override typeId = "test/EditSwitch";
  static runInEditMode = true;
}

/** Version 3: the same as version 2 with a changed method, still opted in. */
class SwitchV3 extends Everything {
  static override typeId = "test/EditSwitch";
  static runInEditMode = true;

  override update(): void {
    this.record("update:v3");
  }
}

describe("hot reload in edit mode", () => {
  it("re-creates the instances of a class whose runInEditMode flipped, so setup and teardown match", async () => {
    const harness = await testApp(true);
    harness.app.registerComponents([SwitchV1]);
    harness.world.createEntity("Switch").addComponent(SwitchV1);
    harness.step(FRAME);
    expect(harness.log).toEqual([]);

    const on = reload(harness.app, SwitchV2);
    expect(on.kind).toBe("recreate");
    harness.step(FRAME);
    expect(harness.log.slice(0, 3)).toEqual(["awake", "onEnable", "start"]);

    harness.log.length = 0;
    const off = reload(harness.app, SwitchV1);
    expect(off.kind).toBe("recreate");
    expect(harness.log).toEqual(["onDisable", "onDestroy"]);
    harness.log.length = 0;
    stepMany(harness, 3);
    expect(harness.log).toEqual([]);
  });

  it("patches a class whose runInEditMode did not change, with no callback re-run", async () => {
    const harness = await testApp(true);
    harness.app.registerComponents([SwitchV2]);
    harness.world.createEntity("Switch").addComponent(SwitchV2);
    harness.step(FRAME);
    harness.log.length = 0;

    const report = reload(harness.app, SwitchV3);
    harness.step(FRAME);

    expect(report.kind).toBe("patch");
    expect(harness.log).toEqual(["update:v3", "lateUpdate"]);
  });

  it("re-creates a recreate-policy script that does not run in edit mode without any callback", async () => {
    class RecreatedV1 extends Everything {
      static override typeId = "test/EditRecreated";
      static hotReload = "recreate" as const;
    }
    class RecreatedV2 extends Everything {
      static override typeId = "test/EditRecreated";
      static hotReload = "recreate" as const;
    }
    const harness = await testApp(true);
    harness.app.registerComponents([RecreatedV1]);
    harness.world.createEntity("Recreated").addComponent(RecreatedV1);
    harness.step(FRAME);

    const report = reload(harness.app, RecreatedV2);
    stepMany(harness, 2);

    expect(report.kind).toBe("recreate");
    expect(harness.log).toEqual([]);
  });

  it("patches a class in a game app even when runInEditMode flipped", async () => {
    const harness = await testApp(false);
    harness.app.registerComponents([SwitchV1]);
    harness.world.createEntity("Switch").addComponent(SwitchV1);
    harness.step(FRAME);
    expect(reload(harness.app, SwitchV2).kind).toBe("patch");
  });
});
