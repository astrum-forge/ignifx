# The brand-file generator

Everything with the mark on it is generated, not drawn. This directory holds the generator; its
output is committed so the site can serve it and the archive can be downloaded without a build step.

```
pnpm --filter @ignifx/website press-kit
```

One run writes two sets of files, so they cannot drift apart:

| Where                                                                                                      | What                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `website/public/press/**`                                                                                  | The logo package and the archive (`05` §3)  |
| `website/public/{favicon.ico,favicon-16.png,favicon-32.png,apple-touch-icon.png}`, `website/public/brand/` | The site's own icons, which the shell links |

The command replaces both directories with exactly what it produces, prints the construction
numbers and the contrast ratios, and exits non-zero on any failure. It is deterministic: two runs on
the same inputs give byte-identical files, so
`press-kit && git diff --exit-code website/public` is a valid CI check.

Add `--sheet <path>` to also render the lockup construction sheet (see
[The lockups](#the-lockups)). The sheet is a review artefact and is deliberately never written
under `public/`.

The rules the generator implements are `website/plan/05-press-kit.md` (§3 the file list, §4 the
badges, §5 the screenshots, §6 the production checklist), `website/plan/02-design-system.md` §2 and
§2.7, and the decisions in `website/plan/08-execution.md` §9. Where it departs from them, it is
listed under [Deviations](#deviations) with the reason.

## Inputs

| Input        | Where                                                                             | Used for                                       |
| ------------ | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| The mark     | `website/brand/ignifx-mark.png`                                                   | Every brand file                               |
| The wordmark | `node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2` | Outlines for `ignifx` and for the badge labels |
| The captures | `website/public/examples/*.png`                                                   | The social image and the six screenshots       |

The mark master is a **raster**: a 1024×1024 RGBA PNG, 371,453 bytes, SHA-256
`07d42d84281f284019bbcbd37813a2288dbb38a4fc413dc11ac93ffecf202cfe`, extracted byte for byte from the
owner's `website/brand/source/pro_icon.svg` (SHA-256 `da3647e7…`, an SVG wrapper around that one
PNG). The generator **reads** those bytes and never decodes and re-encodes them: they are what the
colour SVGs embed, and `08-execution.md` §9 makes the file the source of truth. Everything else —
every PNG size, the favicon, the silhouette — is derived from it.

The font file is the same one `website/scripts/fonts.ts` subsets into the site, so the wordmark in
the kit and the wordmark in the page header are the same outlines. If that script ever changes face
or file, change `ARCHIVO_FILE` in `brand.ts` to match.

## Because the mark is raster

Three consequences run through the whole generator:

1. **Colour drawings embed a PNG.** `ignifx-mark.svg` and the four colour lockups carry the master
   itself as a `data:image/png;base64` `<image>`, which is why they are around 495 KB each: a
   lockup goes into slides and print, where `05` §3's 4× raster sizes have to stay sharp. A badge is
   hot-linked from other people's READMEs, so it embeds the mark downscaled to twice the size it is
   drawn at — about 3 KB — instead.
2. **There is no `currentColor` mark.** The single-colour forms are a **silhouette** traced from the
   alpha edge, which is what `-mono`, `-black` and `-white` mean here. They are documented as a
   silhouette, not as "the logo in one colour".
3. **`xlink:href`, not `href`.** Both work in librsvg and in every browser; `xlink:href` is what the
   designer's own wrapper uses and what older editors and sanitisers still require, and a press
   asset has to open everywhere. `svg.ts` declares `xmlns:xlink` only on the files that need it.

## Construction

Press SVGs that are pure vector — the wordmark, the lockups' letters, the badges' text — are drawn
in hundredths of an em, so a lockup's intrinsic size reads as `335.55 × 91.3` rather than Archivo's
`3355.5 × 913`. The mark's own SVGs keep the master's 1024-unit box; the badges are drawn in pixels
at their 20 px pill height.

### Measured

Recomputed on every run and printed by the build. These were the values on 2026-09-07:

| Measurement                               | Value                                                       |
| ----------------------------------------- | ----------------------------------------------------------- |
| Master canvas                             | 1024 × 1024 RGBA                                            |
| Mark ink box (alpha ≥ 128)                | **616 × 886** at `(204, 69)`; aspect **0.6953**             |
| Ink centre                                | exactly `(512, 512)` — the artwork is canvas-centred        |
| Square region every raster is cut from    | **964 × 964** at `(30, 30)`; ink is **91.91%** of it        |
| Silhouette                                | **25 vertices**, mismatch **0.516%** of the ink             |
| Archivo units per em                      | 1000                                                        |
| Cap height                                | 686 font units — **68.6** press units                       |
| x-height                                  | 526 font units — **52.6** press units                       |
| Glyph advances for `ignifx`, font units   | `i 252 · g 591 · n 584 · i 252 · f 307 · x 546`             |
| Tracked advance (−0.02 em between glyphs) | 2432 font units — **243.2** press units                     |
| Wordmark ink box                          | **235.7 × 91.3**                                            |
| Wordmark ink above / below the baseline   | 73.1 (the `f` ascender) / 18.2 (the `g` descender)          |
| Wordmark left side bearing                | 6.5                                                         |
| Horizontal lockup (**B at 0.45 em**)      | **335.55 × 91.3**; mark ink 54.85 × 78.89 at y 6.21, gap 45 |
| Stacked lockup                            | **235.7 × 236.06**; mark ink 76.31 × 109.76, gap 35         |
| Mark facet colours                        | `#C90645` 66.1% · `#FA8A13` 26.6% · `#FBDD74` 6.9%          |

### The silhouette

`ignifx-mark-silhouette.svg` is the master's alpha edge traced to one closed polygon. The steps, all
in `trace.ts` and `geometry.ts`:

1. Threshold the alpha at **128**. The master is one connected region with **no interior holes**
   (verified), so its outer contour describes it completely.
2. Walk the outer boundary clockwise with **Moore-neighbour tracing** and Jacob's stopping
   criterion, starting from the topmost-leftmost ink pixel so the walk is reproducible. That found
   **2,238 boundary pixels**.
3. Drop the pixel staircase with **Douglas–Peucker**. Because a closed ring has no natural fixed end
   points, the two points furthest apart are used as anchors and the ring is simplified as two
   polylines between them — otherwise a real corner gets rounded off wherever the trace happened to
   start.
4. Emit one `M … L … Z` path with two-decimal coordinates, in master canvas units.

The tolerance is chosen by trying 1, 1.5, 2, 2.5, 3 and 4 px and taking the first whose polygon is
within 48 vertices. **Tolerance 1 px gives 25 vertices** — the artwork really is low-poly, which is
why the count collapses from 483 at 0.5 px to 25 at 1 px.

**Accuracy.** The polygon is rendered back at 1024 × 1024, thresholded, and diffed against the
master's own mask: **0.516% of the ink pixels disagree** (0.159% of the canvas), well inside the 1%
the brief asks for. The floor is not the simplification — a 483-vertex trace at 0.5 px tolerance
still disagrees on 0.439% — it is the half-pixel of antialiasing the 128 threshold cuts through. In
other words 25 vertices are as faithful as the pixel trace itself.

The silhouette SVGs use the master's `viewBox="0 0 1024 1024"`, so they are drop-in replacements for
`ignifx-mark.svg`. The raster silhouettes are framed like the colour PNGs instead — ink centred with
the standard margin — so `ignifx-mark-256.png` and `ignifx-mark-silhouette-black-256.png` swap
cleanly.

### The square colour rasters

`ignifx-mark-<size>.png`, `public/brand/mark-<size>.png`, `favicon-16.png` and `favicon-32.png` are
all the same thing: the master cropped to its 964 px square region and Lanczos-3 downscaled, with a
light unsharp mask (`sigma 0.6`) at 48 px and below. Transparent ground, ink centred, **4.05%**
clear margin.

At 16 px that gives a recognisable red flame with an orange core, checked by rendering it —
`02-design-system.md` §2.1's own test. At 1024 px the region is scaled **up** by 1.062×, because
`05` §3 asks for a 4% margin and the master's own margin is 6.74%; a 6% upscale of a 964 px source
is invisible, and the alternative would be a 1024 file framed differently from every other size.

`apple-touch-icon.png` is 180 px, the ink at 80% of the height, on `#0D1015`, **opaque** with no
alpha channel — iOS applies its own rounded mask and does not want transparency.
`ignifx-avatar-1024.png` is the same idea at 1024 px with the ink at 56%, so a circular crop cannot
clip the flame's tip.

`favicon.ico` is written by hand in `ico.ts`: a 6-byte `ICONDIR`, three 16-byte `ICONDIRENTRY`
records declaring 16, 32 and 48 px at 32 bpp, then the three PNGs. PNG-compressed entries have been
valid since Windows Vista and are what every modern icon uses; writing the container directly means
no dependency and bytes fully determined by the PNGs that go in.

### The wordmark

`ignifx`, all lowercase, Archivo at weight **600**, tracking **−0.02 em**, converted to outlines.
The kit ships no live text and embeds no font, so the letters are filled paths.

Tracking is added after every glyph **but the last**: a trailing −0.02 em would only move a phantom
sidebearing and shift the ink box. The viewBox is trimmed to the ink, so "set the wordmark 24 px
tall" gives 24 px of visible letters.

At −0.02 em the `f`'s crossbar terminal and the `x`'s upper-left arm **touch** at the x-height (`f`
ink ends at 1906 font units, `x` ink begins at 1896 — a 0.01 em overlap). It reads as a tight
logotype pair, not as a broken letter, at every size from a 16 px em up; the `i` dot stays clear of
its stem at the same size. Both were checked by rasterising. The overlap is a property of the
specified tracking, not of this generator.

### The lockups

`02-design-system.md` §2.2 does **not** fix the horizontal construction: the mark is tall and
pointed (aspect 0.70), so the alignment is chosen optically from a rendered sheet. Regenerate it
with:

```
node press/build.ts --sheet /tmp/lockup-candidates.png
```

The sheet draws every candidate at 400 px wide on light and on dark, at both 0.35 em and 0.45 em, and
prints each row's measurements.

**Chosen: candidate B, gap 0.45 em** — the mark at **1.15× cap height** (78.89 press units) with its
ink box **centred on the wordmark's ink box** (top at y 6.21), 45 units of ink-to-ink gap.

Why, from the sheet:

- **A** (mark spanning the full `f`-to-`g` ink height, 91.3) makes the mark clearly heavier than the
  letters. The artwork is a solid faceted mass and the letters are strokes, so matching their
  extremes does not match their weight; it reads as an icon with a label beside it.
- **C** (cap height on the baseline, 68.6) reads as a small ornament. It also leaves a hole: the mark
  has no descender, so the space the `g` fills on the text side is empty on the mark side.
- **B** is the only one where the two carry the same visual weight, and centring on the ink box puts
  the mark's optical middle level with the word's — which a pointed shape needs and which neither a
  baseline rule nor a cap-line rule gives.
- The gap is the brand's 0.35 em **plus 0.1**, which `02` §2.2 explicitly allows. The mark's widest
  point is a sloped facet at about two-thirds of its height, so at 0.35 em it crowds the `i`'s
  straight stem even though the ink-box measurement says the spacing is right. At 0.45 em the
  spacing reads even, verified at 400 px and at the 96 px minimum.

**Stacked**: the mark at **1.6× cap height** (109.76) centred above the wordmark, gap **0.35 em**,
giving 235.7 × 236.06 — square, and checked at the 64 px minimum. The +0.1 em was a fix for a
horizontal crowding effect that has no vertical equivalent: the mark's base is a downward point, so
the vertical gap already reads larger than it measures.

Mono lockups use the silhouette in `currentColor` and ship as SVG only — `currentColor` means
nothing in a raster.

### The badges

A pill 20 px high with a 1 px hairline (drawn inset by 0.5 px so it lands on the pixel grid) and a
999 px radius, which on a 19 px inner box resolves to 9.5. Then, left to right: the mark at **14 px**
of ink height, the label, and the wordmark. Type is 11 px; horizontal padding is 7 px; the two gaps
are 4 px; the width is whatever the label needs, rounded up to a whole pixel so `<img width>` is
honest.

The text's own ink box — cap top to descender bottom, both faces considered — is centred in the
pill, which puts the baseline at 13.02. Centring the cap box alone would sit the line 2 px low,
because both the label and `ignifx` carry descenders.

Widths: `powered-by-ignifx` **117 × 20**, `made-with-ignifx` **108 × 20**. The 32 px rasters are the
same drawing at 1.6×, which puts the mark at 22.4 px as `05` §4 describes.

**The mark stays the full-colour raster at 20 px.** `05` §4 allows a silhouette fallback if the
artwork does not read that small, decided from the render. It does read: at 10 × 14 px the facets are
gone but the shape and the red-to-orange core are unmistakably the ignifx flame, on both grounds.
`BADGE_MARK_STYLE` in `brand.ts` switches the whole badge family to the flame-coloured silhouette if
that judgement is ever revisited.

Contrast, recomputed and enforced on every run (WCAG 2.1; text must clear 4.5:1):

| Colourway | Role                | Colours             | Ratio   |
| --------- | ------------------- | ------------------- | ------- |
| light     | label               | `#4B5464`/`#FAFBFC` | 7.37:1  |
| light     | wordmark            | `#14181F`/`#FAFBFC` | 17.17:1 |
| light     | silhouette fallback | `#A63D07`/`#FAFBFC` | 6.16:1  |
| dark      | label               | `#98A2B3`/`#14181F` | 6.91:1  |
| dark      | wordmark            | `#E7EAF0`/`#14181F` | 14.76:1 |
| dark      | silhouette fallback | `#FF9E4A`/`#14181F` | 8.68:1  |

The badges are the one asset other sites hot-link, so `/press/badges/*` must stay at these paths,
unhashed, with `max-age=86400` and `Access-Control-Allow-Origin: *` (`05` §4). That `_headers` rule
belongs to the site build, not here.

### Minimum sizes and clear space

From `05` §2, and checked by rasterising at each size: mark **16 px**, horizontal lockup **96 px**
wide, stacked lockup **64 px** wide, badges **20 px** high. Clear space on every side is at least
the height of the mark.

## Colours

`colours.txt` ships the palette plus the mark's own facet colours, sampled from the master and
labelled **"mark facets, not for reuse"**: they are what the artwork is painted in, for matching a
layout to it, and they are not brand tokens. The site's accent stays `--flame` (`08` §9).

The sampler bins each hue band's colours 12 levels per channel, takes the fullest bin and averages
its members — averaging a whole band gives mud, and the modal bin returns a colour the artwork
actually contains. Ties break on the bin key, so it is deterministic.

Two other choices worth stating:

- `-black` is the **ink** token `#14181F`, not pure black: pure black is not in the palette `05` §2
  permits, and an ink-coloured silhouette sits correctly beside ink-coloured text.
- `-white` **is** pure `#FFFFFF`, for reversing out of an arbitrary dark ground or a photograph.
  Inside `-dark` lockups the wordmark is the dark-theme ink `#E7EAF0` instead, because there it sits
  on a known ground.

## What each file is for

| File                                                  | For                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ignifx-mark.svg`                                     | The designer's wrapper, cleaned: `viewBox`, `role`, `aria-label`, no intrinsic size, the master untouched |
| `ignifx-mark-{64,128,256,512,1024}.png`               | The full-colour mark, transparent, ink-centred                                                            |
| `ignifx-mark-silhouette.svg`                          | The traced outline in `currentColor`                                                                      |
| `ignifx-mark-silhouette-black.svg` · `-white.svg`     | The outline in ink and in white                                                                           |
| `ignifx-mark-silhouette-{black,white}-{256,1024}.png` | Raster silhouettes, for tools that take no SVG                                                            |
| `ignifx-wordmark.svg` · `-white.svg`                  | The letters alone, trimmed to the ink                                                                     |
| `ignifx-lockup-horizontal.svg` (+ `-dark`)            | The default lockup, for light / dark grounds                                                              |
| `ignifx-lockup-horizontal-mono.svg`                   | Silhouette + wordmark in `currentColor`                                                                   |
| `ignifx-lockup-stacked.svg` (+ `-dark`, `-mono`)      | Square spaces                                                                                             |
| `ignifx-lockup-*-{1x,2x,4x}.png`                      | 400 / 800 / 1600 px wide, transparent, light and dark only                                                |
| `ignifx-avatar-1024.png`                              | Social accounts: the mark on `#0D1015`, opaque, safe for a round crop                                     |
| `ignifx-social-1200x630.png`                          | The Open Graph card                                                                                       |
| `badges/{powered-by,made-with}-ignifx[-dark].svg`     | What a game or project embeds                                                                             |
| `badges/*-{20,32}.png`                                | The same at 20 and 32 px high                                                                             |
| `screenshots/*.png` · `screenshots/CAPTIONS.txt`      | The six 1280×720 captures, with a caption and the licence line                                            |
| `colours.txt` · `LICENSE.txt`                         | The palette; the usage rules, trademark permission, boilerplate and name                                  |
| `ignifx-press-kit.zip`                                | Everything above except itself                                                                            |
| `public/favicon.ico`                                  | 16 / 32 / 48 px, PNG-compressed entries                                                                   |
| `public/favicon-16.png` · `favicon-32.png`            | The modern `<link rel="icon">` pair                                                                       |
| `public/apple-touch-icon.png`                         | 180 px, opaque, on `#0D1015`                                                                              |
| `public/brand/mark-{32,64,96,128,256,512}.png`        | The header lockup and the pages                                                                           |

## Deviations

1. **The badge carries the real wordmark, not label type.** `05` §4 writes the name in bold —
   "Powered by **ignifx**" — and §2's usage rules forbid setting the wordmark in another typeface, so
   the product name in a badge is the wordmark: Archivo 600 outlines with the brand's −0.02 em
   tracking. Recorded in `08-execution.md` §9.

2. **The badge label and the social positioning line are Archivo 600, not Public Sans 600.** Accepted
   in `08` §9; the cause is in the header of `press/type.ts`. fontkit 2.0.4 cannot instance a WOFF2
   variable font — `TTFFont.getVariation` builds the instance from the brotli-decompressed table data
   at the original SFNT directory offset, so it comes back with no `cmap`; and `WOFF2Glyph._decode`
   returns the pre-decoded glyph from the WOFF2 glyf transform without ever applying `gvar` deltas.
   What is left is each file's default master, and `@fontsource-variable/archivo`'s happens to be
   weight 600 (`openWeight600` asserts it, so the build stops if fontsource re-defaults the file)
   while `@fontsource-variable/public-sans`'s is weight **100**. The fix, if wanted, is adding the
   static `@fontsource/public-sans` package; this generator adds no dependency of its own.

3. **The stacked lockup's numbers (1.6× cap height, 0.35 em gap) are chosen here**, as is the
   horizontal construction — by design, per `02` §2.2. See [The lockups](#the-lockups).

4. **`-black` is the ink token, not pure black.** See [Colours](#colours).

5. **`ignifx-mark-1024.png` upscales the master by 1.062×** so that its framing matches every other
   size. See [The square colour rasters](#the-square-colour-rasters).

## When the remaining captures land

The social image and the six screenshots depend on `website/public/examples/*.png`, which the
examples pipeline writes (`08-execution.md` §4.4). Until a capture exists the generator **skips**
that file, names it in the report, and never composites a placeholder — a stand-in would end up on a
real Open Graph card. `screenshots/CAPTIONS.txt` is written either way and says which captures are
still missing.

Once the rest exist, re-run the same command; nothing else needs changing:

```
pnpm --filter @ignifx/website press-kit
```

One thing to watch on that run. The social image's positioning line sits on whatever the hero
capture puts behind it, so its legibility cannot be settled in advance: `socialPng` measures the
mean colour of the composited ground under the line, prints the ratio, and **refuses the image**
below 4.5:1, naming `SOCIAL_SCRIM` in `raster.ts` as the knob. With the current `pbr-model` capture
and a 0.82 scrim it measures 6.32:1 against `#241F1E`; only a very bright capture would trip it.

## The modules

| File           | What it does                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------- |
| `build.ts`     | The orchestrator: reads the inputs, builds every file, prints the report, writes              |
| `brand.ts`     | Colours, construction constants and decisions, the screenshot list and its captions           |
| `mark.ts`      | The master: measuring its ink, cutting its region, tracing it, sampling its palette           |
| `trace.ts`     | Alpha threshold, Moore-neighbour boundary walk, the accuracy diff                             |
| `geometry.ts`  | `Box`, `Point`, Douglas–Peucker for an open polyline and for a closed ring                    |
| `type.ts`      | fontkit: opening the font at weight 600 and outlining a run with tracking                     |
| `art.ts`       | The mark's SVGs, the wordmark, the two lockups, the two badges                                |
| `sheet.ts`     | The lockup construction sheet                                                                 |
| `svg.ts`       | SVG serialisation, two-decimal coordinates, the required attributes                           |
| `raster.ts`    | `sharp`: Lanczos downscales, vector rasters, the avatar, the touch icon, the social composite |
| `ico.ts`       | The Windows ICO container                                                                     |
| `contrast.ts`  | WCAG 2.1 contrast, enforced on the badges and the social line                                 |
| `docs.ts`      | `colours.txt`, `LICENSE.txt`, `screenshots/CAPTIONS.txt`                                      |
| `archive.ts`   | `fflate`: the zip, sorted and with a fixed timestamp so it is reproducible                    |
| `fontkit.d.ts` | Types for fontkit, which ships none                                                           |

Reproducibility is deliberate throughout: PNG encoder settings are pinned, the silhouette's geometry
is computed rather than measured off a raster (a raster would tie the committed SVG bytes to
whichever librsvg the local `sharp` was built against), the palette sampler breaks ties on a stable
key, and the zip's entries are sorted by path and stamped 1980-01-01 00:00 — as a local-time string,
because fflate encodes the DOS date from a `Date`'s local components.

## Rebuilding after a change to the mark or the font

`loadMark` refuses a master that is not square, and `openWeight600` refuses a font whose default
master is not weight 600. Both fail the build with a message rather than shipping something quietly
different. If either changes on purpose: re-run the generator, regenerate the construction sheet,
re-take the lockup decision, and update the **Measured** table above with what the build printed.
