import { describe, expect, it } from "vitest";
import { instantiateContainer, loadGltfFromBytes, takeAnimationGroups } from "../../../src/lite/gpu/gltf.js";
import { createNode } from "../../../src/lite/node.js";
import { createHeadlessScene } from "../../../src/lite/scene.js";
import { readAssetBytes } from "./fixtures/assets.js";
import type { AnimationGroup, AssetContainer, SceneNode } from "@babylonjs/lite";

/**
 * The container handling around `loadGltf`, and what the loader does under the null engine.
 *
 * Instantiation itself is device-free — `cloneTransformNode` only copies transforms and bumps a
 * reference count — so the naming and the animation-group strip are checked here; the geometry
 * sharing that makes it worth doing is proved in `gltf.browser.test.ts`.
 */

/** Builds a container shaped like the one `loadGltf` produces for a glTF file. */
function containerWith(root: SceneNode, groups?: AnimationGroup[]): AssetContainer {
  const container: AssetContainer = { entities: [root] };
  if (groups !== undefined) {
    container.animationGroups = groups;
  }
  return container;
}

/** Builds a two-level node tree named the way a glTF file's nodes are. */
function modelTree(): SceneNode {
  const root = createNode("__root__");
  const body = createNode("Body");
  const hand = createNode("Hand_R");
  body.parent = root;
  root.children.push(body);
  hand.parent = body;
  body.children.push(hand);
  return root;
}

describe("loading a glTF under the null engine", () => {
  it("fails, because the loader uploads to a device the null engine does not have", async () => {
    // `docs/architecture/07-rendering.md` §6 says headless mode skips GPU work; this records what
    // Lite actually does if the asset layer forgets. The failure is a `TypeError` from a WeakMap
    // keyed on `engine._device`, which is `undefined` on a null engine — not an ignifx error, so
    // the asset layer has to gate on headlessness itself rather than catching this.
    const { engine } = createHeadlessScene();
    await expect(loadGltfFromBytes(engine, readAssetBytes("Box.glb"))).rejects.toThrow(TypeError);
  });
});

describe("stripping animation groups", () => {
  it("returns nothing for a container that declares none", () => {
    expect(takeAnimationGroups(containerWith(createNode("root")))).toEqual([]);
    expect(takeAnimationGroups(containerWith(createNode("root"), []))).toEqual([]);
  });

  it("removes the clips so addToScene installs no tick hook", () => {
    // ADR-0003: ignifx owns every clock, so Lite must never advance a clip.
    const groups = [{ name: "Idle" }, { name: "Run" }] as unknown as AnimationGroup[];
    const container = containerWith(createNode("root"), groups);

    expect(takeAnimationGroups(container)).toHaveLength(2);
    expect(container.animationGroups).toEqual([]);
  });
});

describe("instantiating a container", () => {
  it("clones the root under the entity node and leaves the container pristine", () => {
    const template = modelTree();
    const parent = createNode("entity");
    const instance = instantiateContainer(containerWith(template), parent);

    expect(instance).not.toBeNull();
    expect(instance?.root).not.toBe(template);
    expect(instance?.root.parent).toBe(parent);
    expect(template.parent).toBeNull();
  });

  it("indexes the clone by the original glTF node names", () => {
    const instance = instantiateContainer(containerWith(modelTree()), null);
    expect([...(instance?.nodesByName.keys() ?? [])].toSorted()).toEqual(["Body", "Hand_R", "__root__"]);
    expect(instance?.nodesByName.get("Body")?.name).toBe("Body_clone");
  });

  it("gives every instance its own transforms", () => {
    const template = modelTree();
    const first = instantiateContainer(containerWith(template), null);
    const second = instantiateContainer(containerWith(template), null);

    first?.nodesByName.get("Body")?.position.set(5, 0, 0);
    expect(second?.nodesByName.get("Body")?.position.x).toBe(0);
  });

  it("returns null for a container with no scene-node root", () => {
    expect(instantiateContainer({ entities: [] }, null)).toBeNull();
  });
});
