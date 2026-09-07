import { describe, expect, it } from "vitest";
import { checkPackage, distTagsUrl, isUnresolved, versionUrl } from "../lib/registry.ts";
import type { FetchLike, RegistryResponse } from "../lib/registry.ts";

/** The registry the tests pretend to talk to. */
const REGISTRY = "https://registry.example.test";

/** One canned registry answer. */
interface Route {
  /** The HTTP status to answer with. */
  readonly status: number;
  /** The body to answer with. */
  readonly body: string;
}

/**
 * Builds a fetch stub that answers from a URL-to-response map and 404s everything else.
 *
 * @param routes - Response for each URL the test expects to be asked for.
 * @returns A fetch implementation.
 */
function stub(routes: readonly (readonly [string, Route])[]): FetchLike {
  const table = new Map<string, Route>(routes);
  return (url: string): Promise<RegistryResponse> => {
    const route = table.get(url);
    return Promise.resolve({
      status: route?.status ?? 404,
      text: () => Promise.resolve(route?.body ?? "{}"),
    });
  };
}

describe("registry URLs", () => {
  it("percent-encodes a scoped name whole, slash included", () => {
    expect(versionUrl(REGISTRY, "@ignifx/core", "0.1.0")).toBe(`${REGISTRY}/%40ignifx%2Fcore/0.1.0`);
  });

  it("drops a trailing slash on the registry base", () => {
    expect(versionUrl(`${REGISTRY}/`, "ignifx", "0.1.0")).toBe(`${REGISTRY}/ignifx/0.1.0`);
  });

  it("asks the dist-tags endpoint rather than the whole packument", () => {
    expect(distTagsUrl(REGISTRY, "@ignifx/core")).toBe(`${REGISTRY}/-/package/%40ignifx%2Fcore/dist-tags`);
  });
});

describe("checkPackage", () => {
  it("reports a version whose document carries a tarball as published, with the latest tag", async () => {
    const fetchLike = stub([
      [
        versionUrl(REGISTRY, "@ignifx/core", "0.1.0"),
        { status: 200, body: JSON.stringify({ dist: { tarball: "https://example.test/core-0.1.0.tgz" } }) },
      ],
      [distTagsUrl(REGISTRY, "@ignifx/core"), { status: 200, body: JSON.stringify({ latest: "0.1.0" }) }],
    ]);
    const check = await checkPackage(fetchLike, REGISTRY, "@ignifx/core", "0.1.0");
    expect(check.outcome).toBe("published");
    expect(check.detail).toContain("core-0.1.0.tgz");
    expect(check.detail).toContain("latest: 0.1.0");
  });

  it("reports a 404 as missing, which is what a half-finished release looks like", async () => {
    const check = await checkPackage(stub([]), REGISTRY, "@ignifx/ui", "0.1.0");
    expect(check.outcome).toBe("missing");
    expect(isUnresolved(check)).toBe(true);
  });

  it("does not call a 500 missing: the release may be fine and the registry not", async () => {
    const fetchLike = stub([[versionUrl(REGISTRY, "@ignifx/ui", "0.1.0"), { status: 500, body: "" }]]);
    const check = await checkPackage(fetchLike, REGISTRY, "@ignifx/ui", "0.1.0");
    expect(check.outcome).toBe("error");
    expect(check.detail).toContain("500");
  });

  it("fails a version document that names no tarball", async () => {
    const fetchLike = stub([
      [versionUrl(REGISTRY, "@ignifx/ui", "0.1.0"), { status: 200, body: JSON.stringify({ name: "@ignifx/ui" }) }],
    ]);
    const check = await checkPackage(fetchLike, REGISTRY, "@ignifx/ui", "0.1.0");
    expect(check.outcome).toBe("error");
    expect(check.detail).toContain("dist.tarball");
  });

  it("turns an unreachable registry into an error rather than throwing", async () => {
    const check = await checkPackage(
      () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
      REGISTRY,
      "ignifx",
      "0.1.0",
    );
    expect(check.outcome).toBe("error");
    expect(check.detail).toContain("ENOTFOUND");
  });

  it("still reports a published version when the dist-tags document is unreadable", async () => {
    const fetchLike = stub([
      [
        versionUrl(REGISTRY, "ignifx", "0.1.0"),
        { status: 200, body: JSON.stringify({ dist: { tarball: "https://example.test/ignifx-0.1.0.tgz" } }) },
      ],
      [distTagsUrl(REGISTRY, "ignifx"), { status: 500, body: "" }],
    ]);
    const check = await checkPackage(fetchLike, REGISTRY, "ignifx", "0.1.0");
    expect(check.outcome).toBe("published");
    expect(check.detail).toContain("latest tag unreadable");
    expect(isUnresolved(check)).toBe(false);
  });
});
