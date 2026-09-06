# ignifx.com — design plan

Written before the build (Phase 12). Binding on `website/**`; the numbers here are measured, not aspirational.

## Subject and audience

ignifx is a WebGPU-only TypeScript game engine at `0.x` with **nothing published**. The site therefore cannot sell a product;
it can only show the work and let two audiences act on it.

1. **Indie developers who write TypeScript.** They want to know what the engine is, whether their browser can run it, what the
   code looks like, and how to try it today from a clone.
2. **AI coding agents.** They read `/llms.txt`, then every skill page under `/skill/` (62 at the time of writing, discovered from the tree rather than listed). For them the site is a documentation
   server: stable URLs, real headings, no client-side rendering, no JavaScript requirement.

Nothing on the site may claim more than the repository proves. No "fastest", no "production-ready". "0.x, not yet published"
is the honest headline and it stays visible on every page through the status chip in the header.

## One job per route

`/` makes a reader understand the frame ignifx runs, and see real code, in one screen. `/features/` answers "does it do X?"
per subsystem with the real API names. `/getting-started/` gets a reader from nothing to a running template today,
unpublished packages and all. `/gallery/` shows what the templates and examples actually look like and how to drive them.
`/docs/` routes a reader — or an agent — to the right document out of ~90 in the repository. Each of the 62 `/skill/…`
pages renders one Markdown file so it reads better than GitHub and links like a manual. `/404.html` offers the five real
entrances.

## Identity: the instrument, not the poster

The engine's own subject matter is **a frame under a budget**: a fixed step, six ordered phases, ~16.7 ms, an `IGX-####`
code when something is wrong. So the site is drawn as an instrument panel — a measuring surface, not a brochure. Hairlines
and tick marks carry structure; panels are square-cornered and unshadowed; the only ornament is a real measurement.

Every section heading hangs off a left gutter that carries a **real identifier** — `@ignifx/physics`, `IGX-0902`,
`0.1624 ms`, `1.27.0`. Never `01 / 02 / 03`: there is no sequence to number, and inventing one is decoration.

**The one bold moment** is the hero: the frame scheduler drawn as an inline SVG timeline of the six phases across one
16.7 ms budget, labelled with the phase names from `skills/ignifx/SKILL.md`. It is complete and correct in the HTML with
JavaScript off — a playhead sweeps it only as an enhancement, and only when `prefers-reduced-motion` is not set. Everything
else on the site is quiet: rules, space, one accent.

### Rejected as generic defaults

- _Warm cream + serif + terracotta_ — the current editorial default; it says "essay", not "instrument". The palette below
  is deliberately **cool** (hue ≈ 218) so the amber reads as heat against metal, not as ceramic.
- _Near-black with one acid-green pop_ — a developer-tool cliché, and acid green fails AA on light grounds, which forces a
  light theme that is only a dark theme with the lights on. _Purple-to-blue gradient hero_ — there are no gradients here at
  all; a gradient asserts energy the repository has not earned. _Inter or Space Grotesk as the body face_ — see typography.
- _Emoji section markers, centred everything, one radius + one shadow per block, a 100vh hero, `01/02/03` markers_ — five
  template tells. Sections are left-aligned against a gutter, blocks are square-cornered and unshadowed, the hero is as
  tall as its content, and markers are real identifiers. _A broadsheet hairline grid_ — pastiche; these rules are tick
  marks with a job (the millisecond scale, the section boundary), not a newspaper reference.

## Colour tokens

Six named roles per theme plus two accents. Neutrals are biased to hue ≈ 218 (cool blue-grey), never pure grey.

| Token       | Role                                 | Light     | Dark      |
| ----------- | ------------------------------------ | --------- | --------- |
| `--bg`      | page ground                          | `#EEF0F4` | `#0D1015` |
| `--surface` | panels, code, cards                  | `#FAFBFC` | `#14181F` |
| `--sunk`    | inset wells, table headers           | `#E3E7EE` | `#1B212A` |
| `--ink`     | body and heading text                | `#14181F` | `#E7EAF0` |
| `--ink-2`   | secondary text, captions, gutter     | `#4B5464` | `#98A2B3` |
| `--rule`    | hairlines, tick marks, borders       | `#D2D8E2` | `#262D38` |
| `--flame`   | accent: links, focus ring, playhead  | `#A63D07` | `#FF9E4A` |
| `--cool`    | accent: measured figures, "verified" | `#0B6A78` | `#5AD1C8` |

Measured contrast ratios (WCAG 2.1, computed from these hex values; `test/site.test.ts` recomputes all twelve pairs and
fails under 4.5). Worst case on each ground, light / dark: `ink` 15.60 / 15.81 on `bg` and 14.35 / 13.43 on `sunk`;
`ink-2` 6.69 / 7.40 on `bg` and 6.15 / 6.28 on `sunk`; `flame` 5.59 / 9.29 on `bg` and 5.14 / 7.89 on `sunk`; `cool`
5.50 / 10.33 on `bg` and 5.06 / 8.78 on `sunk`. Every text pair clears AA in both themes and body text clears AAA;
`--rule` is a non-text hairline and is exempt.

`:root` carries the full light palette. `@media (prefers-color-scheme: dark)` redefines the tokens under
`:root:not([data-theme="light"])`, and `:root[data-theme="dark"]` redefines them again so the toggle wins in both
directions. `color-scheme` is declared on `:root` and re-declared per theme; `body` paints `--bg` explicitly.

## Typography

| Role    | Face                       | Fallback stack                                                                       | Why                                                                                                                                     |
| ------- | -------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Display | Archivo Variable (400–700) | `"Archivo Variable Fallback", Helvetica Neue, Arial, sans-serif`                     | An engineered grotesque with square terminals: instrument, not tech-startup. Used only for `h1`/`h2`, the wordmark, and the hero.       |
| Body    | Public Sans Variable       | `"Public Sans Variable Fallback", Helvetica Neue, Arial, sans-serif`                 | A neutral text face with a taller x-height and less uniform rhythm than Inter; carries long skill prose without turning into UI chrome. |
| Mono    | JetBrains Mono Variable    | `"JetBrains Mono Variable Fallback", ui-monospace, SFMono-Regular, Menlo, monospace` | Code, error codes, millisecond figures, and every gutter label.                                                                         |

Latin `woff2`, weight axis only: 34,928 + 26,832 + 40,404 = **102,164 bytes (99.8 KB)** against a 120 KB budget.
`font-display: swap`; Archivo and Public Sans are preloaded (both are above the fold on every route). No layout shift:
line heights are fixed in `rem`, and each web face has a `size-adjust` fallback `@font-face` whose factor was **measured in
Chromium** by comparing advance widths against the system stack (recorded in `scripts/fonts.ts`: Archivo 97.8%, Public Sans 104.0%, JetBrains Mono 99.7%).

Type scale (root 16 px, ratio ≈ 1.25, clamped for the display sizes): 0.75 / 0.875 / 1 / 1.125 / 1.375 / 1.75 / 2.25 / 3 rem.
Prose measure is `68ch`; skill pages hold it while their code and tables break out to the full column.

## Layout concept and motion

A three-band page: a hairline **rule strip** of tick marks under the header, a **gutter + column** body where every
section's identifier sits in a 9.5 rem left gutter at `≥ 1040 px` and collapses above the heading below that, and a footer
that is a plain index rather than a sitemap wall. Skill pages add a section rail on the left and a contents rail on the
right, both collapsing into the flow under 1040 px and 1360 px.

Transitions exist only on interactive state (`background-color`, `border-color`, `color`, `outline`) at 140 ms
`cubic-bezier(0.2, 0, 0, 1)`. One looping animation on the whole site: the hero playhead, 2.4 s linear. Nothing animates on
scroll, nothing is parked at `opacity: 0`, and no element waits for an observer to become visible.
`@media (prefers-reduced-motion: reduce)` disables the playhead and reduces every transition to 0 ms.

## Information architecture

```
/                     hero + frame timeline · code sample · subsystem grid · measured figures · status
├── /features/        11 subsystem sections, each → /skill/<name>/
├── /getting-started/ browser support · the working path today · the create-ignifx path "when 0.1 ships"
├── /gallery/         4 templates + 2 examples, captures, controls, source links
├── /docs/            skill · architecture · constitution · ADRs · standards · plan · llms.txt
└── /skill/           entry skill
    ├── /skill/<subsystem>/            9 extension skills
    └── /skill/references/<dir>/<name> concepts · recipes · formats · api  (+ /skill/references/gotchas)
```

Header nav is the five top-level routes; the skill's pages are reached from `/docs/`, from the rail inside `/skill/`, and
from search (`/`, or `s`). `/llms.txt` and `/sitemap.xml` are the agent entrances and are linked from the footer.
