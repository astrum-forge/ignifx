import { Camera2D, twoD } from "@ignifx/2d";
import { createAssetManifest, Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { HostCapability, isPickResult, SceneNotification } from "../src/protocol/index.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import type { EditorHost } from "../src/host.js";
import type { EditorPeer, Received } from "./support/editor.js";
import type { SceneFile } from "@ignifx/core";

/**
 * The scene view's 2D mode on a real WebGPU canvas, over a level shaped like the `2d-topdown`
 * template's (`twoD.mode: "sprite"`, 16 pixels per unit, a `Camera2D` that is the level's only
 * camera): the host reports the scene as 2D, `setViewMode` swaps in the editor's own `Camera2D`
 * without touching the level's, `frame` fits sprite bounds, and `pick` and clicks hit sprites
 * through `app.twoD.pickAt` at device pixel ratio 1 and 2.
 */

/** The canvas size, in CSS pixels. */
const WIDTH = 320;
const HEIGHT = 240;

/** The template's pixels per unit: a 32-pixel frame is 2 m wide. */
const PPU = 16;

/** The atlas, by its fixture address. */
const ATLAS = { $asset: "2d/hero.atlas.json", type: "spriteatlas" };

/** A top-down level: the camera, a sprite the game can pick, one it cannot, and an empty marker. */
const LEVEL: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "main",
  entities: [
    {
      uid: "CAMERA",
      name: "Main Camera",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "CAMERA-C", type: "ignifx/Camera2D", props: { orthographicSize: 4 } }],
    },
    {
      uid: "HERO",
      name: "Hero",
      parent: null,
      transform: { position: [3, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "HERO-S", type: "ignifx/SpriteRenderer", props: { sprite: ATLAS, frameName: "run_0" } }],
    },
    {
      uid: "GHOST",
      name: "Ghost",
      parent: null,
      transform: { position: [-3, -1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [
        {
          uid: "GHOST-S",
          type: "ignifx/SpriteRenderer",
          props: { sprite: ATLAS, frameName: "run_1", pickable: false },
        },
      ],
    },
    {
      uid: "MARKER",
      name: "Marker",
      parent: null,
      transform: { position: [12, 7, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
};

let host: EditorHost | null = null;
let peer: EditorPeer | null = null;
let canvas: HTMLCanvasElement | null = null;

afterEach(() => {
  // The ratio override is an own property shadowing `Window.prototype`'s getter.
  Reflect.deleteProperty(globalThis, "devicePixelRatio");
  peer?.close();
  host?.dispose();
  canvas?.remove();
  host = null;
  peer = null;
  canvas = null;
});

/**
 * Waits for animation frames.
 *
 * @param count - How many.
 */
async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one frame at a time is the point
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
}

/**
 * Sends one request and returns its result.
 *
 * @param method - The method.
 * @param params - Its parameters.
 * @returns The result.
 */
async function call(method: string, params?: unknown): Promise<unknown> {
  const answer: Received | undefined = await peer?.request(method, params);
  if (answer === undefined || "error" in answer) {
    throw new Error(`${method} failed: ${JSON.stringify(answer)}`);
  }
  return answer["result"];
}

/**
 * Counts the pixels that differ between two captures.
 *
 * @param left - One capture's bytes.
 * @param right - The other's.
 * @returns How many pixels differ by more than a little.
 */
function changedPixels(left: Uint8ClampedArray, right: Uint8ClampedArray): number {
  let count = 0;
  for (let index = 0; index < left.length; index += 4) {
    const delta =
      Math.abs((left[index] ?? 0) - (right[index] ?? 0)) +
      Math.abs((left[index + 1] ?? 0) - (right[index + 1] ?? 0)) +
      Math.abs((left[index + 2] ?? 0) - (right[index + 2] ?? 0));
    if (delta > 24) {
      count += 1;
    }
  }
  return count;
}

/**
 * Starts a host with the 2D toolkit on a canvas and opens the level.
 *
 * @returns The running host and the `openScene` answer.
 */
async function sceneView(): Promise<{ readonly view: EditorHost; readonly opened: unknown }> {
  canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.width = `${String(WIDTH)}px`;
  canvas.style.height = `${String(HEIGHT)}px`;
  document.body.append(canvas);
  const target = new EventTarget();
  const starting = startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    canvas,
    messageTarget: target,
    extensions: [twoD({ pixelsPerUnit: PPU })],
    settings: { rendering: { msaaSamples: 1 }, sortingLayers: { sortingLayers: ["Background", "Default"] } },
    assets: {
      manifest: createAssetManifest([
        { address: "2d/hero.atlas.json", url: "/tests/fixtures/assets/2d/hero.atlas.json", type: "spriteatlas" },
        { address: "2d/hero.png", url: "/tests/fixtures/assets/2d/hero.png", type: "texture" },
      ]),
    },
    heartbeatIntervalMs: 60_000,
  });
  peer = connect(target);
  const ready = await peer.hello();
  expect(ready).toHaveProperty("result.capabilities", [
    HostCapability.heartbeat,
    HostCapability.gizmos,
    HostCapability.screenshot,
    HostCapability.viewMode2d,
    HostCapability.pick2d,
  ]);
  host = await starting;
  await peer.nextNotification(SceneNotification.schemasChanged);
  const opened = await call("openScene", { file: LEVEL, address: "scenes/main.scene.json" });
  // The atlas loads after `openScene`; let it reach the screen.
  await frames(12);
  return { view: host, opened };
}

/**
 * The level's camera, and the camera the frame is drawn through.
 *
 * @param view - The host.
 * @returns Both.
 */
function cameras(view: EditorHost): { readonly level: Camera2D; readonly main: Camera2D | null } {
  const level = view.app.world.findByName("Main Camera")?.getComponent(Camera2D) ?? null;
  if (level === null) {
    throw new Error("The level has no camera.");
  }
  return { level, main: view.app.twoD.mainCamera };
}

/**
 * Where a world point is drawn, in CSS pixels of the view.
 *
 * @param view - The host.
 * @param x - The world x.
 * @param y - The world y.
 * @returns The CSS point.
 */
function cssPointOf(view: EditorHost, x: number, y: number): { readonly x: number; readonly y: number } {
  const screen = view.app.twoD.worldToScreen(new Vec2(x, y));
  const ratio = (canvas?.width ?? WIDTH) / (canvas?.clientWidth ?? WIDTH);
  return { x: screen.x / ratio, y: screen.y / ratio };
}

/**
 * Reads a member of a `pick` answer.
 *
 * @param answer - The answer.
 * @param key - The member.
 * @returns Its value.
 */
function memberOf(answer: unknown, key: string): unknown {
  expect(isPickResult(answer)).toBe(true);
  return Reflect.get(Object(answer), key);
}

/** A point of the view, in CSS pixels from its top-left corner. */
interface CssPoint {
  /** From the left edge. */
  readonly x: number;
  /** From the top edge. */
  readonly y: number;
}

/**
 * Clicks the view the way a mouse does, through the host's own listeners: a primary-button
 * `pointerdown` and `pointerup` at one CSS point of the canvas. Synthetic events keep the test off
 * the real pointer, which a parallel browser run shares and moves.
 *
 * @param at - The CSS point, from the canvas's top-left corner.
 */
function click(at: CssPoint): void {
  if (canvas === null) {
    throw new Error("no canvas");
  }
  const rect = canvas.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    clientX: rect.left + at.x,
    clientY: rect.top + at.y,
  };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
}

/** The most frames a test waits for a notification before it fails. */
const NOTIFICATION_FRAMES = 120;

/**
 * Waits for a notification, a bounded number of frames.
 *
 * @param method - The notification's method.
 * @returns The notification.
 * @throws When it has not arrived after {@link NOTIFICATION_FRAMES} frames.
 */
async function notified(method: string): Promise<Received> {
  for (let frame = 0; frame < NOTIFICATION_FRAMES; frame += 1) {
    const message = peer?.takeNotification(method) ?? null;
    if (message !== null) {
      return message;
    }
    // oxlint-disable-next-line no-await-in-loop -- one frame at a time is the point
    await frames(1);
  }
  throw new Error(`No ${method} after ${String(NOTIFICATION_FRAMES)} frames.`);
}

describe("the scene view's 2D mode", () => {
  it("reports the level as 2D, and swaps in its own Camera2D without touching the level's", async () => {
    const { view, opened } = await sceneView();
    expect(opened).toHaveProperty("viewMode", "2d");

    const before = cameras(view);
    expect(before.main).toBe(before.level);
    const shownByLevel = await view.app.renderer.captureScreenshot();

    expect(await call("setViewMode", { mode: "2d" })).toBeNull();
    await frames(4);
    const inTwoD = cameras(view);
    expect(inTwoD.main).not.toBe(inTwoD.level);
    expect(inTwoD.main?.entity.name).toBe("Editor Camera");
    // The editor camera starts where the level's camera looks, so the view does not jump.
    expect(inTwoD.main?.zoom).toBeCloseTo(inTwoD.level.zoom, 5);
    expect(inTwoD.main?.centre).toEqual(inTwoD.level.centre);
    expect(changedPixels(shownByLevel.data, (await view.app.renderer.captureScreenshot()).data)).toBeLessThan(20);
    expect(inTwoD.level.enabled).toBe(true);
    expect(inTwoD.level.orthographicSize).toBe(4);
    expect(inTwoD.level.entity.transform.position.x).toBe(0);

    expect(await call("setViewMode", { mode: "3d" })).toBeNull();
    await frames(2);
    expect(cameras(view).main).toBe(inTwoD.level);
  }, 60_000);

  it("frames the whole level and one sprite by their bounds", async () => {
    const { view } = await sceneView();
    await call("setViewMode", { mode: "2d" });
    await frames(4);
    const atStart = await view.app.renderer.captureScreenshot();

    // The marker sits outside the level camera's view; framing everything brings it in.
    await call("frame", { entities: "all" });
    await frames(4);
    const all = view.app.twoD.mainCamera;
    expect(all?.entity.name).toBe("Editor Camera");
    const marker = cssPointOf(view, 12, 7);
    const ghost = cssPointOf(view, -3 - 1, -1 - 1);
    for (const point of [marker, ghost]) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(WIDTH);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(HEIGHT);
    }
    const framedAll = await view.app.renderer.captureScreenshot();
    expect(changedPixels(atStart.data, framedAll.data)).toBeGreaterThan(100);

    // One 2 m sprite fills most of the view's height.
    await call("frame", { entities: ["HERO"] });
    await frames(4);
    const hero = view.app.twoD.mainCamera;
    expect(hero?.centre.x).toBeCloseTo(3, 3);
    expect(hero?.centre.y).toBeCloseTo(1, 3);
    const top = cssPointOf(view, 3, 2);
    const bottom = cssPointOf(view, 3, 0);
    expect(bottom.y - top.y).toBeGreaterThan(HEIGHT * 0.6);
    expect(bottom.y - top.y).toBeLessThan(HEIGHT);
  }, 60_000);

  it.each([1, 2])(
    "picks sprites through app.twoD.pickAt at device pixel ratio %i",
    async (dpr) => {
      Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: dpr });
      const { view } = await sceneView();
      expect(canvas?.width).toBe(WIDTH * dpr);
      await call("setViewMode", { mode: "2d" });
      await call("frame", { entities: "all" });
      await frames(4);

      const onHero = cssPointOf(view, 3, 1);
      const hit = await call("pick", { x: onHero.x, y: onHero.y, unit: "css" });
      expect(hit).toMatchObject({ entity: "HERO", distance: null });
      const point = memberOf(hit, "point");
      expect(Array.isArray(point) ? point[2] : null).toBe(0);
      expect(Array.isArray(point) ? point[0] : null).toBeCloseTo(3, 2);
      expect(Array.isArray(point) ? point[1] : null).toBeCloseTo(1, 2);
      // The plane point is the hit point, and the ray looks straight down +Z at it.
      expect(memberOf(hit, "plane")).toEqual(point);
      expect(memberOf(hit, "ray")).toMatchObject({ direction: [0, 0, 1] });
      // The same point in backing pixels is the same answer.
      expect(await call("pick", { x: onHero.x * dpr, y: onHero.y * dpr, unit: "backing" })).toEqual(hit);

      // The editor picks what the game cannot.
      const onGhost = cssPointOf(view, -3, -1);
      expect(await call("pick", { x: onGhost.x, y: onGhost.y, unit: "css" })).toMatchObject({ entity: "GHOST" });

      // Beside every sprite: a miss, whose plane point is the world point the 2D camera shows there.
      const empty = cssPointOf(view, 8, -3);
      const miss = await call("pick", { x: empty.x, y: empty.y, unit: "css" });
      expect(miss).toMatchObject({ entity: null, point: null, distance: null });
      const plane = memberOf(miss, "plane");
      const shown = view.app.twoD.screenToWorld(empty.x * dpr, empty.y * dpr);
      expect(Array.isArray(plane) ? plane[0] : null).toBeCloseTo(shown.x, 2);
      expect(Array.isArray(plane) ? plane[1] : null).toBeCloseTo(shown.y, 2);
    },
    60_000,
  );

  it("selects the sprite a click lands on, and clears the selection on a click beside it", async () => {
    const { view } = await sceneView();
    await call("setViewMode", { mode: "2d" });
    await call("frame", { entities: "all" });
    await frames(4);

    const onHero = cssPointOf(view, 3, 1);
    click(onHero);
    expect((await notified(SceneNotification.selectionChanged))["params"]).toEqual({ entities: ["HERO"] });
    // Up and to the left of everything, and clear of the gizmo now drawn on the hero, whose arms
    // point right and up from it.
    const empty = cssPointOf(view, -3, 6);
    click(empty);
    expect((await notified(SceneNotification.selectionChanged))["params"]).toEqual({ entities: [] });
    // Lite's gizmo dispatcher reads back a GPU pick on every press; let it settle before disposal.
    await frames(10);
  }, 60_000);
});
