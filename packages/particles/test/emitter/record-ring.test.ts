import { describe, expect, it } from "vitest";
import {
  isDead,
  RECORD_BYTES,
  RECORD_FLOATS,
  RECORD_LIFETIME,
  RECORD_POSITION,
  RECORD_ROTATION,
  RECORD_SEED,
  RECORD_SIZE,
  RECORD_SPAWN_TIME,
  RECORD_VELOCITY,
  SpawnRecordRing,
} from "../../src/emitter/record-ring.js";
import type { RingCensus, UploadRange } from "../../src/emitter/record-ring.js";

/**
 * Writes one record with recognisable values.
 *
 * @param ring - The ring.
 * @param spawnTime - The spawn clock.
 * @param lifetime - The lifetime, in seconds.
 * @param seed - The record seed.
 * @returns The slot written.
 */
function write(ring: SpawnRecordRing, spawnTime: number, lifetime: number, seed = 1): number {
  return ring.write(spawnTime, lifetime, seed, 0, 1, 2, 3, 0.5, 4, 5, 6, 0.25);
}

/** A fresh census object. */
function census(): RingCensus {
  return { alive: 0, drawCount: 0 };
}

/** A fresh pair of upload ranges. */
function ranges(): [UploadRange, UploadRange] {
  return [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];
}

describe("the record layout", () => {
  it("is 48 bytes with the offsets the WGSL struct declares", () => {
    expect(RECORD_FLOATS).toBe(12);
    expect(RECORD_BYTES).toBe(48);
    expect([RECORD_SPAWN_TIME, RECORD_LIFETIME, RECORD_SEED]).toEqual([0, 1, 2]);
    expect([RECORD_POSITION, RECORD_SIZE, RECORD_VELOCITY, RECORD_ROTATION]).toEqual([4, 7, 8, 11]);
  });
});

describe("a spawn-record ring", () => {
  it("writes every field of a record into its slot", () => {
    const ring = new SpawnRecordRing(4);
    expect(write(ring, 1.5, 2, 0xdead_beef)).toBe(0);
    expect(ring.floats[RECORD_SPAWN_TIME]).toBe(1.5);
    expect(ring.floats[RECORD_LIFETIME]).toBe(2);
    expect(ring.words[RECORD_SEED]).toBe(0xdead_beef);
    expect([...ring.floats.subarray(RECORD_POSITION, RECORD_POSITION + 3)]).toEqual([1, 2, 3]);
    expect(ring.floats[RECORD_SIZE]).toBe(0.5);
    expect([...ring.floats.subarray(RECORD_VELOCITY, RECORD_VELOCITY + 3)]).toEqual([4, 5, 6]);
    expect(ring.floats[RECORD_ROTATION]).toBe(0.25);
  });

  it("clamps a capacity below one to a single record", () => {
    expect(new SpawnRecordRing(0).capacity).toBe(1);
    expect(new SpawnRecordRing(-5).capacity).toBe(1);
  });

  it("wraps the head back to the start once it has written a full ring", () => {
    const ring = new SpawnRecordRing(3);
    expect([write(ring, 0, 1), write(ring, 0, 1), write(ring, 0, 1), write(ring, 0, 1)]).toEqual([0, 1, 2, 0]);
    expect(ring.written).toBe(4);
    expect(ring.head).toBe(1);
    expect(ring.slotOf(7)).toBe(1);
  });

  it("uploads one contiguous run when the writes did not wrap", () => {
    const ring = new SpawnRecordRing(8);
    write(ring, 0, 1);
    write(ring, 0, 1);
    const out = ranges();
    expect(ring.pendingCount).toBe(2);
    expect(ring.pendingRanges(out)).toBe(1);
    expect(out[0]).toMatchObject({ start: 0, count: 2 });
    ring.markUploaded();
    expect(ring.pendingRanges(out)).toBe(0);
  });

  it("uploads two runs when the writes wrapped the ring", () => {
    const ring = new SpawnRecordRing(4);
    for (let index = 0; index < 3; index += 1) {
      write(ring, 0, 1);
    }
    ring.markUploaded();
    for (let index = 0; index < 3; index += 1) {
      write(ring, 0, 1);
    }
    const out = ranges();
    expect(ring.pendingRanges(out)).toBe(2);
    expect(out[0]).toMatchObject({ start: 3, count: 1 });
    expect(out[1]).toMatchObject({ start: 0, count: 2 });
  });

  it("uploads the whole ring once more than a ring's worth is pending", () => {
    const ring = new SpawnRecordRing(4);
    for (let index = 0; index < 9; index += 1) {
      write(ring, 0, 1);
    }
    const out = ranges();
    expect(ring.pendingCount).toBe(4);
    expect(ring.pendingRanges(out)).toBe(1);
    expect(out[0]).toMatchObject({ start: 0, count: 4 });
  });

  it("counts only the records whose age is inside their lifetime", () => {
    const ring = new SpawnRecordRing(8);
    write(ring, 0, 1);
    write(ring, 0.5, 1);
    write(ring, 5, 1);
    const counted = ring.reconcile(1.2, census());
    expect(counted.alive).toBe(1);
    expect(counted.drawCount).toBe(2);
  });

  it("advances the tail past the leading dead records so the draw window shrinks", () => {
    const ring = new SpawnRecordRing(8);
    write(ring, 0, 1);
    write(ring, 0, 1);
    write(ring, 3, 1);
    const counted = ring.reconcile(3.5, census());
    expect(ring.tail).toBe(2);
    expect(counted.alive).toBe(1);
    expect(counted.drawCount).toBe(1);
  });

  it("keeps a dead record inside the window while a newer one is alive behind it", () => {
    const ring = new SpawnRecordRing(8);
    write(ring, 3, 1);
    write(ring, 0, 1);
    const counted = ring.reconcile(3.5, census());
    expect(counted.alive).toBe(1);
    expect(counted.drawCount).toBe(2);
  });

  it("never looks further back than one ring, however many records were written", () => {
    const ring = new SpawnRecordRing(4);
    for (let index = 0; index < 20; index += 1) {
      write(ring, index, 100);
    }
    const counted = ring.reconcile(19, census());
    expect(counted.drawCount).toBe(4);
    expect(counted.alive).toBe(4);
  });

  it("forgets every record on clear", () => {
    const ring = new SpawnRecordRing(4);
    write(ring, 0, 1);
    write(ring, 0, 1);
    ring.clear();
    expect(ring.written).toBe(0);
    expect(ring.head).toBe(0);
    expect(ring.tail).toBe(0);
    expect(ring.pendingCount).toBe(0);
    expect(ring.reconcile(0.5, census())).toMatchObject({ alive: 0, drawCount: 0 });
  });
});

describe("isDead", () => {
  it("is true before the spawn and after the lifetime, and false in between", () => {
    const ring = new SpawnRecordRing(1);
    write(ring, 1, 2);
    expect(isDead(ring.floats, 0, 0.5)).toBe(true);
    expect(isDead(ring.floats, 0, 1)).toBe(false);
    expect(isDead(ring.floats, 0, 3)).toBe(false);
    expect(isDead(ring.floats, 0, 3.01)).toBe(true);
  });

  it("is true for an untouched slot, whose lifetime is zero", () => {
    const ring = new SpawnRecordRing(2);
    expect(isDead(ring.floats, RECORD_FLOATS, 1)).toBe(true);
  });
});
