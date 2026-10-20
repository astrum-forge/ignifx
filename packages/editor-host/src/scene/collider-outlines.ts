/**
 * `getColliderOutlines`: the physics extensions' collider outlines, made JSON. The host reads
 * `app.physics.colliderOutlines` and `app.physics2d.colliderOutlines` by shape, as `@ignifx/devtools`
 * reads `app.physics`, so a project without physics costs the host nothing and the host depends on
 * neither package (ADR-0028, amendment of 2026-10-20).
 */

import { Component } from "@ignifx/core";
import type { ColliderOutlineRecord } from "../protocol/index.js";
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
 * Outlines the colliders of document entities, 3D first and then 2D for each entity.
 *
 * @param app - The scene view's app.
 * @param entities - The requested entities that the open scene has, as `[uid, entity]` pairs in
 * request order.
 * @returns One record per outlined collider.
 */
export function colliderOutlinesOf(
  app: App,
  entities: readonly (readonly [string, Entity])[],
): ColliderOutlineRecord[] {
  const outline3D = outlinerOf(app, "physics");
  const outline2D = outlinerOf(app, "physics2d");
  const records: ColliderOutlineRecord[] = [];
  for (const [uid, entity] of entities) {
    for (const outline of outline3D?.(entity) ?? []) {
      records.push({
        entity: uid,
        component: outline.collider.uid,
        isTrigger: outline.isTrigger,
        lines: lines3D(outline.lines),
      });
    }
    const outlines2D = outline2D?.(entity) ?? [];
    if (outlines2D.length > 0) {
      const z = entity.transform.position.z;
      for (const outline of outlines2D) {
        records.push({
          entity: uid,
          component: outline.collider.uid,
          isTrigger: outline.isTrigger,
          lines: lines2D(outline.lines, z),
        });
      }
    }
  }
  return records;
}
