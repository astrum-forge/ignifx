// Must come first: it registers the `electron` module mock every import below depends on.
// oxlint-disable-next-line import/no-unassigned-import -- see above.
import "./support/electron-mock.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isIgnifxError } from "@ignifx/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mimeTypeFor,
  packagedEntryUrl,
  parseRangeHeader,
  PROTOCOL_FALLBACK_MIME_TYPE,
  protocolPathFor,
  respondToProtocolRequest,
} from "../src/main/protocol.js";

/**
 * The `ignifx://` protocol handler (`docs/architecture/14-platform-electron.md` §3,
 * `05-assets-and-loading.md` §8).
 *
 * The path mapping, the MIME table, and the `Range` parser are pure, so they are tested against
 * literals. The responder is exercised against a real temporary directory, because what it must get
 * right — a `206` with the right slice, a `404` for a missing file, a `403` for an escape — is
 * exactly the part a fake file system would let through.
 *
 * What is *not* here is anything that depends on Chromium: that the scheme really is a secure
 * origin, that `..` is normalised before the handler ever sees it, and that `navigator.gpu` exists
 * on it are proved against a real Electron process in `tests/visual/tests/desktop.spec.ts`.
 */

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ignifx-protocol-"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>game</title>", "utf8");
  await writeFile(join(root, "assets.manifest.json"), '{"version":1,"assets":{}}', "utf8");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "assets", "clip.wav"), new Uint8Array(2000).fill(7));
  await writeFile(join(root, "assets", "physics.wasm"), new Uint8Array([0, 0x61, 0x73, 0x6d]));
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "nested", "index.html"), "<!doctype html><title>nested</title>", "utf8");
  await writeFile(join(resolve(root, ".."), "outside.txt"), "secret", "utf8");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("protocolPathFor", () => {
  it("maps a path onto the served directory", () => {
    expect(protocolPathFor("ignifx://app/assets/crate.png", "/srv/dist")).toBe("/srv/dist/assets/crate.png");
  });

  it("serves index.html for the origin itself and for any directory path", () => {
    expect(protocolPathFor("ignifx://app/", "/srv/dist")).toBe("/srv/dist/index.html");
    expect(protocolPathFor("ignifx://app", "/srv/dist")).toBe("/srv/dist/index.html");
    expect(protocolPathFor("ignifx://app/nested/", "/srv/dist")).toBe("/srv/dist/nested/index.html");
  });

  it("decodes percent escapes, so a space in a file name resolves", () => {
    expect(protocolPathFor("ignifx://app/assets/my%20clip.wav", "/srv/dist")).toBe("/srv/dist/assets/my clip.wav");
  });

  it("refuses a path that resolves outside the served directory", () => {
    // Only the *encoded-separator* forms reach this function as traversals. Measured with Node's
    // WHATWG `URL` (the same parser Chromium uses for a `standard` scheme): `..` and `%2e%2e`
    // segments are collapsed before `pathname` is ever read, so `ignifx://app/../outside.txt` and
    // `ignifx://app/%2e%2e/outside.txt` both arrive as `/outside.txt` and 404 rather than escaping.
    // A percent-encoded slash survives, and that is what this check is for.
    for (const url of ["ignifx://app/..%2f..%2foutside.txt", "ignifx://app/%2e%2e%2f%2e%2e%2foutside.txt"]) {
      let thrown: unknown = null;
      try {
        protocolPathFor(url, "/srv/dist");
      } catch (error) {
        thrown = error;
      }
      expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1465");
    }
  });

  it("lets the URL parser collapse the dot segments it already collapses", () => {
    // Documented rather than defended against twice: these resolve inside the root, and the file
    // they name does not exist, so the responder answers 404.
    expect(protocolPathFor("ignifx://app/%2e%2e/outside.txt", "/srv/dist")).toBe("/srv/dist/outside.txt");
    expect(protocolPathFor("ignifx://app/assets/%2e%2e/%2e%2e/outside.txt", "/srv/dist")).toBe("/srv/dist/outside.txt");
  });

  it("refuses a NUL byte, which truncates a path inside libc", () => {
    let thrown: unknown = null;
    try {
      protocolPathFor("ignifx://app/index.html%00.png", "/srv/dist");
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1465");
  });

  it("refuses a URL that is not ignifx://", () => {
    let thrown: unknown = null;
    try {
      protocolPathFor("https://evil.example/index.html", "/srv/dist");
    } catch (error) {
      thrown = error;
    }
    expect(isIgnifxError(thrown) && thrown.code).toBe("IGX-1466");
  });

  it("builds the URL a packaged window loads", () => {
    expect(packagedEntryUrl("index.html")).toBe("ignifx://app/index.html");
    expect(packagedEntryUrl("/index.html")).toBe("ignifx://app/index.html");
  });
});

describe("mimeTypeFor", () => {
  it("types every kind of file a build contains", () => {
    expect(mimeTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(mimeTypeFor("assets/index-BIezhP2G.js")).toBe("text/javascript; charset=utf-8");
    expect(mimeTypeFor("assets.manifest.json")).toBe("application/json; charset=utf-8");
    expect(mimeTypeFor("crate-a1b2c3.png")).toBe("image/png");
    expect(mimeTypeFor("player.glb")).toBe("model/gltf-binary");
    expect(mimeTypeFor("footstep.wav")).toBe("audio/wav");
  });

  it("types WebAssembly exactly, because instantiateStreaming refuses anything else", () => {
    expect(mimeTypeFor("rapier.wasm")).toBe("application/wasm");
    expect(mimeTypeFor(".wasm")).toBe("application/wasm");
  });

  it("is case-insensitive and falls back for an extension it does not know", () => {
    expect(mimeTypeFor("CRATE.PNG")).toBe("image/png");
    expect(mimeTypeFor("save.sav")).toBe(PROTOCOL_FALLBACK_MIME_TYPE);
    expect(mimeTypeFor("noextension")).toBe(PROTOCOL_FALLBACK_MIME_TYPE);
  });
});

describe("parseRangeHeader", () => {
  it("returns the whole file when there is no Range header", () => {
    expect(parseRangeHeader(null, 2000)).toEqual({ kind: "ignored" });
  });

  it("parses the three single-range forms of RFC 9110 §14.1.2", () => {
    expect(parseRangeHeader("bytes=100-199", 2000)).toEqual({ kind: "range", range: { start: 100, end: 199 } });
    expect(parseRangeHeader("bytes=1900-", 2000)).toEqual({ kind: "range", range: { start: 1900, end: 1999 } });
    expect(parseRangeHeader("bytes=-64", 2000)).toEqual({ kind: "range", range: { start: 1936, end: 1999 } });
  });

  it("clamps an end past the file and a suffix longer than the file", () => {
    expect(parseRangeHeader("bytes=1900-99999", 2000)).toEqual({ kind: "range", range: { start: 1900, end: 1999 } });
    expect(parseRangeHeader("bytes=-99999", 2000)).toEqual({ kind: "range", range: { start: 0, end: 1999 } });
  });

  it("calls a start past the end unsatisfiable, which must be answered 416", () => {
    expect(parseRangeHeader("bytes=2000-", 2000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=5000-6000", 2000)).toEqual({ kind: "unsatisfiable" });
    // An empty file satisfies no range at all.
    expect(parseRangeHeader("bytes=0-0", 0)).toEqual({ kind: "unsatisfiable" });
  });

  it("declines what it does not implement rather than mis-implementing it", () => {
    // Multiple ranges need a multipart/byteranges body; no Chromium media element asks for one.
    expect(parseRangeHeader("bytes=0-99,200-299", 2000)).toEqual({ kind: "ignored" });
    expect(parseRangeHeader("items=0-99", 2000)).toEqual({ kind: "ignored" });
    expect(parseRangeHeader("bytes=abc-def", 2000)).toEqual({ kind: "ignored" });
    expect(parseRangeHeader("bytes=", 2000)).toEqual({ kind: "ignored" });
    // An end before the start is nonsense, not a range.
    expect(parseRangeHeader("bytes=500-100", 2000)).toEqual({ kind: "ignored" });
  });

  it("is case-insensitive about the unit", () => {
    expect(parseRangeHeader("BYTES=0-9", 2000)).toEqual({ kind: "range", range: { start: 0, end: 9 } });
  });
});

describe("respondToProtocolRequest", () => {
  it("serves a document with its type, its length, and Accept-Ranges", async () => {
    const response = await respondToProtocolRequest(new Request("ignifx://app/index.html"), root);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("<title>game</title>");
  });

  it("serves the manifest the same way a dev server does", async () => {
    const response = await respondToProtocolRequest(new Request("ignifx://app/assets.manifest.json"), root);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ version: 1, assets: {} });
  });

  it("serves index.html for the origin and for a directory", async () => {
    expect((await respondToProtocolRequest(new Request("ignifx://app/"), root)).status).toBe(200);
    const nested = await respondToProtocolRequest(new Request("ignifx://app/nested"), root);
    expect(nested.status).toBe(200);
    expect(await nested.text()).toContain("<title>nested</title>");
  });

  it("answers a Range request with a real 206 and the right slice", async () => {
    // `net.fetch` of a `file://` URL does not do this — measured on Electron 44.2.0, it answered a
    // `bytes=100-199` request with `200` and all 2000 bytes — which is why the handler parses the
    // header itself.
    const response = await respondToProtocolRequest(
      new Request("ignifx://app/assets/clip.wav", { headers: { Range: "bytes=100-199" } }),
      root,
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-199/2000");
    expect(response.headers.get("content-length")).toBe("100");
    expect((await response.arrayBuffer()).byteLength).toBe(100);
  });

  it("answers an unsatisfiable range 416 with the file's size", async () => {
    const response = await respondToProtocolRequest(
      new Request("ignifx://app/assets/clip.wav", { headers: { Range: "bytes=9000-" } }),
      root,
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */2000");
  });

  it("serves WebAssembly as application/wasm", async () => {
    const response = await respondToProtocolRequest(new Request("ignifx://app/assets/physics.wasm"), root);

    expect(response.headers.get("content-type")).toBe("application/wasm");
  });

  it("answers HEAD with the headers and no body", async () => {
    const response = await respondToProtocolRequest(
      new Request("ignifx://app/assets/clip.wav", { method: "HEAD" }),
      root,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("2000");
    expect(await response.text()).toBe("");
  });

  it("404s a missing file, and one the URL parser normalised back inside the root", async () => {
    expect((await respondToProtocolRequest(new Request("ignifx://app/nope.png"), root)).status).toBe(404);
    // `%2e%2e` is collapsed by the parser, so this asks for `<root>/outside.txt`, which is not there.
    expect((await respondToProtocolRequest(new Request("ignifx://app/%2e%2e/outside.txt"), root)).status).toBe(404);
  });

  it("403s a request whose encoded separators would escape the root", async () => {
    const response = await respondToProtocolRequest(new Request("ignifx://app/..%2f..%2foutside.txt"), root);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
  });

  it("405s a method that is not GET or HEAD", async () => {
    const response = await respondToProtocolRequest(new Request("ignifx://app/index.html", { method: "POST" }), root);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
