import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import baselines from "./baselines.json" with { type: "json" };

/**
 * The bundle ceiling (`CONSTITUTION.md` §6.4, coding standards §12 step 4): each app below is
 * built, its JavaScript is gzipped, and the first-load payload has to stay inside the ceiling
 * `baselines.json` records. The plan asks for a ceiling **per template**, not one house number,
 * because the templates do not carry the same engine: only the two 2D ones pull in Rapier.
 *
 * ## What is measured, and what is not
 *
 * Babylon Lite code-splits aggressively: a build of `hello-cube` emits close to three hundred
 * chunks, and all but a handful are `import()`ed on demand by features the scene never reaches.
 * The number that decides how long a player waits for the first frame is the **entry chunk**, which
 * is what the ceiling is set on. The sum over every emitted chunk is recorded next to it as
 * `totalGzipBytes`, so a change that only moves weight from the entry into a lazy chunk is visible
 * rather than invisible.
 *
 * The plan's Phase 2 target is "ignifx core + Lite minimal scene under 250 KB gzipped". The
 * measured entry chunk is over that; the number is recorded honestly in `baselines.json` and the
 * gap is written up in `README.md`.
 */

/** One app whose build is weighed, and the key its baseline is filed under. */
interface Subject {
  /** The `baselines.json` key, which is also the path from the repository root. */
  readonly key: "examples/hello-cube" | "templates/2d-topdown" | "templates/2d-sidescroller";
}

const SUBJECTS: readonly Subject[] = [
  { key: "examples/hello-cube" },
  { key: "templates/2d-topdown" },
  { key: "templates/2d-sidescroller" },
];

/** How long each build is given. */
const BUILD_TIMEOUT_MS = 300_000;

/** What one build's JavaScript weighs. */
interface BundleWeights {
  /** The gzipped size of the chunk `index.html` loads directly. */
  readonly entryGzipBytes: number;
  /** The gzipped size of every emitted `.js` file added together. */
  readonly totalGzipBytes: number;
  /** How many `.js` files the build emitted. */
  readonly chunkCount: number;
}

/**
 * Builds one app and weighs what it emitted.
 *
 * @param key - The app's path from the repository root.
 * @returns The gzipped sizes.
 */
function buildAndWeigh(key: string): BundleWeights {
  const directory = fileURLToPath(new URL(`../${key}`, import.meta.url));
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], {
    cwd: directory,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  });

  const distDirectory = join(directory, "dist");
  const html = readFileSync(join(distDirectory, "index.html"), "utf8");
  const entryMatch = /<script[^>]+src="(?<src>[^"]+\.js)"/u.exec(html);
  const entrySource = entryMatch?.groups?.["src"];
  if (entrySource === undefined) {
    throw new Error(`${key}/dist/index.html loads no module script; the build produced no entry chunk.`);
  }
  const entryPath = join(distDirectory, entrySource.replace(/^\//u, ""));
  const entryGzipBytes = gzipSync(readFileSync(entryPath)).byteLength;

  const assetsDirectory = dirname(entryPath);
  const chunks = readdirSync(assetsDirectory).filter((name) => name.endsWith(".js"));
  let totalGzipBytes = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const name = chunks[index];
    if (name !== undefined) {
      totalGzipBytes += gzipSync(readFileSync(join(assetsDirectory, name))).byteLength;
    }
  }
  return { entryGzipBytes, totalGzipBytes, chunkCount: chunks.length };
}

describe.each(SUBJECTS)("$key", ({ key }) => {
  it("keeps its first-load JavaScript inside the committed ceiling", { timeout: BUILD_TIMEOUT_MS }, () => {
    const baseline = baselines.bundles[key];
    const weights = buildAndWeigh(key);
    expect(weights.chunkCount).toBeGreaterThan(0);
    expect(
      weights.entryGzipBytes,
      `${key}: the entry chunk gzips to ${String(weights.entryGzipBytes)} bytes ` +
        `(${String(weights.chunkCount)} chunks, ${String(weights.totalGzipBytes)} bytes in total). ` +
        `The ceiling in baselines.json is ${String(baseline.ceilingBytes)}, set from a measurement of ` +
        `${String(baseline.gzipBytes)}.`,
    ).toBeLessThanOrEqual(baseline.ceilingBytes);
  });
});
