import { describe, expect, it } from "vitest";
import { AssetHandleImpl } from "../../src/assets/asset-handle.js";
import { fetchAssetBytes, fetchAssetJson, fetchAssetText } from "../../src/assets/fetcher.js";
import { binaryAssetLoader } from "../../src/assets/generic-loaders.js";
import type { FetchLike } from "../../src/assets/types.js";

/**
 * The one place the service touches the network
 * (`docs/architecture/05-assets-and-loading.md` §5, §8): status handling, the declared size, the
 * streamed body, and the body-less response every path has to tolerate.
 */

/** A handle with no service behind it, for testing the reads in isolation. */
function stubHandle(url = "https://example.com/a.bin"): AssetHandleImpl {
  return new AssetHandleImpl({
    address: "a.bin",
    path: "a.bin",
    fragment: null,
    type: "binary",
    key: "binary::a.bin",
    url,
    loader: binaryAssetLoader,
    host: {
      onZeroReferences: (): void => {},
      onRetained: (): void => {},
    },
  });
}

/** A `fetch` that always answers with one prepared response. */
function fetchOf(response: () => Response): FetchLike {
  return () => Promise.resolve(response());
}

/** An unaborted signal. */
function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("fetchAssetBytes", () => {
  it("streams the body and counts the bytes as they arrive", async () => {
    const handle = stubHandle();
    const bytes = await fetchAssetBytes(
      fetchOf(() => new Response(new Uint8Array([1, 2, 3]))),
      "u",
      signal(),
      handle,
    );
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(handle.bytesLoaded).toBe(3);
    expect(handle.bytesTotal).toBe(3);
  });

  it("takes the total from Content-Length before the body arrives", async () => {
    const handle = stubHandle();
    const source = new ReadableStream<Uint8Array>({
      start: (controller): void => {
        controller.enqueue(new Uint8Array(2));
        controller.close();
      },
    });
    await fetchAssetBytes(
      fetchOf(() => new Response(source, { headers: { "content-length": "2" } })),
      "u",
      signal(),
      handle,
    );
    expect(handle.bytesTotal).toBe(2);
  });

  it("keeps the manifest's size in preference to the header", async () => {
    const handle = stubHandle();
    handle.bytesTotal = 99;
    await fetchAssetBytes(
      fetchOf(() => new Response(new Uint8Array(2), { headers: { "content-length": "2" } })),
      "u",
      signal(),
      handle,
    );
    expect(handle.bytesTotal).toBe(99);
  });

  it("ignores a Content-Length that is not a positive number", async () => {
    const handle = stubHandle();
    await fetchAssetBytes(
      fetchOf(() => new Response(new Uint8Array(2), { headers: { "content-length": "nonsense" } })),
      "u",
      signal(),
      handle,
    );
    expect(handle.bytesTotal).toBe(2);
  });

  it("falls back to arrayBuffer() when the response carries no body stream", async () => {
    const handle = stubHandle();
    const bytes = await fetchAssetBytes(
      fetchOf(() => new Response(null)),
      "u",
      signal(),
      handle,
    );
    expect(bytes.byteLength).toBe(0);
    expect(handle.bytesLoaded).toBe(0);
  });

  it("throws when the status is not in the 2xx range", async () => {
    const handle = stubHandle();
    await expect(
      fetchAssetBytes(
        fetchOf(() => new Response("nope", { status: 500 })),
        "u",
        signal(),
        handle,
      ),
    ).rejects.toThrow(/HTTP 500/u);
  });
});

describe("fetchAssetText and fetchAssetJson", () => {
  it("decodes UTF-8", async () => {
    const handle = stubHandle();
    await expect(
      fetchAssetText(
        fetchOf(() => new Response("héllo")),
        "u",
        signal(),
        handle,
      ),
    ).resolves.toBe("héllo");
  });

  it("parses JSON", async () => {
    const handle = stubHandle();
    await expect(
      fetchAssetJson(
        fetchOf(() => new Response('{"a":1}')),
        "u",
        signal(),
        handle,
      ),
    ).resolves.toEqual({
      a: 1,
    });
  });

  it("propagates a parse failure rather than swallowing it", async () => {
    const handle = stubHandle();
    await expect(
      fetchAssetJson(
        fetchOf(() => new Response("{")),
        "u",
        signal(),
        handle,
      ),
    ).rejects.toThrow();
  });
});
