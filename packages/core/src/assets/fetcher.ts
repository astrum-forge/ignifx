import type { AssetHandleImpl } from "./asset-handle.js";
import type { FetchLike } from "./types.js";

/**
 * All asset I/O goes through the supplied `fetch`. Node callers can provide one for local files;
 * Electron's `ignifx://` protocol supports the renderer's ordinary fetch.
 * Read bodies in chunks for progress, using manifest sizes before `Content-Length` when available.
 */

/** The header carrying the response size. */
const CONTENT_LENGTH = "content-length";

/** The decoder used for {@link fetchAssetText}; created per call, which is not a per-frame path. */
const UTF8 = "utf-8";

/**
 * Fetches an address as bytes, counting progress into the handle and honouring the abort signal.
 *
 * @param fetchImpl - The injected `fetch`.
 * @param url - The URL to read.
 * @param signal - Aborted when the request is cancelled or the app is disposed.
 * @param handle - The handle whose byte counters this read feeds.
 * @returns The whole body.
 * @throws Error when the response status is not in the 2xx range; the service wraps it in
 * `IGX-0505` with the original as `cause`.
 *
 * @internal
 */
export async function fetchAssetBytes(
  fetchImpl: FetchLike,
  url: string,
  signal: AbortSignal,
  handle: AssetHandleImpl,
): Promise<ArrayBuffer> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`The request for ${url} failed with HTTP ${String(response.status)}.`);
  }
  readDeclaredSize(response, handle);
  const body = response.body;
  if (body === null) {
    const buffer = await response.arrayBuffer();
    handle.bytesLoaded = buffer.byteLength;
    if (handle.bytesTotal <= 0) {
      handle.bytesTotal = buffer.byteLength;
    }
    return buffer;
  }
  return readStream(body, handle);
}

/**
 * Fetches an address and decodes it as UTF-8 text.
 *
 * @param fetchImpl - The injected `fetch`.
 * @param url - The URL to read.
 * @param signal - The abort signal.
 * @param handle - The handle whose byte counters this read feeds.
 * @returns The decoded body.
 *
 * @internal
 */
export async function fetchAssetText(
  fetchImpl: FetchLike,
  url: string,
  signal: AbortSignal,
  handle: AssetHandleImpl,
): Promise<string> {
  const bytes = await fetchAssetBytes(fetchImpl, url, signal, handle);
  return new TextDecoder(UTF8).decode(bytes);
}

/**
 * Fetches an address and parses it as JSON.
 *
 * @typeParam J - The parsed shape, as the loader declares it.
 * @param fetchImpl - The injected `fetch`.
 * @param url - The URL to read.
 * @param signal - The abort signal.
 * @param handle - The handle whose byte counters this read feeds.
 * @returns The parsed body.
 *
 * @internal
 */
export async function fetchAssetJson<J = unknown>(
  fetchImpl: FetchLike,
  url: string,
  signal: AbortSignal,
  handle: AssetHandleImpl,
): Promise<J> {
  const text = await fetchAssetText(fetchImpl, url, signal, handle);
  // Boundary assertion (coding standards §5.2): `JSON.parse` returns `any`, and `J` is the loader's
  // own declaration of what the file holds. Loaders that need certainty validate with a schema.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(text) as J;
}

/**
 * Records the response's declared size, unless the manifest already supplied a better one.
 *
 * @param response - The response whose headers to read.
 * @param handle - The handle to record the total on.
 */
function readDeclaredSize(response: Response, handle: AssetHandleImpl): void {
  if (handle.bytesTotal > 0) {
    return;
  }
  const header = response.headers.get(CONTENT_LENGTH);
  if (header === null) {
    return;
  }
  const declared = Math.trunc(Number(header));
  if (Number.isFinite(declared) && declared > 0) {
    handle.bytesTotal = declared;
  }
}

/**
 * Drains a response body chunk by chunk so progress moves during the download.
 *
 * @param body - The response stream.
 * @param handle - The handle whose byte counters to advance.
 * @returns The concatenated body.
 */
async function readStream(body: ReadableStream<Uint8Array>, handle: AssetHandleImpl): Promise<ArrayBuffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    // Sequential by nature: each chunk has to arrive before the next can be asked for.
    // oxlint-disable-next-line no-await-in-loop
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = result.value;
    chunks.push(chunk);
    received += chunk.byteLength;
    handle.bytesLoaded = received;
  }
  if (handle.bytesTotal <= 0) {
    handle.bytesTotal = received;
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk === undefined) {
      continue;
    }
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
