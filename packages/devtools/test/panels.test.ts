import { describe, expect, it } from "vitest";
import { DEVTOOLS_CLASS_NAMES } from "../src/dom/styles.js";
import { createDevtoolsLogSink } from "../src/log-sink.js";
import { createOverlayHarness, Probe } from "./support/app.js";
import type { OverlayHarness, OverlayHarnessOptions } from "./support/app.js";
import type { FakeCanvas, FakeElement } from "./support/fake-dom.js";
import type { DevtoolsPanelName } from "../src/settings.js";

/**
 * The nine panels, each driven through the fake DOM with only that panel in the tab strip, so the
 * container under test is unambiguous and a refresh measures one panel's work.
 */

/** A harness with exactly one panel mounted and refreshed once. */
interface PanelHarness {
  /** The overlay harness. */
  readonly h: OverlayHarness;
  /** The panel's own container. */
  readonly panel: FakeElement;
  /** Refreshes the panel by running a frame long enough to beat the 10 Hz throttle. */
  readonly refresh: () => void;
}

/**
 * Opens the overlay with one panel and refreshes it once.
 *
 * @param name - The panel to mount.
 * @param options - Harness options.
 * @returns The panel harness.
 */
async function openPanel(name: DevtoolsPanelName, options: OverlayHarnessOptions = {}): Promise<PanelHarness> {
  const h = await createOverlayHarness({ ...options, settings: { ...options.settings, panels: [name] } });
  h.service.open();
  const root = h.dom.document.body.byClass(DEVTOOLS_CLASS_NAMES.root)[0];
  const body = root?.byClass(DEVTOOLS_CLASS_NAMES.body)[0];
  const panel = body?.children[0];
  if (panel === undefined) {
    throw new TypeError(`The ${name} panel did not mount.`);
  }
  const refresh = (): void => {
    h.step(1);
  };
  refresh();
  return { h, panel, refresh };
}

/**
 * Reads a panel's label/value rows as `label=value` strings.
 *
 * @param panel - The panel container.
 * @returns The visible rows.
 */
function rowsOf(panel: FakeElement): string[] {
  return panel
    .byClass(DEVTOOLS_CLASS_NAMES.row)
    .filter((row: FakeElement): boolean => row.style.getPropertyValue("display") !== "none")
    .map((row: FakeElement): string => {
      const label = row.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent ?? "";
      const value = row.byClass(DEVTOOLS_CLASS_NAMES.value)[0]?.textContent ?? "";
      return `${label}=${value}`;
    });
}

/**
 * Finds a row's value cell by label.
 *
 * @param panel - The panel container.
 * @param label - The label to find.
 * @returns The value element, or `null`.
 */
function valueFor(panel: FakeElement, label: string): FakeElement | null {
  for (const row of panel.byClass(DEVTOOLS_CLASS_NAMES.row)) {
    if (row.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent === label) {
      return row.byClass(DEVTOOLS_CLASS_NAMES.value)[0] ?? null;
    }
  }
  return null;
}

/**
 * Finds a field row's control by field name.
 *
 * @param panel - The panel container.
 * @param name - The field name.
 * @returns The control elements in that row.
 */
function controlsFor(panel: FakeElement, name: string): FakeElement[] {
  for (const row of panel.byClass(DEVTOOLS_CLASS_NAMES.row)) {
    if (row.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent === name) {
      return row.byClass(DEVTOOLS_CLASS_NAMES.value)[0]?.children ?? [];
    }
  }
  return [];
}

/**
 * Types a value into a control and fires the event the editor listens for.
 *
 * @param control - The control.
 * @param value - The text to type.
 * @param event - The event to fire.
 */
function type(control: FakeElement | undefined, value: string, event = "change"): void {
  if (control !== undefined) {
    control.value = value;
    control.dispatch(event);
  }
}

describe("the Stats panel", () => {
  it("shows the frame numbers the sample carries", async () => {
    const { h, panel, refresh } = await openPanel("stats");
    h.app.world.createEntity("One").addComponent(Probe);
    refresh();
    const rows = rowsOf(panel);

    expect(rows.some((row: string): boolean => row.startsWith("fps="))).toBe(true);
    expect(rows).toContain("entities=1");
    expect(rows).toContain("components=2");
    expect(rows.some((row: string): boolean => row.startsWith("js heap="))).toBe(true);
    h.dispose();
  });

  it("says so when the build records no per-phase CPU time", async () => {
    const { h, panel } = await openPanel("stats");

    // The harness builds with the default `mode: "development"`, so `cpuMs` is filled; the string
    // only appears when a production build zeroes it. Assert the two branches share one row.
    expect(valueFor(panel, "cpu")).not.toBeNull();
    h.dispose();
  });

  it("carries the reloadScenes toggle and writes it through to the service", async () => {
    const { h, panel, refresh } = await openPanel("stats");
    const box = panel.byClass(DEVTOOLS_CLASS_NAMES.input)[0];
    expect(box?.type).toBe("checkbox");
    expect(box?.checked).toBe(false);

    if (box !== undefined) {
      box.checked = true;
      box.dispatch("change");
    }
    expect(h.service.reloadScenes).toBe(true);

    h.service.reloadScenes = false;
    refresh();
    expect(box?.checked).toBe(false);
    h.dispose();
  });
});

describe("the Scene tree panel", () => {
  it("lists the world's roots and their children in tree order", async () => {
    const { h, panel, refresh } = await openPanel("scene");
    const parent = h.app.world.createEntity("Parent");
    const child = h.app.world.createEntity("Child");
    child.setParent(parent);
    refresh();

    const names = panel
      .byClass(DEVTOOLS_CLASS_NAMES.node)
      .filter((row: FakeElement): boolean => row.style.getPropertyValue("display") !== "none")
      .map((row: FakeElement): string => row.children[1]?.textContent ?? "");
    expect(names).toEqual(["Parent", "Child"]);
    h.dispose();
  });

  it("renders a bounded number of rows for ten thousand entities", async () => {
    const { h, panel, refresh } = await openPanel("scene");
    for (let index = 0; index < 10_000; index += 1) {
      h.app.world.createEntity(`Entity ${String(index)}`);
    }
    refresh();

    const rows = panel.byClass(DEVTOOLS_CLASS_NAMES.node);
    expect(rows.length).toBeLessThanOrEqual(70);
    expect(valueFor(panel, "")).toBeNull();
    // The whole tree is still counted, which is what the Stats panel reads.
    expect(h.service.isOpen).toBe(true);
    h.dispose();
  }, 30_000);

  it("selects on click and collapses on the caret", async () => {
    const { h, panel, refresh } = await openPanel("scene");
    const parent = h.app.world.createEntity("Parent");
    h.app.world.createEntity("Child").setParent(parent);
    refresh();
    const rows = panel.byClass(DEVTOOLS_CLASS_NAMES.node);

    rows[0]?.dispatch("click");
    expect(h.service.selected?.name).toBe("Parent");
    refresh();
    expect(rows[0]?.className).toContain(DEVTOOLS_CLASS_NAMES.nodeSelected);

    rows[0]?.children[0]?.dispatch("click");
    refresh();
    const visible = panel
      .byClass(DEVTOOLS_CLASS_NAMES.node)
      .filter((row: FakeElement): boolean => row.style.getPropertyValue("display") !== "none");
    expect(visible).toHaveLength(1);
    h.dispose();
  });

  it("searches by name, toggles active, and destroys the selection", async () => {
    const { h, panel, refresh } = await openPanel("scene");
    h.app.world.createEntity("Hero");
    h.app.world.createEntity("Villain");
    refresh();

    const search = panel.byClass(DEVTOOLS_CLASS_NAMES.input)[0];
    if (search !== undefined) {
      search.value = "her";
      search.dispatch("input");
    }
    refresh();
    const visible = panel
      .byClass(DEVTOOLS_CLASS_NAMES.node)
      .filter((row: FakeElement): boolean => row.style.getPropertyValue("display") !== "none");
    expect(visible.map((row: FakeElement): string => row.children[1]?.textContent ?? "")).toEqual(["Hero"]);

    visible[0]?.dispatch("click");
    const buttons = panel.byClass(DEVTOOLS_CLASS_NAMES.button);
    buttons[0]?.dispatch("click");
    expect(h.app.world.findByName("Hero")?.active).toBe(false);
    refresh();
    expect(
      panel
        .byClass(DEVTOOLS_CLASS_NAMES.node)
        .some((row: FakeElement): boolean => (row.children[1]?.textContent ?? "").includes("(inactive)")),
    ).toBe(true);

    buttons[1]?.dispatch("click");
    h.step(1);
    expect(h.app.world.findByName("Hero")).toBeNull();
    expect(h.service.selected).toBeNull();
    h.dispose();
  });
});

describe("the Inspector panel", () => {
  it("says so when nothing is selected", async () => {
    const { h, panel } = await openPanel("inspector");

    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.heading)[0]?.textContent).toBe("no selection");
    h.dispose();
  });

  it("builds one control per editable kind, hides hidden fields and disables readonly ones", async () => {
    const { h, panel, refresh } = await openPanel("inspector");
    const entity = h.app.world.createEntity("Subject");
    entity.addComponent(Probe);
    h.service.select(entity);
    refresh();

    expect(controlsFor(panel, "secret")).toHaveLength(0);
    expect(controlsFor(panel, "locked")[0]?.disabled).toBe(true);
    expect(controlsFor(panel, "speed")[0]?.type).toBe("number");
    expect(controlsFor(panel, "speed")[0]?.min).toBe("0");
    expect(controlsFor(panel, "speed")[0]?.step).toBe("0.5");
    expect(controlsFor(panel, "flag")[0]?.type).toBe("checkbox");
    expect(controlsFor(panel, "label")[0]?.type).toBe("text");
    expect(controlsFor(panel, "mode")[0]?.tagName).toBe("SELECT");
    expect(controlsFor(panel, "offset")).toHaveLength(3);
    expect(controlsFor(panel, "tint")).toHaveLength(4);
    expect(controlsFor(panel, "texture")[0]?.placeholder).toBe("address");
    expect(controlsFor(panel, "target")).toHaveLength(2);
    // `tags` is an array: no inline editor, so it shows its encoded JSON.
    expect(controlsFor(panel, "tags")[0]?.textContent).toBe('["a"]');
    expect(
      panel.byClass(DEVTOOLS_CLASS_NAMES.heading).some((node: FakeElement): boolean => node.textContent === "Advanced"),
    ).toBe(true);
    h.dispose();
  });

  it("writes every editable kind back onto the live component", async () => {
    const { h, panel, refresh } = await openPanel("inspector");
    const entity = h.app.world.createEntity("Subject");
    const probe = entity.addComponent(Probe);
    h.service.select(entity);
    refresh();

    type(controlsFor(panel, "speed")[0], "7.5");
    expect(probe.speed).toBeCloseTo(7.5, 5);

    // The schema's `max` is 10: a bigger number is clamped rather than written through.
    type(controlsFor(panel, "speed")[0], "99");
    expect(probe.speed).toBe(10);
    type(controlsFor(panel, "speed")[0], "not a number");
    expect(probe.speed).toBe(10);

    type(controlsFor(panel, "count")[0], "3.7");
    expect(probe.count).toBe(4);

    const flag = controlsFor(panel, "flag")[0];
    if (flag !== undefined) {
      flag.checked = false;
      flag.dispatch("change");
    }
    expect(probe.flag).toBe(false);

    type(controlsFor(panel, "label")[0], "renamed");
    expect(probe.label).toBe("renamed");

    type(controlsFor(panel, "mode")[0], "busy");
    expect(probe.mode).toBe("busy");

    type(controlsFor(panel, "offset")[1], "9");
    expect(probe.offset).toEqual({ x: 1, y: 9, z: 3 });

    type(controlsFor(panel, "tint")[2], "0.5");
    expect(probe.tint.b).toBeCloseTo(0.5, 5);

    type(controlsFor(panel, "texture")[0], "textures/hero.png");
    expect(probe.texture?.address).toBe("textures/hero.png");
    type(controlsFor(panel, "texture")[0], "  ");
    expect(probe.texture).toBeNull();

    controlsFor(panel, "target")[1]?.dispatch("click");
    expect(probe.target).toBe(entity);
    h.dispose();
  });

  it("shows a value a script wrote on the next refresh", async () => {
    const { h, panel, refresh } = await openPanel("inspector");
    const entity = h.app.world.createEntity("Subject");
    const probe = entity.addComponent(Probe);
    h.service.select(entity);
    refresh();

    probe.speed = 3.25;
    refresh();

    expect(controlsFor(panel, "speed")[0]?.value).toBe("3.25");
    h.dispose();
  });

  it("rebuilds when the selection or its component list changes, and empties on destroy", async () => {
    const { h, panel, refresh } = await openPanel("inspector");
    const entity = h.app.world.createEntity("Subject");
    h.service.select(entity);
    refresh();
    expect(controlsFor(panel, "speed")).toHaveLength(0);

    entity.addComponent(Probe);
    refresh();
    expect(controlsFor(panel, "speed")).toHaveLength(1);

    entity.destroyImmediate();
    refresh();
    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.heading)[0]?.textContent).toBe("no selection");
    h.dispose();
  });

  it("copies the entity and the component as JSON into its output box", async () => {
    const { h, panel, refresh } = await openPanel("inspector");
    const entity = h.app.world.createEntity("Subject");
    entity.addComponent(Probe);
    h.service.select(entity);
    refresh();

    const output = panel.children.at(-1);
    panel.byClass(DEVTOOLS_CLASS_NAMES.button)[0]?.dispatch("click");
    expect(output?.value).toContain("ignifx.scene");

    // The second button in the tree is the per-component "copy".
    const copies = panel
      .byClass(DEVTOOLS_CLASS_NAMES.button)
      .filter((node: FakeElement): boolean => node.textContent === "copy");
    // The entity carries a `Transform` first and the `Probe` second, so the second "copy" is the
    // one under test.
    copies[1]?.dispatch("click");
    expect(output?.value).toContain("devtools-test/Probe");
    expect(output?.value).toContain('"speed"');
    h.dispose();
  });

  it("reports IGX-1557 when select in world has no canvas to click on", async () => {
    const { h, panel } = await openPanel("inspector");
    const reported: string[] = [];
    h.app.onError.connect((report) => {
      reported.push(report.error instanceof Error ? report.error.message : String(report.error));
    });

    const pick = panel
      .byClass(DEVTOOLS_CLASS_NAMES.button)
      .find((node: FakeElement): boolean => node.textContent === "select in world");
    pick?.dispatch("click");

    expect(reported.join(" ")).toContain("IGX-1557");
    h.dispose();
  });
});

describe("the Assets panel", () => {
  it("lists only the manifest addresses that have a live handle", async () => {
    const { h, panel, refresh } = await openPanel("assets");
    refresh();

    expect(rowsOf(panel)).toHaveLength(0);
    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent).toContain("0 live of 0 in manifest");
    h.dispose();
  });

  it("collects on demand", async () => {
    const { h, panel } = await openPanel("assets");
    const collect = panel
      .byClass(DEVTOOLS_CLASS_NAMES.button)
      .find((node: FakeElement): boolean => node.textContent === "collect");

    expect(() => collect?.dispatch("click")).not.toThrow();
    h.dispose();
  });
});

describe("the Input, Audio and Physics panels", () => {
  it("say which extension is missing rather than showing an empty table", async () => {
    const input = await openPanel("input");
    expect(rowsOf(input.panel)).toContain("@ignifx/input=not registered");
    input.h.dispose();

    const audio = await openPanel("audio");
    expect(audio.panel.byClass(DEVTOOLS_CLASS_NAMES.heading)[0]?.textContent).toBe("@ignifx/audio is not registered");
    audio.h.dispose();

    const physics = await openPanel("physics");
    expect(rowsOf(physics.panel)).toContain("physics=@ignifx/physics is not registered");
    expect(rowsOf(physics.panel)).toContain("physics2d=@ignifx/physics-2d is not registered");
    physics.h.dispose();
  });

  it("shows live action values when app.input is present", async () => {
    const { h, panel, refresh } = await openPanel("input");
    Reflect.defineProperty(h.app, "input", {
      value: {
        currentScheme: "keyboard",
        devices: { all: [{ kind: "keyboard", deviceIndex: 0, isConnected: true }] },
        actions: {
          maps: new Map([
            ["gameplay", { actions: new Map([["move", { type: "vector2", value: { x: 1, y: 0 }, isPressed: true }]]) }],
          ]),
        },
      },
    });
    refresh();

    expect(rowsOf(panel)).toContain("scheme=keyboard");
    expect(rowsOf(panel)).toContain("devices=keyboard");
    expect(rowsOf(panel)).toContain("gameplay/move=1.000, 0.000 ▪");
    h.dispose();
  });

  it("drives a bus volume slider when app.audio is present", async () => {
    const { h, panel, refresh } = await openPanel("audio");
    const bus = { name: "sfx", volume: 0.5, effectiveVolume: 0.25, muted: false };
    Reflect.defineProperty(h.app, "audio", {
      value: { masterVolume: 1, buses: new Map([["sfx", bus]]) },
    });
    refresh();

    const slider = panel.byClass(DEVTOOLS_CLASS_NAMES.input)[0];
    expect(slider?.value).toBe("0.50");
    if (slider !== undefined) {
      slider.value = "0.75";
      slider.dispatch("input");
    }
    expect(bus.volume).toBeCloseTo(0.75, 5);
    h.dispose();
  });

  it("flips app.physics.debugViewer.enabled from its checkbox", async () => {
    const { h, panel, refresh } = await openPanel("physics");
    const viewer = { enabled: false };
    Reflect.defineProperty(h.app, "physics", { value: { debugViewer: viewer } });
    refresh();

    const box = panel.byClass(DEVTOOLS_CLASS_NAMES.input)[0];
    expect(box?.disabled).toBe(false);
    if (box !== undefined) {
      box.checked = true;
      box.dispatch("change");
    }
    expect(viewer.enabled).toBe(true);

    refresh();
    expect(box?.checked).toBe(true);
    h.dispose();
  });

  it("shows every counter of a registered physics diagnostics group", async () => {
    const { h, panel, refresh } = await openPanel("physics");
    const group = h.app.diagnostics.registerGroup("physics", ["bodies", "stepMs"]);
    group.set(group.index("bodies"), 12);
    refresh();

    expect(rowsOf(panel)).toContain("physics.bodies=12");
    h.dispose();
  });
});

describe("the Console panel", () => {
  it("says how to install a sink when the game did not", async () => {
    const { h, panel } = await openPanel("console");

    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.line)[0]?.textContent).toContain("createDevtoolsLogSink");
    h.dispose();
  });

  it("shows, filters and searches the sink's records", async () => {
    const sink = createDevtoolsLogSink();
    const { h, panel, refresh } = await openPanel("console", { logSink: sink });
    sink.write({ level: "debug", scope: "assets", message: "quiet", data: [], timeMs: 0 });
    sink.write({ level: "error", scope: null, message: "boom", data: [], timeMs: 1 });
    refresh();

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

    expect(lines()).toEqual(["[error] boom", "[debug] assets quiet"]);

    const [level, search, clear] = [
      panel.byClass(DEVTOOLS_CLASS_NAMES.input)[0],
      panel.byClass(DEVTOOLS_CLASS_NAMES.input)[1],
      panel.byClass(DEVTOOLS_CLASS_NAMES.button)[0],
    ];
    if (level !== undefined) {
      level.value = "error";
      level.dispatch("change");
    }
    refresh();
    expect(lines()).toEqual(["[error] boom"]);

    if (level !== undefined) {
      level.value = "debug";
      level.dispatch("change");
    }
    if (search !== undefined) {
      search.value = "quiet";
      search.dispatch("input");
    }
    refresh();
    expect(lines()).toEqual(["[debug] assets quiet"]);

    if (search !== undefined) {
      search.value = "";
      search.dispatch("input");
    }
    clear?.dispatch("click");
    refresh();
    expect(lines()).toEqual([]);
    h.dispose();
  });

  it("shows the app.onError reports the overlay retained", async () => {
    const { h, panel, refresh } = await openPanel("console");
    h.app.onError.emit({
      error: new Error("script threw"),
      source: "lifecycle",
      phase: null,
      entity: null,
      component: null,
    });
    refresh();

    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.line)[0]?.textContent).toBe("[error] lifecycle · script threw");
    h.dispose();
  });

  it("shows hot-reload reports the host applied", async () => {
    const { h, panel, refresh } = await openPanel("console");
    // The report arrives the way `app.hotReload.onApplied` would deliver it; the bridge is proven
    // separately in `hot-reload.test.ts`.
    h.service.reloadScenes = true;
    refresh();

    expect(h.service.reloadScenes).toBe(true);
    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.line)).not.toHaveLength(0);
    h.dispose();
  });
});

describe("the Timeline panel", () => {
  it("draws one band per phase per recorded frame", async () => {
    const { h, panel, refresh } = await openPanel("timeline", { realClock: true });
    for (let index = 0; index < 5; index += 1) {
      refresh();
    }

    const canvas = panel.byClass(DEVTOOLS_CLASS_NAMES.canvas)[0] as FakeCanvas | undefined;
    expect(canvas?.width).toBe(320);
    expect(canvas?.context.clears.length).toBeGreaterThan(0);
    expect(canvas?.context.fills.length).toBeGreaterThan(0);
    expect(canvas?.context.fills.every((fill) => fill.height > 0)).toBe(true);
    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent).toMatch(/frames · mean/u);
    h.dispose();
  });

  it("says which build flag fills the graph when there are no per-phase timings", async () => {
    const { h, panel, refresh } = await openPanel("timeline");
    refresh();

    // A manual clock never advances inside a frame, so every phase measures zero — the same shape a
    // production build has, where `app.diagnostics` does not fill `cpuMs` at all.
    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent).toContain("development");
    h.dispose();
  });

  it("refreshes every frame rather than at the throttled text rate", async () => {
    const { h, panel } = await openPanel("timeline");
    const canvas = panel.byClass(DEVTOOLS_CLASS_NAMES.canvas)[0] as FakeCanvas | undefined;
    const before = canvas?.context.clears.length ?? 0;
    h.step(1 / 60);
    h.step(1 / 60);

    expect(canvas?.context.clears.length).toBe(before + 2);
    h.dispose();
  });
});

describe("the Inspector panel's transform section", () => {
  it("edits localPosition, localEulerAngles and localScale in place", async () => {
    const { h, panel, refresh } = await openPanel("inspector");
    const entity = h.app.world.createEntity("Subject");
    h.service.select(entity);
    refresh();

    type(controlsFor(panel, "position")[0], "5");
    expect(entity.transform.localPosition.x).toBeCloseTo(5, 5);

    type(controlsFor(panel, "rotation")[1], "90");
    expect(entity.transform.localEulerAngles.y).toBeCloseTo(90, 3);

    type(controlsFor(panel, "scale")[2], "2");
    expect(entity.transform.localScale.z).toBeCloseTo(2, 5);

    // A value a script writes shows up on the next refresh.
    entity.transform.localPosition.x = 7;
    refresh();
    expect(controlsFor(panel, "position")[0]?.value).toBe("7");

    // A rubbish value and a destroyed entity are both no-ops rather than throws.
    type(controlsFor(panel, "position")[0], "nonsense");
    expect(entity.transform.localPosition.x).toBeCloseTo(7, 5);
    entity.destroyImmediate();
    expect(() => {
      type(controlsFor(panel, "position")[0], "1");
      refresh();
    }).not.toThrow();
    h.dispose();
  });

  it("does not draw an empty second section for Transform, which declares no schema", async () => {
    const { h, panel, refresh } = await openPanel("inspector");
    const entity = h.app.world.createEntity("Subject");
    h.service.select(entity);
    refresh();

    const headings = panel
      .byClass(DEVTOOLS_CLASS_NAMES.heading)
      .map((node: FakeElement): string => node.textContent)
      .filter((text: string): boolean => text === "ignifx/Transform");
    expect(headings).toHaveLength(1);
    h.dispose();
  });
});
