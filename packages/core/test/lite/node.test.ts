import { describe, expect, it } from "vitest";
import {
  createNode,
  decomposeWorld,
  disposeNode,
  linkParent,
  readNodeTag,
  readWorldMatrix,
  reparentKeepingWorld,
  setNodeVisible,
  tagNode,
  worldMatrixVersion,
} from "../../src/lite/node.js";
import { compose, identity, multiply, transformPoint } from "./fixtures/matrix.js";
import type { IWorldMatrixProvider, Mat4 } from "@babylonjs/lite";

/**
 * Spike S1.1 — Transform on Lite nodes (`docs/plan/engineering-plan.md` Phase 1).
 *
 * Every expected value here is computed with the plain arithmetic in `fixtures/matrix.ts`, never
 * with Babylon Lite's math, so the assertions test Lite rather than restate it.
 */

/** Quaternion for +90° about +Y: `(0, sin(45°), 0, cos(45°))`. */
const ROOT_HALF = Math.SQRT1_2;

/** Decimal digits that survive Lite's `Float32Array` world-matrix storage. */
const FLOAT32_DIGITS = 5;

/**
 * Builds a world-matrix provider that is **not** a scene node — what a Lite camera looks like to the
 * adapter, and the shape `SceneNode.parent` is actually typed as.
 *
 * @param extra - Extra own properties, used to exercise a provider with a non-array `children`.
 * @returns The provider, sitting at the origin.
 */
function createProvider(extra?: Record<string, unknown>): IWorldMatrixProvider {
  const elements = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // Boundary assertion: Lite's `Mat4` declares `length: 16`, which `Float32Array` cannot express.
  return { worldMatrix: elements as unknown as Mat4, worldMatrixVersion: 1, ...extra };
}

/**
 * Reads a node's world matrix into a plain array so the test can compare it with its own arithmetic.
 *
 * @param node - The node to read.
 * @returns The 16 column-major elements.
 */
function worldMatrixOf(node: ReturnType<typeof createNode>): number[] {
  const out: number[] = [];
  readWorldMatrix(node, out);
  return out;
}

describe("S1.1 · transform nodes on Babylon Lite", () => {
  it("computes a valid world matrix without ever adding the node to a scene", () => {
    // `docs/architecture/02-scene-graph.md` §5.1: pure transform nodes are matrix providers only.
    // No `createSceneContext`, no `addToScene` anywhere in this test.
    const node = createNode("solo");
    node.position.set(4, -5, 6);

    const world = worldMatrixOf(node);

    expect(world).toHaveLength(16);
    expect(world[12]).toBeCloseTo(4, 10);
    expect(world[13]).toBeCloseTo(-5, 10);
    expect(world[14]).toBeCloseTo(6, 10);
    expect(world.slice(0, 12)).toEqual(identity().slice(0, 12));

    disposeNode(node);
  });

  it("places a child at the hand-computed world position under a translated, rotated, scaled parent", () => {
    // Derivation (left-handed, Y up, +Z forward; column-major, translation in elements 12/13/14):
    //
    //   parent local = T(1,2,3) · R(+90° about +Y) · S(2)
    //   R maps  x̂ → (0,0,-1),  ŷ → (0,1,0),  ẑ → (1,0,0)
    //   so the parent's basis columns are  (0,0,-2), (0,2,0), (2,0,0)  and its translation (1,2,3).
    //
    //   child local  = T(1,0,0)
    //   child world  = parent · child = translation (1,2,3) + column0 · 1 = (1,2,3) + (0,0,-2)
    //                = (1, 2, 1)
    const parent = createNode("parent");
    parent.position.set(1, 2, 3);
    parent.rotationQuaternion.set(0, ROOT_HALF, 0, ROOT_HALF);
    parent.scaling.set(2, 2, 2);

    const child = createNode("child");
    child.position.set(1, 0, 0);
    linkParent(child, parent);

    const world = worldMatrixOf(child);

    expect(world[12]).toBeCloseTo(1, 5);
    expect(world[13]).toBeCloseTo(2, 5);
    expect(world[14]).toBeCloseTo(1, 5);

    // The same numbers, derived independently from the local matrices.
    const expected = multiply(
      compose(1, 2, 3, 0, ROOT_HALF, 0, ROOT_HALF, 2, 2, 2),
      compose(1, 0, 0, 0, 0, 0, 1, 1, 1, 1),
    );
    for (let index = 0; index < 16; index += 1) {
      expect(world[index]).toBeCloseTo(expected[index] ?? 0, FLOAT32_DIGITS);
    }

    disposeNode(child);
    disposeNode(parent);
  });

  it("matches the product of local matrices down a five-level chain", () => {
    const locals = [
      { t: [1, 0, 0], q: [0, ROOT_HALF, 0, ROOT_HALF], s: [2, 2, 2] },
      { t: [0, 3, 0], q: [ROOT_HALF, 0, 0, ROOT_HALF], s: [1, 0.5, 1] },
      { t: [0, 0, -2], q: [0, 0, ROOT_HALF, ROOT_HALF], s: [1, 1, 3] },
      { t: [5, -1, 2], q: [0, 0, 0, 1], s: [0.25, 0.25, 0.25] },
      { t: [-3, 4, 1], q: [0.5, 0.5, 0.5, 0.5], s: [2, 1, 1] },
    ] as const;

    const nodes = locals.map((local, index) => {
      const node = createNode(`level-${String(index)}`);
      node.position.set(local.t[0], local.t[1], local.t[2]);
      node.rotationQuaternion.set(local.q[0], local.q[1], local.q[2], local.q[3]);
      node.scaling.set(local.s[0], local.s[1], local.s[2]);
      return node;
    });
    for (let index = 1; index < nodes.length; index += 1) {
      linkParent(nodes[index]!, nodes[index - 1]!);
    }

    let expected = identity();
    for (const local of locals) {
      expected = multiply(
        expected,
        compose(
          local.t[0],
          local.t[1],
          local.t[2],
          local.q[0],
          local.q[1],
          local.q[2],
          local.q[3],
          local.s[0],
          local.s[1],
          local.s[2],
        ),
      );
    }

    const world = worldMatrixOf(nodes[4]!);
    for (let index = 0; index < 16; index += 1) {
      expect(world[index]).toBeCloseTo(expected[index] ?? 0, 4);
    }

    for (const node of nodes.toReversed()) {
      disposeNode(node);
    }
  });

  it("bumps worldMatrixVersion when a TRS value changes and leaves it alone otherwise", () => {
    const node = createNode("versioned");
    const initial = worldMatrixVersion(node);

    // Reading is free: `worldMatrix` recomputes lazily but never invalidates.
    readWorldMatrix(node, new Float32Array(16));
    readWorldMatrix(node, new Float32Array(16));
    expect(worldMatrixVersion(node)).toBe(initial);

    // A per-component write of the value already there is guarded by `ObservableVec3`.
    const currentX = node.position.x;
    node.position.x = currentX;
    expect(worldMatrixVersion(node)).toBe(initial);

    node.position.x = 1;
    const afterPosition = worldMatrixVersion(node);
    expect(afterPosition).toBeGreaterThan(initial);

    node.rotationQuaternion.set(0, ROOT_HALF, 0, ROOT_HALF);
    const afterRotation = worldMatrixVersion(node);
    expect(afterRotation).toBeGreaterThan(afterPosition);

    node.scaling.set(2, 2, 2);
    expect(worldMatrixVersion(node)).toBeGreaterThan(afterRotation);

    disposeNode(node);
  });

  it("bumps a bulk set even when the values are unchanged", () => {
    // Recorded because it is a trap for change detection: `ObservableVec3.set()` notifies
    // unconditionally, only the per-component setters compare first.
    const node = createNode("bulk");
    node.position.set(1, 2, 3);
    const before = worldMatrixVersion(node);
    node.position.set(1, 2, 3);
    expect(worldMatrixVersion(node)).toBeGreaterThan(before);
    disposeNode(node);
  });

  it("propagates a parent's change to a child's worldMatrixVersion", () => {
    const parent = createNode("parent");
    const child = createNode("child");
    linkParent(child, parent);

    const before = worldMatrixVersion(child);
    parent.position.x = 10;
    expect(worldMatrixVersion(child)).toBeGreaterThan(before);
    expect(worldMatrixOf(child)[12]).toBeCloseTo(10, 10);

    disposeNode(child);
    disposeNode(parent);
  });

  it("keeps local values when linkParent moves a node", () => {
    // `docs/architecture/02-scene-graph.md` §5.1, worldPositionStays: false.
    const parent = createNode("parent");
    parent.position.set(10, 0, 0);
    const child = createNode("child");
    child.position.set(1, 0, 0);

    linkParent(child, parent);

    expect(child.position.x).toBe(1);
    expect(child.position.y).toBe(0);
    expect(child.position.z).toBe(0);
    expect(worldMatrixOf(child)[12]).toBeCloseTo(11, 10);

    disposeNode(child);
    disposeNode(parent);
  });

  it("keeps the world transform when reparentKeepingWorld moves a node", () => {
    // `docs/architecture/02-scene-graph.md` §5.1, worldPositionStays: true.
    const parent = createNode("parent");
    parent.position.set(10, 0, 0);
    parent.rotationQuaternion.set(0, ROOT_HALF, 0, ROOT_HALF);
    parent.scaling.set(2, 2, 2);

    const child = createNode("child");
    child.position.set(1, 2, 3);
    const worldBefore = worldMatrixOf(child);

    reparentKeepingWorld(child, parent);

    const worldAfter = worldMatrixOf(child);
    for (let index = 0; index < 16; index += 1) {
      expect(worldAfter[index]).toBeCloseTo(worldBefore[index] ?? 0, 4);
    }
    // The local values had to change to compensate, which is the whole point.
    expect(child.position.x).not.toBeCloseTo(1, 4);

    disposeNode(child);
    disposeNode(parent);
  });

  it("maintains the children arrays on both parents", () => {
    const first = createNode("first");
    const second = createNode("second");
    const child = createNode("child");

    linkParent(child, first);
    expect(first.children).toContain(child);
    expect(child.parent).toBe(first);

    linkParent(child, second);
    expect(first.children).not.toContain(child);
    expect(second.children).toContain(child);

    // Lite's own setParent maintains them too, so the two paths agree.
    reparentKeepingWorld(child, first);
    expect(second.children).not.toContain(child);
    expect(first.children).toContain(child);

    linkParent(child, null);
    expect(first.children).not.toContain(child);
    expect(child.parent).toBeNull();

    disposeNode(child);
    disposeNode(second);
    disposeNode(first);
  });

  it("relinking to the same parent is a no-op", () => {
    const parent = createNode("parent");
    const child = createNode("child");
    linkParent(child, parent);
    linkParent(child, parent);
    expect(parent.children).toHaveLength(1);
    disposeNode(child);
    disposeNode(parent);
  });

  it("detaching a node with reparentKeepingWorld bakes the world transform into local values", () => {
    const parent = createNode("parent");
    parent.position.set(10, 0, 0);
    const child = createNode("child");
    child.position.set(1, 0, 0);
    linkParent(child, parent);

    reparentKeepingWorld(child, null);

    expect(child.parent).toBeNull();
    expect(child.position.x).toBeCloseTo(11, 4);
    expect(worldMatrixOf(child)[12]).toBeCloseTo(11, 4);

    disposeNode(child);
    disposeNode(parent);
  });

  it("decomposes a world matrix into translation, rotation and scale", () => {
    const parent = createNode("parent");
    parent.position.set(1, 2, 3);
    parent.rotationQuaternion.set(0, ROOT_HALF, 0, ROOT_HALF);
    parent.scaling.set(2, 2, 2);
    const child = createNode("child");
    child.position.set(1, 0, 0);
    linkParent(child, parent);

    const position = { x: 0, y: 0, z: 0 };
    const rotation = { x: 0, y: 0, z: 0, w: 0 };
    const scale = { x: 0, y: 0, z: 0 };
    decomposeWorld(child, position, rotation, scale);

    expect(position.x).toBeCloseTo(1, 5);
    expect(position.y).toBeCloseTo(2, 5);
    expect(position.z).toBeCloseTo(1, 5);
    expect(scale.x).toBeCloseTo(2, 5);
    expect(scale.y).toBeCloseTo(2, 5);
    expect(scale.z).toBeCloseTo(2, 5);
    // Same rotation as the parent, up to the quaternion double cover.
    expect(Math.abs(rotation.y)).toBeCloseTo(ROOT_HALF, 5);
    expect(Math.abs(rotation.w)).toBeCloseTo(ROOT_HALF, 5);
    expect(rotation.x).toBeCloseTo(0, 5);
    expect(rotation.z).toBeCloseTo(0, 5);

    // The decomposition round-trips: recomposing reproduces the world matrix.
    const recomposed = compose(
      position.x,
      position.y,
      position.z,
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
      scale.x,
      scale.y,
      scale.z,
    );
    const world = worldMatrixOf(child);
    for (let index = 0; index < 16; index += 1) {
      expect(world[index]).toBeCloseTo(recomposed[index] ?? 0, 4);
    }

    disposeNode(child);
    disposeNode(parent);
  });

  it("copies into the caller's buffer and never hands out Lite's own matrix", () => {
    const node = createNode("copy");
    node.position.set(7, 8, 9);
    const out = new Float32Array(16);

    const returned = readWorldMatrix(node, out);

    expect(returned).toBe(out);
    expect(out[12]).toBe(7);
    // Mutating the copy cannot corrupt Lite's cache.
    out[12] = 0;
    expect(worldMatrixOf(node)[12]).toBe(7);

    disposeNode(node);
  });

  it("transforms a point by the world matrix the same way Lite composes it", () => {
    const parent = createNode("parent");
    parent.position.set(0, 0, 0);
    parent.rotationQuaternion.set(0, ROOT_HALF, 0, ROOT_HALF);
    const child = createNode("child");
    child.position.set(0, 0, 1);
    linkParent(child, parent);

    // +Z forward under a +90° Y rotation becomes +X (left-handed, Y up).
    const [x, y, z] = transformPoint(worldMatrixOf(child), 0, 0, 0);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);

    disposeNode(child);
    disposeNode(parent);
  });

  it("cascades visibility over the subtree at write time", () => {
    const parent = createNode("parent");
    const child = createNode("child");
    const grandchild = createNode("grandchild");
    linkParent(child, parent);
    linkParent(grandchild, child);

    setNodeVisible(parent, false);
    expect(parent.visible).toBe(false);
    expect(child.visible).toBe(false);
    expect(grandchild.visible).toBe(false);

    setNodeVisible(parent, true);
    expect(grandchild.visible).toBe(true);

    // The cascade is materialized, not inherited: a node linked afterwards keeps its own state.
    setNodeVisible(parent, false);
    const late = createNode("late");
    linkParent(late, parent);
    expect(late.visible).toBeUndefined();

    disposeNode(late);
    disposeNode(grandchild);
    disposeNode(child);
    disposeNode(parent);
  });

  it("round-trips the ignifx tag through Lite metadata", () => {
    const node = createNode("tagged");
    expect(readNodeTag(node)).toBeNull();

    tagNode(node, { entity: 42 });
    expect(readNodeTag(node)).toEqual({ entity: 42 });

    tagNode(node, { entity: 42, component: 7 });
    expect(readNodeTag(node)).toEqual({ entity: 42, component: 7 });

    // The tag lives beside whatever else writes to the metadata bag (glTF extras, for instance).
    node.metadata!["gltf"] = { extras: { source: "test" } };
    expect(readNodeTag(node)).toEqual({ entity: 42, component: 7 });

    disposeNode(node);
    expect(readNodeTag(node)).toBeNull();
  });

  it("ignores foreign metadata that is not an ignifx tag", () => {
    const node = createNode("foreign");
    node.metadata = { ignifx: "not a tag" };
    expect(readNodeTag(node)).toBeNull();
    node.metadata = { ignifx: {} };
    expect(readNodeTag(node)).toBeNull();
    node.metadata = { ignifx: { entity: "1" } };
    expect(readNodeTag(node)).toBeNull();
    node.metadata = { ignifx: { entity: 1, component: "x" } };
    expect(readNodeTag(node)).toEqual({ entity: 1 });
    node.metadata = { ignifx: null };
    expect(readNodeTag(node)).toBeNull();
    disposeNode(node);
  });

  it("unlinks a node from its parent when disposed, so the parent stops retaining it", () => {
    const parent = createNode("parent");
    const child = createNode("child");
    linkParent(child, parent);

    disposeNode(child);

    expect(child.parent).toBeNull();
    expect(parent.children).not.toContain(child);
    // Disposing twice is harmless.
    disposeNode(child);
    disposeNode(parent);
  });

  it("tolerates a parent link that was made outside the adapter", () => {
    // A direct `node.parent` write skips the `children` bookkeeping. Relinking must not corrupt the
    // old parent's array just because the child was never in it.
    const first = createNode("first");
    const second = createNode("second");
    const child = createNode("child");
    child.parent = first;
    expect(first.children).not.toContain(child);

    linkParent(child, second);

    expect(child.parent).toBe(second);
    expect(second.children).toEqual([child]);
    expect(first.children).toHaveLength(0);

    disposeNode(child);
    disposeNode(second);
    disposeNode(first);
  });

  it("accepts a world-matrix provider that is not a scene node as the previous parent", () => {
    // `SceneNode.parent` is typed as `IWorldMatrixProvider`; a camera has no `children` at all, and
    // a foreign object may have a `children` that is not an array. Neither may break relinking.
    const withoutChildren = createNode("without-children");
    const withNonArrayChildren = createNode("with-non-array-children");
    const child = createNode("child");

    child.parent = createProvider();
    linkParent(child, withoutChildren);
    expect(withoutChildren.children).toEqual([child]);

    child.parent = createProvider({ children: 7 });
    linkParent(child, withNonArrayChildren);
    expect(withNonArrayChildren.children).toEqual([child]);
    expect(withoutChildren.children).toEqual([child]);

    disposeNode(child);
    disposeNode(withNonArrayChildren);
    disposeNode(withoutChildren);
  });

  it("polls a foreign provider parent for changes instead of being invalidated by it", () => {
    // Lite can only push invalidation down links it owns, so a child of a plain provider re-reads
    // `parent.worldMatrixVersion` on every access. Documented so the kernel never assumes eager
    // invalidation for camera-parented nodes.
    const child = createNode("child");
    const provider = createProvider();
    child.parent = provider;

    const before = worldMatrixVersion(child);
    expect(worldMatrixOf(child)[12]).toBeCloseTo(0, 10);

    const moved: { worldMatrix: Mat4; worldMatrixVersion: number } = provider;
    moved.worldMatrixVersion = provider.worldMatrixVersion + 1;
    expect(worldMatrixVersion(child)).toBeGreaterThan(before);

    linkParent(child, null);
    disposeNode(child);
  });

  it("keeps two node graphs independent in one process", () => {
    // CONSTITUTION.md §3.6.
    const firstParent = createNode("a");
    const secondParent = createNode("b");
    const firstChild = createNode("a-child");
    const secondChild = createNode("b-child");
    linkParent(firstChild, firstParent);
    linkParent(secondChild, secondParent);

    firstParent.position.set(1, 0, 0);
    expect(worldMatrixOf(firstChild)[12]).toBeCloseTo(1, 10);
    expect(worldMatrixOf(secondChild)[12]).toBeCloseTo(0, 10);

    for (const node of [firstChild, secondChild, firstParent, secondParent]) {
      disposeNode(node);
    }
  });
});
