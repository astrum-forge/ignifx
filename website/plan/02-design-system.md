# 02 · Design system and page designs

The 2026-09-11 content and layout refinements are recorded in [DESIGN.md](../DESIGN.md).
Its homepage order, card layouts and writing guidance supersede those parts of this launch plan.

This document replaces `website/DESIGN.md` when the overhaul is built. It keeps what already works
(the cool neutral palette, the flame accent, the three self-hosted faces, both themes, no gradients
as texture, no third-party requests) and changes the register: from an instrument panel that
documents a frame to a product site that shows games running.

## 1. Design principles

1. **Show, then tell.** The first thing on every page that can show the engine running does. A
   running canvas beats a rendered PNG; a PNG beats a paragraph.
2. **One accent, spent on action.** Flame orange marks links, buttons, focus and the mark itself.
   Nothing else on the page is orange.
3. **Flat, bordered, quiet.** Panels are hairline-bordered surfaces with a small radius. No drop
   shadows, no glassmorphism, no card-on-card stacking.
4. **Real captures only.** Every image on the site is a capture of an ignifx app, produced by the
   visual test suite at a known resolution. No stock art, no illustration, no mock-ups.
5. **The page is complete without JavaScript.** Scripts enhance: they start canvases, switch the
   theme, copy code, run the browser check. Text, links and images never wait for them.

## 2. Brand foundations

### 2.1 The mark

**Changed 2026-09-07 (owner):** the mark is the professionally designed crystal flame the owner
supplied as `website/brand/source/pro_icon.svg` — a low-poly faceted flame, magenta-red outer facets
around an orange-to-yellow core, on a transparent ground. The file is an SVG wrapper around one
1024×1024 PNG, so the artwork is **raster**, and everything below follows from that:

- **Source of truth:** `website/brand/ignifx-mark.png`, the PNG extracted byte for byte from the
  wrapper (1024×1024 RGBA; ink occupies x 203–820, y 68–955 of the canvas, 618×888 px, aspect 0.70).
  Never re-encode it; every other brand file is derived from it by `website/press/build.ts`.
- **Full colour is the mark.** It is used at every size as a PNG (`/brand/mark-<size>.png` on the
  site, `ignifx-mark-<size>.png` in the press kit) and inside SVG lockups as an embedded
  `<image>`. It works on both grounds without a variant.
- **The silhouette is the mono form.** The alpha edge of the master, traced to one closed polygon
  (the shape is low-poly, so the outline is a few dozen straight segments), gives a crisp vector
  `ignifx-mark-silhouette.svg` filled with `currentColor`. It is what `-mono`, `-black` and
  `-white` variants use, and it is documented as a silhouette, not as "the logo in one colour".
- **Small sizes** are the master downscaled with Lanczos and lightly sharpened; a 16 px favicon is a
  recognisable red flame with an orange core, verified 2026-09-07. `favicon.ico` carries 16/32/48
  PNG-compressed entries; `favicon-16.png`, `favicon-32.png` and `apple-touch-icon.png` (180 px on
  `#0D1015`) sit beside it. The old single-path `favicon.svg` is retired.

Meaning, for the press page: **ignifx** is a blend of _ignite_ and _effects_ (fx). The crystal is the
effect; the flame is the ignition.

### 2.2 The wordmark and lockups

`ignifx` set in **Archivo Variable, weight 600, tracking −0.02 em**, all lowercase, converted to
outlines. There is no capitalised form (`CONSTITUTION.md` §1.5).

Lockups: horizontal (mark + wordmark; the default), stacked (mark above wordmark; for square spaces),
and mark only (favicon, social avatar, app icon). The mark is tall and pointed (aspect 0.70), so the
horizontal construction is decided **optically from rendered candidates, not by a single rule**:
`website/press/build.ts` renders the candidates in its construction sheet (mark spanning the
wordmark's full ink height from the top of the `f` to the bottom of the `g`; mark at 1.15× cap
height centred on the ink box; mark at cap height on the baseline), the coordinator picks one from the
rendered sheet, and the chosen construction is written into `website/press/README.md` with its
measured numbers. The gap between the mark's ink and the wordmark's ink is 0.35 em unless the sheet
shows the sloped facets need more. Minimum widths: horizontal 96 px, stacked 64 px, mark 16 px.

### 2.3 Colour

Tokens are unchanged from the current site because their contrast ratios are measured and tested.
Two are added: `--ember`, a translucent flame used only as the hero glow, and `--ok`/`--warn` for the
browser-support pill.

| Token       | Role                                         | Light                    | Dark                       |
| ----------- | -------------------------------------------- | ------------------------ | -------------------------- |
| `--bg`      | page ground                                  | `#EEF0F4`                | `#0D1015`                  |
| `--surface` | panels, cards, code                          | `#FAFBFC`                | `#14181F`                  |
| `--sunk`    | wells, table heads, the example canvas frame | `#E3E7EE`                | `#1B212A`                  |
| `--ink`     | text                                         | `#14181F`                | `#E7EAF0`                  |
| `--ink-2`   | secondary text                               | `#4B5464`                | `#98A2B3`                  |
| `--rule`    | hairlines, borders                           | `#D2D8E2`                | `#262D38`                  |
| `--flame`   | accent: links, buttons, focus, the mark      | `#A63D07`                | `#FF9E4A`                  |
| `--cool`    | measured figures, "supported"                | `#0B6A78`                | `#5AD1C8`                  |
| `--ember`   | hero glow only                               | `rgba(166, 61, 7, 0.10)` | `rgba(255, 158, 74, 0.12)` |
| `--ok`      | support pill: WebGPU available               | `#1B7F3B`                | `#5BD48A`                  |
| `--warn`    | support pill: WebGPU unavailable             | `#8A5A00`                | `#F2C14E`                  |

All text pairs clear WCAG AA in both themes (the existing test recomputes them; `--ok` and `--warn`
join the table). `--ember` is never behind text.

**The one gradient.** The hero section carries a single radial glow, `--ember` to transparent, centred
behind the running canvas. It is the only gradient on the site. It says "lit from within", which is
the name.

Themes: `:root` holds the light palette; `prefers-color-scheme: dark` and `[data-theme]` override as
the current site does. The default is the visitor's system setting; the toggle persists in
`localStorage`.

### 2.4 Typography

Unchanged faces, because they are already licensed, subset and measured, and because they were chosen
to read as engineering rather than as a template.

| Role    | Face                     | Use                                                   |
| ------- | ------------------------ | ----------------------------------------------------- |
| Display | Archivo Variable 500–700 | Wordmark, `h1`, `h2`, hero headline, stat figures     |
| Body    | Public Sans Variable     | Everything else                                       |
| Mono    | JetBrains Mono Variable  | Code, package names, error codes, the example toolbar |

Scale (root 16 px): 0.75 · 0.875 · 1 · 1.125 · 1.375 · 1.75 · 2.25 · 3 · **4 rem** (hero only,
clamped to 2.5 rem under 600 px). Line heights fixed in rem. Body measure 64ch; marketing paragraphs
under a heading 56ch. Headlines are sentence case, never title case, never all caps.

### 2.5 Spacing, radius, borders

- Space scale: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 px. Sections are separated by 96 px
  (64 px under 800 px).
- Radius: **6 px** on cards, buttons, inputs, code blocks and the example frame; 999 px on pills;
  0 on tables and the header.
- Borders: 1 px `--rule` everywhere. No shadows. Hover on a card raises the border to `--ink-2`.
- Content width: 1200 px max, 24 px side padding (16 px under 600 px). A 12-column grid with 24 px
  gutters above 1040 px; 6 columns to 800 px; single column below.

### 2.6 Motion

- Transitions only on interactive state: 140 ms `cubic-bezier(0.2, 0, 0, 1)` on colour, border and
  outline.
- The hero canvas animates because it is a running example; nothing else on the page animates.
- No scroll-triggered reveals, no parallax, nothing parked at `opacity: 0`.
- `prefers-reduced-motion: reduce`: the hero shows its poster image instead of a running canvas until
  the visitor presses Play; transitions drop to 0 ms.

### 2.7 Iconography and imagery

- The mark is the one raster image in the site's chrome (§2.1); it is placed with `<img>` and a 2× `srcset`. Icons are inline SVG, 20 px, 1.5 px stroke, current colour. Fewer than twenty are needed: GitHub,
  npm, external link, copy, check, play, pause, fullscreen, code, source, download, moon, sun, menu,
  close, chevron, search, gamepad, keyboard, touch.
- Captures are 1280×720 PNG from the visual suite, served as AVIF and WebP with PNG fallback, and
  laid out at 16:9 with `object-fit: cover`. Every capture has alt text that says what is on screen.
- The Open Graph image is 1200×630: dark ground, the horizontal lockup, one capture cropped behind the
  ember glow, and the one-line positioning.

## 3. Components

Each component is listed with its states and the rules an engineer needs. Markup is plain HTML with
classes; there is no component framework.

| Component           | Spec                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Header**          | 56 px, sticky, `--surface` at 92% with `backdrop-filter: blur(12px)`, hairline below. Lockup left; nav centre-right; GitHub, npm, theme right. Skip link first in the DOM.                                                                                             |
| **Support pill**    | A pill that reads "WebGPU: checking…" without JS, then "WebGPU available" (`--ok`) or "WebGPU not available in this browser" (`--warn`) with a link to `/docs/browser-support/`. Uses `navigator.gpu.requestAdapter()`. Appears in the hero and on every example page. |
| **Button**          | Primary: `--flame` fill, white text (light) / `--ink` text (dark). Secondary: hairline border, `--ink`. Ghost: text only. Height 40 px, 0 16 px padding, 6 px radius, mono for commands. Focus ring 2 px `--flame` offset 2 px.                                        |
| **Hero canvas**     | A 16:9 frame in `--sunk` with a 1 px `--rule` border. Holds `<img>` poster + an `<iframe loading="eager">` of `/examples/<hero>/run/` that replaces the poster once the frame reports ready via `postMessage`. Play/pause and "open this example" in a toolbar below.  |
| **Pillar**          | Icon, 1.375 rem heading, one paragraph. Five in a row above 1040 px, then 2+2+1, then stacked.                                                                                                                                                                         |
| **Code block**      | Shiki at build time, classes not styles (CSP). Tabs when a sample has more than one file. A copy button top-right. File name and a "compiled by the docs harness" caption in `--ink-2`.                                                                                |
| **Feature card**    | Package chip (mono, `--sunk`), heading, one sentence, "See it →" link to an example. Grid of 3 above 1040 px, 2 to 600 px, 1 below.                                                                                                                                    |
| **Feature section** | On `/features/`: `h2`, paragraph, a two-column capability list (bullets, terse), and a row of example chips.                                                                                                                                                           |
| **Template card**   | 16:9 capture, name, one line, control icons (keyboard, gamepad, touch), "Play" → the template's example page, "Create" → `create-ignifx --template <name>`.                                                                                                            |
| **Example card**    | 16:9 poster, title, category chip, one line. Whole card is the link. Hover: border darkens, poster does not move.                                                                                                                                                      |
| **Example viewer**  | See `04-examples-platform.md` §3. Frame + toolbar + parameter panel + source pane.                                                                                                                                                                                     |
| **Install block**   | A code block with the install command and a copy button, plus the template picker. Release-gated (`03-pages-and-copy.md` §8).                                                                                                                                          |
| **Table**           | Hairline rows, `--sunk` head, mono for versions and package names. Wide tables scroll inside their own container.                                                                                                                                                      |
| **Callout**         | Left 3 px `--flame` (note) or `--warn` (caution) border, `--surface` fill.                                                                                                                                                                                             |
| **Badge preview**   | On `/press/`: the badge rendered at 1× and 2×, on light and dark, with its `<img>`/Markdown snippet in a code block.                                                                                                                                                   |
| **Footer**          | Three link columns, then the rule line. `--sunk` ground.                                                                                                                                                                                                               |

## 4. Page designs

Wireframes are at desktop width. Copy for every box is in `03-pages-and-copy.md`; only structure is
shown here. `[ ]` is a button, `( )` a pill, `< >` an image or canvas.

### 4.1 Home `/`

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚑ ignifx      Features  Examples  Docs  Press            [GitHub ★] [npm] ☾ │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   OPEN SOURCE · TYPESCRIPT · WEBGPU                                        │
│   Ignite your next game.                                                   │
│   ignifx is an open-source TypeScript game engine built on WebGPU …        │
│   [ Get started ]  [ See the examples ]      (● WebGPU available)          │
│                                                                            │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │ < live hero example: glTF model, IBL, bloom; orbit with mouse >  │     │
│   │                                                     ember glow   │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│    ▶ ⏸  · "Physically based rendering" · open this example →               │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│   Why ignifx                                                               │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                   │
│   │Code    │ │WebGPU  │ │Batteries│ │Browser,│ │Open    │                   │
│   │first   │ │only    │ │included│ │desktop,│ │source  │                   │
│   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘                   │
├────────────────────────────────────────────────────────────────────────────┤
│   This is a complete ignifx app                    ┌────────────────────┐  │
│   A camera, a shadow-casting light, a ground       │ main.ts        ⧉   │  │
│   plane and a spinning cube. Nothing hidden.       │ import { … }       │  │
│                                                    │ class Spinner …    │  │
│   • One obvious way per task                       │ const app = await  │  │
│   • Typed fields, no decorators                    │   createApp(…)     │  │
│   • Extensions in one line                         │ …                  │  │
│                                                    └────────────────────┘  │
├────────────────────────────────────────────────────────────────────────────┤
│   Everything a game needs                                                  │
│   ┌────────┐ ┌────────┐ ┌────────┐   twelve feature cards, 3 per row,      │
│   │Rendering│ │3D physics│ │2D physics│  each "See it →" to an example      │
│   └────────┘ └────────┘ └────────┘                                         │
│   …                                                    All features →      │
├────────────────────────────────────────────────────────────────────────────┤
│   Start from a playable game                                               │
│   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│   │<2D top-down>│ │<2D side-  │ │<3D third-  │ │<3D first-  │              │
│   │ ⌨ 🎮 ☝     │ │ scroller> │ │ person>    │ │ person>    │              │
│   └────────────┘ └────────────┘ └────────────┘ └────────────┘              │
├────────────────────────────────────────────────────────────────────────────┤
│   See it running                                                           │
│   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   six examples     │
│   └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘   All examples →   │
├────────────────────────────────────────────────────────────────────────────┤
│   Built by a studio that ships with it                                     │
│   Astrum Forge Studios … (two sentences)                    astrumforge.com │
├────────────────────────────────────────────────────────────────────────────┤
│   Get started in a minute                                                  │
│   ┌────────────────────────────────────────────────┐                       │
│   │ $ npm create ignifx@latest my-game        ⧉    │   [ Read the guide ]   │
│   └────────────────────────────────────────────────┘                       │
│   Runs on Chrome and Edge 113+, Safari 26+, Firefox 141+ … Electron.        │
├────────────────────────────────────────────────────────────────────────────┤
│   Product · Learn · Company                                   © 2026 …      │
└────────────────────────────────────────────────────────────────────────────┘
```

Rules: the hero is as tall as its content, never `100vh`. The live example is `pbr-model` from the
catalogue (`04-examples-platform.md` §7.2); its poster is the 1280×720 capture. On a browser without
WebGPU the poster stays and the support pill explains why; the page still sells.

### 4.2 Features `/features/`

```
│ Features                                                                    │
│ Everything in the box, grouped the way you will use it.   [ Get started ]   │
│                                                                              │
│ ▸ Kernel and scripting   ▸ Rendering   ▸ Assets and scenes   ▸ Input … (jump links, sticky) │
│                                                                              │
│ ── Rendering ──────────────────────────── @ignifx/core ──                    │
│ One paragraph.                                                               │
│ • Perspective and orthographic cameras     • Directional, point, spot, hemispheric lights │
│ • PCF and ESM shadow maps, cascades        • glTF 2.0 models with material overrides      │
│ • …                                        • …                                             │
│ See it: (Physically based rendering) (Shadows) (Bloom) (Tone mapping)        │
│                                                                              │
│ ── 3D physics ─────────────────────────── @ignifx/physics ──                │
│ …                                                                            │
```

Fifteen sections in the order of `03-pages-and-copy.md` §4. The jump-link bar is sticky under the
header above 1040 px and becomes a `<details>` list below.

### 4.3 Examples `/examples/`

```
│ Examples                                                                     │
│ Every example runs in your browser, on this page's engine build, with its    │
│ source beside it.                                     (● WebGPU available)   │
│                                                                              │
│ (All) (Rendering) (Post-processing) (Lighting) (Models) (2D) (Physics) (Gameplay) (Input) (Audio) (UI) (Platform) │
│                                                                              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                          │
│ │<poster>  │ │<poster>  │ │<poster>  │ │<poster>  │   4 per row              │
│ │Title     │ │Title     │ │Title     │ │Title     │                          │
│ │(Rendering)│ │(Models) │ │(2D)      │ │(Physics) │                          │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                          │
│ …                                                                            │
│ Sample models and environments are credited on the attribution page →        │
```

The filter chips are anchor links to `<section id>`s (no JS needed); with JS they filter in place and
update the URL hash. Posters are static images; **no canvas runs on the index**.

### 4.4 One example `/examples/<slug>/`

```
│ ← All examples                                                               │
│ Physically based rendering                              (Rendering) · 3D    │
│ One paragraph: what you are looking at and what to try.                      │
│                                                                              │
│ ┌────────────────────────────────────────────────────┐ ┌──────────────────┐ │
│ │                                                    │ │ Parameters       │ │
│ │  < running example, 16:9, fills the column >       │ │ Exposure   ──●── │ │
│ │                                                    │ │ Rotation   ──●── │ │
│ │                                                    │ │ Bloom      [x]   │ │
│ │                                                    │ │ Model  [Helmet▾] │ │
│ └────────────────────────────────────────────────────┘ └──────────────────┘ │
│  ▶ ⏸  ⛶ fullscreen  ↗ open standalone  ` devtools     12.4 ms · 1,204 draws │
│                                                                              │
│ Source                                   [ View on GitHub ↗ ]  [ Copy ⧉ ]    │
│ ┌ main.ts ┐┌ scene.json ┐┌ index.html ┐                                       │
│ │ import { createApp, Environment, Model } from "ignifx";                    │
│ │ …                                                                          │
│ └────────────────────────────────────────────────────────────────────────────┘
│                                                                              │
│ Uses: Model · Environment · PostProcessStack · @ignifx/input   Assets: BoomBox (CC0, Microsoft) │
│ ← Previous: Shadows                                        Next: Bloom →     │
```

The running example is an `<iframe>` of `/examples/<slug>/run/`, 16:9, `loading="eager"` on this page
only. The parameter panel is **inside the iframe** (it is part of the example, built with the shared
kit) so the viewer page itself has no example-specific code. The frame-time and draw-call figures come
from `app.diagnostics` through `postMessage` and show only while running. Under 1040 px the parameter
panel sits below the canvas; under 600 px the source pane is collapsed behind "Show source".

### 4.5 Docs hub `/docs/`

```
│ Docs                                                                         │
│ Start here, then read a guide that does one thing.                           │
│ ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐        │
│ │ Getting started    │ │ Guides (16)        │ │ API reference ↗    │        │
│ │ Five minutes …     │ │ One task each …    │ │ Every export …     │        │
│ └────────────────────┘ └────────────────────┘ └────────────────────┘        │
│ ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐        │
│ │ Templates          │ │ Browser support    │ │ Contributing ↗     │        │
│ └────────────────────┘ └────────────────────┘ └────────────────────┘        │
│ Guides                                                                       │
│ Scenes and assets · Rendering · Input · 3D · 2D · Audio · UI · Saving · Tools │
│ (grouped list of the sixteen guides, title + one line)                       │
```

### 4.6 Getting started `/docs/getting-started/`

A single column, 64ch, numbered steps with code blocks, the browser check pill at the top, and a
template picker (four cards, compact) in step 2. The pre-release variant replaces step 1 (`03` §8).

### 4.7 Guide `/docs/guides/<name>/`

Title, the recipe's prose, one code block (the harness-compiled recipe, unchanged), "Run this
example" when a catalogue example covers the same ground, "Open on GitHub", previous/next.

### 4.8 Press `/press/`

```
│ Press kit                                                                    │
│ Everything you need to write about ignifx or say your game runs on it.       │
│ [ Download the logo package (.zip) ]  [ info@astrumforge.com ]               │
│                                                                              │
│ About ignifx (short · medium · long boilerplate, each with a copy button)    │
│ The name                                                                     │
│ Fact sheet (table)                                                           │
│ Logos            ┌ mark ┐ ┌ wordmark ┐ ┌ horizontal ┐ ┌ stacked ┐  light/dark/mono, SVG/PNG │
│ Badges           ┌ Powered by ignifx ┐ ┌ Made with ignifx ┐  + Markdown/HTML snippets       │
│ Usage            do / don't list, clear space diagram, minimum sizes         │
│ Colours          swatches with hex                                           │
│ Screenshots      six captures, 1280×720, download each                       │
│ Contact                                                                       │
```

### 4.9 404

The mark, "This page has gone dark.", one sentence, and the five real entrances as links.

## 5. Responsive behaviour

| Breakpoint  | Changes                                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| ≥ 1040 px   | Full grid; example page is canvas + side panel; features jump bar sticky.             |
| 800–1039 px | Pillars 2+2+1; example panel moves under the canvas; jump bar becomes `<details>`.    |
| 600–799 px  | Header nav collapses to a menu; cards 2 per row; hero headline 3 rem.                 |
| < 600 px    | Single column; hero headline 2.5 rem; source pane collapsed; posters 16:9 full width. |

Touch: every control is at least 44×44 px. The example toolbar buttons have visible labels above
800 px and icon-only with `aria-label` below.

## 6. Accessibility

- One `h1` per page, landmarks (`header`, `nav`, `main`, `footer`), a skip link, `lang="en"`.
- Every image has alt text; every capture's alt says what is in the scene.
- Every iframe has a `title`; the running example is announced as "Interactive example: <title>".
- Keyboard: the whole site is operable without a pointer; the example iframe is reachable and
  escapable with Tab; focus rings are visible in both themes.
- Motion: reduced-motion visitors get posters and a Play button.
- Colour is never the only carrier of meaning (the support pill also says the words).
- All of the above stays enforced by `website/test/site.test.ts`, extended for the new routes.

## 7. Design deliverables to produce before build

| Deliverable                                       | Format                   | Notes                                                       |
| ------------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| Wordmark and lockups (light, dark, mono)          | SVG, PNG @1×/2×/4×       | `05-press-kit.md` §3 lists every file                       |
| Badges (Powered by, Made with)                    | SVG, PNG                 | Two colourways each, 20 px and 32 px heights                |
| Open Graph image                                  | PNG 1200×630             | Rebuilt whenever the hero capture changes                   |
| Poster captures for every launch example          | PNG 1280×720 → AVIF/WebP | Produced by the visual suite, not by hand                   |
| Six press screenshots                             | PNG 1280×720             | The four templates, the hero example, one 2D example        |
| Icon set (about twenty)                           | Inline SVG sprite        | 20 px, 1.5 px stroke                                        |
| Figma or Penpot file of the nine wireframes above | Optional                 | Only if a designer joins; this document is sufficient alone |
