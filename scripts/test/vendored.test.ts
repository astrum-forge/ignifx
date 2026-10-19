import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findVendoredManifests,
  parseVendoredManifest,
  readVendoredManifest,
  sha256Of,
  verifyVendoredFiles,
} from "../lib/vendored.ts";
import { isRecord } from "../lib/workspace.ts";

/**
 * Third-party files committed inside a package (`scripts/lib/vendored.ts`). The committed decoders
 * are checked against their recorded digests here, so a formatter run or a hand edit fails the unit
 * suite rather than a game at run time.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Reads `ignifx.assets.public` from `@ignifx/core`'s manifest.
 *
 * @returns The declared paths, sorted.
 */
function corePublicAssets(): readonly string[] {
  const manifest: unknown = JSON.parse(readFileSync(path.join(ROOT, "packages", "core", "package.json"), "utf8"));
  const ignifx = isRecord(manifest) ? manifest["ignifx"] : null;
  const assets = isRecord(ignifx) ? ignifx["assets"] : null;
  const listed = isRecord(assets) ? assets["public"] : null;
  return Array.isArray(listed) ? listed.filter((entry): entry is string => typeof entry === "string").toSorted() : [];
}

let fixture = "";

beforeAll(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "ignifx-vendored-"));
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe("the committed decoders", () => {
  it("are recorded in packages/core/decoders/vendored.json", () => {
    const found = findVendoredManifests(ROOT).map(({ file }) => path.relative(ROOT, file));
    expect(found).toContain(path.join("packages", "core", "decoders", "vendored.json"));
  });

  it("match their recorded SHA-256 digests", () => {
    const file = path.join(ROOT, "packages", "core", "decoders", "vendored.json");
    expect(verifyVendoredFiles(file)).toEqual([]);
  });

  it("are every file @ignifx/core publishes through ignifx.assets.public, and nothing else", () => {
    const file = path.join(ROOT, "packages", "core", "decoders", "vendored.json");
    const vendored = readVendoredManifest(file)
      .components.flatMap((component) => component.files.map((entry) => `decoders/${entry.file}`))
      .toSorted();
    expect(corePublicAssets()).toEqual(vendored);
  });
});

describe("verifyVendoredFiles", () => {
  it("reports a changed file and a missing licence", () => {
    const directory = path.join(fixture, "packages", "demo", "vendor");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "decoder.js"), "changed\n");
    const record = {
      components: [
        {
          name: "demo",
          version: "1.0.0",
          integrity: "sha512-x",
          license: "MIT",
          repository: "https://example.com/demo",
          copyright: "Copyright (c) Demo",
          licenseFile: "demo.LICENSE.md",
          noticeFile: null,
          files: [{ file: "decoder.js", from: "dist/decoder.js", sha256: sha256Of(new TextEncoder().encode("x\n")) }],
        },
      ],
    };
    writeFileSync(path.join(directory, "vendored.json"), JSON.stringify(record));

    expect(verifyVendoredFiles(path.join(directory, "vendored.json"))).toEqual([
      "demo: demo.LICENSE.md is missing",
      "demo: decoder.js does not match its recorded SHA-256",
    ]);
    expect(findVendoredManifests(fixture).map(({ file }) => path.relative(fixture, file))).toEqual([
      path.join("packages", "demo", "vendor", "vendored.json"),
    ]);
  });

  it("rejects a record of the wrong shape", () => {
    expect(() => parseVendoredManifest({ components: [{ name: "x" }] }, "vendored.json")).toThrow(/"files"/u);
    expect(() => parseVendoredManifest([], "vendored.json")).toThrow(/components/u);
  });
});
