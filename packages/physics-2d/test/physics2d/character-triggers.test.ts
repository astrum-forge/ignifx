import { Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { CharacterController2D } from "../../src/components/character-controller.js";
import { BoxCollider2D, CircleCollider2D } from "../../src/components/colliders.js";
import { createPhysics2DApp, FIXED_STEP } from "../support/harness.js";
import type { CharacterCollision2D, TriggerEvent2D } from "../../src/events.js";
import type { Physics2DAppHarness } from "../support/harness.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * **A trigger is never an obstacle to a character controller** (measured 2026-09-08 against
 * `@dimforge/rapier2d-compat@0.20.0`).
 *
 * Rapier's `KinematicCharacterController.computeColliderMovement` takes `filterFlags` as its third
 * argument, and with it left `undefined` a sensor counts as a wall: a kinematic box driven at a
 * static sensor ball stops dead at the sensor's surface and, because it never overlaps it, no
 * intersection event is raised either. The adapter therefore passes
 * `QueryFilterFlags.EXCLUDE_SENSORS` on every move.
 *
 * This is what the side-scroller template's coins depend on — a `CircleCollider2D`
 * `{ isTrigger: true }` on an entity with no rigidbody, walked into by a `CharacterController2D`.
 * `events.test.ts` covers the kinematic-`Rigidbody2D` path, which was never affected.
 */

/** Metres per second the character walks at. */
const WALK_SPEED = 2;

/** The downward pull applied while airborne, standing in for a toolkit controller's gravity. */
const FALL_SPEED = 9.81;

/** A gentle downward pull that keeps a grounded character on the floor. */
const STICK_SPEED = 1;

/** How many fixed steps each walk runs for. */
const WALK_STEPS = 200;

/** Records every trigger callback its entity receives, in delivery order. */
class TriggerLog extends Script implements ScriptCallbacks {
  static typeId = "test/CharacterTriggerLog2D";

  /** `"enter"` or `"exit"` followed by the other participant's name. */
  readonly entries: string[] = [];

  onTriggerEnter(trigger: TriggerEvent2D): void {
    this.entries.push(`enter:${trigger.other?.name ?? "-"}`);
  }

  onTriggerExit(trigger: TriggerEvent2D): void {
    this.entries.push(`exit:${trigger.other?.name ?? "-"}`);
  }
}

/** What one {@link walkPastCoin} run observed. */
interface CoinWalk {
  /** Where the character finished, in metres. */
  readonly finalX: number;
  /** The trigger callbacks the character's script received. */
  readonly hero: readonly string[];
  /** The trigger callbacks the coin's script received; empty when there is no coin. */
  readonly coin: readonly string[];
}

/**
 * Adds the long static floor every scene here walks along.
 *
 * @param harness - The app.
 */
function addGround(harness: Physics2DAppHarness): void {
  const ground = harness.world.createEntity("Ground");
  ground.transform.position = { x: 0, y: -0.5, z: 0 };
  ground.addComponent(BoxCollider2D, { size: { x: 40, y: 1 } });
}

/**
 * Adds a collectible at the origin: a trigger circle on an entity with no rigidbody, exactly as the
 * side-scroller template authors one.
 *
 * @param harness - The app.
 * @returns The coin's trigger log.
 */
function addCoin(harness: Physics2DAppHarness): TriggerLog {
  const coin = harness.world.createEntity("Coin");
  coin.transform.position = { x: 0, y: 0.6, z: 0 };
  coin.addComponent(CircleCollider2D, { radius: 0.4, isTrigger: true });
  return coin.addComponent(TriggerLog);
}

/**
 * Adds a capsule character standing on the floor at `x = −2`.
 *
 * @param harness - The app.
 * @returns Its controller.
 */
function addHero(harness: Physics2DAppHarness): CharacterController2D {
  const hero = harness.world.createEntity("Hero");
  hero.transform.position = { x: -2, y: 0.62, z: 0 };
  return hero.addComponent(CharacterController2D, { radius: 0.2, height: 1.2, interpolation: "none" });
}

/**
 * Walks a character to the right, pressed into the floor.
 *
 * @param harness - The app.
 * @param controller - The controller to drive.
 */
function walk(harness: Physics2DAppHarness, controller: CharacterController2D): void {
  for (let index = 0; index < WALK_STEPS; index += 1) {
    const pull = controller.isGrounded ? STICK_SPEED : FALL_SPEED;
    controller.move({ x: WALK_SPEED * FIXED_STEP, y: -pull * FIXED_STEP });
    harness.step();
  }
}

/**
 * Walks a character from `x = −2` along the floor, with or without a coin at the origin.
 *
 * @param withCoin - Whether to place the coin.
 * @returns Where the character ended up and what each entity heard.
 */
async function walkPastCoin(withCoin: boolean): Promise<CoinWalk> {
  const harness = await createPhysics2DApp();
  try {
    addGround(harness);
    const coinLog = withCoin ? addCoin(harness) : null;
    const controller = addHero(harness);
    const heroLog = controller.entity.addComponent(TriggerLog);
    walk(harness, controller);
    return {
      finalX: controller.entity.transform.position.x,
      hero: [...heroLog.entries],
      coin: coinLog === null ? [] : [...coinLog.entries],
    };
  } finally {
    harness.dispose();
  }
}

describe("CharacterController2D and triggers", () => {
  it("walks straight through a trigger and raises enter and exit on both entities", async () => {
    const past = await walkPastCoin(true);
    const clear = await walkPastCoin(false);

    // The coin cost the character nothing: the same walk covers the same ground, and it finished
    // well past the coin instead of stopping at its rim.
    expect(past.finalX).toBeGreaterThan(2);
    expect(past.finalX).toBeCloseTo(clear.finalX, 3);
    // Both sides heard the overlap begin and end, each naming the other.
    expect(past.hero).toEqual(["enter:Coin", "exit:Coin"]);
    expect(past.coin).toEqual(["enter:Hero", "exit:Hero"]);
    expect(clear.hero).toEqual([]);
  }, 30_000);

  it("keeps a trigger out of onCollided while still reporting the floor", async () => {
    const harness = await createPhysics2DApp();
    try {
      addGround(harness);
      addCoin(harness);
      const controller = addHero(harness);
      const hits: string[] = [];
      controller.onCollided.connect((collision: CharacterCollision2D): void => {
        hits.push(collision.other?.name ?? "-");
      });
      walk(harness, controller);

      expect(hits).toContain("Ground");
      expect(hits).not.toContain("Coin");
    } finally {
      harness.dispose();
    }
  }, 30_000);
});
