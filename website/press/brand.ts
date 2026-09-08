/**
 * The brand constants the press kit draws from, and the construction rules that turn them into
 * geometry.
 *
 * Colours are copied from `website/src/styles/tokens.css`, which `02-design-system.md` §2.3 names
 * as the single source of truth; `website/test/site.test.ts` re-checks their contrast. They are
 * repeated here rather than parsed out of the stylesheet because a press asset must not change
 * colour when a site token is re-tuned: a badge published in someone else's README is a fixed
 * artefact, and `05-press-kit.md` §2 states its colours as literals.
 */

/** Flame accent for light grounds — `--flame` (light). */
export const FLAME_ON_LIGHT = "#A63D07";
/** Flame accent for dark grounds — `--flame` (dark). */
export const FLAME_ON_DARK = "#FF9E4A";
/** Body ink on light grounds — `--ink` (light). */
export const INK_ON_LIGHT = "#14181F";
/** Body ink on dark grounds — `--ink` (dark). */
export const INK_ON_DARK = "#E7EAF0";
/** Secondary ink on light grounds — `--ink-2` (light). */
export const INK_2_ON_LIGHT = "#4B5464";
/** Secondary ink on dark grounds — `--ink-2` (dark). */
export const INK_2_ON_DARK = "#98A2B3";
/** Panel ground on light — `--surface` (light); the light badge's fill. */
export const PAPER = "#FAFBFC";
/** Panel ground on dark — `--surface` (dark); the dark badge's fill. */
export const SURFACE_ON_DARK = "#14181F";
/** Hairline on light grounds — `--rule` (light). */
export const RULE_ON_LIGHT = "#D2D8E2";
/** Hairline on dark grounds — `--rule` (dark). */
export const RULE_ON_DARK = "#262D38";
/** Page ground on dark — `--bg` (dark); the social image and the avatar sit on it. */
export const GROUND_DARK = "#0D1015";
/** Pure white, for reversing the mark and the wordmark out of any dark ground or photograph. */
export const WHITE = "#FFFFFF";

/**
 * Tracking for the wordmark, in em (`02-design-system.md` §2.2, `05-press-kit.md` §3).
 * Negative: the letters are pulled together.
 */
export const WORDMARK_TRACKING_EM = -0.02;

/** Gap between the mark and the wordmark in a lockup, in em (`05-press-kit.md` §3). */
export const LOCKUP_GAP_EM = 0.35;

/**
 * Weight of the wordmark on the Archivo weight axis (`02-design-system.md` §2.2).
 */
export const WORDMARK_WEIGHT = 600;

/**
 * The mark's ink height in the stacked lockup, as a multiple of the wordmark's cap height.
 *
 * Stacked, a cap-height mark over a full-width wordmark reads as a wide strip rather than the
 * square composition `02-design-system.md` §2.2 asks for, so the mark is bigger there.
 */
export const STACKED_MARK_CAP_MULTIPLE = 1.6;

/**
 * How many press-SVG user units one em is worth.
 *
 * The wordmark and the lockups are emitted in hundredths of an em rather than in Archivo's 1000
 * design units, so a lockup's intrinsic size is a sane `319.7 × 91.3` instead of `3197 × 913`.
 */
export const UNITS_PER_EM = 100;

/** Where the Archivo weight-axis file lives, relative to `website/`. */
export const ARCHIVO_FILE = "node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2";

/**
 * The mark master, relative to `website/` (`02-design-system.md` §2.1).
 *
 * Extracted byte for byte from the owner's `brand/source/pro_icon.svg`; never re-encoded.
 */
export const MARK_MASTER = "brand/ignifx-mark.png";

/** Square sizes of the full-colour mark the press kit ships (`05-press-kit.md` §3). */
export const MARK_PNG_SIZES = [64, 128, 256, 512, 1024] as const;

/** Square sizes of the raster silhouettes the press kit ships. */
export const SILHOUETTE_PNG_SIZES = [256, 1024] as const;

/** At or below this size a downscaled raster gets a light unsharp mask (`05-press-kit.md` §3). */
export const SHARPEN_AT_OR_BELOW = 48;

/** Sizes of `public/brand/mark-<size>.png`, which the site's header and pages use. */
export const SITE_MARK_SIZES = [32, 64, 96, 128, 256, 512] as const;

/** The sizes `favicon.ico` carries (`02-design-system.md` §2.1). */
export const FAVICON_ICO_SIZES = [16, 32, 48] as const;

/** The Apple touch icon's canvas, and how much of its height the mark's ink takes. */
export const APPLE_TOUCH = { size: 180, inkFraction: 0.8 } as const;

/**
 * The horizontal lockup construction, chosen optically from the generator's construction sheet
 * (`02-design-system.md` §2.2, `08-execution.md` §9). `press/README.md` records why.
 *
 * **B at 0.45 em.** Candidate B — the mark at 1.15× cap height, its ink box centred on the
 * wordmark's — is the only one of the three where the mark carries the same visual weight as
 * SemiBold Archivo: A (mark spanning the full `f`-to-`g` ink height) reads as an icon with a label
 * beside it, and C (cap height on the baseline) reads as a small ornament with a hole under it,
 * because the mark has no descender to fill the space the `g` fills. Centring on the ink box also
 * puts the mark's optical middle level with the word's, which a pointed shape needs and which
 * neither a baseline nor a cap-line rule gives.
 *
 * The gap is the brand's 0.35 em **plus 0.1**: the mark's widest point is a sloped facet at about
 * two-thirds of its height, so at 0.35 em it crowds the `i`'s straight stem even though the
 * ink-box measurement says otherwise. `02-design-system.md` §2.2 allows exactly this.
 *
 * Regenerate the sheet with `node press/build.ts --sheet <path>` before changing this.
 */
export const HORIZONTAL_CONSTRUCTION = { candidate: "B", gapEm: 0.45 } as const;

/**
 * How a badge draws the mark, decided from the rendered 20 px badge (`05-press-kit.md` §4).
 * `press/README.md` records the render this was judged on.
 */
export const BADGE_MARK_STYLE: "colour" | "silhouette" = "colour";

/**
 * The captures `05-press-kit.md` §5 ships, with the caption each is published under.
 *
 * They are produced by the visual suite and written to `website/public/examples/` by the examples
 * pipeline (`08-execution.md` §4.4); the press kit only copies them, and skips the ones that do not
 * exist yet.
 */
export const SCREENSHOTS: readonly { readonly file: string; readonly caption: string }[] = [
  {
    file: "2d-topdown.png",
    caption: "2d-topdown.png — the 2D top-down template: sprites, a tilemap and Rapier physics.",
  },
  {
    file: "2d-sidescroller.png",
    caption: "2d-sidescroller.png — the 2D side-scroller template: a run-and-jump character on a tilemap.",
  },
  {
    file: "3d-third-person.png",
    caption: "3d-third-person.png — the 3D third-person template: a character controller with Havok physics.",
  },
  {
    file: "3d-first-person.png",
    caption: "3d-first-person.png — the 3D first-person template: mouse-look, a navigation mesh and spatial audio.",
  },
  {
    file: "pbr-model.png",
    caption: "pbr-model.png — physically based rendering: a glTF model under image-based lighting with bloom.",
  },
  { file: "tilemap.png", caption: "tilemap.png — a tilemap rendered by @ignifx/2d, with layers and animated tiles." },
];

/** The licence line every screenshot is published under (`05-press-kit.md` §5). */
export const SCREENSHOT_LICENCE = "Apache-2.0; sample assets credited at ignifx.com/examples/attribution/";

/** The hero capture the social image crops behind its ember glow. */
export const SOCIAL_CAPTURE = "pbr-model.png";

/** The one-line positioning that the social image carries. */
export const POSITIONING = "The TypeScript game engine for WebGPU.";
