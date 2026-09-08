# 01 · Strategy, messaging and information architecture

## 1. What the site is for

ignifx.com has one job: make a developer who writes TypeScript want to build their next game on ignifx,
and let them start in under five minutes. Everything else on the site exists to support that job:
proving the engine is real (running examples), proving it is complete (the feature list), proving it
is safe to adopt (open source, Apache-2.0, a studio that ships with it), and making it easy to talk
about (the press kit).

The site is **not** a documentation server, an agent index, or a status page for the engineering plan.
Those live in the repository.

## 2. Audiences

| Audience                                  | What they need from the site                                                                                              | Where they go                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Indie developers who write TypeScript** | "What is it, what does it look like, can my browser run it, how do I start?"                                              | Home → Examples → Getting started |
| **Web developers entering games**         | Familiar tooling (Vite, npm, TypeScript), a code sample they can read, templates they can copy                            | Home → Features → Templates       |
| **Studios and technical leads**           | The complete feature list, the platform story (browser + Electron), licence, security posture, who is behind it           | Features → Docs → GitHub          |
| **Educators and hobbyists**               | Runnable examples with source, guides that do one thing each                                                              | Examples → Guides                 |
| **Press, partners, other developers**     | Boilerplate, logos, badges, a contact address                                                                             | Press                             |
| **AI coding agents**                      | One machine-readable entry that points at the Agent Skill in the repository. Not a visitor; not designed for on the site. | `/llms.txt` only                  |

## 3. Positioning

**One line.** ignifx is an open-source TypeScript game engine built on WebGPU, for games that run in
the browser and on the desktop.

**One paragraph.** ignifx is a code-first game engine for the modern web. You write your game in
TypeScript with entities, components and scripts; the engine renders it through WebGPU, simulates it
with Havok and Rapier, plays it through a proper mixer, reads it from keyboard, gamepad and touch, and
ships it to any modern browser or, through Electron, to Windows, macOS and Linux. It is built and used
by Astrum Forge Studios, and it is Apache-2.0.

**The category we claim.** "The TypeScript game engine for WebGPU." Not "the fastest", not
"production-ready", not "the easiest": none of those can be proved from the repository yet, and the
constitution and the current site both refuse claims the code does not back. "Built for WebGPU" is a
fact and a differentiator: every other web engine a reader knows carries a WebGL past.

## 4. Messaging pillars

Five pillars carry the site. Every page leads with one of them; the home page shows all five.

1. **Code first.** The game is TypeScript, not a project file. Entities, components, scripts with
   typed, schema-declared fields; one obvious way per task; no decorators, no globals, no magic.
2. **WebGPU only, by design.** One render path through Babylon Lite: PBR materials, image-based
   lighting, shadows, bloom and anti-aliasing that behave the same wherever WebGPU runs. No WebGL
   fallback to test twice.
3. **Batteries included.** 3D physics on Havok, 2D physics on Rapier, spatial audio with buses,
   action-based input with rebinding, a DOM UI layer, animation state machines, navigation meshes,
   sprites and tilemaps. Each is one line in `createApp`.
4. **Browser, desktop, and headless.** The same game runs in a browser tab, in a hardened Electron
   window, and headlessly in Node for tests and tools. Saves, settings and rebinds persist on all of
   them.
5. **Open source, from a studio that ships with it.** Apache-2.0, developed in the open, and used by
   Astrum Forge Studios for its own games and projects.

Supporting proof points, used as captions and bullets rather than headlines: deterministic fixed-step
simulation; a device-loss recovery path; an `IGX-####` code on every engine error; four playable
templates with menus, settings, rebinding and saves; a devtools overlay that costs nothing while
closed; a Vite plugin that validates scene and asset JSON at build time.

## 5. Tone of voice

- **Confident and concrete.** Say what the engine does in the present tense. "Rigid bodies on Havok",
  not "powerful physics".
- **Short sentences, plain words.** A visitor skims. Headlines are under eight words; paragraphs are
  under sixty.
- **No hype vocabulary.** Banned: blazing, powerful, seamless, next-generation, revolutionary,
  effortless, production-ready, battle-tested, world-class. Allowed: fast when measured, simple when
  the code shows it.
- **Numbers only when measured.** A number on the site comes from the repository (a benchmark row, a
  bundle size, a browser version) or it is not on the site.
- **The name is `ignifx`, lowercase, always**, including at the start of a sentence (`CONSTITUTION.md`
  §1.5). Rewrite a sentence rather than capitalise the name. Package names are written as code:
  `@ignifx/physics`.
- **Address the reader as "you". Refer to the studio as "we" only on the press page and in the
  footer.**
- **British-neutral spelling** is already the repository's convention (colour, licence, serialise).
  Keep it consistent; the copy in `03-pages-and-copy.md` follows it.

## 6. Honesty rules

These are hard rules, inherited from `CONSTITUTION.md` and the current `DESIGN.md`, and they survive
the marketing rewrite.

1. Nothing on the site claims what the repository does not prove. The features page is derived from
   the packages that exist and the skills that document them; an example that cannot run is not
   listed as an example.
2. **Release gating.** Until the first `0.x` release is on npm, every install surface shows the
   pre-release variant (`03-pages-and-copy.md` marks both). The build reads the version from
   `packages/core/package.json` and a `published` flag from `website/site.config.ts`; flipping the
   flag switches every variant at once. No npm link goes live before the package does.
3. **Browser support is stated exactly** (Chrome and Edge 113+, Safari 26+, Firefox 141+ on Windows
   and 145+ on Apple Silicon) and the page tests the visitor's browser and says so.
4. **No analytics script, no third-party request.** Cloudflare's server-side Pages analytics is the
   only measurement, and it needs no code.
5. **Every third-party asset on the site is attributed** on `/examples/attribution/` with its licence,
   and none is licensed non-commercially.

## 7. Site map

```
/                          Home — pillars, live hero, code sample, feature grid, templates, examples, install
/features/                 Features — the complete, grouped capability list with example links
/examples/                 Examples — the gallery (posters, filters by category)
/examples/<slug>/          One example — running canvas, controls, source pane, GitHub link
/examples/<slug>/run/      The bare example app (what the viewer embeds; also opens standalone)
/examples/attribution/     Licences and credits for every sample asset used by the examples
/docs/                     Docs hub — getting started, guides, API reference, templates, support matrix
/docs/getting-started/     From nothing to a running template (pre-release and release variants)
/docs/guides/              The sixteen recipes as guides, one page each
/docs/guides/<name>/
/docs/browser-support/     The support matrix, what WebGPU is, how to enable it, the in-page check
/press/                    Press kit — boilerplate, name story, logos, badges, usage, contact
/404.html                  Not found
/llms.txt                  The single agent entry point (see §10)
/sitemap.xml · /robots.txt
```

Twenty-four fixed routes plus one per example (about fifteen at launch, sixty when the catalogue is
complete) and one per guide. Everything is prerendered; there is still no client-side router.

### Redirects from the current site

| From                | To                              | Why                                               |
| ------------------- | ------------------------------- | ------------------------------------------------- |
| `/gallery/`         | `/examples/`                    | Renamed                                           |
| `/getting-started/` | `/docs/getting-started/`        | Moved under docs                                  |
| `/skill/`           | GitHub `skills/ignifx/SKILL.md` | Skill pages leave the site (§10)                  |
| `/skill/*`          | GitHub `skills/ignifx/*`        | One splat rule; the GitHub path mirrors the route |
| `/docs/skill/*`     | GitHub, as above                | Existing alias, retargeted                        |

## 8. Navigation

**Header** (sticky, 56 px, blurred surface over content):
`[mark] ignifx` · Features · Examples · Docs · Press · `[GitHub ★]` · `[npm]` · theme toggle.

- The GitHub button shows the star count **only if** it can be read at build time without a runtime
  request (a build-time fetch of the repository API is fine; a runtime one is not). Otherwise it is a
  plain "GitHub" button.
- The npm button is present in both variants; pre-release it reads "npm · coming soon" and is not a
  link (`03-pages-and-copy.md`).
- Under 800 px the four text links collapse into a disclosure menu; GitHub stays visible.

**Footer** (three columns plus a bottom rule):

| Product            | Learn                  | Company                                |
| ------------------ | ---------------------- | -------------------------------------- |
| Features           | Getting started        | Astrum Forge Studios (astrumforge.com) |
| Examples           | Guides                 | Press kit                              |
| Templates          | Browser support        | Contact: info@astrumforge.com          |
| Changelog (GitHub) | API reference (GitHub) | Security policy (GitHub)               |
| npm                | Contributing (GitHub)  | Licence: Apache-2.0                    |

Bottom rule: "© 2026 Astrum Forge Studios Pty Ltd · ignifx is a trademark of Astrum Forge Studios ·
Building with an AI agent? Start at `/llms.txt`."

That last sentence is the only agent-facing text a visitor will ever see.

## 9. Calls to action

Every page has exactly one primary CTA and at most one secondary.

| Page            | Primary                   | Secondary                 |
| --------------- | ------------------------- | ------------------------- |
| Home            | Get started               | See the examples          |
| Features        | Get started               | Read the guides           |
| Examples index  | (browse)                  | Open on GitHub (per card) |
| Example page    | View source on GitHub     | Open standalone           |
| Docs hub        | Getting started           | Star on GitHub            |
| Getting started | Copy the install command  | Pick a template           |
| Press           | Download the logo package | Email us                  |

## 10. The single agent entry point

`/llms.txt` stays, because it is the convention agents already look for, and it remains generated by
`pnpm docs:llms`. What changes is where it points: every URL in it becomes an absolute link to the
file in the GitHub repository (`https://github.com/astrum-forge/ignifx/blob/main/skills/…`) instead
of a page on the site. The sixty-two `/skill/…` routes are removed and redirected to the same files.

Reasons: the skill is the documentation and it lives in the repository; `npx skills add
astrum-forge/ignifx` is the distribution channel the umbrella package ships; the two generated API
pages are 1.6 MB and 609 KB of Markdown that no visitor should hit by accident; and the brief asks for
one entry point, not a mirror. The consequence for the build and the tests is recorded in
`06-engineering.md` §3, with the alternative (keep the pages, unlinked) if the owner prefers it.

## 11. Success measures

Cloudflare Pages analytics (server side, no script), GitHub, and npm give everything needed:

- Unique visitors and the split between `/`, `/examples/*` and `/docs/getting-started/`.
- Referrals to GitHub and, after release, weekly npm downloads of `ignifx` and `@ignifx/core`.
- Time-on-page for example pages, which is the only signal that the examples are being played.
- GitHub stars and issues opened by people who are not the studio.

No goals are set for launch; the first month's numbers become the baseline.
