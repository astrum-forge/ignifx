import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app/app.js";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { Script } from "../../src/script/script.js";
import { createManualClock } from "../../src/time/clock.js";
import { createTestApp } from "../support/app-harness.js";
import { HookedThrowing, HookedV1, HookedV2, Malformed, migrations, MoverV1, MoverV2, reload } from "./fixtures.js";
import type { ErrorReport } from "../../src/app/types.js";
import type { HotReloadReport } from "../../src/hot-reload/contract.js";
import type { TestAppHarness } from "../support/app-harness.js";

/**
 * `app.hotReload` itself (`docs/architecture/15-devtools-and-diagnostics.md` §5): the report, the
 * `onApplied` signal, the class-level migration hook, and the two guards.
 */

let harness: TestAppHarness;

beforeEach(async () => {
  harness = await createTestApp();
  harness.app.registerComponents([MoverV1, HookedV1]);
  migrations.length = 0;
});

afterEach(() => {
  harness.dispose();
});

/** A script that reloads its own class from inside `update`, which the host must refuse. */
class Reentrant extends Script {
  static typeId = "test/Reentrant";

  update(): void {
    reload(this.app, MoverV2);
  }
}

describe("app.hotReload", () => {
  it("emits the report it returns on onApplied", () => {
    harness.world.createEntity("Player").addComponent(MoverV1);
    harness.step(1 / 60);
    const seen: HotReloadReport[] = [];
    harness.app.hotReload.onApplied.connect((report) => {
      seen.push(report);
    });

    const report = reload(harness.app, MoverV2);

    expect(seen).toEqual([report]);
  });

  it("runs static onHotReload once, on the replacement, with the class it replaced", () => {
    harness.world.createEntity("A").addComponent(HookedV1);
    harness.world.createEntity("B").addComponent(HookedV1);
    harness.step(1 / 60);

    const report = reload(harness.app, HookedV2);

    expect(report.instances).toBe(2);
    expect(migrations).toEqual([HookedV1.name]);
  });

  it("reports a throwing onHotReload and finishes the remaining types", () => {
    const errors: ErrorReport[] = [];
    harness.app.onError.connect((report) => {
      errors.push(report);
    });
    harness.world.createEntity("A").addComponent(HookedV1);
    harness.world.createEntity("B").addComponent(MoverV1);
    harness.step(1 / 60);

    const report = harness.app.hotReload.apply([{ types: [HookedThrowing, MoverV2] }]);

    expect(report.errors).toHaveLength(1);
    expect(report.typeIds).toEqual(["test/Hooked", "test/Mover"]);
    expect(errors).toHaveLength(1);
    expect(harness.world.registry.get("test/Mover")).toBe(MoverV2);
    expect(harness.world.registry.get("test/Hooked")).toBe(HookedThrowing);
  });

  it("refuses to run inside a lifecycle callback with IGX-0208", () => {
    const errors: ErrorReport[] = [];
    harness.app.onError.connect((report) => {
      errors.push(report);
    });
    harness.world.createEntity("Player").addComponent(MoverV1);
    harness.world.createEntity("Reentrant").addComponent(Reentrant);

    harness.step(1 / 60);

    const first = errors[0]?.error;
    expect(isIgnifxError(first)).toBe(true);
    expect(isIgnifxError(first) ? first.code : null).toBe(CoreErrorCode.hotReloadInsideCallback);
    expect(harness.world.registry.get("test/Mover")).toBe(MoverV1);
  });

  it("skips a replaced class that declares no typeId", () => {
    class Anonymous extends Script {}

    // Boundary assertion: the HMR client hands over whatever a module exported, typeId or not.
    const report = harness.app.hotReload.apply([{ types: [Anonymous] }]);

    expect(report.typeIds).toEqual([]);
  });

  it("collects a failed registration instead of abandoning the reload", () => {
    const errors: ErrorReport[] = [];
    harness.app.onError.connect((report) => {
      errors.push(report);
    });
    harness.world.createEntity("Player").addComponent(MoverV1);
    harness.step(1 / 60);

    const report = harness.app.hotReload.apply([{ types: [Malformed, MoverV2] }]);

    expect(report.errors).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(isIgnifxError(report.errors[0]) ? report.errors[0].code : null).toBe(CoreErrorCode.duplicateComponentTypeId);
    expect(report.typeIds).toEqual(["test/Mover"]);
  });

  it("defaults reloadScenes to false and takes it from createApp", async () => {
    expect(harness.app.hotReload.reloadScenes).toBe(false);
    const app = await createApp({ headless: true, clock: createManualClock(), hotReload: { reloadScenes: true } });
    try {
      expect(app.hotReload.reloadScenes).toBe(true);
    } finally {
      app.dispose();
    }
  });
});
