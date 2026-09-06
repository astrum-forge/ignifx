import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { protocol } from "electron";
import { electronError, ElectronErrorCode } from "../errors.js";
import { IGNIFX_HOST_AUTHORITY, IGNIFX_SCHEME } from "../host-contract.js";
import type { Readable } from "node:stream";

/**
 * The `ignifx://` protocol that serves a packaged build's `dist/` directory
 * (`docs/architecture/14-platform-electron.md` §3, `05-assets-and-loading.md` §8).
 *
 * ## Why a custom protocol rather than `file://`
 *
 * `file://` pages have an opaque origin in Chromium, which costs a desktop build three things a
 * browser build has for free: `fetch` of a relative URL fails, `'self'` in a Content-Security-Policy
 * matches nothing, and `isSecureContext` is false — and without a secure context there is no
 * `navigator.gpu` at all. Registering `ignifx` with
 * `standard: true, secure: true, supportFetchAPI: true, stream: true`
 * (`protocol.registerSchemesAsPrivileged`, `electron.d.ts` 11702; `Privileges`, `electron.d.ts`
 * 23336) gives the packaged renderer a real, secure origin — `ignifx://app` — so the same manifest,
 * the same relative addresses, and the same loaders work unchanged between `pnpm dev` and the
 * installer. Measured on Electron 44.2.0 / macOS arm64 (S9.1): `window.isSecureContext === true`,
 * `window.location.origin === "ignifx://app"`, and `navigator.gpu.requestAdapter()` resolved.
 *
 * ## Range requests are this module's job, not `net.fetch`'s
 *
 * `protocol.handle` (`electron.d.ts` 11561) hands back whatever `Response` the handler returns, and
 * the obvious implementation — `net.fetch(pathToFileURL(resolved))` — does **not** honour a
 * `Range` request header: measured on Electron 44.2.0, a request for `bytes=100-199` against a
 * 2000-byte file came back `200` with all 2000 bytes and no `Content-Range`. A media element that
 * seeks needs a real `206`, so the handler parses the header itself and streams the slice.
 */

/**
 * The privileges the `ignifx` scheme is registered with.
 *
 * @remarks
 * The four that matter, in the order `14-platform-electron.md` §3 lists them:
 *
 * - `standard` — gives the scheme a parsed, hierarchical origin, which is what makes relative URLs
 *   and `'self'` work. It also normalises `..` segments away in the URL parser before a request is
 *   ever dispatched.
 * - `secure` — puts the origin in a secure context, without which there is no `navigator.gpu`.
 * - `supportFetchAPI` — lets `fetch()` and the asset loaders reach it.
 * - `stream` — lets media elements range-request it.
 *
 * @public
 */
export const IGNIFX_SCHEME_PRIVILEGES: Readonly<{
  readonly standard: true;
  readonly secure: true;
  readonly supportFetchAPI: true;
  readonly stream: true;
}> = Object.freeze({ standard: true, secure: true, supportFetchAPI: true, stream: true });

/**
 * The MIME type served for each file extension a build can contain.
 *
 * @remarks
 * An explicit table rather than a lookup library: the set of things `@ignifx/vite-plugin` emits is
 * known, a wrong `Content-Type` on a `.js` chunk stops a module graph dead, and `.wasm` must be
 * `application/wasm` or `WebAssembly.instantiateStreaming` refuses it.
 *
 * @public
 */
export const PROTOCOL_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/vnd.microsoft.icon",
  ".ktx2": "image/ktx2",
  ".basis": "application/octet-stream",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
});

/**
 * The type served for an extension the table does not know.
 *
 * @public
 */
export const PROTOCOL_FALLBACK_MIME_TYPE = "application/octet-stream";

/**
 * The document served when a request names a directory.
 *
 * @public
 */
export const PROTOCOL_INDEX_FILE = "index.html";

/**
 * Maps a file extension to the `Content-Type` header the protocol serves it with.
 *
 * @param pathOrExtension - A file name, a path, or a bare extension including the dot.
 * @returns The MIME type, or {@link PROTOCOL_FALLBACK_MIME_TYPE} for an unknown extension.
 *
 * @example
 * ```ts
 * mimeTypeFor("assets/crate-a1b2c3.png"); // "image/png"
 * mimeTypeFor(".wasm"); // "application/wasm"
 * ```
 *
 * @public
 */
export function mimeTypeFor(pathOrExtension: string): string {
  const isBareExtension = pathOrExtension.startsWith(".") && !pathOrExtension.includes("/");
  const extension = isBareExtension ? pathOrExtension.toLowerCase() : extname(pathOrExtension).toLowerCase();
  return PROTOCOL_MIME_TYPES[extension] ?? PROTOCOL_FALLBACK_MIME_TYPE;
}

/** The one character that truncates a path inside libc and must never reach the file system. */
const NUL = "\u0000";

/**
 * Turns an `ignifx://` URL into the absolute file path it names.
 *
 * @remarks
 * Two layers of defence, because one of them is a property of the URL parser rather than of this
 * code and could in principle change:
 *
 * 1. The `standard` privilege makes Chromium normalise `..` segments away before the request is
 *    dispatched — measured on Electron 44.2.0 (S9.1), `fetch("ignifx://app/../outside.txt")`
 *    reached the handler as `ignifx://app/outside.txt` and 404ed rather than escaping.
 * 2. This function resolves the path anyway and refuses anything that does not land inside `root`,
 *    which is what catches an encoded separator, a request that never went through Chromium, and
 *    any future parser change.
 *
 * A request for the origin itself, or for a path ending in `/`, resolves to
 * {@link PROTOCOL_INDEX_FILE} inside that directory, which is what makes `ignifx://app/` load the
 * game.
 *
 * @param url - The request URL, as `request.url` gives it.
 * @param root - The absolute directory the protocol serves.
 * @returns The absolute path of the file to serve.
 * @throws An `IgnifxError` with code `IGX-1465` when the path resolves outside `root` or cannot be
 * decoded, and one with code `IGX-1466` when `url` is not an `ignifx://` URL.
 *
 * @example
 * ```ts
 * protocolPathFor("ignifx://app/assets/crate.png", "/Applications/Game.app/dist");
 * // "/Applications/Game.app/dist/assets/crate.png"
 * ```
 *
 * @public
 */
export function protocolPathFor(url: string, root: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw electronError(ElectronErrorCode.invalidWindowOptions, `"${url}" is not a URL.`, {
      context: { option: "url" },
      cause: error,
    });
  }
  if (parsed.protocol !== `${IGNIFX_SCHEME}:`) {
    throw electronError(ElectronErrorCode.invalidWindowOptions, `"${url}" is not an ${IGNIFX_SCHEME}:// URL.`, {
      context: { option: "url" },
    });
  }

  const base = resolve(root);
  let relative: string;
  try {
    relative = decodeURIComponent(parsed.pathname);
  } catch (error) {
    throw electronError(ElectronErrorCode.protocolPathEscaped, `"${url}" is not decodable.`, {
      context: { path: parsed.pathname },
      cause: error,
    });
  }
  if (relative.includes(NUL)) {
    throw electronError(ElectronErrorCode.protocolPathEscaped, "The path contains a NUL byte.", {
      context: { path: parsed.pathname },
    });
  }
  if (relative === "" || relative.endsWith("/")) {
    relative = `${relative}${PROTOCOL_INDEX_FILE}`;
  }
  while (relative.startsWith("/")) {
    relative = relative.slice(1);
  }
  // A backslash is a separator on Windows and an ordinary character on POSIX; normalising it here
  // means the containment check below sees the same string the file system will.
  relative = relative.replaceAll("\\", "/");

  const resolved = resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) {
    throw electronError(ElectronErrorCode.protocolPathEscaped, `"${url}" resolves outside the served directory.`, {
      context: { path: relative, root: base },
      hint: "Serve the file from inside the build output.",
    });
  }
  return resolved;
}

/**
 * One byte range, resolved against a known file size.
 *
 * @public
 */
export interface ByteRange {
  /** The first byte served, inclusive. */
  readonly start: number;
  /** The last byte served, inclusive. */
  readonly end: number;
}

/**
 * What {@link parseRangeHeader} decided.
 *
 * @remarks
 * Three outcomes, not two: a header this handler does not implement (multiple ranges, a unit other
 * than `bytes`) is `"ignored"` and answered with a normal `200`, which RFC 9110 §14.2 explicitly
 * permits; a syntactically fine header that names bytes past the end of the file is
 * `"unsatisfiable"` and must be answered `416`.
 *
 * @public
 */
export type RangeDecision =
  | { readonly kind: "ignored" }
  | { readonly kind: "unsatisfiable" }
  | { readonly kind: "range"; readonly range: ByteRange };

/** The one range unit this handler implements. */
const RANGE_UNIT = "bytes=";

/**
 * Parses a `Range` request header against a known file size.
 *
 * @remarks
 * Implements the three single-range forms of RFC 9110 §14.1.2: `bytes=a-b`, `bytes=a-` (to the
 * end), and `bytes=-n` (the last `n` bytes). Multiple ranges are declined rather than
 * mis-implemented, because a `multipart/byteranges` response is the only correct answer to one and
 * no media element in Chromium asks for it.
 *
 * @param header - The header value, or `null` when the request carried none.
 * @param size - The file's size in bytes.
 * @returns What to do: serve everything, serve a slice, or refuse.
 *
 * @example
 * ```ts
 * parseRangeHeader("bytes=100-199", 2000); // { kind: "range", range: { start: 100, end: 199 } }
 * parseRangeHeader("bytes=-64", 2000);     // { kind: "range", range: { start: 1936, end: 1999 } }
 * parseRangeHeader("bytes=5000-", 2000);   // { kind: "unsatisfiable" }
 * ```
 *
 * @public
 */
export function parseRangeHeader(header: string | null, size: number): RangeDecision {
  if (header === null) {
    return { kind: "ignored" };
  }
  const trimmed = header.trim().toLowerCase();
  if (!trimmed.startsWith(RANGE_UNIT)) {
    return { kind: "ignored" };
  }
  const spec = trimmed.slice(RANGE_UNIT.length);
  if (spec.includes(",")) {
    return { kind: "ignored" };
  }
  const dash = spec.indexOf("-");
  if (dash === -1) {
    return { kind: "ignored" };
  }
  const firstText = spec.slice(0, dash);
  const lastText = spec.slice(dash + 1);
  // An empty file can satisfy no range at all, whatever the numbers say.
  if (size === 0) {
    return { kind: "unsatisfiable" };
  }

  if (firstText === "") {
    // `bytes=-n`: the last n bytes.
    const suffix = Number.parseInt(lastText, 10);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      return { kind: "ignored" };
    }
    const start = suffix >= size ? 0 : size - suffix;
    return { kind: "range", range: { start, end: size - 1 } };
  }

  const start = Number.parseInt(firstText, 10);
  if (!Number.isInteger(start) || start < 0) {
    return { kind: "ignored" };
  }
  if (start >= size) {
    return { kind: "unsatisfiable" };
  }
  if (lastText === "") {
    return { kind: "range", range: { start, end: size - 1 } };
  }
  const requestedEnd = Number.parseInt(lastText, 10);
  if (!Number.isInteger(requestedEnd) || requestedEnd < start) {
    return { kind: "ignored" };
  }
  return { kind: "range", range: { start, end: Math.min(requestedEnd, size - 1) } };
}

/**
 * The headers every `ignifx://` response carries, whatever its status.
 *
 * @remarks
 * `Accept-Ranges: bytes` is what tells a media element it may seek at all, and
 * `Cross-Origin-Resource-Policy: same-origin` keeps a packaged asset from being pulled into any
 * other origin that somehow gets loaded.
 *
 * @public
 */
export const PROTOCOL_COMMON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Accept-Ranges": "bytes",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  // A packaged build is immutable and every asset address is content-hashed by
  // `@ignifx/vite-plugin`, so nothing here is worth a revalidation round trip.
  "Cache-Control": "no-cache",
});

/**
 * Turns a Node readable stream into the web `ReadableStream` a `Response` wants.
 *
 * @param source - The file stream.
 * @returns The web stream.
 */
function toWebStream(source: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      source.on("data", (chunk: string | Uint8Array): void => {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      });
      source.on("end", (): void => {
        controller.close();
      });
      source.on("error", (error: Error): void => {
        controller.error(error);
      });
    },
    cancel(): void {
      source.destroy();
    },
  });
}

/**
 * Answers one `ignifx://` request out of a directory.
 *
 * @remarks
 * Exported so the protocol can be exercised without registering it on a real Electron session: the
 * unit suite calls this with a temporary directory and a plain `Request`.
 *
 * @param request - The request, as `protocol.handle` delivers it.
 * @param root - The absolute directory being served.
 * @returns The response: `200`, `206` for an honoured range, `403` for a path that escapes the
 * root, `404` for a missing file, `405` for a method other than `GET` or `HEAD`, and `416` for an
 * unsatisfiable range.
 *
 * @example
 * ```ts
 * const response = await respondToProtocolRequest(
 *   new Request("ignifx://app/assets.manifest.json"),
 *   "/path/to/dist",
 * );
 * ```
 *
 * @public
 */
export async function respondToProtocolRequest(request: Request, root: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  let path: string;
  try {
    path = protocolPathFor(request.url, root);
  } catch {
    return new Response("Forbidden", { status: 403, headers: PROTOCOL_COMMON_HEADERS });
  }

  let size: number;
  try {
    const stats = await stat(path);
    if (stats.isDirectory()) {
      // A bare directory means the index inside it; `protocolPathFor` appends the file name once
      // the path is known to end in a separator.
      return await respondToProtocolRequest(new Request(`${request.url}/`, { method: request.method }), root);
    }
    size = stats.size;
  } catch {
    return new Response("Not Found", { status: 404, headers: PROTOCOL_COMMON_HEADERS });
  }

  const type = mimeTypeFor(path);
  const decision = parseRangeHeader(request.headers.get("range"), size);

  if (decision.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...PROTOCOL_COMMON_HEADERS, "Content-Range": `bytes */${String(size)}` },
    });
  }

  if (decision.kind === "range") {
    const { start, end } = decision.range;
    const length = end - start + 1;
    const rangeHeaders: Record<string, string> = {
      ...PROTOCOL_COMMON_HEADERS,
      "Content-Type": type,
      "Content-Length": String(length),
      "Content-Range": `bytes ${String(start)}-${String(end)}/${String(size)}`,
    };
    if (request.method === "HEAD") {
      return new Response(null, { status: 206, headers: rangeHeaders });
    }
    return new Response(toWebStream(createReadStream(path, { start, end })), {
      status: 206,
      headers: rangeHeaders,
    });
  }

  const headers: Record<string, string> = {
    ...PROTOCOL_COMMON_HEADERS,
    "Content-Type": type,
    "Content-Length": String(size),
  };
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(toWebStream(createReadStream(path)), { status: 200, headers });
}

/**
 * Declares the `ignifx` scheme's privileges. **Must run before `app.whenReady()`**.
 *
 * @remarks
 * `protocol.registerSchemesAsPrivileged` (`electron.d.ts` 11702) is only read while Chromium's
 * network stack is being set up; calling it after the app is ready does nothing at all, and the
 * symptom is a page with an opaque origin and no `navigator.gpu`. Call it at the top of the main
 * entry, beside `applyWebGpuSwitches`.
 *
 * @example
 * ```ts
 * import { app } from "electron";
 * import { registerIgnifxScheme } from "@ignifx/electron/main";
 *
 * registerIgnifxScheme();
 * await app.whenReady();
 * ```
 *
 * @public
 */
export function registerIgnifxScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: IGNIFX_SCHEME, privileges: { ...IGNIFX_SCHEME_PRIVILEGES } }]);
}

/**
 * Installs the `ignifx://` handler. **Must run after `app.whenReady()`**.
 *
 * @param root - The absolute directory to serve, normally the packaged renderer's build output.
 * @returns A function that removes the handler again.
 *
 * @example
 * ```ts
 * await app.whenReady();
 * const stop = serveIgnifxProtocol(join(import.meta.dirname, "../renderer"));
 * ```
 *
 * @public
 */
export function serveIgnifxProtocol(root: string): () => void {
  const base = resolve(root);
  protocol.handle(IGNIFX_SCHEME, async (request: GlobalRequest): Promise<GlobalResponse> =>
    respondToProtocolRequest(request, base),
  );
  return (): void => {
    protocol.unhandle(IGNIFX_SCHEME);
  };
}

/**
 * The URL a packaged game window loads.
 *
 * @param entry - The document inside the served directory, for example `"index.html"`.
 * @returns The absolute `ignifx://app/…` URL.
 *
 * @example
 * ```ts
 * packagedEntryUrl("index.html"); // "ignifx://app/index.html"
 * ```
 *
 * @public
 */
export function packagedEntryUrl(entry: string): string {
  const trimmed = entry.startsWith("/") ? entry.slice(1) : entry;
  return `${IGNIFX_SCHEME}://${IGNIFX_HOST_AUTHORITY}/${trimmed}`;
}
