import { readFileSync } from "node:fs";
import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEngineVersion, startEditorHost } from "../src/host.js";
import { startEditorPlayControls } from "../src/play-controls.js";
import {
  HandshakeMethod,
  HostCapability,
  HostNotification,
  isEditorConnectMessage,
  isPlayState,
  isRpcMessage,
  PlayMethod,
  PROTOCOL_VERSION,
  protocolVersionIsCompatible,
  RpcErrorCode,
} from "../src/protocol/index.js";
import { EDITOR_ORIGIN, EditorPeer } from "./support/editor.js";
import { ENGINE_VERSION } from "./support/engine-version.js";
import type { Received } from "./support/editor.js";

/**
 * Wire compatibility with the editor. `fixtures/host-0.2-wire.json` is copied unchanged from the
 * editor repository (`packages/editor-protocol/test/fixtures/`), where `wire.test.ts` checks it
 * against `@ignifx/editor-protocol` 0.2. Protocol 0.3 keeps every one of its messages and changes
 * only the version they carry, so here every message in it goes through this package's guards, and
 * every response in it is produced by a live host from the matching request with the version
 * read as 0.3 (`asCurrent`). `wire-0.3.test.ts` replays the 0.3 fixture.
 */

/** The fixture file, parsed. */
const FIXTURE: unknown = JSON.parse(readFileSync(new URL("fixtures/host-0.2-wire.json", import.meta.url), "utf8"));

/**
 * Reads the fixture's `messages` object.
 *
 * @returns The messages by name.
 */
function fixtureMessages(): Readonly<Record<string, Received>> {
  if (typeof FIXTURE !== "object" || FIXTURE === null || !("messages" in FIXTURE)) {
    throw new Error("fixtures/host-0.2-wire.json has no messages object.");
  }
  const { messages } = FIXTURE;
  if (typeof messages !== "object" || messages === null) {
    throw new Error("fixtures/host-0.2-wire.json has no messages object.");
  }
  const entries: [string, Received][] = [];
  for (const [name, raw] of Object.entries(messages)) {
    const value: unknown = raw;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Fixture message "${name}" is not an object.`);
    }
    entries.push([name, Object.fromEntries(Object.entries(value))]);
  }
  return Object.fromEntries(entries);
}

const WIRE = fixtureMessages();

/**
 * What the live hosts below report, given {@link ENGINE_VERSION} as `engineVersion`: core's `VERSION`
 * when the build has stamped it, else that number. The fixture records whatever version the editor's
 * copy was made at, so responses are compared with this number in the place of the fixture's.
 */
const REPORTED_ENGINE_VERSION = resolveEngineVersion(ENGINE_VERSION);

/**
 * Reads one fixture message.
 *
 * @param name - Its name in the fixture.
 * @returns The message.
 */
function wire(name: string): Received {
  const message = WIRE[name];
  if (message === undefined) {
    throw new Error(`fixtures/host-0.2-wire.json has no message "${name}".`);
  }
  return message;
}

/** The protocol version the 0.2 fixture records. */
const FIXTURE_PROTOCOL = { major: 0, minor: 2 };

/**
 * Reads a fixture message as protocol 0.3 sends it: the same message with every protocol version
 * it carries replaced by {@link PROTOCOL_VERSION}.
 *
 * @param message - The fixture message.
 * @returns The message as this host's protocol line has it.
 */
function asCurrent(message: Received): Received {
  const text = JSON.stringify(message).replaceAll(JSON.stringify(FIXTURE_PROTOCOL), JSON.stringify(PROTOCOL_VERSION));
  return Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, unknown>));
}

/**
 * Reads an object member of a message.
 *
 * @param message - The message.
 * @param key - The member.
 * @returns The member, as a record.
 */
function member(message: Received, key: string): Received {
  const value = message[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Member "${key}" is not an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * Reads a fixture `ready` response with the engine version a live host reports.
 *
 * @param name - `readyScene` or `readyPlay`.
 * @returns The response, with {@link REPORTED_ENGINE_VERSION} as its `engineVersion`.
 */
function asReady(name: "readyScene" | "readyPlay"): Received {
  const ready = asCurrent(wire(name));
  const result = member(ready, "result");
  // `logRelay` and the scene host's `hotReloadDefaults` are additive in 0.3, so a current host lists
  // them after the fixture's capabilities.
  const additive =
    name === "readyScene" ? [HostCapability.logRelay, HostCapability.hotReloadDefaults] : [HostCapability.logRelay];
  const capabilities = [result["capabilities"], ...additive].flat();
  return { ...ready, result: { ...result, engineVersion: REPORTED_ENGINE_VERSION, capabilities } };
}

/**
 * Copies a fixture request under the id of the fixture response it should produce.
 *
 * @param request - The fixture request.
 * @param response - The fixture response whose id to use.
 * @returns The request with that id.
 */
function asRequestFor(request: Received, response: Received): Received {
  return { ...request, id: response["id"] };
}

/** Every fixture message the live hosts below produce or consume. */
const EXERCISED_LIVE = [
  "connect",
  "hello",
  "readyScene",
  "readyPlay",
  "incompatibleProtocol",
  "heartbeat",
  "ping",
  "pong",
  "playRequest",
  "playResponse",
  "pauseRequest",
  "pauseResponse",
  "stepRequest",
  "stepResponse",
  "stepRequestWithDelta",
  "stepResponseWithDelta",
  "stopRequest",
  "stopResponse",
  "stepInvalidParams",
  "notReady",
  "methodNotFound",
  "internalError",
  "invalidRequest",
];

const REQUEST_NAMES = [
  "hello",
  "ping",
  "playRequest",
  "pauseRequest",
  "stepRequest",
  "stepRequestWithDelta",
  "stopRequest",
];

const PLAY_RESPONSE_NAMES = ["playResponse", "pauseResponse", "stepResponse", "stepResponseWithDelta", "stopResponse"];

const cleanups: (() => void)[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/**
 * Hands a host a port with the fixture's connect message, exactly as recorded.
 *
 * @param target - The host's message target.
 * @returns The editor's end of the channel.
 */
function connectWithFixture(target: EventTarget): EditorPeer {
  const channel = new MessageChannel();
  target.dispatchEvent(
    new MessageEvent("message", { data: wire("connect"), origin: EDITOR_ORIGIN, ports: [channel.port2] }),
  );
  const peer = new EditorPeer(channel.port1);
  cleanups.push(() => {
    peer.close();
  });
  return peer;
}

/**
 * Posts a request and waits for the message that answers it, skipping heartbeats.
 *
 * @param peer - The editor's end.
 * @param request - The request, or any value to post.
 * @param id - The id of the expected answer.
 * @returns The answer.
 */
async function exchange(peer: EditorPeer, request: unknown, id: unknown): Promise<Received> {
  peer.post(request);
  for (;;) {
    // Messages arrive in order; awaiting them one at a time is the point.
    // oxlint-disable-next-line no-await-in-loop -- see above.
    const message = await peer.next();
    if (message["id"] === id) {
      return message;
    }
  }
}

/**
 * Asserts that a live message is the fixture message, key order included.
 *
 * @param actual - What the host sent.
 * @param expected - The fixture message.
 */
function expectWire(actual: Received, expected: Received): void {
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

/**
 * Asserts that a live play response matches the fixture's in everything but the frame count, which
 * depends on how many frames the game ran.
 *
 * @param actual - What the host sent.
 * @param expected - The fixture response.
 */
function expectPlayWire(actual: Received, expected: Received): void {
  const result = member(actual, "result");
  expect(isPlayState(result)).toBe(true);
  const frameCount = member(expected, "result")["frameCount"];
  expectWire({ ...actual, result: { ...result, frameCount } }, expected);
}

describe("the editor's 0.2 wire fixture, through the host's guards", () => {
  it("names every message a live host exercises below", () => {
    expect(Object.keys(WIRE).toSorted()).toEqual(EXERCISED_LIVE.toSorted());
  });

  it("accepts the connect message", () => {
    expect(isEditorConnectMessage(wire("connect"))).toBe(true);
    expect(isRpcMessage(wire("connect"))).toBe(false);
  });

  it.each(Object.keys(WIRE).filter((name) => name !== "connect"))("accepts %s as a JSON-RPC message", (name) => {
    expect(isRpcMessage(wire(name))).toBe(true);
    expect(isEditorConnectMessage(wire(name))).toBe(false);
  });

  it.each(PLAY_RESPONSE_NAMES)("accepts the play state in %s", (name) => {
    expect(isPlayState(wire(name)["result"])).toBe(true);
  });

  it.each(REQUEST_NAMES)("knows the method of %s", (name) => {
    const methods: readonly unknown[] = [...Object.values(HandshakeMethod), ...Object.values(PlayMethod)];
    expect(methods).toContain(wire(name)["method"]);
  });

  it("speaks the previous protocol line, with this package's capability names and notification", () => {
    const hello = member(wire("hello"), "params");
    expect(member(hello, "protocol")).toEqual(FIXTURE_PROTOCOL);
    expect(protocolVersionIsCompatible(PROTOCOL_VERSION, FIXTURE_PROTOCOL)).toBe(false);
    expect(member(member(asCurrent(wire("hello")), "params"), "protocol")).toEqual(PROTOCOL_VERSION);
    for (const name of ["readyScene", "readyPlay"]) {
      const result = member(wire(name), "result");
      expect(member(result, "protocol")).toEqual(FIXTURE_PROTOCOL);
      const capabilities: readonly unknown[] = Object.values(HostCapability);
      for (const capability of [result["capabilities"]].flat()) {
        expect(capabilities).toContain(capability);
      }
    }
    expect(wire("heartbeat")["method"]).toBe(HostNotification.heartbeat);
  });

  it("uses only declared error codes", () => {
    const codes: readonly unknown[] = Object.values(RpcErrorCode);
    for (const [name, message] of Object.entries(WIRE)) {
      if ("error" in message) {
        expect(codes, name).toContain(member(message, "error")["code"]);
      }
    }
  });
});

describe("the editor's 0.2 wire fixture, through a live scene host", () => {
  /**
   * Starts a headless scene host that reports the fixture's engine version.
   *
   * @param heartbeatIntervalMs - The heartbeat period.
   * @returns The host's message target.
   */
  async function sceneHost(heartbeatIntervalMs = 60_000): Promise<EventTarget> {
    const target = new EventTarget();
    const host = await startEditorHost({
      editorOrigin: EDITOR_ORIGIN,
      headless: true,
      messageTarget: target,
      engineVersion: ENGINE_VERSION,
      heartbeatIntervalMs,
    });
    cleanups.push(() => {
      host.dispose();
    });
    return target;
  }

  it("answers the fixture's requests with the fixture's responses", async () => {
    const peer = connectWithFixture(await sceneHost());

    expectWire(await exchange(peer, { hello: "world" }, null), wire("invalidRequest"));
    expectWire(await exchange(peer, wire("ping"), wire("pong")["id"]), wire("pong"));

    // The fixture records an editor one line older meeting the host (0.1 meeting 0.2); this host is
    // 0.3, so the request is the fixture's own 0.2 hello and the versions in the answer move up one.
    // The fixture still has the 0.1 host's last word ("majors"); since 0.2 the host says "versions",
    // because before 1.0 a minor mismatch is refused too. Those are the only differences.
    const oldHello = wire("hello");
    const refusal = wire("incompatibleProtocol");
    const refusalError = member(refusal, "error");
    const refusalMessage = refusalError["message"];
    expect(refusalMessage).toEqual(expect.stringContaining("speaks protocol 0.1 and this host speaks 0.2."));
    expect(refusalMessage).toEqual(expect.stringContaining("so the protocol majors match."));
    expectWire(await exchange(peer, oldHello, refusal["id"]), {
      ...refusal,
      error: {
        ...refusalError,
        message: String(refusalMessage)
          .replace("protocol 0.1 and this host speaks 0.2", "protocol 0.2 and this host speaks 0.3")
          .replace("protocol majors", "protocol versions"),
        data: { host: PROTOCOL_VERSION, engineVersion: REPORTED_ENGINE_VERSION },
      },
    });

    const hello = asCurrent(wire("hello"));
    expectWire(await exchange(peer, hello, hello["id"]), asReady("readyScene"));
    expectWire(
      await exchange(peer, asRequestFor(wire("playRequest"), wire("methodNotFound")), wire("methodNotFound")["id"]),
      wire("methodNotFound"),
    );
  });

  it("sends the fixture's heartbeat after ready", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const peer = connectWithFixture(await sceneHost(250));
    await exchange(peer, asCurrent(wire("hello")), wire("hello")["id"]);

    vi.advanceTimersByTime(250);
    expectWire(await peer.nextNotification("heartbeat"), wire("heartbeat"));
  });
});

describe("the editor's 0.2 wire fixture, through live play controls", () => {
  it("answers the fixture's requests with the fixture's responses", async () => {
    const app = await createApp({ headless: true });
    const target = new EventTarget();
    const controls = startEditorPlayControls(app, {
      editorOrigin: EDITOR_ORIGIN,
      messageTarget: target,
      engineVersion: ENGINE_VERSION,
      heartbeatIntervalMs: 60_000,
    });
    cleanups.push(() => {
      controls.dispose();
      app.dispose();
    });
    const peer = connectWithFixture(target);

    const notReady = wire("notReady");
    expectWire(await exchange(peer, asRequestFor(wire("playRequest"), notReady), notReady["id"]), notReady);

    const hello = asCurrent(wire("hello"));
    expectWire(await exchange(peer, hello, hello["id"]), asReady("readyPlay"));

    for (const [request, response] of [
      ["playRequest", "playResponse"],
      ["pauseRequest", "pauseResponse"],
      ["stepRequest", "stepResponse"],
      ["stepRequestWithDelta", "stepResponseWithDelta"],
      ["stopRequest", "stopResponse"],
    ] as const) {
      // Each method changes the game the next one acts on, so they run in order.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      expectPlayWire(await exchange(peer, wire(request), wire(request)["id"]), wire(response));
    }

    const invalid = wire("stepInvalidParams");
    const badStep = { ...wire("stepRequest"), id: invalid["id"], params: { deltaSeconds: -1 } };
    expectWire(await exchange(peer, badStep, invalid["id"]), invalid);

    const internal = wire("internalError");
    vi.spyOn(app, "start").mockRejectedValueOnce(new Error(String(member(internal, "error")["message"])));
    expectWire(await exchange(peer, asRequestFor(wire("playRequest"), internal), internal["id"]), internal);
  });
});
