import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { TWO_D_ANIMATION_ORDER } from "../src/animation/animation-system.js";
import { SpriteAnimator } from "../src/animation/sprite-animator.js";
import { Camera2DFollow } from "../src/camera/camera-2d-follow.js";
import { Camera2D } from "../src/camera/camera-2d.js";
import { twoD } from "../src/extension.js";
import { TWO_D_SYNC_ORDER } from "../src/service/sync-system.js";
import { TwoDService } from "../src/service/two-d-service.js";
import { defaultTwoDSettings, TWO_D_SETTINGS_SECTION } from "../src/settings.js";
import { ParallaxLayer } from "../src/sprite/parallax-layer.js";
import { SpriteLayerEffect } from "../src/sprite/sprite-layer-effect.js";
import { SpriteRenderer } from "../src/sprite/sprite-renderer.js";
import { TilemapRenderer } from "../src/tilemap/tilemap-renderer.js";
import { Tilemap } from "../src/tilemap/tilemap.js";
import { VERSION } from "../src/version.js";
import { createTwoDApp, fixtureFiles } from "./support/app.js";
import type { SpriteAtlasAsset } from "../src/atlas/sprite-atlas-asset.js";
import type { TwoDSettings } from "../src/settings.js";
import type { TwoDAppHarness } from "./support/app.js";
import type { App } from "@ignifx/core";

/**
 * What registering `twoD()` gives a game (`docs/architecture/04-extensions.md` §1,
 * `11-2d-toolkit.md` §1 and §7).
 */

let harness: TwoDAppHarness | null = null;
let bare: App | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
  bare?.dispose();
  bare = null;
});

describe("the extension descriptor", () => {
  it("declares the documented name, version, engine range, and requirement", () => {
    const extension = twoD();
    expect(extension.name).toBe("@ignifx/2d");
    expect(extension.version).toBe(VERSION);
    expect(extension.engine).toBe(">=0.0.0 <1.0.0");
    expect(extension.requires).toEqual(["@ignifx/core"]);
  });

  it("does nothing at module import time beyond building the descriptor", () => {
    expect(() => twoD()).not.toThrow();
    expect(() => twoD({ pixelsPerUnit: 16 })).not.toThrow();
  });
});

describe("system placement", () => {
  it("syncs sprites at PreRender -450, not the -400 the architecture doc names", () => {
    // `@ignifx/audio`'s spatial pump already holds `PreRender -400` (`AUDIO_PUMP_ORDER`,
    // `docs/architecture/10-audio.md` §5). Equal orders are broken by registration order, which
    // would make the frame order depend on the order a game lists its extensions in.
    expect(TWO_D_SYNC_ORDER).toBe(-450);
    expect(TWO_D_SYNC_ORDER).toBeGreaterThan(-500);
    expect(TWO_D_SYNC_ORDER).toBeLessThan(-400);
  });

  it("advances animation in the middle of an otherwise empty PostUpdate", () => {
    expect(TWO_D_ANIMATION_ORDER).toBe(0);
  });
});

describe("registration", () => {
  it("defines app.twoD and registers it as a service", async () => {
    harness = await createTwoDApp();
    expect(harness.app.twoD).toBeInstanceOf(TwoDService);
    expect(harness.app.services.get(TwoDService)).toBe(harness.app.twoD);
  });

  it("registers every component class under its typeId", async () => {
    harness = await createTwoDApp();
    const registry = harness.app.world.registry;
    for (const type of [
      Camera2D,
      SpriteRenderer,
      SpriteAnimator,
      Tilemap,
      TilemapRenderer,
      ParallaxLayer,
      SpriteLayerEffect,
      Camera2DFollow,
    ]) {
      expect(registry.get(type.typeId)).toBe(type);
    }
  });

  it("resolves the twoD settings section to its documented defaults", async () => {
    harness = await createTwoDApp();
    expect(harness.app.settings.section<TwoDSettings>(TWO_D_SETTINGS_SECTION)).toEqual(defaultTwoDSettings());
    expect(harness.app.twoD.pixelsPerUnit).toBe(100);
    expect(harness.app.twoD.mode).toBe("sprite");
  });

  it("lets a project override the section", async () => {
    harness = await createTwoDApp({ settings: { twoD: { pixelsPerUnit: 16 } } });
    expect(harness.app.twoD.pixelsPerUnit).toBe(16);
  });

  it("lets the extension options beat the project settings", async () => {
    harness = await createTwoDApp({ settings: { twoD: { pixelsPerUnit: 16 } }, options: { pixelsPerUnit: 8 } });
    expect(harness.app.twoD.pixelsPerUnit).toBe(8);
  });

  it("reads the core sortingLayers section rather than declaring its own", async () => {
    harness = await createTwoDApp({ settings: { sortingLayers: { sortingLayers: ["Back", "Default", "Front"] } } });
    expect(harness.app.twoD.sortingLayers).toEqual(["Back", "Default", "Front"]);
  });

  it("registers the three asset types the toolkit reads", async () => {
    harness = await createTwoDApp({ files: fixtureFiles() });
    const handle = harness.app.assets.load("2d/hero.atlas.json");
    expect(handle.type).toBe("spriteatlas");
    handle.release();
  });

  it("refuses a second copy of itself on one app", async () => {
    await expect(createApp({ headless: true, extensions: [twoD(), twoD()] })).rejects.toThrow(/IGX-0406/u);
  });

  it("leaves app.services without the 2D service when the extension is absent", async () => {
    bare = await createApp({ headless: true });
    expect(bare.services.tryGet(TwoDService)).toBeNull();
  });
});

describe("headless behaviour", () => {
  it("creates no sprite renderer and steps without throwing", async () => {
    harness = await createTwoDApp();
    expect(harness.app.twoD.lite.renderer).toBeNull();
    expect(harness.app.renderer.surface).toBeNull();
    for (let index = 0; index < 5; index += 1) {
      harness.step();
    }
    expect(harness.app.twoD.layers).toEqual([]);
    expect(harness.app.twoD.syncedLastFrame).toBe(0);
  });

  it("keeps component state even though nothing is drawn", async () => {
    harness = await createTwoDApp({ files: fixtureFiles() });
    const handle = await harness.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    const entity = harness.app.world.createEntity("hero");
    const sprite = entity.addComponent(SpriteRenderer);
    sprite.sprite = handle.retain();
    sprite.frame = 2;
    harness.step();
    expect(sprite.frame).toBe(2);
    expect(sprite.atlas?.frameCount).toBe(4);
    expect(sprite.lite.sprite).toBeNull();
  });
});

/** A minimal scene file carrying a `settings.twoD` block. */
function sceneWith(block: unknown): string {
  return JSON.stringify({
    format: "ignifx.scene",
    formatVersion: 1,
    name: "level",
    settings: { twoD: block },
    entities: [],
  });
}

describe("scene settings", () => {
  it("lets a scene override the mode and the pixels-per-unit", async () => {
    harness = await createTwoDApp({
      files: { "levels/one.scene.json": sceneWith({ pixelsPerUnit: 16, mode: "mixed" }) },
    });
    expect(harness.app.twoD.pixelsPerUnit).toBe(100);
    await harness.app.world.loadScene("levels/one.scene.json");
    expect(harness.app.twoD.pixelsPerUnit).toBe(16);
    expect(harness.app.twoD.mode).toBe("mixed");
  });

  it("keeps the project's value for anything the block omits", async () => {
    harness = await createTwoDApp({
      settings: { twoD: { pixelsPerUnit: 8, mode: "mixed" } },
      files: { "levels/one.scene.json": sceneWith({ ySort: { Default: true } }) },
    });
    await harness.app.world.loadScene("levels/one.scene.json");
    expect(harness.app.twoD.pixelsPerUnit).toBe(8);
    expect(harness.app.twoD.mode).toBe("mixed");
    expect(harness.app.twoD.settings.ySort).toEqual({ Default: true });
  });

  it("reports an invalid block and leaves the settings alone", async () => {
    harness = await createTwoDApp({
      files: { "levels/bad.scene.json": sceneWith({ pixelsPerUnit: "big" }) },
    });
    const reported: unknown[] = [];
    harness.app.onError.connect((report) => reported.push(report.error));
    await harness.app.world.loadScene("levels/bad.scene.json");
    expect(harness.app.twoD.pixelsPerUnit).toBe(100);
    expect(reported.length).toBeGreaterThan(0);
  });

  it("ignores a scene with no twoD block at all", async () => {
    harness = await createTwoDApp({
      files: {
        "levels/plain.scene.json": JSON.stringify({
          format: "ignifx.scene",
          formatVersion: 1,
          name: "plain",
          entities: [],
        }),
      },
    });
    await harness.app.world.loadScene("levels/plain.scene.json");
    expect(harness.app.twoD.pixelsPerUnit).toBe(100);
  });

  it("ignores a block that is not an object", async () => {
    harness = await createTwoDApp({ files: { "levels/array.scene.json": sceneWith([1, 2, 3]) } });
    await harness.app.world.loadScene("levels/array.scene.json");
    expect(harness.app.twoD.pixelsPerUnit).toBe(100);
  });
});
