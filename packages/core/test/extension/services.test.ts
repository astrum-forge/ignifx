import { afterEach, describe, expect, it } from "vitest";
import { createApp, createManualClock, createMemorySink, createServiceKey } from "../../src/index.js";
import type { App, IgnifxError, ServiceKey } from "../../src/index.js";

/** The service table (`docs/architecture/04-extensions.md` §1, §3). */

class Storage {
  readonly rows: string[] = [];
}

/** A service class nothing ever registers, so `services.get` has a class key to name. */
class Absent {
  readonly missing = true;
}

const StorageKey: ServiceKey<Storage> = createServiceKey<Storage>("storage");

let created: App | null = null;

afterEach(() => {
  created?.dispose();
  created = null;
});

/**
 * Builds a headless app that registers both kinds of key.
 *
 * @returns The app.
 */
async function build(): Promise<App> {
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logSink: createMemorySink(),
    extensions: [
      {
        name: "game/storage",
        version: "1.0.0",
        register(ctx): void {
          ctx.registerService(Storage, new Storage());
          ctx.registerService(StorageKey, new Storage());
        },
      },
    ],
  });
  created = app;
  return app;
}

describe("app.services", () => {
  it("resolves a class key and a named key", async () => {
    const app = await build();
    expect(app.services.get(Storage)).toBeInstanceOf(Storage);
    expect(app.services.get(StorageKey)).toBeInstanceOf(Storage);
    expect(app.services.get(Storage)).not.toBe(app.services.get(StorageKey));
    expect(app.services.has(Storage)).toBe(true);
  });

  it("returns null for a service nothing registered", async () => {
    const app = await build();
    const missing = createServiceKey<Storage>("missing");
    expect(app.services.tryGet(missing)).toBeNull();
    expect(app.services.has(missing)).toBe(false);
  });

  it("throws IGX-0405 naming the key when a required service is absent", async () => {
    const app = await build();
    const missing = createServiceKey<Storage>("missing");
    try {
      app.services.get(missing);
    } catch (error) {
      expect((error as IgnifxError).code).toBe("IGX-0405");
      expect((error as IgnifxError).message).toContain("missing");
      return;
    }
    throw new Error("services.get should have thrown");
  });

  it("names a class key by its class name", async () => {
    const app = await build();
    try {
      app.services.get(Absent);
    } catch (error) {
      expect((error as IgnifxError).message).toContain("Absent");
      return;
    }
    throw new Error("services.get should have thrown");
  });

  it("empties the table when the app is disposed", async () => {
    const app = await build();
    app.dispose();
    created = null;
    expect(app.services.has(Storage)).toBe(false);
  });

  it("makes a named key a frozen module-scope constant", () => {
    expect(Object.isFrozen(StorageKey)).toBe(true);
    expect(StorageKey).toEqual({ serviceName: "storage" });
  });
});
