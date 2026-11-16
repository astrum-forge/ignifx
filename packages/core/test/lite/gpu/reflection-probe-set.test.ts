import { describe, expect, it } from "vitest";
import { releaseLiteProbeSet } from "../../../src/lite/gpu/reflection-probe.js";

/**
 * Freeing a Babylon Lite probe set: Lite has no dispose for one, so ignifx destroys its three GPU
 * resources and takes its cleanup closure off `scene._disposables`, and a Lite change that renames
 * any of them must log, never throw.
 */

/**
 * A stand-in GPU resource that counts its `destroy` calls.
 *
 * @returns The resource.
 */
function resource(): { destroyed: number; destroy: () => void } {
  const created = {
    destroyed: 0,
    destroy(): void {
      created.destroyed += 1;
    },
  };
  return created;
}

/** Another closure on the scene's list, which must stay. */
function other(): void {
  // Nothing: only its identity matters.
}

/** The set's own cleanup closure. */
function cleanup(): void {
  // Nothing: only its identity matters.
}

/** Lite's field names, held as strings so the test reads them the way the code does. */
const TEXTURE = "_texture";
const UNIFORMS = "_uniformBuffer";
const GRID = "_gridBuffer";

describe("releaseLiteProbeSet", () => {
  it("destroys the three resources and removes the set's cleanup closure", () => {
    const texture = resource();
    const uniforms = resource();
    const grid = resource();
    const set = { [TEXTURE]: texture, [UNIFORMS]: uniforms, [GRID]: grid };
    const disposables: unknown[] = [other, cleanup];
    const warnings: string[] = [];
    releaseLiteProbeSet(set, disposables, cleanup, (message) => {
      warnings.push(message);
    });
    expect([texture.destroyed, uniforms.destroyed, grid.destroyed]).toEqual([1, 1, 1]);
    expect(disposables).toEqual([other]);
    expect(warnings).toEqual([]);
  });

  it("warns instead of throwing when a field or the closure is missing", () => {
    const texture = resource();
    const set = { [TEXTURE]: texture, [UNIFORMS]: { destroy: 3 } };
    const warnings: string[] = [];
    expect(() => {
      releaseLiteProbeSet(set, undefined, undefined, (message) => {
        warnings.push(message);
      });
    }).not.toThrow();
    expect(texture.destroyed).toBe(1);
    expect(warnings).toHaveLength(3);
    expect(warnings.join("\n")).toContain("_uniformBuffer");
    expect(warnings.join("\n")).toContain("_gridBuffer");
    expect(warnings.join("\n")).toContain("cleanup");
  });
});
