/** Generates the site's identity assets without publishing the archived press kit. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharpImage from "sharp";
import { buildIco } from "../press/ico.ts";
import { openWeight600, outline } from "../press/type.ts";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "public/brand");
const master = await readFile(path.join(import.meta.dirname, "ignifx-mark.svg"));
const font = openWeight600(
  path.join(root, "node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2"),
);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "mark.svg"), master);

/**
 * Renders the vector master at a square pixel size.
 * @param size - Image width and height in pixels.
 * @returns Transparent PNG bytes.
 */
function icon(size: number): Promise<Buffer> {
  return sharpImage(master, { density: 384 }).resize(size, size).png().toBuffer();
}

await Promise.all(
  [32, 64, 96, 128, 256, 512].map(async (size) => {
    await writeFile(path.join(output, `mark-${String(size)}.png`), await icon(size));
  }),
);
const icoEntries = await Promise.all(
  [16, 32, 48].map(async (size) => {
    const png = await icon(size);
    if (size !== 48) {
      await writeFile(path.join(root, `public/favicon-${String(size)}.png`), png);
    }
    return { size, png };
  }),
);
await writeFile(path.join(root, "public/favicon.ico"), buildIco(icoEntries));
await sharpImage({ create: { width: 180, height: 180, channels: 3, background: "#14181f" } })
  .composite([{ input: await icon(136), left: 22, top: 22 }])
  .png()
  .toFile(path.join(root, "public/apple-touch-icon.png"));

/**
 * Sets Archivo as outlines, so exported logos need no installed fonts.
 * @param text - Text to draw.
 * @param size - Font size in pixels.
 * @param x - Horizontal origin.
 * @param baseline - Baseline position.
 * @param fill - Text colour.
 * @returns An SVG path element.
 */
function lettering(text: string, size: number, x: number, baseline: number, fill: string): string {
  const shaped = outline(font, text, { size, trackingEm: -0.02, originX: x, baselineY: baseline });
  return `<path fill="${fill}" d="${shaped.data}"/>`;
}

/**
 * Wraps an SVG drawing with explicit dimensions.
 * @param width - Canvas width.
 * @param height - Canvas height.
 * @param body - SVG drawing elements.
 * @returns SVG document bytes.
 */
function document(width: number, height: number, body: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">${body}</svg>`,
  );
}

/**
 * Places the vector mark without embedding a raster.
 * @param x - Left edge of the icon box.
 * @param y - Top edge of the icon box.
 * @param size - Icon box width and height.
 * @returns An SVG group containing the mark.
 */
function mark(x: number, y: number, size: number): string {
  const body = master
    .toString()
    .replace(/^[\s\S]*?<svg[^>]*>/u, "")
    .replace(/<\/svg>\s*$/u, "");
  return `<g transform="translate(${String(x)} ${String(y)}) scale(${String(size / 80)})">${body}</g>`;
}

await Promise.all(
  (
    [
      ["light", "#14181f"],
      ["dark", "#eef0f4"],
    ] as const
  ).map(async ([theme, ink]) => {
    const logo = document(400, 128, mark(0, 12, 104) + lettering("ignifx", 108, 116, 93, ink));
    await writeFile(path.join(output, `logo-${theme}.svg`), logo);
  }),
);

const social = document(
  1200,
  630,
  '<rect width="1200" height="630" fill="#14181f"/>' +
    mark(64, 64, 112) +
    lettering("ignifx", 104, 196, 148, "#eef0f4") +
    lettering("Make games", 88, 80, 345, "#eef0f4") +
    lettering("in TypeScript.", 88, 80, 435, "#eef0f4") +
    lettering("2D and 3D · Browser and desktop", 28, 84, 547, "#aeb7c5") +
    '<path stroke="#d85a16" stroke-width="4" d="M84 487H1116"/>',
);
await sharpImage(social).png().toFile(path.join(output, "social-1200x630.png"));

const preview = document(
  1200,
  480,
  '<rect width="600" height="480" fill="#eef0f4"/><rect x="600" width="600" height="480" fill="#14181f"/>' +
    mark(94, 118, 120) +
    lettering("ignifx", 112, 234, 208, "#14181f") +
    mark(694, 118, 120) +
    lettering("ignifx", 112, 834, 208, "#eef0f4") +
    [16, 24, 32, 48].map((size, index) => mark(132 + index * 80, 326 - size / 2, size)).join("") +
    [16, 24, 32, 48].map((size, index) => mark(732 + index * 80, 326 - size / 2, size)).join(""),
);
await sharpImage(preview)
  .png()
  .toFile(path.join(import.meta.dirname, "preview.png"));
process.stdout.write("Generated site logos, icons, social card and brand preview.\n");
