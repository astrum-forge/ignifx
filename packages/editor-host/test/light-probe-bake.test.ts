import { readFileSync } from "node:fs";
import { MeshRenderer, Model, stringifySceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  BAKE_MAX_COEFFICIENT,
  BAKE_MAX_PROBES,
  BAKE_MAX_SKY,
  BAKE_MAX_UID_LENGTH,
  BAKE_PROGRESS_INTERVAL_MS,
  HostCapability,
  isBakeFailureData,
  isBakeLightProbesParams,
  isBakeLightProbesResult,
  isBakeProgressParams,
  isCancelBakeParams,
  isCancelBakeResult,
  LightProbeBakeMethod,
  LightProbeBakeNotification,
  RpcErrorCode,
  SceneNotification,
} from "../src/protocol/index.js";
import {
  answerCoefficients,
  bakeGridForVolume,
  ProgressThrottle,
  skyFromPreScaledHarmonics,
} from "../src/scene/light-probe-baker.js";
import { startLiveHost } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { App, SceneFile, SceneFileEntity } from "@ignifx/core";

/**
 * `bakeLightProbes` (`HostCapability.bakeLightProbes`): the scene host bakes a `LightProbeVolume`
 * over its live world — a plain mesh, a glTF model and a prefab instance's mesh — and answers the
 * `.probes.json` document, replaying `fixtures/host-0.3-bake-wire.json`. A headless host bakes on
 * the CPU like any other; the GPU half (models read from their drawn meshes, the environment's sky)
 * is core's browser test and `light-probe-bake.browser.test.ts`.
 */

/** The fixture's messages. */
const WIRE: Readonly<Record<string, unknown>> = (() => {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("fixtures/host-0.3-bake-wire.json", import.meta.url), "utf8"),
  );
  const messages: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "messages") : null;
  return typeof messages === "object" && messages !== null ? Object.fromEntries(Object.entries(messages)) : {};
})();

/**
 * One fixture message.
 *
 * @param name - Its name.
 * @returns The message.
 */
function wire(name: string): Received {
  const value = WIRE[name];
  if (typeof value !== "object" || value === null) {
    throw new Error(`The fixture has no message "${name}".`);
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * A member of a message, as a record.
 *
 * @param message - The message.
 * @param key - The member.
 * @returns It.
 */
function member(message: Received, key: string): Received {
  const value = message[key];
  return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

/** The fixture's volume. */
const VOLUME = "01M4ZEB9E0GG0Q6R22YXV3BK01";

/** The floor, which has a mesh and no volume. */
const FLOOR = "01M4ZEB9E0GG0Q6R22YXV3BK02";

/** A prefab whose root draws a unit box. */
const LAMP_PREFAB: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "Lamp",
  entities: [
    {
      uid: "01M4ZEB9E0GG0Q6R22YXV3BKP0",
      name: "Lamp",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [
        {
          uid: "01M4ZEB9E0GG0Q6R22YXV3BKP1",
          type: "ignifx/MeshRenderer",
          props: { mesh: { $asset: "meshes/ground.mesh.json" } },
        },
      ],
    },
  ],
};

/**
 * An entity record.
 *
 * @param uid - Its uid.
 * @param name - Its name.
 * @param position - Its position.
 * @param scale - Its scale.
 * @param rest - Components or an instance.
 * @returns The record.
 */
function entity(
  uid: string,
  name: string,
  position: [number, number, number],
  scale: [number, number, number],
  rest: Partial<SceneFileEntity>,
): SceneFileEntity {
  return { uid, name, parent: null, transform: { position, rotation: [0, 0, 0, 1], scale }, ...rest };
}

/** The level: a volume, a floor, a sun, a glTF model and a prefab instance with a mesh. */
const LEVEL: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "bake",
  entities: [
    entity(VOLUME, "Probes", [0, 1, 0], [4, 2, 4], {
      components: [{ uid: "01M4ZEB9E0GG0Q6R22YXV3BK11", type: "ignifx/LightProbeVolume", props: {} }],
    }),
    entity(FLOOR, "Floor", [0, 0, 0], [10, 0.1, 10], {
      components: [
        {
          uid: "01M4ZEB9E0GG0Q6R22YXV3BK12",
          type: "ignifx/MeshRenderer",
          props: {
            mesh: { $asset: "meshes/ground.mesh.json" },
            materials: [{ $asset: "materials/grass.material.json" }],
          },
        },
      ],
    }),
    entity("01M4ZEB9E0GG0Q6R22YXV3BK03", "Sun", [0, 5, 0], [1, 1, 1], {
      components: [
        {
          uid: "01M4ZEB9E0GG0Q6R22YXV3BK13",
          type: "ignifx/Light",
          props: { type: "hemispheric", intensity: 1, bakeMode: "baked" },
        },
      ],
    }),
    entity("01M4ZEB9E0GG0Q6R22YXV3BK04", "Player", [3, 1, 0], [1, 1, 1], {
      components: [
        { uid: "01M4ZEB9E0GG0Q6R22YXV3BK14", type: "ignifx/Model", props: { model: { $asset: "models/player.glb" } } },
      ],
    }),
    entity("01M4ZEB9E0GG0Q6R22YXV3BK05", "Lamp", [-3, 1, 0], [1, 1, 1], {
      instance: { scene: { $asset: "prefabs/lamp.prefab.json" }, overrides: [] },
    }),
  ],
};

let live: LiveHost | null = null;
let next = 100;

afterEach(async () => {
  await live?.dispose();
  live = null;
});

/**
 * Sends one request, with a fresh id.
 *
 * @param peer - The editor's end.
 * @param method - The method.
 * @param params - Its parameters.
 * @returns The answer.
 */
async function call(peer: Wire, method: string, params: unknown): Promise<Received> {
  next += 1;
  return peer.request({ jsonrpc: "2.0", id: next, method, params });
}

/**
 * Waits until a condition holds, while the live host pumps frames.
 *
 * @param condition - The condition.
 */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out.");
    }
    // oxlint-disable-next-line no-await-in-loop -- waiting for the pump, one tick at a time
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/**
 * Starts a headless host, opens {@link LEVEL} and waits until its meshes and model have loaded.
 *
 * @returns The app and the editor's end.
 */
async function opened(): Promise<{ readonly app: App; readonly peer: Wire }> {
  live = startLiveHost();
  live.setFile("prefabs/lamp.prefab.json", stringifySceneFile(LAMP_PREFAB));
  const peer = live.wire;
  const ready = await peer.request({
    jsonrpc: "2.0",
    id: 1,
    method: "hello",
    params: { editorVersion: "0.1.0", protocol: { major: 0, minor: 3 } },
  });
  expect(member(ready, "result")["capabilities"]).toContain(HostCapability.bakeLightProbes);
  live.release();
  const host = await live.host;
  await peer.notification(SceneNotification.schemasChanged);
  expect(await call(peer, "openScene", { file: LEVEL, address: "scenes/bake.scene.json" })).toHaveProperty(
    "result.entityCount",
  );
  const app = host.app;
  await until(
    () =>
      app.world.components(MeshRenderer).length === 2 &&
      app.world.components(MeshRenderer).every((renderer) => renderer.mesh?.state === "loaded") &&
      app.world.components(Model).every((model) => model.model?.state === "loaded"),
  );
  return { app, peer };
}

/**
 * A request for a slow bake (thousands of probes), to cancel while it runs.
 *
 * @param id - The request id.
 * @returns The request.
 */
function slowBake(id: number): Received {
  return {
    jsonrpc: "2.0",
    id,
    method: LightProbeBakeMethod.bakeLightProbes,
    params: { volume: VOLUME, counts: [16, 16, 16], rays: 1024 },
  };
}

/**
 * The failure part of an error answer, without its free-text message.
 *
 * @param message - The answer.
 * @returns Its id, code and data.
 */
function failure(message: Received): unknown {
  const error = member(message, "error");
  return { id: message["id"], code: error["code"], data: error["data"] };
}

/**
 * A world matrix with a scale and a translation.
 *
 * @param size - The scale.
 * @param at - The translation.
 * @returns The column-major matrix.
 */
function matrix(size: [number, number, number], at: [number, number, number]): number[] {
  return [size[0], 0, 0, 0, 0, size[1], 0, 0, 0, 0, size[2], 0, ...at, 1];
}

/**
 * Lite's irradiance polynomials `1, y, z, x, xy, yz, 3z²−1, zx, x²−y²`.
 *
 * @param x - The direction's X.
 * @param y - The direction's Y.
 * @param z - The direction's Z.
 * @returns The nine values.
 */
function polynomials(x: number, y: number, z: number): number[] {
  return [1, y, z, x, x * y, y * z, 3 * z * z - 1, z * x, x * x - y * y];
}

describe("the fixture", () => {
  it("passes the guards", () => {
    expect(isBakeLightProbesParams(wire("bakeLightProbes")["params"])).toBe(true);
    expect(isBakeProgressParams(wire("bakeProgress")["params"])).toBe(true);
    expect(isBakeLightProbesResult(wire("bakeLightProbesResult")["result"])).toBe(true);
    expect(isCancelBakeResult(wire("cancelBakeResult")["result"])).toBe(true);
    for (const name of [
      "bakeCancelled",
      "bakeCancelledBySceneChange",
      "bakeBusy",
      "bakeUnknownEntity",
      "bakeNotAVolume",
      "bakeInvalidGrid",
    ]) {
      expect(isBakeFailureData(member(wire(name), "error")["data"])).toBe(true);
    }
  });

  it("refuses malformed parameters", () => {
    const base = { volume: VOLUME };
    expect(isBakeLightProbesParams(base)).toBe(true);
    expect(isBakeLightProbesParams({ ...base, counts: [1, 1, 1], spacing: 2 })).toBe(false);
    expect(isBakeLightProbesParams({ ...base, counts: [0, 1, 1] })).toBe(false);
    // Whole counts from 1 pass the guard; the host refuses a grid over the limits as `invalidGrid`.
    expect(isBakeLightProbesParams({ ...base, counts: [1025, 1, 1] })).toBe(true);
    expect(isBakeLightProbesParams({ ...base, counts: [1.5, 1, 1] })).toBe(false);
    expect(isBakeLightProbesParams({ volume: "v".repeat(BAKE_MAX_UID_LENGTH + 1) })).toBe(false);
    expect(isBakeLightProbesParams({ ...base, sky: { r: BAKE_MAX_SKY * 10, g: 0, b: 0 } })).toBe(false);
    expect(
      isBakeLightProbesParams({ ...base, sky: { kind: "sh9", coefficients: Array.from({ length: 27 }, () => 1e300) } }),
    ).toBe(false);
    expect(isCancelBakeParams(undefined)).toBe(true);
    expect(isCancelBakeParams({})).toBe(true);
    expect(isCancelBakeParams({ volume: VOLUME })).toBe(false);
    expect(isBakeLightProbesParams({ ...base, spacing: 0.01 })).toBe(false);
    expect(isBakeLightProbesParams({ ...base, directLight: "both" })).toBe(false);
    expect(isBakeLightProbesParams({ ...base, rays: 0 })).toBe(false);
    expect(isBakeLightProbesParams({ ...base, maxDistance: 0 })).toBe(false);
    expect(isBakeLightProbesParams({ ...base, sky: null })).toBe(true);
    expect(isBakeLightProbesParams({ ...base, sky: { kind: "sh9", coefficients: [1] } })).toBe(false);
    expect(
      isBakeLightProbesParams({
        ...base,
        sky: {
          kind: "gradient",
          sky: { r: 1, g: 1, b: 1 },
          horizon: { r: 0, g: 0, b: 0 },
          ground: { r: 0, g: 0, b: 0 },
        },
      }),
    ).toBe(true);
    expect(isBakeLightProbesParams({ volume: "" })).toBe(false);
    expect(isBakeProgressParams({ volume: VOLUME, done: 2, total: 1 })).toBe(false);
  });
});

describe("bakeGridForVolume", () => {
  it("spreads probes face to face at most the spacing apart", () => {
    expect(bakeGridForVolume(matrix([4, 2, 0], [0, 1, 0]), { spacing: 2 })).toEqual({
      origin: { x: -2, y: 0, z: 0 },
      cellSize: { x: 2, y: 2, z: 1 },
      counts: { x: 3, y: 2, z: 1 },
    });
  });

  it("takes counts, one probe on an axis at the centre", () => {
    expect(bakeGridForVolume(matrix([4, 2, 6], [1, 1, 1]), { counts: [5, 1, 4] })).toEqual({
      origin: { x: -1, y: 1, z: -2 },
      cellSize: { x: 1, y: 1, z: 2 },
      counts: { x: 5, y: 1, z: 4 },
    });
  });

  it("refuses a grid the format cannot hold, and a transform that is not finite", () => {
    expect(bakeGridForVolume(matrix([10_000, 1, 1], [0, 0, 0]), { spacing: 1 })).toHaveProperty("problem");
    expect(bakeGridForVolume(matrix([100, 100, 100], [0, 0, 0]), { spacing: 1 })).toHaveProperty("problem");
    expect(bakeGridForVolume(matrix([1, 1, 1], [Number.NaN, 0, 0]), {})).toHaveProperty("problem");
    expect(BAKE_MAX_PROBES).toBe(16_384);
  });
});

describe("answerCoefficients", () => {
  it("rounds to six significant digits and drops what is below 1e-6", () => {
    expect(answerCoefficients([0.123_456_789, -1.234_567_89e-7, 12_345_678.9, -0])).toEqual([
      0.123_457, 0, 12_345_700, 0,
    ]);
  });

  it("refuses a coefficient that is not finite or out of range", () => {
    expect(answerCoefficients([1, Number.NaN])).toBeNull();
    expect(answerCoefficients([Number.POSITIVE_INFINITY])).toBeNull();
    expect(answerCoefficients([BAKE_MAX_COEFFICIENT * 2])).toBeNull();
  });

  it("keeps the largest document under 4 MiB", () => {
    // The longest a rounded coefficient can print, a comma included, times every coefficient.
    const longest = Math.max(
      JSON.stringify(-999_999_000_000).length,
      JSON.stringify(-0.000_012_345_7).length,
      JSON.stringify(-1.234_57e-6).length,
    );
    expect((longest + 1) * 12 * BAKE_MAX_PROBES).toBeLessThan(4 * 1024 * 1024 - 1024);
  });
});

describe("ProgressThrottle", () => {
  it("lets one report through per interval, the first at once", () => {
    let now = 0;
    const seen: number[] = [];
    const throttle = new ProgressThrottle(
      BAKE_PROGRESS_INTERVAL_MS,
      () => now,
      (done) => {
        seen.push(done);
      },
    );
    for (let done = 1; done <= 100; done += 1) {
      now = done * 7;
      throttle.report(done, 100);
    }
    // 700 ms of reports at 100 ms apart at most: the first, then one per interval.
    expect(seen[0]).toBe(1);
    expect(seen.length).toBeLessThanOrEqual(Math.ceil(700 / BAKE_PROGRESS_INTERVAL_MS) + 1);
    for (let index = 1; index < seen.length; index += 1) {
      expect(((seen[index] ?? 0) - (seen[index - 1] ?? 0)) * 7).toBeGreaterThanOrEqual(BAKE_PROGRESS_INTERVAL_MS);
    }
  });
});

describe("skyFromPreScaledHarmonics", () => {
  /** The real SH basis constants. */
  const basis = [0.282_095, 0.488_603, 0.488_603, 0.488_603, 1.092_548, 1.092_548, 0.315_392, 1.092_548, 0.546_274];
  /** The cosine convolution over π, per term. */
  const lambert = [1, 2 / 3, 2 / 3, 2 / 3, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4];

  it("bakes a uniform environment to its own radiance", () => {
    const preScaled = Array.from({ length: 36 }, (_, index) => (index < 3 ? 0.5 : 0));
    const sky = skyFromPreScaledHarmonics(preScaled, 0);
    expect(sky?.coefficients[0]).toBeCloseTo(0.5 / basis[0]!, 4);
    // A uniform radiance L projects to `L / Y00` on the first term: the bake reads it back as L.
    expect((sky?.coefficients[0] ?? 0) * basis[0]!).toBeCloseTo(0.5, 4);
  });

  it("folds the environment's rotation in, as Lite's shader rotates the normal", () => {
    const preScaled = Array.from({ length: 36 }, (_, index) => (index % 4 === 3 ? 0 : Math.sin(index * 1.7) + 0.2));
    const angle = 0.7;
    const sky = skyFromPreScaledHarmonics(preScaled, angle);
    expect(sky).not.toBeNull();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let sample = 0; sample < 20; sample += 1) {
      const y = 1 - (2 * (sample + 0.5)) / 20;
      const r = Math.sqrt(1 - y * y);
      const x = Math.cos(sample * 2.4) * r;
      const z = Math.sin(sample * 2.4) * r;
      // What Lite's shader shows for a white surface facing (x, y, z).
      const shader = polynomials(x * c + z * s, y, -x * s + z * c);
      const world = polynomials(x, y, z);
      for (let channel = 0; channel < 3; channel += 1) {
        const expected = shader.reduce((sum, b, term) => sum + (preScaled[term * 4 + channel] ?? 0) * b, 0);
        // The same surface lit by the bake's sky, convolved band by band.
        const actual = world.reduce(
          (sum, b, term) => sum + (sky?.coefficients[term * 3 + channel] ?? 0) * basis[term]! * lambert[term]! * b,
          0,
        );
        expect(actual).toBeCloseTo(expected, 3);
      }
    }
  });

  it("refuses harmonics that are too short", () => {
    expect(skyFromPreScaledHarmonics([1, 2, 3], 0)).toBeNull();
  });
});

describe("bakeLightProbes on a live host", () => {
  it("bakes the live world and answers the .probes.json document", async () => {
    const { peer } = await opened();
    const request = wire("bakeLightProbes");
    const answer = await peer.request(request);
    const expected = wire("bakeLightProbesResult");
    expect(answer["id"]).toBe(expected["id"]);
    const result = member(answer, "result");
    expect(isBakeLightProbesResult(result)).toBe(true);
    // The wire's shape, key order included; the numbers are the bake's own.
    expect(Object.keys(result)).toEqual(Object.keys(member(expected, "result")));
    const stats = member(result, "stats");
    expect(Object.keys(stats)).toEqual(Object.keys(member(member(expected, "result"), "stats")));
    // The floor's box, the glTF box and the prefab instance's box: 12 triangles each.
    expect(stats["triangles"]).toBe(36);
    expect(stats["probes"]).toBe(1);
    expect(result["skips"]).toEqual([]);
    expect(result["sky"]).toBe("request");
    const probes = member(result, "probes");
    expect(probes["format"]).toBe("ignifx-probes");
    expect(probes["origin"]).toEqual({ x: 0, y: 1, z: 0 });
    expect(probes["coefficients"]).toHaveLength(12);
    const progress = await peer.notification(LightProbeBakeNotification.bakeProgress);
    expect(Object.keys(progress)).toEqual(Object.keys(wire("bakeProgress")));
    expect(progress["params"]).toEqual(member(wire("bakeProgress"), "params"));
  });

  it("answers unknownEntity and notAVolume", async () => {
    const { peer } = await opened();
    const unknown = await peer.request({
      jsonrpc: "2.0",
      id: 43,
      method: "bakeLightProbes",
      params: { volume: "01M4ZEB9E0GG0Q6R22YXV3BKZZ" },
    });
    expect(failure(unknown)).toEqual(failure(wire("bakeUnknownEntity")));
    const floor = await peer.request({ jsonrpc: "2.0", id: 44, method: "bakeLightProbes", params: { volume: FLOOR } });
    expect(failure(floor)).toEqual(failure(wire("bakeNotAVolume")));
    const wide = await peer.request({
      jsonrpc: "2.0",
      id: 45,
      method: "bakeLightProbes",
      params: { volume: VOLUME, counts: [1025, 1, 1] },
    });
    expect(failure(wide)).toEqual(failure(wire("bakeInvalidGrid")));
    expect(await call(peer, LightProbeBakeMethod.cancelBake, { volume: VOLUME })).toHaveProperty(
      "error.code",
      RpcErrorCode.invalidParams,
    );
  });

  it("answers busy while a bake runs, and cancels on cancelBake", async () => {
    const { peer } = await opened();
    peer.send(slowBake(40));
    peer.send(slowBake(42));
    expect(failure(await peer.answer(42))).toEqual(failure(wire("bakeBusy")));
    expect(await peer.request(wire("cancelBake"))).toEqual(wire("cancelBakeResult"));
    expect(failure(await peer.answer(40))).toEqual(failure(wire("bakeCancelled")));
    // Progress went out meanwhile, at most one per interval.
    const progress = peer.notifications.filter(
      (message) => message["method"] === LightProbeBakeNotification.bakeProgress,
    );
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((message) => isBakeProgressParams(message["params"]))).toBe(true);
    // Nothing runs now.
    expect(await call(peer, LightProbeBakeMethod.cancelBake, {})).toHaveProperty("result", { cancelled: false });
  });

  it("cancels a bake still waiting for its queue slot, without running it", async () => {
    const { peer } = await opened();
    // The reopen holds the queue while its assets load; the bake waits behind it.
    peer.send({
      jsonrpc: "2.0",
      id: 39,
      method: "openScene",
      params: { file: LEVEL, address: "scenes/bake.scene.json" },
    });
    peer.send(slowBake(40));
    expect(await peer.request(wire("cancelBake"))).toEqual(wire("cancelBakeResult"));
    expect(await peer.answer(39)).toHaveProperty("result");
    expect(failure(await peer.answer(40))).toEqual(failure(wire("bakeCancelled")));
    expect(peer.notifications.some((message) => message["method"] === LightProbeBakeNotification.bakeProgress)).toBe(
      false,
    );
  });

  it("cancels a bake when the document changes, and keeps answering meanwhile", async () => {
    const { peer } = await opened();
    peer.send(slowBake(40));
    const applied = await call(peer, "applyOps", {
      commandName: "Move",
      commandId: "move-1",
      ops: [
        {
          op: "setTransform",
          entity: FLOOR,
          after: { position: [0, -1, 0], rotation: [0, 0, 0, 1], scale: [10, 0.1, 10] },
        },
      ],
    });
    expect(applied).toHaveProperty("result.applied", 1);
    expect(failure(await peer.answer(40))).toEqual(failure(wire("bakeCancelledBySceneChange")));
  });
});
