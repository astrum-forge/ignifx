import { describe, expect, it } from "vitest";
import { TagSet } from "../../src/tags/tag-set.js";
import { createTestWorld } from "../support/create-test-world.js";

/** `docs/architecture/02-scene-graph.md` §7. */

describe("a standalone tag set", () => {
  it("works without an observer", () => {
    const tags = new TagSet();
    tags.add("a");
    expect(tags.has("a")).toBe(true);
    expect(tags.delete("a")).toBe(true);
    expect(tags.size).toBe(0);
    tags.clear();
    expect(tags.size).toBe(0);
  });

  it("notifies its observer once per effective change", () => {
    const seen: string[] = [];
    const tags = new TagSet((tag, added) => seen.push(`${added ? "+" : "-"}${tag}`));
    tags.add("a");
    tags.add("a");
    tags.add("b");
    tags.delete("a");
    tags.delete("a");
    expect(seen).toEqual(["+a", "+b", "-a"]);
  });

  it("notifies the observer once per tag when cleared", () => {
    const seen: string[] = [];
    const tags = new TagSet((tag, added) => seen.push(`${added ? "+" : "-"}${tag}`));
    tags.add("a").add("b");
    seen.length = 0;
    tags.clear();
    expect(seen).toEqual(["-a", "-b"]);
    expect(tags.size).toBe(0);
  });
});

describe("the world's tag index", () => {
  it("keeps several tags on one entity independent", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    entity.tags.add("enemy").add("flying");
    expect(harness.world.findByTag("enemy")).toEqual([entity]);
    expect(harness.world.findByTag("flying")).toEqual([entity]);
    entity.tags.delete("flying");
    expect(harness.world.findByTag("flying")).toEqual([]);
    expect(harness.world.findByTag("enemy")).toEqual([entity]);
    harness.dispose();
  });

  it("removes every tag of a destroyed entity, whichever slot it sat in", () => {
    const harness = createTestWorld();
    const first = harness.world.createEntity("first");
    const second = harness.world.createEntity("second");
    const third = harness.world.createEntity("third");
    for (const entity of [first, second, third]) {
      entity.tags.add("enemy");
    }
    second.destroy();
    harness.flushDestroy();
    expect(harness.world.findByTag("enemy")).toHaveLength(2);
    expect(harness.world.findByTag("enemy")).not.toContain(second);
    third.destroy();
    harness.flushDestroy();
    expect(harness.world.findByTag("enemy")).toEqual([first]);
    harness.dispose();
  });

  it("ignores a delete of a tag the entity does not carry", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    expect(entity.tags.delete("never-added")).toBe(false);
    expect(harness.world.findByTag("never-added")).toEqual([]);
    harness.dispose();
  });
});
