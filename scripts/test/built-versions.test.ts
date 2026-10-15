import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every built package that exports `VERSION` must report the version in its `package.json`. The
 * source says `"0.0.0"`; the build stamps the real number (`define` in each `tsdown.config.ts`), so
 * a package whose build forgets the stamp ships `"0.0.0"` — which is how `create-ignifx` 0.9.0 came
 * to pin new projects to `^0.0.0`. Like the other cross-package tests, this reads `dist/`, so it
 * needs `pnpm build:packages` first.
 */

const PACKAGES = path.resolve(import.meta.dirname, "../../packages");

/** One built package that exports `VERSION`. */
interface BuiltPackage {
  readonly name: string;
  readonly version: string;
  readonly exported: unknown;
}

/**
 * Imports every published package's built `dist/index.js` and keeps those that export `VERSION`.
 *
 * @returns Name, `package.json` version and exported `VERSION` of each.
 */
async function builtPackages(): Promise<BuiltPackage[]> {
  const found = await Promise.all(
    readdirSync(PACKAGES).map(async (directory): Promise<BuiltPackage[]> => {
      const manifestPath = path.join(PACKAGES, directory, "package.json");
      const entry = path.join(PACKAGES, directory, "dist", "index.js");
      if (!existsSync(manifestPath) || !existsSync(entry)) {
        return [];
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        readonly name: string;
        readonly version: string;
        readonly private?: boolean;
      };
      const module: unknown = await import(pathToFileURL(entry).href);
      if (manifest.private === true || typeof module !== "object" || module === null || !("VERSION" in module)) {
        return [];
      }
      return [{ name: manifest.name, version: manifest.version, exported: module.VERSION }];
    }),
  );
  return found.flat();
}

const packages = await builtPackages();

describe("built packages", () => {
  it("include the ones that export VERSION", () => {
    expect(packages.map((built) => built.name)).toEqual(expect.arrayContaining(["@ignifx/cli", "@ignifx/core"]));
  });

  it.each(packages)("$name reports its package.json version as VERSION", ({ exported, version }) => {
    expect(exported).toBe(version);
  });
});
