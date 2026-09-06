import { afterEach, describe, expect, it } from "vitest";
import { defineSpriteAtlas } from "../../src/atlas/definition.js";
import { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import { buildAtlas } from "../../src/lite/atlas.js";
import { compileLayerShader, createSpriteScratch, writeScratch } from "../../src/lite/sprite-layer.js";
import { SpriteLayerRegistry, spriteLayerKey } from "../../src/service/layer-registry.js";
import { SortingLayerTable } from "../../src/service/sorting-layers.js";
import { SpriteRenderer } from "../../src/sprite/sprite-renderer.js";
import { createTwoDApp } from "../support/app.js";
import type { FrameRect } from "../../src/lite/atlas.js";
import type { LiteSprite2DLayer } from "../../src/lite/types.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { Texture2D } from "@babylonjs/lite";

/**
 * The pool of Lite sprite layers (`docs/architecture/11-2d-toolkit.md` §1). One layer per
 * (sorting layer, atlas, blend, space), because Lite binds a layer to one atlas and one blend mode
 * for its whole life.
 *
 * The atlases here carry a stub texture: layer creation and every sprite mutation are pure CPU, so
 * the whole registry is exercisable on the null engine.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Two 8x8 frames, enough for a layer to have something to draw. */
function rects(): readonly FrameRect[] {
  return [
    { name: "a", x: 0, y: 0, w: 8, h: 8, pivotX: 0.5, pivotY: 0.5, sourceW: 8, sourceH: 8 },
    { name: "b", x: 8, y: 0, w: 8, h: 8, pivotX: 0.5, pivotY: 0.5, sourceW: 8, sourceH: 8 },
  ];
}

/** A loaded atlas asset whose Lite half is real but whose texture is a stand-in. */
function atlasAsset(address: string): SpriteAtlasAsset {
  const definition = defineSpriteAtlas({
    image: "x.png",
    frames: [
      { name: "a", x: 0, y: 0, w: 8, h: 8 },
      { name: "b", x: 8, y: 0, w: 8, h: 8 },
    ],
  });
  const texture = { width: 16, height: 8 } as unknown as Texture2D;
  return new SpriteAtlasAsset(address, definition, buildAtlas(texture, 16, 8, rects(), false), null);
}

/** A registry plus the layers it handed the renderer. */
interface Rig {
  readonly registry: SpriteLayerRegistry;
  readonly attached: LiteSprite2DLayer[];
  readonly detached: LiteSprite2DLayer[];
}

/** Builds a registry over three sorting layers. */
function createRegistry(ySort: Readonly<Record<string, boolean>> = {}): Rig {
  const attached: LiteSprite2DLayer[] = [];
  const detached: LiteSprite2DLayer[] = [];
  const registry = new SpriteLayerRegistry(
    new SortingLayerTable(["Background", "Default", "Foreground"]),
    ySort,
    (layer) => attached.push(layer),
    (layer) => detached.push(layer),
  );
  return { registry, attached, detached };
}

/** A `SpriteRenderer` on a fresh entity in a headless world. */
async function createSprite(configure?: (sprite: SpriteRenderer) => void): Promise<SpriteRenderer> {
  if (harness === null) {
    harness = await createTwoDApp();
  }
  const sprite = harness.app.world.createEntity("s").addComponent(SpriteRenderer);
  configure?.(sprite);
  return sprite;
}

describe("the layer key", () => {
  it("separates sprites by sorting layer, atlas, blend and space", () => {
    expect(spriteLayerKey("Default", "a.json", "alpha", false)).toBe("Default|a.json|alpha|world");
    expect(spriteLayerKey("Default", "a.json", "alpha", true)).toBe("Default|a.json|alpha|screen");
    expect(spriteLayerKey("Default", "a.json", "additive", false)).not.toBe(
      spriteLayerKey("Default", "a.json", "alpha", false),
    );
  });
});

describe("placement", () => {
  it("creates one layer on the first sprite and reuses it for the second", async () => {
    const rig = createRegistry();
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    const first = await createSprite();
    const second = await createSprite();
    expect(rig.registry.place(first, atlas, scratch)).toBe("Default|a.json|alpha|world");
    expect(rig.registry.place(second, atlas, scratch)).toBe("Default|a.json|alpha|world");
    expect(rig.registry.describe()).toHaveLength(1);
    expect(rig.attached).toHaveLength(1);
    expect(rig.registry.describe()[0]?.count).toBe(2);
  });

  it("splits layers by blend mode and by atlas", async () => {
    const rig = createRegistry();
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(await createSprite(), atlasAsset("a.json"), scratch);
    rig.registry.place(
      await createSprite((sprite) => {
        sprite.blend = "additive";
      }),
      atlasAsset("a.json"),
      scratch,
    );
    rig.registry.place(await createSprite(), atlasAsset("b.json"), scratch);
    expect(rig.registry.describe()).toHaveLength(3);
  });

  it("orders layers by their sorting layer, back to front", async () => {
    const rig = createRegistry();
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(
      await createSprite((sprite) => {
        sprite.sortingLayer = "Foreground";
      }),
      atlasAsset("a.json"),
      scratch,
    );
    rig.registry.place(
      await createSprite((sprite) => {
        sprite.sortingLayer = "Background";
      }),
      atlasAsset("a.json"),
      scratch,
    );
    const entries = rig.registry.describe();
    expect(entries.map((entry) => entry.sortingLayer)).toEqual(["Background", "Foreground"]);
    expect(entries[0]?.layer.order).toBeLessThan(entries[1]?.layer.order ?? 0);
  });

  it("turns Y-sort on only for the sorting layers the settings name", async () => {
    const rig = createRegistry({ Default: true });
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(await createSprite(), atlasAsset("a.json"), scratch);
    rig.registry.place(
      await createSprite((sprite) => {
        sprite.sortingLayer = "Background";
      }),
      atlasAsset("a.json"),
      scratch,
    );
    const entries = rig.registry.describe();
    expect(entries.find((entry) => entry.sortingLayer === "Default")?.ySort).toBe(true);
    expect(entries.find((entry) => entry.sortingLayer === "Background")?.ySort).toBe(false);
  });

  it("never Y-sorts a screen-space layer", async () => {
    const rig = createRegistry({ Default: true });
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(
      await createSprite((sprite) => {
        sprite.screenSpace = true;
      }),
      atlasAsset("a.json"),
      scratch,
    );
    expect(rig.registry.describe()[0]?.ySort).toBe(false);
  });

  it("refuses to build a layer over an atlas that was never uploaded", async () => {
    const rig = createRegistry();
    const scratch = createSpriteScratch();
    const headless = new SpriteAtlasAsset(
      "a.json",
      defineSpriteAtlas({ image: "x.png", frames: [{ name: "a", x: 0, y: 0, w: 8, h: 8 }] }),
      null,
      null,
    );
    const sprite = await createSprite();
    expect(() => rig.registry.place(sprite, headless, scratch)).toThrow(/headless/u);
  });
});

describe("removal", () => {
  it("keeps the pick map in step with Lite's swap-remove", async () => {
    const rig = createRegistry();
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    const first = await createSprite();
    const second = await createSprite();
    const third = await createSprite();
    for (const sprite of [first, second, third]) {
      rig.registry.place(sprite, atlas, scratch);
    }
    const layer = rig.registry.describe()[0]?.layer;
    expect(layer).toBeDefined();
    if (layer === undefined) {
      return;
    }
    expect(rig.registry.componentAt(layer, 0)).toBe(first);
    expect(rig.registry.componentAt(layer, 2)).toBe(third);
    rig.registry.remove(first);
    // Lite moved the last sprite into slot 0; the map has to have moved with it.
    expect(rig.registry.componentAt(layer, 0)).toBe(third);
    expect(first.placement()).toBeNull();
  });

  it("ignores a sprite that is not in any layer", async () => {
    const rig = createRegistry();
    const sprite = await createSprite();
    expect(() => rig.registry.remove(sprite)).not.toThrow();
  });

  it("answers null for an unmapped slot and an unknown layer", async () => {
    const rig = createRegistry();
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(await createSprite(), atlas, scratch);
    const layer = rig.registry.describe()[0]?.layer;
    if (layer !== undefined) {
      expect(rig.registry.componentAt(layer, 99)).toBeNull();
    }
    const stranger = { view: { positionPx: [0, 0], zoom: 1, rotation: 0 } } as unknown as LiteSprite2DLayer;
    expect(rig.registry.componentAt(stranger, 0)).toBeNull();
  });
});

describe("component-less sprites", () => {
  it("places and removes a tile without claiming a pick slot", async () => {
    const rig = createRegistry();
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    const placed = rig.registry.placeRaw("Default", atlas, "alpha", false, scratch);
    expect(placed.key).toBe("Default|a.json|alpha|world");
    const layer = rig.registry.describe()[0]?.layer;
    expect(layer).toBeDefined();
    if (layer !== undefined) {
      // A tile is not a `SpriteRenderer`, so `pickAt` must not resolve one.
      expect(rig.registry.componentAt(layer, 0)).toBeNull();
    }
    rig.registry.removeRaw(placed.key, placed.handle);
    expect(rig.registry.describe()[0]?.count).toBe(0);
  });

  it("tolerates a removal against an unknown key", () => {
    const rig = createRegistry();
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    const placed = rig.registry.placeRaw("Default", atlas, "alpha", false, scratch);
    expect(() => rig.registry.removeRaw("nope", placed.handle)).not.toThrow();
  });
});

describe("collection and teardown", () => {
  it("collects world layers only when asked", async () => {
    const rig = createRegistry();
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(await createSprite(), atlas, scratch);
    rig.registry.place(
      await createSprite((sprite) => {
        sprite.screenSpace = true;
      }),
      atlas,
      scratch,
    );
    const out: LiteSprite2DLayer[] = [];
    expect(rig.registry.collectLayers(false, out)).toHaveLength(2);
    expect(rig.registry.collectLayers(true, out)).toHaveLength(1);
    // The same array is reused every frame.
    expect(rig.registry.collectLayers(true, out)).toBe(out);
  });

  it("walks every layer with its space flag", async () => {
    const rig = createRegistry();
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(await createSprite(), atlas, scratch);
    const spaces: boolean[] = [];
    rig.registry.forEachLayer((_layer, screenSpace) => spaces.push(screenSpace));
    expect(spaces).toEqual([false]);
  });

  it("hands each layer back to the renderer when cleared", async () => {
    const rig = createRegistry();
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(await createSprite(), atlas, scratch);
    rig.registry.clear();
    expect(rig.detached).toHaveLength(1);
    expect(rig.registry.describe()).toEqual([]);
  });
});

describe("custom shaders", () => {
  it("pulls a shader at layer creation and writes its params afterwards", async () => {
    const rig = createRegistry();
    const shader = compileLayerShader("return vec4f(1.0);");
    rig.registry.setShaderProvider((sortingLayer) => (sortingLayer === "Default" ? shader : null));
    const atlas = atlasAsset("a.json");
    const scratch = createSpriteScratch();
    writeScratch(scratch, 0, 0, 8, 8, 0, 0, 1, 1, 1, 1, false, false, true);
    rig.registry.place(await createSprite(), atlas, scratch);
    rig.registry.place(
      await createSprite((sprite) => {
        sprite.sortingLayer = "Background";
      }),
      atlas,
      scratch,
    );
    const entries = rig.registry.describe();
    expect(entries.find((entry) => entry.sortingLayer === "Default")?.layer.customShader).toBe(shader);
    expect(entries.find((entry) => entry.sortingLayer === "Background")?.layer.customShader).toBeUndefined();
    rig.registry.writeShaderParams("Default", new Float32Array([1, 2, 3, 4]));
    expect(entries.find((entry) => entry.sortingLayer === "Default")?.layer.shaderParams).toEqual([1, 2, 3, 4]);
  });
});
