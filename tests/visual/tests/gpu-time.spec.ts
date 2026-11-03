// oxlint-disable no-underscore-dangle -- `window.__ignifxGpuTime` is a test hook, and the double
// underscore is what says it is not part of the game's API. This suite reads it by name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import type { Page } from "playwright/test";

/**
 * The GPU budget check (coding standards §7): each 3D template's **GPU milliseconds per frame** on
 * the host GPU, at 1080p, against the ceiling `benchmarks/baselines.json` records under
 * `gpuTime.templates.<name>`.
 *
 * ## Why the host GPU
 *
 * The other suites pin SwiftShader so their results do not depend on the machine. GPU time is the
 * opposite: it is only worth reading on a real GPU, so the `gpu-budget` project launches Chromium
 * without the SwiftShader flag and this spec fails if the adapter is SwiftShader anyway. GitHub's
 * runners have no GPU, so it runs locally only (`pnpm test:gpu-budget`).
 *
 * ## What is read
 *
 * `src/frame-time-probe.ts` in each 3D template installs `window.__ignifxGpuTime(n)` under
 * `?bench=1`. It turns `renderer.profileTasks` on and, after each presented frame, keeps
 * `renderer.gpuFrameTimeMs` and the per-task snapshot of `renderer.taskTimings()` (`"shadow"`,
 * `"scene"`, post-process tasks). Timestamp readbacks land a frame or two late, so the first frames
 * read `0` and are dropped with the warm-up.
 *
 * The ceiling is on the whole frame (`gpuFrameTimeMs`). Per-task medians are printed, not asserted,
 * with the snapshot's status (`"available"` once Lite's per-task readbacks land).
 */

/** Where the recorded budgets live. */
const BASELINES = join(import.meta.dirname, "..", "..", "..", "benchmarks", "baselines.json");

/** Frames run before the first sample is kept, so pipelines and readbacks have settled. */
const WARMUP_FRAMES = 120;

/** Frames measured. */
const MEASURED_FRAMES = 300;

/** The 3D templates, with the port `playwright.config.ts` previews each on. */
const TEMPLATES = [
  ["3d-third-person", 4177],
  ["3d-first-person", 4178],
] as const;

/**
 * Reads one recorded GPU ceiling out of `baselines.json`.
 *
 * @param name - The row's key: a template's directory name.
 * @returns The ceiling in milliseconds, or `null` when the file has no such row.
 */
function ceilingFor(name: string): number | null {
  const parsed: unknown = JSON.parse(readFileSync(BASELINES, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("gpuTime" in parsed)) {
    return null;
  }
  const gpuTime: unknown = parsed.gpuTime;
  if (typeof gpuTime !== "object" || gpuTime === null || !("templates" in gpuTime)) {
    return null;
  }
  const rows: unknown = gpuTime.templates;
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
 * Keeps the numbers of an untyped list, dropping the warm-up.
 *
 * @param value - What the page answered.
 * @param skip - How many leading entries to drop.
 * @returns The numeric samples.
 */
function numbers(value: unknown, skip: number): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: number[] = [];
  for (let index = skip; index < value.length; index += 1) {
    const sample: unknown = value[index];
    if (typeof sample === "number" && Number.isFinite(sample)) {
      out.push(sample);
    }
  }
  return out;
}

/** One template's measurement. */
interface GpuMeasurement {
  readonly adapter: string;
  readonly size: string;
  readonly status: string;
  readonly frameMs: readonly number[];
  readonly taskMedians: ReadonlyMap<string, number>;
}

/**
 * Opens a template under `?bench=1` and reads its GPU time per frame.
 *
 * @param page - The page under test.
 * @param url - The page to open, `?bench=1` included.
 * @returns The adapter, canvas size, timing status, whole-frame samples and each task's median.
 */
async function measure(page: Page, url: string): Promise<GpuMeasurement> {
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });
  await page.goto(url, { waitUntil: "load" });
  const status: unknown = await page.evaluate("window.__ignifxReady");
  expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  expect(status, "the browser did not give the page a WebGPU device").toBe("ready");

  const adapter: unknown = await page.evaluate(
    "navigator.gpu.requestAdapter().then((a) => a === null ? 'none' : `${a.info.vendor} / ${a.info.architecture}`)",
  );
  const adapterName = typeof adapter === "string" ? adapter : "unknown";
  expect(adapterName, "gpu-budget must run on the host GPU, not SwiftShader").not.toMatch(/swiftshader/iu);

  const size: unknown = await page.evaluate(
    "(() => { const c = document.querySelector('canvas'); return c === null ? '?' : `${c.width}x${c.height}`; })()",
  );
  const sizeName = typeof size === "string" ? size : "?";

  const total = WARMUP_FRAMES + MEASURED_FRAMES;
  const result: unknown = await page.evaluate(`window.__ignifxGpuTime(${String(total)})`);
  expect(typeof result, "?bench=1 did not install window.__ignifxGpuTime").toBe("object");
  if (typeof result !== "object" || result === null) {
    return { adapter: adapterName, size: sizeName, status: "missing", frameMs: [], taskMedians: new Map() };
  }
  const timingStatus = "status" in result && typeof result.status === "string" ? result.status : "missing";
  const frameMs = numbers("frameMs" in result ? result.frameMs : null, WARMUP_FRAMES);
  const taskMedians = new Map<string, number>();
  if ("taskMs" in result && typeof result.taskMs === "object" && result.taskMs !== null) {
    for (const [name, samples] of Object.entries(result.taskMs)) {
      // A task's snapshots start once readbacks land, so drop a proportional warm-up.
      const list = numbers(samples, 0);
      taskMedians.set(name, median(list.slice(Math.floor(list.length * (WARMUP_FRAMES / total)))));
    }
  }
  return { adapter: adapterName, size: sizeName, status: timingStatus, frameMs, taskMedians };
}

test.describe("template GPU budgets", () => {
  // The coding-standards §7 GPU budget is written for 1080p.
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.setTimeout(240_000);

  for (const [name, port] of TEMPLATES) {
    test(`${name}: median GPU time per frame is inside the recorded ceiling`, async ({ page }) => {
      const run = await measure(page, `http://127.0.0.1:${String(port)}/?bench=1`);
      expect(run.frameMs).toHaveLength(MEASURED_FRAMES);
      expect(
        run.frameMs.some((value: number) => value > 0),
        "every frame reported 0 ms of GPU time",
      ).toBe(true);
      const middle = median(run.frameMs);
      const worst = Math.max(...run.frameMs);
      const tasks =
        run.taskMedians.size === 0
          ? "none"
          : [...run.taskMedians].map(([task, ms]) => `${task} ${ms.toFixed(3)}`).join(", ");
      const recorded = ceilingFor(name);
      // Printed so a re-record is a copy of these numbers rather than a second run.
      process.stdout.write(
        `${name.padEnd(16)} [${run.adapter}, ${run.size}] median ${middle.toFixed(3)} ms  worst ` +
          `${worst.toFixed(3)} ms  ceiling ${recorded === null ? "none" : recorded.toFixed(3)} ms  ` +
          `tasks (${run.status}): ${tasks}\n`,
      );
      expect(recorded, `baselines.json has no gpuTime.templates.${name}.budgetMs`).not.toBeNull();
      expect(
        middle,
        `${name}: median GPU time ${middle.toFixed(3)} ms; the ceiling in baselines.json is ` +
          `${String(recorded)} ms.`,
      ).toBeLessThanOrEqual(recorded ?? 0);
    });
  }
});
