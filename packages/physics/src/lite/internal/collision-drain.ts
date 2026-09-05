// oxlint-disable eslint/no-underscore-dangle -- this file exists to read Babylon Lite's own internal, underscore-prefixed Havok fields; that is the whole of the ADR-0013 waiver
import { PhysicsErrorCode, physicsError } from "../../errors.js";
import { afterStep, CONTACT_CONTINUED, CONTACT_FINISHED, CONTACT_STARTED } from "../havok.js";
import type { ContactRecord, LitePhysicsWorld } from "../havok.js";
import type { LiteSceneNode } from "@ignifx/core";

/**
 * **Waiver, ADR-0013.** The adapter-internal drain of Havok's collision-event buffer, which is the
 * only way to learn *which bodies* collided under `@babylonjs/lite@1.27.0`
 * (`docs/architecture/09-physics.md` §4).
 *
 * Lite's public `onPhysicsCollision` (`index.d.ts` 7764) reports `type`, `point`, `normal` and
 * `impulse` and drops the two body ids on the floor (`lib/physics/havok-collision.js`). There is no
 * `onPhysicsCollisionBodies` in the pinned version — the whole `index.d.ts` was searched — so this
 * file reads the same buffer Lite reads, at the same offsets, and additionally keeps the two ids.
 * It deliberately crosses the boundary `CONSTITUTION.md` §3.4 and ADR-0002 draw, which is why it
 * is one file, `@internal`, opt-in through `physics({ collisionIdentities: "internal" })`, and
 * guarded by {@link probeCollisionLayout}.
 *
 * ## The layout, as read from Lite 1.27.0
 *
 * `HP_World_GetCollisionEvents(world)[1]` returns the address of a linked list of events walked with
 * `HP_World_GetNextCollisionEvent`. Over the same address Lite builds an `Int32Array` and a
 * `Float32Array` and reads:
 *
 * | Slot                     | Index                   |
 * | ------------------------ | ----------------------- |
 * | event type               | `int[0]`                |
 * | body A id                | `int[2]`   (`offA + 0`) |
 * | contact point (A)        | `float[10..12]` (`offA + 8`)  |
 * | contact normal (A)       | `float[13..15]` (`offA + 11`) |
 * | body B id                | `int[18]`  (`offB + 0`) |
 * | applied impulse          | `float[34]` (`offB + 16`)     |
 *
 * `offA = 2` and `offB = 18` are Lite's own constants (`havok-collision.js:12-13`); the body-id
 * slots are the two Lite does not read, and they match Babylon.js's `CollisionEvent.readToRef`.
 *
 * The waiver expires the release after an upstream API lands: delete this file and the option.
 */

/** The internal shape of Lite's `PhysicsWorld`, as far as this drain needs it. */
interface WorldInternals {
  /** The instantiated Havok Emscripten module. */
  readonly _hknp?: HavokInternals;
  /** The native world handle. */
  readonly _hkWorld?: unknown;
  /** Every body Lite tracks, in creation order. */
  readonly _bodies?: readonly BodyInternals[];
}

/** The internal shape of Lite's `PhysicsBody`. */
interface BodyInternals {
  /** The native body handle; its first element is the id the event buffer carries. */
  readonly _hkBody?: readonly unknown[];
  /** The node the body drives. */
  readonly node: LiteSceneNode;
}

/** The subset of the Havok module the drain calls. */
interface HavokInternals {
  /** The module's linear memory. */
  readonly HEAPU8: { readonly buffer: ArrayBufferLike };
  /** The three collision event-type values, each wrapped in an object with a numeric `value`. */
  readonly EventType: Readonly<Record<string, { readonly value: number }>>;
  /** Returns `[result, address]` for the head of the collision-event list. */
  HP_World_GetCollisionEvents(world: unknown): readonly [unknown, number];
  /** Returns the address of the next event, or `0`. */
  HP_World_GetNextCollisionEvent(world: unknown, address: number): number;
}

/** Lite's `offA`: where the first contact's slots begin. */
const OFFSET_A = 2;

/** Lite's `offB`: where the second contact's slots begin. */
const OFFSET_B = 18;

/** The Babylon Lite version this drain was written and tested against. */
export const PINNED_LITE_VERSION = "1.27.0";

/**
 * Reports whether a world exposes the internals this drain reads.
 *
 * @param world - The Havok world handle.
 * @returns `true` when every field the drain needs is present and of the expected kind.
 *
 * @internal
 */
export function probeCollisionLayout(world: LitePhysicsWorld): boolean {
  const internals = asWorldInternals(world);
  const havok = internals._hknp;
  if (havok === undefined || internals._hkWorld === undefined || !Array.isArray(internals._bodies)) {
    return false;
  }
  if (typeof havok.HP_World_GetCollisionEvents !== "function") {
    return false;
  }
  if (typeof havok.HP_World_GetNextCollisionEvent !== "function") {
    return false;
  }
  const started: { readonly value?: number } | undefined = havok.EventType["COLLISION_STARTED"];
  const continued: { readonly value?: number } | undefined = havok.EventType["COLLISION_CONTINUED"];
  return typeof started?.value === "number" && typeof continued?.value === "number";
}

/**
 * Registers the internal drain on a world's post-step hook.
 *
 * @param world - The Havok world handle.
 * @param sink - Called once per collision event, with both nodes resolved.
 * @throws IgnifxError with code `IGX-0908` when {@link probeCollisionLayout} says the internals
 * moved, which is what makes a Babylon Lite upgrade fail loudly rather than silently.
 *
 * @internal
 */
export function drainCollisionsWithBodies(world: LitePhysicsWorld, sink: (record: ContactRecord) => void): void {
  if (!probeCollisionLayout(world)) {
    throw physicsError(
      PhysicsErrorCode.internalDrainUnavailable,
      'physics({ collisionIdentities: "internal" }) needs Babylon Lite\'s Havok internals, which this version does not expose.',
      {
        context: { version: PINNED_LITE_VERSION },
        hint: 'Pin @babylonjs/lite to 1.27.0, or use the default collisionIdentities: "upstream".',
      },
    );
  }
  const internals = asWorldInternals(world);
  const havok = internals._hknp;
  const native = internals._hkWorld;
  if (havok === undefined || native === undefined) {
    return;
  }
  const startedValue = havok.EventType["COLLISION_STARTED"]?.value ?? -1;
  const continuedValue = havok.EventType["COLLISION_CONTINUED"]?.value ?? -1;

  afterStep(world, (): void => {
    let address = havok.HP_World_GetCollisionEvents(native)[1];
    while (address !== 0) {
      const ints = new Int32Array(havok.HEAPU8.buffer, address);
      const floats = new Float32Array(havok.HEAPU8.buffer, address);
      const type = ints[0] ?? -1;
      sink({
        phase: type === startedValue ? CONTACT_STARTED : type === continuedValue ? CONTACT_CONTINUED : CONTACT_FINISHED,
        point: {
          x: floats[OFFSET_A + 8] ?? 0,
          y: floats[OFFSET_A + 9] ?? 0,
          z: floats[OFFSET_A + 10] ?? 0,
        },
        normal: {
          x: floats[OFFSET_A + 11] ?? 0,
          y: floats[OFFSET_A + 12] ?? 0,
          z: floats[OFFSET_A + 13] ?? 0,
        },
        impulse: floats[OFFSET_B + 16] ?? 0,
        nodeA: nodeById(internals, ints[OFFSET_A] ?? 0),
        nodeB: nodeById(internals, ints[OFFSET_B] ?? 0),
      });
      address = havok.HP_World_GetNextCollisionEvent(native, address);
    }
  });
}

/**
 * Resolves a native body id to the node Lite bound it to, the same linear scan Lite's own
 * `findBodyById` performs (`lib/physics/havok-trigger.js`, `havok-queries.js`).
 *
 * @param internals - The world internals.
 * @param id - The native body id from the event buffer.
 * @returns The node, or `null` when the body is no longer tracked.
 */
function nodeById(internals: WorldInternals, id: number): LiteSceneNode | null {
  const bodies = internals._bodies ?? [];
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const native = body?._hkBody?.[0];
    if (native === id) {
      return body?.node ?? null;
    }
    if (typeof native === "bigint" && native === BigInt(id)) {
      return body?.node ?? null;
    }
  }
  return null;
}

/**
 * Views a Lite world as the internal record this drain reads.
 *
 * @remarks
 * The waived boundary crossing of ADR-0013, in one expression. It needs no assertion: Lite declares
 * `PhysicsWorld` as an empty interface and every field below is optional, so the view is structural
 * — and {@link probeCollisionLayout} is what makes reading it safe.
 *
 * @param world - The opaque handle.
 * @returns The same object, typed.
 */
function asWorldInternals(world: LitePhysicsWorld): WorldInternals {
  return world;
}
