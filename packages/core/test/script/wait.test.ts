import { describe, expect, it } from "vitest";
import { waitFixedUpdate, waitSeconds, waitSecondsRealtime, waitUntil, waitWhile } from "../../src/script/wait.js";
import { createTestWorld } from "../support/create-test-world.js";
import { RecordingScript } from "../support/recording-script.js";
import type { Coroutine } from "../../src/app/types.js";

/** `docs/architecture/01-lifecycle-and-time.md` §5 and ADR-0010. */

/** A predicate the wait factories can carry. */
const predicate = (): boolean => true;

// A coroutine that yields once, for the delegation assertions below.
function* emptyRoutine(): Coroutine {
  yield null;
}

describe("wait factories", () => {
  it("describes a scaled wait in seconds", () => {
    const instruction = waitSeconds(1.5);
    expect(instruction.kind).toBe("seconds");
    expect(instruction.seconds).toBe(1.5);
    expect(Object.isFrozen(instruction)).toBe(true);
  });

  it("describes an unscaled wait in seconds", () => {
    expect(waitSecondsRealtime(0.25)).toEqual({ kind: "secondsRealtime", seconds: 0.25 });
  });

  it("describes a wait for the next fixed step", () => {
    expect(waitFixedUpdate()).toEqual({ kind: "fixedUpdate" });
  });

  it("carries the predicate for waitUntil and waitWhile", () => {
    expect(waitUntil(predicate)).toEqual({ kind: "until", predicate });
    expect(waitWhile(predicate)).toEqual({ kind: "while", predicate });
  });

  it("allocates a new instruction per call, so a hoisted wait is the caller's choice", () => {
    expect(waitFixedUpdate()).not.toBe(waitFixedUpdate());
  });
});

describe("Script coroutine methods", () => {
  it("delegates start, stop, and stopAll to app.coroutines", () => {
    const harness = createTestWorld();
    const entity = harness.world.createEntity("entity");
    const script = entity.addComponent(RecordingScript, { label: "a" });
    const routine = emptyRoutine();
    const handle = script.startCoroutine(routine);
    expect(harness.coroutines.ofKind("start")[0]?.owner).toBe(script);
    script.stopCoroutine(handle);
    expect(harness.coroutines.ofKind("stop")).toHaveLength(1);
    script.stopAllCoroutines();
    expect(harness.coroutines.ofKind("stopAll")[0]?.owner).toBe(script);
    harness.dispose();
  });
});
