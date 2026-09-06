import { describe, expect, it, vi } from "vitest";
import { asDomCanvas, resolveDevtoolsTarget } from "../src/dom/dom-target.js";
import { formatBytes, formatCount, formatMs } from "../src/dom/format.js";
import { hasPhysics2D, probeAssetReload, probeAudio, probeInput, probePhysicsDebug, probeUi } from "../src/probes.js";
import { createDevtoolsApp } from "./support/app.js";
import type { App } from "@ignifx/core";

/**
 * The structural reach into the five optional peers, and the DOM target resolution that decides
 * whether there is an overlay at all. Neither imports the package it reads, which is the property
 * these tests exist to keep.
 */

/**
 * Defines a property on an app the way a registered extension would.
 *
 * @param app - The app.
 * @param name - The property name.
 * @param value - The value.
 */
function define(app: App, name: string, value: unknown): void {
  Reflect.defineProperty(app, name, { value, configurable: true });
}

describe("probeUi", () => {
  it("answers null without @ignifx/ui, and null for an inert overlay", async () => {
    const h = await createDevtoolsApp();
    expect(probeUi(h.app)).toBeNull();

    define(h.app, "ui", { isActive: false, layer: (): unknown => ({ element: null }) });
    expect(probeUi(h.app)).toBeNull();

    define(h.app, "ui", { isActive: true });
    expect(probeUi(h.app)).toBeNull();
    h.dispose();
  });

  it("answers the host when the overlay is live", async () => {
    const h = await createDevtoolsApp();
    define(h.app, "ui", { isActive: true, layer: (): unknown => ({ element: null }) });

    expect(probeUi(h.app)).not.toBeNull();
    h.dispose();
  });
});

describe("probeInput", () => {
  it("answers null without @ignifx/input", async () => {
    const h = await createDevtoolsApp();
    expect(probeInput(h.app)).toBeNull();
    h.dispose();
  });

  it("formats every action value shape and skips disconnected devices", async () => {
    const h = await createDevtoolsApp();
    define(h.app, "input", {
      currentScheme: "gamepad",
      devices: {
        all: [
          { kind: "keyboard", deviceIndex: 0, isConnected: true },
          { kind: "gamepad", deviceIndex: 2, isConnected: true },
          { kind: "touch", deviceIndex: 0, isConnected: false },
          { deviceIndex: 0, isConnected: true },
        ],
      },
      actions: {
        maps: new Map<unknown, unknown>([
          [
            "gameplay",
            {
              actions: new Map<unknown, unknown>([
                ["fire", { type: "button", value: true, isPressed: true }],
                ["throttle", { type: "axis", value: 0.5, isPressed: false }],
                ["move", { type: "vector2", value: { x: 0, y: 1 }, isPressed: false }],
                ["odd", { value: {} }],
                [1, { value: false }],
              ]),
            },
          ],
          ["broken", {}],
        ]),
      },
    });
    const probe = probeInput(h.app);

    expect(probe?.scheme).toBe("gamepad");
    expect(probe?.devices).toEqual(["keyboard", "gamepad #2"]);
    expect(probe?.actions.map((action) => `${action.action}=${action.value}`)).toEqual([
      "fire=true",
      "throttle=0.500",
      "move=0.000, 1.000",
      "odd=-",
    ]);
    expect(probe?.actions[3]?.type).toBe("button");
    h.dispose();
  });

  it("survives an input service with no device list and no scheme string", async () => {
    const h = await createDevtoolsApp();
    define(h.app, "input", { currentScheme: 0, devices: {}, actions: {} });
    const probe = probeInput(h.app);

    expect(probe?.scheme).toBe("");
    expect(probe?.devices).toEqual([]);
    expect(probe?.actions).toEqual([]);
    h.dispose();
  });
});

describe("probeAudio", () => {
  it("answers null without @ignifx/audio", async () => {
    const h = await createDevtoolsApp();
    expect(probeAudio(h.app)).toBeNull();
    h.dispose();
  });

  it("reads the bus tree and writes a volume back onto the bus", async () => {
    const h = await createDevtoolsApp();
    const sfx = { volume: 0.5, effectiveVolume: 0.25, muted: true };
    define(h.app, "audio", {
      masterVolume: "loud",
      buses: new Map<unknown, unknown>([
        ["sfx", sfx],
        ["broken", { volume: "x" }],
        [2, { volume: 1 }],
        ["noEffective", { volume: 0.75 }],
      ]),
    });
    const probe = probeAudio(h.app);

    expect(probe?.masterVolume).toBe(1);
    expect(probe?.buses.map((bus) => bus.name)).toEqual(["sfx", "noEffective"]);
    expect(probe?.buses[0]?.muted).toBe(true);
    expect(probe?.buses[1]?.effectiveVolume).toBeCloseTo(0.75, 5);

    probe?.buses[0]?.setVolume(0.9);
    expect(sfx.volume).toBeCloseTo(0.9, 5);
    h.dispose();
  });
});

describe("probePhysicsDebug and hasPhysics2D", () => {
  it("answer for an app with neither physics extension", async () => {
    const h = await createDevtoolsApp();

    expect(probePhysicsDebug(h.app)).toBeNull();
    expect(hasPhysics2D(h.app)).toBe(false);
    h.dispose();
  });

  it("read and write the debug viewer, and see a 2D service", async () => {
    const h = await createDevtoolsApp();
    const viewer = { enabled: true };
    define(h.app, "physics", { debugViewer: viewer });
    define(h.app, "physics2d", {});

    const probe = probePhysicsDebug(h.app);
    expect(probe?.enabled).toBe(true);
    probe?.setEnabled(false);
    expect(viewer.enabled).toBe(false);
    expect(hasPhysics2D(h.app)).toBe(true);
    h.dispose();
  });
});

describe("probeAssetReload", () => {
  it("finds the asset service's reload entry point and calls it on the service", async () => {
    const h = await createDevtoolsApp();
    const spy = vi.spyOn(h.app.assets as unknown as { reload: (address: string) => void }, "reload");
    const reload = probeAssetReload(h.app);
    expect(reload).not.toBeNull();

    reload?.("textures/hero.png");
    expect(spy).toHaveBeenCalledWith("textures/hero.png");
    h.dispose();
  });

  it("answers null on an asset service that has none", async () => {
    const h = await createDevtoolsApp();
    const assets = { ...h.app.assets, reload: undefined };
    define(h.app, "assets", assets);

    expect(probeAssetReload(h.app)).toBeNull();
    h.dispose();
  });
});

describe("resolveDevtoolsTarget", () => {
  it("answers null under Node, where there is no HTMLCanvasElement at all", () => {
    expect(asDomCanvas(null)).toBeNull();
    expect(resolveDevtoolsTarget(null)).toBeNull();
  });

  it("answers null for a detached canvas and the target for an attached one", () => {
    class StubCanvas {
      /** The document the stub belongs to. */
      ownerDocument: { defaultView: unknown } = { defaultView: null };
    }
    vi.stubGlobal("HTMLCanvasElement", StubCanvas);
    try {
      const detached = new StubCanvas();
      expect(resolveDevtoolsTarget(detached)).toBeNull();
      expect(resolveDevtoolsTarget({})).toBeNull();

      const view = {};
      const attached = new StubCanvas();
      attached.ownerDocument = { defaultView: view };
      const target = resolveDevtoolsTarget(attached);
      expect(target?.canvas).toBe(attached);
      expect(target?.window).toBe(view);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the shared formatters", () => {
  it("walks the binary unit ladder and marks an unmeasured size", () => {
    expect(formatBytes(-1)).toBe("-");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.00 KiB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MiB");
    expect(formatBytes(3 * 1024 ** 4)).toBe("3072.00 GiB");
  });

  it("groups digits in threes and keeps a sign", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(10_000)).toBe("10\u2009000");
    expect(formatCount(-1_234_567)).toBe("-1\u2009234\u2009567");
  });

  it("shows milliseconds with two decimals", () => {
    expect(formatMs(16.666)).toBe("16.67 ms");
  });
});
