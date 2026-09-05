import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import baselines from "./baselines.json" with { type: "json" };

/**
 * The bundle ceiling (`CONSTITUTION.md` §6.4, coding standards §12 step 4): `examples/hello-cube`
 * is built, its JavaScript is gzipped, and the first-load payload has to stay inside the ceiling
 * `baselines.json` records.
 *
 * ## What is measured, and what is not
 *
 * Babylon Lite code-splits aggressively: a build of this example emits close to three hundred
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

/** The example whose build is measured. */
const EXAMPLE_DIRECTORY = fileURLToPath(new URL("../examples/hello-cube", import.meta.url));

/** How long the build is given. */
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
 * Builds the example and weighs what it emitted.
 *
 * @returns The gzipped sizes.
 */
function buildAndWeigh(): BundleWeights {
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "warn"], {
    cwd: EXAMPLE_DIRECTORY,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  });

  const distDirectory = join(EXAMPLE_DIRECTORY, "dist");
  const html = readFileSync(join(distDirectory, "index.html"), "utf8");
  const entryMatch = /<script[^>]+src="(?<src>[^"]+\.js)"/u.exec(html);
  const entrySource = entryMatch?.groups?.["src"];
  if (entrySource === undefined) {
    throw new Error("dist/index.html loads no module script; the build did not produce an entry chunk.");
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

describe("examples/hello-cube", () => {
  it("keeps its first-load JavaScript inside the committed ceiling", { timeout: BUILD_TIMEOUT_MS }, () => {
    const baseline = baselines.bundles["examples/hello-cube"];
    const weights = buildAndWeigh();
    expect(weights.chunkCount).toBeGreaterThan(0);
    expect(
      weights.entryGzipBytes,
      `the entry chunk gzips to ${String(weights.entryGzipBytes)} bytes (${String(weights.chunkCount)} chunks, ` +
        `${String(weights.totalGzipBytes)} bytes in total). The ceiling in baselines.json is ` +
        `${String(baseline.ceilingBytes)}, set from a measurement of ${String(baseline.gzipBytes)}.`,
    ).toBeLessThanOrEqual(baseline.ceilingBytes);
  });
});
