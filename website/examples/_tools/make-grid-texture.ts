// Writes `website/examples/assets/textures/grid.png`, the one tile the kit's ground plane is
// covered with. Run it from the website package:
//
//   pnpm --filter @ignifx/website exec node examples/_tools/make-grid-texture.ts
//
// The output is committed. It is the repository's own art, so it carries the repository's licence
// and needs no third-party attribution — the same arrangement the templates use for their sprites
// ("every pixel comes from a committed, seeded script", `templates/2d-topdown/README.md`).
//
// ## Why a texture and not a shader
//
// A grid is the obvious job for a fragment shader, and ignifx cannot run one: the material format
// declares `"type": "shader"` and the runtime rejects it with `IGX-0708`
// (`skills/ignifx/references/formats/material.md`), which is wishlist item W-R1. A tiling texture
// is the alternative that needs no engine change: `MeshAsset.ground` takes a `uvScale`, so one
// tile per metre is `uvScale: [width, height]` and the line spacing is exact rather than fitted.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import sharp from "sharp";

/** Where the tile is written, relative to `website/examples`. */
const OUT_PATH = "assets/textures/grid.png";

/** The tile's edge length in pixels. One tile covers one metre of ground. */
const SIZE = 128;

/**
 * The line width in pixels.
 *
 * @remarks
 * Two pixels of a 128-pixel metre is 1.6 cm, which is about the width of a floor joint and wide
 * enough to survive the first mip level rather than dissolving into the fill a metre away.
 */
const LINE_PIXELS = 2;

/** The cell fill, as an 8-bit grey. White, so the material's `baseColor` factor sets the hue. */
const FILL = 255;

/** The line grey. A 22% step down from the fill: visible, and never the thing you look at. */
const LINE = 199;

const pixels = Buffer.alloc(SIZE * SIZE, FILL);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    // The line sits on the tile's low edges only, so two neighbouring tiles share one line rather
    // than drawing two next to each other.
    if (x < LINE_PIXELS || y < LINE_PIXELS) {
      pixels[y * SIZE + x] = LINE;
    }
  }
}

const png = await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 1 } })
  // Greyscale in, RGB out: the texture loader uploads an sRGB colour texture, and a one-channel
  // PNG would arrive as a red grid.
  .toColourspace("srgb")
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();

const outPath = resolve(import.meta.dirname, "..", OUT_PATH);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, png);
process.stdout.write(
  `${OUT_PATH}  ${String(png.byteLength)} bytes  ${String(SIZE)}x${String(SIZE)}  ` +
    `sha256 ${createHash("sha256").update(png).digest("hex")}\n`,
);
