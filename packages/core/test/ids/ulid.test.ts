import { describe, expect, it } from "vitest";
import { createSeededRandom, type RandomSource } from "../../src/ids/random-source.js";
import { createUlidFactory, generateUlid, isUlid, MAX_ULID_TIME_MS } from "../../src/ids/ulid.js";

/** A random source that writes the same byte everywhere, so encodings are predictable. */
function createConstantRandom(byte: number): RandomSource {
  return {
    fillBytes(bytes: Uint8Array<ArrayBuffer>): void {
      bytes.fill(byte);
    },
  };
}

/** A clock stuck at one instant. */
function createFrozenClock(timeMs: number): () => number {
  return () => timeMs;
}

describe("generateUlid", () => {
  it("produces twenty-six Crockford base32 characters", () => {
    const uid = generateUlid(createSeededRandom(1), createFrozenClock(0));
    expect(uid).toHaveLength(26);
    expect(isUlid(uid)).toBe(true);
  });

  it("encodes the timestamp in the first ten characters", () => {
    const uid = generateUlid(createConstantRandom(0), createFrozenClock(0));
    expect(uid.slice(0, 10)).toBe("0000000000");
  });

  it("encodes a known timestamp the way the ULID specification does", () => {
    // 1469918176385 is the timestamp of the canonical example 01ARYZ6S41…
    const uid = generateUlid(createConstantRandom(0), createFrozenClock(1_469_918_176_385));
    expect(uid.slice(0, 10)).toBe("01ARYZ6S41");
  });

  it("encodes the randomness in the last sixteen characters", () => {
    const uid = generateUlid(createConstantRandom(0xff), createFrozenClock(0));
    expect(uid.slice(10)).toBe("ZZZZZZZZZZZZZZZZ");
  });

  it("sorts lexicographically by time", () => {
    const random = createConstantRandom(0);
    const earlier = generateUlid(random, createFrozenClock(1000));
    const later = generateUlid(random, createFrozenClock(2000));
    expect(earlier < later).toBe(true);
  });

  it("draws fresh randomness on every call", () => {
    const random = createSeededRandom(5);
    const clock = createFrozenClock(1000);
    expect(generateUlid(random, clock)).not.toBe(generateUlid(random, clock));
  });

  it("uses the host clock and Web Crypto by default", () => {
    expect(isUlid(generateUlid())).toBe(true);
  });

  it("clamps a timestamp beyond the forty-eight bit range", () => {
    const uid = generateUlid(createConstantRandom(0), createFrozenClock(MAX_ULID_TIME_MS + 1000));
    expect(uid.slice(0, 10)).toBe("7ZZZZZZZZZ");
  });

  it("treats a negative or non-finite clock reading as zero", () => {
    expect(generateUlid(createConstantRandom(0), createFrozenClock(-1)).slice(0, 10)).toBe("0000000000");
    expect(generateUlid(createConstantRandom(0), createFrozenClock(Number.NaN)).slice(0, 10)).toBe("0000000000");
  });
});

describe("createUlidFactory", () => {
  it("increments the randomness inside one millisecond so ids keep sorting", () => {
    const nextUid = createUlidFactory({ random: createConstantRandom(0), now: createFrozenClock(1000) });
    const first = nextUid();
    const second = nextUid();
    const third = nextUid();
    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
    expect(second.slice(10)).toBe("0000000000000001");
  });

  it("draws fresh randomness when the millisecond changes", () => {
    let timeMs = 1000;
    const nextUid = createUlidFactory({ random: createConstantRandom(3), now: () => timeMs });
    const first = nextUid();
    timeMs = 1001;
    const second = nextUid();
    expect(second.slice(10)).toBe(first.slice(10));
    expect(second.slice(0, 10)).not.toBe(first.slice(0, 10));
  });

  it("never goes backwards when the clock does", () => {
    let timeMs = 5000;
    const nextUid = createUlidFactory({ random: createConstantRandom(0), now: () => timeMs });
    const first = nextUid();
    timeMs = 1000;
    const second = nextUid();
    expect(first < second).toBe(true);
    expect(second.slice(0, 10)).toBe(first.slice(0, 10));
  });

  it("carries into the next byte when the low byte overflows", () => {
    const random: RandomSource = {
      fillBytes(bytes: Uint8Array<ArrayBuffer>): void {
        bytes.fill(0);
        bytes[bytes.length - 1] = 0xff;
      },
    };
    const nextUid = createUlidFactory({ random, now: createFrozenClock(1000) });
    const first = nextUid();
    const second = nextUid();
    expect(first.slice(10)).toBe("000000000000007Z");
    expect(second.slice(10)).toBe("0000000000000080");
    expect(first < second).toBe(true);
  });

  it("draws fresh randomness when the whole eighty-bit space overflows", () => {
    const nextUid = createUlidFactory({ random: createConstantRandom(0xff), now: createFrozenClock(1000) });
    const first = nextUid();
    const second = nextUid();
    expect(first.slice(10)).toBe("ZZZZZZZZZZZZZZZZ");
    expect(isUlid(second)).toBe(true);
  });

  it("holds its state in the closure so two factories are independent", () => {
    const options = { random: createConstantRandom(0), now: createFrozenClock(1000) };
    const first = createUlidFactory(options);
    const second = createUlidFactory(options);
    first();
    first();
    expect(second().slice(10)).toBe("0000000000000000");
  });

  it("produces unique, sorted ids across many calls in one millisecond", () => {
    const nextUid = createUlidFactory({ random: createSeededRandom(9), now: createFrozenClock(1234) });
    const uids: string[] = [];
    for (let index = 0; index < 1000; index += 1) {
      uids.push(nextUid());
    }
    expect(new Set(uids).size).toBe(1000);
    let previous = "";
    for (const uid of uids) {
      expect(previous < uid).toBe(true);
      previous = uid;
    }
  });

  it("uses Web Crypto and the host clock by default", () => {
    expect(isUlid(createUlidFactory()())).toBe(true);
  });
});

describe("isUlid", () => {
  it("accepts the canonical example", () => {
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAVX")).toBe(false);
  });

  it("rejects lowercase, which is not the canonical form", () => {
    expect(isUlid("01arz3ndektsv4rrffq69g5fav")).toBe(false);
  });

  it("rejects letters Crockford base32 leaves out", () => {
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAL")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAO")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAU")).toBe(false);
  });

  it("rejects a first character that would overflow the forty-eight bit timestamp", () => {
    expect(isUlid("8ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false);
    expect(isUlid("7ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(true);
  });
});
