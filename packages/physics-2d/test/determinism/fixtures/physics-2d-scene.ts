import { BoxCollider2D, CircleCollider2D } from "../../../src/components/colliders.js";
import { Rigidbody2D } from "../../../src/components/rigidbody.js";
import type { Entity, World } from "@ignifx/core";

/**
 * The Phase 6 2D determinism scene: a static floor plus a deterministic pile of dynamic bodies that
 * collide with each other and come to rest (`docs/architecture/09-physics.md` §8, ADR-0006).
 *
 * Everything about it is fixed: the entity creation order (which is the body creation order
 * Rapier's internal ordering follows), the collider sizes, and the start poses, which are exact
 * multiples of `2^-6` so the scene description itself introduces no rounding. Nothing reads a clock
 * or a random source.
 */

/** How many dynamic bodies the pile holds. */
export const BODY_COUNT = 12;

/** How many fixed steps a determinism run advances. */
export const STEP_COUNT = 600;

/** The quantum every start coordinate is a multiple of, so the scene is exactly representable. */
const QUANTUM = 2 ** -6;

/**
 * Builds the scene.
 *
 * @param world - The world to build it in.
 * @returns The dynamic bodies, in creation order.
 */
export function build2DDeterminismScene(world: World): readonly Entity[] {
  const floor = world.createEntity("Floor");
  floor.transform.position = { x: 0, y: -0.5, z: 0 };
  floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

  const bodies: Entity[] = [];
  for (let index = 0; index < BODY_COUNT; index += 1) {
    const entity = world.createEntity(`Body${String(index)}`);
    const column = index % 4;
    const row = Math.trunc(index / 4);
    entity.transform.position = {
      x: column * 96 * QUANTUM - 144 * QUANTUM,
      y: 96 * QUANTUM + row * 72 * QUANTUM,
      z: 0,
    };
    if (index % 2 === 0) {
      entity.addComponent(BoxCollider2D, { size: { x: 1, y: 1 } });
    } else {
      entity.addComponent(CircleCollider2D, { radius: 0.5 });
    }
    entity.addComponent(Rigidbody2D, { mass: 1 + (index % 4) * 0.25, interpolation: "none" });
    bodies.push(entity);
  }
  return bodies;
}

/**
 * Hashes every body's world pose with FNV-1a over the `Float64` bit patterns, the same way the
 * kernel's S1.3 baseline and the 3D physics determinism suite do.
 *
 * @param bodies - The entities to hash, in creation order.
 * @returns The hash as eight lowercase hexadecimal digits.
 */
export function hash2DPoses(bodies: readonly Entity[]): string {
  const buffer = new DataView(new ArrayBuffer(8));
  let hash = 0x81_1c_9d_c5;
  for (const body of bodies) {
    const transform = body.transform;
    const position = transform.position;
    for (const value of [position.x, position.y, transform.rotation2D]) {
      buffer.setFloat64(0, value);
      for (let byte = 0; byte < 8; byte += 1) {
        hash ^= buffer.getUint8(byte);
        hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
      }
    }
  }
  return hash.toString(16).padStart(8, "0");
}
