// Captures the committed poster for every catalogue entry into `website/public/examples/`, in the
// three formats the `<picture>` element on the gallery and the viewer page use. Run it from the
// repository root:
//
//   pnpm --filter @ignifx/website exec node examples/_tools/capture-posters.ts
//   pnpm --filter @ignifx/website exec node examples/_tools/capture-posters.ts pbr-model
//
// It is a script and not a Playwright test on purpose, and the reason is the repository's rule
// rather than taste: a test never writes into `website/public/`. `tests/visual/tests/
// examples.spec.ts` compares a *golden* of the same frame; this writes the art.
//
// ## What it does
//
// 1. Builds every kit example into a **temporary** directory, never `website/dist/`, so two people
//    can capture different slugs at the same time and neither disturbs a site build.
// 2. Previews that directory on the first free port in the range below.
// 3. Opens `/examples/<slug>/run/?static=1&nopanel=1&seed=1` at 1280x720 in Chromium on
//    SwiftShader — the flags, and the platform switch, from `tests/visual/playwright.config.ts` —
//    and waits for `window.__ignifxReady`.
// 4. Writes `<slug>.png`, `.webp` and `.avif` with `sharp`, each inside the 120 KB budget
//    (`06-engineering.md` §2.4).
//
// A catalogue entry with a `template` is a whole Vite project of its own, so it is built with its
// own package script and previewed from its own directory, and captured at `?static=1&hud=1` — the
// template's deterministic frame with its HUD left on, which is what `tests/visual/scripts/
// capture-gallery.ts` used to do for the gallery this replaces.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import sharp from "sharp";
import { CATALOGUE } from "../catalogue.ts";
import { viteEntry } from "./vite-bin.ts";
import type { ExampleEntry } from "../catalogue.ts";
import type { ChildProcess } from "node:child_process";
import type { Browser } from "playwright";

/** The repository root, three levels above this file. */
const REPO = resolve(import.meta.dirname, "..", "..", "..");

/** The website package's directory. */
const WEBSITE = join(REPO, "website");

/** Where the posters are written. The site serves them as `/examples/<slug>.<ext>`. */
const OUT_DIR = join(WEBSITE, "public", "examples");

/** The capture size: 16:9, and the size the gallery cards and the viewer's frame are laid out for. */
const VIEWPORT = { width: 1280, height: 720 } as const;

/**
 * What one poster may weigh, per format, in bytes (`06-engineering.md` §2.4: "120 KB").
 *
 * @remarks
 * The decimal reading of "KB", deliberately: it is the stricter of the two, so a poster that fits
 * here also fits a test that reads the budget as 120 KiB. The hero's PNG fallback lands within a
 * few hundred bytes of the ceiling either way, which is exactly the case where the ambiguity would
 * have mattered.
 */
const MAX_BYTES = 120_000;

/**
 * The ports a preview server may bind.
 *
 * @remarks
 * A range rather than a fixed port, and the first free one wins: two captures of different slugs
 * have to be able to run at once. The range is deliberately clear of `tests/visual`'s 4173-4179.
 */
const PORTS: readonly number[] = Object.freeze([5180, 5181, 5182, 5183, 5184, 5185, 5186, 5187, 5188, 5189]);

/** How long a build is given, in milliseconds. */
const BUILD_TIMEOUT_MS = 300_000;

/** How long a preview server is given to bind, in milliseconds. */
const SERVE_TIMEOUT_MS = 60_000;

/** How long a page is given to report ready, in milliseconds. */
const READY_TIMEOUT_MS = 120_000;

/** Chromium flags for a SwiftShader WebGPU adapter; `tests/visual/playwright.config.ts` §Linux. */
const chromiumArgs: readonly string[] =
  process.platform === "linux"
    ? [
        "--enable-unsafe-webgpu",
        "--use-webgpu-adapter=swiftshader",
        "--enable-features=Vulkan",
        "--use-vulkan=swiftshader",
        "--use-angle=swiftshader",
      ]
    : ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader"];

/**
 * Runs one command to completion.
 *
 * @param command - The executable.
 * @param args - Its arguments.
 * @param cwd - The working directory.
 * @returns A promise that settles when the command exits zero, and rejects otherwise.
 */
function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise<void>((settle, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args.join(" ")} timed out`));
    }, BUILD_TIMEOUT_MS);
    child.on("exit", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        settle();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}`));
      }
    });
  });
}

/**
 * Whether a TCP port is free on the loopback interface.
 *
 * @param port - The port to try.
 * @returns `true` when a server could bind it.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((settle) => {
    const probe = createServer();
    probe.once("error", () => {
      settle(false);
    });
    probe.once("listening", () => {
      probe.close(() => {
        settle(true);
      });
    });
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * Finds the first free port in {@link PORTS}.
 *
 * @returns The port.
 * @throws An `Error` when every port in the range is taken.
 */
async function freePort(): Promise<number> {
  for (const port of PORTS) {
    // Probing ports is sequential by definition: the answer to "is 5180 free" decides whether 5181
    // is even asked about.
    // oxlint-disable-next-line no-await-in-loop -- see above.
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(`every port in ${PORTS.join(", ")} is in use.`);
}

/**
 * Waits until a URL answers.
 *
 * @param url - The URL to poll.
 * @param errors - Whatever the server has written to stderr, for the failure message.
 * @returns A promise that settles once the server is up.
 */
async function waitForServer(url: string, errors: () => string): Promise<void> {
  const deadline = Date.now() + SERVE_TIMEOUT_MS;
  for (;;) {
    try {
      // Polling until a server binds is sequential by definition.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      await fetch(url);
      // Any answer at all means the server is listening. Not `response.ok`: the examples build has
      // `base: "/examples/"`, so `vite preview` answers 404 at the origin's root and a readiness
      // check that insisted on 200 there would wait out its whole timeout.
      return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`${url} did not answer within ${String(SERVE_TIMEOUT_MS)} ms.\n${errors()}`);
    }
    // oxlint-disable-next-line no-await-in-loop -- the wait between polls, same reason.
    await new Promise<void>((settle) => {
      setTimeout(settle, 250);
    });
  }
}

/** A running preview server, and how to stop it. */
interface Preview {
  /** The origin the server answers on. */
  readonly origin: string;
  /** Kills the server and waits for its port to be released. */
  stop(): Promise<void>;
}

/**
 * Starts `vite preview` on a free port.
 *
 * @remarks
 * Vite's own binary, not `pnpm exec vite`: the wrapper forks, so killing it leaves the port bound
 * — a finding `tests/visual/scripts/capture-gallery.ts` recorded after the sixth cycle of a loop
 * stopped binding at all. One process, one group, one port.
 *
 * @param cwd - The package directory `vite` runs in, so it picks up the right config.
 * @param args - Extra `vite preview` arguments, such as `--config` and `--outDir`.
 * @returns The running server.
 */
async function preview(cwd: string, args: readonly string[]): Promise<Preview> {
  const port = await freePort();
  const server: ChildProcess = spawn(
    process.execPath,
    [viteEntry(cwd), "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", ...args],
    { cwd, stdio: ["ignore", "ignore", "pipe"], detached: true },
  );
  let stderr = "";
  server.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString("utf8");
  });
  const origin = `http://127.0.0.1:${String(port)}`;
  const stop = async (): Promise<void> => {
    const pid = server.pid;
    if (pid !== undefined) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    // The port has to be free before the next server binds.
    await new Promise<void>((settle) => {
      setTimeout(settle, 500);
    });
  };
  try {
    await waitForServer(`${origin}/`, (): string => stderr);
  } catch (error: unknown) {
    await stop();
    throw error;
  }
  return { origin, stop };
}

/**
 * Opens one page and screenshots it.
 *
 * @param browser - The browser.
 * @param url - The page, query flags included.
 * @returns The PNG Chromium produced.
 * @throws An `Error` when the page reports an error or does not get a WebGPU device.
 */
async function shoot(browser: Browser, url: string): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
  const failures: string[] = [];
  page.on("pageerror", (error: Error) => {
    failures.push(error.message);
  });
  try {
    await page.goto(url, { waitUntil: "load", timeout: READY_TIMEOUT_MS });
    // Every kit example and every template resolves this only after a settled frame is on screen.
    const status: unknown = await page.evaluate("window.__ignifxReady");
    if (failures.length > 0) {
      throw new Error(`${url} reported errors: ${failures.join(" | ")}`);
    }
    if (status !== "ready") {
      throw new Error(`${url} reported ${String(status)} rather than "ready".`);
    }
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}

/** One written poster. */
interface Written {
  /** The file extension, without the dot. */
  readonly format: string;
  /** The file's size, in bytes. */
  readonly bytes: number;
  /** How it was produced, for the console line. */
  readonly how: string;
}

/**
 * Encodes a screenshot as WebP or AVIF, inside the budget.
 *
 * @remarks
 * Lossless is used when it is **smaller** than the quality-82 encode, and otherwise the quality
 * ladder runs. That one comparison sorts the two kinds of frame apart with no magic number: a 2D
 * template's pixel art measured 8 592 bytes lossless against 94 136 at quality 82 — a lossy encoder
 * spends its bits on sharp edges it cannot reproduce — while the hero's photographic frame measured
 * 122 002 lossless against 13 144. Where lossless loses, fidelity is given up rather than
 * resolution: these are the two formats a modern browser actually loads, and a gallery card is
 * 400 px wide.
 *
 * @param png - The screenshot.
 * @param format - `"webp"` or `"avif"`.
 * @returns The bytes and how they were made.
 */
async function encodeLossy(png: Buffer, format: "avif" | "webp"): Promise<{ bytes: Buffer; how: string }> {
  const image = sharp(png);
  const encode = (options: { quality?: number; lossless?: boolean }): Promise<Buffer> =>
    format === "webp"
      ? image
          .clone()
          .webp({ ...options, effort: 6 })
          .toBuffer()
      : image
          .clone()
          .avif({ ...options, effort: 6 })
          .toBuffer();

  const [lossless, best] = await Promise.all([encode({ lossless: true }), encode({ quality: 82 })]);
  if (lossless.byteLength <= best.byteLength && lossless.byteLength <= MAX_BYTES) {
    return { bytes: lossless, how: "lossless" };
  }
  if (best.byteLength <= MAX_BYTES) {
    return { bytes: best, how: "q82" };
  }
  let last: Buffer = best;
  for (const quality of [70, 58, 45, 34]) {
    // Each attempt depends on the previous one's size, so this loop is sequential by nature.
    // oxlint-disable-next-line no-await-in-loop -- see above.
    const encoded = await encode({ quality });
    last = encoded;
    if (encoded.byteLength <= MAX_BYTES) {
      return { bytes: encoded, how: `q${String(quality)}` };
    }
  }
  return { bytes: last, how: "q34, over budget" };
}

/**
 * Encodes a screenshot as a PNG inside the budget.
 *
 * @remarks
 * The PNG exists for `<picture>`'s fallback only, so it is the one format allowed to lose
 * resolution: 120 KB of lossless PNG cannot hold a lit 1280x720 3D frame — the two 3D templates
 * measured 572 KB and 410 KB when `capture-gallery.ts` tried. So it steps down in resolution first
 * and reaches for a palette only when that is not enough, and reports which step paid.
 *
 * @param png - The screenshot.
 * @returns The bytes and how they were made.
 */
async function encodePng(png: Buffer): Promise<{ bytes: Buffer; how: string }> {
  const lossless = await sharp(png).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  if (lossless.byteLength <= MAX_BYTES) {
    return { bytes: lossless, how: "lossless" };
  }
  // Resolution before colour. A palette destroys a smooth gradient — the hero's dark backdrop
  // banded visibly at 128 colours — while a smaller lossless image only loses sharpness, and this
  // file is `<picture>`'s fallback rather than the image a modern browser loads.
  let last: Buffer = lossless;
  for (const width of [1024, 896, 768, 640]) {
    // oxlint-disable-next-line no-await-in-loop -- each attempt depends on the previous size.
    const smaller = await sharp(png).resize({ width }).png({ compressionLevel: 9, effort: 10 }).toBuffer();
    last = smaller;
    if (smaller.byteLength <= MAX_BYTES) {
      return { bytes: smaller, how: `${String(width)}px wide, lossless` };
    }
  }
  for (const colours of [128, 64, 32]) {
    // oxlint-disable-next-line no-await-in-loop -- same reason.
    const quantised = await sharp(png)
      .resize({ width: 640 })
      .png({ compressionLevel: 9, effort: 10, palette: true, colours, dither: 1 })
      .toBuffer();
    if (quantised.byteLength <= MAX_BYTES) {
      return { bytes: quantised, how: `640px wide, ${String(colours)}-colour palette` };
    }
  }
  return { bytes: last, how: "640px wide, over budget" };
}

/**
 * Writes one entry's three posters.
 *
 * @param slug - The entry's slug, which is the file stem.
 * @param png - The screenshot.
 * @returns One record per format.
 */
async function writePosters(slug: string, png: Buffer): Promise<readonly Written[]> {
  await mkdir(OUT_DIR, { recursive: true });
  const [webp, avif, fallback] = await Promise.all([
    encodeLossy(png, "webp"),
    encodeLossy(png, "avif"),
    encodePng(png),
  ]);
  const written: Written[] = [];
  for (const [format, result] of [
    ["png", fallback],
    ["webp", webp],
    ["avif", avif],
  ] as const) {
    // eight files at most; writing them in order keeps the console output in order too.
    // oxlint-disable-next-line no-await-in-loop -- three small writes, in reporting order.
    await writeFile(join(OUT_DIR, `${slug}.${format}`), result.bytes);
    written.push({ format, bytes: result.bytes.byteLength, how: result.how });
  }
  return written;
}

/**
 * Reports one entry's three posters on stdout, and whether any of them missed the budget.
 *
 * @param slug - The entry's slug.
 * @param written - What {@link writePosters} wrote.
 * @returns How many formats are over budget.
 */
function report(slug: string, written: readonly Written[]): number {
  let over = 0;
  for (const file of written) {
    const flag = file.bytes > MAX_BYTES ? "  OVER BUDGET" : "";
    process.stdout.write(
      `${slug.padEnd(18)} ${file.format.padEnd(5)} ${String(file.bytes).padStart(7)} bytes  ${file.how}${flag}\n`,
    );
    if (file.bytes > MAX_BYTES) {
      over += 1;
    }
  }
  return over;
}

/**
 * Builds every kit example once, previews the build, and captures each one.
 *
 * @param browser - The browser to open pages in.
 * @param entries - The kit-example catalogue entries.
 * @returns How many written formats are over budget.
 */
async function captureKitExamples(browser: Browser, entries: readonly ExampleEntry[]): Promise<number> {
  // One build for every kit example, into a directory the site build never looks at. The examples
  // build stages into `.examples-build` and publishes into its `examples` sibling, so the build and
  // the preview name different directories — see `examples/vite.config.ts`.
  const scratch = await mkdtemp(join(tmpdir(), "ignifx-posters-"));
  const staging = join(scratch, ".examples-build");
  const outDir = join(scratch, "examples");
  let over = 0;
  try {
    const config = ["--config", "examples/vite.config.ts"];
    await run(process.execPath, [viteEntry(WEBSITE), "build", ...config, "--outDir", staging], WEBSITE);
    const server = await preview(WEBSITE, [...config, "--outDir", outDir]);
    try {
      for (const entry of entries) {
        // One page at a time: two WebGPU contexts on one SwiftShader adapter measure each other.
        // oxlint-disable-next-line no-await-in-loop -- see above.
        const png = await shoot(browser, `${server.origin}/examples/${entry.slug}/run/?static=1&nopanel=1&seed=1`);
        // oxlint-disable-next-line no-await-in-loop -- same reason.
        over += report(entry.slug, await writePosters(entry.slug, png));
      }
    } finally {
      await server.stop();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return over;
}

/**
 * Builds one template with its own package script and captures its run frame.
 *
 * @remarks
 * `?static=1&hud=1` is the template's deterministic frame with its DOM overlay left on — the frame
 * `tests/visual/scripts/capture-gallery.ts` took for the gallery this replaces. The build goes into
 * the template's own `dist/`, which is what its `preview` script serves; nothing in `website/` is
 * touched.
 *
 * @param browser - The browser to open a page in.
 * @param entry - The catalogue entry, whose `template` names the directory under `templates/`.
 * @returns How many written formats are over budget.
 */
async function captureTemplate(browser: Browser, entry: ExampleEntry): Promise<number> {
  const name = entry.template ?? "";
  const directory = join(REPO, "templates", name);
  await run("pnpm", ["--filter", `ignifx-template-${name}`, "run", "build"], REPO);
  const server = await preview(directory, []);
  try {
    const png = await shoot(browser, `${server.origin}/?static=1&hud=1`);
    return report(entry.slug, await writePosters(entry.slug, png));
  } finally {
    await server.stop();
  }
}

const wanted = process.argv.slice(2);
const subjects = wanted.length === 0 ? CATALOGUE : CATALOGUE.filter((e: ExampleEntry) => wanted.includes(e.slug));
if (subjects.length === 0) {
  throw new Error(`no such example: ${wanted.join(", ")}`);
}
const kitExamples = subjects.filter((e: ExampleEntry) => e.template === undefined);
const templates = subjects.filter((e: ExampleEntry) => e.template !== undefined);

const browser = await chromium.launch({ channel: "chromium", headless: true, args: [...chromiumArgs] });
let over = 0;
try {
  if (kitExamples.length > 0) {
    over += await captureKitExamples(browser, kitExamples);
  }
  for (const entry of templates) {
    // One template at a time, for the same reason a kit example is captured one page at a time.
    // oxlint-disable-next-line no-await-in-loop -- see above.
    over += await captureTemplate(browser, entry);
  }
} finally {
  await browser.close();
}

if (over > 0) {
  process.stdout.write(`${String(over)} poster(s) are over the ${String(MAX_BYTES)}-byte budget.\n`);
  process.exitCode = 1;
}
