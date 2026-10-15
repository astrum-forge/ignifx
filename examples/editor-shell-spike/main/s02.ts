// THROWAWAY spike S0.2 — not for merge. Scripted checks of the scene view, driven from Electron main
// with browser-level input events (CDP Input.dispatchMouseEvent through webContents.debugger, hit-tested
// by Chromium into the out-of-process iframe) and observed through the host's JSON-RPC over the
// MessagePort. Run: SPIKE_S02=3d SPIKE_QUERY=msaa=1 electron .   (see main.ts for the other knobs)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WebContents } from "electron";

interface Ctx {
  readonly contents: WebContents;
  rpc(method: string, params?: unknown): Promise<Record<string, unknown>>;
  readonly inbox: Record<string, unknown>[];
  readonly iframeRect: { left: number; top: number; width: number; height: number };
  log(kind: string, data?: Record<string, unknown>): void;
  readonly outDir: string;
  readonly mode: string;
  readonly query: string;
}

interface Pt {
  x: number;
  y: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

type Button = "left" | "middle" | "right";
// CDP `buttons` bitmask while a button is held.
const mask: Record<Button, number> = { left: 1, right: 2, middle: 4 };

export async function runS02(ctx: Ctx): Promise<void> {
  const { contents, log } = ctx;
  const call = async (method: string, params?: unknown): Promise<unknown> => {
    const message = await ctx.rpc(method, params);
    if (message["error"] !== null && message["error"] !== undefined) {
      log("s02:rpcError", { method, error: message["error"] });
    }
    return message["result"];
  };
  /** Iframe CSS px → window CSS px. */
  const toWindow = (p: Pt): Pt => ({ x: Math.round(ctx.iframeRect.left + p.x), y: Math.round(ctx.iframeRect.top + p.y) });
  // Input goes through the Chrome DevTools Protocol (what Playwright uses): Input.dispatchMouseEvent is
  // hit-tested by the browser and routed into the out-of-process iframe. webContents.sendInputEvent
  // delivered nothing to the iframe in this setup (zero pointer events counted in the host).
  if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
  const cdp = (method: string, params: Record<string, unknown>): Promise<unknown> => contents.debugger.sendCommand(method, params);
  let heldButton: Button | null = null;
  const move = (p: Pt, button?: Button): void => {
    const w = toWindow(p);
    void cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: w.x,
      y: w.y,
      button: button ?? heldButton ?? "none",
      buttons: button === undefined ? 0 : mask[button],
    });
  };
  const down = (p: Pt, button: Button = "left"): void => {
    const w = toWindow(p);
    heldButton = button;
    void cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: w.x, y: w.y, button, buttons: mask[button], clickCount: 1 });
  };
  const up = (p: Pt, button: Button = "left"): void => {
    const w = toWindow(p);
    heldButton = null;
    void cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: w.x, y: w.y, button, buttons: 0, clickCount: 1 });
  };
  const wheel = (p: Pt, deltaY: number): void => {
    const w = toWindow(p);
    void cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: w.x, y: w.y, deltaX: 0, deltaY });
  };
  const key = (type: "keyDown" | "keyUp", letter: string): void => {
    void cdp("Input.dispatchKeyEvent", { type, code: `Key${letter}`, key: letter.toLowerCase(), windowsVirtualKeyCode: letter.charCodeAt(0) });
  };
  const click = async (p: Pt): Promise<void> => {
    move(p);
    await sleep(60);
    down(p);
    await sleep(30);
    up(p);
  };
  /** A press-drag-release in `steps` moves, `stepMs` apart. `hover` first parks the pointer on the start. */
  const drag = async (from: Pt, to: Pt, opts: { button?: Button; steps?: number; stepMs?: number; hoverMs?: number } = {}): Promise<void> => {
    const button = opts.button ?? "left";
    const steps = opts.steps ?? 12;
    if (opts.hoverMs !== undefined) {
      move(from);
      await sleep(opts.hoverMs);
    }
    down(from, button);
    for (let i = 1; i <= steps; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(opts.stepMs ?? 16);
      move({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, button);
    }
    await sleep(30);
    up(to, button);
    await sleep(150);
  };
  const waitFor = async (kind: string, since: number, timeoutMs = 3000): Promise<Record<string, unknown> | null> => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = ctx.inbox.slice(since).find((m) => m["kind"] === kind);
      if (found !== undefined) return found;
      // eslint-disable-next-line no-await-in-loop
      await sleep(10);
    }
    return null;
  };
  const shot = async (name: string): Promise<void> => {
    const image = await contents.capturePage();
    const small = image.resize({ width: 1280 });
    const png = small.toPNG();
    const jpeg = small.toJPEG(82);
    writeFileSync(join(ctx.outDir, `${name}.png`), png);
    writeFileSync(join(ctx.outDir, `${name}.jpg`), jpeg);
    log("s02:screenshot", { name, pngBytes: png.byteLength, jpegBytes: jpeg.byteLength });
  };
  const record = (step: string, data: Record<string, unknown>): void => {
    log(`s02:${step}`, data);
  };

  contents.focus();
  record("status", { status: await call("status"), camera: await call("cameraState") });
  // Give the iframe focus (keyboard goes to the focused frame) with a click on empty sky.
  if (ctx.mode === "3d") {
    await run3d();
  } else {
    await run2d();
  }

  async function run3d(): Promise<void> {
    const empty: Pt = { x: 40, y: 40 };
    await click(empty);
    await sleep(200);

    // --- Picking: click the Player model, expect selectionChanged via pick3d.
    const playerPt = (await call("entityScreenPoint", { name: "Player" })) as Pt;
    let mark = ctx.inbox.length;
    await click(playerPt);
    record("pickClick", { at: playerPt, pickResolved: await waitFor("pickResolved", mark), selection: await waitFor("selectionChanged", mark) });
    record("diagnostics", {
      player: await call("describeEntity", { name: "Player" }),
      rawPickPlayer: await call("rawPick", playerPt),
    });
    record("pickRpc", {
      player: await call("pick", playerPt),
      companion: await call("pick", (await call("entityScreenPoint", { name: "Companion" })) as Pt),
      sky: await call("pick", empty),
      crate: await call("pick", (await call("entityScreenPoint", { name: "Crate" })) as Pt),
    });
    // A click in empty space deselects.
    mark = ctx.inbox.length;
    await click(empty);
    record("pickEmpty", { selection: await waitFor("selectionChanged", mark) });
    await call("select", { name: "Player" });
    await sleep(300);
    await shot(`s0.2-3d-selected${ctx.query === "" ? "" : `-${ctx.query.replace(/[^a-z0-9]+/gi, "-")}`}`);

    if (ctx.query.includes("outline=bbox")) {
      // Lite's BoundingBoxGizmo has no display-only mode: does pressing the selected mesh start a drag?
      const before = await call("transformOf", { name: "Player" });
      const statsBefore = await call("cameraState");
      mark = ctx.inbox.length;
      const center = (await call("entityScreenPoint", { name: "Player" })) as Pt;
      await drag(center, { x: center.x + 80, y: center.y }, { hoverMs: 200 });
      record("bboxPressOnSelection", {
        dragStart: await waitFor("transformDragStart", mark, 500),
        dragged: await waitFor("transformDragged", mark, 500),
        before,
        after: await call("transformOf", { name: "Player" }),
        statsBefore,
        statsAfter: await call("cameraState"),
        gizmo: await call("gizmoState"),
      });
      return;
    }

    // --- Translate drag on the X handle, hovered first (rule 1).
    const translate = async (label: string, axis: string, dx: number, dy: number, hoverMs: number | undefined): Promise<void> => {
      const handle = (await call("handleScreenPoint", { axis })) as { screen: Pt } | null;
      if (handle === null) {
        record(label, { error: "no handle" });
        return;
      }
      const cameraBefore = (await call("cameraState")) as Record<string, unknown>;
      const before = await call("transformOf", { name: "Player" });
      const m = ctx.inbox.length;
      const from = handle.screen;
      await drag(from, { x: from.x + dx, y: from.y + dy }, { hoverMs, steps: 15 });
      const dragged = await waitFor("transformDragged", m, 1000);
      const draggingEvents = ctx.inbox.slice(m).filter((x) => x["kind"] === "transformDragging").length;
      const cameraAfter = (await call("cameraState")) as Record<string, unknown>;
      record(label, {
        handle,
        before,
        after: await call("transformOf", { name: "Player" }),
        dragStart: await waitFor("transformDragStart", m, 10),
        dragged,
        draggingEvents,
        cameraBefore,
        cameraAfter,
        cameraMoved: JSON.stringify(cameraBefore["eye"]) !== JSON.stringify(cameraAfter["eye"]),
      });
    };
    await translate("translateHovered", "x", 120, 0, 250);
    // Rule 2/3: press on the handle with NO prior hover (pointer jumps there from far away).
    move(empty);
    await sleep(250);
    await translate("translateNoHover", "y", 0, -80, undefined);

    // --- Direction of truth: Transform vs the Lite node after the drags.
    record("truthProbe", { player: await call("truthProbe", { name: "Player", frames: 20 }) });
    // Write a number back as the op would on undo, and read it through the same view.
    record("opApplyBack", { result: await call("setLocalPosition", { name: "Player", position: [-1, 0, 0] }) });

    // --- Orbit on empty space must still work.
    {
      const before = (await call("cameraState")) as Record<string, unknown>;
      await drag({ x: 200, y: 120 }, { x: 320, y: 150 }, { hoverMs: 100 });
      record("orbitEmpty", { before, after: await call("cameraState") });
    }

    // --- Rotate and scale.
    await call("setGizmoMode", { mode: "rotate" });
    {
      const handle = (await call("handleScreenPoint", { axis: "y" })) as { screen: Pt } | null;
      const before = await call("transformOf", { name: "Player" });
      const m = ctx.inbox.length;
      if (handle !== null) await drag(handle.screen, { x: handle.screen.x + 90, y: handle.screen.y + 10 }, { hoverMs: 250 });
      record("rotateY", { handle, before, after: await call("transformOf", { name: "Player" }), dragged: await waitFor("transformDragged", m, 800), camera: await call("cameraState") });
    }
    await sleep(100);
    await shot("s0.2-3d-rotate");
    await call("setGizmoMode", { mode: "scale" });
    {
      const handle = (await call("handleScreenPoint", { axis: "uniform" })) as { screen: Pt } | null;
      const before = await call("transformOf", { name: "Player" });
      const m = ctx.inbox.length;
      if (handle !== null) await drag(handle.screen, { x: handle.screen.x + 60, y: handle.screen.y - 60 }, { hoverMs: 250 });
      record("scaleUniform", { handle, before, after: await call("transformOf", { name: "Player" }), dragged: await waitFor("transformDragged", m, 800) });
    }
    await call("setGizmoMode", { mode: "translate" });

    // --- A dynamic physics body: does the drag stick, or does the simulation own the pose?
    await call("select", { name: "Crate" });
    await sleep(200);
    {
      const before = await call("transformOf", { name: "Crate" });
      const handle = (await call("handleScreenPoint", { axis: "y" })) as { screen: Pt } | null;
      const m = ctx.inbox.length;
      if (handle !== null) await drag(handle.screen, { x: handle.screen.x, y: handle.screen.y - 100 }, { hoverMs: 250, steps: 10 });
      const dragged = await waitFor("transformDragged", m, 800);
      const right = await call("transformOf", { name: "Crate" });
      const later = await call("truthProbe", { name: "Crate", frames: 45 });
      record("physicsCrate", { before, handle, dragged, rightAfterDrag: right, after45Frames: later });
    }

    // --- Camera: pan (middle), fly (right + W), dolly (wheel), F to frame.
    await call("select", { name: "Player" });
    {
      const s0 = await call("cameraState");
      await drag({ x: 300, y: 200 }, { x: 380, y: 240 }, { button: "middle" });
      const s1 = await call("cameraState");
      // Fly: hold right, press W for 300 ms.
      const p = { x: 300, y: 200 };
      down(p, "right");
      await sleep(30);
      move({ x: 310, y: 200 }, "right");
      key("keyDown", "W");
      await sleep(300);
      key("keyUp", "W");
      up({ x: 310, y: 200 }, "right");
      await sleep(100);
      const s2 = await call("cameraState");
      wheel({ x: 300, y: 200 }, -240);
      await sleep(150);
      const s3 = await call("cameraState");
      key("keyDown", "F");
      key("keyUp", "F");
      await sleep(150);
      const s4 = await call("cameraState");
      record("cameraControls", { start: s0, afterPan: s1, afterFly: s2, afterWheel: s3, afterF: s4 });
    }
    await sleep(300);
    await shot("s0.2-3d-final");

    // --- Frame cost.
    await call("resetFrameStats");
    await sleep(3000);
    record("frameStats", { withGizmo: await call("frameStats"), gizmo: await call("gizmoState") });
    await call("select", { name: "nope" });
    await call("resetFrameStats");
    await sleep(3000);
    record("frameStats", { noSelection: await call("frameStats") });
  }

  async function run2d(): Promise<void> {
    await click({ x: 20, y: 20 });
    await sleep(200);
    const point = async (name: string, dx: number, dy: number): Promise<Pt> => (await call("entityScreenPoint", { name, dx, dy })) as Pt;
    // Probe points, expressed relative to an entity's world position (dx, dy in metres).
    const probes: { label: string; name: string; dx: number; dy: number; expect: string | null }[] = [
      { label: "hero over barrel (Default, y-sorted)", name: "Hero", dx: 0.25, dy: 0.35, expect: "Hero" },
      { label: "canopy (Foreground) over hero (Default)", name: "Hero", dx: -0.2, dy: 0.8, expect: "Canopy" },
      { label: "path decal (Decal) over ground (Background)", name: "Hero", dx: -0.3, dy: -0.1, expect: "Path Decal" },
      { label: "unpickable ghost over rock, same layer", name: "Rock", dx: 0, dy: 0.1, expect: "Rock" },
      { label: "sign A order 5 vs sign B order 0, Foreground not y-sorted", name: "Sign A (order 5)", dx: 0.1, dy: 0, expect: "Sign A (order 5)" },
      { label: "ground only", name: "Hero", dx: 3.5, dy: 2, expect: "Ground" },
      { label: "outside everything", name: "Hero", dx: 7, dy: 4, expect: null },
    ];
    const results: unknown[] = [];
    for (const probe of probes) {
      // eslint-disable-next-line no-await-in-loop
      const p = await point(probe.name, probe.dx, probe.dy);
      // eslint-disable-next-line no-await-in-loop
      const picked = (await call("pick", p)) as { hit: { name: string } | null; ms: number };
      results.push({ ...probe, at: p, got: picked.hit?.name ?? null, ok: (picked.hit?.name ?? null) === probe.expect, hit: picked.hit, ms: picked.ms });
    }
    record("pick2d", { results });
    // A real click selects through EditorCamera2D.onClick → app.twoD.pickAt.
    const heroPt = await point("Hero", 0, 0.5);
    const mark = ctx.inbox.length;
    await click(heroPt);
    record("click2d", { at: heroPt, selection: await waitFor("selectionChanged", mark) });
    await sleep(200);
    await shot("s0.2-2d-selected");
    // Pan with the middle button, zoom with the wheel about a point.
    const s0 = await call("cameraState");
    await drag({ x: 300, y: 300 }, { x: 380, y: 260 }, { button: "middle" });
    const s1 = await call("cameraState");
    // Zoom about the cursor: park it on the hero, step twice; the hero must stay under the cursor.
    const heroAfterPan = await point("Hero", 0, 0.5);
    wheel(heroAfterPan, -120);
    await sleep(200);
    const s2 = await call("cameraState");
    const heroAfterZoom = await point("Hero", 0, 0.5);
    wheel(heroAfterPan, -120);
    await sleep(200);
    const s3 = await call("cameraState");
    const heroAfterZoom2 = await point("Hero", 0, 0.5);
    record("camera2d", { start: s0, afterPan: s1, afterWheel1: s2, afterWheel2: s3, cursor: heroAfterPan, heroScreenAfterZoom: heroAfterZoom, heroScreenAfterZoom2: heroAfterZoom2 });
    await sleep(200);
    await shot("s0.2-2d-zoomed");
    await call("resetFrameStats");
    await sleep(3000);
    record("frameStats", { twoD: await call("frameStats"), camera: await call("cameraState") });
  }
}
