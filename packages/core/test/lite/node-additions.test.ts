import { describe, expect, it } from "vitest";
import {
  createNode,
  isNodeVisible,
  linkParent,
  localPosition,
  localRotation,
  localScale,
  parentNode,
  setNodeName,
  setNodeSelfVisible,
  setNodeVisible,
} from "../../src/lite/node.js";
import { Quat } from "../../src/math/quat.js";
import { Vec3 } from "../../src/math/vec3.js";

/**
 * The adapter helpers the kernel's `Transform` and `Entity` needed on top of the S1.1 spike
 * (`docs/architecture/02-scene-graph.md` §5, §5.1).
 */

describe("live TRS views", () => {
  it("returns the node's own observable values, typed as the math module's mutable shapes", () => {
    const node = createNode("node");
    expect(localPosition(node)).toBe(node.position);
    expect(localRotation(node)).toBe(node.rotationQuaternion);
    expect(localScale(node)).toBe(node.scaling);
  });

  it("accepts the math module's own values through copyFrom", () => {
    const node = createNode("node");
    localPosition(node).copyFrom(new Vec3(1, 2, 3));
    localRotation(node).copyFrom(new Quat(0, Math.SQRT1_2, 0, Math.SQRT1_2));
    expect(node.position.z).toBe(3);
    expect(node.rotationQuaternion.y).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe("per-node visibility", () => {
  it("normalises Lite's undefined-means-visible tri-state", () => {
    const node = createNode("node");
    expect(node.visible).toBeUndefined();
    expect(isNodeVisible(node)).toBe(true);
    setNodeSelfVisible(node, false);
    expect(isNodeVisible(node)).toBe(false);
    setNodeSelfVisible(node, true);
    expect(isNodeVisible(node)).toBe(true);
  });

  it("writes one node only, unlike the subtree helper", () => {
    const parent = createNode("parent");
    const child = createNode("child");
    linkParent(child, parent);
    setNodeSelfVisible(parent, false);
    expect(isNodeVisible(child)).toBe(true);
    setNodeVisible(parent, false);
    expect(isNodeVisible(child)).toBe(false);
  });
});

describe("naming and parent lookup", () => {
  it("renames a node", () => {
    const node = createNode("first");
    setNodeName(node, "second");
    expect(node.name).toBe("second");
  });

  it("returns the parent only when it is itself a scene node", () => {
    const parent = createNode("parent");
    const child = createNode("child");
    expect(parentNode(child)).toBeNull();
    linkParent(child, parent);
    expect(parentNode(child)).toBe(parent);
    child.parent = { worldMatrix: parent.worldMatrix, worldMatrixVersion: 1 };
    expect(parentNode(child)).toBeNull();
  });
});
