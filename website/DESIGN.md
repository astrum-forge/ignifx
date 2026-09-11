# Design

The design system for ignifx.com lives in **[`plan/02-design-system.md`](plan/02-design-system.md)**:
brand foundations (the mark, the wordmark, the palette with its measured contrast ratios, the three
self-hosted faces), the type scale, spacing, motion, every component with its states, an ASCII
wireframe per page, the responsive table, and the accessibility rules.

The current copy lives in `scripts/copy.ts`, `scripts/copy-features.ts`, the page renderers and
`examples/entries/`. The launch copy in [`plan/03-pages-and-copy.md`](plan/03-pages-and-copy.md)
is historical. Edit the source copy and review the built page.

## Content and layout (2026-09-11)

Write for a developer deciding whether to try the engine. Explain what they can build before
describing how a subsystem works. Use short sentences, familiar words and specific actions.
Keep API signatures in the reference docs and implementation details in example source files.
Avoid broad promises about completeness, compatibility, speed or testing.

The homepage moves from the live demo and three reasons to choose ignifx into playable templates,
then code, six feature highlights, examples and setup. Templates use two columns on desktop so
visitors can see the games. Feature highlights use simple dividers; playable cards keep their
bordered surfaces. The ship remains the main visual focus.

Keep Archivo for headings, Public Sans for reading and JetBrains Mono for code. Keep the existing
palette: paper `#FAFBFC`, blue-grey `#EEF0F4`, ink `#14181F`, flame `#A63D07` and dark ground
`#0D1015`, with the dark-theme values in `tokens.css`. Introductions stay left aligned, and body
copy stays within the existing reading measures. Use sentence case for introductory labels.

Feature pages lead with a short explanation and a scannable list. Link to an example only when it
exists. Example introductions describe what visitors see and can try; the source and API list
provide the technical detail. Button labels describe their action, including “Copy command”.

## Earlier design decisions

The decisions taken when the plan met the repository — and every deviation from it — are logged in
**[`plan/08-execution.md`](plan/08-execution.md)**. The build's own constraints (the two
Content-Security-Policies, the JSON-LD hash, the retired skill pages) are in
[`../docs/adr/0020-website-builds-the-workspace.md`](../docs/adr/0020-website-builds-the-workspace.md),
which amends [`../docs/adr/0019-website-static-site.md`](../docs/adr/0019-website-static-site.md).

The values themselves are in `src/styles/tokens.css`, which `test/site.test.ts` parses to re-check
that every text pair clears WCAG AA in both themes. That test is the design system's only hard gate;
everything else here is a document.

This file previously held the Phase 12 "instrument panel" design. It was superseded on 2026-09-07 by
the overhaul plan above.

## Identity refresh — 2026-09-11

The current logo uses a single-colour geometric flame from `brand/ignifx-mark.svg`,
paired with the existing lowercase Archivo SemiBold wordmark. Header type is 22 px;
the icon is 1.2 em with a 0.3 em gap. The original crystal artwork remains archived.
`pnpm --filter @ignifx/website brand` generates every current site brand asset.

The press page and public downloads are paused. `/press/` temporarily redirects home;
previous downloads are preserved under `press/legacy-assets/`, outside the public build.
This supersedes the identity and press-kit sections of the historical plan.
