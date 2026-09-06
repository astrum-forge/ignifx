// Captures one 1280x720 PNG per app into `website/public/gallery/`, which is where the website
// reads `/gallery/<name>.png` from. Run it from the repository root with:
//
//   pnpm --filter ignifx-visual-tests run capture:gallery
//   pnpm --filter ignifx-visual-tests run capture:gallery 3d-third-person   # just one
//
// It is a script and not a Playwright test on purpose: nothing here is an assertion, the output is
// committed art rather than a golden, and `pnpm test:visual` should not be writing into the
// website's public directory as a side effect.
//
// Each app is built, previewed, opened at `?static=1&hud=1` — the deterministic frame the goldens
// use, with the DOM overlay left on so the HUD is in the picture — and screenshotted. The PNG
// Chromium hands back is then re-filtered and deflated at level 9; see `optimise` for what happens
// to a 3D frame that will not fit in the budget losslessly.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { deflateSync, inflateSync } from "node:zlib";
import { chromium } from "playwright";
import type { ChildProcess } from "node:child_process";
import type { Browser } from "playwright";

/** The repository root, two levels above this file. */
const REPO = join(import.meta.dirname, "..", "..", "..");

/** Where the PNGs go. The website reads them as `/gallery/<name>.png`. */
const OUT_DIR = join(REPO, "website", "public", "gallery");

/** The capture size. 16:9, and the size the website's cards are laid out for. */
const VIEWPORT = { width: 1280, height: 720 } as const;

/** The size a capture may not exceed, in bytes. */
const MAX_BYTES = 300 * 1024;

/** How long a build is given, in milliseconds. */
const BUILD_TIMEOUT_MS = 300_000;

/** How long a preview server is given to bind, in milliseconds. */
const SERVE_TIMEOUT_MS = 60_000;

/** One app to capture. */
interface Subject {
  /** The written file's stem, which is the name the website uses. */
  readonly name: string;
  /** The workspace package, for the build. */
  readonly packageName: string;
  /** The package's directory, relative to the repository root, for the preview server. */
  readonly directory: string;
  /**
   * The port `vite preview` binds.
   *
   * @remarks
   * Kept clear of the 4173-4178 the golden suite uses, and out of the 41xx range for a second
   * reason: 4190 is `sieve` on the WHATWG Fetch specification's **bad port** list, and Node's
   * `fetch` refuses it with `Error: bad port` while `curl` and the browser connect happily. The
   * preview server binds and the poller can never see it. 51xx is on no such list.
   */
  readonly port: number;
  /** The query flags appended to the preview URL. */
  readonly query: string;
}

const SUBJECTS: readonly Subject[] = [
  {
    name: "2d-topdown",
    packageName: "ignifx-template-2d-topdown",
    directory: "templates/2d-topdown",
    port: 5181,
    query: "?static=1&hud=1",
  },
  {
    name: "2d-sidescroller",
    packageName: "ignifx-template-2d-sidescroller",
    directory: "templates/2d-sidescroller",
    port: 5182,
    query: "?static=1&hud=1",
  },
  {
    name: "3d-third-person",
    packageName: "ignifx-template-3d-third-person",
    directory: "templates/3d-third-person",
    port: 5183,
    query: "?static=1&hud=1",
  },
  {
    name: "3d-first-person",
    packageName: "ignifx-template-3d-first-person",
    directory: "templates/3d-first-person",
    port: 5184,
    query: "?static=1&hud=1",
  },
  {
    name: "hello-cube",
    packageName: "ignifx-example-hello-cube",
    directory: "examples/hello-cube",
    port: 5185,
    query: "?static=1",
  },
  {
    name: "gltf-viewer",
    packageName: "ignifx-example-gltf-viewer",
    directory: "examples/gltf-viewer",
    port: 5186,
    query: "?static=1",
  },
];

/** The eight bytes every PNG starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The CRC-32 lookup table PNG chunks are checked with, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Computes the CRC-32 of a byte range, as PNG's chunk trailer defines it.
 *
 * @param bytes - The bytes to check.
 * @returns The checksum, as an unsigned 32-bit integer.
 */
function crc32(bytes: Buffer): number {
  let c = 0xff_ff_ff_ff;
  for (let index = 0; index < bytes.length; index += 1) {
    c = (CRC_TABLE[(c ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

/**
 * Wraps a payload in a PNG chunk: length, type, data, CRC.
 *
 * @param type - The four-character chunk type, for example `"IHDR"`.
 * @param data - The chunk's payload.
 * @returns The complete chunk.
 */
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** One decoded image. */
interface Decoded {
  /** The `IHDR` chunk, reused verbatim. */
  readonly header: Buffer;
  /** The image width, in pixels. */
  readonly width: number;
  /** The image height, in pixels. */
  readonly height: number;
  /** How many bytes one pixel occupies. */
  readonly channels: number;
  /** How many bytes one row occupies. */
  readonly stride: number;
  /** The unfiltered pixels, row-major. */
  readonly pixels: Buffer;
}

/**
 * Undoes a PNG's per-scanline filters.
 *
 * @param png - The file Chromium produced.
 * @returns The decoded image, or `null` when the file is not an 8-bit RGB or RGBA PNG.
 */
function decode(png: Buffer): Decoded | null {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  let header: Buffer | null = null;
  const parts: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = Buffer.from(body);
    } else if (type === "IDAT") {
      parts.push(Buffer.from(body));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (header === null || parts.length === 0 || header[8] !== 8) {
    return null;
  }
  const colourType = header[9];
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (channels === 0) {
    return null;
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  const pixels = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read] ?? 0;
    read += 1;
    for (let x = 0; x < stride; x += 1) {
      const current = raw[read + x] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      pixels[y * stride + x] = (current + reverseFilter(filter, left, up, upLeft)) & 0xff;
    }
    read += stride;
  }
  return { header, width, height, channels, stride, pixels };
}

/**
 * The predictor one PNG filter type adds back.
 *
 * @param filter - The filter type, 0 to 4.
 * @param left - The byte to the left, or 0.
 * @param up - The byte above, or 0.
 * @param upLeft - The byte above and to the left, or 0.
 * @returns What the filter subtracted when the row was written.
 */
function reverseFilter(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 1: {
      return left;
    }
    case 2: {
      return up;
    }
    case 3: {
      return (left + up) >> 1;
    }
    case 4: {
      return paeth(left, up, upLeft);
    }
    default: {
      return 0;
    }
  }
}

/**
 * PNG's Paeth predictor.
 *
 * @param left - The byte to the left.
 * @param up - The byte above.
 * @param upLeft - The byte above and to the left.
 * @returns Whichever neighbour the gradient points at.
 */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) {
    return left;
  }
  return du <= dul ? up : upLeft;
}

/**
 * Re-filters an image, choosing per row the filter whose output has the smallest total magnitude —
 * the heuristic the PNG specification recommends.
 *
 * @param image - The decoded image.
 * @returns The filtered scanlines, ready for `deflate`.
 */
function refilter(image: Decoded): Buffer {
  const { height, stride, channels, pixels } = image;
  const out = Buffer.alloc(height * (1 + stride));
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    let bestFilter = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    let best: Buffer | null = null;
    for (let filter = 0; filter <= 4; filter += 1) {
      let score = 0;
      for (let x = 0; x < stride; x += 1) {
        const current = pixels[y * stride + x] ?? 0;
        const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
        const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
        const upLeft = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
        const value = (current - reverseFilter(filter, left, up, upLeft)) & 0xff;
        candidate[x] = value;
        score += value > 127 ? 256 - value : value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best = Buffer.from(candidate);
      }
    }
    out[y * (1 + stride)] = bestFilter;
    best?.copy(out, y * (1 + stride) + 1);
  }
  return out;
}

/**
 * Rounds every colour channel to `bits` bits, which is what buys the last of the size when a busy
 * 3D frame will not fit inside the budget losslessly.
 *
 * @param image - The decoded image.
 * @param bits - How many bits per channel to keep, 1 to 8.
 * @returns A copy with the low bits rounded to the middle of their bucket.
 */
function posterise(image: Decoded, bits: number): Decoded {
  const mask = (0xff << (8 - bits)) & 0xff;
  const half = (1 << (8 - bits)) >> 1;
  const pixels = Buffer.from(image.pixels);
  for (let index = 0; index < pixels.length; index += 1) {
    // Alpha is left alone: a screenshot is fully opaque, and rounding it is the one change that
    // could make the image translucent.
    if (image.channels === 4 && index % 4 === 3) {
      continue;
    }
    pixels[index] = Math.min(255, ((pixels[index] ?? 0) & mask) + half);
  }
  return { ...image, pixels };
}

/**
 * Rebuilds a PNG from filtered scanlines.
 *
 * @param header - The `IHDR` payload to reuse.
 * @param filtered - The filtered scanlines.
 * @returns The complete file.
 */
function encode(header: Buffer, filtered: Buffer): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** What {@link optimise} did to a capture. */
interface Optimised {
  /** The file to write. */
  readonly bytes: Buffer;
  /** How it was produced, for the console line. */
  readonly how: string;
}

/**
 * Squeezes a screenshot into the size budget.
 *
 * @remarks
 * The first attempt is **lossless**: the scanlines are re-filtered with the specification's
 * minimum-sum heuristic, deflated at level 9, and every ancillary chunk a screenshot carries
 * (`pHYs`, `tEXt`, `sRGB`) is dropped. That is enough for a 2D template and for `hello-cube`.
 *
 * A 1280 by 720 frame of a lit, 4x-multisampled 3D scene is a different animal: it has hundreds of
 * thousands of distinct colours, and no lossless PNG of it fits in 300 KB — the two 3D templates
 * measure 572 KB and 410 KB. Rounding each channel to 6 bits (64 levels) halves them, to 275 KB and
 * 205 KB, and it is invisible on a gallery card because the one gradient in the frame — the sky —
 * is already dithered by the generator that drew it. The step to 5 bits exists as a last resort and
 * is reported when it is used.
 *
 * @param png - The file Chromium produced.
 * @param maxBytes - The budget.
 * @returns The bytes to write and a word saying how they were made.
 */
function optimise(png: Buffer, maxBytes: number): Optimised {
  const image = decode(png);
  if (image === null) {
    return { bytes: png, how: "unchanged" };
  }
  const lossless = encode(image.header, refilter(image));
  if (lossless.length <= maxBytes) {
    return { bytes: lossless, how: "lossless" };
  }
  for (const bits of [6, 5]) {
    const smaller = encode(image.header, refilter(posterise(image, bits)));
    if (smaller.length <= maxBytes) {
      return { bytes: smaller, how: `${String(bits)}-bit colour` };
    }
  }
  return { bytes: lossless, how: "lossless, over budget" };
}

/**
 * Runs one command to completion.
 *
 * @param command - The executable.
 * @param args - Its arguments.
 * @returns A promise that settles when the command exits zero, and rejects otherwise.
 */
function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: REPO, stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args.join(" ")} timed out`));
    }, BUILD_TIMEOUT_MS);
    child.on("exit", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}`));
      }
    });
  });
}

/**
 * Waits until a URL answers.
 *
 * @param url - The URL to poll.
 * @returns A promise that settles once the server is up.
 */
async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + SERVE_TIMEOUT_MS;
  for (;;) {
    try {
      // Polling until a server binds is sequential by definition; nothing here can run in parallel.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`${url} did not answer within ${String(SERVE_TIMEOUT_MS)} ms`);
    }
    // oxlint-disable-next-line no-await-in-loop -- the wait between polls, same reason.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250);
    });
  }
}

/**
 * Captures one app.
 *
 * @param browser - The browser to open a page in.
 * @param subject - The app.
 * @returns The written file's size, in bytes.
 */
async function capture(browser: Browser, subject: Subject): Promise<number> {
  await run("pnpm", ["--filter", subject.packageName, "run", "build"]);
  // Vite's own binary, not `pnpm --filter … exec vite`: the wrapper forks, so killing it leaves the
  // port bound, and after five cycles the sixth `pnpm exec` stopped binding at all. One process,
  // one group, one port.
  const packageDirectory = join(REPO, subject.directory);
  const server: ChildProcess = spawn(
    join(packageDirectory, "node_modules", ".bin", "vite"),
    ["preview", "--host", "127.0.0.1", "--port", String(subject.port), "--strictPort"],
    { cwd: packageDirectory, stdio: ["ignore", "ignore", "pipe"], detached: true },
  );
  let serverErrors = "";
  server.stderr?.on("data", (data: Buffer) => {
    serverErrors += data.toString("utf8");
  });
  const base = `http://127.0.0.1:${String(subject.port)}/`;
  try {
    try {
      await waitForServer(base);
    } catch (error: unknown) {
      throw new Error(`${subject.name}: the preview server never answered.\n${serverErrors}`, { cause: error });
    }
    const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
    const failures: string[] = [];
    page.on("pageerror", (error: Error) => {
      failures.push(error.message);
    });
    await page.goto(`${base}${subject.query}`, { waitUntil: "load" });
    // Every app resolves this only after it has presented a settled frame.
    const status: unknown = await page.evaluate("window.__ignifxReady");
    if (status !== "ready") {
      throw new Error(`${subject.name}: the page reported ${String(status)}`);
    }
    if (failures.length > 0) {
      throw new Error(`${subject.name}: ${failures.join(" | ")}`);
    }
    const shot = await page.screenshot({ type: "png" });
    await page.close();
    const result = optimise(Buffer.from(shot), MAX_BYTES);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${subject.name}.png`), result.bytes);
    process.stdout.write(
      `${subject.name.padEnd(20)} ${String(result.bytes.length).padStart(8)} bytes  ${result.how}\n`,
    );
    return result.bytes.length;
  } finally {
    const pid = server.pid;
    if (pid !== undefined) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
    // The port has to be free before the next subject binds the next one.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
  }
}

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  // The same flags the golden suite uses: SwiftShader keeps the image off the host GPU, so a
  // capture taken on a laptop and one taken in CI are the same picture.
  args: ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader"],
});
// Named on the command line, one or more apps are captured instead of all six — which is what a
// re-capture of a single template wants.
const wanted = process.argv.slice(2);
const subjects = wanted.length === 0 ? SUBJECTS : SUBJECTS.filter((s: Subject) => wanted.includes(s.name));
if (subjects.length === 0) {
  throw new Error(`no such app: ${wanted.join(", ")}`);
}
let over = 0;
try {
  for (const subject of subjects) {
    // Each app is built and previewed on its own port, one at a time on purpose: six concurrent
    // Vite builds would measure the machine rather than the page.
    // oxlint-disable-next-line no-await-in-loop -- see above.
    const bytes = await capture(browser, subject);
    if (bytes > MAX_BYTES) {
      over += 1;
    }
  }
} finally {
  await browser.close();
}
if (over > 0) {
  process.stdout.write(`${String(over)} capture(s) are over the ${String(MAX_BYTES)}-byte budget.\n`);
  process.exitCode = 1;
}
