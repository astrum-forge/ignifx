import { Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider2D } from "../../src/components/colliders.js";
import { Rigidbody2D } from "../../src/components/rigidbody.js";
import { createPhysics2DApp } from "../support/harness.js";
import type { Collision2D, TriggerEvent2D } from "../../src/events.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * Trigger and collision events in 2D (`docs/architecture/11-2d-toolkit.md` §8): who receives them,
 * what they carry, and in what order.
 *
 * Rapier reports **both** collider handles for every event (`pipeline/event_queue.d.ts`), so unlike
 * 3D there is no identity gap and no ADR-0013 waiver: `other` is always the real entity and
 * `otherCollider` is the exact collider.
 *
 * The callbacks are the 3D names — `onCollisionEnter`, not `onCollisionEnter2D` — because the
 * kernel's `PhysicsCallbackName` union has no `2D` variants and a world runs one physics extension.
 */

/** One recorded delivery. */
interface Entry {
  /** Which callback fired. */
  readonly kind: string;
  /** The entity whose script received it. */
  readonly self: string;
  /** The other participant's name, or `"-"`. */
  readonly other: string;
  /** Whether the payload carried the exact collider on the other side. */
  readonly hasCollider: boolean;
}

/** Records every trigger callback it receives. */
class TriggerLog extends Script implements ScriptCallbacks {
  static typeId = "test/TriggerLog2D";

  /** Everything this script saw, in delivery order. */
  readonly entries: Entry[] = [];

  onTriggerEnter(trigger: unknown): void {
    this.#record("enter", trigger as TriggerEvent2D);
  }

  onTriggerExit(trigger: unknown): void {
    this.#record("exit", trigger as TriggerEvent2D);
  }

  #record(kind: string, event: TriggerEvent2D): void {
    this.entries.push({
      kind,
      self: event.self.name,
      other: event.other?.name ?? "-",
      hasCollider: event.otherCollider !== null,
    });
  }
}

/** Records every collision callback it receives. */
class CollisionLog extends Script implements ScriptCallbacks {
  static typeId = "test/CollisionLog2D";

  /** Everything this script saw, in delivery order. */
  readonly entries: Entry[] = [];

  /** The impulse of the first `onCollisionEnter`. */
  firstImpulse = 0;

  /** The normal of the first `onCollisionEnter`. */
  firstNormalY = 0;

  /** The relative speed of the first `onCollisionEnter`. */
  firstRelativeY = 0;

  onCollisionEnter(collision: unknown): void {
    const event = collision as Collision2D;
    if (this.entries.length === 0) {
      this.firstImpulse = event.contacts[0]?.impulse ?? 0;
      this.firstNormalY = event.contacts[0]?.normal.y ?? 0;
      this.firstRelativeY = event.relativeVelocity.y;
    }
    this.#record("enter", event);
  }

  onCollisionStay(collision: unknown): void {
    this.#record("stay", collision as Collision2D);
  }

  onCollisionExit(collision: unknown): void {
    this.#record("exit", collision as Collision2D);
  }

  #record(kind: string, event: Collision2D): void {
    this.entries.push({
      kind,
      self: event.self.name,
      other: event.other?.name ?? "-",
      hasCollider: event.otherCollider !== null,
    });
  }
}

/** A script that implements nothing, so `collisionEvents: "auto"` stays off for its entity. */
class Silent extends Script {
  static typeId = "test/Silent2D";
}

describe("2D trigger events", () => {
  it("delivers enter and exit to both entities with both identities", async () => {
    const harness = await createPhysics2DApp();
    try {
      const zone = harness.world.createEntity("Zone");
      zone.transform.position = { x: 0, y: 3, z: 0 };
      zone.addComponent(BoxCollider2D, { size: { x: 4, y: 1 }, isTrigger: true });
      const zoneLog = zone.addComponent(TriggerLog);

      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 6, z: 0 };
      box.addComponent(BoxCollider2D);
      box.addComponent(Rigidbody2D, { interpolation: "none" });
      const boxLog = box.addComponent(TriggerLog);

      harness.stepMany(90);

      expect(zoneLog.entries.map((entry) => entry.kind)).toEqual(["enter", "exit"]);
      expect(boxLog.entries.map((entry) => entry.kind)).toEqual(["enter", "exit"]);
      expect(zoneLog.entries[0]?.other).toBe("Box");
      expect(boxLog.entries[0]?.other).toBe("Zone");
      expect(zoneLog.entries[0]?.hasCollider).toBe(true);
      expect(boxLog.entries[0]?.hasCollider).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it("raises a trigger between a kinematic body and a static sensor", async () => {
    const harness = await createPhysics2DApp();
    try {
      const zone = harness.world.createEntity("Zone");
      zone.transform.position = { x: 2, y: 0, z: 0 };
      zone.addComponent(BoxCollider2D, { size: { x: 1, y: 1 }, isTrigger: true });
      const zoneLog = zone.addComponent(TriggerLog);

      const mover = harness.world.createEntity("Mover");
      mover.transform.position = { x: -2, y: 0, z: 0 };
      mover.addComponent(BoxCollider2D, { size: { x: 0.5, y: 0.5 } });
      mover.addComponent(Rigidbody2D, { bodyType: "kinematic", interpolation: "none" });

      for (let index = 0; index < 120; index += 1) {
        mover.transform.position = { x: -2 + index * 0.05, y: 0, z: 0 };
        harness.step();
      }
      expect(zoneLog.entries.map((entry) => entry.kind)).toEqual(["enter", "exit"]);
      expect(zoneLog.entries[0]?.other).toBe("Mover");
    } finally {
      harness.dispose();
    }
  });
});

describe("2D collision events", () => {
  it("delivers enter, stay, and exit with contacts and identities on both sides", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      const floorLog = floor.addComponent(CollisionLog);

      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 3, z: 0 };
      ball.addComponent(BoxCollider2D);
      ball.addComponent(Rigidbody2D, { interpolation: "none" });
      const ballLog = ball.addComponent(CollisionLog);

      harness.stepMany(120);

      const kinds = new Set(ballLog.entries.map((entry) => entry.kind));
      expect(kinds.has("enter")).toBe(true);
      expect(kinds.has("stay")).toBe(true);
      expect(ballLog.entries[0]?.other).toBe("Floor");
      expect(ballLog.entries[0]?.hasCollider).toBe(true);
      expect(floorLog.entries[0]?.other).toBe("Ball");
      expect(ballLog.firstNormalY).not.toBe(0);
      expect(ballLog.firstRelativeY).toBeLessThan(0);
    } finally {
      harness.dispose();
    }
  });

  it("reports an exit when the contact ends", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 4, y: 1 } });

      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 2, z: 0 };
      ball.addComponent(BoxCollider2D);
      const rigidbody = ball.addComponent(Rigidbody2D, { interpolation: "none" });
      const log = ball.addComponent(CollisionLog);

      harness.stepMany(60);
      expect(log.entries.some((entry) => entry.kind === "enter")).toBe(true);
      rigidbody.linearVelocity = { x: 0, y: 12 };
      harness.stepMany(40);
      expect(log.entries.some((entry) => entry.kind === "exit")).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it("turns collision events on only for entities whose scripts implement them", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
      floor.addComponent(Silent);

      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 3, z: 0 };
      ball.addComponent(BoxCollider2D);
      ball.addComponent(Rigidbody2D, { interpolation: "none" });
      const log = ball.addComponent(CollisionLog);

      harness.stepMany(120);
      // The ball's script implements the callbacks, so it hears the contact; the floor's does not
      // and receives nothing, even though it took part in the same pair.
      expect(log.entries.length).toBeGreaterThan(0);
      expect(log.entries.every((entry) => entry.self === "Ball")).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it("honours an explicit collisionEvents: off", async () => {
    const harness = await createPhysics2DApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.transform.position = { x: 0, y: -0.5, z: 0 };
      floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });

      const ball = harness.world.createEntity("Ball");
      ball.transform.position = { x: 0, y: 3, z: 0 };
      ball.addComponent(BoxCollider2D);
      ball.addComponent(Rigidbody2D, { interpolation: "none", collisionEvents: "off" });
      const log = ball.addComponent(CollisionLog);

      harness.stepMany(120);
      expect(log.entries).toEqual([]);
    } finally {
      harness.dispose();
    }
  });
});
