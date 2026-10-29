import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { instantiateScene } from "../../src/serialization/load.js";
import { createSceneAsset } from "../../src/serialization/scene-asset.js";
import { Everything, buildFile, createSerializationWorld, entityRecord, fakeHandle } from "./fixtures.js";
import type { JsonObject } from "../../src/schema/json.js";
import type { SceneAsset } from "../../src/serialization/scene-asset.js";
import type { SceneFileOverride } from "../../src/serialization/scene-file.js";
import type { TestWorld } from "../support/create-test-world.js";

/**
 * `__proto__`, `constructor`, and `prototype` keys in a scene file stay data: expanding an instance,
 * applying its overrides, and decoding a `map` field never change a prototype (engine backlog E42).
 */

let worlds: TestWorld[] = [];

function world(): TestWorld {
  const harness = createSerializationWorld();
  worlds.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of worlds) {
    harness.dispose();
  }
  worlds = [];
});

/** What `JSON.parse` gives for a prefab file: `__proto__` keys arrive as own data properties. */
function parsedProps(text: string): JsonObject {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("expected an object");
  }
  // The literal above is a JSON object, which is exactly `JsonObject`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parsed as JsonObject;
}

/** A level instancing a one-entity prefab whose `Everything` carries the given props. */
async function level(props: JsonObject, overrides: readonly SceneFileOverride[] = []): Promise<SceneAsset> {
  const prefab = await createSceneAsset(
    "prefabs/proto.prefab.json",
    buildFile({
      entities: [entityRecord({ uid: "P-ROOT", components: [{ uid: "P-C", type: "test/Everything", props }] })],
    }),
  );
  return createSceneAsset(
    "levels/proto.scene.json",
    buildFile({
      entities: [entityRecord({ uid: "L", instance: { scene: { $asset: prefab.address }, overrides } })],
    }),
    [fakeHandle(prefab.address, prefab)],
  );
}

/** Asserts nothing leaked onto `Object.prototype`. */
function expectPrototypeClean(): void {
  for (const name of ["label", "polluted", "speed"]) {
    expect(Object.hasOwn(Object.prototype, name)).toBe(false);
  }
}

describe("__proto__ keys in an instanced prefab", () => {
  it("keep a props-level __proto__ key inert instead of becoming the props' prototype", async () => {
    const asset = await level(parsedProps('{ "speed": 3, "__proto__": { "label": "polluted" } }'));
    const harness = world();
    const built = instantiateScene(harness.world, asset);
    const component = built.roots[0]?.getComponent(Everything);
    expect(component?.speed).toBe(3);
    // Before the fix the copy's prototype was `{ label: "polluted" }` and the decoder read it.
    expect(component?.label).toBe("");
    expectPrototypeClean();
  });

  it("keep a map entry named __proto__ as an entry of the decoded map", async () => {
    const asset = await level(parsedProps('{ "bag": { "a": 1, "__proto__": 7 } }'));
    const harness = world();
    const built = instantiateScene(harness.world, asset);
    expect(built.issues).toEqual([]);
    const bag = built.roots[0]?.getComponent(Everything)?.bag;
    expect(bag === undefined ? null : Object.getPrototypeOf(bag)).toBe(Object.prototype);
    expect(bag === undefined ? [] : Object.keys(bag).toSorted()).toEqual(["__proto__", "a"]);
    expect(bag === undefined ? null : Object.getOwnPropertyDescriptor(bag, "__proto__")?.value).toBe(7);
  });
});

describe("__proto__ in an override path", () => {
  it.each(["P-ROOT/components/P-C/props/__proto__/label", "P-ROOT/components/P-C/props/stats/__proto__"])(
    "refuses %s with IGX-0609 and patches nothing",
    async (path) => {
      const asset = await level(parsedProps('{ "speed": 3 }'), [{ path, value: "polluted" }]);
      const harness = world();
      try {
        instantiateScene(harness.world, asset);
        expect.unreachable(`"${path}" should be refused`);
      } catch (error) {
        expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.invalidOverridePath);
      }
      expectPrototypeClean();
    },
  );

  it("treats constructor and prototype as ordinary keys that never reach Object.prototype", async () => {
    const asset = await level(parsedProps('{ "speed": 3, "bag": { "a": 1 } }'), [
      { path: "P-ROOT/components/P-C/props/constructor/prototype/polluted", value: true },
      { path: "P-ROOT/components/P-C/props/bag/constructor", value: 2 },
    ]);
    const harness = world();
    const built = instantiateScene(harness.world, asset);
    const component = built.roots[0]?.getComponent(Everything);
    expect(component?.speed).toBe(3);
    expect(component?.bag).toEqual({ a: 1, constructor: 2 });
    expect(Object.prototype.constructor).toBe(Object);
    expectPrototypeClean();
  });
});
