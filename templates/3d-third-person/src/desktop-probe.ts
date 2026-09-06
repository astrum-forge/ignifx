// oxlint-disable no-underscore-dangle -- `window.__ignifxProbe` is a test hook, and the double
// underscore is what says it is not part of the game's API. The desktop suite reads it by name.
import { forceRendererDeviceLossForTesting, Light, Script } from "@ignifx/core";
import type { App, Coroutine, Entity } from "@ignifx/core";

/**
 * A **test-only** hook for `tests/visual/tests/desktop.spec.ts`, installed only when the page is
 * opened with `?probe=1`. A shipped game never sees it: nothing below runs without the flag, and
 * the flag is not something a player types.
 *
 * It exists for one exit criterion in `docs/plan/engineering-plan.md` Phase 9 — *a forced device
 * loss in a running desktop template recovers with physics, coroutines and audio intact* — which
 * needs two things a game has no business exposing: a way to break the GPU device on purpose, and a
 * way to read the three subsystems back afterwards.
 *
 * ## How the device loss is forced
 *
 * `@babylonjs/lite` exports `forceWebGpuDeviceLossForTesting(engine)`, but nothing outside
 * `packages/core/src/lite/**` may import Lite (`CONSTITUTION.md` §3.4). `@ignifx/core` wraps it as
 * `forceRendererDeviceLossForTesting(app.renderer)` — an `@internal` seam added in
 * Phase 9 for exactly this probe — which marks the next loss as real (otherwise Lite treats a
 * `"destroyed"` device as a deliberate teardown and does not recover) and then destroys the device.
 *
 * ## Why the probe sets the sun's shadow technique
 *
 * Babylon Lite 1.27.0 can only rebuild an **ESM** directional shadow generator after a device loss
 * (`lib/shadow/shadow-recovery.js` throws Lite error 463 for every other technique). The level ships
 * ESM since Phase 9 for exactly that reason; the probe still sets it explicitly so this test does not
 * silently depend on the level's choice. `docs/adr/0018-electron-tooling.md` records the limitation.
 */

/** What one probe reading contains. */
export interface ProbeSnapshot {
  /** The height of the first crate, in metres — the physics world's observable state. */
  readonly crateY: number;
  /** How many times the probe's coroutine has resumed since it started. */
  readonly coroutineTicks: number;
  /** `app.audio.state`. */
  readonly audioState: string;
  /** `app.renderer.drawCalls` of the last frame. */
  readonly drawCalls: number;
  /** How many times `app.events.onDeviceLost` has fired. */
  readonly deviceLost: number;
  /** How many times `app.events.onDeviceRecovered` has fired. */
  readonly deviceRecovered: number;
  /** How many times `app.events.onDeviceRecoveryFailed` has fired. */
  readonly deviceRecoveryFailed: number;
  /** `app.platform.kind`. */
  readonly platformKind: string;
  /** `app.desktop.isElectron`. */
  readonly isElectron: boolean;
}

/** The hook `tests/visual/tests/desktop.spec.ts` drives. */
export interface DesktopProbe {
  /**
   * Destroys the GPU device in the way Lite's recovery accepts.
   *
   * @returns `"forced"` when the loss was armed and the device destroyed, or a reason it was not.
   */
  forceDeviceLoss(): string;
  /**
   * Reads the three subsystems and the device-loss counters.
   *
   * @returns The current reading.
   */
  snapshot(): ProbeSnapshot;
  /**
   * Writes and reads back one value through `app.storage`, which on a desktop build is the
   * file-system backend behind the preload bridge.
   *
   * @returns What came back, or `null`.
   */
  roundTripStorage(): Promise<string | null>;
}

declare global {
  interface Window {
    /** The test hook, present only under `?probe=1`. */
    __ignifxProbe?: DesktopProbe;
  }
}

/**
 * A script whose only job is to prove the frame loop is still running.
 *
 * @remarks
 * A coroutine needs a `Script` to own it (`app.coroutines.start(owner, routine)`), and owning it
 * from a script is also what makes the count honest: a coroutine resumes from the scheduler inside
 * a frame, so if the device loss stopped the loop the count stops with it.
 */
export class ProbeTicker extends Script {
  /** The component type id, as every ignifx component declares one. */
  static typeId = "3d-third-person/ProbeTicker";

  /** How many times the coroutine has resumed. */
  ticks = 0;

  /** Starts the counting coroutine. */
  onEnable(): void {
    this.startCoroutine(this.#count());
  }

  /**
   * Counts one per frame, forever.
   *
   * @yields {undefined} Once per frame, so the scheduler resumes it on the next one.
   * @returns Never: the loop has no exit.
   */
  *#count(): Coroutine {
    // `for (;;)` rather than `while (true)`: the linter reads the literal as an always-truthy
    // condition, and this loop genuinely has no exit — the scheduler stops it when the script is
    // destroyed.
    for (;;) {
      this.ticks += 1;
      yield undefined;
    }
  }
}

/**
 * Installs the probe on `window.__ignifxProbe`.
 *
 * @param app - The running app.
 * @param crates - The level's crates; the first one's height is the physics reading.
 */
export function installDesktopProbe(app: App, crates: readonly Entity[]): void {
  // See the module comment: Lite 1.27.0 recovers ESM generators and nothing else.
  const sun = app.world.findByName("Sun")?.getComponent(Light) ?? null;
  if (sun !== null) {
    sun.shadows.technique = "esm";
  }

  let deviceLost = 0;
  let deviceRecovered = 0;
  let deviceRecoveryFailed = 0;

  app.events.onDeviceLost.connect(() => {
    deviceLost += 1;
  });
  app.events.onDeviceRecovered.connect(() => {
    deviceRecovered += 1;
  });
  app.events.onDeviceRecoveryFailed.connect(() => {
    deviceRecoveryFailed += 1;
  });

  // A coroutine that never finishes: if the frame loop survives the device loss, this keeps
  // counting, and if it does not, the count freezes. That is the whole assertion.
  app.registerComponents([ProbeTicker]);
  const ticker = app.world.createEntity("Probe").addComponent(ProbeTicker);

  window.__ignifxProbe = {
    forceDeviceLoss(): string {
      // Core's `@internal` seam; it throws when device-loss recovery is not enabled or under the null
      // engine, and the message is what the test reads back.
      try {
        forceRendererDeviceLossForTesting(app.renderer);
        return "forced";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },

    snapshot(): ProbeSnapshot {
      return {
        crateY: crates[0]?.transform.position.y ?? Number.NaN,
        coroutineTicks: ticker.ticks,
        audioState: app.audio.state,
        drawCalls: app.renderer.drawCalls,
        deviceLost,
        deviceRecovered,
        deviceRecoveryFailed,
        platformKind: app.platform.kind,
        isElectron: app.desktop.isElectron,
      };
    },

    async roundTripStorage(): Promise<string | null> {
      const saves = app.storage.namespace("saves");
      await saves.set("probe", { written: "yes" });
      const read = await saves.get<{ readonly written: string }>("probe");
      return read?.written ?? null;
    },
  };
}
