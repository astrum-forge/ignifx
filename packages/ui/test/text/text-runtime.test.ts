import { describe, expect, it } from "vitest";
import { TextRuntime } from "../../src/text/text-runtime.js";
import type { LiteTextLayer, LiteTextRenderer } from "../../src/lite/text.js";

/**
 * The text renderer's life (`docs/architecture/13-ui.md` §2, `07-rendering.md` §1). The renderer
 * operations are injected, so the whole of it runs under Node with recording doubles instead of a
 * device.
 */

/** What {@link createRuntime} records. */
interface Recorder {
  /** The runtime under test. */
  readonly runtime: TextRuntime;
  /** Every operation, in order. */
  readonly calls: string[];
  /** How many renderers were created. */
  created: () => number;
}

/**
 * Builds a runtime over recording doubles.
 *
 * @param headless - Whether the app has no renderer factory.
 * @returns The runtime and its recorder.
 */
function createRuntime(headless = false): Recorder {
  const calls: string[] = [];
  let created = 0;
  const runtime = new TextRuntime({
    createRenderer: headless
      ? null
      : (): LiteTextRenderer => {
          created += 1;
          calls.push("create");
          return { id: created } as unknown as LiteTextRenderer;
        },
    attachLayer: (_renderer: LiteTextRenderer, target: LiteTextLayer): void => {
      calls.push(`attach:${String(Reflect.get(target, "name"))}`);
    },
    detachLayer: (_renderer: LiteTextRenderer, target: LiteTextLayer): boolean => {
      calls.push(`detach:${String(Reflect.get(target, "name"))}`);
      return true;
    },
    destroyRenderer: (): void => {
      calls.push("destroy");
    },
  });
  return { runtime, calls, created: (): number => created };
}

/**
 * Builds a layer stand-in with a name to record.
 *
 * @param name - The name.
 * @returns The layer.
 */
function layer(name: string): LiteTextLayer {
  return { name } as unknown as LiteTextLayer;
}

describe("TextRuntime", () => {
  it("creates the renderer once, on the first ensure", () => {
    const { runtime, created } = createRuntime();
    runtime.ensureRenderer();
    runtime.ensureRenderer();
    expect(created()).toBe(1);
    expect(runtime.renderer).not.toBeNull();
  });

  it("holds layers registered before the renderer exists and flushes them", () => {
    const { runtime, calls } = createRuntime();
    runtime.addLayer(layer("a"));
    runtime.addLayer(layer("b"));
    expect(runtime.layerCount).toBe(2);
    expect(calls).toEqual([]);
    runtime.ensureRenderer();
    expect(calls).toEqual(["create", "attach:a", "attach:b"]);
  });

  it("attaches a layer added after the renderer exists straight away", () => {
    const { runtime, calls } = createRuntime();
    runtime.ensureRenderer();
    runtime.addLayer(layer("a"));
    expect(calls).toEqual(["create", "attach:a"]);
  });

  it("ignores a layer that is already registered", () => {
    const { runtime, calls } = createRuntime();
    const only = layer("a");
    runtime.ensureRenderer();
    runtime.addLayer(only);
    runtime.addLayer(only);
    expect(calls.filter((call) => call === "attach:a")).toHaveLength(1);
    expect(runtime.layerCount).toBe(1);
  });

  it("detaches a layer that was attached, and ignores one that was not", () => {
    const { runtime, calls } = createRuntime();
    const only = layer("a");
    runtime.ensureRenderer();
    runtime.addLayer(only);
    runtime.removeLayer(only);
    runtime.removeLayer(only);
    runtime.removeLayer(layer("never"));
    expect(calls).toEqual(["create", "attach:a", "detach:a"]);
    expect(runtime.layerCount).toBe(0);
  });

  it("drops a pending layer without touching the renderer", () => {
    const { runtime, calls } = createRuntime();
    const only = layer("a");
    runtime.addLayer(only);
    runtime.removeLayer(only);
    runtime.ensureRenderer();
    expect(calls).toEqual(["create"]);
  });

  it("creates nothing under a headless app but still accepts layers", () => {
    const { runtime, calls } = createRuntime(true);
    runtime.ensureRenderer();
    runtime.addLayer(layer("a"));
    runtime.removeLayer(layer("a"));
    expect(runtime.renderer).toBeNull();
    expect(calls).toEqual([]);
  });

  it("destroys the renderer once and refuses to build another", () => {
    const { runtime, calls } = createRuntime();
    runtime.ensureRenderer();
    runtime.dispose();
    runtime.dispose();
    runtime.ensureRenderer();
    runtime.addLayer(layer("a"));
    expect(calls).toEqual(["create", "destroy"]);
    expect(runtime.layerCount).toBe(0);
  });
});
