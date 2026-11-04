import { describe, expect, it } from "vitest";
import {
  GAME_VIEW_MAX_SIZE,
  isGameViewFrameParams,
  isGameViewFrameResult,
  isGameViewState,
  isRenderThumbnailParams,
  isSetGameViewParams,
  isThumbnailResult,
  THUMBNAIL_MAX_SIZE,
} from "../src/protocol/index.js";
import { boundsSettler, thumbnailScene, thumbnailSubject } from "../src/scene/thumbnails.js";
import { centredLayerView } from "../src/scene/view-2d.js";

/**
 * The render-view protocol's guards (engine ask E8) and the thumbnail subject's typing, without a
 * device. `render-views.browser.test.ts` renders them.
 */

/** A one-pixel PNG data URL. */
const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("the render-view guards", () => {
  it("check setGameView's parameters and answer", () => {
    expect(isSetGameViewParams({ enabled: true })).toBe(true);
    expect(isSetGameViewParams({ enabled: false, width: 1, height: GAME_VIEW_MAX_SIZE })).toBe(true);
    expect(isSetGameViewParams({ enabled: "yes" })).toBe(false);
    expect(isSetGameViewParams({ enabled: true, width: 0 })).toBe(false);
    expect(isSetGameViewParams({ enabled: true, height: GAME_VIEW_MAX_SIZE + 1 })).toBe(false);
    expect(isSetGameViewParams({ enabled: true, width: 2.5 })).toBe(false);
    expect(isGameViewState({ enabled: true, width: 640, height: 360 })).toBe(true);
    expect(isGameViewState({ enabled: true, width: 640 })).toBe(false);
  });

  it("check gameViewFrame's parameters and answer, an image and a camera or neither", () => {
    expect(isGameViewFrameParams({ format: "png" })).toBe(true);
    expect(isGameViewFrameParams({ format: "jpeg", quality: 1 })).toBe(true);
    expect(isGameViewFrameParams({ format: "webp" })).toBe(false);
    expect(isGameViewFrameParams({ format: "jpeg", quality: 1.5 })).toBe(false);
    expect(isGameViewFrameParams({ format: "png", width: 1, height: GAME_VIEW_MAX_SIZE })).toBe(true);
    expect(isGameViewFrameParams({ format: "png", width: 320 })).toBe(true);
    expect(isGameViewFrameParams({ format: "png", width: 0 })).toBe(false);
    expect(isGameViewFrameParams({ format: "png", height: GAME_VIEW_MAX_SIZE + 1 })).toBe(false);
    expect(isGameViewFrameParams({ format: "png", width: 2.5 })).toBe(false);
    expect(isGameViewFrameResult({ dataUrl: PNG, width: 4, height: 4, camera: "EYE" })).toBe(true);
    expect(isGameViewFrameResult({ dataUrl: null, width: 4, height: 4, camera: null })).toBe(true);
    expect(isGameViewFrameResult({ dataUrl: null, width: 4, height: 4, camera: "EYE" })).toBe(false);
    expect(isGameViewFrameResult({ dataUrl: PNG, width: 4, height: 4, camera: null })).toBe(false);
    expect(isGameViewFrameResult({ dataUrl: "data:text/plain,x", width: 4, height: 4, camera: "EYE" })).toBe(false);
  });

  it("check renderThumbnail's parameters and answer", () => {
    expect(isRenderThumbnailParams({ asset: "models/crate.glb", format: "png" })).toBe(true);
    expect(
      isRenderThumbnailParams({ asset: { $asset: "door.prefab.json" }, size: THUMBNAIL_MAX_SIZE, format: "jpeg" }),
    ).toBe(true);
    expect(isRenderThumbnailParams({ asset: "", format: "png" })).toBe(false);
    expect(isRenderThumbnailParams({ asset: { path: "x" }, format: "png" })).toBe(false);
    expect(isRenderThumbnailParams({ asset: "a.glb", size: THUMBNAIL_MAX_SIZE + 1, format: "png" })).toBe(false);
    expect(isRenderThumbnailParams({ asset: "a.glb" })).toBe(false);
    expect(isThumbnailResult({ dataUrl: PNG, width: 128, height: 128 })).toBe(true);
    expect(isThumbnailResult({ dataUrl: PNG, width: 0, height: 128 })).toBe(false);
  });
});

describe("the 2D game view's layer view", () => {
  it("puts the camera's centre at the image's centre, in layer pixels with +Y down", () => {
    const shot = { centreX: 2, centreY: 1, zoom: 2, rotation: 0 };
    // 100 px per metre: the centre is layer pixel (200, -100); 320x180 at zoom 2 spans 160x90.
    expect(centredLayerView(shot, 320, 180, 100)).toEqual({ x: 120, y: -145, zoom: 2, rotation: 0 });
  });

  it("turns the corner offset with the view, and treats zoom 0 as 1", () => {
    const view = centredLayerView({ centreX: 0, centreY: 0, zoom: 0, rotation: Math.PI / 2 }, 100, 50, 10);
    expect(view.zoom).toBe(1);
    expect(view.rotation).toBe(Math.PI / 2);
    expect(view.x).toBeCloseTo(-25);
    expect(view.y).toBeCloseTo(50);
  });
});

describe("thumbnail subjects", () => {
  it("type an asset by its reference's type, else by its extension", () => {
    expect(thumbnailSubject({ asset: "models/Crate.GLB", format: "png" })).toEqual({
      address: "models/Crate.GLB",
      kind: "model",
    });
    expect(thumbnailSubject({ asset: "a.gltf", format: "png" }).kind).toBe("model");
    expect(thumbnailSubject({ asset: "door.prefab.json", format: "png" }).kind).toBe("prefab");
    expect(thumbnailSubject({ asset: { $asset: "level.scene.json" }, format: "png" }).kind).toBe("prefab");
    expect(thumbnailSubject({ asset: { $asset: "blob.bin", type: "model" }, format: "png" }).kind).toBe("model");
    expect(() => thumbnailSubject({ asset: "boom.ogg", format: "png" })).toThrow(/neither/u);
    expect(() => thumbnailSubject({ asset: { $asset: "x.glb", type: "material" }, format: "png" })).toThrow(/neither/u);
  });

  it("show a model through a Model component and a prefab as an instance", () => {
    expect(thumbnailScene("models/crate.glb", "model").entities[0]?.components?.[0]).toMatchObject({
      type: "ignifx/Model",
      props: { model: { $asset: "models/crate.glb", type: "model" } },
    });
    expect(thumbnailScene("door.prefab.json", "prefab").entities[0]?.instance).toEqual({
      scene: { $asset: "door.prefab.json" },
    });
  });
});

describe("when a thumbnail's subject has settled", () => {
  const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 2, z: 3 } };

  it("waits for the bounds to hold still for two frames", () => {
    const settled = boundsSettler();
    expect(settled(null, false)).toBe(false);
    expect(settled(box, false)).toBe(false);
    expect(settled({ ...box }, false)).toBe(false);
    expect(settled({ ...box }, false)).toBe(true);
  });

  it("gives up on an empty subject after a few frames, but not while an asset is loading", () => {
    const settled = boundsSettler();
    for (let frame = 0; frame < 10; frame += 1) {
      expect(settled(null, true)).toBe(false);
    }
    expect([settled(null, false), settled(null, false), settled(null, false)]).toEqual([false, false, false]);
    expect(settled(null, false)).toBe(true);
  });
});
