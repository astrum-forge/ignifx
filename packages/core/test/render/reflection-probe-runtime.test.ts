import { afterEach, describe, expect, it, vi } from "vitest";
import { createReflectionProbeRuntime } from "../../src/render/gpu/reflection-probes.js";
import type { LiteEngine, LiteScene } from "../../src/lite/scene.js";
import type { ReflectionProbe } from "../../src/render/reflection-probe.js";
import type { RenderingQualityPreset } from "../../src/render/rendering-settings.js";
import type { World } from "../../src/world/world.js";

/**
 * The reflection-probe runtime's bookkeeping (`src/render/gpu/reflection-probes.ts`) against a fake
 * Lite half: when cubes are freed, when frame work is skipped, and which capture requests survive.
 * The GPU half is mocked because the assertions are about ordering, not pixels.
 */

/** One fake GPU probe. */
interface FakeProbe {
  size: number;
  environment: object | null;
  /** Whether the last `capture` call asked for faces, so the next `resolve` creates the cube. */
  captured: boolean;
  disposedAfter: PromiseLike<unknown> | undefined | "not disposed";
  capture: () => boolean;
  resolve: () => boolean;
  dispose: (after?: PromiseLike<unknown>) => void;
}

const fakes: FakeProbe[] = [];
const materials: object[] = [];
const rebuilds: { resolve: () => void }[] = [];
/** The blended sets made, and what each was last assigned. */
const sets: { volumes: number; disposedAfter: PromiseLike<unknown> | undefined | "not disposed" }[] = [];
const assignments = new Map<object, unknown>();

vi.mock("../../src/lite/gpu/reflection-probe.js", () => ({
  enableReflectionProbes: (): Promise<void> => Promise.resolve(),
  createLiteReflectionProbe: (_engine: unknown, _scene: unknown, size: number): FakeProbe => {
    const fake: FakeProbe = {
      size,
      environment: null,
      captured: false,
      disposedAfter: "not disposed",
      capture(): boolean {
        fake.captured = true;
        return true;
      },
      resolve(): boolean {
        if (fake.captured && fake.environment === null) {
          fake.environment = {};
          return true;
        }
        return false;
      },
      dispose(after?: PromiseLike<unknown>): void {
        fake.disposedAfter = after;
      },
    };
    fakes.push(fake);
    return fake;
  },
  forEachReflectiveMesh: (
    _scene: unknown,
    visit: (material: object, x: number, y: number, z: number) => void,
  ): void => {
    for (const material of materials) {
      visit(material, 0, 0, 0);
    }
  },
  createLiteProbeSet: (_engine: unknown, _scene: unknown, volumes: readonly unknown[]): object => {
    const record: (typeof sets)[number] = { volumes: volumes.length, disposedAfter: "not disposed" };
    sets.push(record);
    return {
      set: record,
      dispose(after?: PromiseLike<unknown>): void {
        record.disposedAfter = after;
      },
    };
  },
  assignReflectionProbe: (scene: unknown, material: object, binding: unknown): Promise<void> | undefined => {
    assignments.set(material, binding);
    if (scene === null) {
      return undefined;
    }
    return new Promise<void>((resolve) => {
      rebuilds.push({ resolve });
    });
  },
}));

afterEach(() => {
  sets.length = 0;
  assignments.clear();
  fakes.length = 0;
  materials.length = 0;
  rebuilds.length = 0;
});

/**
 * A stand-in `ReflectionProbe` with only what the runtime reads.
 *
 * @param refreshMode - Its refresh mode.
 * @param name - Its entity's name.
 * @returns The probe and a way to queue a refresh.
 */
function fakeProbe(
  refreshMode: "once" | "everyFrame" | "onDemand",
  name = "Probe",
  blendDistance = 0,
): { probe: ReflectionProbe; refresh: () => void } {
  let wantsRefresh = false;
  const probe = {
    refreshMode,
    size: 64,
    near: 0.1,
    far: 100,
    boxProjection: blendDistance > 0 ? { x: 4, y: 4, z: 4 } : null,
    blendDistance,
    cullingMask: [],
    isEnabledInHierarchy: true,
    entity: { name, transform: { worldMatrix: new Float32Array(16) } },
    consumeRefreshRequest(): boolean {
      const wanted = wantsRefresh;
      wantsRefresh = false;
      return wanted;
    },
  };
  return {
    probe: probe as unknown as ReflectionProbe,
    refresh: (): void => {
      wantsRefresh = true;
    },
  };
}

const world = {} as World;
const engine = {} as LiteEngine;
const scene = {} as LiteScene;

/**
 * Whether a promise has settled, once the microtask queue drained.
 *
 * @param promise - The promise.
 * @returns `true` once it settled.
 */
async function hasSettled(promise: PromiseLike<unknown> | undefined): Promise<boolean> {
  let settled = false;
  void Promise.resolve(promise).then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  return settled;
}

describe("the reflection-probe runtime", () => {
  it("frees a retired cube only after rebuilds started in earlier frames settled too", async () => {
    const runtime = await createReflectionProbeRuntime(engine, scene, () => undefined);
    const { probe } = fakeProbe("once");
    materials.push({});
    // Captures.
    runtime.update(world, [probe], true, null, true);
    // Resolves; the material is assigned.
    runtime.update(world, [probe], true, null, true);
    expect(rebuilds).toHaveLength(1);
    // The probe is gone: the material goes back.
    runtime.update(world, [], true, null, true);
    expect(rebuilds).toHaveLength(2);
    const fake = fakes[0];
    expect(fake?.disposedAfter).not.toBe("not disposed");
    const after = fake?.disposedAfter as PromiseLike<unknown>;
    rebuilds[1]?.resolve();
    expect(await hasSettled(after)).toBe(false);
    rebuilds[0]?.resolve();
    expect(await hasSettled(after)).toBe(true);
    runtime.dispose();
  });

  it("does nothing between a device loss and the recovery", async () => {
    const runtime = await createReflectionProbeRuntime(engine, scene, () => undefined);
    const { probe } = fakeProbe("once");
    runtime.handleDeviceLost();
    runtime.update(world, [probe], true, null, true);
    expect(fakes).toHaveLength(0);
    runtime.handleDeviceRecovered();
    runtime.update(world, [probe], true, null, true);
    expect(fakes).toHaveLength(1);
    runtime.dispose();
  });

  it("names the entity in the everyFrame downgrade warning", async () => {
    const warnings: string[] = [];
    const runtime = await createReflectionProbeRuntime(engine, scene, (message) => {
      warnings.push(message);
    });
    const { probe } = fakeProbe("everyFrame", "Hall probe");
    const low = { reflectionProbeMaxSize: 64, reflectionProbeEveryFrame: false } as RenderingQualityPreset;
    runtime.update(world, [probe], true, low, true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"Hall probe"');
    expect(warnings[0]).not.toContain("{entity}");
    runtime.dispose();
  });

  it("keeps an onDemand refresh that the environment interrupted", async () => {
    const runtime = await createReflectionProbeRuntime(engine, scene, () => undefined);
    const { probe, refresh } = fakeProbe("onDemand");
    runtime.update(world, [probe], true, null, true);
    expect(fakes).toHaveLength(0);
    refresh();
    // The capture starts.
    runtime.update(world, [probe], true, null, true);
    expect(fakes).toHaveLength(1);
    // The environment goes before it resolved.
    runtime.update(world, [probe], true, null, false);
    // It comes back.
    runtime.update(world, [probe], true, null, true);
    expect(fakes).toHaveLength(2);
    runtime.dispose();
  });

  it("blends two box probes through one set once both captured, and frees a replaced set", async () => {
    const runtime = await createReflectionProbeRuntime(engine, scene, () => undefined);
    const first = fakeProbe("once", "A", 1);
    const second = fakeProbe("once", "B", 1);
    const material = {};
    materials.push(material);
    for (let frame = 0; frame < 30; frame += 1) {
      runtime.update(world, [first.probe, second.probe], true, null, true);
    }
    expect(sets).toHaveLength(1);
    expect(sets[0]?.volumes).toBe(2);
    expect((assignments.get(material) as { set: unknown }).set).toBe(sets[0]);
    // A refresh recaptures: the old set stays until the capture is done, then a new one replaces it.
    first.refresh();
    runtime.update(world, [first.probe, second.probe], true, null, true);
    expect(sets).toHaveLength(1);
    for (let frame = 0; frame < 30; frame += 1) {
      runtime.update(world, [first.probe, second.probe], true, null, true);
    }
    expect(sets).toHaveLength(2);
    expect(sets[0]?.disposedAfter).not.toBe("not disposed");
    expect((assignments.get(material) as { set: unknown }).set).toBe(sets[1]);
    // One probe left: no blending, the set goes.
    runtime.update(world, [second.probe], true, null, true);
    expect(sets[1]?.disposedAfter).not.toBe("not disposed");
    runtime.dispose();
  });

  it("keeps the nearest-probe choice when no probe has a blend distance", async () => {
    const runtime = await createReflectionProbeRuntime(engine, scene, () => undefined);
    const first = fakeProbe("once", "A");
    const second = fakeProbe("once", "B");
    materials.push({});
    for (let frame = 0; frame < 30; frame += 1) {
      runtime.update(world, [first.probe, second.probe], true, null, true);
    }
    expect(sets).toHaveLength(0);
    runtime.dispose();
  });

  it("does not rebuild the set while a blended probe moves, and builds one once it rests", async () => {
    const runtime = await createReflectionProbeRuntime(engine, scene, () => undefined);
    const first = fakeProbe("once", "A", 1);
    const second = fakeProbe("once", "B", 1);
    const material = {};
    materials.push(material);
    for (let frame = 0; frame < 30; frame += 1) {
      runtime.update(world, [first.probe, second.probe], true, null, true);
    }
    expect(sets).toHaveLength(1);
    const matrix = first.probe.entity.transform.worldMatrix as unknown as Float32Array;
    for (let frame = 0; frame < 20; frame += 1) {
      matrix[12] = frame * 0.1;
      runtime.update(world, [first.probe, second.probe], true, null, true);
    }
    // Moving: the set went and none was built; materials take the nearest probe.
    expect(sets).toHaveLength(1);
    expect(sets[0]?.disposedAfter).not.toBe("not disposed");
    expect(assignments.get(material)).not.toHaveProperty("set");
    for (let frame = 0; frame < 30; frame += 1) {
      runtime.update(world, [first.probe, second.probe], true, null, true);
    }
    expect(sets).toHaveLength(2);
    runtime.dispose();
  });
});
