import { Phase } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { defineSpriteAtlas } from "../../src/atlas/definition.js";
import { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import { buildAtlas } from "../../src/lite/atlas.js";
import { TwoDRuntime } from "../../src/service/runtime.js";
import { TwoDSyncSystem } from "../../src/service/sync-system.js";
import { TwoDService } from "../../src/service/two-d-service.js";
import { defaultTwoDSettings } from "../../src/settings.js";
import { SpriteRenderer } from "../../src/sprite/sprite-renderer.js";
import { createTwoDApp } from "../support/app.js";
import type { LiteSpriteRenderer } from "../../src/lite/types.js";
import type { TwoDSettings } from "../../src/settings.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { Texture2D } from "@babylonjs/lite";

/**
 * `app.twoD.pickAt` and `pickAllAt` (`docs/architecture/11-2d-toolkit.md` §5) on the null engine.
 *
 * The layers and the pick are real Lite; only the swapchain-bound sprite renderer is faked. Every
 * sprite here sits on the origin, so they all overlap the pick point and only the draw order and
 * the rejection rules decide the answer.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** One 32x32 frame over a stub texture; shared so every sprite on a sorting layer pools. */
function atlasAsset(): SpriteAtlasAsset {
  const definition = defineSpriteAtlas({ image: "x.png", frames: [{ name: "a", x: 0, y: 0, w: 32, h: 32 }] });
  const texture = { width: 32, height: 32 } as unknown as Texture2D;
  const rects = [{ name: "a", x: 0, y: 0, w: 32, h: 32, pivotX: 0.5, pivotY: 0.5, sourceW: 32, sourceH: 32 }];
  return new SpriteAtlasAsset("2d/stub.atlas.json", definition, buildAtlas(texture, 32, 32, rects, false), null);
}

/** The service and a helper that adds sprites, over a headless app. */
interface Rig {
  readonly service: TwoDService;
  readonly runtime: TwoDRuntime;
  readonly add: (name: string, sortingLayer?: string) => SpriteRenderer;
  readonly tick: () => void;
}

/** Builds the rig. */
async function createRig(settings?: Partial<TwoDSettings>): Promise<Rig> {
  const created = await createTwoDApp();
  harness = created;
  const runtime = new TwoDRuntime({
    app: created.app,
    settings: { ...defaultTwoDSettings(), ...settings },
    sortingLayers: ["Background", "Default", "Foreground"],
    createRenderer: (): LiteSpriteRenderer => ({ layers: [], clearColor: { r: 0, g: 0, b: 0, a: 1 } }),
    attachLayer: (): void => {},
    detachLayer: (): void => {},
    destroyRenderer: (): void => {},
  });
  const system = new TwoDSyncSystem(runtime);
  const atlas = atlasAsset();
  const add = (name: string, sortingLayer = "Default"): SpriteRenderer => {
    const sprite = created.app.world.createEntity(name).addComponent(SpriteRenderer);
    sprite.sprite = { state: "loaded", value: atlas } as never;
    sprite.sortingLayer = sortingLayer;
    return sprite;
  };
  const tick = (): void => {
    system.update({
      world: created.app.world,
      time: created.app.time,
      phase: Phase.PreRender,
      dt: 1 / 60,
      isClockHeld: false,
    });
  };
  return { service: new TwoDService(runtime), runtime, add, tick };
}

/** The names of a pick list's entities, topmost first. */
function names(hits: readonly { readonly entity: { readonly name: string } }[]): string[] {
  return hits.map((hit) => hit.entity.name);
}

describe("pickAt", () => {
  it("looks under an unpickable sprite in the same layer instead of abandoning it", async () => {
    const rig = await createRig();
    rig.add("ground", "Background");
    rig.add("rock");
    const ghost = rig.add("ghost");
    ghost.pickable = false;
    rig.tick();
    expect(rig.service.pickAt(0, 0)?.entity.name).toBe("rock");
  });

  it("considers unpickable sprites when asked to", async () => {
    const rig = await createRig();
    rig.add("rock");
    const ghost = rig.add("ghost");
    ghost.pickable = false;
    rig.tick();
    expect(rig.service.pickAt(0, 0, { includeUnpickable: true })?.component).toBe(ghost);
  });

  it("continues past a sprite the filter rejects, into the layers below", async () => {
    const rig = await createRig();
    rig.add("ground", "Background");
    rig.add("rock");
    rig.add("canopy", "Foreground");
    rig.tick();
    const seen: string[] = [];
    const hit = rig.service.pickAt(0, 0, {
      filter: (entity, component) => {
        seen.push(entity.name);
        expect(component.entity).toBe(entity);
        return entity.name === "ground";
      },
    });
    expect(hit?.entity.name).toBe("ground");
    expect(seen).toEqual(["canopy", "rock", "ground"]);
  });

  it("skips ignored entities", async () => {
    const rig = await createRig();
    const rock = rig.add("rock");
    rig.add("tree");
    const tree = rig.add("tree-top");
    rig.tick();
    expect(rig.service.pickAt(0, 0, { ignore: [tree.entity] })?.entity.name).toBe("tree");
    expect(rig.service.pickAt(0, 0, { ignore: [tree.entity], filter: (e) => e !== rock.entity })?.entity.name).toBe(
      "tree",
    );
  });

  it("returns null when every sprite under the point is rejected", async () => {
    const rig = await createRig();
    rig.add("rock");
    rig.add("tree");
    rig.tick();
    expect(rig.service.pickAt(0, 0, { filter: () => false })).toBeNull();
  });

  it("restores every sprite it looked under", async () => {
    const rig = await createRig();
    rig.add("rock");
    rig.add("tree");
    rig.tick();
    expect(rig.service.pickAt(0, 0, { filter: () => false })).toBeNull();
    // Both sprites were hidden to look under them; both are back, in the same order.
    expect(names(rig.service.pickAllAt(0, 0))).toEqual(["tree", "rock"]);
  });

  it("keeps the Y-sorted draw order after looking under sprites", async () => {
    const rig = await createRig({ ySort: { Default: true } });
    const low = rig.add("low");
    low.entity.transform.localPosition.set(0, -0.1, 0);
    const high = rig.add("high");
    high.entity.transform.localPosition.set(0, 0.1, 0);
    rig.tick();
    // Y-sort draws the lower sprite in front.
    expect(names(rig.service.pickAllAt(0, 0))).toEqual(["low", "high"]);
    expect(rig.service.pickAt(0, 0, { filter: (e) => e === high.entity })?.entity.name).toBe("high");
    expect(rig.service.pickAt(0, 0)?.entity.name).toBe("low");
  });
});

describe("pickAllAt", () => {
  it("returns the whole stack topmost first, across layers", async () => {
    const rig = await createRig();
    rig.add("ground", "Background");
    rig.add("rock");
    rig.add("tree");
    rig.add("canopy", "Foreground");
    rig.tick();
    expect(names(rig.service.pickAllAt(0, 0))).toEqual(["canopy", "tree", "rock", "ground"]);
    // A second walk sees the same stack, so the first one left nothing hidden.
    expect(names(rig.service.pickAllAt(0, 0))).toEqual(["canopy", "tree", "rock", "ground"]);
  });

  it("stops at the limit", async () => {
    const rig = await createRig();
    rig.add("ground", "Background");
    rig.add("rock");
    rig.add("tree");
    rig.tick();
    expect(names(rig.service.pickAllAt(0, 0, { limit: 2 }))).toEqual(["tree", "rock"]);
    expect(rig.service.pickAllAt(0, 0, { limit: 0 })).toEqual([]);
    expect(names(rig.service.pickAllAt(0, 0))).toEqual(["tree", "rock", "ground"]);
  });

  it("applies the same rejection rules as pickAt", async () => {
    const rig = await createRig();
    rig.add("ground", "Background");
    const rock = rig.add("rock");
    rock.pickable = false;
    rig.add("tree");
    rig.tick();
    expect(names(rig.service.pickAllAt(0, 0))).toEqual(["tree", "ground"]);
    expect(names(rig.service.pickAllAt(0, 0, { includeUnpickable: true }))).toEqual(["tree", "rock", "ground"]);
    expect(names(rig.service.pickAllAt(0, 0, { filter: (e) => e.name !== "tree" }))).toEqual(["ground"]);
  });

  it("misses with an empty list", async () => {
    const rig = await createRig();
    rig.add("rock");
    rig.tick();
    expect(rig.service.pickAllAt(5000, 5000)).toEqual([]);
  });
});
