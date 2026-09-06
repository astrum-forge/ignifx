import { Camera, createApp, createMaterialAsset, MeshAsset, MeshRenderer, pbrMaterialDefinition } from "@ignifx/core";
import { ui } from "@ignifx/ui";
import { afterEach, describe, expect, it } from "vitest";
import { DEVTOOLS_CLASS_NAMES, DEVTOOLS_STYLE_ELEMENT_ID } from "../src/dom/styles.js";
import { devtools } from "../src/extension.js";
import { DEVTOOLS_UI_LAYER } from "../src/overlay/overlay.js";
import type { App, Entity, Extension } from "@ignifx/core";

/**
 * The Chromium half of the suite (coding standards §10).
 *
 * The node suites prove the arithmetic and the wiring over a fake DOM; what only a browser can
 * prove is that the overlay really lands over the canvas, that an inspector edit really moves the
 * Babylon Lite node **in the same frame**, that `renderer.pickAsync` really returns the entity
 * under a click, and that the timeline really puts pixels on its canvas.
 */

/** How many animation frames a change is given to reach the swapchain. */
const SETTLE_FRAMES = 4;

/** The canvas edge length, in CSS and device pixels. */
const SIZE = 256;

/** A running app with a laid-out canvas and the overlay open. */
interface BrowserApp {
  /** The app. */
  readonly app: App;
  /** The canvas the overlay covers. */
  readonly canvas: HTMLCanvasElement;
  /** The fixed-position wrapper both live in. */
  readonly wrapper: HTMLDivElement;
  /** Waits for a number of animation frames. */
  advance(frames?: number): Promise<void>;
  /** Disposes the app and removes the wrapper. */
  dispose(): void;
}

/** Everything built by a test, torn down afterwards. */
const running: BrowserApp[] = [];

afterEach(() => {
  while (running.length > 0) {
    running.pop()?.dispose();
  }
});

/**
 * Waits for one animation frame.
 *
 * @returns A promise that settles on the next frame.
 */
async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Builds and starts an app with a laid-out canvas and the devtools extension registered.
 *
 * @param extras - Extensions registered before `devtools()`.
 * @returns The running app.
 */
async function createBrowserApp(extras: readonly Extension[] = []): Promise<BrowserApp> {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "0px";
  wrapper.style.top = "0px";
  wrapper.style.width = `${String(SIZE)}px`;
  wrapper.style.height = `${String(SIZE)}px`;
  document.body.append(wrapper);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.display = "block";
  canvas.style.width = `${String(SIZE)}px`;
  canvas.style.height = `${String(SIZE)}px`;
  wrapper.append(canvas);
  const app = await createApp({ canvas, extensions: [...extras, devtools()] });
  await app.start();
  const built: BrowserApp = {
    app,
    canvas,
    wrapper,
    advance: async (frames = SETTLE_FRAMES): Promise<void> => {
      for (let index = 0; index < frames; index += 1) {
        // Sequential on purpose: each frame has to be presented before the next is requested.
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above
        await nextFrame();
      }
    },
    dispose: (): void => {
      app.dispose();
      wrapper.remove();
    },
  };
  running.push(built);
  await built.advance();
  return built;
}

/**
 * Adds a lit cube at the origin and points a camera at it, so there is something to pick.
 *
 * @param app - The app.
 * @returns The cube's entity.
 */
function addCube(app: App): Entity {
  const eye = app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -4);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });
  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({ name: "cube", baseColor: { r: 1, g: 0.4, b: 0.1, a: 1 }, roughness: 0.5 }),
    [],
  );
  const cube = app.world.createEntity("Cube");
  cube.addComponent(MeshRenderer, { mesh: MeshAsset.box(app, { size: 2 }), materials: [material] });
  return cube;
}

/**
 * Finds the overlay root in the real document.
 *
 * @returns The root, or `null`.
 */
function overlayRoot(): HTMLElement | null {
  return document.querySelector(`.${DEVTOOLS_CLASS_NAMES.root}`);
}

/**
 * Finds a control inside the visible panel by the label of its row.
 *
 * @param label - The row label.
 * @returns The controls in that row.
 */
function controlsFor(label: string): HTMLInputElement[] {
  for (const row of document.querySelectorAll(`.${DEVTOOLS_CLASS_NAMES.row}`)) {
    if (row.querySelector(`.${DEVTOOLS_CLASS_NAMES.label}`)?.textContent === label) {
      return [...row.querySelectorAll<HTMLInputElement>("input")];
    }
  }
  return [];
}

/**
 * Finds the checkbox whose caption is the given text.
 *
 * @param caption - The caption beside the checkbox.
 * @returns The checkbox, or `null`.
 */
function checkboxLabelled(caption: string): HTMLInputElement | null {
  for (const bar of document.querySelectorAll(`.${DEVTOOLS_CLASS_NAMES.toolbar}`)) {
    if (bar.querySelector(`.${DEVTOOLS_CLASS_NAMES.label}`)?.textContent === caption) {
      return bar.querySelector<HTMLInputElement>("input[type=checkbox]");
    }
  }
  return null;
}

describe("the devtools overlay in Chromium", () => {
  it("mounts its own root as the canvas's sibling and injects one stylesheet", async () => {
    const h = await createBrowserApp();
    h.app.devtools.open();

    const root = overlayRoot();
    expect(root).not.toBeNull();
    expect(root?.parentElement).toBe(h.wrapper);
    expect(root?.previousElementSibling).toBe(h.canvas);
    expect(document.querySelectorAll(`#${DEVTOOLS_STYLE_ELEMENT_ID}`)).toHaveLength(1);
    // It really covers the canvas: same top, and its right edge is the canvas's right edge.
    const overlay = root?.getBoundingClientRect();
    const canvas = h.canvas.getBoundingClientRect();
    expect(overlay?.top).toBeCloseTo(canvas.top, 0);
    expect(overlay?.right).toBeCloseTo(canvas.right, 0);

    h.app.devtools.close();
    expect(overlayRoot()).toBeNull();
  });

  it("mounts into an app.ui devtools layer when @ignifx/ui is registered", async () => {
    const h = await createBrowserApp([ui()]);
    h.app.devtools.open();

    const layer = h.app.ui.layer(DEVTOOLS_UI_LAYER).element;
    expect(layer).not.toBeNull();
    expect(overlayRoot()?.parentElement).toBe(layer);
  });

  it("moves the Babylon Lite node in the same frame an inspector edit is made", async () => {
    const h = await createBrowserApp();
    const cube = addCube(h.app);
    await h.advance();
    h.app.devtools.open();
    h.app.devtools.panel("inspector").show();
    h.app.devtools.select(cube);
    await h.advance(2);

    const before = cube.transform.lite.position.x;
    const input = controlsFor("position")[0];
    expect(input).toBeDefined();
    if (input === undefined) {
      return;
    }
    input.value = "1.75";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // No frame is advanced between the edit and the assertion: the write is straight onto the live
    // view over the Lite node, so the node has already moved.
    expect(cube.transform.lite.position.x).toBeCloseTo(1.75, 5);
    expect(before).not.toBeCloseTo(1.75, 5);
  });

  it("selects the entity under a click through renderer.pickAsync", async () => {
    const h = await createBrowserApp();
    const cube = addCube(h.app);
    await h.advance();
    h.app.devtools.open();
    h.app.devtools.panel("inspector").show();
    await h.advance(2);

    const pick = [...document.querySelectorAll<HTMLButtonElement>(`.${DEVTOOLS_CLASS_NAMES.button}`)].find(
      (node: HTMLButtonElement): boolean => node.textContent === "select in world",
    );
    expect(pick).toBeDefined();
    pick?.click();

    const rect = h.canvas.getBoundingClientRect();
    h.canvas.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    await h.advance(6);

    expect(h.app.devtools.selected).toBe(cube);
  });

  it("flips app.physics.debugViewer.enabled from the Physics panel's checkbox", async () => {
    const h = await createBrowserApp();
    // `@ignifx/physics` needs Havok's WebAssembly, which is a second's worth of start-up this
    // assertion does not need: what is under test is that the panel's checkbox reaches
    // `debugViewer.enabled` on whatever object `app.physics` is, which `09-physics.md` §9 fixes.
    const viewer = { enabled: false };
    Reflect.defineProperty(h.app, "physics", { value: { debugViewer: viewer }, configurable: true });
    h.app.devtools.open();
    h.app.devtools.panel("physics").show();
    await h.advance(2);

    // Every panel is mounted at once and only the active one is displayed, so the checkbox is
    // found by the caption beside it rather than by being the first input in the document.
    const box = checkboxLabelled("debug viewer");
    expect(box?.disabled).toBe(false);
    if (box === null) {
      return;
    }
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));

    expect(viewer.enabled).toBe(true);
    await h.advance(2);
    expect(box.checked).toBe(true);
  });

  it("draws non-background pixels on the timeline canvas", async () => {
    const h = await createBrowserApp();
    addCube(h.app);
    h.app.devtools.open();
    h.app.devtools.panel("timeline").show();
    await h.advance(20);

    const canvas = document.querySelector<HTMLCanvasElement>(`.${DEVTOOLS_CLASS_NAMES.canvas}`);
    expect(canvas).not.toBeNull();
    const context = canvas?.getContext("2d") ?? null;
    expect(context).not.toBeNull();
    if (canvas === null || context === null) {
      return;
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let drawn = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if ((pixels[offset] ?? 0) > 0) {
        drawn += 1;
      }
    }

    expect(drawn).toBeGreaterThan(0);
  });

  it("toggles on the backtick key", async () => {
    const h = await createBrowserApp();
    expect(h.app.devtools.isOpen).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", bubbles: true }));
    expect(h.app.devtools.isOpen).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", bubbles: true }));
    expect(h.app.devtools.isOpen).toBe(false);
  });
});
