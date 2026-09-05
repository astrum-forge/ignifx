import { Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { BoxCollider } from "../../src/components/colliders.js";
import { Rigidbody } from "../../src/components/rigidbody.js";
import { createPhysicsApp } from "../support/harness.js";
import type { Collision, TriggerEvent } from "../../src/events.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * Trigger and collision events (`docs/architecture/09-physics.md` §4): who receives them, what they
 * carry, and in what order. Collisions run with `collisionIdentities: "internal"`, the ADR-0013
 * path, because `@babylonjs/lite@1.27.0` reports no body identities on the public one.
 */

/** One recorded delivery. */
interface Entry {
  /** Which callback fired. */
  readonly kind: string;
  /** The entity whose script received it. */
  readonly self: string;
  /** The other participant's name, or `"-"`. */
  readonly other: string;
}

/** Records every trigger callback it receives. */
class TriggerLog extends Script implements ScriptCallbacks {
  static typeId = "test/TriggerLog";

  /** Everything this script saw, in delivery order. */
  readonly entries: Entry[] = [];

  onTriggerEnter(trigger: unknown): void {
    this.#record("enter", trigger as TriggerEvent);
  }

  onTriggerExit(trigger: unknown): void {
    this.#record("exit", trigger as TriggerEvent);
  }

  #record(kind: string, event: TriggerEvent): void {
    this.entries.push({ kind, self: event.self.name, other: event.other?.name ?? "-" });
  }
}

/** Records every collision callback it receives. */
class CollisionLog extends Script implements ScriptCallbacks {
  static typeId = "test/CollisionLog";

  /** Everything this script saw, in delivery order. */
  readonly entries: Entry[] = [];

  /** The impulse of the first `onCollisionEnter`. */
  firstImpulse = 0;

  onCollisionEnter(collision: unknown): void {
    const event = collision as Collision;
    this.firstImpulse = this.entries.length === 0 ? (event.contacts[0]?.impulse ?? 0) : this.firstImpulse;
    this.#record("enter", event);
  }

  onCollisionStay(collision: unknown): void {
    this.#record("stay", collision as Collision);
  }

  onCollisionExit(collision: unknown): void {
    this.#record("exit", collision as Collision);
  }

  #record(kind: string, event: Collision): void {
    this.entries.push({ kind, self: event.self.name, other: event.other?.name ?? "-" });
  }
}

/** A script that implements nothing, so `collisionEvents: "auto"` stays off for its entity. */
class Silent extends Script {
  static typeId = "test/Silent";
}

describe("trigger events", () => {
  it("delivers enter and exit to both entities with the other resolved", async () => {
    const harness = await createPhysicsApp();
    try {
      const zone = harness.world.createEntity("Zone");
      zone.transform.position = { x: 0, y: 5, z: 0 };
      zone.addComponent(BoxCollider, { size: { x: 4, y: 1, z: 4 }, isTrigger: true });
      const zoneLog = zone.addComponent(TriggerLog);

      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 8, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      const boxLog = box.addComponent(TriggerLog);

      harness.stepMany(120);

      expect(zoneLog.entries.map((entry) => entry.kind)).toEqual(["enter", "exit"]);
      expect(boxLog.entries.map((entry) => entry.kind)).toEqual(["enter", "exit"]);
      expect(zoneLog.entries[0]).toEqual({ kind: "enter", self: "Zone", other: "Box" });
      expect(boxLog.entries[0]).toEqual({ kind: "enter", self: "Box", other: "Zone" });
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("counts the events in the physics diagnostics group", async () => {
    const harness = await createPhysicsApp();
    try {
      const zone = harness.world.createEntity("Zone");
      zone.transform.position = { x: 0, y: 5, z: 0 };
      zone.addComponent(BoxCollider, { size: { x: 4, y: 1, z: 4 }, isTrigger: true });
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 6, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });

      let total = 0;
      const group = harness.app.diagnostics.group("physics");
      const index = group?.index("triggerEvents") ?? 0;
      for (let step = 0; step < 60; step += 1) {
        harness.step();
        total += group?.get(index) ?? 0;
      }
      expect(total).toBeGreaterThan(0);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("collision events with collisionIdentities: internal", () => {
  it("delivers enter, stay, and exit to both entities", async () => {
    const harness = await createPhysicsApp({ collisionIdentities: "internal" });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });
      const floorLog = floor.addComponent(CollisionLog);

      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 2, z: 0 };
      box.addComponent(BoxCollider);
      const body = box.addComponent(Rigidbody, { interpolation: "none" });
      const boxLog = box.addComponent(CollisionLog);

      harness.stepMany(60);
      expect(kinds(boxLog)).toContain("enter");
      expect(kinds(boxLog)).toContain("stay");
      expect(kinds(floorLog)).toContain("enter");
      expect(boxLog.entries[0]?.other).toBe("Floor");
      expect(floorLog.entries[0]?.other).toBe("Box");
      expect(boxLog.firstImpulse).toBeGreaterThan(0);

      // Kick it off the floor: the contact ends and both sides are told.
      body.addImpulse({ x: 0, y: 30, z: 0 });
      harness.stepMany(20);
      expect(kinds(boxLog)).toContain("exit");
      expect(kinds(floorLog)).toContain("exit");
    } finally {
      harness.dispose();
    }
  }, 30_000);

  it("enables collision events only for entities whose scripts implement a callback", async () => {
    const harness = await createPhysicsApp({ collisionIdentities: "internal" });
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });

      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 2, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      box.addComponent(Silent);

      harness.stepMany(60);
      // Nothing on either entity implements a collision callback, so Havok was never asked to
      // report contacts for them at all.
      const group = harness.app.diagnostics.group("physics");
      expect(group?.get(group.index("collisionEvents"))).toBe(0);

      // Adding a script that *does* implement one flips `collisionEvents` on the next step, which
      // is `09-physics.md` §2.1's auto-detection through `ctx.entityImplements`.
      const log = box.addComponent(CollisionLog);
      harness.stepMany(20);
      expect(kinds(log).length).toBeGreaterThan(0);

      // Removing it turns the stream back off.
      const before = log.entries.length;
      box.removeComponent(log);
      harness.stepMany(20);
      expect(log.entries.length).toBe(before);
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

describe("collision events with the default upstream mode", () => {
  it("delivers contact data with no identity, which is what Lite 1.27.0 reports", async () => {
    const harness = await createPhysicsApp();
    try {
      const floor = harness.world.createEntity("Floor");
      floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });
      const box = harness.world.createEntity("Box");
      box.transform.position = { x: 0, y: 2, z: 0 };
      box.addComponent(BoxCollider);
      box.addComponent(Rigidbody, { interpolation: "none" });
      const log = box.addComponent(CollisionLog);

      harness.stepMany(60);
      // The timing is still right — enter arrives, then stay — but `other` is `null` (§4).
      expect(kinds(log)).toContain("enter");
      expect(kinds(log)).toContain("stay");
      expect(new Set(log.entries.map((entry) => entry.other))).toEqual(new Set(["-"]));
    } finally {
      harness.dispose();
    }
  }, 30_000);
});

/**
 * The callback names a log recorded, in order.
 *
 * @param log - The recording script.
 * @returns The kinds.
 */
function kinds(log: CollisionLog): readonly string[] {
  return log.entries.map((entry) => entry.kind);
}
