import { describe, expect, expectTypeOf, it } from "vitest";
import { defineExtension } from "../../src/index.js";
import type { Extension } from "../../src/index.js";

/**
 * `defineExtension` (`docs/architecture/04-extensions.md` §1): the returned factory may be called
 * with or without options, and the wrapped factory sees exactly what the caller passed — `undefined`
 * when nothing was — so its parameter is typed `O | undefined` rather than asserted to be `O`.
 */

interface SpawnerOptions {
  readonly budget?: number;
}

function descriptor(name: string): Extension {
  return { name, version: "1.0.0", engine: ">=0.0.0", requires: ["@ignifx/core"], register(): void {} };
}

describe("defineExtension", () => {
  it("passes the caller's options through, and undefined when there were none", () => {
    const seen: (SpawnerOptions | undefined)[] = [];
    const spawner = defineExtension<SpawnerOptions>((options) => {
      seen.push(options);
      return descriptor("test/spawner");
    });
    spawner();
    spawner({ budget: 64 });
    expect(seen).toEqual([undefined, { budget: 64 }]);
  });

  it("types the factory's parameter as O | undefined, so a default parameter is the natural shape", () => {
    const spawner = defineExtension<SpawnerOptions>((options = {}) =>
      descriptor(`test/${String(options.budget ?? 32)}`),
    );
    expect(spawner().name).toBe("test/32");
    expect(spawner({ budget: 8 }).name).toBe("test/8");
    defineExtension<SpawnerOptions>((options) => {
      expectTypeOf(options).toEqualTypeOf<SpawnerOptions | undefined>();
      return descriptor("test/typed");
    });
  });

  it("defaults O to void for an extension without options", () => {
    const plain = defineExtension(() => descriptor("test/plain"));
    // Callable with no argument: that is what the `void` default buys.
    expect(plain().name).toBe("test/plain");
  });
});
