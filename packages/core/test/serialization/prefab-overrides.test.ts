import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { applyOverridesToAsset, revertOverrides } from "../../src/serialization/prefab-overrides.js";
import { computeSceneHash, createSceneAsset } from "../../src/serialization/scene-asset.js";
import { stringifySceneFile } from "../../src/serialization/scene-file.js";
import { validateSceneFile } from "../../src/serialization/validate.js";
import { Everything, Tagger, buildFile, createSerializationWorld, entityRecord, fakeHandle } from "./fixtures.js";
import type { Entity } from "../../src/entity/entity.js";
import type { SceneFile, SceneFileInstance, SceneFileOverride } from "../../src/serialization/scene-file.js";
import type { TestWorld } from "../support/create-test-world.js";

/** Prefab apply and revert (`02-scene-graph.md` §6, editor ask E7). */

const PREFAB = "prefabs/enemy.prefab.json";

let worlds: TestWorld[] = [];

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

/** A single-root prefab: a root with two components and one child. */
function enemyFile(): SceneFile {
  return buildFile({
    name: "Enemy",
    entities: [
      entityRecord({
        uid: "R",
        name: "Enemy",
        components: [
          { uid: "AI", type: "test/Everything", props: { speed: 3, label: "calm" } },
          { uid: "DEBUG", type: "test/Tagger", props: { note: "debug" } },
        ],
      }),
      entityRecord({ uid: "C", name: "Weapon", parent: "R" }),
    ],
  });
}

/** Instance A: one override of every kind, plus the root placement the apply must leave alone. */
const overridesA: readonly SceneFileOverride[] = [
  { path: "R/transform/position", value: [7, 0, 0] },
  { path: "R/components/AI/props/speed", value: 9 },
  { path: "R/components/AI/enabled", value: false },
  { op: "remove", path: "R/components/DEBUG" },
  { path: "C/name", value: "Blade" },
  { path: "C/tags", value: ["b", "a"] },
  { path: "C/transform/position", value: [1, 2, 3] },
  { op: "add", path: "C/components", value: { uid: "NEW", type: "test/Tagger", props: { note: "loot" } } },
];

function instanceA(): SceneFileInstance {
  return { scene: { $asset: PREFAB }, hash: "sha256:old", overrides: overridesA };
}

/** Instantiates a level holding one instance of `prefab`, and answers the instance root. */
async function spawn(prefab: SceneFile, instance: SceneFileInstance): Promise<Entity> {
  const asset = await createSceneAsset(PREFAB, prefab);
  const level = await createSceneAsset(
    "levels/level.scene.json",
    buildFile({ entities: [entityRecord({ uid: "L", name: "Spawn", instance: { ...instance, hash: asset.hash } })] }),
    [fakeHandle(PREFAB, asset)],
  );
  const harness = createSerializationWorld();
  worlds.push(harness);
  const built = instantiateScene(harness.world, level);
  expect(built.issues).toEqual([]);
  const root = built.roots[0];
  if (root === undefined) {
    throw new Error("nothing was built");
  }
  return root;
}

/** What tests compare about a built instance. */
function summary(root: Entity): unknown {
  const child = root.children[0];
  const ai = root.getComponent(Everything);
  return {
    position: [root.transform.localPosition.x, root.transform.localPosition.y, root.transform.localPosition.z],
    speed: ai?.speed,
    label: ai?.label,
    aiEnabled: ai?.enabled,
    rootTaggers: root.getComponents(Tagger).map((tagger) => tagger.note),
    child: child?.name,
    childTags: [...(child?.tags.values() ?? [])].toSorted(),
    childPosition: [child?.transform.localPosition.x, child?.transform.localPosition.y],
    childTaggers: child?.getComponents(Tagger).map((tagger) => tagger.note),
  };
}

describe("applyOverridesToAsset", () => {
  it("writes every override but the root placement into the prefab, canonically", async () => {
    const prefab = enemyFile();
    const before = stringifySceneFile(prefab);
    const result = await applyOverridesToAsset(instanceA(), prefab);

    expect(stringifySceneFile(prefab)).toBe(before);
    expect(validateSceneFile(result.asset)).toEqual([]);
    expect(result.asset.entities).toEqual([
      entityRecord({
        uid: "R",
        name: "Enemy",
        components: [{ uid: "AI", type: "test/Everything", enabled: false, props: { speed: 9, label: "calm" } }],
      }),
      {
        uid: "C",
        name: "Blade",
        parent: "R",
        tags: ["a", "b"],
        transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        components: [{ uid: "NEW", type: "test/Tagger", props: { note: "loot" } }],
      },
    ]);
    expect(result.applied).toEqual(overridesA.slice(1));
    expect(result.skipped.map((skip) => skip.override)).toEqual([overridesA[0]]);
    expect(result.skipped[0]?.reason).toContain("placement");
    expect(result.hash).toBe(await computeSceneHash(result.asset));
    expect(result.instance).toEqual({ scene: { $asset: PREFAB }, hash: result.hash, overrides: [overridesA[0]] });
  });

  it("is deterministic: the same input gives byte-identical output", async () => {
    const first = await applyOverridesToAsset(instanceA(), enemyFile());
    const second = await applyOverridesToAsset(instanceA(), enemyFile());
    expect(stringifySceneFile(second.asset)).toBe(stringifySceneFile(first.asset));
    expect(JSON.stringify(second.instance)).toBe(JSON.stringify(first.instance));
    expect(second.hash).toBe(first.hash);
  });

  it("leaves the applying instance looking the same", async () => {
    const prefab = enemyFile();
    const result = await applyOverridesToAsset(instanceA(), prefab);
    const before = summary(await spawn(prefab, instanceA()));
    const after = summary(await spawn(result.asset, result.instance));
    expect(after).toEqual(before);
    expect(after).toMatchObject({ position: [7, 0, 0], speed: 9, child: "Blade", childTaggers: ["loot"] });
  });

  it("updates another instance, whose own conflicting override still wins", async () => {
    const prefab = enemyFile();
    const other: SceneFileInstance = {
      scene: { $asset: PREFAB },
      overrides: [{ path: "R/components/AI/props/speed", value: 5 }],
    };
    const result = await applyOverridesToAsset(instanceA(), prefab);
    expect(summary(await spawn(prefab, other))).toMatchObject({ speed: 5, rootTaggers: ["debug"], child: "Weapon" });
    expect(summary(await spawn(result.asset, other))).toEqual({
      position: [0, 0, 0],
      speed: 5,
      label: "calm",
      aiEnabled: false,
      rootTaggers: [],
      child: "Blade",
      childTags: ["a", "b"],
      childPosition: [1, 2],
      childTaggers: ["loot"],
    });
  });

  it("applies only the selected paths and keeps the rest on the instance", async () => {
    const result = await applyOverridesToAsset(instanceA(), enemyFile(), {
      paths: ["R/components/AI", "C/components/NEW"],
    });
    expect(result.applied).toEqual([overridesA[1], overridesA[2], overridesA[7]]);
    expect(result.skipped).toEqual([]);
    expect(result.instance.overrides).toEqual([
      overridesA[0],
      overridesA[3],
      overridesA[4],
      overridesA[5],
      overridesA[6],
    ]);
    expect(result.asset.entities[1]?.name).toBe("Weapon");
    expect(result.asset.entities[0]?.components?.map((component) => component.uid)).toEqual(["AI", "DEBUG"]);
  });

  it("skips an override an earlier one that stays on the instance overlaps", async () => {
    const prefab = buildFile({
      entities: [
        entityRecord({
          uid: "R",
          components: [{ uid: "AI", type: "test/Everything", props: { offset: [0, 0, 0] } }],
        }),
      ],
    });
    const overrides: SceneFileOverride[] = [
      { path: "R/components/AI/props/offset", value: [1, 1, 1] },
      { path: "R/components/AI/props/offset/0", value: 5 },
    ];
    const instance: SceneFileInstance = { scene: { $asset: PREFAB }, overrides };
    const result = await applyOverridesToAsset(instance, prefab, { paths: ["R/components/AI/props/offset/0"] });
    expect(result.applied).toEqual([]);
    expect(result.skipped.map((skip) => skip.override)).toEqual([overrides[1]]);
    const offset = (await spawn(result.asset, result.instance)).getComponent(Everything)?.offset;
    expect([offset?.x, offset?.y, offset?.z]).toEqual([5, 1, 1]);
  });

  it("returns the prefab unchanged when nothing applies", async () => {
    const prefab = enemyFile();
    const result = await applyOverridesToAsset({ scene: { $asset: PREFAB } }, prefab);
    expect(result.asset).toBe(prefab);
    expect(result.instance).toEqual({ scene: { $asset: PREFAB }, hash: await computeSceneHash(prefab) });
  });

  it("applies root fields of a multi-root prefab, which are content there", async () => {
    const pair = buildFile({ entities: [entityRecord({ uid: "A" }), entityRecord({ uid: "B" })] });
    const result = await applyOverridesToAsset(
      { scene: { $asset: PREFAB }, overrides: [{ path: "A/transform/scale", value: [2, 2, 2] }] },
      pair,
    );
    expect(result.skipped).toEqual([]);
    expect(result.asset.entities[0]?.transform.scale).toEqual([2, 2, 2]);
  });

  it("skips what the prefab file cannot take, including a nested prefab's content", async () => {
    const outer = buildFile({
      entities: [
        entityRecord({ uid: "R" }),
        entityRecord({
          uid: "N",
          parent: "R",
          instance: { scene: { $asset: "prefabs/inner.prefab.json" } },
          components: [{ uid: "OWN", type: "test/Tagger" }],
        }),
      ],
    });
    const overrides: SceneFileOverride[] = [
      { path: "N/components/INNER-COMPONENT/props/note", value: "x" },
      { path: "GONE/name", value: "x" },
      { path: "N/transform/rotation", value: [0, 0, 1] },
      { op: "add", path: "N/components", value: { uid: "OWN", type: "test/Tagger" } },
      { path: "N/components/OWN/props/note", value: "kept" },
      { path: "R/components", value: { uid: "X", type: "test/Tagger" } },
      { path: "N", op: "remove" },
    ];
    const result = await applyOverridesToAsset({ scene: { $asset: PREFAB }, overrides }, outer);
    expect(result.applied).toEqual([overrides[4]]);
    expect(result.skipped.map((skip) => skip.override)).toEqual([
      overrides[0],
      overrides[1],
      overrides[2],
      overrides[3],
      overrides[5],
      overrides[6],
    ]);
    expect(result.instance.overrides).toEqual(result.skipped.map((skip) => skip.override));
    expect(result.asset.entities[1]).toMatchObject({
      instance: { scene: { $asset: "prefabs/inner.prefab.json" } },
      components: [{ uid: "OWN", type: "test/Tagger", props: { note: "kept" } }],
    });
  });

  it("throws IGX-0609 on a path outside the grammar", async () => {
    await expect(
      applyOverridesToAsset({ scene: { $asset: PREFAB }, overrides: [{ path: "R/nope", value: 1 }] }, enemyFile()),
    ).rejects.toSatisfy((error) => isIgnifxError(error) && error.code === CoreErrorCode.invalidOverridePath);
  });
});

describe("revertOverrides", () => {
  it("drops every override and keeps the scene and hash", () => {
    expect(revertOverrides(instanceA())).toEqual({ scene: { $asset: PREFAB }, hash: "sha256:old" });
  });

  it("drops a named subset: an entity, an added component, or one prop", () => {
    expect(revertOverrides(instanceA(), { paths: ["C"] }).overrides).toEqual(overridesA.slice(0, 4));
    expect(revertOverrides(instanceA(), { paths: ["C/components/NEW"] }).overrides).toEqual(overridesA.slice(0, 7));
    expect(revertOverrides(instanceA(), { paths: ["R/components/AI/props/speed"] }).overrides).toEqual(
      overridesA.filter((override) => override.path !== "R/components/AI/props/speed"),
    );
  });

  it("makes the instance follow the prefab again", async () => {
    const prefab = enemyFile();
    const reverted = revertOverrides(instanceA(), { paths: ["R"] });
    expect(summary(await spawn(prefab, reverted))).toMatchObject({
      position: [0, 0, 0],
      speed: 3,
      aiEnabled: true,
      rootTaggers: ["debug"],
      child: "Blade",
    });
  });

  it("returns the entry itself when nothing is selected", () => {
    const instance = instanceA();
    expect(revertOverrides(instance, { paths: ["ELSEWHERE"] })).toBe(instance);
    expect(revertOverrides(instance, { paths: ["R/components/A"] })).toBe(instance);
  });
});

describe("applyOverridesToAsset with the instance root's own components", () => {
  const own = { uid: "OWN", type: "test/Tagger", props: { note: "own" } };
  const other = { uid: "OTHER", type: "test/Tagger", props: { note: "other" } };
  const clash = { uid: "AI", type: "test/Tagger" };

  it("appends the selected ones to the prefab root and reports what stays", async () => {
    const instance: SceneFileInstance = { scene: { $asset: PREFAB } };
    const result = await applyOverridesToAsset(instance, enemyFile(), {
      paths: ["R/components/OWN", "R/components/AI"],
      rootComponents: [own, other, clash],
    });

    expect(result.asset.entities[0]?.components?.map((component) => component.uid)).toEqual(["AI", "DEBUG", "OWN"]);
    expect(result.applied).toEqual([]);
    expect(result.appliedComponents).toEqual([own]);
    expect(result.rootComponents).toEqual([other, clash]);
    expect(result.skippedComponents.map((skip) => skip.component)).toEqual([clash]);
    expect(result.skippedComponents[0]?.reason).toContain("already uses");
    expect(result.hash).toBe(await computeSceneHash(result.asset));
  });

  it("skips them all on a prefab with several roots", async () => {
    const file = buildFile({ entities: [entityRecord({ uid: "A" }), entityRecord({ uid: "B" })] });
    const result = await applyOverridesToAsset({ scene: { $asset: PREFAB } }, file, { rootComponents: [own] });

    expect(result.asset).toBe(file);
    expect(result.appliedComponents).toEqual([]);
    expect(result.rootComponents).toEqual([own]);
    expect(result.skippedComponents[0]?.reason).toContain("no single root");
  });
});
