import { describe, expect, it } from "vitest";
import { HandleAllocator } from "../../src/handles/handle-allocator.js";
import { INVALID_HANDLE, toComponentHandle, toEntityHandle } from "../../src/handles/handle.js";

/** `docs/architecture/00-overview.md` §5: dense handles with a generation check. */

describe("allocation", () => {
  it("never hands out the invalid handle", () => {
    const allocator = new HandleAllocator<string>();
    expect(allocator.get(INVALID_HANDLE)).toBeNull();
    expect(allocator.allocate("a")).not.toBe(INVALID_HANDLE);
  });

  it("resolves a live handle and counts live objects", () => {
    const allocator = new HandleAllocator<string>();
    const first = allocator.allocate("a");
    const second = allocator.allocate("b");
    expect(allocator.get(first)).toBe("a");
    expect(allocator.get(second)).toBe("b");
    expect(allocator.size).toBe(2);
    expect(allocator.isLive(first)).toBe(true);
  });

  it("reuses a freed slot instead of growing", () => {
    const allocator = new HandleAllocator<string>();
    const first = allocator.allocate("a");
    const capacity = allocator.capacity;
    allocator.release(first);
    allocator.allocate("b");
    expect(allocator.capacity).toBe(capacity);
    expect(allocator.size).toBe(1);
  });

  it("invalidates a stale handle after the slot is recycled", () => {
    const allocator = new HandleAllocator<string>();
    const stale = allocator.allocate("a");
    allocator.release(stale);
    const fresh = allocator.allocate("b");
    expect(fresh & 0xf_ff_ff).toBe(stale & 0xf_ff_ff);
    expect(fresh).not.toBe(stale);
    expect(allocator.get(stale)).toBeNull();
    expect(allocator.isLive(stale)).toBe(false);
    expect(allocator.get(fresh)).toBe("b");
  });

  it("reports a double release and an unknown handle as failures", () => {
    const allocator = new HandleAllocator<string>();
    const handle = allocator.allocate("a");
    expect(allocator.release(handle)).toBe(true);
    expect(allocator.release(handle)).toBe(false);
    expect(allocator.release(INVALID_HANDLE)).toBe(false);
    expect(allocator.release(0xff_ff_ff)).toBe(false);
    expect(allocator.get(0xff_ff_ff)).toBeNull();
    expect(allocator.isLive(0xff_ff_ff)).toBe(false);
  });

  it("reserves a slot before its value exists, which is what an entity's constructor needs", () => {
    const allocator = new HandleAllocator<string>();
    const handle = allocator.reserve();
    expect(allocator.get(handle)).toBeNull();
    expect(allocator.isLive(handle)).toBe(true);
    allocator.bind(handle, "a");
    expect(allocator.get(handle)).toBe("a");
  });

  it("ignores a bind for a stale handle", () => {
    const allocator = new HandleAllocator<string>();
    const stale = allocator.allocate("a");
    allocator.release(stale);
    allocator.bind(stale, "b");
    expect(allocator.get(stale)).toBeNull();
    allocator.bind(INVALID_HANDLE, "c");
    expect(allocator.get(INVALID_HANDLE)).toBeNull();
  });

  it("keeps every earlier handle stale across many reuse cycles", () => {
    const allocator = new HandleAllocator<number>();
    const seen: number[] = [];
    for (let round = 0; round < 100; round += 1) {
      const handle = allocator.allocate(round);
      seen.push(handle);
      allocator.release(handle);
    }
    for (const handle of seen.slice(0, -1)) {
      expect(allocator.get(handle)).toBeNull();
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("forgets everything on clear", () => {
    const allocator = new HandleAllocator<string>();
    const handle = allocator.allocate("a");
    allocator.clear();
    expect(allocator.size).toBe(0);
    expect(allocator.capacity).toBe(1);
    expect(allocator.get(handle)).toBeNull();
  });
});

describe("branding", () => {
  it("is the identity function at run time", () => {
    expect(toEntityHandle(42)).toBe(42);
    expect(toComponentHandle(42)).toBe(42);
  });
});
