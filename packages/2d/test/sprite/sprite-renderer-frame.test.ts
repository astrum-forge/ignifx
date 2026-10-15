import { isIgnifxError, serializeScene, stringifySceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import { SpriteRenderer } from "../../src/sprite/sprite-renderer.js";
import { createTwoDApp, fixtureFiles, readFixture } from "../support/app.js";
import type { TwoDAppHarness } from "../support/app.js";
import type { AssetHandle, ErrorReport, JsonObject, SceneInstance } from "@ignifx/core";

/**
 * `SpriteRenderer.frameName` (`docs/architecture/11-2d-toolkit.md` §2.2): the frame a scene file
 * says a sprite draws, by name. It loads, it is written back byte for byte, a bad name is reported
 * once and draws the first frame, and a `#frame:` address in `sprite` is reported once instead of
 * breaking the 2D sync every frame.
 *
 * All of it is headless: the frame is an index the sync writes into Lite's sprite props, so no GPU
 * data depends on anything but that index, which the existing browser suites already draw.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The scene address every case loads. */
const SCENE = "levels/sprites.scene.json";

/** `hero.atlas.json` with its frames in reverse order, so `run_0` sits at another index. */
function reversedAtlas(): string {
  const document = JSON.parse(readFixture("hero.atlas.json")) as { frames: unknown[] };
  document.frames.reverse();
  return JSON.stringify(document);
}

/**
 * A scene with one sprite entity.
 *
 * @param props - The `SpriteRenderer` props as the file writes them.
 * @returns The scene file's text.
 */
function sceneWith(props: JsonObject): string {
  return JSON.stringify({
    format: "ignifx.scene",
    formatVersion: 1,
    name: "sprites",
    entities: [
      {
        uid: "01M5019D56QN4RE9MGE5CG2Y05",
        name: "Hero",
        parent: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: [{ uid: "01M5019D57GNWGM08AR6VY0BYX", type: "ignifx/SpriteRenderer", props }],
      },
    ],
  });
}

/** The atlas reference the scenes write. */
const HERO_ATLAS: JsonObject = { $asset: "2d/hero.atlas.json", type: "spriteatlas" };

/**
 * Builds a headless app serving the fixtures plus the given scene, and collects `app.onError`.
 *
 * @param scene - The scene file's text.
 * @returns The harness and the errors reported so far.
 */
async function createRig(scene: string): Promise<{ readonly h: TwoDAppHarness; readonly errors: unknown[] }> {
  const h = await createTwoDApp({
    files: { ...fixtureFiles(), "2d/hero-reversed.atlas.json": reversedAtlas(), [SCENE]: scene },
  });
  harness = h;
  const errors: unknown[] = [];
  h.app.onError.connect((report: ErrorReport): void => {
    errors.push(report.error);
  });
  return { h, errors };
}

/**
 * Loads the scene and returns its one sprite.
 *
 * @param h - The harness.
 * @returns The scene instance and the sprite.
 */
async function loadSprite(
  h: TwoDAppHarness,
): Promise<{ readonly instance: SceneInstance; readonly sprite: SpriteRenderer }> {
  const instance = await h.app.world.loadScene(SCENE);
  const sprite = h.app.world.findByName("Hero")?.getComponent(SpriteRenderer) ?? null;
  if (sprite === null) {
    throw new Error("the scene has no Hero sprite");
  }
  return { instance, sprite };
}

/**
 * The codes of the `IgnifxError`s among the reported errors.
 *
 * @param errors - What `app.onError` received.
 * @returns One code per error, in report order.
 */
function codes(errors: readonly unknown[]): string[] {
  return errors.map((error) => (isIgnifxError(error) ? error.code : String(error)));
}

describe("SpriteRenderer.frameName in a scene file", () => {
  it("loads with the named frame selected", async () => {
    const { h, errors } = await createRig(sceneWith({ sprite: HERO_ATLAS, frameName: "run_0" }));
    const { sprite } = await loadSprite(h);

    expect(sprite.frameName).toBe("run_0");
    expect(sprite.frame).toBe(2);
    h.step();
    expect(sprite.frame).toBe(2);
    expect(errors).toEqual([]);
  });

  it("defaults to the first frame, and a file without the field loads", async () => {
    const { h, errors } = await createRig(sceneWith({ sprite: HERO_ATLAS }));
    const { sprite } = await loadSprite(h);

    expect(sprite.frameName).toBe("");
    expect(sprite.frame).toBe(0);
    expect(errors).toEqual([]);
  });

  it("is written back by serializeScene, and the file round-trips byte for byte", async () => {
    const first = await createRig(sceneWith({ sprite: HERO_ATLAS, frameName: "run_1" }));
    const text = stringifySceneFile(serializeScene((await loadSprite(first.h)).instance, { engineVersion: null }));
    first.h.dispose();
    harness = null;

    const written = JSON.parse(text) as { entities: { components: { props: JsonObject }[] }[] };
    const props = written.entities[0]?.components[0]?.props;
    expect(props?.["frameName"]).toBe("run_1");
    expect(Object.keys(props ?? {}).slice(0, 2)).toEqual(["sprite", "frameName"]);

    const second = await createRig(text);
    const { instance, sprite } = await loadSprite(second.h);
    expect(sprite.frame).toBe(3);
    expect(stringifySceneFile(serializeScene(instance, { engineVersion: null }))).toBe(text);
  });

  it("saves the authored name, not the index an animator or script wrote since", async () => {
    const { h } = await createRig(sceneWith({ sprite: HERO_ATLAS, frameName: "idle_1" }));
    const { instance, sprite } = await loadSprite(h);

    sprite.frame = 3;
    h.step();
    expect(sprite.frame).toBe(3);
    const props = serializeScene(instance, { engineVersion: null }).entities[0]?.components?.[0]?.props;
    expect(props?.["frameName"]).toBe("idle_1");

    // Writing the name again makes it decide the frame again.
    sprite.frameName = "run_0";
    expect(sprite.frame).toBe(2);
  });

  it("looks the name up again when the sprite moves to another atlas", async () => {
    const { h, errors } = await createRig(sceneWith({ sprite: HERO_ATLAS, frameName: "run_0" }));
    const { sprite } = await loadSprite(h);
    expect(sprite.frame).toBe(2);

    sprite.sprite = await h.load<SpriteAtlasAsset>("2d/hero-reversed.atlas.json");
    h.step();
    expect(sprite.frame).toBe(1);
    expect(errors).toEqual([]);
  });

  it("reports a name the atlas does not declare once, with IGX-1106, and draws the first frame", async () => {
    const { h, errors } = await createRig(sceneWith({ sprite: HERO_ATLAS, frameName: "jump_0" }));
    const { sprite } = await loadSprite(h);

    expect(sprite.frame).toBe(0);
    for (let frame = 0; frame < 5; frame += 1) {
      h.step();
    }
    expect(sprite.frame).toBe(0);
    expect(codes(errors)).toEqual(["IGX-1106"]);
    const [error] = errors;
    expect(isIgnifxError(error) ? error.context : null).toMatchObject({ atlas: "2d/hero.atlas.json", frame: "jump_0" });

    // A different bad name is a different problem, and is reported in its turn.
    sprite.frameName = "jump_1";
    h.step();
    h.step();
    expect(codes(errors)).toEqual(["IGX-1106", "IGX-1106"]);
  });
});

describe("a #frame: address in SpriteRenderer.sprite", () => {
  it("is reported once with IGX-1118 and draws nothing, instead of throwing in the 2D sync", async () => {
    const { h, errors } = await createRig(
      sceneWith({ sprite: { $asset: "2d/hero.atlas.json#frame:run_0", type: "spriteatlas" } }),
    );
    const { sprite } = await loadSprite(h);

    expect(sprite.sprite?.state).toBe("loaded");
    expect(sprite.atlas).toBeNull();
    for (let frame = 0; frame < 5; frame += 1) {
      h.step();
    }
    expect(codes(errors)).toEqual(["IGX-1118"]);
    expect(sprite.placement()).toBeNull();
    const [error] = errors;
    expect(isIgnifxError(error) ? error.hint : null).toContain("frameName");
  });

  it("still loads a SpriteAsset for code that asks for one", async () => {
    const { h } = await createRig(sceneWith({}));
    const handle: AssetHandle<{ readonly atlas: SpriteAtlasAsset; readonly frame: number; readonly name: string }> =
      await h.load("2d/hero.atlas.json#frame:run_1");

    expect(handle.state === "loaded" ? handle.value.frame : null).toBe(3);
    expect(handle.state === "loaded" ? handle.value.atlas : null).toBeInstanceOf(SpriteAtlasAsset);
  });
});
