# 05 · Press kit

`/press/` is one page plus one downloadable archive. Both are built from the same files under
`website/public/press/`, so the page never shows a logo the kit does not ship.

## 1. What the page contains, in order

1. Title, lead, the two buttons (download the kit, email us).
2. About ignifx: three boilerplates with copy buttons.
3. The name.
4. Fact sheet.
5. Logos: the mark, the wordmark, the horizontal and stacked lockups, each on light and dark, with
   SVG and PNG downloads.
6. Badges: "Powered by ignifx" and "Made with ignifx", each with the Markdown and HTML snippet.
7. Usage: do and do not, clear space, minimum sizes, colours.
8. Screenshots: six captures with download links.
9. Contact.

## 2. Copy

**Title:** Press kit · ignifx
**Description:** Boilerplate, logos, badges, screenshots and usage rules for writing about ignifx or
showing that your game runs on it.

H1: **Press kit**
Lead: Everything you need to write about ignifx, or to say that your game runs on it. The logos and
badges below are free to use under the rules in the usage section; no permission is needed.

Buttons: **Download the logo package (.zip)** · **info@astrumforge.com**

### About ignifx

**Short (25 words).**
ignifx is an open-source TypeScript game engine built on WebGPU, for 2D and 3D games that run in the
browser and on the desktop.

**Medium (60 words).**
ignifx is an open-source TypeScript game engine built on WebGPU. Developers write their game as code,
with entities, components and scripts, and ship it to any modern browser or, through Electron, to
Windows, macOS and Linux. Physics, audio, input, UI, animation and navigation are included. ignifx
is developed by Astrum Forge Studios and released under the Apache-2.0 licence.

**Long (120 words).**
ignifx is an open-source game engine for the modern web. It is written in TypeScript and renders
exclusively through WebGPU, using Babylon Lite as its rasteriser, which gives every game one render
path with physically based materials, image-based lighting, shadows and post-processing. Developers
write their game as code: entities, components and scripts with typed, schema-declared fields, and one
obvious way to do each thing. The engine ships with 3D physics on Havok, 2D physics on Rapier, spatial
audio with a bus mixer, action-based input with runtime rebinding, a DOM UI layer, animation state
machines, navigation meshes, sprites and tilemaps, and a devtools overlay. The same game runs in a
browser tab, in a hardened Electron window, and headlessly in Node for testing. ignifx is developed by
Astrum Forge Studios, an independent game studio, and is released under the Apache-2.0 licence.

### The name

ignifx is a blend of **ignite** and **effects**, the "fx" a game developer writes on a folder of
particle systems and post-processing. It began as the internal engine at Astrum Forge Studios, used
for the studio's own games and projects, before being released as open source. The flame in the mark
is the ignition; the crystal it burns inside is the effect it leaves behind.

Say it "ig-ni-fix". Write it `ignifx`, always lowercase, even at the start of a sentence.

### Fact sheet

| Item          | Value                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------ |
| Name          | ignifx                                                                                     |
| What it is    | An open-source TypeScript game engine for WebGPU                                           |
| Developer     | Astrum Forge Studios Pty Ltd, Australia                                                    |
| Licence       | Apache-2.0                                                                                 |
| Language      | TypeScript                                                                                 |
| Renderer      | WebGPU, through Babylon Lite                                                               |
| Physics       | Havok (3D), Rapier (2D)                                                                    |
| Platforms     | Chrome and Edge 113+, Safari 26+, Firefox 141+/145+; Windows, macOS and Linux via Electron |
| Website       | ignifx.com                                                                                 |
| Source        | github.com/astrum-forge/ignifx                                                             |
| Packages      | `ignifx` and `@ignifx/*` on npm _(release-gated: "first release coming" before)_           |
| First release | _(the date, once it exists)_                                                               |
| Contact       | info@astrumforge.com                                                                       |

### Usage

**Do**

- Use the badges to show your game or project runs on ignifx.
- Use the mark or lockup when writing about ignifx, in a talk, or in a list of engines.
- Use the light lockup on dark grounds and the dark lockup on light grounds.
- Keep the clear space: at least the height of the mark on every side.

**Do not**

- Change the colours, add effects, rotate, stretch, outline or recolour the mark.
- Use the mark or name as part of your own product's name or logo, or in a way that suggests Astrum
  Forge Studios made or endorses your product.
- Capitalise it: it is `ignifx`, not "Ignifx" or "IgniFX".
- Set the wordmark in another typeface.

**Minimum sizes.** Mark 16 px. Horizontal lockup 96 px wide. Stacked lockup 64 px wide. Badges 20 px
high.

**Colours.** Flame `#A63D07` on light, `#FF9E4A` on dark. Ink `#14181F`. Paper `#FAFBFC`. Dark ground
`#0D1015`.

**Permission.** The ignifx name and mark are trademarks of Astrum Forge Studios Pty Ltd. You may use
them as described here to refer to ignifx. For anything else, email info@astrumforge.com.

### Contact

Press and partnership enquiries: **info@astrumforge.com** · Astrum Forge Studios · astrumforge.com

## 3. The logo package

Path: `website/public/press/`. The zip is built by `pnpm --filter @ignifx/website press-kit`
(`website/press/build.ts`) from `website/brand/ignifx-mark.png` and the two variable fonts, so the
page and the archive cannot disagree. Every SVG carries `role="img"` and an `aria-label`. The mark
is raster (`02-design-system.md` §2.1), which is why the colour SVGs embed a PNG and the single-colour
files are silhouettes.

| File                                                       | What                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ignifx-mark.svg`                                          | The designer's SVG wrapper around the 1024 px PNG, cleaned (viewBox, role, aria-label) |
| `ignifx-mark-{64,128,256,512,1024}.png`                    | The full-colour mark, transparent ground, ink-centred square canvas                    |
| `ignifx-mark-silhouette.svg`                               | The traced outline, `fill="currentColor"`                                              |
| `ignifx-mark-silhouette-black.svg` / `-white.svg`          | The outline in ink `#14181F` and in `#FFFFFF`                                          |
| `ignifx-mark-silhouette-{black,white}-{256,1024}.png`      | Raster silhouettes for tools that take no SVG                                          |
| `ignifx-wordmark.svg` / `ignifx-wordmark-white.svg`        | Text only, outlines (no live text), ink / white                                        |
| `ignifx-lockup-horizontal.svg` (+ `-dark`)                 | Embedded PNG mark + wordmark outlines, for light / dark grounds                        |
| `ignifx-lockup-horizontal-mono.svg`                        | Silhouette + wordmark, one colour, `currentColor`                                      |
| `ignifx-lockup-stacked.svg` (+ `-dark`, `-mono`)           | Mark above wordmark                                                                    |
| `ignifx-lockup-{horizontal,stacked}[-dark]-{1x,2x,4x}.png` | 400, 800, 1600 px wide, transparent ground                                             |
| `ignifx-social-1200x630.png`                               | The Open Graph image                                                                   |
| `ignifx-avatar-1024.png`                                   | Mark on dark ground, for social accounts                                               |
| `badges/powered-by-ignifx.svg` (+ `-dark`)                 | See §4                                                                                 |
| `badges/made-with-ignifx.svg` (+ `-dark`)                  |                                                                                        |
| `badges/*-{20,32}.png`                                     | Raster at 20 and 32 px high                                                            |
| `screenshots/*.png`, `screenshots/CAPTIONS.txt`            | Six 1280×720 captures and their captions                                               |
| `colours.txt`                                              | The hex values                                                                         |
| `LICENSE.txt`                                              | The usage text from §2                                                                 |
| `ignifx-press-kit.zip`                                     | All of the above                                                                       |

The same generator writes the site's own brand files, so they cannot drift from the kit:
`website/public/favicon.ico` (16/32/48), `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`
(180 px on `#0D1015`) and `website/public/brand/mark-{32,64,96,128,256,512}.png` for the header
lockup and the pages.

**Wordmark construction.** Archivo Variable at weight 600, tracking −0.02 em, converted to outlines.
**Lockup construction.** Chosen from the generator's rendered construction sheet and recorded in
`website/press/README.md` (`02-design-system.md` §2.2).

## 4. Badges

Two badges, each in a light and a dark colourway, drawn as a pill 20 px high (and a 32 px version):
the full-colour mark at the left (the raster, downscaled; if it does not read at 20 px the silhouette in flame colour is the fallback, decided from the render), the label in Public Sans 600 (Archivo 600 while Public Sans 600 cannot be instanced from the variable font — `08-execution.md` §9) and the name as the wordmark outlines, a hairline border in `--rule`, ground in `--surface`.

| Badge             | Text                    | Intended for                                       |
| ----------------- | ----------------------- | -------------------------------------------------- |
| Powered by ignifx | "Powered by **ignifx**" | A game's title screen, credits, store page, README |
| Made with ignifx  | "Made with **ignifx**"  | Itch pages, jam entries, portfolios                |

Snippets shown on the page for each badge:

```md
[![Powered by ignifx](https://ignifx.com/press/badges/powered-by-ignifx.svg)](https://ignifx.com)
```

```html
<a href="https://ignifx.com"
  ><img src="https://ignifx.com/press/badges/powered-by-ignifx.svg" alt="Powered by ignifx" height="20"
/></a>
```

Note for engineers: these badge URLs are the one thing on the site that **other** sites hot-link, so
`/press/badges/*` must be stable, unhashed, cache-friendly (`max-age=86400`) and served with
`Access-Control-Allow-Origin: *` in `_headers`. The site's own CSP is unaffected.

For in-game use, the templates could ship the badge as an optional element of the title screen; that
is an engine-side follow-up, not a website task.

## 5. Screenshots

Six captures at 1280×720, produced by the visual suite (no hand-made images): the four templates, the
hero example (`pbr-model`), and `tilemap`. Each is listed with a one-line caption and the licence
line "Apache-2.0; sample assets credited at ignifx.com/examples/attribution/".

## 6. Production checklist

- [ ] Wordmark outlined from Archivo 600 and checked at 16 px for the _i_ dot and the _fx_ pair.
- [ ] Every SVG optimised, with `viewBox`, `role="img"`, `aria-label`, no embedded fonts, no scripts.
- [ ] PNGs exported from the SVGs at the listed sizes with transparent grounds.
- [ ] Contrast of badge text on both grounds checked against the site's test.
- [ ] Zip built by `pnpm --filter @ignifx/website press-kit` and committed under `public/press/`.
- [ ] `_headers` rule for `/press/badges/*` added and asserted in `site.test.ts`.
- [ ] The fact sheet's "First release" row filled in at release time (`06-engineering.md` §8).
