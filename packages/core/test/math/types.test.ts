import { describe, expect, it } from "vitest";
import { Mat4, type Mat4Elements } from "../../src/math/mat4.js";
import { Vec3 } from "../../src/math/vec3.js";
import type { Color } from "../../src/math/color.js";
import type { Quat } from "../../src/math/quat.js";
import type {
  ColorLike,
  Mat4Like,
  MutableQuat,
  MutableVec2,
  MutableVec3,
  MutableVec4,
  QuatLike,
  Vec2Like,
  Vec3Like,
  Vec4Like,
} from "../../src/math/types.js";
import type { Vec2 } from "../../src/math/vec2.js";
import type { Vec4 } from "../../src/math/vec4.js";

/**
 * Hand-written mirrors of the Babylon Lite 1.27.0 declarations, so this package can prove structural
 * compatibility without importing `@babylonjs/lite` (which only `src/lite/**` may do — coding
 * standards §4). Each mirror cites the lines it was copied from in
 * `packages/core/node_modules/@babylonjs/lite/index.d.ts`.
 *
 * A getter/setter pair is structurally a mutable property, which is why the accessors of the
 * observable classes appear here as plain fields.
 *
 * The *real* assignability check — feeding an actual `ObservableVec3` to a `MutableVec3` parameter —
 * belongs to the adapter's own tests under `test/lite/`, where importing Lite is legal.
 */

/** Lite `Vec2` — index.d.ts lines 13625-13628. */
interface LiteVec2 {
  x: number;
  y: number;
}

/** Lite `Vec3` — index.d.ts lines 13631-13635. */
interface LiteVec3 {
  x: number;
  y: number;
  z: number;
}

/** Lite `Vec4` — index.d.ts lines 13647-13652. */
interface LiteVec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Lite `Quat` — index.d.ts lines 9306-9311. */
interface LiteQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Lite `Color4` — index.d.ts lines 1870-1875. */
interface LiteColor4 {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Lite `Mat4` — index.d.ts lines 6981-6983. */
interface LiteMat4 {
  readonly length: 16;
  readonly [index: number]: number;
}

/** Lite `ObservableVec3` public members — index.d.ts lines 7685-7705. */
interface LiteObservableVec3 {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): void;
  copyFrom(v: LiteVec3): void;
  toArray(out: Float32Array, offset?: number): void;
}

/** Lite `ObservableQuat` public members — index.d.ts lines 7657-7683. */
interface LiteObservableQuat {
  readonly version: number;
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): void;
  copyFrom(q: LiteQuat): void;
  toArray(out: Float32Array, offset?: number): void;
}

/** `true` only when `A` is assignable to `B`. */
type Assignable<A, B> = [A] extends [B] ? true : false;

describe("structural compatibility with Babylon Lite", () => {
  it("accepts Lite's plain vector, quaternion, colour and matrix shapes as the read-only contracts", () => {
    const vec2: Assignable<LiteVec2, Vec2Like> = true;
    const vec3: Assignable<LiteVec3, Vec3Like> = true;
    const vec4: Assignable<LiteVec4, Vec4Like> = true;
    const quat: Assignable<LiteQuat, QuatLike> = true;
    const color: Assignable<LiteColor4, ColorLike> = true;
    const mat4: Assignable<LiteMat4, Mat4Like> = true;
    expect([vec2, vec3, vec4, quat, color, mat4]).toEqual([true, true, true, true, true, true]);
  });

  it("accepts Lite's observable node views as the mutable contracts", () => {
    const observableVec3: Assignable<LiteObservableVec3, MutableVec3> = true;
    const observableQuat: Assignable<LiteObservableQuat, MutableQuat> = true;
    expect([observableVec3, observableQuat]).toEqual([true, true]);
  });

  it("lets ignifx's own classes stand in for both contracts", () => {
    const vec2Like: Assignable<Vec2, Vec2Like> = true;
    const vec3Like: Assignable<Vec3, Vec3Like> = true;
    const vec4Like: Assignable<Vec4, Vec4Like> = true;
    const quatLike: Assignable<Quat, QuatLike> = true;
    const colorLike: Assignable<Color, ColorLike> = true;
    const mutableVec2: Assignable<Vec2, MutableVec2> = true;
    const mutableVec3: Assignable<Vec3, MutableVec3> = true;
    const mutableVec4: Assignable<Vec4, MutableVec4> = true;
    const mutableQuat: Assignable<Quat, MutableQuat> = true;
    expect([
      vec2Like,
      vec3Like,
      vec4Like,
      quatLike,
      colorLike,
      mutableVec2,
      mutableVec3,
      mutableVec4,
      mutableQuat,
    ]).toHaveLength(9);
  });

  it("makes a matrix's element storage a Mat4Like, and Lite's Mat4 interchangeable with it", () => {
    const elementsAreMat4Like: Assignable<Mat4Elements, Mat4Like> = true;
    const liteMat4IsMat4Like: Assignable<LiteMat4, Mat4Like> = true;
    expect([elementsAreMat4Like, liteMat4IsMat4Like]).toEqual([true, true]);

    // and at runtime the storage really is a 16-element Float32Array, as Lite's allocator produces
    const m = new Mat4();
    expect(m.elements).toBeInstanceOf(Float32Array);
    expect(m.elements.length).toBe(16);
  });

  it("writes through a hand-rolled MutableVec3, the way a Lite observable would be written", () => {
    const written: number[] = [];
    const observable: MutableVec3 = {
      x: 0,
      y: 0,
      z: 0,
      set(x: number, y: number, z: number): void {
        this.x = x;
        this.y = y;
        this.z = z;
        written.push(x, y, z);
      },
      copyFrom(v: Vec3Like): void {
        this.set(v.x, v.y, v.z);
      },
    };
    Vec3.addToRef(new Vec3(1, 2, 3), new Vec3(10, 20, 30), observable);
    expect([observable.x, observable.y, observable.z]).toEqual([11, 22, 33]);
    expect(written).toEqual([11, 22, 33]);
  });
});
