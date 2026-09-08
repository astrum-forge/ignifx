// oxlint-disable no-underscore-dangle -- `window.__ignifxFrameTime` is a test hook, and the double
// underscore is what says it is not part of the game's API. This suite reads it by name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { CATALOGUE } from "../../../website/examples/catalogue.ts";
import type { ExampleEntry } from "../../../website/examples/catalogue.ts";
import type { Page } from "playwright/test";

/**
 * The frame-budget gate: each template's and each website example's **engine CPU milliseconds per
 * frame** has to stay inside the ceiling `benchmarks/baselines.json` records, and
 * `benchmarks/template-frame-time.test.ts` keeps every one of those ceilings inside the
 * coding-standards §7 budget.
 *
 * Two describe blocks, two sources of pages. The templates are previewed one per port, from their
 * own builds, as they have been since Phase 12. The website's examples come from the **site build**
 * previewed on port 4179 (`playwright.config.ts`), because a website example is a page in one
 * multi-page build rather than a package: measuring it anywhere else would measure a different
 * bundle. Their rows live under `frameTime.examples.<slug>`; the templates keep
 * `frameTime.templates.<name>`.
 *
 * ## Why CPU time and not frames per second
 *
 * This suite runs Chromium on SwiftShader, a software rasteriser. Wall-clock frame rate there
 * measures the rasteriser, not the engine: a scene that runs at 240 fps on a laptop GPU runs at
 * fifteen here, and the number would say nothing about whether an engine change made the game
 * slower. `app.diagnostics` records per-phase CPU time for every frame (`FrameSample.cpuMs`), which
 * is exactly what §7's "engine CPU per frame" budget is about, and it is the number a change to the
 * engine moves. `src/frame-time-probe.ts` in each template exposes it as
 * `window.__ignifxFrameTime(n)` under `?bench=1`.
 *
 * ## The SwiftShader factor, measured, is one
 *
 * The obvious worry is that CPU time is not free of the rasteriser either — Babylon Lite's render
 * phase builds the command encoder and writes uniform buffers on the CPU every frame. So it was
 * measured rather than assumed: each template was run twice on 2026-09-06, once on SwiftShader and
 * once on the host GPU, and the ratio of mean engine CPU came out 0.588, 0.429, 0.941 and 2.107 for
 * the four templates. SwiftShader is cheaper as often as it is dearer, because what it slows down
 * is the rasteriser and what is measured here is the CPU side of the frame. Chromium also quantises
 * `performance.now()` to 0.1 ms, which is a third of a 2D template's whole median, so most of that
 * spread is the clock. The ceilings in `baselines.json` are therefore set from the SwiftShader
 * measurement itself with about 2.5x of headroom, and each is well inside §7 with no multiplier.
 *
 * ## Where this runs
 *
 * As the Playwright `frame-budget` project, on its own: `pnpm test:frame-budget` locally, and the
 * `frame-budget` CI job on `macos-latest`. A ceiling is only a ceiling against a machine comparable
 * to the one that recorded it, and GitHub's `ubuntu-latest` is not — it measured 2.0 ms against a
 * 1.0 ms ceiling for `2d-topdown` and could not finish either 3D template's 420 frames inside the
 * timeout below (ADR-0009, "Frame budgets need a comparable machine").
 *
 * ## Determinism
 *
 * `?bench=1` builds the full scene, skips the title screen and leaves the DOM overlay off. No input
 * is simulated, so the character stands still: what is measured is the engine's per-frame cost —
 * the scene graph walk, the fixed steps, the physics, the sprite or mesh sync, the render encode —
 * on a scene that does not depend on how many frames elapsed before the measurement started.
 */

/** Where the recorded budgets live. */
const BASELINES = join(import.meta.dirname, "..", "..", "..", "benchmarks", "baselines.json");

/** How many frames are run before the first sample is kept, so nothing is warming up. */
const WARMUP_FRAMES = 120;

/** How many frames are measured. */
const MEASURED_FRAMES = 300;

/**
 * Reads one recorded ceiling out of `baselines.json`.
 *
 * @remarks
 * Narrowed with `in` at every step rather than asserted onto a declared shape: the file is read
 * from disk, and a missing row should say so rather than arrive as `undefined` inside a number.
 *
 * @param group - `"templates"` or `"examples"`, the section of `frameTime` to look in.
 * @param name - The row's key: a template's directory name, or an example's catalogue slug.
 * @returns The ceiling in milliseconds, or `null` when the file has no such row.
 */
function ceilingFor(group: "examples" | "templates", name: string): number | null {
  const parsed: unknown = JSON.parse(readFileSync(BASELINES, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("frameTime" in parsed)) {
    return null;
  }
  const frameTime: unknown = parsed.frameTime;
  if (typeof frameTime !== "object" || frameTime === null || !(group in frameTime)) {
    return null;
  }
  const rows: unknown = Object.getOwnPropertyDescriptor(frameTime, group)?.value;
  if (typeof rows !== "object" || rows === null || !(name in rows)) {
    return null;
  }
  const row: unknown = Object.getOwnPropertyDescriptor(rows, name)?.value;
  if (typeof row !== "object" || row === null || !("budgetMs" in row)) {
    return null;
  }
  const budget: unknown = row.budgetMs;
  return typeof budget === "number" ? budget : null;
}

/** Every template, with the port `playwright.config.ts` previews it on. */
const TEMPLATES = [
  ["2d-topdown", 4175],
  ["2d-sidescroller", 4176],
  ["3d-third-person", 4177],
  ["3d-first-person", 4178],
] as const;

/** Where the site build is previewed. `playwright.config.ts` owns the number. */
const SITE = "http://127.0.0.1:4179";

/**
 * The website examples that carry the kit, and are therefore measurable.
 *
 * @remarks
 * Derived from the catalogue rather than written out, so an example added to the site is measured
 * without anyone remembering to add it here — it fails on its missing `baselines.json` row instead,
 * which is the failure that tells you what to do. A catalogue entry with a `template` is skipped:
 * its run page is that template's own build, and the template is already measured above under
 * `frameTime.templates`, so measuring it twice would only produce two numbers to disagree.
 */
const EXAMPLES: readonly string[] = CATALOGUE.filter((entry: ExampleEntry) => entry.template === undefined).map(
  (entry: ExampleEntry) => entry.slug,
);

/**
 * The middle value of a list.
 *
 * @param values - The samples.
 * @returns The median, or `0` for an empty list.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((a: number, b: number) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Runs a page under `?bench=1` and answers with one engine CPU millisecond figure per measured
 * frame.
 *
 * @param page - The page under test.
 * @param url - The page to open, `?bench=1` included.
 * @returns The samples, warm-up already discarded.
 */
async function measure(page: Page, url: string): Promise<readonly number[]> {
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });
  await page.goto(url, { waitUntil: "load" });
  const status: unknown = await page.evaluate("window.__ignifxReady");
  expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  expect(status, "the browser did not give the page a WebGPU device").toBe("ready");

  const total = WARMUP_FRAMES + MEASURED_FRAMES;
  // A string body rather than a function, so nothing has to be said about `window`'s type here: the
  // probe's own module declares it, and this file only has to check what came back.
  const all: unknown = await page.evaluate(`window.__ignifxFrameTime(${String(total)})`);
  expect(Array.isArray(all), "?bench=1 did not install window.__ignifxFrameTime").toBe(true);
  const samples: number[] = [];
  if (Array.isArray(all)) {
    for (let index = WARMUP_FRAMES; index < all.length; index += 1) {
      const value: unknown = all[index];
      samples.push(typeof value === "number" ? value : Number.NaN);
    }
  }
  expect(samples).toHaveLength(MEASURED_FRAMES);
  expect(
    samples.every((value: number) => Number.isFinite(value)),
    "a frame reported a non-number",
  ).toBe(true);
  // A production build with `mode: "production"` records no per-phase timings, and every sample
  // would be exactly zero. That is a broken measurement, not a fast one.
  expect(
    samples.some((value: number) => value > 0),
    "every frame reported 0 ms of engine CPU",
  ).toBe(true);
  return samples;
}

test.describe("template frame budgets", () => {
  // The gameplay viewport, not the golden's: the cost of a frame depends on how much of the level
  // the camera can see.
  test.use({ viewport: { width: 1280, height: 720 } });
  // Three hundred frames plus a warm-up on SwiftShader is not quick.
  test.setTimeout(240_000);

  for (const [name, port] of TEMPLATES) {
    test(`${name}: median engine CPU per frame is inside the recorded ceiling`, async ({ page }) => {
      const samples = await measure(page, `http://127.0.0.1:${String(port)}/?bench=1`);
      const middle = median(samples);
      const worst = Math.max(...samples);
      const recorded = ceilingFor("templates", name);
      expect(recorded, `baselines.json has no frameTime.templates.${name}.budgetMs`).not.toBeNull();
      const ceiling = recorded ?? 0;
      // Printed so a re-record is a copy of two numbers rather than a second run.
      process.stdout.write(
        `${name.padEnd(20)} median ${middle.toFixed(4)} ms  worst ${worst.toFixed(4)} ms  ` +
          `ceiling ${ceiling.toFixed(4)} ms\n`,
      );
      expect(
        middle,
        `${name}: ${String(MEASURED_FRAMES)} frames cost ${middle.toFixed(4)} ms of engine CPU at the median ` +
          `(worst ${worst.toFixed(4)} ms). The ceiling in baselines.json is ${ceiling.toFixed(4)} ms.`,
      ).toBeLessThanOrEqual(ceiling);
    });
  }
});

test.describe("website example frame budgets", () => {
  // The same viewport as the templates, and the one the posters are captured at: the cost of a
  // frame depends on how much of the scene the camera can see.
  test.use({ viewport: { width: 1280, height: 720 } });
  test.setTimeout(240_000);

  for (const slug of EXAMPLES) {
    test(`${slug}: median engine CPU per frame is inside the recorded ceiling`, async ({ page }) => {
      // `?bench=1` speaks the same probe protocol the templates' `src/frame-time-probe.ts` does —
      // the kit installs `window.__ignifxFrameTime` under that flag — so nothing in `measure`
      // needs to know which kind of page it is looking at. It also leaves the parameter panel off,
      // so what is measured is the engine rather than four DOM writes a second.
      const samples = await measure(page, `${SITE}/examples/${slug}/run/?bench=1`);
      const middle = median(samples);
      const worst = Math.max(...samples);
      const recorded = ceilingFor("examples", slug);
      expect(recorded, `baselines.json has no frameTime.examples.${slug}.budgetMs`).not.toBeNull();
      const ceiling = recorded ?? 0;
      // Printed so a re-record is a copy of two numbers rather than a second run.
      process.stdout.write(
        `${slug.padEnd(20)} median ${middle.toFixed(4)} ms  worst ${worst.toFixed(4)} ms  ` +
          `ceiling ${ceiling.toFixed(4)} ms\n`,
      );
      expect(
        middle,
        `${slug}: ${String(MEASURED_FRAMES)} frames cost ${middle.toFixed(4)} ms of engine CPU at the median ` +
          `(worst ${worst.toFixed(4)} ms). The ceiling in baselines.json is ${ceiling.toFixed(4)} ms.`,
      ).toBeLessThanOrEqual(ceiling);
    });
  }
});
