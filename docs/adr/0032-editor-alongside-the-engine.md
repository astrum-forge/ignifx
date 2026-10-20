# ADR-0032 · The editor is developed alongside the engine

**Status:** Accepted (2026-10-20, ratified by the owner) · **Date:** 2026-10-20 · **Deciders:** Astrum Forge Studios (owner)

## Context

`CONSTITUTION.md` §1.3 said a visual editor "may follow 1.0", and the engineering plan's risk R-12 called the editor "explicitly post-1.0". Both were written when the editor was an idea for after the engine.

That is no longer how the work runs. The editor is a separate product, `astrum-forge/ignifx-editor`, built on the runtime through `@ignifx/editor-host` (`17-editor-host.md`). Its engine seams land here as public features (asks E0 to E14 in §5 of the editor plan, ADR-E011 of the editor repository), and engine 1.0 is some way off. PR #41 already moved `00-overview.md` §7 and the plan's 1.0 scope to say the editor is developed alongside the engine before 1.0. The constitution, which wins over both (§10.1), still said otherwise. §10.2 requires an ADR for the amendment.

## Options considered

1. **Keep §1.3 as written** and pause the editor until 1.0. The editor work already under way would stop, and the overview and plan would have to be reverted.
2. **Hold engine releases until the editor is ready.** The engine's 1.0 criteria (§4.3) would depend on a separate product, and games would wait on tooling they do not need.
3. **Develop both side by side, with neither blocking the other.** Engine seams the editor needs ship as ordinary, editor-free engine features under the usual rules; the editor tracks published engine releases.

## Decision

Use option 3. The visual editor is a separate product developed alongside the engine, before and after 1.0. Neither blocks the other: the engine does not wait for the editor, and the editor does not wait for engine 1.0.

The commitments that §1.3 and `00-overview.md` §7 already made stay:

- The editor builds on the runtime; there is no editor-only fork of the engine.
- The runtime stays editor-free. Nothing in a built game depends on the editor or on `@ignifx/editor-host`.
- A seam the editor needs is an engine feature like any other: public API under §4 and §8.2, tested, documented and paid for only by apps that use it (§2.3, §2.5).

## Consequences

- `CONSTITUTION.md` §1.3 and the engineering plan's R-12 and §8 now match `00-overview.md` §7.
- The §4.3 criteria for engine 1.0 are unchanged and do not mention the editor.
- Editor-driven engine work competes with other engine work for the one human approver (§7.4); the plan's ordering, not the editor's, decides engine priorities.
- Revisit if the editor needs a seam that cannot be made editor-free.
