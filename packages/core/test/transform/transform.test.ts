import { describe, expect, it } from "vitest";
import { Quat } from "../../src/math/quat.js";
import { Vec2 } from "../../src/math/vec2.js";
import { Vec3 } from "../../src/math/vec3.js";
import { Transform } from "../../src/transform/transform.js";
import { createTestWorld } from "../support/create-test-world.js";

/**
 * `docs/architecture/02-scene-graph.md` §5. Every expected value is derived in the test rather than
 * read back from Babylon Lite, so the assertions test the adapter instead of restating it.
 *
 * Conventions (ADR-0011, verified in `test/lite/node.test.ts`): left-handed, Y up, +Z forward. A
 * +90 degree yaw about +Y is the quaternion `(0, sin45, 0, cos45)` and maps local +Z onto world +X.
 */

/** `sin(45 degrees)` and `cos(45 degrees)`, the components of a 90 degree yaw quaternion. */
const ROOT_HALF = Math.SQRT1_2;

/** Digits that survive Lite's `Float32Array` world-matrix storage. */
const DIGITS = 5;

/**
 * Asserts a vector's components.
 *
 * @param actual - What was produced.
 * @param actual.x - Its x component.
 * @param actual.y - Its y component.
 * @param actual.z - Its z component.
 * @param x - Expected x.
 * @param y - Expected y.
 * @param z - Expected z.
 */
function expectVec3(actual: { x: number; y: number; z: number }, x: number, y: number, z: number): void {
  expect(actual.x).toBeCloseTo(x, DIGITS);
  expect(actual.y).toBeCloseTo(y, DIGITS);
  expect(actual.z).toBeCloseTo(z, DIGITS);
}

/**
 * Yaws a transform by 90 degrees about +Y.
 *
 * @param transform - The transform to rotate.
 */
function yaw90(transform: Transform): void {
  transform.localRotation.set(0, ROOT_HALF, 0, ROOT_HALF);
}

describe("local views", () => {
  it("writes through to the Babylon Lite node", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localPosition.x += 1;
    expect(entity.transform.lite.position.x).toBe(1);
    entity.transform.localPosition.set(4, 5, 6);
    expect(entity.transform.lite.position.y).toBe(5);
    entity.transform.localScale.copyFrom({ x: 2, y: 2, z: 2 });
    expect(entity.transform.lite.scaling.z).toBe(2);
    yaw90(entity.transform);
    expect(entity.transform.lite.rotationQuaternion.y).toBeCloseTo(ROOT_HALF, DIGITS);
    harness.dispose();
  });

  it("returns the same live object on every read", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.transform.localPosition).toBe(entity.transform.localPosition);
    harness.dispose();
  });
});

describe("world space", () => {
  it("agrees with hand-computed values for a parent and child", () => {
    // Parent: T(1,2,3) then R(+90 degrees about Y) then S(2). Child local position (1,0,0).
    // A +90 degree yaw maps local +X onto world -Z, so the scaled child offset (2,0,0) becomes
    // (0,0,-2) and the child's world origin is (1,2,3) + (0,0,-2) = (1,2,1).
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localPosition.set(1, 2, 3);
    yaw90(parent.transform);
    parent.transform.localScale.set(2, 2, 2);
    const child = harness.world.createEntity("child", { parent });
    child.transform.localPosition.set(1, 0, 0);
    expectVec3(child.transform.position, 1, 2, 1);
    const out = new Vec3();
    expect(child.transform.positionToRef(out)).toBe(out);
    expectVec3(out, 1, 2, 1);
    harness.dispose();
  });

  it("reports the lossy world scale as the length of each basis column", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localScale.set(2, 3, 4);
    const child = harness.world.createEntity("child", { parent });
    child.transform.localScale.set(0.5, 0.5, 0.5);
    expectVec3(child.transform.lossyScale, 1, 1.5, 2);
    harness.dispose();
  });

  it("writes a world position through the parent's inverse", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localPosition.set(10, 0, 0);
    const child = harness.world.createEntity("child", { parent });
    child.transform.position = { x: 12, y: 0, z: 0 };
    expectVec3(child.transform.localPosition, 2, 0, 0);
    expectVec3(child.transform.position, 12, 0, 0);
    harness.dispose();
  });

  it("writes a world rotation through the parent's inverse", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    yaw90(parent.transform);
    const child = harness.world.createEntity("child", { parent });
    child.transform.rotation = { x: 0, y: ROOT_HALF, z: 0, w: ROOT_HALF };
    // The parent already supplies the full 90 degrees, so the child's local rotation is identity.
    expect(child.transform.localRotation.y).toBeCloseTo(0, DIGITS);
    expect(child.transform.localRotation.w).toBeCloseTo(1, DIGITS);
    harness.dispose();
  });

  it("sets world position and rotation together", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localPosition.set(0, 5, 0);
    yaw90(parent.transform);
    const child = harness.world.createEntity("child", { parent });
    child.transform.setPositionAndRotation({ x: 1, y: 5, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    expectVec3(child.transform.position, 1, 5, 0);
    const rotation = child.transform.rotation;
    expect(rotation.w).toBeCloseTo(1, DIGITS);
    harness.dispose();
  });
});

describe("basis vectors", () => {
  it("points forward along +Z, right along +X and up along +Y with no rotation", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expectVec3(entity.transform.forward, 0, 0, 1);
    expectVec3(entity.transform.right, 1, 0, 0);
    expectVec3(entity.transform.up, 0, 1, 0);
    harness.dispose();
  });

  it("maps forward onto +X and right onto -Z after a 90 degree yaw", () => {
    // Left-handed +90 degrees about +Y: local +Z goes to world +X, local +X goes to world -Z, and
    // local +Y is unchanged.
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    yaw90(entity.transform);
    expectVec3(entity.transform.forward, 1, 0, 0);
    expectVec3(entity.transform.right, 0, 0, -1);
    expectVec3(entity.transform.up, 0, 1, 0);
    harness.dispose();
  });

  it("normalises the basis under scale", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localScale.set(7, 7, 7);
    expectVec3(entity.transform.forward, 0, 0, 1);
    harness.dispose();
  });

  it("returns the out object from every ToRef variant", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const vector = new Vec3();
    const rotation = new Quat();
    expect(entity.transform.positionToRef(vector)).toBe(vector);
    expect(entity.transform.rotationToRef(rotation)).toBe(rotation);
    expect(entity.transform.eulerAnglesToRef(vector)).toBe(vector);
    expect(entity.transform.localEulerAnglesToRef(vector)).toBe(vector);
    expect(entity.transform.lossyScaleToRef(vector)).toBe(vector);
    expect(entity.transform.forwardToRef(vector)).toBe(vector);
    expect(entity.transform.rightToRef(vector)).toBe(vector);
    expect(entity.transform.upToRef(vector)).toBe(vector);
    expect(entity.transform.transformPoint({ x: 1, y: 2, z: 3 }, vector)).toBe(vector);
    expect(entity.transform.transformDirection({ x: 1, y: 2, z: 3 }, vector)).toBe(vector);
    expect(entity.transform.inverseTransformPoint({ x: 1, y: 2, z: 3 }, vector)).toBe(vector);
    expect(entity.transform.inverseTransformDirection({ x: 1, y: 2, z: 3 }, vector)).toBe(vector);
    harness.dispose();
  });

  it("allocates a fresh value only when no out object is supplied", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.transform.position).not.toBe(entity.transform.position);
    expect(entity.transform.transformPoint({ x: 0, y: 0, z: 0 })).toBeInstanceOf(Vec3);
    harness.dispose();
  });
});

describe("euler angles", () => {
  it("round-trips local degrees", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localEulerAngles = { x: 10, y: 20, z: 30 };
    expectVec3(entity.transform.localEulerAngles, 10, 20, 30);
    harness.dispose();
  });

  it("round-trips world degrees through a rotated parent", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    yaw90(parent.transform);
    const child = harness.world.createEntity("child", { parent });
    child.transform.eulerAngles = { x: 0, y: 30, z: 0 };
    expect(child.transform.eulerAngles.y).toBeCloseTo(30, 4);
    expect(child.transform.localEulerAngles.y).toBeCloseTo(-60, 4);
    harness.dispose();
  });
});

describe("movement helpers", () => {
  it("translates along the entity's own axes in local space", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    yaw90(entity.transform);
    entity.transform.translate({ x: 0, y: 0, z: 2 });
    expectVec3(entity.transform.localPosition, 2, 0, 0);
    harness.dispose();
  });

  it("translates along the world axes in world space", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    yaw90(entity.transform);
    entity.transform.translate({ x: 0, y: 0, z: 2 }, "world");
    expectVec3(entity.transform.localPosition, 0, 0, 2);
    harness.dispose();
  });

  it("rotates locally and in world space", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.rotate({ x: 0, y: 90, z: 0 });
    expectVec3(entity.transform.forward, 1, 0, 0);
    entity.transform.rotate({ x: 0, y: 90, z: 0 }, "world");
    expectVec3(entity.transform.forward, 0, 0, -1);
    harness.dispose();
  });

  it("orbits a point with rotateAround", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localPosition.set(1, 0, 0);
    entity.transform.rotateAround({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 90);
    // +90 degrees about +Y takes (1,0,0) to (0,0,-1) in a left-handed system.
    expectVec3(entity.transform.position, 0, 0, -1);
    harness.dispose();
  });

  it("points forward at a target with lookAt", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.lookAt({ x: 5, y: 0, z: 0 });
    expectVec3(entity.transform.forward, 1, 0, 0);
    harness.dispose();
  });
});

describe("space conversion", () => {
  it("round-trips a point through transformPoint and inverseTransformPoint", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localPosition.set(3, 4, 5);
    yaw90(entity.transform);
    entity.transform.localScale.set(2, 2, 2);
    const world = entity.transform.transformPoint({ x: 1, y: 2, z: 3 });
    const back = entity.transform.inverseTransformPoint(world);
    expectVec3(back, 1, 2, 3);
    harness.dispose();
  });

  it("ignores translation for directions", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localPosition.set(100, 100, 100);
    yaw90(entity.transform);
    expectVec3(entity.transform.transformDirection({ x: 0, y: 0, z: 1 }), 1, 0, 0);
    expectVec3(entity.transform.inverseTransformDirection({ x: 1, y: 0, z: 0 }), 0, 0, 1);
    harness.dispose();
  });
});

describe("matrices", () => {
  it("keeps one stable world-matrix view and refreshes it when the node moves", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const first = entity.transform.worldMatrix;
    expect(entity.transform.worldMatrix).toBe(first);
    expect(first[12]).toBe(0);
    entity.transform.localPosition.set(7, 0, 0);
    expect(entity.transform.worldMatrix[12]).toBe(7);
    harness.dispose();
  });

  it("composes the local matrix as translation times rotation times scale", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localPosition.set(1, 2, 3);
    entity.transform.localScale.set(2, 2, 2);
    const local = entity.transform.localMatrix;
    expect(local[0]).toBeCloseTo(2, DIGITS);
    expect(local[12]).toBeCloseTo(1, DIGITS);
    expect(local[13]).toBeCloseTo(2, DIGITS);
    expect(local[14]).toBeCloseTo(3, DIGITS);
    harness.dispose();
  });

  it("bumps worldMatrixVersion when the node or an ancestor moves", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    const child = harness.world.createEntity("child", { parent });
    const before = child.transform.worldMatrixVersion;
    parent.transform.localPosition.set(1, 0, 0);
    expect(child.transform.worldMatrixVersion).toBeGreaterThan(before);
    harness.dispose();
  });
});

describe("parenting", () => {
  it("keeps the world transform by default", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localPosition.set(10, 0, 0);
    const child = harness.world.createEntity("child");
    child.transform.localPosition.set(3, 0, 0);
    child.setParent(parent);
    expectVec3(child.transform.position, 3, 0, 0);
    expectVec3(child.transform.localPosition, -7, 0, 0);
    harness.dispose();
  });

  it("keeps the local values when worldPositionStays is false", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localPosition.set(10, 0, 0);
    const child = harness.world.createEntity("child");
    child.transform.localPosition.set(3, 0, 0);
    child.setParent(parent, { worldPositionStays: false });
    expectVec3(child.transform.localPosition, 3, 0, 0);
    expectVec3(child.transform.position, 13, 0, 0);
    harness.dispose();
  });

  it("restores world space when detached to the scene root", () => {
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localPosition.set(10, 0, 0);
    const child = harness.world.createEntity("child", { parent });
    child.transform.localPosition.set(3, 0, 0);
    child.setParent(null);
    expectVec3(child.transform.localPosition, 13, 0, 0);
    harness.dispose();
  });
});

describe("2D conveniences", () => {
  it("reads and writes the plane while leaving depth alone", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localPosition.set(0, 0, 9);
    entity.transform.localPosition2D = new Vec2(3, 4);
    expectVec3(entity.transform.localPosition, 3, 4, 9);
    expect(entity.transform.localPosition2D.x).toBe(3);
    entity.transform.position2D = new Vec2(1, 2);
    expectVec3(entity.transform.position, 1, 2, 9);
    expect(entity.transform.position2D.y).toBeCloseTo(2, DIGITS);
    harness.dispose();
  });

  it("rotates about +Z in degrees", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.rotation2D = 45;
    expect(entity.transform.rotation2D).toBeCloseTo(45, 4);
    expect(entity.transform.localRotation.z).toBeCloseTo(Math.sin(Math.PI / 8), DIGITS);
    harness.dispose();
  });

  it("scales in the plane while leaving depth alone", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localScale.set(1, 1, 7);
    entity.transform.localScale2D = new Vec2(2, 3);
    expectVec3(entity.transform.localScale, 2, 3, 7);
    expect(entity.transform.localScale2D.y).toBe(3);
    harness.dispose();
  });
});

describe("the transform is not removable", () => {
  it("throws IGX-0205 when removed", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(() => {
      entity.removeComponent(entity.transform);
    }).toThrow(/IGX-0205/u);
    harness.dispose();
  });

  it("throws IGX-0205 when disabled or destroyed", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(() => {
      entity.transform.enabled = false;
    }).toThrow(/IGX-0205/u);
    expect(() => {
      entity.transform.destroy();
    }).toThrow(/IGX-0205/u);
    expect(entity.transform.enabled).toBe(true);
    harness.dispose();
  });

  it("allows a redundant enable", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(() => {
      entity.transform.enabled = true;
    }).not.toThrow();
    harness.dispose();
  });
});

describe("degenerate matrices", () => {
  it("keeps a world position as a local one under a singular parent", () => {
    // Lite's own setParent takes the same escape hatch: with a collapsed axis the parent matrix
    // cannot be inverted, so no local value reproduces the world one.
    const harness = createTestWorld();
    const parent = harness.world.createEntity("parent");
    parent.transform.localScale.set(0, 1, 1);
    const child = harness.world.createEntity("child", { parent });
    child.transform.position = { x: 4, y: 5, z: 6 };
    expectVec3(child.transform.localPosition, 4, 5, 6);
    child.transform.setPositionAndRotation({ x: 7, y: 8, z: 9 }, { x: 0, y: 0, z: 0, w: 1 });
    expectVec3(child.transform.localPosition, 7, 8, 9);
    harness.dispose();
  });

  it("passes a world value straight through when its own matrix is singular", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localScale.set(0, 0, 0);
    expectVec3(entity.transform.inverseTransformPoint({ x: 1, y: 2, z: 3 }), 1, 2, 3);
    expectVec3(entity.transform.inverseTransformDirection({ x: 1, y: 2, z: 3 }), 1, 2, 3);
    harness.dispose();
  });

  it("returns the raw column when a basis axis has zero length", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.transform.localScale.set(1, 1, 0);
    expectVec3(entity.transform.forward, 0, 0, 0);
    expectVec3(entity.transform.right, 1, 0, 0);
    harness.dispose();
  });

  it("throws IGX-0206 for a transform the engine never bound to a node", () => {
    const detached = new Transform();
    expect(() => detached.lite).toThrow(/IGX-0206/u);
    expect(() => detached.localPosition).toThrow(/IGX-0206/u);
  });
});
