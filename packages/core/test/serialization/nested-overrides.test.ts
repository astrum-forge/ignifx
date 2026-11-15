import { afterEach, describe, expect, it } from "vitest";
import { expandScene } from "../../src/serialization/expand.js";
import { enumerateInstanceTargets, resolveInstancePath } from "../../src/serialization/instance-targets.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { parseOverridePath } from "../../src/serialization/overrides.js";
import { applyOverridesToAsset, revertOverrides } from "../../src/serialization/prefab-overrides.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { serializeScene } from "../../src/serialization/serialize.js";
import { Everything, Tagger, buildFile, createSerializationWorld, entityRecord, fakeHandle } from "./fixtures.js";
import type { ExpandedScene } from "../../src/serialization/expand.js";
import type { SceneAsset } from "../../src/serialization/scene-asset.js";
import type { SceneFile, SceneFileOverride } from "../../src/serialization/scene-file.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * Overrides of a nested prefab's components from an outer instance: an instance path in the
 * override's component segment (`<nestedInstanceUid>/components/<nestedInstanceUid>/<uid>/…`).
 */

const ENEMY = "prefabs/enemy.prefab.json";
const SQUAD = "prefabs/squad.prefab.json";
const PLATOON = "prefabs/platoon.prefab.json";
const VARIANT = "prefabs/elite.prefab.json";

/** Enemy: single root R (AI), child C (T). */
function enemyFile(): SceneFile {
  return buildFile({
    entities: [
      entityRecord({
        uid: "R",
        name: "Enemy",
        components: [{ uid: "AI", type: "test/Everything", props: { speed: 1 } }],
      }),
      entityRecord({
        uid: "C",
        name: "Weapon",
        parent: "R",
        components: [{ uid: "T", type: "test/Tagger", props: { note: "a" } }],
      }),
    ],
  });
}

/** Squad: single root Q, child N instancing the enemy (which merges into N). */
function squadFile(enemyHash: string, overrides?: readonly SceneFileOverride[]): SceneFile {
  return buildFile({
    entities: [
      entityRecord({ uid: "Q", name: "Squad", components: [{ uid: "QAI", type: "test/Everything" }] }),
      entityRecord({
        uid: "N",
        name: "Grunt",
        parent: "Q",
        instance: { scene: { $asset: ENEMY }, hash: enemyHash, ...(overrides === undefined ? {} : { overrides }) },
      }),
    ],
  });
}

interface Assets {
  readonly enemy: SceneAsset;
  readonly squad: SceneAsset;
  readonly platoon: SceneAsset;
  readonly variant: SceneAsset;
}

async function assets(): Promise<Assets> {
  const enemy = await createSceneAsset(ENEMY, enemyFile());
  const squad = await createSceneAsset(SQUAD, squadFile(enemy.hash), [fakeHandle(ENEMY, enemy)]);
  const platoon = await createSceneAsset(
    PLATOON,
    buildFile({
      entities: [
        entityRecord({ uid: "P", name: "Platoon" }),
        entityRecord({
          uid: "S",
          name: "Alpha",
          parent: "P",
          instance: { scene: { $asset: SQUAD }, hash: squad.hash },
        }),
      ],
    }),
    [fakeHandle(SQUAD, squad)],
  );
  // A variant: its single root instances the enemy, so both merge into the carrier.
  const variant = await createSceneAsset(
    VARIANT,
    buildFile({
      entities: [
        entityRecord({
          uid: "V",
          name: "Elite",
          instance: { scene: { $asset: ENEMY }, hash: enemy.hash },
          components: [{ uid: "VC", type: "test/Tagger" }],
        }),
      ],
    }),
    [fakeHandle(ENEMY, enemy)],
  );
  return { enemy, squad, platoon, variant };
}

/** Expands a level holding one instance `L` of `prefab` with `overrides`. */
async function expandLevel(
  prefab: SceneAsset,
  overrides: readonly SceneFileOverride[],
): Promise<{ readonly expanded: ExpandedScene; readonly reports: string[] }> {
  const level = await createSceneAsset(
    "levels/level.scene.json",
    buildFile({
      entities: [
        entityRecord({ uid: "L", instance: { scene: { $asset: prefab.address }, hash: prefab.hash, overrides } }),
      ],
    }),
    [fakeHandle(prefab.address, prefab)],
  );
  const reports: string[] = [];
  let counter = 0;
  const expanded = expandScene(level, {
    nextUid: () => `x${String((counter += 1))}`,
    report: (_code, message) => {
      reports.push(message);
    },
  });
  return { expanded, reports };
}

/** The props of the first expanded component of a type on the entity named `name`. */
function propsOf(expanded: ExpandedScene, name: string, type: string): unknown {
  const entity = expanded.entities.find((candidate) => candidate.data.name === name);
  return entity?.data.components.find((component) => component.type === type);
}

describe("override paths into nested prefabs", () => {
  it("parse an instance path in the component segment", () => {
    expect(parseOverridePath("N/components/N/AI/props/speed")).toEqual({
      kind: "prop",
      entity: "N",
      component: "N/AI",
      steps: ["speed"],
    });
    expect(parseOverridePath("S/components/S/N/T/enabled")).toEqual({
      kind: "componentField",
      entity: "S",
      component: "S/N/T",
    });
    expect(parseOverridePath("N/components/N/T")).toEqual({ kind: "component", entity: "N", component: "N/T" });
    expect(() => parseOverridePath("N/components/N//props/x")).toThrow();
  });

  it("patch a nested prefab's components after its copy got fresh uids", async () => {
    const { squad } = await assets();
    const { expanded, reports } = await expandLevel(squad, [
      { path: "N/components/N/AI/props/speed", value: 5 },
      { path: "N/components/N/T/props/note", value: "outer" },
      { path: "N/components/N/T/enabled", value: false },
    ]);
    expect(reports).toEqual([]);
    expect(propsOf(expanded, "Grunt", "test/Everything")).toMatchObject({ props: { speed: 5 } });
    expect(propsOf(expanded, "Weapon", "test/Tagger")).toMatchObject({ props: { note: "outer" }, enabled: false });
  });

  it("remove a nested prefab's component", async () => {
    const { squad } = await assets();
    const { expanded, reports } = await expandLevel(squad, [{ op: "remove", path: "N/components/N/T" }]);
    expect(reports).toEqual([]);
    expect(propsOf(expanded, "Weapon", "test/Tagger")).toBeUndefined();
  });

  it("win over the overrides the outer prefab records on its nested instance", async () => {
    const { enemy } = await assets();
    const squad = await createSceneAsset(
      SQUAD,
      squadFile(enemy.hash, [{ path: "R/components/AI/props/speed", value: 2 }]),
      [fakeHandle(ENEMY, enemy)],
    );
    const inner = await expandLevel(squad, []);
    expect(propsOf(inner.expanded, "Grunt", "test/Everything")).toMatchObject({ props: { speed: 2 } });
    const outer = await expandLevel(squad, [{ path: "N/components/N/AI/props/speed", value: 3 }]);
    expect(propsOf(outer.expanded, "Grunt", "test/Everything")).toMatchObject({ props: { speed: 3 } });
  });

  it("walk deeper nesting one segment per instance", async () => {
    const { platoon } = await assets();
    const { expanded, reports } = await expandLevel(platoon, [
      { path: "S/components/S/N/AI/props/speed", value: 9 },
      { path: "S/components/S/QAI/props/speed", value: 8 },
    ]);
    expect(reports).toEqual([]);
    expect(propsOf(expanded, "Grunt", "test/Everything")).toMatchObject({ props: { speed: 9 } });
    expect(propsOf(expanded, "Alpha", "test/Everything")).toMatchObject({ props: { speed: 8 } });
  });

  it("reach what a variant's root merges in", async () => {
    const { variant } = await assets();
    const { expanded, reports } = await expandLevel(variant, [{ path: "V/components/V/AI/props/speed", value: 7 }]);
    expect(reports).toEqual([]);
    expect(propsOf(expanded, "L", "test/Everything")).toMatchObject({ props: { speed: 7 } });
  });

  it("report a path that names nothing or does not start at its entity", async () => {
    const { squad } = await assets();
    const { expanded, reports } = await expandLevel(squad, [
      { path: "N/components/N/NOPE/props/speed", value: 5 },
      { path: "Q/components/N/AI/props/speed", value: 5 },
      { path: "N/components/MISSING/AI/props/speed", value: 5 },
    ]);
    expect(reports).toHaveLength(3);
    expect(reports[0]).toContain("names no component of that entity");
    expect(propsOf(expanded, "Grunt", "test/Everything")).toMatchObject({ props: { speed: 1 } });
  });
});

describe("applyOverridesToAsset with nested overrides", () => {
  const readScene = (address: string): SceneFile | null =>
    address === ENEMY ? enemyFile() : address === SQUAD ? squadFile("h") : null;

  it("moves the override onto the prefab's nested instance entry", async () => {
    const { squad } = await assets();
    const result = await applyOverridesToAsset(
      {
        scene: { $asset: SQUAD },
        overrides: [
          { path: "N/components/N/AI/props/speed", value: 5 },
          { path: "N/components/N/T/enabled", value: false },
        ],
      },
      squad.file,
      { readScene },
    );
    expect(result.skipped).toEqual([]);
    expect(result.instance.overrides).toBeUndefined();
    expect(result.asset.entities[1]?.instance?.overrides).toEqual([
      { path: "R/components/AI/props/speed", value: 5 },
      { path: "C/components/T/enabled", value: false },
    ]);
  });

  it("replaces an override at the same path and keeps deeper paths as instance paths", async () => {
    const { enemy, platoon } = await assets();
    const squad = squadFile(enemy.hash, [{ path: "R/components/AI/props/speed", value: 2 }]);
    const read = (address: string): SceneFile | null => (address === SQUAD ? squad : readScene(address));
    const one = await applyOverridesToAsset(
      { scene: { $asset: SQUAD }, overrides: [{ path: "N/components/N/AI/props/speed", value: 4 }] },
      squad,
      { readScene: read },
    );
    expect(one.asset.entities[1]?.instance?.overrides).toEqual([{ path: "R/components/AI/props/speed", value: 4 }]);
    const deep = await applyOverridesToAsset(
      { scene: { $asset: PLATOON }, overrides: [{ path: "S/components/S/N/AI/props/speed", value: 9 }] },
      platoon.file,
      { readScene: read },
    );
    expect(deep.asset.entities[1]?.instance?.overrides).toEqual([{ path: "N/components/N/AI/props/speed", value: 9 }]);
  });

  it("skips without a reader or when the path names nothing", async () => {
    const { squad } = await assets();
    const overrides: SceneFileOverride[] = [
      { path: "N/components/N/AI/props/speed", value: 5 },
      { path: "N/components/N/NOPE/props/speed", value: 5 },
    ];
    const blind = await applyOverridesToAsset({ scene: { $asset: SQUAD }, overrides }, squad.file);
    expect(blind.skipped.map((skip) => skip.reason)).toEqual([
      expect.stringContaining("pass readScene"),
      expect.stringContaining("pass readScene"),
    ]);
    const read = await applyOverridesToAsset({ scene: { $asset: SQUAD }, overrides }, squad.file, { readScene });
    expect(read.applied).toEqual([overrides[0]]);
    expect(read.skipped.map((skip) => skip.reason)).toEqual([expect.stringContaining("names no component")]);
    expect(read.instance.overrides).toEqual([overrides[1]]);
  });

  it("reverts by the nested component's path", () => {
    const instance = {
      scene: { $asset: SQUAD },
      overrides: [
        { path: "N/components/N/AI/props/speed", value: 5 },
        { path: "N/components/N/T/enabled", value: false },
      ],
    };
    expect(revertOverrides(instance, { paths: ["N/components/N/AI"] }).overrides).toEqual([
      { path: "N/components/N/T/enabled", value: false },
    ]);
  });
});

describe("resolveInstancePath and enumerateInstanceTargets", () => {
  const files = new Map<string, SceneFile>([
    [ENEMY, enemyFile()],
    [SQUAD, squadFile("h")],
  ]);
  const read = (address: string): SceneFile | undefined => files.get(address);
  const level = buildFile({
    entities: [
      entityRecord({ uid: "L", name: "Level squad", instance: { scene: { $asset: SQUAD } } }),
      entityRecord({ uid: "X", name: "Plain" }),
    ],
  });

  it("lists every entity and component inside each instance with labels and override paths", () => {
    const targets = enumerateInstanceTargets(level, read).map((target) => ({
      kind: target.kind,
      path: target.path,
      labels: target.labels,
      overridePath: target.overridePath,
    }));
    expect(targets).toEqual([
      { kind: "component", path: "L/QAI", labels: ["Level squad"], overridePath: "Q/components/QAI" },
      { kind: "entity", path: "L/N", labels: ["Level squad", "Grunt"], overridePath: "N" },
      { kind: "component", path: "L/N/AI", labels: ["Level squad", "Grunt"], overridePath: "N/components/N/AI" },
      { kind: "entity", path: "L/N/C", labels: ["Level squad", "Grunt", "Weapon"], overridePath: null },
      {
        kind: "component",
        path: "L/N/T",
        labels: ["Level squad", "Grunt", "Weapon"],
        overridePath: "N/components/N/T",
      },
    ]);
  });

  it("resolves paths as the loader does, including a merged root and a variant", () => {
    expect(resolveInstancePath(level, "L/N/T", read)?.component?.uid).toBe("T");
    expect(resolveInstancePath(level, "L/N/C", read)?.entity.name).toBe("Weapon");
    expect(resolveInstancePath(level, "L/Q/N/AI", read, "component")?.address).toBe(ENEMY);
    expect(resolveInstancePath(level, "L/N/T", read, "entity")).toBeNull();
    expect(resolveInstancePath(level, "L/N/NOPE", read)).toBeNull();
    expect(resolveInstancePath(level, "L/C/T", read)).toBeNull();
    expect(resolveInstancePath(level, "X/T", read)).toBeNull();
    expect(resolveInstancePath(level, "L", read)).toBeNull();
    expect(resolveInstancePath(level, "L/N/T", () => null)).toBeNull();

    const variant = buildFile({
      entities: [entityRecord({ uid: "V", instance: { scene: { $asset: ENEMY } }, components: [] })],
    });
    const withVariant = new Map([...files, [VARIANT, variant]]);
    const scene = buildFile({ entities: [entityRecord({ uid: "L", instance: { scene: { $asset: VARIANT } } })] });
    const target = resolveInstancePath(scene, "L/AI", (address) => withVariant.get(address));
    expect(target?.overridePath).toBe("V/components/V/AI");
    expect(resolveInstancePath(scene, "L/C", (address) => withVariant.get(address))?.overridePath).toBeNull();
  });

  it("stops at a prefab that instances itself", () => {
    const loop = buildFile({
      entities: [
        entityRecord({ uid: "A", instance: { scene: { $asset: "loop" } }, components: [{ uid: "K", type: "t" }] }),
      ],
    });
    const scene = buildFile({ entities: [entityRecord({ uid: "L", instance: { scene: { $asset: "loop" } } })] });
    expect(enumerateInstanceTargets(scene, () => loop).map((target) => target.path)).toEqual(["L/K"]);
  });

  it("follows a child that instances the same prefab as its file's merged root", () => {
    // Guard: root G merges the enemy into the carrier; child H instances the enemy again. The
    // enemy does not enclose H, so H's copy is not a cycle.
    const guard = buildFile({
      entities: [
        entityRecord({ uid: "G", name: "Guard", instance: { scene: { $asset: ENEMY } } }),
        entityRecord({ uid: "H", name: "Twin", parent: "G", instance: { scene: { $asset: ENEMY } } }),
      ],
    });
    const withGuard = new Map([...files, ["guard", guard]]);
    const readGuard = (address: string): SceneFile | undefined => withGuard.get(address);
    const scene = buildFile({ entities: [entityRecord({ uid: "L", instance: { scene: { $asset: "guard" } } })] });
    const paths = enumerateInstanceTargets(scene, readGuard).map((target) => target.path);
    expect(paths).toEqual(["L/AI", "L/C", "L/T", "L/H", "L/H/AI", "L/H/C", "L/H/T"]);
    expect(resolveInstancePath(scene, "L/H/T", readGuard)?.address).toBe(ENEMY);

    // A true cycle (a child instancing the file that declares it) is still refused.
    const cyclic = buildFile({
      entities: [
        entityRecord({ uid: "G", name: "Guard" }),
        entityRecord({ uid: "H", parent: "G", instance: { scene: { $asset: "cyclic" } } }),
      ],
    });
    const cyclicScene = buildFile({
      entities: [entityRecord({ uid: "L", instance: { scene: { $asset: "cyclic" } } })],
    });
    expect(enumerateInstanceTargets(cyclicScene, () => cyclic).map((target) => target.path)).toEqual(["L/H"]);
    expect(resolveInstancePath(cyclicScene, "L/H/H", () => cyclic)).toBeNull();
  });
});

/** Pair: single root Q, children N1 and N2, each instancing the enemy. */
function pairFile(enemyHash: string): SceneFile {
  return buildFile({
    entities: [
      entityRecord({ uid: "Q", name: "Pair" }),
      entityRecord({ uid: "N1", name: "Left", parent: "Q", instance: { scene: { $asset: ENEMY }, hash: enemyHash } }),
      entityRecord({ uid: "N2", name: "Right", parent: "Q", instance: { scene: { $asset: ENEMY }, hash: enemyHash } }),
    ],
  });
}

describe("a nested prefab placed twice in one prefab", () => {
  const PAIR = "prefabs/pair.prefab.json";

  it("overrides each copy on its own, at expansion and when applied", async () => {
    const enemy = await createSceneAsset(ENEMY, enemyFile());
    const pair = await createSceneAsset(PAIR, pairFile(enemy.hash), [fakeHandle(ENEMY, enemy)]);
    const { expanded, reports } = await expandLevel(pair, [
      { path: "N1/components/N1/AI/props/speed", value: 5 },
      { path: "N2/components/N2/T/props/note", value: "right" },
    ]);
    expect(reports).toEqual([]);
    expect(propsOf(expanded, "Left", "test/Everything")).toMatchObject({ props: { speed: 5 } });
    expect(propsOf(expanded, "Right", "test/Everything")).toMatchObject({ props: { speed: 1 } });
    const weapons = expanded.entities.filter((entity) => entity.data.name === "Weapon");
    expect(weapons.map((weapon) => weapon.data.components[0]?.props)).toEqual([{ note: "a" }, { note: "right" }]);

    const readScene = (address: string): SceneFile | null => (address === ENEMY ? enemyFile() : null);
    const result = await applyOverridesToAsset(
      {
        scene: { $asset: PAIR },
        overrides: [
          { path: "N1/components/N1/AI/props/speed", value: 5 },
          { path: "N2/components/N2/AI/props/speed", value: 6 },
        ],
      },
      pair.file,
      { readScene },
    );
    expect(result.skipped).toEqual([]);
    expect(result.asset.entities[1]?.instance?.overrides).toEqual([{ path: "R/components/AI/props/speed", value: 5 }]);
    expect(result.asset.entities[2]?.instance?.overrides).toEqual([{ path: "R/components/AI/props/speed", value: 6 }]);
  });
});

describe("serializeScene with nested prefab overrides", () => {
  let worlds: TestWorld[] = [];

  afterEach(() => {
    for (const harness of worlds) {
      harness.dispose();
    }
    worlds = [];
  });

  /** Loads a level instancing `prefab` with `overrides` and writes it back. */
  async function loadLevel(
    prefab: SceneAsset,
    overrides: readonly SceneFileOverride[],
  ): Promise<{ readonly harness: TestWorld; readonly level: SceneAsset }> {
    const level = await createSceneAsset(
      "levels/level.scene.json",
      buildFile({
        name: "Level",
        entities: [
          entityRecord({
            uid: "L",
            name: "Placed",
            instance: { scene: { $asset: prefab.address }, hash: prefab.hash, overrides },
          }),
        ],
      }),
      [fakeHandle(prefab.address, prefab)],
    );
    const harness = createSerializationWorld();
    worlds.push(harness);
    expect(instantiateScene(harness.world, level).issues).toEqual([]);
    return { harness, level };
  }

  it("writes the nested overrides it loaded, and only those", async () => {
    const enemy = await createSceneAsset(ENEMY, enemyFile());
    const squad = await createSceneAsset(
      SQUAD,
      squadFile(enemy.hash, [{ path: "R/components/AI/props/speed", value: 2 }]),
      [fakeHandle(ENEMY, enemy)],
    );
    const overrides: SceneFileOverride[] = [
      { path: "N/components/N/AI/props/speed", value: 4 },
      { path: "N/components/N/T/enabled", value: false },
      { path: "N/components/N/T/props/note", value: "outer" },
    ];
    const { harness, level } = await loadLevel(squad, overrides);
    const written = serializeScene(harness.world.activeScene, { engineVersion: null, name: "Level" });
    expect(written.entities[0]?.instance?.overrides).toEqual(overrides);
    const reloaded = await createSceneAsset(level.address, written, level.dependencies);
    const again = createSerializationWorld();
    worlds.push(again);
    instantiateScene(again.world, reloaded);
    const twice = serializeScene(again.world.activeScene, { engineVersion: null, name: "Level" });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(written));
  });

  it("writes nothing for a nested component left as the prefab made it, and picks up run-time edits", async () => {
    const enemy = await createSceneAsset(ENEMY, enemyFile());
    const squad = await createSceneAsset(
      SQUAD,
      squadFile(enemy.hash, [{ path: "R/components/AI/props/speed", value: 2 }]),
      [fakeHandle(ENEMY, enemy)],
    );
    const { harness } = await loadLevel(squad, []);
    expect(serializeScene(harness.world.activeScene, { engineVersion: null }).entities[0]?.instance?.overrides).toBe(
      undefined,
    );
    const grunt = harness.world.activeScene.roots[0]?.children.find((child) => child.name === "Grunt");
    const ai = grunt?.getComponent(Everything);
    if (ai !== undefined && ai !== null) {
      ai.speed = 7;
    }
    const tagger = grunt?.children[0]?.getComponent(Tagger);
    if (tagger !== undefined && tagger !== null) {
      tagger.note = "edited";
    }
    expect(serializeScene(harness.world.activeScene, { engineVersion: null }).entities[0]?.instance?.overrides).toEqual(
      [
        { path: "N/components/N/AI/props/speed", value: 7 },
        { path: "N/components/N/T/props/note", value: "edited" },
      ],
    );
  });

  it("writes a nested component the level removed", async () => {
    const { squad } = await assets();
    const overrides: SceneFileOverride[] = [{ op: "remove", path: "N/components/N/T" }];
    const { harness } = await loadLevel(squad, overrides);
    const written = serializeScene(harness.world.activeScene, { engineVersion: null });
    expect(written.entities[0]?.instance?.overrides).toEqual(overrides);
  });

  it("writes deeper nesting one segment per instance", async () => {
    const { platoon } = await assets();
    const overrides: SceneFileOverride[] = [
      { path: "S/components/S/QAI/props/speed", value: 8 },
      { path: "S/components/S/N/AI/props/speed", value: 9 },
    ];
    const { harness } = await loadLevel(platoon, overrides);
    const written = serializeScene(harness.world.activeScene, { engineVersion: null });
    expect(written.entities[0]?.instance?.overrides).toEqual(overrides);
  });

  it("writes each copy of a nested prefab placed twice on its own", async () => {
    const enemy = await createSceneAsset(ENEMY, enemyFile());
    const pair = await createSceneAsset("prefabs/pair.prefab.json", pairFile(enemy.hash), [fakeHandle(ENEMY, enemy)]);
    const overrides: SceneFileOverride[] = [
      { path: "N1/components/N1/AI/props/speed", value: 5 },
      { path: "N2/components/N2/T/props/note", value: "right" },
    ];
    const { harness, level } = await loadLevel(pair, overrides);
    const written = serializeScene(harness.world.activeScene, { engineVersion: null, name: "Level" });
    expect(written.entities[0]?.instance?.overrides).toEqual(overrides);

    const right = harness.world.activeScene.roots[0]?.children.find((child) => child.name === "Right");
    const ai = right?.getComponent(Everything);
    if (ai !== undefined && ai !== null) {
      ai.speed = 3;
    }
    const edited = serializeScene(harness.world.activeScene, { engineVersion: null, name: "Level" });
    expect(edited.entities[0]?.instance?.overrides).toEqual([
      { path: "N1/components/N1/AI/props/speed", value: 5 },
      { path: "N2/components/N2/AI/props/speed", value: 3 },
      { path: "N2/components/N2/T/props/note", value: "right" },
    ]);
    const reloaded = await createSceneAsset(level.address, edited, level.dependencies);
    const again = createSerializationWorld();
    worlds.push(again);
    expect(instantiateScene(again.world, reloaded).issues).toEqual([]);
    expect(JSON.stringify(serializeScene(again.world.activeScene, { engineVersion: null, name: "Level" }))).toBe(
      JSON.stringify(edited),
    );
  });

  it("diffs a single root that is itself a nested instance as nested", async () => {
    const { variant } = await assets();
    const overrides: SceneFileOverride[] = [{ path: "V/components/V/AI/props/speed", value: 6 }];
    const { harness, level } = await loadLevel(variant, overrides);
    const placed = harness.world.activeScene.roots[0];
    expect(placed?.getComponent(Everything)?.speed).toBe(6);
    const written = serializeScene(harness.world.activeScene, { engineVersion: null, name: "Level" });
    expect(written.entities[0]?.instance?.overrides).toEqual(overrides);
    expect(written.entities[0]?.components).toBeUndefined();

    const ai = placed?.getComponent(Everything);
    if (ai !== undefined && ai !== null) {
      ai.speed = 9;
    }
    const edited = serializeScene(harness.world.activeScene, { engineVersion: null, name: "Level" });
    expect(edited.entities[0]?.instance?.overrides).toEqual([{ path: "V/components/V/AI/props/speed", value: 9 }]);
    const reloaded = await createSceneAsset(level.address, edited, level.dependencies);
    const again = createSerializationWorld();
    worlds.push(again);
    expect(instantiateScene(again.world, reloaded).issues).toEqual([]);
    expect(again.world.activeScene.roots[0]?.getComponent(Everything)?.speed).toBe(9);
  });

  it("reports a component added to a nested entity and a nested entity destroyed at run time", async () => {
    const { squad } = await assets();
    const { harness } = await loadLevel(squad, []);
    const grunt = harness.world.activeScene.roots[0]?.children.find((child) => child.name === "Grunt");
    const weapon = grunt?.children[0];
    expect(weapon?.name).toBe("Weapon");
    weapon?.addComponent(Everything);
    const write = (): { readonly overrides: unknown; readonly issues: string[] } => {
      const issues: string[] = [];
      const written = serializeScene(harness.world.activeScene, {
        engineVersion: null,
        onIssue: (issue) => issues.push(`${issue.code} ${issue.message}`),
      });
      return { overrides: written.entities[0]?.instance?.overrides, issues };
    };
    const added = write();
    expect(added.overrides).toBeUndefined();
    expect(added.issues).toHaveLength(1);
    expect(added.issues[0]).toMatch(/^IGX-0609 test\/Everything was added at run time to "Weapon"/u);

    weapon?.destroy();
    const destroyed = write();
    expect(destroyed.overrides).toBeUndefined();
    expect(destroyed.issues).toHaveLength(1);
    expect(destroyed.issues[0]).toMatch(/^IGX-0609 1 component\(s\) of a prefab nested in the instance "Placed"/u);
  });
});
