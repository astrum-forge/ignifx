import { isIgnifxError, Script, VERSION } from "@ignifx/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEngineVersion, startEditorHost } from "../src/host.js";
import { JSON_RPC_VERSION, PROTOCOL_VERSION, RpcErrorCode } from "../src/protocol/index.js";
import { connect, CountingTarget, EDITOR_ORIGIN, flushMessages } from "./support/editor.js";
import type { EditorHost, EditorHostOptions } from "../src/host.js";
import type { EditorPeer } from "./support/editor.js";

/**
 * The scene view's host (`docs/architecture/17-editor-host.md` §4): a headless app from the
 * project's core, and the editor's channel to it over a `MessagePort`.
 */

/** The version the Vite plugin would read from the project's `@ignifx/core/package.json`. */
const PLUGIN_VERSION = "0.9.0";

/**
 * What a host given {@link PLUGIN_VERSION} reports: core's `VERSION` when the build has stamped it,
 * as it has whenever core resolves to `dist/`, so the tests do not depend on the release number.
 */
const REPORTED_VERSION = resolveEngineVersion(PLUGIN_VERSION);

const hosts: EditorHost[] = [];
const peers: EditorPeer[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) {
    host.dispose();
  }
  for (const peer of peers.splice(0)) {
    peer.close();
  }
});

/**
 * Starts a host that is expected to fail.
 *
 * @param options - The host options.
 * @returns The `IgnifxError` code it threw, the error itself if it was something else, or `null`.
 */
async function codeOf(options: EditorHostOptions): Promise<unknown> {
  try {
    hosts.push(await startEditorHost(options));
  } catch (error) {
    return isIgnifxError(error) ? error.code : error;
  }
  return null;
}

/**
 * Starts a headless host on a fresh message target.
 *
 * @param options - Options to add or override.
 * @returns The host and its target.
 */
async function startHost(options?: Partial<EditorHostOptions>): Promise<{ host: EditorHost; target: EventTarget }> {
  const target = new EventTarget();
  const host = await startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    headless: true,
    messageTarget: target,
    ...options,
  });
  hosts.push(host);
  return { host, target };
}

/**
 * Connects an editor peer and remembers it for cleanup.
 *
 * @param target - The host's target.
 * @param origin - The origin the connect message claims.
 * @returns The peer.
 */
function editor(target: EventTarget, origin?: string): EditorPeer {
  const peer = connect(target, origin);
  peers.push(peer);
  return peer;
}

describe("startEditorHost", () => {
  it("answers a compatible hello with ready", async () => {
    const { host, target } = await startHost({ engineVersion: PLUGIN_VERSION });
    const response = await editor(target).hello();

    expect(response).toEqual({
      jsonrpc: JSON_RPC_VERSION,
      id: 1,
      result: {
        engineVersion: REPORTED_VERSION,
        protocol: PROTOCOL_VERSION,
        capabilities: ["heartbeat"],
        hostKind: "scene",
      },
    });
    expect(host.isConnected).toBe(true);
    expect(host.app.isRunning).toBe(true);
  });

  it("refuses a hello from another protocol major", async () => {
    const { target } = await startHost();
    const response = await editor(target).hello({ major: PROTOCOL_VERSION.major + 1, minor: 0 });

    expect(response["error"]).toMatchObject({
      code: RpcErrorCode.incompatibleProtocol,
      data: { host: PROTOCOL_VERSION },
    });
  });

  it("refuses a hello from another protocol minor while the major is 0", async () => {
    const { target } = await startHost({ engineVersion: PLUGIN_VERSION });
    const response = await editor(target).hello({ major: 0, minor: 2 });

    expect(response["error"]).toEqual({
      code: RpcErrorCode.incompatibleProtocol,
      message:
        "The editor speaks protocol 0.2 and this host speaks 0.3. Update the editor, or the project's " +
        "@ignifx packages, so the protocol versions match.",
      data: { host: PROTOCOL_VERSION, engineVersion: REPORTED_VERSION },
    });
  });

  it("refuses a hello without an editor version and protocol", async () => {
    const { target } = await startHost();
    const response = await editor(target).request("hello", { protocol: { major: 0 } });

    expect(response["error"]).toMatchObject({ code: RpcErrorCode.invalidParams });
  });

  it("answers ping with pong, before and after the handshake", async () => {
    const { target } = await startHost();
    const peer = editor(target);

    expect((await peer.request("ping"))["result"]).toBe("pong");
    await peer.hello();
    expect((await peer.request("ping"))["result"]).toBe("pong");
  });

  it("refuses any other method with methodNotFound", async () => {
    const { target } = await startHost();
    const peer = editor(target);
    await peer.hello();

    const response = await peer.request("applyOps", { ops: [] });
    expect(response["error"]).toMatchObject({ code: RpcErrorCode.methodNotFound });
  });

  it("answers a message that is not JSON-RPC with invalidRequest and no id", async () => {
    const { target } = await startHost();
    const peer = editor(target);
    peer.post({ hello: "world" });

    expect(await peer.next()).toMatchObject({ id: null, error: { code: RpcErrorCode.invalidRequest } });
  });

  it("does not answer notifications or responses from the editor", async () => {
    const { target } = await startHost();
    const peer = editor(target);
    peer.post({ jsonrpc: JSON_RPC_VERSION, method: "documentChanged" });
    peer.post({ jsonrpc: JSON_RPC_VERSION, id: 7, result: "ok" });

    // The ping's answer is the first thing back, so the two messages before it got none.
    peer.post({ jsonrpc: JSON_RPC_VERSION, id: 8, method: "ping" });
    expect(await peer.next()).toMatchObject({ id: 8, result: "pong" });
  });

  it("ignores a port posted from another origin", async () => {
    const { host, target } = await startHost();
    editor(target, "https://example.com");
    await flushMessages();
    expect(host.isConnected).toBe(false);

    editor(target);
    expect(host.isConnected).toBe(true);
  });

  it("ignores window messages that are not a connect message with one port", async () => {
    const { host, target } = await startHost();
    const channel = new MessageChannel();
    target.dispatchEvent(
      new MessageEvent("message", { data: "connect", origin: EDITOR_ORIGIN, ports: [channel.port2] }),
    );
    target.dispatchEvent(
      new MessageEvent("message", { data: { type: "ignifx-editor/connect" }, origin: EDITOR_ORIGIN }),
    );
    channel.port1.close();

    expect(host.isConnected).toBe(false);
  });

  it("replaces the port when the editor sends a new one", async () => {
    const { target } = await startHost();
    const first = editor(target);
    await first.hello();

    const second = editor(target);
    expect((await second.hello())["result"]).toMatchObject({ hostKind: "scene" });
    await flushMessages();
    expect(first.isClosed).toBe(true);
  });

  it("sends heartbeats after ready and stops them on dispose", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { host, target } = await startHost({ heartbeatIntervalMs: 250 });
    const peer = editor(target);
    expect(vi.getTimerCount()).toBe(0);

    await peer.hello();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(await peer.next()).toEqual({ jsonrpc: JSON_RPC_VERSION, method: "heartbeat" });
    expect(await peer.next()).toEqual({ jsonrpc: JSON_RPC_VERSION, method: "heartbeat" });

    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(host.isConnected).toBe(false);
    expect(host.app.isRunning).toBe(false);
    host.dispose();
  });

  it("stops the heartbeat of a replaced port", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { target } = await startHost();
    await editor(target).hello();
    await editor(target).hello();

    expect(vi.getTimerCount()).toBe(1);
  });

  it("registers the project's scripts and loads the boot scene", async () => {
    class Spinner extends Script {
      static typeId = "test/Spinner";
    }
    const scene = {
      format: "ignifx.scene",
      formatVersion: 1,
      name: "Boot",
      entities: [
        {
          uid: "01J0000000000000000000000A",
          name: "Top",
          parent: null,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          components: [{ uid: "01J0000000000000000000000B", type: "test/Spinner" }],
        },
      ],
    };
    const { host } = await startHost({
      scripts: [Spinner],
      bootScene: "scenes/boot.scene.json",
      assets: {
        manifest: {
          format: "ignifx.manifest",
          formatVersion: 1,
          root: "assets",
          entries: [{ address: "scenes/boot.scene.json", url: "/assets/scenes/boot.scene.json" }],
        },
        fetch: async (): Promise<Response> => new Response(JSON.stringify(scene)),
      },
    });

    expect(host.bootScene?.name).toBe("Boot");
    expect(host.app.world.findByName("Top")?.getComponent(Spinner)).toBeInstanceOf(Spinner);
  });

  it("runs the scene view in edit mode, so a plain script gets no update", async () => {
    const updated: string[] = [];
    class Mover extends Script {
      static typeId = "test/Mover";
      update(): void {
        updated.push("Mover");
      }
    }
    class Gizmo extends Script {
      static typeId = "test/Gizmo";
      static runInEditMode = true;
      update(): void {
        updated.push("Gizmo");
      }
    }
    const { host } = await startHost({ scripts: [Mover, Gizmo] });
    const entity = host.app.world.createEntity("Probe");
    entity.addComponent(Mover);
    entity.addComponent(Gizmo);
    host.app.step(1 / 60);

    expect(host.app.isEditMode).toBe(true);
    expect(updated).toEqual(["Gizmo"]);
  });

  it("runs the scene view as a game when editMode is false", async () => {
    let updates = 0;
    class Mover extends Script {
      static typeId = "test/Mover";
      update(): void {
        updates += 1;
      }
    }
    const { host } = await startHost({ scripts: [Mover], editMode: false });
    host.app.world.createEntity("Probe").addComponent(Mover);
    host.app.step(1 / 60);

    expect(host.app.isEditMode).toBe(false);
    expect(updates).toBe(1);
  });

  it("closes the channel and rethrows when the app cannot start", async () => {
    const target = new CountingTarget();
    const failing = startEditorHost({
      editorOrigin: EDITOR_ORIGIN,
      headless: true,
      messageTarget: target,
      bootScene: "missing.scene.json",
      assets: { fetch: async (): Promise<Response> => new Response("", { status: 404 }) },
    });
    expect(target.listeners).toBe(1);

    await expect(failing).rejects.toThrow();
    expect(target.listeners).toBe(0);
  });

  it("checks its options", async () => {
    const target = new EventTarget();
    expect(await codeOf({ editorOrigin: "*", messageTarget: target })).toBe("IGX-1801");
    expect(await codeOf({ editorOrigin: "ignifx://app/path", messageTarget: target })).toBe("IGX-1801");
    expect(await codeOf({ editorOrigin: EDITOR_ORIGIN, headless: true })).toBe("IGX-1802");
    expect(await codeOf({ editorOrigin: EDITOR_ORIGIN, heartbeatIntervalMs: 0, messageTarget: target })).toBe(
      "IGX-1803",
    );
  });
});

describe("resolveEngineVersion", () => {
  it("reports the version the plugin read while core's VERSION is unstamped", () => {
    expect(resolveEngineVersion("0.9.0", "0.0.0")).toBe("0.9.0");
    expect(resolveEngineVersion(undefined, "0.0.0")).toBe("0.0.0");
  });

  it("reports core's VERSION once the build has stamped it", () => {
    expect(resolveEngineVersion("0.9.0", "1.2.3")).toBe("1.2.3");
    expect(resolveEngineVersion(undefined, "1.2.3")).toBe("1.2.3");
  });

  it("reads core's own VERSION by default", () => {
    expect(resolveEngineVersion(undefined)).toBe(VERSION);
  });
});
