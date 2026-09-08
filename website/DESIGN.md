# Design

The design system for ignifx.com lives in **[`plan/02-design-system.md`](plan/02-design-system.md)**:
brand foundations (the mark, the wordmark, the palette with its measured contrast ratios, the three
self-hosted faces), the type scale, spacing, motion, every component with its states, an ASCII
wireframe per page, the responsive table, and the accessibility rules.

The copy is in [`plan/03-pages-and-copy.md`](plan/03-pages-and-copy.md) and is pasted, not rewritten.

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
