import { isValidErrorCode } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import * as page from "../src/index.js";
import * as vite from "../src/vite.js";

/**
 * The protocol mirror and the two entries' surfaces. `src/protocol/` copies `@ignifx/editor-protocol`
 * 0.3; these values are the wire format, so a change here is a protocol change.
 */

describe("the protocol mirror", () => {
  it("speaks protocol 0.3 and, before 1.0, agrees on the major and the minor", () => {
    expect(page.PROTOCOL_VERSION).toEqual({ major: 0, minor: 3 });
    expect(page.protocolVersionIsCompatible({ major: 0, minor: 3 }, { major: 0, minor: 3 })).toBe(true);
    expect(page.protocolVersionIsCompatible({ major: 0, minor: 3 }, { major: 0, minor: 2 })).toBe(false);
    expect(page.protocolVersionIsCompatible({ major: 0, minor: 2 }, { major: 0, minor: 3 })).toBe(false);
    expect(page.protocolVersionIsCompatible({ major: 0, minor: 3 }, { major: 1, minor: 3 })).toBe(false);
  });

  it("lets minors differ from 1.0", () => {
    expect(page.protocolVersionIsCompatible({ major: 1, minor: 0 }, { major: 1, minor: 4 })).toBe(true);
    expect(page.protocolVersionIsCompatible({ major: 1, minor: 4 }, { major: 2, minor: 4 })).toBe(false);
  });

  it("keeps the JSON-RPC and editor error codes", () => {
    expect(page.JSON_RPC_VERSION).toBe("2.0");
    expect(page.RpcErrorCode).toEqual({
      parseError: -32_700,
      invalidRequest: -32_600,
      methodNotFound: -32_601,
      invalidParams: -32_602,
      internalError: -32_603,
      incompatibleProtocol: -32_000,
      notReady: -32_001,
      noScene: -32_002,
    });
    expect(page.HandshakeMethod).toEqual({ hello: "hello", ping: "ping" });
    expect(page.HostKind).toEqual({ scene: "scene", play: "play" });
  });

  it("recognises well-formed envelopes only", () => {
    const valid: unknown[] = [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "heartbeat" },
      { jsonrpc: "2.0", id: "a", method: "hello", params: { editorVersion: "0.1.0" } },
      { jsonrpc: "2.0", id: 1, result: "pong" },
      { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "bad" } },
    ];
    const invalid: unknown[] = [
      null,
      [],
      { jsonrpc: "1.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 1, method: "ping", params: 3 },
      { jsonrpc: "2.0", id: Number.NaN, method: "ping" },
      { jsonrpc: "2.0", id: 1, result: 1, error: { code: -32_600, message: "both" } },
      { jsonrpc: "2.0", id: null, result: 1 },
      { jsonrpc: "2.0", id: 1, error: { code: 7, message: "unknown code" } },
    ];
    for (const message of valid) {
      expect(page.isRpcMessage(message)).toBe(true);
    }
    for (const message of invalid) {
      expect(page.isRpcMessage(message)).toBe(false);
    }
  });
});

describe("@ignifx/editor-host entries", () => {
  it("exports the host and the play controls from the page entry", () => {
    expect(typeof page.startEditorHost).toBe("function");
    expect(typeof page.startEditorPlayControls).toBe("function");
    expect(page.EDITOR_CONNECT_MESSAGE_TYPE).toBe("ignifx-editor/connect");
    expect(page.PlayMethod).toEqual({ play: "play", pause: "pause", step: "step", stop: "stop" });
  });

  it("exports the plugin from the vite entry", () => {
    expect(typeof vite.editorHostPlugin).toBe("function");
    expect(vite.EDITOR_PAGE_PATH).toBe("/__ignifx_editor__/");
    expect(vite.EDITOR_MODULE_ID).toBe("virtual:ignifx/editor");
    expect(vite.RESOLVED_EDITOR_MODULE_ID).toBe("\0virtual:ignifx/editor");
  });

  it("owns registered codes in the 18xx range", () => {
    for (const code of Object.values(page.EditorHostErrorCode)) {
      expect(code).toMatch(/^IGX-18\d\d$/u);
      expect(isValidErrorCode(code)).toBe(true);
    }
    expect(page.isEditorOrigin("ignifx://app")).toBe(true);
    expect(page.isEditorOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(page.isEditorOrigin("http://localhost:5173/")).toBe(false);
    expect(page.isEditorOrigin("'self'")).toBe(false);
  });
});
