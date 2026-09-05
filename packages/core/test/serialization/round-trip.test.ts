import { afterEach, describe, expect, it } from "vitest";
import { instantiateScene } from "../../src/serialization/load.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { AudioClip, Everything, Tagger, createSerializationWorld, fakeHandle } from "./fixtures.js";
import type { Entity } from "../../src/entity/entity.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * The byte-identical round trip of `06-serialization-and-scene-format.md` §1: build in code, save,
 * load into a fresh world, save again, compare the text.
 */

const LAYERS = ["Default", "Ground", "Player", "Enemy"];

let worlds: TestWorld[] = [];

function world(): TestWorld {
  const harness = createSerializationWorld(LAYERS);
  worlds.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

/** Builds the reference scene: a tree, every schema kind, and references that stay inside the file. */
function buildScene(harness: TestWorld): Entity {
  const { world: w } = harness;
  const player = w.createEntity("Player");
  player.transform.localPosition.set(0, 1, 0);
  player.layer = w.layers.indexOf("Player");
  player.tags.add("player");
  player.tags.add("hero");
  player.isStatic = true;
  const gun = w.createEntity("Gun", { parent: player });
  gun.transform.localPosition.set(0.3, 1.2, 0);
  gun.transform.localScale.set(2, 2, 2);
  const enemy = w.createEntity("Enemy");
  enemy.active = false;
  enemy.transform.localRotation.set(0, 0.6, 0, 0.8);
  const camera = enemy.addComponent(Tagger, { note: "eye" });
  const mover = player.addComponent(Everything, {
    speed: 8.5,
    loops: -3,
    count: 7,
    toggled: true,
    label: "hero",
    planar: { x: 1, y: 2 },
    offset: { x: 0.1234567, y: -0, z: 3 },
    wide: { x: 1, y: 2, z: 3, w: 4 },
    spin: { x: 0, y: 0, z: 0, w: 1 },
    tint: { r: 0.5, g: 0.25, b: 0.125, a: 1 },
    mode: "run",
    waypoints: [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    stats: { hp: 42, armor: 1.5 },
    bag: { b: 2, a: 1 },
    maybe: 9,
    mask: ["Player", "Enemy"],
    path: { keys: [[0, 0, 1, 1] as const, [1, 2, 0, 0] as const] },
    clip: clipHandle(),
    scratch: 99,
  });
  mover.target = enemy;
  mover.follow = player.addComponent(Tagger, { note: "eye" });
  void camera;
  void gun;
  return player;
}

/** The loaded clip handle every `asset()` field in these fixtures resolves to. */
function clipHandle(): ReturnType<typeof fakeHandle<AudioClip>> {
  return fakeHandle("audio/step.wav", new AudioClip(), "audio");
}

describe("scene round trip", () => {
  it("is byte-identical through save, load, and save again", async () => {
    const source = world();
    buildScene(source);
    const first = serializeScene(source.world.activeScene, { engineVersion: null, name: "Level01" });
    const text = stringifySceneFile(first);

    // The scene's dependency list is what an `asset()` field resolves through since Phase 2
    // (`05-assets-and-loading.md` §3), so the clip has to be in it for the round trip to close.
    const asset = await createSceneAsset("levels/level01.scene.json", first, [clipHandle()]);
    const target = world();
    const built = instantiateScene(target.world, asset);
    expect(built.issues).toEqual([]);

    const second = serializeScene(target.world.activeScene, { engineVersion: null, name: "Level01" });
    expect(stringifySceneFile(second)).toBe(text);
    expect(JSON.parse(stringifySceneFile(second))).toEqual(JSON.parse(text));
  });

  it("keeps the file's uids so a second save addresses the same objects", async () => {
    const source = world();
    const player = buildScene(source);
    const file = serializeScene(source.world.activeScene, { engineVersion: null });
    const asset = await createSceneAsset("a.scene.json", file, [clipHandle()]);
    const target = world();
    instantiateScene(target.world, asset);
    expect(target.world.getEntity(player.uid)?.name).toBe("Player");
  });

  it("resolves entity and component references inside the file", async () => {
    const source = world();
    buildScene(source);
    const file = serializeScene(source.world.activeScene, { engineVersion: null });
    const asset = await createSceneAsset("a.scene.json", file, [clipHandle()]);
    const target = world();
    const built = instantiateScene(target.world, asset);
    const loaded = built.roots[0]?.getComponent(Everything);
    expect(loaded?.target?.name).toBe("Enemy");
    expect(loaded?.follow?.entity.name).toBe("Player");
    expect(loaded?.target).toBe(target.world.findByName("Enemy"));
  });

  it("restores every schema kind, transform, tags, layer, static and active", async () => {
    const source = world();
    buildScene(source);
    const file = serializeScene(source.world.activeScene, { engineVersion: null });
    const asset = await createSceneAsset("a.scene.json", file, [clipHandle()]);
    const target = world();
    instantiateScene(target.world, asset);
    const player = target.world.findByName("Player");
    const mover = player?.getComponent(Everything);
    expect(player?.isStatic).toBe(true);
    expect([...(player?.tags.values() ?? [])].toSorted()).toEqual(["hero", "player"]);
    expect(player?.layer).toBe(target.world.layers.indexOf("Player"));
    expect(target.world.findByName("Enemy")?.active).toBe(false);
    expect(target.world.findByName("Gun")?.transform.localScale.x).toBe(2);
    expect(mover?.speed).toBe(8.5);
    expect(mover?.mode).toBe("run");
    expect(mover?.stats).toEqual({ hp: 42, armor: 1.5 });
    expect(mover?.bag).toEqual({ a: 1, b: 2 });
    expect(mover?.maybe).toBe(9);
    expect(mover?.mask).toEqual(["Player", "Enemy"]);
    expect(mover?.path.keys).toEqual([
      [0, 0, 1, 1],
      [1, 2, 0, 0],
    ]);
    expect(mover?.clip?.address).toBe("audio/step.wav");
    expect(mover?.clip?.type).toBe("audio");
  });

  it("omits transient fields and restores them at their default", async () => {
    const source = world();
    buildScene(source);
    const file = serializeScene(source.world.activeScene, { engineVersion: null });
    const written = file.entities.find((entity) => entity.name === "Player")?.components?.[0];
    expect(written?.props).not.toHaveProperty("scratch");
    const asset = await createSceneAsset("a.scene.json", file, [clipHandle()]);
    const target = world();
    instantiateScene(target.world, asset);
    expect(target.world.findByName("Player")?.getComponent(Everything)?.scratch).toBe(0);
  });

  it("searches the dependency list by address, skipping the entries that do not match", async () => {
    const source = world();
    buildScene(source);
    const file = serializeScene(source.world.activeScene, { engineVersion: null });
    // The matching handle is deliberately last: the resolver walks the whole list by address
    // (`05-assets-and-loading.md` §3), so an unrelated dependency in front of it must be skipped
    // rather than answered with.
    const asset = await createSceneAsset("a.scene.json", file, [
      fakeHandle("audio/other.wav", new AudioClip(), "audio"),
      clipHandle(),
    ]);
    const target = world();
    const built = instantiateScene(target.world, asset);
    expect(built.issues).toEqual([]);
    expect(built.roots[0]?.getComponent(Everything)?.clip?.address).toBe("audio/step.wav");
  });

  it("reports IGX-0602 when the only handle at that address is of another type", async () => {
    const source = world();
    buildScene(source);
    const file = serializeScene(source.world.activeScene, { engineVersion: null });
    // Same address, wrong type: the field declared `audio`, so the handle is not a candidate and
    // the resolver falls through to the app cache, which has nothing either.
    const asset = await createSceneAsset("a.scene.json", file, [
      fakeHandle("audio/step.wav", new AudioClip(), "texture"),
    ]);
    const target = world();
    const built = instantiateScene(target.world, asset);
    expect(built.issues.some((issue) => issue.code === "IGX-0602")).toBe(true);
    expect(built.roots[0]?.getComponent(Everything)?.clip).toBeNull();
  });

  it("canonicalizes numbers and normalizes negative zero", () => {
    const source = world();
    buildScene(source);
    const file = serializeScene(source.world.activeScene, { engineVersion: null });
    const props = file.entities.find((entity) => entity.name === "Player")?.components?.[0]?.props;
    expect(props?.["offset"]).toEqual([0.123457, 0, 3]);
    expect(stringifySceneFile(file)).not.toContain("-0,");
  });
});
