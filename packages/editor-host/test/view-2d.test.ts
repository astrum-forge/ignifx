import { Camera2D, SpriteRenderer, Tilemap, twoD } from "@ignifx/2d";
import { Camera, createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { startEditorHost } from "../src/host.js";
import { RpcErrorCode, SceneNotification } from "../src/protocol/index.js";
import {
  boundsOf2D,
  fitView,
  levelCamera2D,
  orthographicSizeFor,
  sceneViewMode,
  screenToWorld2D,
  stepZoom,
  twoDServiceOf,
  ZOOM_STEPS,
  zoomAbout,
  zoomForSize,
} from "../src/scene/view-2d.js";
import { connect, EDITOR_ORIGIN } from "./support/editor.js";
import type { TwoDOptions } from "@ignifx/2d";
import type { App, Extension, SceneFile, SceneInstance } from "@ignifx/core";

/**
 * The 2D view's arithmetic, and what the host reads of `@ignifx/2d` by type id and `app.twoD`:
 * the scene's view mode, sprite and tilemap bounds, and the level's camera. Headless; the GPU half
 * is `scene-view-2d.browser.test.ts`.
 */

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.dispose();
  }
});

/**
 * A started headless app.
 *
 * @param extensions - Its extensions.
 * @returns The app.
 */
async function headless(extensions: readonly Extension[] = []): Promise<App> {
  const app = await createApp({ headless: true, editMode: true, extensions });
  apps.push(app);
  await app.start();
  return app;
}

/**
 * A headless app with the 2D toolkit and a scene instance to fill.
 *
 * @param options - What to pass `twoD(...)`.
 * @returns The app and the scene.
 */
async function twoDScene(options?: TwoDOptions): Promise<{ readonly app: App; readonly scene: SceneInstance }> {
  const app = await headless([twoD(options)]);
  return { app, scene: app.world.createScene("level") };
}

/** A view 320 × 240 backing pixels at 16 pixels per unit, zoom 2, centred on (10, 5). */
const VIEW = { centerX: 10, centerY: 5, zoom: 2, pixelsPerUnit: 16, widthPx: 320, heightPx: 240 };

describe("the 2D view's arithmetic", () => {
  it("steps the zoom through whole pixel ratios, from any zoom, and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
    expect(stepZoom(2.5, 1)).toBe(3);
    expect(stepZoom(2.5, -1)).toBe(2);
    expect(stepZoom(32, 1)).toBe(32);
    expect(stepZoom(0.125, -1)).toBe(0.125);
    expect(ZOOM_STEPS).toContain(4);
  });

  it("converts between zoom and half-height as Camera2D does", () => {
    expect(orthographicSizeFor(2, 240, 16)).toBe(3.75);
    expect(zoomForSize(3.75, 240, 16)).toBe(2);
  });

  it("maps pixels to the world with +Y up, and zooms about a pixel without moving its world point", () => {
    expect(screenToWorld2D(VIEW, 160, 120)).toEqual({ x: 10, y: 5 });
    expect(screenToWorld2D(VIEW, 192, 88)).toEqual({ x: 11, y: 6 });
    const anchor = screenToWorld2D(VIEW, 40, 200);
    const centre = zoomAbout(VIEW, 40, 200, 4);
    const after = screenToWorld2D({ ...VIEW, ...centre, zoom: 4 }, 40, 200);
    expect(after.x).toBeCloseTo(anchor.x, 9);
    expect(after.y).toBeCloseTo(anchor.y, 9);
  });

  it("fits a rectangle with a margin, and keeps a point from zooming in forever", () => {
    const fit = fitView({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 320, 240, 16);
    expect(fit.centerX).toBe(10);
    expect(fit.centerY).toBe(5);
    expect(fit.zoom).toBeCloseTo(320 / (20 * 1.2 * 16), 9);
    expect(fitView({ minX: 3, minY: 3, maxX: 3, maxY: 3 }, 320, 240, 16).zoom).toBeCloseTo(240 / (0.5 * 1.2 * 16), 9);
  });
});

describe("the 2D toolkit, by data", () => {
  it("finds app.twoD only when the project registers @ignifx/2d", async () => {
    expect(twoDServiceOf(await headless())).toBeNull();
    const { app } = await twoDScene({ pixelsPerUnit: 16 });
    expect(twoDServiceOf(app)).toMatchObject({ mode: "sprite", pixelsPerUnit: 16 });
  });

  it("calls a sprite-only project 2D, and a mixed one 2D only when its cameras are all Camera2D", async () => {
    expect(sceneViewMode(await headless(), null)).toBe("3d");
    const sprite = await twoDScene();
    expect(sceneViewMode(sprite.app, sprite.scene)).toBe("2d");

    const { app, scene } = await twoDScene({ mode: "mixed" });
    expect(sceneViewMode(app, scene)).toBe("3d");
    const camera2D = app.world.createEntity("Main Camera", { scene }).addComponent(Camera2D);
    expect(sceneViewMode(app, scene)).toBe("2d");
    // A 3D camera elsewhere does not count; one in the scene makes it 3D.
    app.world.createEntity("Other", { scene: app.world.createScene("other") }).addComponent(Camera);
    expect(sceneViewMode(app, scene)).toBe("2d");
    app.world.createEntity("Eye", { scene }).addComponent(Camera);
    expect(sceneViewMode(app, scene)).toBe("3d");
    expect(levelCamera2D(app, scene)).toBe(camera2D);
  });

  it("finds the level's highest-priority enabled Camera2D in the scene only", async () => {
    const { app, scene } = await twoDScene();
    expect(levelCamera2D(app, scene)).toBeNull();
    const low = app.world.createEntity("Low", { scene }).addComponent(Camera2D);
    const high = app.world.createEntity("High", { scene }).addComponent(Camera2D);
    high.priority = 5;
    const elsewhere = app.world.createEntity("Elsewhere").addComponent(Camera2D);
    elsewhere.priority = 50;
    expect(levelCamera2D(app, scene)).toBe(high);
    high.enabled = false;
    expect(levelCamera2D(app, scene)).toBe(low);
    expect(levelCamera2D(app, null)).toBeNull();
  });

  it("bounds entities by their positions, synced sprite quads under them, and loaded tilemaps", async () => {
    const { app, scene } = await twoDScene();
    expect(boundsOf2D(app, [])).toBeNull();
    const root = app.world.createEntity("Root", { scene });
    root.transform.localPosition.set(1, 2, 0);
    const child = app.world.createEntity("Child", { scene, parent: root });
    child.transform.localPosition.set(4, -1, 0);
    // Headless, nothing syncs a sprite's quad: its entity's position stands in for it.
    child.addComponent(SpriteRenderer);
    expect(boundsOf2D(app, [root])).toEqual({ minX: 1, minY: 2, maxX: 1, maxY: 2 });
    expect(boundsOf2D(app, [root, child])).toEqual({ minX: 1, minY: 1, maxX: 5, maxY: 2 });
    // A tilemap that has not loaded has no extent yet.
    child.addComponent(Tilemap);
    expect(boundsOf2D(app, [child])).toEqual({ minX: 5, minY: 1, maxX: 5, maxY: 1 });
  });
});

/** A level whose only camera is a `Camera2D`. */
const LEVEL: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "main",
  entities: [
    {
      uid: "CAMERA",
      name: "Main Camera",
      parent: null,
      transform: { position: [9.5, 10.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "CAMERA-C", type: "ignifx/Camera2D", props: { orthographicSize: 9 } }],
    },
  ],
};

describe("a headless host with the 2D toolkit", () => {
  it("reports a 2D level on open, and refuses the 2D view it does not list", async () => {
    const target = new EventTarget();
    const starting = startEditorHost({
      editorOrigin: EDITOR_ORIGIN,
      headless: true,
      messageTarget: target,
      heartbeatIntervalMs: 60_000,
      extensions: [twoD({ pixelsPerUnit: 16 })],
    });
    const peer = connect(target);
    try {
      await peer.hello();
      const host = await starting;
      apps.push(host.app);
      await peer.nextNotification(SceneNotification.schemasChanged);
      const opened = await peer.request("openScene", { file: LEVEL, address: "scenes/main.scene.json" });
      expect(opened["result"]).toEqual({ entityCount: 1, warnings: [], viewMode: "2d" });
      expect((await peer.nextNotification(SceneNotification.sceneOpened))["params"]).toEqual({
        address: "scenes/main.scene.json",
        name: "main",
        entityCount: 1,
        warnings: [],
        viewMode: "2d",
      });
      const refused = await peer.request("setViewMode", { mode: "2d" });
      expect(refused).toHaveProperty("error.code", RpcErrorCode.invalidParams);
      // The host's own scripts and its Camera2D stay out of the schemas and the document.
      const schemas = await peer.request("getSchemas");
      expect(schemas).toHaveProperty(["result", "schemas", "ignifx/Camera2D"]);
      expect(schemas).not.toHaveProperty(["result", "schemas", "ignifx-editor/EditorCamera2D"]);
      expect(host.editorScene.roots.map((entity) => entity.name)).toEqual(["Editor Camera"]);
    } finally {
      peer.close();
    }
  });
});
