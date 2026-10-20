/**
 * `getColliderOutlines`: the physics extensions' collider outlines, made JSON. The host reads
 * `app.physics.colliderOutlines` and `app.physics2d.colliderOutlines` by shape, as `@ignifx/devtools`
 * reads `app.physics`, so a project without physics costs the host nothing and the host depends on
 * neither package (ADR-0028, amendment of 2026-10-20).
 */

import { Component } from "@ignifx/core";
import { COLLIDER_OUTLINES_MAX_ENTITIES, COLLIDER_OUTLINES_MAX_NUMBERS } from "../protocol/index.js";
import type { ColliderOutlineRecord, ColliderOutlineSet } from "../protocol/index.js";
import type { App, Entity } from "@ignifx/core";

/** One outline as a physics service answers it. */
interface OutlineLike {
  /** The collider. */
  readonly collider: Component;
  /** Whether it is a trigger. */
  readonly isTrigger: boolean;
  /** Its segments: `x, y, z` per end in 3D, `x, y` per end in 2D. */
  readonly lines: Float32Array;
}

/** How many decimal places a coordinate keeps on the wire: a hundredth of a millimetre. */
const WIRE_PRECISION = 1e5;

/**
 * Finds `colliderOutlines` on one of the app's physics services.
 *
 * @param app - The app.
 * @param property - `"physics"` or `"physics2d"`.
 * @returns A function that outlines an entity's colliders, or `null` when the project does not
 * register that extension (or registers one from before the method).
 */
function outlinerOf(app: App, property: string): ((entity: Entity) => readonly OutlineLike[]) | null {
  const service: unknown = Reflect.get(app, property);
  if (typeof service !== "object" || service === null) {
    return null;
  }
  const method: unknown = Reflect.get(service, "colliderOutlines");
  if (typeof method !== "function") {
    return null;
  }
  return (entity: Entity): readonly OutlineLike[] => {
    const answer: unknown = Reflect.apply(method, service, [entity]);
    return Array.isArray(answer) ? answer.filter(isOutlineLike) : [];
  };
}

/**
 * Tells whether a value has an outline's shape.
 *
 * @param value - The value.
 * @returns True for a component, a boolean, and a `Float32Array`.
 */
function isOutlineLike(value: unknown): value is OutlineLike {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "collider") instanceof Component &&
    typeof Reflect.get(value, "isTrigger") === "boolean" &&
    Reflect.get(value, "lines") instanceof Float32Array
  );
}

/**
 * Rounds a coordinate for the wire, which also drops the float32 noise (`0.30000001192092896`).
 *
 * @param value - The coordinate.
 * @returns The rounded coordinate.
 */
function wireNumber(value: number): number {
  return Math.round(value * WIRE_PRECISION) / WIRE_PRECISION;
}

/**
 * Turns 3D segments into wire numbers.
 *
 * @param lines - `x, y, z` per end.
 * @returns The same segments, rounded.
 */
function lines3D(lines: Float32Array): number[] {
  return Array.from(lines, wireNumber);
}

/**
 * Turns 2D segments into 3D wire numbers at a depth.
 *
 * @param lines - `x, y` per end.
 * @param z - The entity's world `z`.
 * @returns `x, y, z` per end, rounded.
 */
function lines2D(lines: Float32Array, z: number): number[] {
  const out: number[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    out.push(wireNumber(lines[index] ?? 0), wireNumber(lines[index + 1] ?? 0), wireNumber(z));
  }
  return out;
}

/**
 * Outlines the colliders of document entities, 3D first and then 2D for each entity, within the
 * protocol's caps: at most `COLLIDER_OUTLINES_MAX_ENTITIES` entities and
 * `COLLIDER_OUTLINES_MAX_NUMBERS` numbers of lines. What passes a cap is left out, whole, and the
 * answer says `truncated`.
 *
 * @param app - The scene view's app.
 * @param requested - The requested entities, as many as asked, before any is looked up.
 * @param resolve - Finds a requested uid's entity in the open scene, or `undefined`.
 * @returns The answer to `getColliderOutlines`.
 */
export function colliderOutlinesOf(
  app: App,
  requested: readonly string[],
  resolve: (uid: string) => Entity | undefined,
): ColliderOutlineSet {
  const outline3D = outlinerOf(app, "physics");
  const outline2D = outlinerOf(app, "physics2d");
  const outlines: ColliderOutlineRecord[] = [];
  const uids = [...new Set(requested)];
  let truncated = uids.length > COLLIDER_OUTLINES_MAX_ENTITIES;
  let numbers = 0;
  for (const uid of uids.slice(0, COLLIDER_OUTLINES_MAX_ENTITIES)) {
    const entity = resolve(uid);
    if (entity === undefined) {
      continue;
    }
    const z = entity.transform.position.z;
    const found: (readonly [OutlineLike, boolean])[] = [
      ...(outline3D?.(entity) ?? []).map((outline) => [outline, false] as const),
      ...(outline2D?.(entity) ?? []).map((outline) => [outline, true] as const),
    ];
    for (const [outline, is2D] of found) {
      const count = is2D ? (outline.lines.length / 2) * 3 : outline.lines.length;
      if (numbers + count > COLLIDER_OUTLINES_MAX_NUMBERS) {
        truncated = true;
        return { outlines, truncated };
      }
      numbers += count;
      outlines.push({
        entity: uid,
        component: outline.collider.uid,
        isTrigger: outline.isTrigger,
        lines: is2D ? lines2D(outline.lines, z) : lines3D(outline.lines),
      });
    }
  }
  return { outlines, truncated };
}
