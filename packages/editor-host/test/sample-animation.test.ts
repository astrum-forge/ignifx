import { readFileSync } from "node:fs";
import { Component, IgnifxError } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { RpcErrorCode, SceneNotification } from "../src/protocol/index.js";
import { startLiveHost } from "./support/scene-project.js";
import type { Received } from "./support/editor.js";
import type { LiveHost, Wire } from "./support/scene-project.js";
import type { SceneFile } from "@ignifx/core";

/**
 * `sampleAnimation` through a live headless host (ADR-0028, amendment 2026-10-20), replaying the
 * 0.3 wire fixture's messages. The host depends on core only and calls `sample` on whatever
 * component is registered as `ignifx/Animator`, so a stand-in under that type id records the calls
 * here; `@ignifx/3d`'s own tests cover what `Animator.sample` does.
 */

/** The fixture's messages. */
const WIRE: Readonly<Record<string, unknown>> = (() => {
  const parsed: unknown = JSON.parse(readFileSync(new URL("fixtures/host-0.3-wire.json", import.meta.url), "utf8"));
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
 * Asserts a live message equals the fixture's, key order included.
 *
 * @param actual - What the host sent.
 * @param expected - The fixture's message.
 */
function expectWire(actual: Received, expected: unknown): void {
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

/** One call the stand-in received. */
interface SampleCall {
  readonly state: string;
  readonly normalizedTime: number;
  readonly options: unknown;
}

/** What the stand-in does next, and what it was asked. */
const standIn: { posed: boolean; error: Error | null; calls: SampleCall[] } = { posed: true, error: null, calls: [] };

/** A component registered under `@ignifx/3d`'s `Animator` type id, recording the host's calls. */
class StandInAnimator extends Component.define({}) {
  static typeId = "ignifx/Animator";

  /**
   * Records the call and answers as {@link standIn} says.
   *
   * @param state - The state.
   * @param normalizedTime - The time.
   * @param options - The options, when the request had parameters.
   * @returns Whether the pose was written.
   */
  sample(state: string, normalizedTime: number, options?: unknown): boolean {
    standIn.calls.push({ state, normalizedTime, options });
    if (standIn.error !== null) {
      throw standIn.error;
    }
    return standIn.posed;
  }
}

/** The fixture's `Player`, the entity the fixture's requests sample. */
const PLAYER = "01M4ZEB9E0GG0Q6R22YXV3AVK8";

/**
 * The fixture's `openScene`, with the stand-in added to the player.
 *
 * @returns The request.
 */
function openSceneWithAnimator(): Received {
  const request = wire("openScene");
  const params = request["params"] as { readonly address: string; readonly file: SceneFile };
  const entities = params.file.entities.map((entity) =>
    entity.uid === PLAYER
      ? {
          ...entity,
          components: [
            ...(entity.components ?? []),
            { uid: "01M4ZEB9E0GG0Q6R22YXV3AVZZ", type: StandInAnimator.typeId, props: {} },
          ],
        }
      : entity,
  );
  return { ...request, params: { ...params, file: { ...params.file, entities } } };
}

describe("sampleAnimation through a live headless host", () => {
  let live: LiveHost | null = null;

  afterEach(async () => {
    await live?.dispose();
    live = null;
    standIn.posed = true;
    standIn.error = null;
    standIn.calls = [];
  });

  /**
   * Starts the host with the stand-in registered and runs the handshake.
   *
   * @returns The editor's end, once the app has started.
   */
  async function started(): Promise<Wire> {
    live = startLiveHost([StandInAnimator]);
    const peer = live.wire;
    await peer.request(wire("hello"));
    live.release();
    await live.host;
    await peer.notification(SceneNotification.schemasChanged);
    return peer;
  }

  it("needs an open scene, and an entity of it with an Animator", async () => {
    const peer = await started();
    expectWire(await peer.request(wire("sampleAnimation")), {
      ...wire("noScene"),
      id: wire("sampleAnimation")["id"],
      error: { code: RpcErrorCode.noScene, message: 'No scene is open; send "openScene" before "sampleAnimation".' },
    });

    await peer.request(wire("openScene"));
    expectWire(await peer.request(wire("sampleAnimation")), wire("sampleAnimationNoAnimator"));
    const stranger = await peer.request({
      ...wire("sampleAnimation"),
      params: { entity: "nope", state: "jump", normalizedTime: 0 },
    });
    expect(stranger["error"]).toMatchObject({ code: RpcErrorCode.invalidParams });
    expect(standIn.calls).toEqual([]);
  });

  it("calls Animator.sample with the request's state, time and parameters, and answers posed", async () => {
    const peer = await started();
    await peer.request(openSceneWithAnimator());

    expectWire(await peer.request(wire("sampleAnimation")), wire("sampleAnimationResponse"));
    standIn.posed = false;
    expectWire(await peer.request(wire("sampleAnimationBlend")), wire("sampleAnimationLoadingResponse"));
    expect(standIn.calls).toEqual([
      { state: "jump", normalizedTime: 0.5, options: undefined },
      { state: "locomotion", normalizedTime: 0.25, options: { parameters: { speed: 4 } } },
    ]);
  });

  it("refuses malformed params, and passes an engine refusal on with its code", async () => {
    const peer = await started();
    await peer.request(openSceneWithAnimator());
    const request = wire("sampleAnimation");
    const params = request["params"] as Record<string, unknown>;
    for (const bad of [
      { ...params, state: 3 },
      { ...params, normalizedTime: "half" },
      { ...params, parameters: { speed: "fast" } },
      { entity: PLAYER, state: "jump" },
    ]) {
      // The wire answers one request at a time; awaiting them in turn is the point.
      // oxlint-disable-next-line no-await-in-loop -- see above
      const answer = await peer.request({ ...request, params: bad });
      expect(answer["error"]).toMatchObject({ code: RpcErrorCode.invalidParams });
    }
    expect(standIn.calls).toEqual([]);

    // The error `@ignifx/3d`'s Animator throws for an undeclared state, built the same way.
    standIn.error = new IgnifxError("IGX-1202", "The animator declares no state named jump.", {
      context: { state: "jump" },
      hint: "Check the state names in the .animator.json document.",
    });
    expectWire(await peer.request(request), wire("sampleAnimationUnknownState"));
  });
});
