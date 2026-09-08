# ignifx.com overhaul — plan and design

**Status:** proposal v1, 2026-09-07 · **Owner:** Astrum Forge Studios · **Scope:** `website/**` only
**Supersedes on implementation:** `website/DESIGN.md` (the Phase 12 instrument-panel design) and the
current five-route site.

This folder is a hand-over package. An engineer should be able to build the new ignifx.com from it
without asking what a page says, how it looks, which examples exist, or what the build must keep
doing. Nothing in here is code; everything in here is decided unless it is listed under **Open
decisions** in `06-engineering.md`.

## The brief, restated

Turn ignifx.com from a documentation shell into a customer-facing product site that:

1. says what ignifx is, plainly and persuasively, to developers who have never heard of it;
2. lists every feature the engine actually has, grouped so a reader can answer "does it do X?";
3. links to the GitHub repository and the npm packages from every page;
4. runs the engine's examples **in the browser, on the site**, three.js style, with the source code
   beside each one and a link to the same file on GitHub;
5. offers a press kit: the mark, the wordmark, "Powered by ignifx" badges, boilerplate, and the story
   behind the name;
6. keeps every agent-facing artefact out of the visitor's way, behind one entry point (`/llms.txt`);
7. stays simple: a handful of pages, one build, no framework, no third-party requests.

## Read in this order

| Document                  | What it settles                                                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-strategy-and-ia.md`   | Who the site is for, what it must say, the messaging pillars, tone of voice, the honesty rules, the site map, navigation, redirects, and the single agent entry.                                                                                           |
| `02-design-system.md`     | Brand foundations (mark, wordmark, colour, type), layout, motion, every component, and an ASCII wireframe per page.                                                                                                                                        |
| `03-pages-and-copy.md`    | The final copy for every page, including titles, meta descriptions, the pre-release and post-release variants, and the 404.                                                                                                                                |
| `04-examples-platform.md` | How examples are built, embedded, sourced, licensed and captured; the shared example kit; and the full catalogue of examples to develop, each with a status.                                                                                               |
| `05-press-kit.md`         | What `/press/` contains, the logo and badge package, usage rules, the boilerplate, and the production list of files.                                                                                                                                       |
| `06-engineering.md`       | What changes in the build, the CSP, the tests and the ADRs; SEO and social metadata; the work breakdown with estimates and acceptance criteria; the launch checklist.                                                                                      |
| `07-wishlist.md`          | The wishlist: examples and engine features that game developers want but that need engine work, custom code or upstream changes first; usefulness and effort per item; the rule that nothing on it reaches the site before it is delivered and functional. |

## Facts the plan is built on (verified 2026-09-07)

- The engine is at version `0.0.0`; **nothing is published to npm**. The site is designed to launch
  alongside the first `0.x` release and carries a pre-release variant for every install surface.
- Thirteen workspace packages exist and build: `@ignifx/core`, `vite-plugin`, `input`, `physics`
  (Havok), `audio`, `2d`, `physics-2d` (Rapier), `3d`, `ui`, `electron`, `devtools`, `cli`, and the
  `ignifx` umbrella. Licence: Apache-2.0.
- Rendering is WebGPU only through Babylon Lite 1.27.0. The engine's post-processing surface today
  is **bloom, SMAA and image processing** (exposure, contrast, Standard/ACES/Neutral tone mapping).
  Babylon Lite 1.27.0 also ships depth of field, chromatic aberration, TAA, screen-space contact
  shadows and screen-space global illumination, none of which ignifx exposes yet, and it has **no
  SSAO** at all. `04-examples-platform.md` separates what can be shown today from what needs engine
  work first.
- Custom shader materials are declared in the material format (`"type": "shader"`) but rejected at
  runtime with `IGX-0708`; Babylon Lite has `createShaderMaterial`. They head the wishlist
  (`07-wishlist.md` W-R1) and are not claimed anywhere on the site.
- Four playable templates, two example apps and sixteen compiled recipes exist. Their goldens and
  frame budgets are enforced in CI.
- `CONSTITUTION.md` §1.5: the name is written `ignifx`, always lowercase. §9.1: no telemetry, and the
  site loads nothing from a third party at runtime. Both are kept.
- The site builds from a fresh clone with one root command on Cloudflare Pages (ADR-0019). Running
  examples on the site changes the build order and two CSP rules; `06-engineering.md` records the
  ADR amendment.

## The wishlist rule

`07-wishlist.md` lists what the engine cannot show yet. A wishlist item is not an example and is not on
the website, not even as "coming soon", until the engine feature has shipped with tests and a skill
entry and the example meets the definition of done in `04-examples-platform.md` §9. The site build
only accepts catalogue entries whose status is `ready`, so the rule is enforced, not remembered.

## What is deliberately not in this plan

A visual editor, a blog, a community forum, a newsletter, pricing, a hosted playground with an in-page
editor, and a rendered copy of the 62 skill pages. The first five are not products ignifx has; the last
is the "agentic stuff" the brief asks to keep off the site, and the source repository already serves it.
