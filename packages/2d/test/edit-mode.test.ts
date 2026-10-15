import { afterEach, describe, expect, it } from "vitest";
import { defineSpriteAtlas } from "../src/atlas/definition.js";
import { SpriteAtlasAsset } from "../src/atlas/sprite-atlas-asset.js";
import { Camera2D } from "../src/camera/camera-2d.js";
import { buildAtlas } from "../src/lite/atlas.js";
import { SpriteRenderer } from "../src/sprite/sprite-renderer.js";
import { createTwoDApp } from "./support/app.js";
import type { TwoDAppHarness } from "./support/app.js";
import type { Texture2D } from "@babylonjs/lite";

/**
 * The 2D sync in an edit-mode app (ADR-0028): it keeps turning sprites into what is drawn, so a
 * sprite the editor moves is written again. The animation half is in
 * `animation/sprite-animator.test.ts`.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A loaded atlas whose Lite half is real, over a stub texture, so a headless sync has something
 * to write (the pattern of `lite/sync-system.test.ts`).
 *
 * @returns The atlas.
 */
function atlasAsset(): SpriteAtlasAsset {
  const definition = defineSpriteAtlas({ image: "x.png", frames: [{ name: "a", x: 0, y: 0, w: 32, h: 32 }] });
  const rects = [{ name: "a", x: 0, y: 0, w: 32, h: 32, pivotX: 0.5, pivotY: 0.5, sourceW: 32, sourceH: 32 }];
  // Boundary assertion: the stub stands in for a GPU texture the headless engine cannot create.
  const texture = { width: 32, height: 32 } as unknown as Texture2D;
  return new SpriteAtlasAsset("2d/stub.atlas.json", definition, buildAtlas(texture, 32, 32, rects, false), null);
}

describe("the 2D sync in an edit-mode app", () => {
  it("writes a new sprite, and writes it again when the editor moves it", async () => {
    const created = await createTwoDApp({ editMode: true });
    harness = created;
    created.app.world.createEntity("EditorCamera").addComponent(Camera2D);
    const entity = created.app.world.createEntity("hero");
    // Boundary assertion: a loaded handle without the asset service, as the sync tests use.
    entity.addComponent(SpriteRenderer).sprite = { state: "loaded", value: atlasAsset() } as never;

    created.step();
    expect(created.app.twoD.syncedLastFrame).toBe(1);

    created.step();
    expect(created.app.twoD.syncedLastFrame).toBe(0);

    entity.transform.position = { x: 2, y: 1, z: 0 };
    created.step();
    expect(created.app.twoD.syncedLastFrame).toBe(1);
  });
});
