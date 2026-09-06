/**
 * Self-hosted fonts.
 *
 * `CONSTITUTION.md` §9.1 rules out a Google Fonts `<link>`: it is a third-party request. The three
 * faces are npm packages instead (`@fontsource-variable/*`), and only the **latin** subset of each
 * weight-axis file is copied into the build — 102,164 bytes in total, against the 120 KB budget in
 * `DESIGN.md`. Each face's SIL Open Font Licence is copied to `/licenses/` and linked from the
 * footer.
 *
 * The `unicode-range` values below are copied verbatim from each package's own `wght.css`, so the
 * browser downloads a face only for the characters it actually covers.
 *
 * The fallback `@font-face` rules carry a `size-adjust` **measured in Chromium**, which is what
 * keeps the swap from moving the text: at 100 px over "Handgloves 0123456789 the quick brown fox"
 * (2026-09-06, Playwright 1.63's Chromium), Archivo advanced 1982.98 px against Helvetica Neue's
 * 2028.41 (97.8%), Public Sans 2109.13 against the same (104.0%), and JetBrains Mono 2460.00
 * against SF Mono's 2468.42 (99.7%). Re-measure with the script in the Phase 12 report if a face
 * changes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** One web font shipped with the site. */
export interface WebFont {
  /** The `font-family` name used in CSS. */
  readonly family: string;
  /** npm package the file comes from. */
  readonly pkg: string;
  /** File under the package's `files/` directory. */
  readonly file: string;
  /** Basename used for the emitted asset and the licence copy. */
  readonly slug: string;
  /** The variable weight range. */
  readonly weight: string;
  /** Whether the shell preloads it. */
  readonly preload: boolean;
  /**
   * `size-adjust` for the fallback face, as a percentage. Measured in Chromium by rendering the
   * same string in the web font and in the fallback stack and comparing advance widths.
   */
  readonly sizeAdjust: number;
  /** The `local()` sources the fallback face resolves against, in order. */
  readonly fallbackLocals: readonly string[];
}

/** The latin subset's `unicode-range`, identical across the three packages. */
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

/** The three faces, in load order. */
export const FONTS: readonly WebFont[] = [
  {
    family: "Archivo Variable",
    pkg: "@fontsource-variable/archivo",
    file: "archivo-latin-wght-normal.woff2",
    slug: "archivo",
    weight: "100 900",
    preload: true,
    sizeAdjust: 97.8,
    fallbackLocals: ["Helvetica Neue", "Arial"],
  },
  {
    family: "Public Sans Variable",
    pkg: "@fontsource-variable/public-sans",
    file: "public-sans-latin-wght-normal.woff2",
    slug: "public-sans",
    weight: "100 900",
    preload: true,
    sizeAdjust: 104.0,
    fallbackLocals: ["Helvetica Neue", "Arial"],
  },
  {
    family: "JetBrains Mono Variable",
    pkg: "@fontsource-variable/jetbrains-mono",
    file: "jetbrains-mono-latin-wght-normal.woff2",
    slug: "jetbrains-mono",
    weight: "100 800",
    preload: false,
    sizeAdjust: 99.7,
    fallbackLocals: ["SFMono-Regular", "Menlo", "Consolas"],
  },
];

/** One font file, resolved and hashed. */
export interface LoadedFont {
  /** The face it belongs to. */
  readonly font: WebFont;
  /** File contents. */
  readonly bytes: Buffer;
  /** The emitted path inside `dist`, hashed so it can be cached immutably. */
  readonly fileName: string;
  /** The URL the CSS and the preload link use. */
  readonly url: string;
  /** The package's `LICENSE` text. */
  readonly license: string;
}

/**
 * Reads the three font files and their licences out of `node_modules`.
 *
 * @param websiteRoot - Absolute path to `website/`.
 * @returns The loaded fonts, in {@link FONTS} order.
 */
export function loadFonts(websiteRoot: string): readonly LoadedFont[] {
  return FONTS.map((font) => {
    const packageDirectory = path.join(websiteRoot, "node_modules", ...font.pkg.split("/"));
    const bytes = readFileSync(path.join(packageDirectory, "files", font.file));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const fileName = `assets/${font.slug}-${hash}.woff2`;
    return {
      font,
      bytes,
      fileName,
      url: `/${fileName}`,
      license: readFileSync(path.join(packageDirectory, "LICENSE"), "utf8"),
    };
  });
}

/**
 * Renders the `@font-face` rules: one real face per font, plus a metric-adjusted fallback face
 * that carries the same text at the same width until the real one arrives.
 *
 * @param loaded - The loaded fonts.
 * @returns CSS text.
 */
export function fontFaceCss(loaded: readonly LoadedFont[]): string {
  let css = "/* Generated: self-hosted latin subsets, copied from @fontsource-variable/*. */\n";
  for (const { font, url } of loaded) {
    css +=
      `@font-face{font-family:"${font.family}";font-style:normal;font-display:swap;` +
      `font-weight:${font.weight};src:url(${url}) format("woff2-variations");unicode-range:${LATIN}}\n`;
    const locals = font.fallbackLocals.map((name) => `local("${name}")`).join(",");
    css +=
      `@font-face{font-family:"${font.family} Fallback";font-style:normal;font-weight:${font.weight};` +
      `src:${locals};size-adjust:${font.sizeAdjust.toFixed(1)}%}\n`;
  }
  return css;
}
