import { Phase, Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { defineSpriteAtlas } from "../../src/atlas/definition.js";
import { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import { Camera2D } from "../../src/camera/camera-2d.js";
import { buildAtlas } from "../../src/lite/atlas.js";
import { TwoDRuntime } from "../../src/service/runtime.js";
import { TwoDSyncSystem } from "../../src/service/sync-system.js";
import { TwoDService } from "../../src/service/two-d-service.js";
import { defaultTwoDSettings } from "../../src/settings.js";
import { ParallaxLayer } from "../../src/sprite/parallax-layer.js";
import { SpriteLayerEffect } from "../../src/sprite/sprite-layer-effect.js";
import { SpriteRenderer } from "../../src/sprite/sprite-renderer.js";
import { createTwoDApp } from "../support/app.js";
import type { FrameRect } from "../../src/lite/atlas.js";
import type { LiteSprite2DLayer, LiteSpriteRenderer } from "../../src/lite/types.js";
import type { TwoDSettings } from "../../src/settings.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { Texture2D } from "@babylonjs/lite";
import type { SystemContext } from "@ignifx/core";

/**
 * The `PreRender` sync system driven end to end on the null engine.
 *
 * `TwoDRuntime` takes its four Lite hooks as constructor options precisely so a suite can supply
 * stubs: the layers, the sprites, the views, the Y-sort bias and the chunk culling are all real,
 * and only the swapchain-bound `SpriteRenderer` is faked. What genuinely needs a device — that a
 * sprite's pixels land where the camera says — is the browser suite's job.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Two 32x32 frames over a stub texture. */
function rects(): readonly FrameRect[] {
  return [
    { name: "a", x: 0, y: 0, w: 32, h: 32, pivotX: 0.5, pivotY: 0.5, sourceW: 32, sourceH: 32 },
    { name: "b", x: 32, y: 0, w: 32, h: 32, pivotX: 0.5, pivotY: 1, sourceW: 32, sourceH: 32 },
  ];
}

/** A loaded atlas whose Lite half is real. */
function atlasAsset(): SpriteAtlasAsset {
  const definition = defineSpriteAtlas({
    image: "x.png",
    frames: [
      { name: "a", x: 0, y: 0, w: 32, h: 32 },
      { name: "b", x: 32, y: 0, w: 32, h: 32, pivot: [0.5, 1] },
    ],
  });
  const texture = { width: 64, height: 32 } as unknown as Texture2D;
  return new SpriteAtlasAsset("2d/stub.atlas.json", definition, buildAtlas(texture, 64, 32, rects(), false), null);
}

/** The runtime, the system, the service, and the record of what reached the fake renderer. */
interface Rig {
  readonly runtime: TwoDRuntime;
  readonly system: TwoDSyncSystem;
  readonly service: TwoDService;
  readonly attached: LiteSprite2DLayer[];
  readonly renderers: LiteSpriteRenderer[];
  readonly tick: () => void;
}

/** Builds a rig over a headless app, with the sprite renderer faked. */
async function createRig(settings?: Partial<TwoDSettings>): Promise<Rig> {
  const created = await createTwoDApp();
  harness = created;
  const attached: LiteSprite2DLayer[] = [];
  const renderers: LiteSpriteRenderer[] = [];
  const runtime = new TwoDRuntime({
    app: created.app,
    settings: { ...defaultTwoDSettings(), ...settings },
    sortingLayers: ["Background", "Default", "Foreground"],
    createRenderer: (): LiteSpriteRenderer => {
      const renderer = { layers: [], clearColor: { r: 0, g: 0, b: 0, a: 1 } } as unknown as LiteSpriteRenderer;
      renderers.push(renderer);
      return renderer;
    },
    attachLayer: (_renderer, layer): void => {
      attached.push(layer);
    },
    detachLayer: (): void => {},
    destroyRenderer: (): void => {},
  });
  const system = new TwoDSyncSystem(runtime);
  const service = new TwoDService(runtime);
  const tick = (): void => {
    system.update({ world: created.app.world, time: created.app.time, phase: Phase.PreRender, dt: 1 / 60 });
  };
  return { runtime, system, service, attached, renderers, tick };
}

describe("the renderer's lifetime", () => {
  it("creates and registers the sprite renderer on the first frame, not before", async () => {
    // `registerScene` happens inside `app.start()`, *after* every `onStart` has run, and core emits
    // no signal when it does — so the first `PreRender` tick is the earliest legal moment.
    const rig = await createRig();
    expect(rig.runtime.renderer).toBeNull();
    rig.tick();
    expect(rig.runtime.renderer).not.toBeNull();
    rig.tick();
    expect(rig.renderers).toHaveLength(1);
  });

  it("attaches layers that were created before the renderer existed", async () => {
    const rig = await createRig();
    const sprite = harness?.app.world.createEntity("s").addComponent(SpriteRenderer);
    if (sprite === undefined) {
      return;
    }
    sprite.sprite = { state: "loaded", value: atlasAsset() } as never;
    rig.tick();
    expect(rig.attached.length).toBeGreaterThan(0);
  });

  it("drops everything on dispose", async () => {
    const rig = await createRig();
    rig.tick();
    rig.runtime.dispose();
    expect(rig.runtime.renderer).toBeNull();
    expect(rig.runtime.layers.describe()).toEqual([]);
  });
});

describe("sprite synchronisation", () => {
  /** An entity carrying a sprite with a loaded stub atlas. */
  function addSprite(configure?: (sprite: SpriteRenderer) => void): SpriteRenderer {
    const world = harness?.app.world;
    if (world === undefined) {
      throw new Error("no world");
    }
    const sprite = world.createEntity("s").addComponent(SpriteRenderer);
    sprite.sprite = { state: "loaded", value: atlasAsset() } as never;
    configure?.(sprite);
    return sprite;
  }

  it("places a sprite once and then leaves a still one alone", async () => {
    const rig = await createRig();
    const sprite = addSprite();
    rig.tick();
    expect(sprite.placement()).not.toBeNull();
    expect(rig.runtime.syncedLastFrame).toBe(1);
    rig.tick();
    // Nothing moved and no field changed: the sprite costs one integer comparison.
    expect(rig.runtime.syncedLastFrame).toBe(0);
    expect(rig.runtime.spriteCount).toBe(1);
  });

  it("rewrites a sprite whose transform moved", async () => {
    const rig = await createRig();
    const sprite = addSprite();
    rig.tick();
    rig.tick();
    expect(rig.runtime.syncedLastFrame).toBe(0);
    sprite.entity.transform.position2D = new Vec2(5, 5);
    rig.tick();
    expect(rig.runtime.syncedLastFrame).toBe(1);
  });

  it("rewrites a sprite whose frame changed", async () => {
    const rig = await createRig();
    const sprite = addSprite();
    rig.tick();
    rig.tick();
    sprite.frame = 1;
    rig.tick();
    expect(rig.runtime.syncedLastFrame).toBe(1);
  });

  it("syncs a static entity exactly once", async () => {
    const rig = await createRig();
    const sprite = addSprite();
    sprite.entity.isStatic = true;
    rig.tick();
    expect(rig.runtime.syncedLastFrame).toBe(1);
    sprite.entity.transform.position2D = new Vec2(9, 9);
    rig.tick();
    // A static entity is written once and never re-read, which is what keeps a tilemap free.
    expect(rig.runtime.syncedLastFrame).toBe(0);
  });

  it("moves a sprite to another layer when its key changes", async () => {
    const rig = await createRig();
    const sprite = addSprite();
    rig.tick();
    const first = sprite.placement()?.key;
    sprite.sortingLayer = "Foreground";
    rig.tick();
    expect(sprite.placement()?.key).not.toBe(first);
    expect(sprite.placement()?.key).toContain("Foreground");
    expect(rig.runtime.layers.describe()).toHaveLength(2);
  });

  it("computes a world AABB that honours the frame's pivot", async () => {
    const rig = await createRig({ pixelsPerUnit: 100 });
    const sprite = addSprite((created) => {
      created.frame = 1;
    });
    rig.tick();
    // Frame 1 pivots at its bottom edge, so the box sits entirely above the entity's origin.
    const box = sprite.bounds;
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(0.32, 6);
    expect(box.min.x).toBeCloseTo(-0.16, 6);
    expect(box.max.x).toBeCloseTo(0.16, 6);
  });

  it("ignores a sprite whose atlas has not loaded", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    world?.createEntity("pending").addComponent(SpriteRenderer);
    rig.tick();
    expect(rig.runtime.syncedLastFrame).toBe(0);
    expect(rig.runtime.layers.describe()).toEqual([]);
  });

  it("drops a sprite whose component was destroyed", async () => {
    const rig = await createRig();
    const sprite = addSprite();
    rig.tick();
    expect(rig.runtime.layers.describe()[0]?.count).toBe(1);
    sprite.entity.destroy();
    harness?.step();
    rig.tick();
    expect(rig.runtime.layers.describe()[0]?.count).toBe(0);
  });
});

describe("views", () => {
  it("writes the identity view when no camera is enabled", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    const sprite = world.createEntity("s").addComponent(SpriteRenderer);
    sprite.sprite = { state: "loaded", value: atlasAsset() } as never;
    rig.tick();
    const view = rig.runtime.layers.describe()[0]?.layer.view;
    expect(view?.positionPx).toEqual([0, 0]);
    expect(view?.zoom).toBe(1);
  });

  it("resolves the camera and reports it on the service", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    const camera = world.createEntity("camera").addComponent(Camera2D);
    rig.tick();
    expect(rig.service.mainCamera).toBe(camera);
    expect(rig.runtime.mainCamera).toBe(camera);
  });

  it("leaves a screen-space layer on the identity view", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    world.createEntity("camera").addComponent(Camera2D);
    const hud = world.createEntity("hud").addComponent(SpriteRenderer);
    hud.sprite = { state: "loaded", value: atlasAsset() } as never;
    hud.screenSpace = true;
    rig.tick();
    const entry = rig.runtime.layers.describe().find((candidate) => candidate.screenSpace);
    expect(entry?.layer.view.positionPx).toEqual([0, 0]);
    expect(entry?.layer.view.zoom).toBe(1);
  });

  it("offsets a parallax layer after the camera has written its view", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    const camera = world.createEntity("camera").addComponent(Camera2D);
    camera.entity.transform.position2D = new Vec2(10, 0);
    const background = world.createEntity("bg").addComponent(SpriteRenderer);
    background.sprite = { state: "loaded", value: atlasAsset() } as never;
    background.sortingLayer = "Background";
    const foreground = world.createEntity("fg").addComponent(SpriteRenderer);
    foreground.sprite = { state: "loaded", value: atlasAsset() } as never;
    const parallax = world.createEntity("px").addComponent(ParallaxLayer);
    parallax.sortingLayer = "Background";
    parallax.factor = { x: 0, y: 1 };
    rig.tick();
    const entries = rig.runtime.layers.describe();
    const pinned = entries.find((candidate) => candidate.sortingLayer === "Background");
    const follows = entries.find((candidate) => candidate.sortingLayer === "Default");
    // The camera is 10 m right, which is 1000 layer pixels. The layer that follows it sits there;
    // the pinned one has that offset subtracted back out, leaving it on the world origin.
    expect(follows?.layer.view.positionPx[0]).toBeCloseTo(1000, 6);
    expect(pinned?.layer.view.positionPx[0]).toBeCloseTo(0, 6);
  });
});

describe("layer effects", () => {
  it("installs a shader at layer creation and writes its params each frame", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    const effect = world.createEntity("fx").addComponent(SpriteLayerEffect);
    effect.tint = { r: 0.5, g: 0.25, b: 0.125, a: 1 };
    const sprite = world.createEntity("s").addComponent(SpriteRenderer);
    sprite.sprite = { state: "loaded", value: atlasAsset() } as never;
    rig.tick();
    const entry = rig.runtime.layers.describe()[0];
    expect(entry?.layer.customShader).toBeDefined();
    expect(entry?.layer.shaderParams).toEqual([0.5, 0.25, 0.125, 1]);
  });

  it("leaves a layer with no effect plain", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    const sprite = world.createEntity("s").addComponent(SpriteRenderer);
    sprite.sprite = { state: "loaded", value: atlasAsset() } as never;
    rig.tick();
    expect(rig.runtime.layers.describe()[0]?.layer.customShader).toBeUndefined();
  });
});

describe("the service", () => {
  it("picks a sprite and refuses an unpickable one", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    const sprite = world.createEntity("s").addComponent(SpriteRenderer);
    sprite.sprite = { state: "loaded", value: atlasAsset() } as never;
    rig.tick();
    const hit = rig.service.pickAt(0, 0);
    expect(hit?.component).toBe(sprite);
    expect(hit?.entity).toBe(sprite.entity);
    sprite.pickable = false;
    expect(rig.service.pickAt(0, 0)).toBeNull();
  });

  it("misses when nothing is under the pixel", async () => {
    const rig = await createRig();
    rig.tick();
    expect(rig.service.pickAt(5000, 5000)).toBeNull();
  });

  it("reports the toolkit's settings and layers", async () => {
    const rig = await createRig({ pixelsPerUnit: 16, mode: "mixed" });
    expect(rig.service.pixelsPerUnit).toBe(16);
    expect(rig.service.mode).toBe("mixed");
    expect(rig.service.sortingLayers).toEqual(["Background", "Default", "Foreground"]);
    expect(rig.service.layers).toEqual([]);
    expect(rig.service.lite.renderer).toBeNull();
  });

  it("answers the world box only once a layer exists", async () => {
    const rig = await createRig();
    const box = { min: new Vec2(), max: new Vec2() };
    expect(rig.service.visibleWorldBounds(box)).toBe(false);
  });

  it("falls back to the origin without a camera", async () => {
    const rig = await createRig();
    expect(rig.service.screenToWorld(10, 10, new Vec2())).toEqual({ x: 0, y: 0 });
    expect(rig.service.worldToScreen({ x: 1, y: 1 }, new Vec2())).toEqual({ x: 0, y: 0 });
  });

  it("routes through the camera once one is active", async () => {
    const rig = await createRig();
    const world = harness?.app.world;
    if (world === undefined) {
      return;
    }
    world.createEntity("camera").addComponent(Camera2D);
    rig.tick();
    const world2d = rig.service.screenToWorld(0, 0, new Vec2());
    expect(Number.isFinite(world2d.x)).toBe(true);
    const screen = rig.service.worldToScreen({ x: 0, y: 0 }, new Vec2());
    expect(Number.isFinite(screen.x)).toBe(true);
  });
});

describe("world teardown", () => {
  it("forgets its bookkeeping when the world goes away", async () => {
    const rig = await createRig();
    const context: SystemContext = {
      world: harness?.app.world as never,
      time: harness?.app.time as never,
      phase: Phase.PreRender,
      dt: 0,
    };
    rig.system.update(context);
    expect(() => rig.system.onWorldDisposed(context.world)).not.toThrow();
  });
});
