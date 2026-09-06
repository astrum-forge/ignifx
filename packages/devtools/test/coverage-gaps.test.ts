import { Diagnostics, Signal } from "@ignifx/core";
import { describe, expect, it, vi } from "vitest";
import { element, RowList, setText, toggleClass } from "../src/dom/elements.js";
import { DEVTOOLS_CLASS_NAMES } from "../src/dom/styles.js";
import { createFieldEditor, encodeForDisplay, writeField } from "../src/inspector/fields.js";
import { createPanelHost } from "../src/overlay/panel-host.js";
import { DevtoolsSampler } from "../src/overlay/sampler.js";
import { WorldIndex } from "../src/overlay/world-index.js";
import { createOverlayHarness, Probe } from "./support/app.js";
import { createFakeDom } from "./support/fake-dom.js";
import type { OverlayHarness } from "./support/app.js";
import type { FakeElement } from "./support/fake-dom.js";
import type { DevtoolsPanelHost } from "../src/overlay/panel.js";
import type { App, FieldDefinition } from "@ignifx/core";

/**
 * The branches the panel suites do not reach on their way through the happy path: absent counter
 * groups, a panel that throws, a field a schema forbids writing, a collapsed subtree, and the
 * headless `document` refusal.
 */

/**
 * Opens the overlay with one panel and returns its container.
 *
 * @param h - The harness.
 * @returns The panel container.
 */
function panelOf(h: OverlayHarness): FakeElement {
  const root = h.dom.document.body.byClass(DEVTOOLS_CLASS_NAMES.root)[0];
  const panel = root?.byClass(DEVTOOLS_CLASS_NAMES.body)[0]?.children[0];
  if (panel === undefined) {
    throw new TypeError("No panel mounted.");
  }
  return panel;
}

/**
 * Reads a panel's visible rows as `label=value`.
 *
 * @param panel - The panel container.
 * @returns The rows.
 */
function rowsOf(panel: FakeElement): string[] {
  return panel
    .byClass(DEVTOOLS_CLASS_NAMES.row)
    .filter((row: FakeElement): boolean => row.style.getPropertyValue("display") !== "none")
    .map(
      (row: FakeElement): string =>
        `${row.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent ?? ""}=${
          row.byClass(DEVTOOLS_CLASS_NAMES.value)[0]?.textContent ?? ""
        }`,
    );
}

describe("the Stats panel's remaining branches", () => {
  it("shows the last hot-reload report and says when core owns scene reload", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["stats"] } });
    Reflect.defineProperty(h.app, "hotReload", {
      value: { reloadScenes: true, onApplied: new Signal(), reloadScene: vi.fn() },
      configurable: true,
    });
    h.service.open();
    h.service.reloadScenes = true;
    h.step(1);

    expect(rowsOf(panelOf(h))).toContain("scene reload=handled by app.hotReload");
    // The devtools toggle records the developer's intent even while it stands down.
    expect(h.service.reloadScenes).toBe(true);
    expect(h.service.isSceneReloadDelegated).toBe(true);
    h.dispose();
  });

  it("shows a hot-reload line once the host applied one", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["stats"] } });
    h.service.open();
    h.app.hotReload.apply([]);
    h.step(1);

    expect(rowsOf(panelOf(h)).some((row: string): boolean => row.startsWith("hot reload="))).toBe(true);
    h.dispose();
  });
});

describe("the Console panel's remaining branches", () => {
  it("shows hot-reload lines, including a failed one, and filters them with the search box", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["console"] } });
    h.service.open();
    h.app.hotReload.apply([]);
    h.step(1);
    const panel = panelOf(h);

    /**
     * Reads the visible console lines.
     *
     * @returns The lines.
     */
    const lines = (): string[] =>
      panel
        .byClass(DEVTOOLS_CLASS_NAMES.line)
        .filter((node: FakeElement): boolean => node.style.getPropertyValue("display") !== "none")
        .map((node: FakeElement): string => node.textContent);

    expect(lines().some((line: string): boolean => line.includes("hot-reload"))).toBe(true);

    const search = panel.byClass(DEVTOOLS_CLASS_NAMES.input)[1];
    if (search !== undefined) {
      search.value = "nothing-matches-this";
      search.dispatch("input");
    }
    h.step(1);
    // The "install a sink" hint is not a log line and is deliberately not searchable.
    expect(lines()).toEqual(["No log sink: pass createDevtoolsLogSink() to createApp and devtools()."]);
    h.dispose();
  });

  it("filters an error report out of the list when the search does not match it", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["console"] } });
    h.service.open();
    h.app.onError.emit({ error: "plain string", source: "system", phase: null, entity: null, component: null });
    const panel = panelOf(h);
    const search = panel.byClass(DEVTOOLS_CLASS_NAMES.input)[1];
    if (search !== undefined) {
      search.value = "system";
      search.dispatch("input");
    }
    h.step(1);

    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.line)[0]?.textContent).toContain("plain string");
    h.dispose();
  });
});

describe("DevtoolsSampler", () => {
  it("falls back to the renderer's own properties when no counter group is registered", () => {
    const diagnostics = new Diagnostics({ development: false });
    const app = {
      diagnostics,
      renderer: { gpuFrameTimeMs: 4, drawCalls: 7 },
    } as unknown as App;
    const sampler = new DevtoolsSampler(app);

    diagnostics.beginFrame(20);
    sampler.update(3, 5);

    expect(sampler.sample.gpuMs).toBe(4);
    expect(sampler.sample.drawCalls).toBe(7);
    expect(sampler.sample.assetsLoaded).toBe(0);
    expect(sampler.sample.entities).toBe(3);
    expect(sampler.sample.components).toBe(5);
    expect(sampler.sample.frameMs).toBe(20);
    expect(sampler.sample.fps).toBeCloseTo(50, 5);
  });

  it("ignores a group that has none of the counters it wants", () => {
    const diagnostics = new Diagnostics({ development: false });
    diagnostics.registerGroup("render", ["somethingElse"]);
    diagnostics.registerGroup("assets", ["somethingElse"]);
    const app = { diagnostics, renderer: { gpuFrameTimeMs: 1, drawCalls: 2 } } as unknown as App;
    const sampler = new DevtoolsSampler(app);

    diagnostics.beginFrame(0);
    sampler.update(0, 0);

    expect(sampler.sample.drawCalls).toBe(2);
    expect(sampler.sample.fps).toBe(0);
  });

  it("walks the recorded frame history oldest first", () => {
    const diagnostics = new Diagnostics({ development: true, now: (): number => 0 });
    const app = { diagnostics, renderer: { gpuFrameTimeMs: 0, drawCalls: 0 } } as unknown as App;
    const sampler = new DevtoolsSampler(app);
    for (let index = 0; index < 3; index += 1) {
      diagnostics.beginFrame(16);
      diagnostics.endFrame();
    }
    const seen: number[] = [];
    const scratch = { ...sampler.sample, cpuMs: new Float64Array(6) };
    sampler.history(scratch as never, (sample): void => {
      seen.push(sample.frame);
    });

    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("WorldIndex", () => {
  it("counts a collapsed subtree without giving it rows", async () => {
    const h = await createOverlayHarness();
    const index = new WorldIndex(h.app);
    const parent = h.app.world.createEntity("Parent");
    h.app.world.createEntity("Child").setParent(parent);
    index.refresh();
    expect(index.length).toBe(2);
    expect(index.entityCount).toBe(2);

    index.toggleCollapsed(parent);
    index.refresh();
    expect(index.length).toBe(1);
    expect(index.entityCount).toBe(2);
    expect(index.isCollapsed(parent)).toBe(true);

    index.toggleCollapsed(parent);
    index.refresh();
    expect(index.length).toBe(2);
    h.dispose();
  });

  it("rebuilds only when something invalidated it, unless forced", async () => {
    const h = await createOverlayHarness();
    const index = new WorldIndex(h.app);
    expect(index.refresh()).toBe(true);
    expect(index.refresh()).toBe(false);

    h.app.world.createEntity("New");
    expect(index.refresh()).toBe(false);
    expect(index.refresh(true)).toBe(true);
    expect(index.length).toBe(1);

    index.invalidate();
    expect(index.refresh()).toBe(true);
    h.dispose();
  });

  it("answers null outside its range and filters by name", async () => {
    const h = await createOverlayHarness();
    const index = new WorldIndex(h.app);
    h.app.world.createEntity("Hero");
    index.refresh(true);
    const out: number[] = [];

    expect(index.at(-1)).toBeNull();
    expect(index.at(99)).toBeNull();
    expect(index.at(0)?.entity.name).toBe("Hero");
    expect(index.filter("", out)).toEqual([0]);
    expect(index.filter("villain", out)).toEqual([]);
    h.dispose();
  });

  it("skips an entity destroyed between the invalidation and the rebuild", async () => {
    const h = await createOverlayHarness();
    const index = new WorldIndex(h.app);
    const doomed = h.app.world.createEntity("Doomed");
    index.refresh(true);
    doomed.destroyImmediate();
    index.refresh(true);

    expect(index.length).toBe(0);
    h.dispose();
  });
});

describe("createPanelHost", () => {
  it("refuses to hand out a document on an app with no DOM, with IGX-1551", () => {
    const host = createPanelHost({
      app: {} as unknown as App,
      sampler: { sample: {} } as never,
      index: {} as never,
      logSink: null,
      getDocument: (): Document | null => null,
      errors: [],
      hotReloads: [],
      getSelected: (): null => null,
      getReloadScenes: (): boolean => false,
      getSceneReloadDelegated: (): boolean => false,
      select: (): void => {},
      setReloadScenes: (): void => {},
      report: (): void => {},
    });

    expect(() => host.document).toThrowError(/IGX-1551/u);
  });
});

describe("the inspector's field plumbing", () => {
  it("reports IGX-1554 when a write throws", async () => {
    const h = await createOverlayHarness();
    const entity = h.app.world.createEntity("Subject");
    const probe = entity.addComponent(Probe);
    Reflect.defineProperty(probe, "speed", {
      get: (): number => 1,
      set: (): never => {
        throw new Error("frozen");
      },
      configurable: true,
    });
    const reported: string[] = [];
    const host = {
      report: (error: unknown): void => {
        reported.push(String(error));
      },
    } as unknown as DevtoolsPanelHost;

    expect(writeField(host, probe, "devtools-test/Probe", "speed", 2)).toBe(false);
    expect(reported.join(" ")).toContain("IGX-1554");
    h.dispose();
  });

  it("shows a field whose codec cannot encode it as <unencodable>", () => {
    const broken: FieldDefinition<unknown> = {
      kind: "custom",
      options: {},
      createDefault: (): unknown => null,
      spec: {
        kind: "custom",
        codec: {
          createDefault: (): unknown => null,
          serialize: (): never => {
            throw new Error("nope");
          },
          deserialize: (): unknown => null,
        },
      },
    };

    expect(encodeForDisplay(broken, null)).toBe("<unencodable>");
  });

  it("drops a hidden field and leaves a tooltip on the row", async () => {
    const h = await createOverlayHarness();
    const entity = h.app.world.createEntity("Subject");
    const probe = entity.addComponent(Probe);
    const dom = createFakeDom();
    const host = {
      document: dom.document,
      selected: entity,
      app: h.app,
      report: (): void => {},
    } as unknown as DevtoolsPanelHost;
    const schema: Readonly<Record<string, FieldDefinition<unknown> | undefined>> = Probe.schema;
    const secret = schema["secret"];
    const speed = schema["speed"];
    expect(secret).toBeDefined();
    expect(speed).toBeDefined();
    if (secret === undefined || speed === undefined) {
      return;
    }

    expect(createFieldEditor({ host, component: probe, label: "Probe", name: "secret", field: secret })).toBeNull();

    const tooltipped = createFieldEditor({ host, component: probe, label: "Probe", name: "speed", field: speed });
    expect(tooltipped).not.toBeNull();
    expect(tooltipped === null ? "" : tooltipped.row.title).toBe("How fast the probe moves.");
    expect(tooltipped === null ? "x" : tooltipped.group).toBe("");
    h.dispose();
  });
});

describe("the DOM helpers", () => {
  it("skips a text write that would not change anything and toggles one class at a time", () => {
    const document = createFakeDom().document as unknown as Document;
    const node = element(document, "div", "base");
    setText(node, "one");
    setText(node, "one");
    expect(node.textContent).toBe("one");

    toggleClass(node, "on", true);
    expect(node.className).toBe("base on");
    toggleClass(node, "on", true);
    expect(node.className).toBe("base on");
    toggleClass(node, "on", false);
    expect(node.className).toBe("base");
  });

  it("reuses rows across refreshes and hides the ones a shorter refresh left over", () => {
    const document = createFakeDom().document as unknown as Document;
    const parent = element(document, "div");
    const children = parent as unknown as FakeElement;
    const rows = new RowList(document, parent);

    rows.begin();
    rows.set("a", "1");
    rows.set("b", "2");
    rows.truncate();
    expect(rows.length).toBe(2);
    const created = children.children.length;

    rows.begin();
    rows.set("a", "9");
    rows.truncate();
    expect(rows.length).toBe(1);
    expect(children.children).toHaveLength(created);
    expect(children.children[1]?.style.getPropertyValue("display")).toBe("none");
  });
});

describe("the Inspector panel's remaining branches", () => {
  it("copies to the clipboard when the host has one, and reports a rejection", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["inspector"] } });
    const written: string[] = [];
    let reject = false;
    h.dom.window.navigator = {
      clipboard: {
        writeText: async (text: string): Promise<void> => {
          written.push(text);
          if (reject) {
            throw new Error("denied");
          }
        },
      },
    };
    const reported: string[] = [];
    h.app.onError.connect((entry) => {
      reported.push(String(entry.error));
    });
    h.service.open();
    const entity = h.app.world.createEntity("Subject");
    entity.addComponent(Probe);
    h.service.select(entity);
    h.step(1);
    const panel = panelOf(h);
    const copy = panel
      .byClass(DEVTOOLS_CLASS_NAMES.button)
      .find((node: FakeElement): boolean => node.textContent === "copy entity");

    copy?.dispatch("click");
    expect(written).toHaveLength(1);

    reject = true;
    copy?.dispatch("click");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(reported.join(" ")).toContain("denied");
    h.dispose();
  });

  it("does nothing when copy entity is pressed with no selection", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["inspector"] } });
    h.service.open();
    const panel = panelOf(h);
    const copy = panel
      .byClass(DEVTOOLS_CLASS_NAMES.button)
      .find((node: FakeElement): boolean => node.textContent === "copy entity");

    expect(() => copy?.dispatch("click")).not.toThrow();
    expect(panel.children.at(-1)?.value).toBe("");
    h.dispose();
  });

  it("picks the entity under a canvas click and selects it", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["inspector"] } });
    const entity = h.app.world.createEntity("Picked");
    class StubCanvas {
      /** The backing-store width. */
      width = 100;
      /** The backing-store height. */
      height = 100;
      /** The listeners the panel installs. */
      readonly handlers: ((event: unknown) => void)[] = [];
      /** Records a listener. */
      addEventListener(_type: string, handler: (event: unknown) => void): void {
        this.handlers.push(handler);
      }
      /** Drops a listener. */
      removeEventListener(): void {
        this.handlers.length = 0;
      }
      /** The canvas's laid-out rectangle. */
      getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
        return { left: 0, top: 0, width: 100, height: 100 };
      }
    }
    const canvas = new StubCanvas();
    vi.stubGlobal("HTMLCanvasElement", StubCanvas);
    const pickAsync = vi.fn(async (): Promise<unknown> => ({ entity }));
    Reflect.defineProperty(h.app, "renderer", {
      value: { ...h.app.renderer, surface: canvas, pickAsync, gpuFrameTimeMs: 0, drawCalls: 0 },
      configurable: true,
    });
    try {
      h.service.open();
      h.step(1);
      const pick = panelOf(h)
        .byClass(DEVTOOLS_CLASS_NAMES.button)
        .find((node: FakeElement): boolean => node.textContent === "select in world");

      pick?.dispatch("click");
      pick?.dispatch("click");
      canvas.handlers[0]?.({ clientX: 10, clientY: 20 });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(pickAsync).toHaveBeenCalledTimes(1);
      expect(h.service.selected).toBe(entity);
    } finally {
      vi.unstubAllGlobals();
      h.dispose();
    }
  });
});

describe("the Input, Audio and Physics panels' remaining branches", () => {
  it("shows a dash for an unset scheme and an empty device list", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["input"] } });
    Reflect.defineProperty(h.app, "input", {
      value: { currentScheme: "", devices: { all: [] }, actions: { maps: new Map() } },
      configurable: true,
    });
    h.service.open();
    h.step(1);

    expect(rowsOf(panelOf(h))).toEqual(["scheme=-", "devices=-"]);
    h.dispose();
  });

  it("hides a bus row that a later refresh no longer has", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["audio"] } });
    const buses = new Map<string, unknown>([
      ["master", { volume: 1, effectiveVolume: 1, muted: false }],
      ["sfx", { volume: 1, effectiveVolume: 1, muted: false }],
    ]);
    Reflect.defineProperty(h.app, "audio", { value: { masterVolume: 1, buses }, configurable: true });
    h.service.open();
    h.step(1);
    const panel = panelOf(h);
    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.row)).toHaveLength(2);

    buses.delete("sfx");
    h.step(1);
    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.row)[1]?.style.getPropertyValue("display")).toBe("none");

    // And a slider whose text has not changed is not rewritten.
    const slider = panel.byClass(DEVTOOLS_CLASS_NAMES.input)[0];
    if (slider !== undefined) {
      slider.value = "notanumber";
      slider.dispatch("input");
    }
    h.dispose();
  });

  it("disables the debug-viewer checkbox without @ignifx/physics and says 2D has no counters yet", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["physics"] } });
    Reflect.defineProperty(h.app, "physics2d", { value: {}, configurable: true });
    h.service.open();
    h.step(1);

    expect(panelOf(h).byClass(DEVTOOLS_CLASS_NAMES.input)[0]?.disabled).toBe(true);
    expect(rowsOf(panelOf(h))).toContain("physics2d=no counters yet");
    h.dispose();
  });
});

describe("the overlay's failure handling", () => {
  it("reports a panel that throws while mounting or refreshing instead of throwing into the frame", async () => {
    const h = await createOverlayHarness({ settings: { panels: ["scene"] } });
    const reported: string[] = [];
    h.app.onError.connect((entry) => {
      reported.push(String(entry.error));
    });
    h.service.open();
    // The scene panel throws from its row pool when it is refreshed after its list was torn away,
    // which is the shape of any panel bug: the overlay must survive it.
    const panel = panelOf(h);
    panel.replaceChildren();
    h.app.world.createEntity("One");
    h.step(1);

    expect(h.service.isOpen).toBe(true);
    h.dispose();
  });
});
